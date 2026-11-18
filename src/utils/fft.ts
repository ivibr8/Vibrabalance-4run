import {
  AcquisitionQuality,
  BufferProgress,
  FftSampleCount,
  LiveSpectrumFrame,
  SensorAxis,
  SingleAxis,
  SpectrumMeasurement,
  VibrationSample,
} from '../types/balancing';

export const FFT_SAMPLE_OPTIONS: FftSampleCount[] = [256, 512, 1024, 2048, 4096];
export const DEFAULT_FFT_SAMPLE_COUNT: FftSampleCount = 1024;
export const MIN_VALID_SPECTRUM_HZ = 0.5;

export function normalizeSingleAxis(axis: SensorAxis): SingleAxis {
  if (axis === 'x' || axis === 'y' || axis === 'z') return axis;
  return 'z';
}

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
 * Single-axis DC removal, Hann windowing, and exact N-point one-sided amplitude normalization (m/s^2).
 */
function computeSingleAxisOneSidedSpectrum(
  values: Float64Array,
  fftSize: number
): Float64Array {
  // 1. Remove mean / static DC & gravitational offset
  let mean = 0;
  for (let i = 0; i < fftSize; i++) {
    mean += values[i];
  }
  mean /= fftSize;

  // 2. Apply Hann window
  const real = new Float64Array(fftSize);
  const imag = new Float64Array(fftSize);
  let windowSum = 0;
  const denom = fftSize > 1 ? fftSize - 1 : 1;
  for (let i = 0; i < fftSize; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom));
    windowSum += w;
    real[i] = (values[i] - mean) * w;
  }

  // 3. Complex FFT
  fftRadix2(real, imag);

  // 4. Magnitude & one-sided normalization in m/s^2
  const halfN = fftSize / 2;
  const numBins = halfN + 1;
  const mags = new Float64Array(numBins);
  const scaleSingle = windowSum > 0 ? 2.0 / windowSum : 2.0 / fftSize;
  const scaleNyq = windowSum > 0 ? 1.0 / windowSum : 1.0 / fftSize;

  mags[0] = 0;
  for (let k = 1; k < numBins; k++) {
    const s = k === halfN ? scaleNyq : scaleSingle;
    mags[k] = Math.hypot(real[k], imag[k]) * s;
  }

  return mags;
}

/**
 * Analyzes consecutive high-resolution sample timestamps for actual rate, jitter, and dropped samples.
 */
export function analyzeTimestampIntervals(samples: VibrationSample[]): {
  actualSampleRateHz: number;
  spanSec: number;
  medianDtMs: number;
  meanDtMs: number;
  minDtMs: number;
  maxDtMs: number;
  jitterCv: number;
  droppedSamplesEstimate: number;
  irregularIntervalFraction: number;
  hasIrregularSampling: boolean;
} | null {
  const n = samples.length;
  if (n < 8) return null;

  const spanMs = samples[n - 1].timestamp - samples[0].timestamp;
  if (spanMs <= 20) return null;

  const dts: number[] = new Array(n - 1);
  let minDtMs = Infinity;
  let maxDtMs = 0;

  for (let i = 1; i < n; i++) {
    const dt = samples[i].timestamp - samples[i - 1].timestamp;
    dts[i - 1] = dt;
    if (dt < minDtMs) minDtMs = dt;
    if (dt > maxDtMs) maxDtMs = dt;
  }

  const sorted = [...dts].sort((a, b) => a - b);
  const medianDtMs = sorted[Math.floor(sorted.length / 2)];
  const meanDtMs = spanMs / (n - 1);
  const actualSampleRateHz = 1000 / meanDtMs;

  if (!Number.isFinite(actualSampleRateHz) || actualSampleRateHz < 5) {
    return null;
  }

  let sqDiffSum = 0;
  let irregularCount = 0;
  let droppedSamplesEstimate = 0;
  const safeMedian = Math.max(0.1, medianDtMs);

  for (let i = 0; i < dts.length; i++) {
    const dt = dts[i];
    const diff = dt - meanDtMs;
    sqDiffSum += diff * diff;
    if (Math.abs(dt - safeMedian) > safeMedian * 0.45) {
      irregularCount++;
    }
    if (dt > safeMedian * 1.75) {
      droppedSamplesEstimate += Math.max(1, Math.round(dt / safeMedian) - 1);
    }
  }

  const stdDtMs = Math.sqrt(sqDiffSum / dts.length);
  const jitterCv = meanDtMs > 0 ? stdDtMs / meanDtMs : 0;
  const irregularIntervalFraction = irregularCount / dts.length;

  const hasIrregularSampling =
    droppedSamplesEstimate >= 2 ||
    maxDtMs > safeMedian * 2.5 ||
    irregularIntervalFraction > 0.12 ||
    jitterCv > 0.25;

  return {
    actualSampleRateHz,
    spanSec: spanMs / 1000,
    medianDtMs,
    meanDtMs,
    minDtMs,
    maxDtMs,
    jitterCv,
    droppedSamplesEstimate,
    irregularIntervalFraction,
    hasIrregularSampling,
  };
}

/**
 * Computes buffering progress toward the exact user-selected FFT sample count.
 */
export function computeBufferProgress(
  samples: VibrationSample[],
  targetSampleCount: FftSampleCount,
  sensorSource: string,
  isStalled = false
): BufferProgress {
  const intervalStats = analyzeTimestampIntervals(samples);
  const elapsedSec =
    samples.length >= 2
      ? Math.max(0, (samples[samples.length - 1].timestamp - samples[0].timestamp) / 1000)
      : 0;

  return {
    collected: Math.min(samples.length, targetSampleCount),
    target: targetSampleCount,
    estimatedRateHz: intervalStats ? intervalStats.actualSampleRateHz : null,
    elapsedSec,
    isStalled,
    irregularDuringFill: intervalStats ? intervalStats.hasIrregularSampling : false,
    droppedDuringFill: intervalStats ? intervalStats.droppedSamplesEstimate : 0,
    sensorSource,
  };
}

/**
 * Computes an exact N-sample single-axis FFT frame matching Phyphox Acceleration Spectrum
 * methodology, strictly using only `axis` and strictly stopping at `nyquistHz`.
 * Returns `null` if fewer than `sampleCount` samples have been acquired (incomplete buffer).
 */
export function computeLiveSpectrumFrame(
  samples: VibrationSample[],
  axis: SensorAxis,
  sampleCount: FftSampleCount,
  sensorSource: string,
  isStalled = false,
  recentTopPeaks: number[] = []
): LiveSpectrumFrame | null {
  if (samples.length < sampleCount) return null;

  const singleAxis = normalizeSingleAxis(axis);
  const slice = samples.slice(samples.length - sampleCount);
  const stats = analyzeTimestampIntervals(slice);
  if (!stats) return null;

  const sampleRateHz = stats.actualSampleRateHz;
  const dtSec = 1 / sampleRateHz;
  const periodSec = sampleCount * dtSec;
  // Requirement 5: Frequency Resolution = Actual Sampling Rate / Number of FFT Samples
  const resolutionHz = sampleRateHz / sampleCount;
  const nyquistHz = sampleRateHz / 2;

  const channelValues = new Float64Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    channelValues[i] = slice[i][singleAxis];
  }

  const mags = computeSingleAxisOneSidedSpectrum(channelValues, sampleCount);
  const numBins = mags.length; // sampleCount / 2 + 1
  const frequenciesHz = new Array<number>(numBins);
  const amplitudesMs2 = new Array<number>(numBins);

  const activeMags: number[] = [];
  let maxPeak = 0;

  for (let k = 0; k < numBins; k++) {
    const freq = k * resolutionHz;
    frequenciesHz[k] = freq;
    const val = freq < MIN_VALID_SPECTRUM_HZ ? 0 : mags[k];
    amplitudesMs2[k] = val;
    if (freq >= MIN_VALID_SPECTRUM_HZ) {
      activeMags.push(val);
      if (val > maxPeak) maxPeak = val;
    }
  }

  // Noise & stability evaluation
  let snrRatio = 0;
  if (activeMags.length > 0) {
    const sortedMags = [...activeMags].sort((a, b) => a - b);
    const medianNoise = Math.max(1e-6, sortedMags[Math.floor(sortedMags.length / 2)]);
    snrRatio = maxPeak / medianNoise;
  }

  let peakStabilityCv = 0;
  if (recentTopPeaks.length >= 3) {
    const allPeaks = [...recentTopPeaks.slice(-5), maxPeak];
    const meanP = allPeaks.reduce((s, v) => s + v, 0) / allPeaks.length;
    if (meanP > 1e-6) {
      const varP =
        allPeaks.reduce((s, v) => s + (v - meanP) * (v - meanP), 0) / allPeaks.length;
      peakStabilityCv = Math.sqrt(varP) / meanP;
    }
  }

  const isNoisyOrUnstable =
    (maxPeak > 0.02 && snrRatio < 2.2) || peakStabilityCv > 0.35;

  const quality: AcquisitionQuality = {
    actualSampleRateHz: stats.actualSampleRateHz,
    medianDtMs: stats.medianDtMs,
    meanDtMs: stats.meanDtMs,
    minDtMs: stats.minDtMs,
    maxDtMs: stats.maxDtMs,
    jitterCv: stats.jitterCv,
    droppedSamplesEstimate: stats.droppedSamplesEstimate,
    irregularIntervalFraction: stats.irregularIntervalFraction,
    hasIrregularSampling: stats.hasIrregularSampling,
    isStalled,
    isNoisyOrUnstable,
    snrRatio,
    peakStabilityCv,
  };

  return {
    frequenciesHz,
    amplitudesMs2,
    amplitudesAU: amplitudesMs2,
    sampleRateHz,
    nyquistHz,
    resolutionHz,
    periodSec,
    fftSize: sampleCount,
    windowSamples: sampleCount,
    sensorSource,
    axisUsed: singleAxis,
    updatedAt: performance.now(),
    quality,
  };
}

/**
 * Converts a valid N-sample FFT frame directly into a SpectrumMeasurement without
 * distortion or peak-hold latching so all 4 balancing runs share identical amplitude scaling.
 */
export function updateSpectrumMeasurement(
  prev: SpectrumMeasurement | null,
  frame: LiveSpectrumFrame
): SpectrumMeasurement {
  const sameConfig =
    prev !== null &&
    prev.samplesUsed === frame.windowSamples &&
    prev.axisUsed === frame.axisUsed &&
    Math.abs(prev.sampleRateHz - frame.sampleRateHz) < Math.max(4, frame.sampleRateHz * 0.15);

  return {
    frequenciesHz: frame.frequenciesHz,
    amplitudesMs2: frame.amplitudesMs2,
    amplitudesAU: frame.amplitudesMs2,
    liveAmplitudesAU: frame.amplitudesMs2,
    sampleRateHz: frame.sampleRateHz,
    nyquistHz: frame.nyquistHz,
    resolutionHz: frame.resolutionHz,
    periodSec: frame.periodSec,
    samplesUsed: frame.windowSamples,
    fftSize: frame.fftSize,
    sensorSource: frame.sensorSource,
    axisUsed: frame.axisUsed,
    frameCount: sameConfig && prev ? prev.frameCount + 1 : 1,
    quality: frame.quality,
  };
}

export interface PeakPickReadout {
  binIdx: number;
  frequencyHz: number;
  amplitudeMs2: number;
  isInterpolated: boolean;
  isWithinValidRange: boolean;
}

/**
 * Computes the user-controlled Peak Pick readout at `binIdx`.
 * - Nearest Bin mode: exact bin frequency and amplitude.
 * - Interpolated mode: 3-point parabolic refinement around the user's selected bin/local crest (+/- 1 bin),
 *   never jumping away to a different spectral peak.
 */
export function computePeakPickReadout(
  spectrum: SpectrumMeasurement,
  binIdx: number,
  useInterpolation: boolean
): PeakPickReadout | null {
  const nBins = spectrum.frequenciesHz.length;
  if (nBins < 3 || binIdx < 0 || binIdx >= nBins) return null;

  const baseFreq = spectrum.frequenciesHz[binIdx];
  const baseAmp = spectrum.amplitudesMs2[binIdx] ?? 0;

  if (!useInterpolation || binIdx <= 1 || binIdx >= nBins - 2) {
    return {
      binIdx,
      frequencyHz: baseFreq,
      amplitudeMs2: baseAmp,
      isInterpolated: false,
      isWithinValidRange:
        baseFreq >= MIN_VALID_SPECTRUM_HZ && baseFreq <= spectrum.nyquistHz + 1e-6,
    };
  }

  // Only inspect immediate 3-bin neighborhood [binIdx-1, binIdx, binIdx+1] around user cursor
  let centerIdx = binIdx;
  const aL = spectrum.amplitudesMs2[binIdx - 1] ?? 0;
  const aC = spectrum.amplitudesMs2[binIdx] ?? 0;
  const aR = spectrum.amplitudesMs2[binIdx + 1] ?? 0;
  if (aL > aC && aL >= aR && binIdx - 1 > 1) centerIdx = binIdx - 1;
  else if (aR > aC && aR > aL && binIdx + 1 < nBins - 1) centerIdx = binIdx + 1;

  const y1 = spectrum.amplitudesMs2[centerIdx - 1] ?? 0;
  const y2 = spectrum.amplitudesMs2[centerIdx] ?? 0;
  const y3 = spectrum.amplitudesMs2[centerIdx + 1] ?? 0;

  const denom = y1 - 2 * y2 + y3;
  if (denom >= -1e-12 || !(y2 >= y1 && y2 >= y3)) {
    const cf = spectrum.frequenciesHz[centerIdx];
    const ca = spectrum.amplitudesMs2[centerIdx] ?? 0;
    return {
      binIdx: centerIdx,
      frequencyHz: cf,
      amplitudeMs2: ca,
      isInterpolated: false,
      isWithinValidRange:
        cf >= MIN_VALID_SPECTRUM_HZ && cf <= spectrum.nyquistHz + 1e-6,
    };
  }

  const rawDelta = (0.5 * (y1 - y3)) / denom;
  const delta = Math.max(-0.5, Math.min(0.5, rawDelta));
  const df =
    spectrum.frequenciesHz.length > 1
      ? spectrum.frequenciesHz[1] - spectrum.frequenciesHz[0]
      : spectrum.resolutionHz;
  const interpFreq = spectrum.frequenciesHz[centerIdx] + delta * df;
  const interpAmp = Math.max(y2, y2 - 0.25 * (y1 - y3) * delta);

  return {
    binIdx: centerIdx,
    frequencyHz: interpFreq,
    amplitudeMs2: interpAmp,
    isInterpolated: true,
    isWithinValidRange:
      interpFreq >= MIN_VALID_SPECTRUM_HZ && interpFreq <= spectrum.nyquistHz + 1e-6,
  };
}

/**
 * Parses an exported Phyphox FFT / Acceleration Spectrum CSV ("Frequency (Hz)","Absolute Amplitude")
 * supporting comma, semicolon, or tab delimiters.
 */
export function parsePhyphoxCsv(
  csvText: string,
  axisUsed: SingleAxis = 'z'
): SpectrumMeasurement | null {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const pairs: { f: number; a: number }[] = [];

  for (const line of lines) {
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
  const amplitudesMs2: number[] = [];

  if (pairs[0].f > df * 0.5) {
    frequenciesHz.push(0);
    amplitudesMs2.push(0);
  }
  for (const p of pairs) {
    frequenciesHz.push(p.f);
    amplitudesMs2.push(p.a);
  }

  const fLast = pairs[pairs.length - 1].f;
  const lastBinIndex = Math.round(fLast / df);
  const nextPow2 = Math.pow(2, Math.ceil(Math.log2(Math.max(2, lastBinIndex + 1))));
  const nyquistHz = Math.abs(lastBinIndex + 1 - nextPow2) <= 1 ? nextPow2 * df : fLast;
  const sampleRateHz = 2 * nyquistHz;
  const resolutionHz = df;
  const periodSec = 1 / df;
  const samplesUsed = Math.max(pairs.length * 2, Math.round(sampleRateHz / df));

  return {
    frequenciesHz,
    amplitudesMs2,
    amplitudesAU: amplitudesMs2,
    liveAmplitudesAU: amplitudesMs2,
    sampleRateHz,
    nyquistHz,
    resolutionHz,
    periodSec,
    samplesUsed,
    fftSize: samplesUsed,
    sensorSource: 'Phyphox CSV',
    axisUsed,
    frameCount: 1,
    quality: {
      actualSampleRateHz: sampleRateHz,
      medianDtMs: 1000 / sampleRateHz,
      meanDtMs: 1000 / sampleRateHz,
      minDtMs: 1000 / sampleRateHz,
      maxDtMs: 1000 / sampleRateHz,
      jitterCv: 0,
      droppedSamplesEstimate: 0,
      irregularIntervalFraction: 0,
      hasIrregularSampling: false,
      isStalled: false,
      isNoisyOrUnstable: false,
      snrRatio: 10,
      peakStabilityCv: 0,
    },
  };
}
