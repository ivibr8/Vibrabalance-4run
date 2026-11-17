export type SensorAxis = 'x' | 'y' | 'z' | 'triaxial';

export interface VibrationSample {
  timestamp: number; // performance.now() millisecond timestamp
  x: number; // m/s^2 (Left <-> Right)
  y: number; // m/s^2 (Bottom <-> Top)
  z: number; // m/s^2 (Back <-> Front / Through Screen)
  magnitude: number;
}

export interface LiveSpectrumFrame {
  frequenciesHz: number[];
  amplitudesAU: number[];
  sampleRateHz: number;
  nyquistHz: number;
  resolutionHz: number;
  periodSec: number;
  fftSize: number;
  windowSamples: number;
  sensorSource: string;
  axisUsed: SensorAxis;
  updatedAt: number;
}

export interface SpectrumMeasurement {
  frequenciesHz: number[]; // Fine FFT display frequency bins (0 .. nyquistHz)
  amplitudesAU: number[]; // Steady low-variance averaged FFT magnitude (AU)
  liveAmplitudesAU: number[]; // Most recent FFT frame (AU)
  sampleRateHz: number; // Acquisition rate (Hz)
  nyquistHz: number; // Nyquist frequency (Hz)
  resolutionHz: number; // True spectral resolution df = 1 / periodSec (Hz)
  periodSec: number; // Exact time window of the N samples used (s)
  samplesUsed: number; // Real accelerometer samples used in window (e.g. 128/256 at 60Hz, 1024 at 411Hz)
  fftSize: number; // Radix-2 FFT length (zero-padded to 1024 for smooth peak crest interpolation)
  sensorSource: string;
  axisUsed: SensorAxis;
  frameCount: number;
}

export interface BufferProgress {
  collected: number;
  target: number;
  estimatedRateHz: number | null;
  sensorSource: string;
}

export type RunType = 'O' | 'O+T1' | 'O+T2' | 'O+T3';

export interface RunData {
  type: RunType;
  title: string;
  subtitle: string;
  phaseAngleDeg: number; // phase location (0 for O, user defined for T1, T2, T3)
  amplitudeMils: number; // measured 1X magnitude in Arbitrary Units (or mils); solver uses ratios
  frequencyHz: number; // identified running speed frequency
  runningRpm: number;
  isKept: boolean;
  measuredAt?: string;
  notes?: string;
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
