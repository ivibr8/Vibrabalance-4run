import {
  BufferProgress,
  LiveSpectrumFrame,
  SensorAxis,
  SpectrumMeasurement,
  VibrationSample,
} from '../types/balancing';

export const PHYPHOX_FFT_SAMPLES = 1024;
export const BROWSER_MIN_WINDOW_SAMPLES = 128; // ~2.1s at 60 Hz for fast startup
export const MIN_SPECTRUM_HZ = 1.0;

/**
 * In-place Radix-2 Cooley-Tukey FFT. Length N must be a power of 2.
 */
export function fftRadix2(real: Float64Array, imag: Float64Array): void {
  const n = real.length;
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      const tr = real[i];
      real[i] = real[j];
      real[j] = tr;
      const ti = imag[i];
      imag[i] = imag[j];
      imag[j] = ti;
    }
    let k = n >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wStepR = Math.cos(angle);
    const wStepI = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let wR = 1.0;
      let wI = 0.0;
      for (let k = 0; k < halfLen; k++) {
        const pos = i + k + halfLen;
        const vR = real[pos] * wR - imag[pos] * wI;
        const vI = real[pos] * wI + imag[pos] * wR;

        real[pos] = real[i + k] - vR;
        imag[pos] = imag[i + k] - vI;
        real[i + k] += vR;
        imag[i + k] += vI;

        const nextWR = wR * wStepR - wI * wStepI;
        const nextWI = wR * wStepI + wI * wStepR;
        wR = nextWR;
        wI = nextWI;
      }
    }
  }
}

/**
 * Picks the largest power-of-2 real sample count (128..1024) suited for the
 * sensor's actual sample rate so the user never waits 17+ seconds on a 60 Hz browser,
 * while native-rate sensors (~400+ Hz) still use full 1024 real samples (~2.5 s).
 */
function pickRealWindowSize(availableCount: number, estRateHz: number | null): number {
  const maxForRate =
    estRateHz === null || estRateHz >= 280
      ? 1024
      : estRateHz >= 140
      ? 512
      : 256;

  if (availableCount >= 1024 && maxForRate >= 1024) return 1024;
  if (availableCount >= 512 && maxForRate >= 512) return 512;
  if (availableCount >= 256 && maxForRate >= 256) return 256;
  if (availableCount >= 128) return 128;
  return 0;
}

/**
 * Computes single-sided Hann-windowed FFT magnitudes (Arbitrary Units) for `nReal`
 * samples zero-padded to `fftSize` (1024). Subtracts mean first to remove static gravity.
 * Normalizes strictly by `windowSum` of the Hann window so amplitudes stay calibrated
 * across 128, 256, 512, and 1024 real-sample windows with minimal scalloping loss.
 */
function computeSingleAxisMagnitudes(
  values: Float64Array,
  nReal: number,
  fftSize: number
): Float64Array {
  let mean = 0;
  for (let i = 0; i < nReal; i++) {
    mean += values[i];
  }
  mean /= nReal;

  const real = new Float64Array(fftSize);
  const imag = new Float64Array(fftSize);

  let windowSum = 0;
  for (let i = 0; i < nReal; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (nReal - 1)));
    windowSum += w;
    real[i] = (values[i] - mean) * w;
  }

  fftRadix2(real, imag);

  const halfN = fftSize / 2;
  const numBins = halfN + 1;
  const mags = new Float64Array(numBins);
  const scaleSingle = windowSum > 0 ? 2.0 / windowSum : 2.0 / nReal;
  const scaleNyq = windowSum > 0 ? 1.0 / windowSum : 1.0 / nReal;

  for (let k = 1; k < numBins; k++) {
    const s = k === halfN ? scaleNyq : scaleSingle;
    mags[k] = Math.hypot(real[k], imag[k]) * s;
  }
  mags[0] = 0;

  return mags;
}

function estimateSampleRateHz(samples: VibrationSample[]): number | null {
  if (samples.length < 12) return null;
  const spanSec = (samples[samples.length - 1].timestamp - samples[0].timestamp) / 1000;
  if (spanSec <= 0.05) return null;
  const rate = (samples.length - 1) / spanSec;
  return Number.isFinite(rate) && rate >= 10 ? rate : null;
}

/**
 * Computes buffering progress toward the initial fast spectrum window
 * (128 samples ≈ 2.1 s on 60 Hz browsers, 1024 samples ≈ 2.5 s at 411 Hz).
 */
export function computeBufferProgress(
  samples: VibrationSample[],
  sensorSource: string
): BufferProgress {
  const estimatedRateHz = estimateSampleRateHz(samples);
  const target =
    estimatedRateHz !== null && estimatedRateHz < 280
      ? BROWSER_MIN_WINDOW_SAMPLES
      : PHYPHOX_FFT_SAMPLES;

  return {
    collected: Math.min(samples.length, target),
    target,
    estimatedRateHz,
    sensorSource,
  };
}

/**
 * Adaptive Phyphox-style FFT frame:
 * - At 400+ Hz: uses full 1024 real samples (2.49 s period, 0.40 Hz resolution, 206 Hz Nyquist).
 * - At ~60 Hz browser limit: starts at 128 real samples (2.1 s) and steps cleanly to 256 (4.3 s),
 *   zero-padded to 1024 FFT points for razor-sharp peak localization without 17s stalls.
 */
export function computeLiveSpectrumFrame(
  samples: VibrationSample[],
  axis: SensorAxis,
  sensorSource: string
): LiveSpectrumFrame | null {
  const estRate = estimateSampleRateHz(samples);
  const nReal = pickRealWindowSize(samples.length, estRate);
  if (nReal === 0) return null;

  const fftSize = PHYPHOX_FFT_SAMPLES;
  const slice = samples.slice(samples.length - nReal);
  const spanSec = (slice[nReal - 1].timestamp - slice[0].timestamp) / 1000;
  if (spanSec <= 0.1) return null;

  const dtSec = spanSec / (nReal - 1);
  const sampleRateHz = 1 / dtSec;
  if (!Number.isFinite(sampleRateHz) || sampleRateHz < 10) return null;

  const periodSec = nReal * dtSec;
  const resolutionHz = 1 / periodSec;
  const nyquistHz = 0.5 / dtSec;
  const displayStepHz = sampleRateHz / fftSize;
  const numBins = fftSize / 2 + 1;

  let amps: Float64Array;
  if (axis === 'triaxial') {
    const vx = new Float64Array(nReal);
    const vy = new Float64Array(nReal);
    const vz = new Float64Array(nReal);
    for (let i = 0; i < nReal; i++) {
      vx[i] = slice[i].x;
      vy[i] = slice[i].y;
      vz[i] = slice[i].z;
    }
    const mx = computeSingleAxisMagnitudes(vx, nReal, fftSize);
    const my = computeSingleAxisMagnitudes(vy, nReal, fftSize);
    const mz = computeSingleAxisMagnitudes(vz, nReal, fftSize);
    amps = new Float64Array(numBins);
    for (let k = 0; k < numBins; k++) {
      amps[k] = Math.hypot(mx[k], my[k], mz[k]);
    }
  } else {
    const v = new Float64Array(nReal);
    for (let i = 0; i < nReal; i++) {
      v[i] = slice[i][axis];
    }
    amps = computeSingleAxisMagnitudes(v, nReal, fftSize);
  }

  const frequenciesHz = new Array<number>(numBins);
  const amplitudesAU = new Array<number>(numBins);

  for (let k = 0; k < numBins; k++) {
    const freq = k * displayStepHz;
    frequenciesHz[k] = freq;
    amplitudesAU[k] = freq < MIN_SPECTRUM_HZ ? 0 : amps[k];
  }

  return {
    frequenciesHz,
    amplitudesAU,
    sampleRateHz,
    nyquistHz,
    resolutionHz,
    periodSec,
    fftSize,
    windowSamples: nReal,
    sensorSource,
    axisUsed: axis,
    updatedAt: performance.now(),
  };
}

/**
 * Maintains an unbiased, low-variance spectrum measurement using an exponential RMS filter
 * across settled frames of matching window size (never Peak-Hold max() latching).
 */
export function updateSpectrumMeasurement(
  prev: SpectrumMeasurement | null,
  frame: LiveSpectrumFrame
): SpectrumMeasurement {
  const numBins = frame.frequenciesHz.length;
  const canAverageWithPrev =
    prev !== null &&
    prev.amplitudesAU.length === numBins &&
    prev.samplesUsed === frame.windowSamples &&
    prev.axisUsed === frame.axisUsed &&
    Math.abs(prev.sampleRateHz - frame.sampleRateHz) < Math.max(4, frame.sampleRateHz * 0.15);

  const alpha = 0.32;
  const amplitudesAU = new Array<number>(numBins);

  for (let k = 0; k < numBins; k++) {
    const liveVal = frame.amplitudesAU[k];
    if (canAverageWithPrev && prev) {
      const prevVal = prev.amplitudesAU[k] ?? liveVal;
      amplitudesAU[k] = Math.sqrt((1 - alpha) * prevVal * prevVal + alpha * liveVal * liveVal);
    } else {
      amplitudesAU[k] = liveVal;
    }
  }

  return {
    frequenciesHz: frame.frequenciesHz,
    amplitudesAU,
    liveAmplitudesAU: frame.amplitudesAU,
    sampleRateHz: frame.sampleRateHz,
    nyquistHz: frame.nyquistHz,
    resolutionHz: frame.resolutionHz,
    periodSec: frame.periodSec,
    samplesUsed: frame.windowSamples,
    fftSize: frame.fftSize,
    sensorSource: frame.sensorSource,
    axisUsed: frame.axisUsed,
    frameCount: canAverageWithPrev && prev ? prev.frameCount + 1 : 1,
  };
}

/**
 * Parses an exported Phyphox FFT / Acceleration Spectrum CSV ("Frequency (Hz)","Absolute Amplitude (a.u.)")
 * supporting comma, semicolon, or tab delimiters and scientific notation.
 */
export function parsePhyphoxCsv(csvText: string): SpectrumMeasurement | null {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const pairs: { f: number; a: number }[] = [];

  for (const line of lines) {
    // Support comma, semicolon, or tab separation
    const sep = line.includes('\t') ? '\t' : line.includes(';') && !line.includes(',') ? ';' : ',';
    const parts = line.split(sep).map((p) => p.replace(/^["'\s]+|["'\s]+$/g, ''));
    if (parts.length < 2) continue;

    const f = Number(parts[0]);
    const a = Number(parts[1]);
    if (Number.isFinite(f) && Number.isFinite(a) && f >= 0 && a >= 0) {
      pairs.push({ f, a });
    }
  }

  if (pairs.length < 4) return null;

  pairs.sort((p1, p2) => p1.f - p2.f);

  const diffs: number[] = [];
  for (let i = 1; i < pairs.length; i++) {
    const d = pairs[i].f - pairs[i - 1].f;
    if (d > 1e-4) diffs.push(d);
  }
  if (diffs.length === 0) return null;
  diffs.sort((a, b) => a - b);
  const df = diffs[Math.floor(diffs.length / 2)];

  const frequenciesHz: number[] = [];
  const amplitudesAU: number[] = [];

  // Phyphox exports start at bin k=1 (df); prepend DC 0 Hz = 0 for clean plotting from origin
  if (pairs[0].f > df * 0.5) {
    frequenciesHz.push(0);
    amplitudesAU.push(0);
  }
  for (const p of pairs) {
    frequenciesHz.push(p.f);
    amplitudesAU.push(p.a);
  }

  const fLast = pairs[pairs.length - 1].f;
  const lastBinIndex = Math.round(fLast / df);
  const nextPow2 = Math.pow(2, Math.ceil(Math.log2(Math.max(2, lastBinIndex + 1))));
  // Phyphox omits DC (k=0) and Nyquist (k=N/2); e.g. 63 bins => N/2 = 64 => Nyquist = 64 * df
  const nyquistHz = Math.abs(lastBinIndex + 1 - nextPow2) <= 1 ? nextPow2 * df : fLast;
  const sampleRateHz = 2 * nyquistHz;
  const resolutionHz = df;
  const periodSec = 1 / df;
  const samplesUsed = Math.max(pairs.length * 2, Math.round(sampleRateHz / df));

  return {
    frequenciesHz,
    amplitudesAU,
    liveAmplitudesAU: amplitudesAU,
    sampleRateHz,
    nyquistHz,
    resolutionHz,
    periodSec,
    samplesUsed,
    fftSize: samplesUsed,
    sensorSource: 'Phyphox CSV',
    axisUsed: 'triaxial',
    frameCount: 1,
  };
}


