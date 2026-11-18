import { SingleAxis, VibrationSample } from '../types/balancing';

export interface StreamDiagnostics {
  isStalled: boolean;
  streamElapsedMs: number;
  lastSampleAgeMs: number;
  noSamplesTimeout: boolean;
}

export interface LiveSensorCallbacks {
  onSamplesBuffer?: (
    samples: VibrationSample[],
    sourceLabel: string,
    diagnostics?: StreamDiagnostics
  ) => void;
  onStatusChange?: (
    status: 'idle' | 'streaming' | 'error',
    message?: string
  ) => void;
}

export interface StartStreamOptions {
  axis?: SingleAxis;
  simulationConfig?: {
    runType: 'O' | 'O+T1' | 'O+T2' | 'O+T3';
    baseRpm: number;
  };
}

const MAX_BUFFER_SAMPLES = 4608; // Comfortably holds up to 4096-sample rolling FFT windows
const NO_SAMPLES_TIMEOUT_MS = 2200;
const STALL_GAP_MS = 1200;

export class SensorManager {
  private isStreaming = false;
  private callbacks: LiveSensorCallbacks = {};
  private samples: VibrationSample[] = [];
  private activeSource = 'DeviceMotion';
  private motionHandler: ((event: DeviceMotionEvent) => void) | null = null;
  private genericSensor: { stop: () => void } | null = null;
  private emitTimer: number | null = null;
  private probeTimer: number | null = null;
  private simTimer: number | null = null;
  private streamStartMs = 0;
  private lastSamplePerfMs = 0;

  constructor(callbacks: LiveSensorCallbacks = {}) {
    this.callbacks = callbacks;
  }

  public getActiveSource(): string {
    return this.activeSource;
  }

  public isSensorSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      ('DeviceMotionEvent' in window || 'Accelerometer' in window)
    );
  }

  public isPermissionRequired(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof DeviceMotionEvent !== 'undefined' &&
      typeof (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> })
        .requestPermission === 'function'
    );
  }

  /**
   * Must be invoked directly inside a user tap/click handler on iOS Safari.
   */
  public async requestPermission(): Promise<boolean> {
    if (!this.isPermissionRequired()) return true;
    try {
      const reqFn = (
        DeviceMotionEvent as unknown as { requestPermission: () => Promise<string> }
      ).requestPermission;
      const res = await reqFn();
      if (res === 'granted') {
        return true;
      }
      this.callbacks.onStatusChange?.(
        'error',
        'Motion sensor permission was denied in iOS Safari Settings.'
      );
      return false;
    } catch (err) {
      this.callbacks.onStatusChange?.(
        'error',
        `Motion sensor permission error: ${
          err instanceof Error ? err.message : 'Ensure HTTPS and tap Start again.'
        }`
      );
      return false;
    }
  }

  /**
   * Starts real-time single-axis accelerometer streaming into a rolling buffer and emits
   * snapshots every 100 ms.
   *
   * Acquires exclusively from the selected accelerometer axis (`axis`).
   * Requests the highest practical sampling rate supported by the browser/OS and briefly
   * probes DeviceMotionEvent vs Generic Sensor Accelerometer API for 550 ms, selecting
   * whichever yields more actual samples. Never assumes a fixed sampling rate.
   */
  public startLiveStream(options?: StartStreamOptions): void {
    this.cleanupHardware();

    this.samples = [];
    this.isStreaming = true;
    this.streamStartMs = performance.now();
    this.lastSamplePerfMs = 0;

    const selectedAxis: SingleAxis = options?.axis ?? 'z';

    if (options?.simulationConfig) {
      this.activeSource = 'Simulator (411 Hz)';
      this.callbacks.onStatusChange?.('streaming');
      this.startSimulator(
        options.simulationConfig.runType,
        options.simulationConfig.baseRpm,
        selectedAxis
      );
      return;
    }

    if (!this.isSensorSupported()) {
      this.isStreaming = false;
      this.callbacks.onStatusChange?.(
        'error',
        'No hardware accelerometer detected in this browser. Open on an Android/iOS smartphone over HTTPS.'
      );
      return;
    }

    this.callbacks.onStatusChange?.('streaming');

    const dmBuffer: VibrationSample[] = [];
    const accelBuffer: VibrationSample[] = [];
    let settled = false;
    let lastDmTs = 0;
    let lastAccelTs = 0;

    const makeSingleAxisSample = (
      timestamp: number,
      value: number
    ): VibrationSample => ({
      timestamp,
      x: selectedAxis === 'x' ? value : 0,
      y: selectedAxis === 'y' ? value : 0,
      z: selectedAxis === 'z' ? value : 0,
      magnitude: 0, // Single-axis only: never compute 3-axis vector magnitude
    });

    const pushSample = (sample: VibrationSample) => {
      this.samples.push(sample);
      if (this.samples.length > MAX_BUFFER_SAMPLES) {
        this.samples.splice(0, this.samples.length - MAX_BUFFER_SAMPLES);
      }
      this.lastSamplePerfMs = performance.now();
    };

    const motionListener = (event: DeviceMotionEvent) => {
      if (!this.isStreaming) return;
      const raw = event.accelerationIncludingGravity;
      const lin = event.acceleration;
      // Prefer raw accelerationIncludingGravity so OS high-pass filtering does not distort low-Hz balancing bands;
      // static DC/gravity offset is subtracted cleanly in FFT processing.
      const acc =
        raw && typeof raw[selectedAxis] === 'number'
          ? raw
          : lin && typeof lin[selectedAxis] === 'number'
          ? lin
          : null;
      if (!acc) return;

      const rawVal = acc[selectedAxis];
      if (typeof rawVal !== 'number' || !Number.isFinite(rawVal)) return;

      const perfNow = performance.now();
      const evTs = event.timeStamp;
      const useEvTs =
        typeof evTs === 'number' &&
        Number.isFinite(evTs) &&
        evTs > lastDmTs &&
        Math.abs(evTs - perfNow) < 2000;
      const ts = useEvTs ? evTs : perfNow > lastDmTs ? perfNow : lastDmTs + 0.01;
      lastDmTs = ts;

      const sample = makeSingleAxisSample(ts, rawVal);

      if (!settled) {
        dmBuffer.push(sample);
        pushSample(sample);
      } else {
        pushSample(sample);
      }
    };

    this.motionHandler = motionListener;
    this.activeSource = 'DeviceMotion';
    window.addEventListener('devicemotion', motionListener, { passive: true });

    const hasGeneric = typeof window !== 'undefined' && 'Accelerometer' in window;
    type GenericAccel = {
      x: number | null;
      y: number | null;
      z: number | null;
      timestamp?: number | null;
      start: () => void;
      stop: () => void;
      addEventListener: (type: string, cb: () => void) => void;
    };
    let accelSensor: GenericAccel | null = null;

    if (hasGeneric) {
      try {
        type AccelCtor = new (opts?: { frequency?: number }) => GenericAccel;
        const Ctor = (window as unknown as { Accelerometer: AccelCtor }).Accelerometer;

        // Request highest practical rate without assuming a fixed hardware rate
        const rateCandidates = [1000, 500, 400, 200];
        for (const freq of rateCandidates) {
          try {
            accelSensor = new Ctor({ frequency: freq });
            break;
          } catch {
            accelSensor = null;
          }
        }
        if (!accelSensor) {
          accelSensor = new Ctor();
        }

        accelSensor.addEventListener('reading', () => {
          if (!this.isStreaming || !accelSensor) return;
          const rawVal = accelSensor[selectedAxis];
          if (typeof rawVal !== 'number' || !Number.isFinite(rawVal)) return;

          const perfNow = performance.now();
          const hwTs = accelSensor.timestamp;
          const useHwTs =
            typeof hwTs === 'number' &&
            Number.isFinite(hwTs) &&
            hwTs > lastAccelTs &&
            Math.abs(hwTs - perfNow) < 10000;
          const now = useHwTs ? hwTs : perfNow > lastAccelTs ? perfNow : lastAccelTs + 0.01;
          lastAccelTs = now;

          const sample = makeSingleAxisSample(now, rawVal);

          if (!settled) {
            accelBuffer.push(sample);
            this.lastSamplePerfMs = perfNow;
          } else {
            pushSample(sample);
          }
        });

        accelSensor.addEventListener('error', () => {
          try {
            accelSensor?.stop();
          } catch {
            // ignore
          }
          if (this.genericSensor === accelSensor) {
            this.genericSensor = null;
          }
        });

        accelSensor.start();
        this.genericSensor = accelSensor;
      } catch {
        accelSensor = null;
      }
    } else {
      settled = true;
    }

    // Decide fastest actual stream after 550 ms probe
    if (!settled) {
      this.probeTimer = window.setTimeout(() => {
        if (!this.isStreaming) return;
        settled = true;

        if (accelBuffer.length >= dmBuffer.length * 0.9 && accelBuffer.length >= 6) {
          if (this.motionHandler) {
            window.removeEventListener('devicemotion', this.motionHandler);
            this.motionHandler = null;
          }
          this.activeSource = 'Accelerometer API';
          this.samples = accelBuffer.slice(-MAX_BUFFER_SAMPLES);
        } else {
          if (this.genericSensor) {
            try {
              this.genericSensor.stop();
            } catch {
              // ignore
            }
            this.genericSensor = null;
          }
          this.activeSource = 'DeviceMotion';
        }
      }, 550);
    }

    this.emitTimer = window.setInterval(() => {
      if (!this.isStreaming) return;
      const now = performance.now();
      const elapsedMs = now - this.streamStartMs;
      const lastSampleAgeMs =
        this.lastSamplePerfMs > 0 ? now - this.lastSamplePerfMs : elapsedMs;
      const noSamplesTimeout =
        this.samples.length === 0 && elapsedMs > NO_SAMPLES_TIMEOUT_MS;
      const isStalled =
        noSamplesTimeout ||
        (this.samples.length > 0 && lastSampleAgeMs > STALL_GAP_MS);

      this.callbacks.onSamplesBuffer?.([...this.samples], this.activeSource, {
        isStalled,
        streamElapsedMs: elapsedMs,
        lastSampleAgeMs,
        noSamplesTimeout,
      });
    }, 100);
  }

  private cleanupHardware(): void {
    this.isStreaming = false;
    if (this.probeTimer !== null) {
      window.clearTimeout(this.probeTimer);
      this.probeTimer = null;
    }
    if (this.emitTimer !== null) {
      window.clearInterval(this.emitTimer);
      this.emitTimer = null;
    }
    if (this.simTimer !== null) {
      window.clearInterval(this.simTimer);
      this.simTimer = null;
    }
    if (this.motionHandler) {
      window.removeEventListener('devicemotion', this.motionHandler);
      this.motionHandler = null;
    }
    if (this.genericSensor) {
      try {
        this.genericSensor.stop();
      } catch {
        // ignore
      }
      this.genericSensor = null;
    }
  }

  public stopLiveStream(): void {
    this.cleanupHardware();
    this.callbacks.onStatusChange?.('idle');
  }

  public clearSamples(): void {
    this.samples = [];
    this.lastSamplePerfMs = 0;
  }

  /**
   * Optional desktop-testing generator (only invoked if Simulator Mode is explicitly enabled on Setup).
   */
  private startSimulator(
    runType: 'O' | 'O+T1' | 'O+T2' | 'O+T3',
    baseRpm: number,
    selectedAxis: SingleAxis
  ): void {
    const f1X = baseRpm > 0 ? baseRpm / 60 : 43;
    const fs = 411;
    const dtMs = 1000 / fs;
    const targetAmpMap = {
      'O': 3.75,
      'O+T1': 3.38,
      'O+T2': 3.86,
      'O+T3': 6.8,
    };
    const amp = targetAmpMap[runType];
    const startMs = performance.now();
    let sampleIdx = 0;

    this.simTimer = window.setInterval(() => {
      if (!this.isStreaming) return;
      const elapsedMs = performance.now() - startMs;
      const targetIdx = Math.floor(elapsedMs / dtMs);

      while (sampleIdx < targetIdx) {
        const tSec = (sampleIdx * dtMs) / 1000;
        const angle = 2 * Math.PI * f1X * tSec;
        const sig =
          amp * Math.sin(angle) +
          amp * 0.14 * Math.sin(2 * angle + 0.4) +
          (Math.random() - 0.5) * amp * 0.05;

        const val = (selectedAxis === 'z' ? 9.81 : 0) + sig;
        this.samples.push({
          timestamp: startMs + sampleIdx * dtMs,
          x: selectedAxis === 'x' ? val : 0,
          y: selectedAxis === 'y' ? val : 0,
          z: selectedAxis === 'z' ? val : 0,
          magnitude: 0,
        });
        if (this.samples.length > MAX_BUFFER_SAMPLES) {
          this.samples.shift();
        }
        this.lastSamplePerfMs = performance.now();
        sampleIdx++;
      }

      this.callbacks.onSamplesBuffer?.([...this.samples], this.activeSource, {
        isStalled: false,
        streamElapsedMs: elapsedMs,
        lastSampleAgeMs: 0,
        noSamplesTimeout: false,
      });
    }, 100);
  }
}
