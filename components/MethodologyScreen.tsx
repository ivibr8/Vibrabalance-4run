import React, { useState, useEffect } from 'react';
import { BalancingConfig, SensorAxis } from '../types/balancing';
import { ArrowRight, Lock, RotateCcw, RotateCw } from 'lucide-react';
import { AxisOrientationGuide } from './AxisOrientationGuide';

interface NumericInputProps {
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
  config: BalancingConfig;
  isAxisLocked: boolean;
  lockedAxis: SensorAxis | null;
  onUpdateConfig: (newConfig: BalancingConfig) => void;
  onStartProcedure: () => void;
  onStartFreshProcedure: () => void;
  onLoadDemoData: () => void;
  isSimulatorMode: boolean;
  onToggleSimulator: (val: boolean) => void;
}

export const MethodologyScreen: React.FC<Props> = ({
  config,
  isAxisLocked,
  lockedAxis,
  onUpdateConfig,
  onStartProcedure,
  onStartFreshProcedure,
  onLoadDemoData,
  isSimulatorMode,
  onToggleSimulator,
}) => {
  return (
    <div className="max-w-3xl mx-auto space-y-5 py-1">
      {/* Clean Overview Header */}
      <div className="bg-white border border-slate-300 shadow-sm rounded-2xl p-5 sm:p-6 space-y-2">
        <p className="text-xs font-mono text-slate-500">
          Single-Plane No-Phase Balancing · Live Smartphone FFT Spectrum (AU)
        </p>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
          Four-Run Dynamic Rotor Balancing
        </h1>
        <p className="text-sm text-slate-600 leading-relaxed">
          Measure and record the original 1X unbalance amplitude (<strong>O</strong>) at a fixed radial measurement location. Next, place a trial weight at a constant radius from the shaft centerline and collect three additional amplitude readings (<strong>O+T1</strong>, <strong>O+T2</strong>, <strong>O+T3</strong>) with the trial weight installed at three angular positions separated by approximately 120&deg;. The resulting four measurements are plotted to determine the optimum correction weight and correction angle. Because the method relies on relative amplitude changes rather than calibrated vibration values, measurements may be entered in Arbitrary Units (AU). All readings should be taken at the same radial measurement location. <strong>CAUTION:</strong> This procedure only works if unbalance is the cause of the high vibration.{' '}
          <span className="text-red-600 font-medium">
            NOTE: the existing data acquisition code is being worked on. For the four data acquisition measurements (pages 2 through 5), recommend using the Acceleration Spectrum found in the Phyphox mobile application. This should provide the user with the vibration amplitude at the running speed peak (use peak pick to select). Use the amplitude measurement to manually input the value on each page.
          </span>
        </p>
      </div>

      {/* Machine & Trial Weight Parameters */}
      <div className="bg-white border border-slate-300 shadow-sm rounded-2xl p-5 sm:p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <h2 className="text-sm font-bold text-slate-900">
            01. Rotor &amp; Trial Weight Setup
          </h2>
          <button
            type="button"
            onClick={onLoadDemoData}
            className="text-xs font-semibold text-amber-700 hover:text-amber-800 hover:underline cursor-pointer"
          >
            Load 1 oz Example
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          {/* Trial Weight Mass */}
          <div>
            <label className="text-slate-700 block mb-1.5 font-semibold">
              Trial Weight Mass (W_T)
            </label>
            <div className="flex items-center gap-2">
              <NumericInput
                value={config.trialMass}
                allowDecimal
                min={0.01}
                fallbackOnEmpty={1.0}
                placeholder="1.0"
                onChangeValue={(val) =>
                  onUpdateConfig({
                    ...config,
                    trialMass: val,
                  })
                }
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-slate-900 font-mono tabular-nums text-sm focus:bg-white focus:outline-none focus:border-cyan-600"
              />
              <select
                value={config.massUnit}
                onChange={(e) =>
                  onUpdateConfig({ ...config, massUnit: e.target.value as 'g' | 'oz' })
                }
                className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-700 font-mono focus:bg-white focus:outline-none focus:border-cyan-600"
              >
                <option value="oz">oz</option>
                <option value="g">grams</option>
              </select>
            </div>
          </div>

          {/* Nominal Speed */}
          <div>
            <label className="text-slate-700 block mb-1.5 font-semibold">
              Nominal Operating Speed (RPM, optional reference)
            </label>
            <NumericInput
              value={config.nominalRpm}
              min={60}
              max={15000}
              fallbackOnEmpty={null}
              placeholder="e.g. 2580"
              onChangeValue={(val) =>
                onUpdateConfig({
                  ...config,
                  nominalRpm: val,
                })
              }
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-slate-900 font-mono tabular-nums text-sm focus:bg-white focus:outline-none focus:border-cyan-600"
            />
            <span className="text-[11px] text-slate-500 mt-1 block font-mono">
              {config.nominalRpm > 0
                ? `Expected 1X reference: ${(config.nominalRpm / 60).toFixed(1)} Hz`
                : 'Optional reference line hidden'}
            </span>
          </div>

          {/* Rotation Direction */}
          <div>
            <label className="text-slate-700 block mb-1.5 font-semibold">
              Direction of Rotation
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onUpdateConfig({ ...config, rotationDirection: 'CW' })}
                className={`min-h-[42px] py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                  config.rotationDirection === 'CW'
                    ? 'bg-slate-900 border-slate-900 text-white'
                    : 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span>CW</span>
              </button>
              <button
                type="button"
                onClick={() => onUpdateConfig({ ...config, rotationDirection: 'CCW' })}
                className={`min-h-[42px] py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                  config.rotationDirection === 'CCW'
                    ? 'bg-slate-900 border-slate-900 text-white'
                    : 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>CCW</span>
              </button>
            </div>
          </div>

          {/* Trial Phase Angles */}
          <div>
            <label className="text-slate-700 block mb-1.5 font-semibold">
              Trial Weight Phase Angles (°)
            </label>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <span className="text-[10px] text-slate-500 block mb-0.5 font-mono">T1</span>
                <NumericInput
                  value={config.t1AngleDeg}
                  min={0}
                  max={359}
                  fallbackOnEmpty={0}
                  placeholder="0"
                  onChangeValue={(val) =>
                    onUpdateConfig({ ...config, t1AngleDeg: val })
                  }
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-2 text-center font-mono text-xs text-slate-900 font-bold focus:bg-white focus:outline-none focus:border-cyan-600"
                />
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block mb-0.5 font-mono">T2</span>
                <NumericInput
                  value={config.t2AngleDeg}
                  min={0}
                  max={359}
                  fallbackOnEmpty={0}
                  placeholder="120"
                  onChangeValue={(val) =>
                    onUpdateConfig({ ...config, t2AngleDeg: val })
                  }
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-2 text-center font-mono text-xs text-slate-900 font-bold focus:bg-white focus:outline-none focus:border-cyan-600"
                />
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block mb-0.5 font-mono">T3</span>
                <NumericInput
                  value={config.t3AngleDeg}
                  min={0}
                  max={359}
                  fallbackOnEmpty={0}
                  placeholder="240"
                  onChangeValue={(val) =>
                    onUpdateConfig({ ...config, t3AngleDeg: val })
                  }
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-2 text-center font-mono text-xs text-slate-900 font-bold focus:bg-white focus:outline-none focus:border-cyan-600"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3-Axis Selector Card */}
      <div className="bg-white border border-slate-300 shadow-sm rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-900">
            02. Select Sensing Axis (X, Y, Z, or 3D)
          </h2>
          {isAxisLocked && (
            <span className="flex items-center gap-1 text-xs font-semibold text-amber-700">
              <Lock className="w-3.5 h-3.5" />
              <span>Locked to {lockedAxis === 'triaxial' ? '3D' : lockedAxis?.toUpperCase()} for active session</span>
            </span>
          )}
        </div>

        <AxisOrientationGuide
          selectedAxis={isAxisLocked && lockedAxis ? lockedAxis : config.sensorAxis}
          onSelectAxis={
            isAxisLocked ? undefined : (axis) => onUpdateConfig({ ...config, sensorAxis: axis })
          }
        />

        <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-xs">
          <label className="flex items-center gap-2 cursor-pointer select-none text-slate-600">
            <input
              type="checkbox"
              checked={isSimulatorMode}
              onChange={(e) => onToggleSimulator(e.target.checked)}
              className="rounded border-slate-300 text-cyan-600 focus:ring-cyan-500 cursor-pointer"
            />
            <span>Simulator Mode (synthetic 411 Hz / 1024-sample signal for desktop testing)</span>
          </label>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3 pt-1">
        <button
          type="button"
          onClick={onStartFreshProcedure}
          className="min-h-[46px] px-5 py-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 shadow-xs text-slate-800 font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
        >
          <span>Start New 4-Run Session (Clear Values)</span>
        </button>

        <button
          type="button"
          onClick={onStartProcedure}
          className="min-h-[46px] flex-1 px-6 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 shadow-xs text-white font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-[0.99]"
        >
          <span>Continue to Run 1: &quot;O&quot; Measurement</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
