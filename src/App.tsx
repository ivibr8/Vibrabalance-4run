import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  BalancingCalculationResult,
  BalancingConfig,
  PeakHoldSpectrum,
  RunData,
  RunType,
  SensorAxis,
  VibrationSample,
} from './types/balancing';
import { computeLiveSpectrumFrame, updatePeakHoldSpectrum } from './utils/fft';
import { solveFourRunNoPhase } from './utils/balancingSolver';
import { SensorManager } from './services/sensorManager';
import { MethodologyScreen } from './components/MethodologyScreen';
import { DataCollectionScreen } from './components/DataCollectionScreen';
import { PolarPlotScreen } from './components/PolarPlotScreen';
import { InstallModal } from './components/InstallModal';
import { Compass, Smartphone } from 'lucide-react';

// Calibrated 1 oz example: O=3.75, O+T1=3.38@0°, O+T2=3.86@120°, O+T3=6.80@240° -> ~1.18 oz
const INITIAL_CONFIG: BalancingConfig = {
  trialMass: 1.0,
  massUnit: 'oz',
  nominalRpm: 1800,
  rotationDirection: 'CW',
  t1AngleDeg: 0,
  t2AngleDeg: 120,
  t3AngleDeg: 240,
  sensorAxis: 'z',
};

const INITIAL_RUNS: RunData[] = [
  {
    type: 'O',
    title: 'Run "O" - Baseline Unbalance',
    subtitle: 'Machine as-is unbalance without trial weight.',
    phaseAngleDeg: 0,
    amplitudeMils: 3.75,
    frequencyHz: 30.0,
    runningRpm: 1800,
    isKept: true,
    measuredAt: 'Baseline',
  },
  {
    type: 'O+T1',
    title: 'Run "O+T1" - Trial Weight at Phase 1',
    subtitle: 'Trial weight mounted at Phase 1 reference position.',
    phaseAngleDeg: 0,
    amplitudeMils: 3.38,
    frequencyHz: 30.0,
    runningRpm: 1800,
    isKept: true,
    measuredAt: 'Trial #1',
  },
  {
    type: 'O+T2',
    title: 'Run "O+T2" - Trial Weight at Phase 2',
    subtitle: 'Trial weight mounted at Phase 2 position.',
    phaseAngleDeg: 120,
    amplitudeMils: 3.86,
    frequencyHz: 30.0,
    runningRpm: 1800,
    isKept: true,
    measuredAt: 'Trial #2',
  },
  {
    type: 'O+T3',
    title: 'Run "O+T3" - Trial Weight at Phase 3',
    subtitle: 'Trial weight mounted at Phase 3 position.',
    phaseAngleDeg: 240,
    amplitudeMils: 6.8,
    frequencyHz: 30.0,
    runningRpm: 1800,
    isKept: true,
    measuredAt: 'Trial #3',
  },
];

const BLANK_RUNS = (cfg: BalancingConfig): RunData[] => [
  {
    type: 'O',
    title: 'Run "O" - Baseline Unbalance',
    subtitle: 'Run machine as-is without trial weights.',
    phaseAngleDeg: 0,
    amplitudeMils: 0,
    frequencyHz: 0,
    runningRpm: 0,
    isKept: false,
  },
  {
    type: 'O+T1',
    title: 'Run "O+T1" - Trial Weight at Phase 1',
    subtitle: `Trial weight (${cfg.trialMass} ${cfg.massUnit}) mounted at Phase 1.`,
    phaseAngleDeg: cfg.t1AngleDeg,
    amplitudeMils: 0,
    frequencyHz: 0,
    runningRpm: 0,
    isKept: false,
  },
  {
    type: 'O+T2',
    title: 'Run "O+T2" - Trial Weight at Phase 2',
    subtitle: `Trial weight (${cfg.trialMass} ${cfg.massUnit}) mounted at Phase 2.`,
    phaseAngleDeg: cfg.t2AngleDeg,
    amplitudeMils: 0,
    frequencyHz: 0,
    runningRpm: 0,
    isKept: false,
  },
  {
    type: 'O+T3',
    title: 'Run "O+T3" - Trial Weight at Phase 3',
    subtitle: `Trial weight (${cfg.trialMass} ${cfg.massUnit}) mounted at Phase 3.`,
    phaseAngleDeg: cfg.t3AngleDeg,
    amplitudeMils: 0,
    frequencyHz: 0,
    runningRpm: 0,
    isKept: false,
  },
];

export default function App() {
  // 0: Setup, 1..4: Runs O..O+T3, 5: Polar Plot & Solution
  const [currentScreen, setCurrentScreen] = useState<number>(5);
  const [config, setConfig] = useState<BalancingConfig>(INITIAL_CONFIG);
  const [runs, setRuns] = useState<RunData[]>(INITIAL_RUNS);
  const [lockedAxis, setLockedAxis] = useState<SensorAxis | null>(null);

  const [isSimulatorMode, setIsSimulatorMode] = useState<boolean>(false);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [peakHoldByRun, setPeakHoldByRun] = useState<{
    [key in RunType]?: PeakHoldSpectrum | null;
  }>({});
  const [lastSampleRate, setLastSampleRate] = useState<number>(60);
  const [isInstallModalOpen, setIsInstallModalOpen] = useState<boolean>(false);

  const sensorManagerRef = useRef<SensorManager | null>(null);
  const activeAxisRef = useRef<SensorAxis>(config.sensorAxis);
  const activeRunRef = useRef<RunType>('O');
  const isStreamingRef = useRef<boolean>(false);

  useEffect(() => {
    activeAxisRef.current = lockedAxis ?? config.sensorAxis;
  }, [lockedAxis, config.sensorAxis]);

  useEffect(() => {
    if (currentScreen >= 1 && currentScreen <= 4) {
      activeRunRef.current = runs[currentScreen - 1].type;
    }
  }, [currentScreen, runs]);

  useEffect(() => {
    sensorManagerRef.current = new SensorManager({
      onSamplesBuffer: (samples: VibrationSample[], sourceLabel: string) => {
        if (!isStreamingRef.current) return;
        const frame = computeLiveSpectrumFrame(
          samples,
          activeAxisRef.current,
          sourceLabel
        );
        if (frame) {
          const runType = activeRunRef.current;
          setLastSampleRate(Math.round(frame.sampleRateHz));
          setPeakHoldByRun((prev) => ({
            ...prev,
            [runType]: updatePeakHoldSpectrum(prev[runType] || null, frame),
          }));
        }
      },
      onStatusChange: (status, message) => {
        if (status === 'streaming') {
          isStreamingRef.current = true;
          setIsStreaming(true);
        } else if (status === 'error' && message) {
          isStreamingRef.current = false;
          setStreamError(message);
          setIsStreaming(false);
        } else if (status === 'idle') {
          isStreamingRef.current = false;
          setIsStreaming(false);
        }
      },
    });

    return () => {
      isStreamingRef.current = false;
      sensorManagerRef.current?.stopLiveStream();
    };
  }, []);

  const solution = useMemo<BalancingCalculationResult>(() => {
    return solveFourRunNoPhase(runs, config);
  }, [runs, config]);

  const stopLiveStream = () => {
    isStreamingRef.current = false;
    sensorManagerRef.current?.stopLiveStream();
    setIsStreaming(false);
  };

  const navigateToScreen = (screenId: number) => {
    if (isStreaming) stopLiveStream();
    setStreamError(null);
    setCurrentScreen(screenId);
  };

  const handleStartLiveStream = async (runType: RunType) => {
    const mgr = sensorManagerRef.current;
    if (!mgr) return;

    setStreamError(null);
    activeRunRef.current = runType;

    // Must be called directly inside user tap handler on iOS Safari
    if (!isSimulatorMode && mgr.isPermissionRequired()) {
      const granted = await mgr.requestPermission();
      if (!granted) return;
    }

    isStreamingRef.current = true;
    setIsStreaming(true);
    mgr.startLiveStream(
      isSimulatorMode ? { runType, baseRpm: config.nominalRpm } : undefined
    );
  };

  const handleClearPeakHold = (runType: RunType) => {
    sensorManagerRef.current?.clearSamples();
    setPeakHoldByRun((prev) => ({ ...prev, [runType]: null }));
  };

  const handleKeepMeasurement = (
    runType: RunType,
    ampAU: number,
    frequencyHz: number
  ) => {
    stopLiveStream();
    const axisToLock = lockedAxis ?? config.sensorAxis;
    setLockedAxis(axisToLock);

    setRuns((prev) =>
      prev.map((r) =>
        r.type === runType
          ? {
              ...r,
              amplitudeMils: Math.round(ampAU * 1000) / 1000,
              frequencyHz: Math.round(frequencyHz * 100) / 100,
              runningRpm: Math.round(frequencyHz * 60),
              isKept: true,
              measuredAt: new Date().toLocaleTimeString(),
            }
          : r
      )
    );
  };

  const handleUpdateManualAmp = (runType: RunType, ampAU: number) => {
    setRuns((prev) =>
      prev.map((r) =>
        r.type === runType
          ? {
              ...r,
              amplitudeMils: ampAU,
              frequencyHz: r.frequencyHz || config.nominalRpm / 60,
              runningRpm: r.runningRpm || config.nominalRpm,
              isKept: ampAU > 0,
            }
          : r
      )
    );
  };

  const handleUpdatePhaseAngle = (
    runType: 'O+T1' | 'O+T2' | 'O+T3',
    deg: number
  ) => {
    setRuns((prev) =>
      prev.map((r) => (r.type === runType ? { ...r, phaseAngleDeg: deg } : r))
    );
    if (runType === 'O+T1') setConfig((c) => ({ ...c, t1AngleDeg: deg }));
    if (runType === 'O+T2') setConfig((c) => ({ ...c, t2AngleDeg: deg }));
    if (runType === 'O+T3') setConfig((c) => ({ ...c, t3AngleDeg: deg }));
  };

  const handleUpdateAxis = (newAxis: SensorAxis) => {
    if (lockedAxis !== null) return;
    setConfig((prev) => ({ ...prev, sensorAxis: newAxis }));
  };

  const handleStartFreshProcedure = () => {
    stopLiveStream();
    setLockedAxis(null);
    setPeakHoldByRun({});
    setStreamError(null);
    setRuns(BLANK_RUNS(config));
    setCurrentScreen(1);
  };

  const handleResetBalancing = () => {
    stopLiveStream();
    setLockedAxis(null);
    setPeakHoldByRun({});
    setStreamError(null);
    setRuns(BLANK_RUNS(INITIAL_CONFIG));
    setConfig(INITIAL_CONFIG);
    setCurrentScreen(0);
  };

  const handleReloadUserExample = () => {
    stopLiveStream();
    setLockedAxis(null);
    setPeakHoldByRun({});
    setStreamError(null);
    setRuns(INITIAL_RUNS);
    setConfig(INITIAL_CONFIG);
    setCurrentScreen(5);
  };

  const screenSteps = [
    { id: 0, label: 'Setup' },
    { id: 1, label: 'Run O' },
    { id: 2, label: 'O+T1' },
    { id: 3, label: 'O+T2' },
    { id: 4, label: 'O+T3' },
    { id: 5, label: 'Polar Plot' },
  ];

  return (
    <div className="min-h-screen bg-slate-300/80 text-slate-900 flex flex-col font-sans">
      {/* Top Bar */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-300 shadow-xs px-4 md:px-8 py-3 flex items-center justify-between gap-6 shrink-0">
        <button
          type="button"
          onClick={() => navigateToScreen(0)}
          className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer"
        >
          <Compass className="w-5 h-5 text-cyan-600 shrink-0" />
          <span>VibraBalance 4-Run</span>
        </button>

        <nav className="hidden md:flex items-center gap-5 text-xs font-medium text-slate-600">
          {screenSteps.map((s) => {
            const isActive = currentScreen === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => navigateToScreen(s.id)}
                className={`whitespace-nowrap shrink-0 py-1 cursor-pointer transition-colors ${
                  isActive
                    ? 'text-slate-900 font-bold border-b-2 border-cyan-600'
                    : 'hover:text-slate-900 hover:underline'
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={handleReloadUserExample}
          className="px-3.5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          Load Example
        </button>
      </header>

      {/* Mobile Compact Step Switcher */}
      <div className="md:hidden bg-white border-b border-slate-300 px-4 py-2 flex items-center justify-between text-xs font-mono">
        <span className="text-slate-700 font-semibold">
          {screenSteps[currentScreen].label} ({currentScreen + 1}/6)
        </span>
        <div className="flex items-center gap-1.5">
          {screenSteps.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => navigateToScreen(s.id)}
              className={`w-7 h-7 rounded-lg text-[11px] font-bold flex items-center justify-center transition-colors ${
                currentScreen === s.id
                  ? 'bg-slate-900 text-white'
                  : s.id > 0 && runs[s.id - 1]?.isKept
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-slate-200 text-slate-700'
              }`}
            >
              {s.id + 1}
            </button>
          ))}
        </div>
      </div>

      {/* Unboxed Summary Strip */}
      <div className="bg-slate-200 border-b border-slate-300 px-4 md:px-8 py-2 flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-slate-700">
        <div>
          O: <strong className="text-slate-900">{runs[0].amplitudeMils}</strong>
          {' · '}O+T1: <strong className="text-slate-900">{runs[1].amplitudeMils}</strong>
          {' · '}O+T2: <strong className="text-slate-900">{runs[2].amplitudeMils}</strong>
          {' · '}O+T3: <strong className="text-slate-900">{runs[3].amplitudeMils}</strong>
          {' · '}Axis:{' '}
          <strong className="text-slate-900">
            {(lockedAxis ?? config.sensorAxis).toUpperCase()}
          </strong>
        </div>

        {solution.isValid && (
          <button
            type="button"
            onClick={() => navigateToScreen(5)}
            className="text-emerald-700 font-bold hover:underline cursor-pointer"
          >
            Solution: {solution.correctionWeight} {config.massUnit} @ {solution.correctionAngleDeg}°
          </button>
        )}
      </div>

      {/* Main Content */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-4 md:p-6">
        {currentScreen === 0 && (
          <MethodologyScreen
            config={config}
            isAxisLocked={lockedAxis !== null}
            lockedAxis={lockedAxis}
            onUpdateConfig={setConfig}
            onStartProcedure={() => navigateToScreen(1)}
            onStartFreshProcedure={handleStartFreshProcedure}
            onLoadDemoData={handleReloadUserExample}
            isSimulatorMode={isSimulatorMode}
            onToggleSimulator={setIsSimulatorMode}
          />
        )}

        {currentScreen >= 1 &&
          currentScreen <= 4 &&
          (() => {
            const runIdx = currentScreen - 1;
            const currentRun = runs[runIdx];
            return (
              <DataCollectionScreen
                key={currentRun.type}
                run={currentRun}
                runIndex={runIdx}
                config={{ ...config, sensorAxis: lockedAxis ?? config.sensorAxis }}
                isAxisLocked={lockedAxis !== null}
                isStreaming={isStreaming}
                peakHold={peakHoldByRun[currentRun.type] || null}
                streamError={streamError}
                isSimulatorMode={isSimulatorMode}
                onStartLiveStream={() => handleStartLiveStream(currentRun.type)}
                onStopLiveStream={stopLiveStream}
                onClearPeakHold={() => handleClearPeakHold(currentRun.type)}
                onKeepMeasurement={(ampAU, freqHz) =>
                  handleKeepMeasurement(currentRun.type, ampAU, freqHz)
                }
                onUpdateManualAmp={(ampAU) =>
                  handleUpdateManualAmp(currentRun.type, ampAU)
                }
                onUpdatePhaseAngle={(deg) =>
                  handleUpdatePhaseAngle(
                    currentRun.type as 'O+T1' | 'O+T2' | 'O+T3',
                    deg
                  )
                }
                onUpdateAxis={handleUpdateAxis}
                onNextScreen={() => navigateToScreen(currentScreen + 1)}
                onPrevScreen={() => navigateToScreen(currentScreen - 1)}
              />
            );
          })()}

        {/* Screen 5: Polar Plot & Solution (kept untouched) */}
        {currentScreen === 5 && (
          <PolarPlotScreen
            solution={solution}
            config={config}
            runs={runs}
            onBackToRuns={() => navigateToScreen(4)}
            onResetBalancing={handleResetBalancing}
          />
        )}
      </main>

      {/* Clean Footer */}
      <footer className="border-t border-slate-300 bg-white px-6 py-3.5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-600 shrink-0">
        <span>VibraBalance 4-Run · Peak-Hold Smartphone FFT Balancing (AU)</span>
        <button
          type="button"
          onClick={() => setIsInstallModalOpen(true)}
          className="text-cyan-700 hover:text-cyan-800 font-semibold flex items-center gap-1.5 cursor-pointer hover:underline"
        >
          <Smartphone className="w-3.5 h-3.5" />
          <span>Phone Link &amp; QR Code</span>
        </button>
      </footer>

      <InstallModal
        isOpen={isInstallModalOpen}
        onClose={() => setIsInstallModalOpen(false)}
        maxPhoneSampleRate={lastSampleRate}
      />
    </div>
  );
}
