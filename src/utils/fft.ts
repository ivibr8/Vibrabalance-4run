import {
  LiveSpectrumFrame,
  PeakHoldSpectrum,
  SensorAxis,
  VibrationSample,
} from '../types/balancing';

export const PEAK_HOLD_STEP_HZ = 0.5;
export const PEAK_HOLD_MAX_HZ = 100;
export const PEAK_HOLD_BIN_COUNT = PEAK_HOLD_MAX_HZ / PEAK_HOLD_STEP_HZ + 1; // 201 bins (0..100 Hz)

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
 * Computes single-sided Hann-windowed FFT magnitudes (Arbitrary Units) for one signed axis.
 */
function computeSingleAxisMagnitudes(values: Float64Array, fftSize: number): Float64Array {
  const n = fftSize;
  let mean = 0;
  for (let i = 0; i < n; i++) {
    mean += values[i];
  }
  mean /= n;

  const real = new Float64Array(n);
  const imag = new Float64Array(n);

  let windowSum = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    windowSum += w;
    real[i] = (values[i] - mean) * w;
  }

  fftRadix2(real, imag);

  const halfN = n / 2;
  const numBins = halfN + 1;
  const mags = new Float64Array(numBins);
  const scaleSingle = windowSum > 0 ? 2.0 / windowSum : 2.0 / n;
  const scaleNyq = windowSum > 0 ? 1.0 / windowSum : 1.0 / n;

  for (let k = 1; k < numBins; k++) {
    const s = k === halfN ? scaleNyq : scaleSingle;
    mags[k] = Math.hypot(real[k], imag[k]) * s;
  }
  mags[0] = 0;

  return mags;
}

function pickLiveFftSize(availableCount: number): number {
  if (availableCount >= 1024) return 1024;
  if (availableCount >= 512) return 512;
  if (availableCount >= 256) return 256;
  if (availableCount >= 128) return 128;
  return 0;
}

/**
 * Computes a real-time sliding-window FFT frame from the latest real accelerometer samples.
 */
export function computeLiveSpectrumFrame(
  samples: VibrationSample[],
  axis: SensorAxis,
  sensorSource: string
): LiveSpectrumFrame | null {
  const fftSize = pickLiveFftSize(samples.length);
  if (fftSize === 0) return null;

  const slice = samples.slice(samples.length - fftSize);
  const spanSec = (slice[fftSize - 1].timestamp - slice[0].timestamp) / 1000;
  if (spanSec <= 0.05) return null;

  const sampleRateHz = (fftSize - 1) / spanSec;
  if (!Number.isFinite(sampleRateHz) || sampleRateHz < 10) return null;

  const nyquistHz = sampleRateHz / 2;
  const resolutionHz = sampleRateHz / fftSize;
  const numBins = fftSize / 2 + 1;

  let amps: Float64Array;
  if (axis === 'triaxial') {
    const vx = new Float64Array(fftSize);
    const vy = new Float64Array(fftSize);
    const vz = new Float64Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      vx[i] = slice[i].x;
      vy[i] = slice[i].y;
      vz[i] = slice[i].z;
    }
    const mx = computeSingleAxisMagnitudes(vx, fftSize);
    const my = computeSingleAxisMagnitudes(vy, fftSize);
    const mz = computeSingleAxisMagnitudes(vz, fftSize);
    amps = new Float64Array(numBins);
    for (let k = 0; k < numBins; k++) {
      amps[k] = Math.hypot(mx[k], my[k], mz[k]);
    }
  } else {
    const v = new Float64Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      v[i] = slice[i][axis];
    }
    amps = computeSingleAxisMagnitudes(v, fftSize);
  }

  const frequenciesHz = new Array<number>(numBins);
  const amplitudesAU = new Array<number>(numBins);

  for (let k = 0; k < numBins; k++) {
    frequenciesHz[k] = k * resolutionHz;
    amplitudesAU[k] = amps[k];
  }

  return {
    frequenciesHz,
    amplitudesAU,
    sampleRateHz,
    nyquistHz,
    resolutionHz,
    fftSize,
    windowSamples: fftSize,
    sensorSource,
    axisUsed: axis,
    updatedAt: performance.now(),
  };
}

/**
 * Projects an incoming live FFT frame onto a fixed 0.5 Hz grid (0..100 Hz)
 * and updates the Peak-Hold envelope: held[i] = max(held[i], live[i]).
 * Sub-1.5 Hz bins are suppressed so hand/tilt motion doesn't flood the hold.
 */
export function updatePeakHoldSpectrum(
  prevHold: PeakHoldSpectrum | null,
  frame: LiveSpectrumFrame
): PeakHoldSpectrum {
  const frequenciesHz =
    prevHold?.frequenciesHz ??
    Array.from({ length: PEAK_HOLD_BIN_COUNT }, (_, i) => i * PEAK_HOLD_STEP_HZ);

  const liveGrid = new Array<number>(PEAK_HOLD_BIN_COUNT).fill(0);

  // Sample incoming spectrum onto fixed 0.5 Hz grid (suppressing < 1.5 Hz DC/tilt bump)
  for (let gi = 0; gi < PEAK_HOLD_BIN_COUNT; gi++) {
    const gf = frequenciesHz[gi];
    if (gf < 1.5 || gf > frame.nyquistHz) {
      liveGrid[gi] = 0;
      continue;
    }

    // Use max of local FFT bins within ±0.35 Hz or linear interpolation so narrow peaks are never skipped
    let maxNearby = 0;
    let foundNearby = false;
    for (let k = 1; k < frame.frequenciesHz.length; k++) {
      const f = frame.frequenciesHz[k];
      if (Math.abs(f - gf) <= PEAK_HOLD_STEP_HZ * 0.65) {
        if (frame.amplitudesAU[k] > maxNearby) {
          maxNearby = frame.amplitudesAU[k];
        }
        foundNearby = true;
      }
    }

    if (!foundNearby) {
      // Linear interpolation fallback when df > step
      const exactK = gf / frame.resolutionHz;
      const k0 = Math.floor(exactK);
      const k1 = Math.min(frame.amplitudesAU.length - 1, k0 + 1);
      const frac = exactK - k0;
      if (k0 >= 1 && k0 < frame.amplitudesAU.length) {
        maxNearby =
          frame.amplitudesAU[k0] * (1 - frac) + frame.amplitudesAU[k1] * frac;
      }
    }

    liveGrid[gi] = maxNearby;
  }

  const heldAmplitudesAU = new Array<number>(PEAK_HOLD_BIN_COUNT);
  for (let gi = 0; gi < PEAK_HOLD_BIN_COUNT; gi++) {
    const prevVal = prevHold ? prevHold.heldAmplitudesAU[gi] ?? 0 : 0;
    heldAmplitudesAU[gi] = Math.max(prevVal, liveGrid[gi]);
  }

  return {
    frequenciesHz,
    heldAmplitudesAU,
    liveAmplitudesAU: liveGrid,
    sampleRateHz: frame.sampleRateHz,
    nyquistHz: frame.nyquistHz,
    resolutionHz: frame.resolutionHz,
    fftSize: frame.fftSize,
    sensorSource: frame.sensorSource,
    axisUsed: frame.axisUsed,
    frameCount: (prevHold?.frameCount ?? 0) + 1,
  };
}
