import React, { useState, useMemo, useEffect } from 'react';
import {
  BalancingConfig,
  PeakHoldSpectrum,
  RunData,
  SensorAxis,
} from '../types/balancing';
import { PEAK_HOLD_STEP_HZ } from '../utils/fft';
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
  Play,
  RotateCcw,
  Square,
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
  isAxisLocked: boolean;
  isStreaming: boolean;
  peakHold: PeakHoldSpectrum | null;
  streamError: string | null;
  isSimulatorMode: boolean;
  onStartLiveStream: () => void;
  onStopLiveStream: () => void;
  onClearPeakHold: () => void;
  onKeepMeasurement: (ampAU: number, frequencyHz: number) => void;
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
  isAxisLocked,
  isStreaming,
  peakHold,
  streamError,
  isSimulatorMode,
  onStartLiveStream,
  onStopLiveStream,
  onClearPeakHold,
  onKeepMeasurement,
  onUpdateManualAmp,
  onUpdatePhaseAngle,
  onUpdateAxis,
  onNextScreen,
  onPrevScreen,
}) => {
  // Only two frequency ranges: 60 Hz and 100 Hz
  const [rangeHz, setRangeHz] = useState<60 | 100>(60);
  // Selected bin index on the 0.5 Hz Peak-Hold grid (never auto-selected)
  const [selectedBinIdx, setSelectedBinIdx] = useState<number | null>(null);
  const [optionalRpm, setOptionalRpm] = useState<string>(
    config.nominalRpm > 0 ? String(config.nominalRpm) : ''
  );

  // Reset selected peak cursor when switching runs or clearing Peak Hold
  useEffect(() => {
    setSelectedBinIdx(null);
  }, [run.type]);

  useEffect(() => {
    if (!peakHold) {
      setSelectedBinIdx(null);
    }
  }, [peakHold]);

  const refFreqHz = useMemo(() => {
    const rpm = parseFloat(optionalRpm);
    return Number.isFinite(rpm) && rpm > 0 ? rpm / 60 : null;
  }, [optionalRpm]);

  // Strict X-axis range: strictly 60 Hz or 100 Hz (never collapsed down to Nyquist)
  const displayMaxHz = rangeHz;

  const visibleIndices = useMemo(() => {
    if (!peakHold) return [];
    const idxs: number[] = [];
    for (let i = 0; i < peakHold.frequenciesHz.length; i++) {
      if (peakHold.frequenciesHz[i] <= displayMaxHz + 1e-6) {
        idxs.push(i);
      }
    }
    return idxs;
  }, [peakHold, displayMaxHz]);

  const yMax = useMemo(() => {
    if (!peakHold || visibleIndices.length === 0) return 1.0;
    let peak = 0.05;
    for (const idx of visibleIndices) {
      const val = peakHold.heldAmplitudesAU[idx] ?? 0;
      if (val > peak) peak = val;
    }
    return Math.max(0.2, peak * 1.18);
  }, [peakHold, visibleIndices]);

  // SVG Layout
  const svgWidth = 820;
  const svgHeight = 320;
  const padLeft = 58;
  const padRight = 24;
  const padTop = 26;
  const padBottom = 44;
  const plotWidth = svgWidth - padLeft - padRight;
  const plotHeight = svgHeight - padTop - padBottom;

  const getX = (f: number) =>
    padLeft + (Math.max(0, Math.min(f, displayMaxHz)) / displayMaxHz) * plotWidth;
  const getY = (amp: number) =>
    padTop + plotHeight - (Math.max(0, Math.min(amp, yMax)) / yMax) * plotHeight;

  const handleSvgTap = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!peakHold || visibleIndices.length < 3) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * svgWidth;
    if (svgX < padLeft || svgX > padLeft + plotWidth) return;

    const tappedFreq = ((svgX - padLeft) / plotWidth) * displayMaxHz;

    // Snap gently to highest local peak within ±2.0 Hz of tap for easy mobile selection
    let bestIdx = -1;
    let bestAmp = -1;
    for (const idx of visibleIndices) {
      const f = peakHold.frequenciesHz[idx];
      if (f >= 2.0 && Math.abs(f - tappedFreq) <= 2.0) {
        const amp = peakHold.heldAmplitudesAU[idx] ?? 0;
        if (amp > bestAmp) {
          bestAmp = amp;
          bestIdx = idx;
        }
      }
    }

    if (bestIdx !== -1) {
      setSelectedBinIdx(bestIdx);
      return;
    }

    const fallbackIdx = Math.min(
      peakHold.frequenciesHz.length - 1,
      Math.max(1, Math.round(tappedFreq / PEAK_HOLD_STEP_HZ))
    );
    setSelectedBinIdx(fallbackIdx);
  };

  const handleStepBin = (delta: number) => {
    if (!peakHold || selectedBinIdx === null) return;
    const maxIdx = Math.min(
      peakHold.frequenciesHz.length - 1,
      Math.round(displayMaxHz / PEAK_HOLD_STEP_HZ)
    );
    const nextIdx = Math.max(1, Math.min(maxIdx, selectedBinIdx + delta));
    setSelectedBinIdx(nextIdx);
  };

  const selectedFreqHz =
    peakHold && selectedBinIdx !== null
      ? peakHold.frequenciesHz[selectedBinIdx] ?? null
      : null;
  const selectedHeldAmpAU =
    peakHold && selectedBinIdx !== null
      ? peakHold.heldAmplitudesAU[selectedBinIdx] ?? null
      : null;

  const axisChoices: { id: 'x' | 'y' | 'z'; label: string }[] = [
    { id: 'x', label: 'X' },
    { id: 'y', label: 'Y' },
    { id: 'z', label: 'Z' },
  ];

  const activeAxisLabel =
    config.sensorAxis === 'triaxial' ? '3D' : config.sensorAxis.toUpperCase();

  const xTicks =
    rangeHz === 60 ? [0, 10, 20, 30, 40, 50, 60] : [0, 20, 40, 60, 80, 100];

  const nyquistLimitedBelowSpan =
    peakHold !== null && peakHold.nyquistHz > 5 && peakHold.nyquistHz < displayMaxHz - 1;

  return (
    <div className="max-w-4xl mx-auto space-y-4 py-1">
      {/* Run Title & Axis / Phase Bar */}
      <div className="bg-white border border-slate-300 shadow-sm rounded-2xl p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-mono text-slate-500">
              Run {runIndex + 1} of 4 · Axis {activeAxisLabel}
              {run.isKept ? ' · Saved' : ''}
            </p>
            <h1 className="text-lg sm:text-xl font-bold text-slate-900 mt-0.5">{run.title}</h1>
            <p className="text-xs text-slate-600 mt-0.5">{run.subtitle}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Axis Selector */}
            <div className="flex items-center gap-1.5 bg-slate-100 border border-slate-300 rounded-xl p-1 text-xs">
              <span className="text-slate-500 font-medium px-2">Axis:</span>
              {axisChoices.map((ax) => {
                const active = config.sensorAxis === ax.id;
                return (
                  <button
                    key={ax.id}
                    type="button"
                    disabled={isAxisLocked || isStreaming}
                    onClick={() => onUpdateAxis(ax.id)}
                    className={`min-w-[36px] min-h-[34px] px-2.5 rounded-lg font-mono font-bold transition-colors ${
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
                <Lock className="w-3.5 h-3.5 text-amber-600 mr-1.5" aria-label="Axis locked across runs" />
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

      {/* Peak-Hold Live Spectrum Card */}
      <div className="bg-white border border-slate-300 shadow-sm rounded-2xl p-4 sm:p-5 space-y-4">
        {/* Top Action Controls */}
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
              <span>Start Peak Hold</span>
            </button>

            <button
              type="button"
              onClick={onStopLiveStream}
              disabled={!isStreaming}
              className={`min-h-[44px] px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-transform ${
                isStreaming
                  ? 'bg-rose-600 hover:bg-rose-700 text-white cursor-pointer active:scale-[0.98]'
                  : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
              }`}
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Stop Peak Hold</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setSelectedBinIdx(null);
                onClearPeakHold();
              }}
              disabled={!peakHold}
              className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-700 font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
              title="Clear held spectrum peaks"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Clear Peaks</span>
            </button>

            {/* Range Toggle: ONLY 60 Hz and 100 Hz */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl text-xs">
              {([60, 100] as const).map((hz) => (
                <button
                  key={hz}
                  type="button"
                  onClick={() => setRangeHz(hz)}
                  className={`px-3 py-1.5 rounded-lg font-mono text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    rangeHz === hz
                      ? 'bg-white text-slate-900 font-bold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {hz} Hz
                </button>
              ))}
            </div>
          </div>

          {/* Optional Reference RPM Input */}
          <div className="flex items-center gap-2 text-xs">
            <label htmlFor="ref-rpm-input" className="text-slate-600 font-medium whitespace-nowrap">
              Ref RPM (opt):
            </label>
            <input
              id="ref-rpm-input"
              type="text"
              inputMode="numeric"
              placeholder="e.g. 2580"
              value={optionalRpm}
              onChange={(e) => setOptionalRpm(e.target.value.replace(/[^0-9]/g, ''))}
              className="w-24 bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 text-right font-mono font-semibold text-slate-900 text-xs focus:bg-white focus:outline-none focus:border-cyan-600"
            />
            {refFreqHz !== null && (
              <span className="font-mono text-[11px] text-violet-700 font-semibold whitespace-nowrap">
                {refFreqHz.toFixed(1)} Hz
              </span>
            )}
          </div>
        </div>

        {/* Clean Unboxed Status Line */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-slate-500 border-b border-slate-100 pb-2">
          {peakHold ? (
            <span>
              {peakHold.sensorSource} · Sample Rate {Math.round(peakHold.sampleRateHz)} Hz · Display 0–{displayMaxHz} Hz · Peak Hold ({peakHold.frameCount} frames)
            </span>
          ) : (
            <span>
              {isStreaming
                ? 'Acquiring accelerometer data...'
                : isSimulatorMode
                ? 'Simulator ready (400 Hz) · Press Start Peak Hold'
                : 'Press Start Peak Hold, hold phone on bearing, then Stop & remove phone to read peak'}
            </span>
          )}
          <span className="text-cyan-700 font-sans font-semibold">
            {isStreaming ? '● Peak Hold Active' : peakHold ? 'Peak Hold Frozen' : ''}
          </span>
        </div>

        {streamError && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex items-start gap-2.5 text-xs text-rose-900">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{streamError}</span>
          </div>
        )}

        {/* Spectrum SVG Display */}
        <div className="w-full bg-white border border-slate-300 rounded-xl overflow-hidden">
          {!peakHold || visibleIndices.length < 2 ? (
            <div className="h-72 sm:h-80 flex flex-col items-center justify-center p-6 text-center space-y-2 text-slate-500">
              <Activity
                className={`w-9 h-9 stroke-[1.5] ${
                  isStreaming ? 'text-cyan-600 animate-pulse' : 'text-slate-300'
                }`}
              />
              <p className="text-sm font-semibold text-slate-700">
                {isStreaming
                  ? 'Building Peak-Hold Spectrum...'
                  : `Peak-Hold Vibration Spectrum (0 – ${displayMaxHz} Hz)`}
              </p>
              <p className="text-xs text-slate-500 max-w-md">
                {isStreaming
                  ? 'Hold your phone steady on the bearing housing. Maximum peaks per frequency bin are locked automatically.'
                  : 'Tap Start Peak Hold, hold the phone against the machine for several seconds, then tap Stop and remove the phone — your peaks remain on screen.'}
              </p>
            </div>
          ) : (
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="w-full h-auto cursor-crosshair select-none block touch-manipulation"
              onClick={handleSvgTap}
            >
              <defs>
                <linearGradient id={`holdGrad-${run.type}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0284c7" stopOpacity="0.22" />
                  <stop offset="85%" stopColor="#0284c7" stopOpacity="0.03" />
                  <stop offset="100%" stopColor="#0284c7" stopOpacity="0" />
                </linearGradient>
              </defs>

              {/* Browser Nyquist Limit Marker if sensor rate stops inside 60/100 Hz window */}
              {nyquistLimitedBelowSpan && (
                <g>
                  <rect
                    x={getX(peakHold.nyquistHz)}
                    y={padTop}
                    width={padLeft + plotWidth - getX(peakHold.nyquistHz)}
                    height={plotHeight}
                    fill="#f8fafc"
                  />
                  <line
                    x1={getX(peakHold.nyquistHz)}
                    y1={padTop}
                    x2={getX(peakHold.nyquistHz)}
                    y2={padTop + plotHeight}
                    stroke="#94a3b8"
                    strokeWidth="1.2"
                    strokeDasharray="4 4"
                  />
                  <text
                    x={Math.min(padLeft + plotWidth - 65, getX(peakHold.nyquistHz) + 6)}
                    y={padTop + 14}
                    fill="#64748b"
                    fontSize="9.5"
                    fontFamily="monospace"
                  >
                    Sensor Nyquist {Math.round(peakHold.nyquistHz)} Hz
                  </text>
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
                      stroke="#f1f5f9"
                      strokeDasharray="3 3"
                    />
                    <text
                      x={padLeft - 8}
                      y={yp + 4}
                      textAnchor="end"
                      fill="#64748b"
                      fontSize="10.5"
                      fontFamily="monospace"
                    >
                      {v >= 1 ? v.toFixed(1) : v.toFixed(2)}
                    </text>
                  </g>
                );
              })}

              <text
                x={16}
                y={padTop + plotHeight / 2}
                textAnchor="middle"
                fill="#475569"
                fontSize="10.5"
                fontWeight="bold"
                fontFamily="monospace"
                transform={`rotate(-90, 16, ${padTop + plotHeight / 2})`}
              >
                Peak Hold (AU)
              </text>

              {/* X Gridlines (Strict 0..60 Hz or 0..100 Hz) */}
              {xTicks.map((freq) => {
                const xp = getX(freq);
                return (
                  <g key={`xg-${freq}`}>
                    <line
                      x1={xp}
                      y1={padTop}
                      x2={xp}
                      y2={padTop + plotHeight}
                      stroke="#f1f5f9"
                      strokeDasharray="3 3"
                    />
                    <text
                      x={xp}
                      y={padTop + plotHeight + 17}
                      textAnchor="middle"
                      fill="#475569"
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
                      {freq * 60}
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
                stroke="#cbd5e1"
                strokeWidth="1"
              />

              {/* Optional Reference RPM Line */}
              {refFreqHz !== null && refFreqHz > 0 && refFreqHz <= displayMaxHz && (
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
                    x={Math.min(padLeft + plotWidth - 36, Math.max(padLeft + 36, getX(refFreqHz)))}
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

              {/* Faint Live Curve underneath Peak Hold while streaming */}
              {isStreaming && (() => {
                const livePts = visibleIndices.map(
                  (idx) =>
                    `${getX(peakHold.frequenciesHz[idx])},${getY(
                      peakHold.liveAmplitudesAU[idx] ?? 0
                    )}`
                );
                return (
                  <path
                    d={`M ${livePts.join(' L ')}`}
                    fill="none"
                    stroke="#94a3b8"
                    strokeWidth="1.2"
                    strokeDasharray="3 3"
                  />
                );
              })()}

              {/* Primary Held Maximum Peak-Hold Curve */}
              {(() => {
                const pts = visibleIndices.map(
                  (idx) =>
                    `${getX(peakHold.frequenciesHz[idx])},${getY(
                      peakHold.heldAmplitudesAU[idx] ?? 0
                    )}`
                );
                const x0 = getX(peakHold.frequenciesHz[visibleIndices[0]]);
                const xLast = getX(
                  peakHold.frequenciesHz[visibleIndices[visibleIndices.length - 1]]
                );
                const yBase = padTop + plotHeight;
                return (
                  <>
                    <path
                      d={`M ${x0},${yBase} L ${pts.join(' L ')} L ${xLast},${yBase} Z`}
                      fill={`url(#holdGrad-${run.type})`}
                    />
                    <path
                      d={`M ${pts.join(' L ')}`}
                      fill="none"
                      stroke="#0284c7"
                      strokeWidth="2.3"
                      strokeLinejoin="round"
                    />
                  </>
                );
              })()}

              {/* User-Selected 1X Peak Cursor */}
              {selectedFreqHz !== null &&
                selectedHeldAmpAU !== null &&
                selectedFreqHz <= displayMaxHz && (
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
                      cy={getY(selectedHeldAmpAU)}
                      r="5.5"
                      fill="#d97706"
                      stroke="#ffffff"
                      strokeWidth="1.8"
                    />
                    <rect
                      x={Math.min(
                        padLeft + plotWidth - 102,
                        Math.max(padLeft + 4, getX(selectedFreqHz) - 51)
                      )}
                      y={padTop + 6}
                      width="102"
                      height="17"
                      rx="4"
                      fill="#d97706"
                    />
                    <text
                      x={Math.min(
                        padLeft + plotWidth - 51,
                        Math.max(padLeft + 55, getX(selectedFreqHz))
                      )}
                      y={padTop + 18}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize="10"
                      fontWeight="bold"
                      fontFamily="monospace"
                    >
                      1X: {selectedFreqHz.toFixed(1)} Hz
                    </text>
                  </g>
                )}
            </svg>
          )}
        </div>

        {/* Browser Sample Rate Notice if Hardware Browser Rate < 90 Hz */}
        {peakHold && peakHold.sampleRateHz < 90 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5 flex items-start gap-2 text-xs text-amber-900">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <span>
              <strong>Browser Sensor Limit:</strong> Your browser is delivering{' '}
              <strong className="font-mono">{Math.round(peakHold.sampleRateHz)} Hz</strong>{' '}
              (Nyquist {Math.round(peakHold.nyquistHz)} Hz), whereas native apps like Phyphox read hardware directly at higher rates. Higher frequencies above{' '}
              {Math.round(peakHold.nyquistHz)} Hz can alias down into lower bins inside mobile browsers.
            </span>
          </div>
        )}

        {/* Selected Held Peak Readout & Accept Button */}
        <div className="bg-slate-100 border border-slate-300 rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
              <Crosshair className="w-4 h-4 text-amber-600" />
              <span>
                {selectedFreqHz === null
                  ? 'Tap the peak at the running speed frequency on the Peak-Hold spectrum after removing the phone to select your 1X value'
                  : `Selected 1X Peak @ ${selectedFreqHz.toFixed(1)} Hz (${Math.round(selectedFreqHz * 60)} RPM)`}
              </span>
            </div>

            {peakHold && selectedBinIdx !== null && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleStepBin(-1)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-mono font-bold text-slate-700 flex items-center cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>0.5Hz</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleStepBin(1)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-mono font-bold text-slate-700 flex items-center cursor-pointer"
                >
                  <span>0.5Hz</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {selectedFreqHz !== null && selectedHeldAmpAU !== null && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
              <div className="flex items-baseline gap-6">
                <div>
                  <span className="text-[11px] text-slate-500 block">Selected Frequency</span>
                  <span className="text-xl font-bold font-mono tabular-nums text-slate-900">
                    {selectedFreqHz.toFixed(1)} Hz
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-cyan-800 font-semibold block">
                    Held Max Amplitude
                  </span>
                  <span className="text-2xl font-extrabold font-mono tabular-nums text-cyan-800">
                    {selectedHeldAmpAU.toFixed(3)}
                  </span>
                  <span className="text-xs font-mono text-cyan-700 ml-1">AU</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onKeepMeasurement(selectedHeldAmpAU, selectedFreqHz)}
                disabled={selectedHeldAmpAU <= 0}
                className="min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-xs active:scale-[0.98] transition-all shrink-0"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Accept 1X ({selectedHeldAmpAU.toFixed(3)} AU)</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Saved / Manual Override Row */}
      <div className="bg-white border border-slate-300 shadow-sm rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-0.5">
          <span className="text-xs font-bold text-slate-800 block">
            Accepted Run Value / Manual Override (AU)
          </span>
          <span className="text-[11px] text-slate-500 block">
            Use the Peak-Hold value above or type a reading directly (e.g. from Phyphox or a meter). Measurements can be repeated to establish consistency
          </span>
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
            AU
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
