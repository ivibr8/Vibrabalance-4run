import { VibrationSample } from '../types/balancing';

export interface LiveSensorCallbacks {
  onSamplesBuffer?: (samples: VibrationSample[], sourceLabel: string) => void;
  onStatusChange?: (
    status: 'idle' | 'streaming' | 'error',
    message?: string
  ) => void;
}

const MAX_BUFFER_SAMPLES = 1280; // Keeps last 1024+ samples for rolling real-time FFT

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
   * Starts real-time accelerometer streaming into a rolling ring buffer and emits
   * periodic buffer snapshots (~10 Hz UI update cadence) for live FFT rendering.
   *
   * On Android Chrome where Generic Sensor Accelerometer API exists, briefly probes
   * both DeviceMotionEvent and Accelerometer({ frequency: 400 }) for 500ms and
   * automatically keeps whichever delivers the higher real sample rate.
   */
  public startLiveStream(simulationConfig?: {
    runType: 'O' | 'O+T1' | 'O+T2' | 'O+T3';
    baseRpm: number;
  }): void {
    this.stopLiveStream();

    this.samples = [];
    this.isStreaming = true;

    if (simulationConfig) {
      this.activeSource = 'Simulator (400 Hz)';
      this.callbacks.onStatusChange?.('streaming');
      this.startSimulator(simulationConfig.runType, simulationConfig.baseRpm);
      return;
    }

    if (!this.isSensorSupported()) {
      this.isStreaming = false;
      this.callbacks.onStatusChange?.(
        'error',
        'No hardware accelerometer detected in this browser. Open on an Android/iOS smartphone over HTTPS, or enable Simulator Mode on Setup.'
      );
      return;
    }

    this.callbacks.onStatusChange?.('streaming');

    // Separate probe buffers for the first 500ms so whichever API fires faster wins
    const dmBuffer: VibrationSample[] = [];
    const accelBuffer: VibrationSample[] = [];
    let settled = false;

    const pushSample = (x: number, y: number, z: number, now: number) => {
      this.samples.push({
        timestamp: now,
        x,
        y,
        z,
        magnitude: Math.hypot(x, y, z),
      });
      if (this.samples.length > MAX_BUFFER_SAMPLES) {
        this.samples.splice(0, this.samples.length - MAX_BUFFER_SAMPLES);
      }
    };

    const motionListener = (event: DeviceMotionEvent) => {
      if (!this.isStreaming) return;
      const raw = event.accelerationIncludingGravity;
      const lin = event.acceleration;
      const hasRaw =
        raw !== null &&
        raw !== undefined &&
        (typeof raw.x === 'number' || typeof raw.y === 'number' || typeof raw.z === 'number');
      const acc = hasRaw ? raw : lin;
      if (!acc) return;

      const sample: VibrationSample = {
        timestamp: performance.now(),
        x: typeof acc.x === 'number' ? acc.x : 0,
        y: typeof acc.y === 'number' ? acc.y : 0,
        z: typeof acc.z === 'number' ? acc.z : 0,
        magnitude: 0,
      };
      sample.magnitude = Math.hypot(sample.x, sample.y, sample.z);

      if (!settled) {
        dmBuffer.push(sample);
        // Feed main buffer from DeviceMotion right away until probe settles
        pushSample(sample.x, sample.y, sample.z, sample.timestamp);
      } else {
        pushSample(sample.x, sample.y, sample.z, sample.timestamp);
      }
    };

    this.motionHandler = motionListener;
    this.activeSource = 'DeviceMotion';
    window.addEventListener('devicemotion', motionListener, { passive: true });

    const hasGeneric = typeof window !== 'undefined' && 'Accelerometer' in window;
    let accelSensor: {
      x: number | null;
      y: number | null;
      z: number | null;
      start: () => void;
      stop: () => void;
      addEventListener: (type: string, cb: () => void) => void;
    } | null = null;

    if (hasGeneric) {
      try {
        type AccelCtor = new (opts?: { frequency?: number }) => {
          x: number | null;
          y: number | null;
          z: number | null;
          start: () => void;
          stop: () => void;
          addEventListener: (type: string, cb: () => void) => void;
        };
        const Ctor = (window as unknown as { Accelerometer: AccelCtor }).Accelerometer;
        accelSensor = new Ctor({ frequency: 400 });

        accelSensor.addEventListener('reading', () => {
          if (!this.isStreaming || !accelSensor) return;
          const now = performance.now();
          const x = accelSensor.x ?? 0;
          const y = accelSensor.y ?? 0;
          const z = accelSensor.z ?? 0;

          if (!settled) {
            accelBuffer.push({
              timestamp: now,
              x,
              y,
              z,
              magnitude: Math.hypot(x, y, z),
            });
          } else {
            pushSample(x, y, z, now);
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

    // Decide fastest stream at 550ms when Generic Sensor API is present
    if (!settled) {
      this.probeTimer = window.setTimeout(() => {
        if (!this.isStreaming) return;
        settled = true;

        if (accelBuffer.length > dmBuffer.length * 1.1 && accelBuffer.length >= 10) {
          // Generic Sensor Accelerometer API is faster on this browser -> switch cleanly
          if (this.motionHandler) {
            window.removeEventListener('devicemotion', this.motionHandler);
            this.motionHandler = null;
          }
          this.activeSource = 'Accelerometer API';
          this.samples = accelBuffer.slice(-MAX_BUFFER_SAMPLES);
        } else {
          // Keep DeviceMotionEvent and close Generic Sensor listener
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

    // Emit live buffer updates smoothly every 110ms (~9 FPS for responsive FFT updates)
    this.emitTimer = window.setInterval(() => {
      if (!this.isStreaming) return;
      this.callbacks.onSamplesBuffer?.([...this.samples], this.activeSource);
    }, 110);
  }

  public stopLiveStream(): void {
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
    this.callbacks.onStatusChange?.('idle');
  }

  public clearSamples(): void {
    this.samples = [];
  }

  /**
   * Desktop / offline test signal generator (active ONLY when user enables Simulator Mode).
   * Streams at 400 Hz (200 Hz full spectrum) with a 1X rotor unbalance peak at nominalRpm/60 Hz.
   */
  private startSimulator(
    runType: 'O' | 'O+T1' | 'O+T2' | 'O+T3',
    baseRpm: number
  ): void {
    const f1X = baseRpm > 0 ? baseRpm / 60 : 43;
    const fs = 400;
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
        // Realistic slight amplitude drift (~±4%) so watching 10s average is meaningful
        const modulation = 1 + 0.04 * Math.sin(tSec * 1.3);
        const sig =
          amp * modulation * Math.sin(angle) +
          amp * 0.14 * Math.sin(2 * angle + 0.4) +
          (Math.random() - 0.5) * amp * 0.06;

        const x = sig * 0.45;
        const y = sig * 0.25;
        const z = 9.81 + sig * 0.85;

        this.samples.push({
          timestamp: startMs + sampleIdx * dtMs,
          x,
          y,
          z,
          magnitude: Math.hypot(x, y, z),
        });
        if (this.samples.length > MAX_BUFFER_SAMPLES) {
          this.samples.shift();
        }
        sampleIdx++;
      }

      this.callbacks.onSamplesBuffer?.([...this.samples], this.activeSource);
    }, 100);
  }
}
