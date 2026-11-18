import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  BalancingConfig,
  BufferProgress,
  FftSampleCount,
  RunData,
  SensorAxis,
  SingleAxis,
  SpectrumMeasurement,
} from '../types/balancing';
import {
  FFT_SAMPLE_OPTIONS,
  MIN_VALID_SPECTRUM_HZ,
  computePeakPickReadout,
  parsePhyphoxCsv,
} from '../utils/fft';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Lock,
  Pause,
  Play,
  RotateCcw,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

interface NumericInputProps {
  id?: string;
  value: number;
  onChangeValue: (val: number) => void;
  allowDecimal?: boolean;
  min?: number;
  max?: number;
  fallbackOnEmpty?: number | null;
  placeholder?: string;
  className?: string;
}

const NumericInput: React.FC<NumericInputProps> = ({
  id,
  value,
  onChangeValue,
  allowDecimal = false,
  min,
  max,
  fallbackOnEmpty = null,
  placeholder,
  className,
}) => {
  const formatVal = (v: number) =>
    v === 0 && fallbackOnEmpty === null ? '' : String(v);

  const [draft, setDraft] = useState<string>(() => formatVal(value));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setDraft(formatVal(value));
    }
  }, [value, isFocused, fallbackOnEmpty]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const cleaned = allowDecimal
      ? raw.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')
      : raw.replace(/[^0-9]/g, '');
    setDraft(cleaned);

    if (cleaned === '' || cleaned === '.') {
      if (fallbackOnEmpty === null) {
        onChangeValue(0);
      }
      return;
    }

    const parsed = allowDecimal ? parseFloat(cleaned) : parseInt(cleaned, 10);
    if (Number.isFinite(parsed)) {
      onChangeValue(max !== undefined && parsed > max ? max : parsed);
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    if (draft === '' || draft === '.') {
      if (fallbackOnEmpty === null) {
        setDraft('');
        onChangeValue(0);
      } else {
        setDraft(String(fallbackOnEmpty));
        onChangeValue(fallbackOnEmpty);
      }
      return;
    }

    let parsed = allowDecimal ? parseFloat(draft) : parseInt(draft, 10);
    if (!Number.isFinite(parsed)) {
      const fb = fallbackOnEmpty ?? 0;
      setDraft(fallbackOnEmpty === null && fb === 0 ? '' : String(fb));
      onChangeValue(fb);
      return;
    }

    if (min !== undefined && parsed < min) parsed = min;
    if (max !== undefined && parsed > max) parsed = max;
    setDraft(parsed === 0 && fallbackOnEmpty === null ? '' : String(parsed));
    onChangeValue(parsed);
  };

  return (
    <input
      id={id}
      type="text"
      inputMode={allowDecimal ? 'decimal' : 'numeric'}
      value={draft}
      placeholder={placeholder}
      onFocus={() => setIsFocused(true)}
      onChange={handleChange}
      onBlur={handleBlur}
      className={className}
    />
  );
};

interface Props {
  run: RunData;
  runIndex: number;
  config: BalancingConfig;
  selectedSingleAxis: SingleAxis;
  isAxisLocked: boolean;
  fftSampleCount: FftSampleCount;
  isStreaming: boolean;
  spectrum: SpectrumMeasurement | null;
  bufferProgress: BufferProgress | null;
  streamError: string | null;
  isSimulatorMode: boolean;
  referenceRunOFreqHz: number | null;
  consistencyWarnings: string[];
  onChangeFftSampleCount: (count: FftSampleCount) => void;
  onStartLiveStream: () => void;
  onStopLiveStream: () => void;
  onClearSpectrum: () => void;
  onImportSpectrum: (spectrum: SpectrumMeasurement) => void;
  onKeepMeasurement: (
    ampMs2: number,
    frequencyHz: number,
    meta?: { sampleRateHz?: number; samplesUsed?: number; axisUsed?: SingleAxis }
  ) => void;
  onUpdateManualAmp: (ampAU: number) => void;
  onUpdatePhaseAngle: (deg: number) => void;
  onUpdateAxis: (axis: SensorAxis) => void;
  onNextScreen: () => void;
  onPrevScreen: () => void;
}

export const DataCollectionScreen: React.FC<Props> = ({
  run,
  runIndex,
  config,
  selectedSingleAxis,
  isAxisLocked,
  fftSampleCount,
  isStreaming,
  spectrum,
  bufferProgress,
  streamError,
  isSimulatorMode,
  referenceRunOFreqHz,
  consistencyWarnings,
  onChangeFftSampleCount,
  onStartLiveStream,
  onStopLiveStream,
  onClearSpectrum,
  onImportSpectrum,
  onKeepMeasurement,
  onUpdateManualAmp,
  onUpdatePhaseAngle,
  onUpdateAxis,
  onNextScreen,
  onPrevScreen,
}) => {
  // Horizontal spectrum view window (defaults to requested 0–200 Hz display range)
  const [xRange, setXRange] = useState<{ min: number; max: number }>({
    min: 0,
    max: 200,
  });
  // Vertical amplitude zoom multiplier (1 = Auto-fit, 2/4/8 = zoomed in to inspect smaller peaks)
  const [yZoom, setYZoom] = useState<1 | 2 | 4 | 8>(1);

  // Explicit user-controlled Peak Pick mode state & cursor
  const [peakPickActive, setPeakPickActive] = useState<boolean>(true);
  const [useInterpolation, setUseInterpolation] = useState<boolean>(false);
  const [selectedBinIdx, setSelectedBinIdx] = useState<number | null>(null);
  const [outOfRangeClickMsg, setOutOfRangeClickMsg] = useState<string | null>(null);
  const [isDraggingCursor, setIsDraggingCursor] = useState<boolean>(false);
  const [heldIncompleteWarning, setHeldIncompleteWarning] = useState<boolean>(false);

  const [csvError, setCsvError] = useState<string | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const [optionalRpm, setOptionalRpm] = useState<string>(
    config.nominalRpm > 0 ? String(config.nominalRpm) : ''
  );

  // Reset cursor & warnings when switching between runs
  useEffect(() => {
    setSelectedBinIdx(null);
    setOutOfRangeClickMsg(null);
    setHeldIncompleteWarning(false);
    setXRange({ min: 0, max: 200 });
    setYZoom(1);
  }, [run.type]);

  useEffect(() => {
    if (!spectrum) {
      setSelectedBinIdx(null);
      setOutOfRangeClickMsg(null);
    } else {
      setHeldIncompleteWarning(false);
    }
  }, [spectrum]);

  const refFreqHz = useMemo(() => {
    const rpm = parseFloat(optionalRpm);
    return Number.isFinite(rpm) && rpm > 0 ? rpm / 60 : null;
  }, [optionalRpm]);

  const viewMinHz = xRange.min;
  const viewMaxHz = xRange.max;
  const viewSpanHz = Math.max(5, viewMaxHz - viewMinHz);

  // Strictly plot ONLY valid spectral bins within [viewMinHz, min(viewMaxHz, nyquistHz)]
  // Never extrapolate or draw invalid spectral data above Nyquist.
  const plottedIndices = useMemo(() => {
    if (!spectrum) return [];
    const maxPlottableHz = Math.min(viewMaxHz, spectrum.nyquistHz + 1e-6);
    const idxs: number[] = [];
    for (let i = 0; i < spectrum.frequenciesHz.length; i++) {
      const f = spectrum.frequenciesHz[i];
      if (f >= viewMinHz - 1e-6 && f <= maxPlottableHz) {
        idxs.push(i);
      }
    }
    return idxs;
  }, [spectrum, viewMinHz, viewMaxHz]);

  // Maximum valid bin index <= Nyquist (never selects above Nyquist)
  const maxValidBinIdx = useMemo(() => {
    if (!spectrum) return 0;
    let lastValid = 0;
    for (let i = 0; i < spectrum.frequenciesHz.length; i++) {
      if (spectrum.frequenciesHz[i] <= spectrum.nyquistHz + 1e-6) {
        lastValid = i;
      }
    }
    return lastValid;
  }, [spectrum]);

  const peakAmpInView = useMemo(() => {
    if (!spectrum || plottedIndices.length === 0) return 1.0;
    let peak = 0.05;
    for (const idx of plottedIndices) {
      const val = spectrum.amplitudesMs2[idx] ?? 0;
      if (val > peak) peak = val;
    }
    return peak;
  }, [spectrum, plottedIndices]);

  const yMax = useMemo(() => {
    return Math.max(0.05, (peakAmpInView * 1.18) / yZoom);
  }, [peakAmpInView, yZoom]);

  // SVG Layout
  const svgWidth = 840;
  const svgHeight = 330;
  const padLeft = 62;
  const padRight = 24;
  const padTop = 26;
  const padBottom = 44;
  const plotWidth = svgWidth - padLeft - padRight;
  const plotHeight = svgHeight - padTop - padBottom;

  const getX = (f: number) =>
    padLeft +
    ((Math.max(viewMinHz, Math.min(f, viewMaxHz)) - viewMinHz) / viewSpanHz) * plotWidth;

  const getY = (amp: number) =>
    padTop + plotHeight - (Math.max(0, Math.min(amp, yMax)) / yMax) * plotHeight;

  const pickFrequencyFromPointerEvent = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!spectrum || !peakPickActive || spectrum.frequenciesHz.length < 3) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * svgWidth;
    if (svgX < padLeft || svgX > padLeft + plotWidth) return;

    const tappedFreq = viewMinHz + ((svgX - padLeft) / plotWidth) * viewSpanHz;

    if (tappedFreq > spectrum.nyquistHz + 1e-3) {
      setOutOfRangeClickMsg(
        `${tappedFreq.toFixed(1)} Hz is above the actual Nyquist frequency (${spectrum.nyquistHz.toFixed(
          2
        )} Hz). Select a peak within the valid 0 – ${spectrum.nyquistHz.toFixed(1)} Hz range.`
      );
      return;
    }

    setOutOfRangeClickMsg(null);
    const df =
      spectrum.frequenciesHz.length > 1
        ? spectrum.frequenciesHz[1] - spectrum.frequenciesHz[0]
        : Math.max(0.02, spectrum.resolutionHz);

    // Strictly snap cursor to the nearest valid spectral bin under the operator's touch
    // (never substitute or jump to an unrelated taller peak).
    const nearestIdx = Math.max(
      1,
      Math.min(maxValidBinIdx, Math.round(tappedFreq / Math.max(0.01, df)))
    );
    setSelectedBinIdx(nearestIdx);
  };

  const handleStepBin = (delta: number) => {
    if (!spectrum || selectedBinIdx === null) return;
    const nextIdx = Math.max(1, Math.min(maxValidBinIdx, selectedBinIdx + delta));
    setOutOfRangeClickMsg(null);
    setSelectedBinIdx(nextIdx);
  };

  const peakPickReadout = useMemo(() => {
    if (!spectrum || selectedBinIdx === null) return null;
    const clampedIdx = Math.min(selectedBinIdx, spectrum.frequenciesHz.length - 1);
    return computePeakPickReadout(spectrum, clampedIdx, useInterpolation);
  }, [spectrum, selectedBinIdx, useInterpolation]);

  const selectedFreqHz = peakPickReadout?.frequencyHz ?? null;
  const selectedAmpMs2 = peakPickReadout?.amplitudeMs2 ?? null;
  const isPeakOutsideValidRange =
    peakPickReadout !== null && !peakPickReadout.isWithinValidRange;

  // Horizontal X-axis ticks computed nicely for current zoom window
  const xTicks = useMemo(() => {
    const step =
      viewSpanHz <= 20
        ? 2
        : viewSpanHz <= 40
        ? 5
        : viewSpanHz <= 80
        ? 10
        : viewSpanHz <= 120
        ? 20
        : 40;
    const ticks: number[] = [];
    const first = Math.ceil(viewMinHz / step) * step;
    for (let f = first; f <= viewMaxHz + 1e-6; f += step) {
      ticks.push(Math.round(f * 100) / 100);
    }
    return ticks;
  }, [viewMinHz, viewMaxHz, viewSpanHz]);

  const handleZoomHorizontal = (direction: 'in' | 'out') => {
    const center =
      selectedFreqHz !== null &&
      selectedFreqHz >= viewMinHz &&
      selectedFreqHz <= viewMaxHz
        ? selectedFreqHz
        : (viewMinHz + viewMaxHz) / 2;
    const newSpan =
      direction === 'in'
        ? Math.max(10, viewSpanHz / 2)
        : Math.min(200, viewSpanHz * 2);
    let newMin = Math.max(0, center - newSpan / 2);
    let newMax = newMin + newSpan;
    if (newMax > 200) {
      newMax = 200;
      newMin = Math.max(0, 200 - newSpan);
    }
    setXRange({ min: Math.round(newMin), max: Math.round(newMax) });
  };

  const handlePanHorizontal = (dir: -1 | 1) => {
    const shift = Math.max(5, Math.round(viewSpanHz * 0.25)) * dir;
    let newMin = viewMinHz + shift;
    let newMax = viewMaxHz + shift;
    if (newMin < 0) {
      newMin = 0;
      newMax = viewSpanHz;
    }
    if (newMax > 200) {
      newMax = 200;
      newMin = Math.max(0, 200 - viewSpanHz);
    }
    setXRange({ min: newMin, max: newMax });
  };

  const handleHoldClick = () => {
    if (
      isStreaming &&
      bufferProgress &&
      bufferProgress.collected < bufferProgress.target &&
      !spectrum
    ) {
      setHeldIncompleteWarning(true);
    }
    onStopLiveStream();
  };

  const handleCsvFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parsePhyphoxCsv(text, selectedSingleAxis);
      if (!parsed) {
        setCsvError(
          'Could not parse CSV. Export Phyphox Acceleration Spectrum as CSV ("Frequency (Hz)","Absolute Amplitude").'
        );
        return;
      }
      setCsvError(null);
      setSelectedBinIdx(null);
      setOutOfRangeClickMsg(null);
      onImportSpectrum(parsed);
    } catch {
      setCsvError('Failed to read the selected CSV file.');
    }
  };

  const singleAxisChoices: { id: SingleAxis; label: string }[] = [
    { id: 'x', label: 'X' },
    { id: 'y', label: 'Y' },
    { id: 'z', label: 'Z' },
  ];

  const activeAxisLabel = selectedSingleAxis.toUpperCase();
  const binStepHz = spectrum ? spectrum.resolutionHz : 0;

  const bufferIncomplete =
    (isStreaming && bufferProgress !== null && bufferProgress.collected < bufferProgress.target) ||
    heldIncompleteWarning;
  const bufferPct = bufferProgress
    ? Math.min(100, Math.round((bufferProgress.collected / bufferProgress.target) * 100))
    : 0;

  const nyquistAboveView = spectrum ? spectrum.nyquistHz >= viewMaxHz - 0.1 : true;
  const targetMonitorFreqHz = refFreqHz ?? referenceRunOFreqHz ?? selectedFreqHz;

  // Build Acquisition Quality & Validation Warnings (Requirement 9)
  const qualityWarnings = useMemo(() => {
    const list: { severity: 'error' | 'warn' | 'info'; message: string }[] = [];

    if (bufferIncomplete && bufferProgress) {
      list.push({
        severity: 'warn',
        message: `Acquisition buffer incomplete (${bufferProgress.collected} / ${bufferProgress.target} samples). Allow sufficient acquisition time to fill all ${bufferProgress.target} samples before accepting a spectrum.`,
      });
    }

    if (bufferProgress && bufferProgress.irregularDuringFill && !spectrum) {
      list.push({
        severity: 'warn',
        message: `Irregular sampling intervals detected during buffering (${bufferProgress.droppedDuringFill} dropped-sample gap(s)). Keep screen awake and close heavy background tabs.`,
      });
    }

    if (spectrum) {
      if (
        targetMonitorFreqHz !== null &&
        targetMonitorFreqHz > spectrum.nyquistHz - 0.2
      ) {
        list.push({
          severity: 'error',
          message: `Sampling rate too low for target frequency (${targetMonitorFreqHz.toFixed(
            1
          )} Hz): Actual rate is ${spectrum.sampleRateHz.toFixed(
            1
          )} Hz, giving a Nyquist limit of ${spectrum.nyquistHz.toFixed(
            1
          )} Hz. Frequencies above ${spectrum.nyquistHz.toFixed(1)} Hz cannot be measured on this browser.`,
        });
      } else if (spectrum.nyquistHz < 200) {
        list.push({
          severity: 'info',
          message: `Usable spectrum ends at ${spectrum.nyquistHz.toFixed(
            1
          )} Hz (Actual sampling rate: ${spectrum.sampleRateHz.toFixed(
            1
          )} Hz). The shaded region from ${spectrum.nyquistHz.toFixed(
            1
          )} – 200 Hz exceeds Nyquist and is not measured.`,
        });
      }

      if (spectrum.quality.hasIrregularSampling) {
        list.push({
          severity: 'warn',
          message: `Irregular sampling intervals detected (jitter CV ${(
            spectrum.quality.jitterCv * 100
          ).toFixed(1)}%, est. ${
            spectrum.quality.droppedSamplesEstimate
          } dropped sample(s)). Frequency bins are computed from actual measured timestamps, but spectral sidelobes may elevate.`,
        });
      }

      if (spectrum.quality.isNoisyOrUnstable) {
        list.push({
          severity: 'warn',
          message: `Noisy or unstable vibration measurement (SNR ratio ${spectrum.quality.snrRatio.toFixed(
            1
          )}×, peak variation ${(spectrum.quality.peakStabilityCv * 100).toFixed(
            0
          )}%). Hold phone firmly against a rigid bearing housing at steady speed.`,
        });
      }
    }

    if (outOfRangeClickMsg) {
      list.push({ severity: 'error', message: outOfRangeClickMsg });
    }

    if (isPeakOutsideValidRange && selectedFreqHz !== null && spectrum) {
      list.push({
        severity: 'error',
        message: `Selected frequency (${selectedFreqHz.toFixed(
          2
        )} Hz) is outside the valid ${MIN_VALID_SPECTRUM_HZ.toFixed(
          1
        )} – ${spectrum.nyquistHz.toFixed(2)} Hz measurable range.`,
      });
    }

    for (const cw of consistencyWarnings) {
      list.push({ severity: 'error', message: cw });
    }

    return list;
  }, [
    bufferIncomplete,
    bufferProgress,
    spectrum,
    targetMonitorFreqHz,
    outOfRangeClickMsg,
    isPeakOutsideValidRange,
    selectedFreqHz,
    consistencyWarnings,
  ]);

  return (
    <div className="max-w-4xl mx-auto space-y-4 py-1">
      {/* Run Title & Single-Axis + Phase Bar */}
      <div className="bg-white border border-slate-300 shadow-sm rounded-2xl p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-mono text-slate-500">
              Run {runIndex + 1} of 4 · Single-Axis Channel:{' '}
              <strong className="text-slate-900">{activeAxisLabel}</strong>
              {run.isKept ? ' · Confirmed' : ''}
              {referenceRunOFreqHz !== null && run.type !== 'O'
                ? ` · Run O 1X: ${referenceRunOFreqHz.toFixed(2)} Hz`
                : ''}
            </p>
            <h1 className="text-lg sm:text-xl font-bold text-slate-900 mt-0.5">
              {run.title}
            </h1>
            <p className="text-xs text-slate-600 mt-0.5">{run.subtitle}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Strict Single-Axis Selector (X, Y, or Z only) */}
            <div className="flex items-center gap-1 bg-slate-100 border border-slate-300 rounded-xl p-1 text-xs">
              <span className="text-slate-600 font-medium px-2">Axis:</span>
              {singleAxisChoices.map((ax) => {
                const active = selectedSingleAxis === ax.id;
                return (
                  <button
                    key={ax.id}
                    type="button"
                    disabled={isAxisLocked || isStreaming}
                    onClick={() => onUpdateAxis(ax.id)}
                    className={`min-w-[34px] min-h-[34px] px-2.5 rounded-lg font-mono font-bold transition-colors ${
                      active
                        ? 'bg-slate-900 text-white'
                        : isAxisLocked || isStreaming
                        ? 'text-slate-400 cursor-not-allowed'
                        : 'text-slate-700 hover:bg-white cursor-pointer'
                    }`}
                  >
                    {ax.label}
                  </button>
                );
              })}
              {isAxisLocked && (
                <Lock
                  className="w-3.5 h-3.5 text-amber-600 mr-1.5"
                  aria-label="Axis locked consistently across O, T1, T2, and T3"
                />
              )}
            </div>

            {run.type !== 'O' && (
              <div className="flex items-center gap-1.5 bg-slate-100 border border-slate-300 rounded-xl px-3 py-1.5 text-xs">
                <span className="text-slate-600 font-medium">Phase:</span>
                <NumericInput
                  value={run.phaseAngleDeg}
                  min={0}
                  max={359}
                  fallbackOnEmpty={0}
                  placeholder="0"
                  onChangeValue={onUpdatePhaseAngle}
                  className="w-14 bg-white border border-slate-300 rounded-md px-1.5 py-1 text-center font-mono font-bold text-slate-900 text-xs focus:outline-none focus:border-cyan-600"
                />
                <span className="text-slate-500">°</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Phyphox-Methodology Single-Axis Spectrum Card */}
      <div className="bg-white border border-slate-300 shadow-sm rounded-2xl p-4 sm:p-5 space-y-4">
        {/* Top Action Controls: Start, Hold, Clear, Samples, Peak Pick, CSV */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onStartLiveStream}
              disabled={isStreaming}
              className={`min-h-[44px] px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-transform ${
                isStreaming
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-300 cursor-default'
                  : 'bg-slate-900 hover:bg-slate-800 text-white cursor-pointer active:scale-[0.98]'
              }`}
            >
              <Play className="w-4 h-4 fill-current" />
              <span>{isStreaming ? 'Acquiring' : 'Start'}</span>
            </button>

            <button
              type="button"
              onClick={handleHoldClick}
              disabled={!isStreaming}
              className={`min-h-[44px] px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-transform ${
                isStreaming
                  ? 'bg-rose-600 hover:bg-rose-700 text-white cursor-pointer active:scale-[0.98]'
                  : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
              }`}
            >
              <Pause className="w-3.5 h-3.5 fill-current" />
              <span>Hold</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setSelectedBinIdx(null);
                setOutOfRangeClickMsg(null);
                setHeldIncompleteWarning(false);
                setCsvError(null);
                onClearSpectrum();
              }}
              disabled={!spectrum && !bufferProgress && !isStreaming}
              className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-700 font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
              title="Clear captured samples and spectrum"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Clear</span>
            </button>

            {/* Explicit PEAK PICK Control */}
            <button
              type="button"
              onClick={() => setPeakPickActive((v) => !v)}
              aria-pressed={peakPickActive}
              className={`min-h-[44px] px-3.5 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 border transition-colors cursor-pointer ${
                peakPickActive
                  ? 'bg-amber-600 hover:bg-amber-700 border-amber-700 text-white shadow-xs'
                  : 'bg-white hover:bg-slate-50 border-slate-300 text-slate-700'
              }`}
              title="Toggle manual Peak Pick cursor mode on spectrum"
            >
              <Crosshair className="w-4 h-4" />
              <span>PEAK PICK: {peakPickActive ? 'ON' : 'OFF'}</span>
            </button>

            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleCsvFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => csvInputRef.current?.click()}
              className="min-h-[44px] px-3 py-2 rounded-xl border border-cyan-600/40 bg-cyan-50 hover:bg-cyan-100 text-cyan-900 font-semibold text-xs flex items-center gap-1.5 cursor-pointer transition-colors"
              title="Import Acceleration Spectrum CSV exported from Phyphox"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Import CSV</span>
            </button>
          </div>

          {/* Configurable FFT Sample Count + Optional Ref RPM */}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5">
              <label
                htmlFor="fft-samples-select"
                className="text-slate-600 font-medium whitespace-nowrap"
              >
                FFT Samples:
              </label>
              <select
                id="fft-samples-select"
                value={fftSampleCount}
                disabled={isStreaming}
                onChange={(e) =>
                  onChangeFftSampleCount(Number(e.target.value) as FftSampleCount)
                }
                className="bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 font-mono font-bold text-slate-900 text-xs focus:bg-white focus:outline-none focus:border-cyan-600 disabled:opacity-60"
              >
                {FFT_SAMPLE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt} {opt === 1024 ? '(Default)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <label
                htmlFor="ref-rpm-input"
                className="text-slate-600 font-medium whitespace-nowrap"
              >
                Ref RPM:
              </label>
              <input
                id="ref-rpm-input"
                type="text"
                inputMode="numeric"
                placeholder="opt"
                value={optionalRpm}
                onChange={(e) => setOptionalRpm(e.target.value.replace(/[^0-9]/g, ''))}
                className="w-20 bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 text-right font-mono font-semibold text-slate-900 text-xs focus:bg-white focus:outline-none focus:border-cyan-600"
              />
              {refFreqHz !== null && (
                <span className="font-mono text-[11px] text-violet-700 font-semibold whitespace-nowrap">
                  {refFreqHz.toFixed(1)} Hz
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Zoom & Vertical Scaling Controls (never alters underlying FFT data) */}
        <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-slate-500 font-medium mr-1">Freq View:</span>
            <button
              type="button"
              onClick={() => setXRange({ min: 0, max: 200 })}
              className={`px-2 py-1 rounded-md font-mono font-semibold cursor-pointer ${
                viewMinHz === 0 && viewMaxHz === 200
                  ? 'bg-slate-900 text-white'
                  : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
              }`}
            >
              0–200 Hz
            </button>
            {spectrum && spectrum.nyquistHz < 195 && (
              <button
                type="button"
                onClick={() =>
                  setXRange({
                    min: 0,
                    max: Math.max(10, Math.ceil(spectrum.nyquistHz)),
                  })
                }
                className={`px-2 py-1 rounded-md font-mono font-semibold cursor-pointer ${
                  viewMinHz === 0 &&
                  Math.abs(viewMaxHz - Math.ceil(spectrum.nyquistHz)) <= 1
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
                }`}
              >
                0–Nyquist ({Math.ceil(spectrum.nyquistHz)} Hz)
              </button>
            )}
            <button
              type="button"
              onClick={() => handleZoomHorizontal('in')}
              disabled={viewSpanHz <= 10}
              className="px-2 py-1 rounded-md bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
              title="Zoom in horizontally"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleZoomHorizontal('out')}
              disabled={viewSpanHz >= 200}
              className="px-2 py-1 rounded-md bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
              title="Zoom out horizontally"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            {viewSpanHz < 200 && (
              <>
                <button
                  type="button"
                  onClick={() => handlePanHorizontal(-1)}
                  disabled={viewMinHz <= 0}
                  className="px-1.5 py-1 rounded-md bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                  title="Pan left"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handlePanHorizontal(1)}
                  disabled={viewMaxHz >= 200}
                  className="px-1.5 py-1 rounded-md bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                  title="Pan right"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 font-medium">Y Scale:</span>
            {([1, 2, 4, 8] as const).map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => setYZoom(z)}
                className={`px-2 py-1 rounded-md font-mono font-semibold cursor-pointer ${
                  yZoom === z
                    ? 'bg-cyan-700 text-white'
                    : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {z === 1 ? 'Auto' : `${z}×`}
              </button>
            ))}
          </div>
        </div>

        {/* Status Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-slate-600">
          <span>
            {isStreaming
              ? spectrum
                ? `Rolling ${spectrum.samplesUsed}-sample single-axis (${activeAxisLabel}) FFT active`
                : `Filling ${fftSampleCount}-sample ${activeAxisLabel}-axis FFT buffer...`
              : spectrum
              ? `Frozen ${spectrum.samplesUsed}-sample spectrum (${activeAxisLabel}-axis)`
              : isSimulatorMode
              ? `Simulator enabled (411 Hz, ${fftSampleCount} samples, ${activeAxisLabel}-axis)`
              : `Ready: ${activeAxisLabel}-axis · ${fftSampleCount} samples · Requested view 0–200 Hz`}
          </span>
          <span className="text-cyan-700 font-sans font-semibold">
            {isStreaming
              ? spectrum
                ? `● Live Frame #${spectrum.frameCount}`
                : '● Acquiring Buffer...'
              : spectrum
              ? 'Held (Ready for Peak Pick)'
              : 'Idle'}
          </span>
        </div>

        {/* Error & Acquisition Quality Warnings */}
        {(streamError || csvError) && (
          <div className="bg-rose-50 border border-rose-300 rounded-xl p-3 flex items-start gap-2.5 text-xs text-rose-900">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{streamError || csvError}</span>
          </div>
        )}

        {qualityWarnings.map((w, idx) => (
          <div
            key={`qw-${idx}`}
            className={`rounded-xl px-3.5 py-2.5 flex items-start gap-2.5 text-xs leading-relaxed border ${
              w.severity === 'error'
                ? 'bg-rose-50 border-rose-300 text-rose-900'
                : w.severity === 'warn'
                ? 'bg-amber-50 border-amber-300 text-amber-900'
                : 'bg-slate-100 border-slate-300 text-slate-800'
            }`}
          >
            <AlertTriangle
              className={`w-4 h-4 shrink-0 mt-0.5 ${
                w.severity === 'error'
                  ? 'text-rose-600'
                  : w.severity === 'warn'
                  ? 'text-amber-700'
                  : 'text-slate-600'
              }`}
            />
            <span>{w.message}</span>
          </div>
        ))}

        {/* Spectrum SVG Display */}
        <div className="w-full bg-white border border-slate-300 rounded-xl overflow-hidden">
          {!spectrum ? (
            <div className="h-72 sm:h-80 flex flex-col items-center justify-center p-6 text-center space-y-3 text-slate-500">
              <Activity
                className={`w-9 h-9 stroke-[1.5] ${
                  isStreaming ? 'text-cyan-600 animate-pulse' : 'text-slate-300'
                }`}
              />
              <p className="text-sm font-semibold text-slate-700">
                {isStreaming
                  ? `Collecting ${fftSampleCount} Samples (${activeAxisLabel}-Axis)...`
                  : `Single-Axis Acceleration Spectrum (0 – 200 Hz · ${activeAxisLabel}-Axis)`}
              </p>

              {(isStreaming || heldIncompleteWarning) && bufferProgress && (
                <div className="w-full max-w-sm space-y-1.5">
                  <div className="h-2.5 w-full bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-cyan-600 transition-all duration-150"
                      style={{ width: `${bufferPct}%` }}
                    />
                  </div>
                  <p className="text-xs font-mono text-slate-700">
                    {bufferProgress.collected} / {bufferProgress.target} samples ({bufferPct}%)
                    {bufferProgress.estimatedRateHz
                      ? ` · Measured Rate: ${bufferProgress.estimatedRateHz.toFixed(1)} Hz`
                      : ''}
                  </p>
                  {bufferProgress.estimatedRateHz && (
                    <p className="text-[11px] font-mono text-slate-500">
                      Elapsed: {bufferProgress.elapsedSec.toFixed(1)} s · Est. remaining:{' '}
                      {Math.max(
                        0,
                        (bufferProgress.target - bufferProgress.collected) /
                          bufferProgress.estimatedRateHz
                      ).toFixed(1)}{' '}
                      s (Nyquist ≈ {(bufferProgress.estimatedRateHz / 2).toFixed(1)} Hz)
                    </p>
                  )}
                </div>
              )}

              {!isStreaming && !heldIncompleteWarning && (
                <p className="text-xs text-slate-500 max-w-md">
                  Hold the smartphone firmly against the bearing housing aligned with the{' '}
                  <strong>{activeAxisLabel}-axis</strong>, press <strong>Start</strong> and allow{' '}
                  <strong>{fftSampleCount} samples</strong> to fill for a valid FFT spectrum, then
                  press <strong>Hold</strong> and use <strong>PEAK PICK</strong>.
                </p>
              )}
            </div>
          ) : (
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className={`w-full h-auto select-none block touch-none ${
                peakPickActive ? 'cursor-crosshair' : 'cursor-default'
              }`}
              onPointerDown={(e) => {
                if (!peakPickActive) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                setIsDraggingCursor(true);
                pickFrequencyFromPointerEvent(e);
              }}
              onPointerMove={(e) => {
                if (!isDraggingCursor || !peakPickActive) return;
                pickFrequencyFromPointerEvent(e);
              }}
              onPointerUp={(e) => {
                if (isDraggingCursor) {
                  setIsDraggingCursor(false);
                  try {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  } catch {
                    // ignore
                  }
                }
              }}
              onPointerCancel={() => setIsDraggingCursor(false)}
            >
              <defs>
                <linearGradient id={`specGrad-${run.type}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0284c7" stopOpacity="0.24" />
                  <stop offset="85%" stopColor="#0284c7" stopOpacity="0.03" />
                  <stop offset="100%" stopColor="#0284c7" stopOpacity="0" />
                </linearGradient>
                <pattern
                  id={`nyqHatch-${run.type}`}
                  width="8"
                  height="8"
                  patternTransform="rotate(45 0 0)"
                  patternUnits="userSpaceOnUse"
                >
                  <rect width="8" height="8" fill="#f1f5f9" />
                  <line x1="0" y1="0" x2="0" y2="8" stroke="#cbd5e1" strokeWidth="1.5" />
                </pattern>
              </defs>

              {/* Shaded Unmeasurable Zone Above Actual Nyquist (NEVER extrapolate or plot above Nyquist) */}
              {!nyquistAboveView && spectrum.nyquistHz < viewMaxHz && (
                <g>
                  <rect
                    x={getX(Math.max(viewMinHz, spectrum.nyquistHz))}
                    y={padTop}
                    width={Math.max(
                      0,
                      padLeft + plotWidth - getX(Math.max(viewMinHz, spectrum.nyquistHz))
                    )}
                    height={plotHeight}
                    fill={`url(#nyqHatch-${run.type})`}
                  />
                  {spectrum.nyquistHz >= viewMinHz && (
                    <>
                      <line
                        x1={getX(spectrum.nyquistHz)}
                        y1={padTop}
                        x2={getX(spectrum.nyquistHz)}
                        y2={padTop + plotHeight}
                        stroke="#dc2626"
                        strokeWidth="1.5"
                        strokeDasharray="5 4"
                      />
                      <rect
                        x={Math.min(padLeft + plotWidth - 154, getX(spectrum.nyquistHz) + 6)}
                        y={padTop + 6}
                        width="148"
                        height="28"
                        rx="4"
                        fill="#ffffff"
                        fillOpacity="0.92"
                        stroke="#fca5a5"
                      />
                      <text
                        x={Math.min(padLeft + plotWidth - 80, getX(spectrum.nyquistHz) + 80)}
                        y={padTop + 18}
                        textAnchor="middle"
                        fill="#b91c1c"
                        fontSize="9.5"
                        fontWeight="bold"
                        fontFamily="monospace"
                      >
                        Nyquist: {spectrum.nyquistHz.toFixed(1)} Hz
                      </text>
                      <text
                        x={Math.min(padLeft + plotWidth - 80, getX(spectrum.nyquistHz) + 80)}
                        y={padTop + 29}
                        textAnchor="middle"
                        fill="#64748b"
                        fontSize="8.5"
                        fontFamily="monospace"
                      >
                        Not measurable above
                      </text>
                    </>
                  )}
                </g>
              )}

              {/* Y Gridlines */}
              {[0.25, 0.5, 0.75, 1.0].map((r) => {
                const v = yMax * r;
                const yp = getY(v);
                return (
                  <g key={`yg-${r}`}>
                    <line
                      x1={padLeft}
                      y1={yp}
                      x2={padLeft + plotWidth}
                      y2={yp}
                      stroke="#e2e8f0"
                      strokeDasharray="3 3"
                    />
                    <text
                      x={padLeft - 8}
                      y={yp + 4}
                      textAnchor="end"
                      fill="#475569"
                      fontSize="10.5"
                      fontFamily="monospace"
                    >
                      {v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(3)}
                    </text>
                  </g>
                );
              })}

              <text
                x={16}
                y={padTop + plotHeight / 2}
                textAnchor="middle"
                fill="#334155"
                fontSize="10.5"
                fontWeight="bold"
                fontFamily="monospace"
                transform={`rotate(-90, 16, ${padTop + plotHeight / 2})`}
              >
                Accel (m/s²)
              </text>

              {/* X Gridlines */}
              {xTicks.map((freq) => {
                const xp = getX(freq);
                return (
                  <g key={`xg-${freq}`}>
                    <line
                      x1={xp}
                      y1={padTop}
                      x2={xp}
                      y2={padTop + plotHeight}
                      stroke="#e2e8f0"
                      strokeDasharray="3 3"
                    />
                    <text
                      x={xp}
                      y={padTop + plotHeight + 17}
                      textAnchor="middle"
                      fill="#334155"
                      fontSize="10.5"
                      fontFamily="monospace"
                    >
                      {freq} Hz
                    </text>
                    <text
                      x={xp}
                      y={padTop + plotHeight + 31}
                      textAnchor="middle"
                      fill="#94a3b8"
                      fontSize="9"
                      fontFamily="monospace"
                    >
                      {Math.round(freq * 60)} RPM
                    </text>
                  </g>
                );
              })}

              {/* Border */}
              <rect
                x={padLeft}
                y={padTop}
                width={plotWidth}
                height={plotHeight}
                fill="none"
                stroke="#94a3b8"
                strokeWidth="1.1"
              />

              {/* Optional Reference RPM Line */}
              {refFreqHz !== null && refFreqHz >= viewMinHz && refFreqHz <= viewMaxHz && (
                <g>
                  <line
                    x1={getX(refFreqHz)}
                    y1={padTop}
                    x2={getX(refFreqHz)}
                    y2={padTop + plotHeight}
                    stroke="#7c3aed"
                    strokeWidth="1.4"
                    strokeDasharray="5 4"
                  />
                  <text
                    x={Math.min(
                      padLeft + plotWidth - 36,
                      Math.max(padLeft + 36, getX(refFreqHz))
                    )}
                    y={padTop + 14}
                    textAnchor="middle"
                    fill="#6d28d9"
                    fontSize="9.5"
                    fontWeight="bold"
                    fontFamily="monospace"
                  >
                    Ref {refFreqHz.toFixed(1)}Hz
                  </text>
                </g>
              )}

              {/* Primary Valid Single-Axis FFT Curve (strictly 0 .. Nyquist) */}
              {plottedIndices.length >= 2 &&
                (() => {
                  const pts = plottedIndices.map(
                    (idx) =>
                      `${getX(spectrum.frequenciesHz[idx])},${getY(
                        spectrum.amplitudesMs2[idx] ?? 0
                      )}`
                  );
                  const x0 = getX(spectrum.frequenciesHz[plottedIndices[0]]);
                  const xLast = getX(
                    spectrum.frequenciesHz[plottedIndices[plottedIndices.length - 1]]
                  );
                  const yBase = padTop + plotHeight;
                  return (
                    <>
                      <path
                        d={`M ${x0},${yBase} L ${pts.join(' L ')} L ${xLast},${yBase} Z`}
                        fill={`url(#specGrad-${run.type})`}
                      />
                      <path
                        d={`M ${pts.join(' L ')}`}
                        fill="none"
                        stroke="#0284c7"
                        strokeWidth="2.1"
                        strokeLinejoin="round"
                      />
                      {plottedIndices.length <= 120 &&
                        plottedIndices.map((idx) => (
                          <circle
                            key={`pt-${idx}`}
                            cx={getX(spectrum.frequenciesHz[idx])}
                            cy={getY(spectrum.amplitudesMs2[idx] ?? 0)}
                            r="2.1"
                            fill="#0284c7"
                          />
                        ))}
                    </>
                  );
                })()}

              {/* User-Controlled Peak Pick Vertical Cursor */}
              {selectedFreqHz !== null &&
                selectedAmpMs2 !== null &&
                selectedFreqHz >= viewMinHz &&
                selectedFreqHz <= Math.min(viewMaxHz, spectrum.nyquistHz) && (
                  <g>
                    <line
                      x1={getX(selectedFreqHz)}
                      y1={padTop}
                      x2={getX(selectedFreqHz)}
                      y2={padTop + plotHeight}
                      stroke="#d97706"
                      strokeWidth="2"
                    />
                    <circle
                      cx={getX(selectedFreqHz)}
                      cy={getY(selectedAmpMs2)}
                      r="5.5"
                      fill="#d97706"
                      stroke="#ffffff"
                      strokeWidth="1.8"
                    />
                    <rect
                      x={Math.min(
                        padLeft + plotWidth - 114,
                        Math.max(padLeft + 4, getX(selectedFreqHz) - 57)
                      )}
                      y={padTop + 6}
                      width="114"
                      height="18"
                      rx="4"
                      fill="#d97706"
                    />
                    <text
                      x={Math.min(
                        padLeft + plotWidth - 57,
                        Math.max(padLeft + 61, getX(selectedFreqHz))
                      )}
                      y={padTop + 18.5}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize="10"
                      fontWeight="bold"
                      fontFamily="monospace"
                    >
                      {selectedFreqHz.toFixed(2)} Hz
                    </text>
                  </g>
                )}
            </svg>
          )}
        </div>

        {/* Fine Peak Cursor Slider when spectrum is present & Peak Pick ON */}
        {spectrum && peakPickActive && maxValidBinIdx > 1 && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 flex flex-col sm:flex-row sm:items-center gap-3">
            <span className="text-[11px] font-bold text-slate-700 whitespace-nowrap">
              Cursor Scrub (0–{spectrum.nyquistHz.toFixed(1)} Hz):
            </span>
            <input
              type="range"
              min={1}
              max={maxValidBinIdx}
              step={1}
              value={selectedBinIdx ?? Math.min(maxValidBinIdx, Math.max(1, Math.round(maxValidBinIdx / 4)))}
              onChange={(e) => {
                setOutOfRangeClickMsg(null);
                setSelectedBinIdx(Number(e.target.value));
              }}
              className="flex-1 accent-amber-600 cursor-pointer"
              aria-label="Peak Pick Frequency Cursor"
            />
            <div className="flex items-center gap-1.5 text-[11px]">
              <button
                type="button"
                onClick={() => setUseInterpolation(false)}
                className={`px-2 py-1 rounded-md font-semibold cursor-pointer ${
                  !useInterpolation
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-300 text-slate-700'
                }`}
              >
                Nearest Bin
              </button>
              <button
                type="button"
                onClick={() => setUseInterpolation(true)}
                className={`px-2 py-1 rounded-md font-semibold cursor-pointer ${
                  useInterpolation
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-300 text-slate-700'
                }`}
              >
                Interpolated
              </button>
            </div>
          </div>
        )}

        {/* Required Acquisition Info Below the Spectrum (Requirement 5) */}
        <div className="bg-slate-50 border border-slate-300 rounded-xl p-3.5">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 text-xs font-mono tabular-nums">
            <div>
              <span className="text-[10px] font-sans uppercase tracking-wider text-slate-500 block">
                Actual Sample Rate
              </span>
              <strong className="text-slate-900 text-sm">
                {spectrum ? `${spectrum.sampleRateHz.toFixed(1)} Hz` : '—'}
              </strong>
            </div>
            <div>
              <span className="text-[10px] font-sans uppercase tracking-wider text-slate-500 block">
                Selected Axis
              </span>
              <strong className="text-slate-900 text-sm">{activeAxisLabel}</strong>
            </div>
            <div>
              <span className="text-[10px] font-sans uppercase tracking-wider text-slate-500 block">
                Samples Used
              </span>
              <strong className="text-slate-900 text-sm">
                {spectrum ? spectrum.samplesUsed : fftSampleCount}
              </strong>
            </div>
            <div>
              <span className="text-[10px] font-sans uppercase tracking-wider text-slate-500 block">
                Duration
              </span>
              <strong className="text-slate-900 text-sm">
                {spectrum ? `${spectrum.periodSec.toFixed(2)} s` : '—'}
              </strong>
            </div>
            <div>
              <span className="text-[10px] font-sans uppercase tracking-wider text-slate-500 block">
                Resolution (Δf)
              </span>
              <strong className="text-slate-900 text-sm">
                {spectrum ? `${spectrum.resolutionHz.toFixed(4)} Hz` : '—'}
              </strong>
            </div>
            <div>
              <span className="text-[10px] font-sans uppercase tracking-wider text-slate-500 block">
                Nyquist Freq
              </span>
              <strong className="text-slate-900 text-sm">
                {spectrum ? `${spectrum.nyquistHz.toFixed(2)} Hz` : '—'}
              </strong>
            </div>
          </div>
        </div>

        {/* User-Controlled Peak Pick Readout & Confirm Panel (Requirement 7) */}
        <div className="bg-slate-100 border border-slate-300 rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
              <Crosshair className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                {!peakPickActive
                  ? 'Activate PEAK PICK above to move the cursor onto your running-speed peak'
                  : selectedFreqHz === null
                  ? 'Tap or drag across the spectrum (or use the cursor slider) to select your 1X running-speed peak'
                  : `Peak Pick Cursor Active${
                      peakPickReadout?.isInterpolated ? ' (3-Bin Parabolic Interpolation)' : ''
                    }`}
              </span>
            </div>

            {spectrum && selectedBinIdx !== null && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleStepBin(-1)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-mono font-bold text-slate-700 flex items-center cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>-{binStepHz.toFixed(3)} Hz</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleStepBin(1)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-mono font-bold text-slate-700 flex items-center cursor-pointer"
                >
                  <span>+{binStepHz.toFixed(3)} Hz</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {selectedFreqHz !== null && selectedAmpMs2 !== null && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1 border-t border-slate-200">
              <div className="flex flex-wrap items-baseline gap-6">
                <div>
                  <span className="text-[11px] text-slate-600 font-semibold block">
                    Selected Frequency:
                  </span>
                  <span className="text-xl font-bold font-mono tabular-nums text-slate-900">
                    {selectedFreqHz.toFixed(2)} Hz
                  </span>
                  <span className="text-xs font-mono text-slate-500 ml-2">
                    ({Math.round(selectedFreqHz * 60)} RPM)
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-cyan-800 font-semibold block">
                    Selected Acceleration:
                  </span>
                  <span className="text-2xl font-extrabold font-mono tabular-nums text-cyan-800">
                    {selectedAmpMs2.toFixed(3)}
                  </span>
                  <span className="text-xs font-mono text-cyan-700 ml-1">m/s²</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  onKeepMeasurement(selectedAmpMs2, selectedFreqHz, {
                    sampleRateHz: spectrum?.sampleRateHz,
                    samplesUsed: spectrum?.samplesUsed,
                    axisUsed: spectrum?.axisUsed ?? selectedSingleAxis,
                  })
                }
                disabled={selectedAmpMs2 <= 0 || isPeakOutsideValidRange}
                className="min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-xs active:scale-[0.98] transition-all shrink-0"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Confirm Selected Peak ({selectedAmpMs2.toFixed(3)} m/s²)</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Saved / Manual Entry Row */}
      <div className="bg-white border border-slate-300 shadow-sm rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-0.5">
          <span className="text-xs font-bold text-slate-800 block">
            Confirmed Run Value / Manual Entry (m/s² or consistent units)
          </span>
          <span className="text-[11px] text-slate-500 block">
            Populated when you confirm a Peak Pick selection above, or enter a value directly. Keep units &amp; sensor axis identical across all 4 runs.
          </span>
          {run.isKept && run.frequencyHz > 0 && (
            <span className="text-[11px] font-mono text-emerald-700 font-semibold block pt-0.5">
              Stored 1X: {run.amplitudeMils} @ {run.frequencyHz.toFixed(2)} Hz (
              {run.runningRpm} RPM)
              {run.axisUsed ? ` · Axis ${run.axisUsed.toUpperCase()}` : ''}
              {run.fftSampleCountUsed ? ` · N=${run.fftSampleCountUsed}` : ''}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 sm:w-56">
          <NumericInput
            value={run.amplitudeMils}
            allowDecimal
            min={0}
            fallbackOnEmpty={null}
            placeholder="0.000"
            onChangeValue={onUpdateManualAmp}
            className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-right font-mono tabular-nums text-base font-bold text-slate-900 focus:bg-white focus:outline-none focus:border-cyan-600"
          />
          <span className="text-xs font-mono font-semibold text-slate-600 whitespace-nowrap">
            m/s²
          </span>
        </div>
      </div>

      {/* Navigation Footer */}
      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={onPrevScreen}
          className="min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs text-slate-700 font-semibold flex items-center gap-2 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (isStreaming) onStopLiveStream();
            onNextScreen();
          }}
          disabled={run.amplitudeMils <= 0}
          className={`min-h-[44px] px-5 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all ${
            run.amplitudeMils > 0
              ? 'bg-slate-900 hover:bg-slate-800 text-white cursor-pointer active:scale-[0.98]'
              : 'bg-slate-200 text-slate-400 cursor-not-allowed'
          }`}
        >
          <span>{runIndex === 3 ? 'View Polar Plot & Solution' : 'Next Run'}</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
