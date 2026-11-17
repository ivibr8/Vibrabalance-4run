import {
  BufferProgress,
  LiveSpectrumFrame,
  SensorAxis,
  SpectrumMeasurement,
  VibrationSample,
} from '../types/balancing';

export const PHYPHOX_FFT_SAMPLES = 1024;
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
 * Computes single-sided Hann-windowed FFT magnitudes (Arbitrary Units) for one signed axis.
 * Subtracts block mean first to remove static gravity / DC offset cleanly.
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

/**
 * Computes buffering progress while collecting the strict 1024-sample FFT block.
 */
export function computeBufferProgress(
  samples: VibrationSample[],
  sensorSource: string,
  targetSamples = PHYPHOX_FFT_SAMPLES
): BufferProgress {
  let estimatedRateHz: number | null = null;
  if (samples.length >= 12) {
    const spanSec =
      (samples[samples.length - 1].timestamp - samples[0].timestamp) / 1000;
    if (spanSec > 0.05) {
      estimatedRateHz = (samples.length - 1) / spanSec;
    }
  }

  return {
    collected: Math.min(samples.length, targetSamples),
    target: targetSamples,
    estimatedRateHz,
    sensorSource,
  };
}

/**
 * Phyphox-style strict 1024-sample real-time FFT frame.
 * Never emits coarse 128/256/512 warmup frames, preserving sharp spectral peaks
 * and exact bin spacing (df = 1 / period, Nyquist = fs / 2).
 */
export function computeLiveSpectrumFrame(
  samples: VibrationSample[],
  axis: SensorAxis,
  sensorSource: string
): LiveSpectrumFrame | null {
  const fftSize = PHYPHOX_FFT_SAMPLES;
  if (samples.length < fftSize) return null;

  const slice = samples.slice(samples.length - fftSize);
  const spanSec = (slice[fftSize - 1].timestamp - slice[0].timestamp) / 1000;
  if (spanSec <= 0.1) return null;

  // Match Phyphox acc_spectrum.phyphox timing math:
  // dt = Dt / (count - 1), period = actual_samples * dt, df = 1 / period, arate = 1 / dt, maxf = 0.5 / dt
  const dtSec = spanSec / (fftSize - 1);
  const sampleRateHz = 1 / dtSec;
  if (!Number.isFinite(sampleRateHz) || sampleRateHz < 10) return null;

  const periodSec = fftSize * dtSec;
  const resolutionHz = 1 / periodSec;
  const nyquistHz = 0.5 / dtSec;
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
    const freq = k * resolutionHz;
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
    windowSamples: fftSize,
    sensorSource,
    axisUsed: axis,
    updatedAt: performance.now(),
  };
}

/**
 * Maintains an unbiased, low-variance Phyphox-style spectrum measurement.
 * Uses native FFT bins (no 0.5 Hz max-rebinning) and an unbiased exponential RMS
 * filter across settled 1024-sample frames (never Peak-Hold max() latching),
 * so transient bumps decay away and steady 1X peaks remain highly repeatable.
 */
export function updateSpectrumMeasurement(
  prev: SpectrumMeasurement | null,
  frame: LiveSpectrumFrame
): SpectrumMeasurement {
  const numBins = frame.frequenciesHz.length;
  const canAverageWithPrev =
    prev !== null &&
    prev.amplitudesAU.length === numBins &&
    prev.axisUsed === frame.axisUsed &&
    Math.abs(prev.resolutionHz - frame.resolutionHz) < 0.08;

  const alpha = 0.28; // Smooths random frame-to-frame noise without locking upward spikes
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
    samplesUsed: frame.fftSize,
    sensorSource: frame.sensorSource,
    axisUsed: frame.axisUsed,
    frameCount: canAverageWithPrev && prev ? prev.frameCount + 1 : 1,
  };
}

