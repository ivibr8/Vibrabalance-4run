export type SingleAxis = 'x' | 'y' | 'z';
export type SensorAxis = SingleAxis | 'triaxial';
export type FftSampleCount = 256 | 512 | 1024 | 2048 | 4096;

export interface VibrationSample {
  timestamp: number; // High-resolution millisecond timestamp (DOMHighResTimeStamp)
  x: number; // m/s^2 (Left <-> Right)
  y: number; // m/s^2 (Bottom <-> Top)
  z: number; // m/s^2 (Back <-> Front / Through Screen)
  magnitude: number;
}

export interface AcquisitionQuality {
  actualSampleRateHz: number;
  medianDtMs: number;
  meanDtMs: number;
  minDtMs: number;
  maxDtMs: number;
  jitterCv: number;
  droppedSamplesEstimate: number;
  irregularIntervalFraction: number;
  hasIrregularSampling: boolean;
  isStalled: boolean;
  isNoisyOrUnstable: boolean;
  snrRatio: number;
  peakStabilityCv: number;
}

export interface LiveSpectrumFrame {
  frequenciesHz: number[]; // Strictly 0 .. nyquistHz (N/2 + 1 bins)
  amplitudesMs2: number[]; // One-sided Hann-windowed FFT amplitude in m/s^2
  amplitudesAU: number[]; // Backward-compatible alias of amplitudesMs2
  sampleRateHz: number; // Actual measured sampling rate from timestamps (Hz)
  nyquistHz: number; // actualSampleRateHz / 2
  resolutionHz: number; // actualSampleRateHz / windowSamples (Hz)
  periodSec: number; // Measurement duration (seconds)
  fftSize: number; // Equals windowSamples (exact N-point real FFT)
  windowSamples: number;
  sensorSource: string;
  axisUsed: SingleAxis;
  updatedAt: number;
  quality: AcquisitionQuality;
}

export interface SpectrumMeasurement {
  frequenciesHz: number[]; // Exact FFT bins (0 .. nyquistHz)
  amplitudesMs2: number[]; // One-sided amplitude spectrum (m/s^2)
  amplitudesAU: number[]; // Alias kept for compatibility
  liveAmplitudesAU: number[]; // Most recent N-sample FFT frame (m/s^2)
  sampleRateHz: number; // Actual measured acquisition rate (Hz)
  nyquistHz: number; // Nyquist frequency = sampleRateHz / 2 (Hz)
  resolutionHz: number; // Frequency resolution = sampleRateHz / samplesUsed (Hz)
  periodSec: number; // Measurement duration (s)
  samplesUsed: number; // Configured FFT sample count (256, 512, 1024, 2048, 4096)
  fftSize: number; // FFT size (= samplesUsed)
  sensorSource: string;
  axisUsed: SingleAxis;
  frameCount: number;
  quality: AcquisitionQuality;
}

export interface BufferProgress {
  collected: number;
  target: number;
  estimatedRateHz: number | null;
  elapsedSec: number;
  isStalled: boolean;
  irregularDuringFill: boolean;
  droppedDuringFill: number;
  sensorSource: string;
}

export type RunType = 'O' | 'O+T1' | 'O+T2' | 'O+T3';

export interface RunData {
  type: RunType;
  title: string;
  subtitle: string;
  phaseAngleDeg: number; // phase location (0 for O, user defined for T1, T2, T3)
  amplitudeMils: number; // measured 1X magnitude (solver uses relative ratios)
  frequencyHz: number; // identified running speed frequency
  runningRpm: number;
  isKept: boolean;
  measuredAt?: string;
  notes?: string;
  axisUsed?: SingleAxis;
  fftSampleCountUsed?: FftSampleCount;
  sampleRateUsedHz?: number;
}

export interface BalancingConfig {
  trialMass: number; // mass value
  massUnit: 'g' | 'oz';
  nominalRpm: number;
  rotationDirection: 'CW' | 'CCW';
  t1AngleDeg: number;
  t2AngleDeg: number;
  t3AngleDeg: number;
  sensorAxis: SensorAxis;
}

export interface PolarIntersectionPoint {
  x: number;
  y: number;
  distance: number;
  angleDeg: number;
}

export interface BalancingCalculationResult {
  isValid: boolean;
  errorMessage?: string;
  o: number;
  ot1: number;
  ot2: number;
  ot3: number;
  t1Angle: number;
  t2Angle: number;
  t3Angle: number;
  trialEffectT: number;
  calibrationFactor: number;
  intersection: PolarIntersectionPoint;
  correctionWeight: number;
  correctionAngleDeg: number;
  trimWeight?: number;
  trimAngleDeg?: number;
  oCircleRadius: number;
  t1Location: { x: number; y: number; r: number };
  t2Location: { x: number; y: number; r: number };
  t3Location: { x: number; y: number; r: number };
}
