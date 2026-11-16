import React from 'react';
import { BalancingConfig, SensorAxis } from '../types/balancing';
import { ArrowRight, Lock, RotateCcw, RotateCw } from 'lucide-react';
import { AxisOrientationGuide } from './AxisOrientationGuide';

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
      <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-2">
        <p className="text-xs font-mono text-slate-500">
          Single-Plane No-Phase Balancing · Live FFT Spectrum (AU)
        </p>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
          Four-Run Dynamic Rotor Balancing
        </h1>
        <p className="text-sm text-slate-600 leading-relaxed">
          Take four relative vibration readings (<strong>O</strong>, <strong>O+T1</strong>, <strong>O+T2</strong>, <strong>O+T3</strong>) by watching the live spectrum and picking your 1X unbalance peak, or enter values manually. Only relative magnitude changes matter, so Arbitrary Units (AU) compute the exact correction weight and angle.
        </p>
      </div>

      {/* Machine & Trial Weight Parameters */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
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
              <input
                type="number"
                step="0.1"
                min="0.01"
                value={config.trialMass}
                onChange={(e) =>
                  onUpdateConfig({
                    ...config,
                    trialMass: Math.max(0.01, parseFloat(e.target.value) || 0),
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
            <input
              type="number"
              step="10"
              min="60"
              max="15000"
              value={config.nominalRpm}
              onChange={(e) =>
                onUpdateConfig({
                  ...config,
                  nominalRpm: Math.max(60, parseInt(e.target.value, 10) || 1800),
                })
              }
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-slate-900 font-mono tabular-nums text-sm focus:bg-white focus:outline-none focus:border-cyan-600"
            />
            <span className="text-[11px] text-slate-500 mt-1 block font-mono">
              Expected 1X reference: {(config.nominalRpm / 60).toFixed(1)} Hz
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
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
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
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
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
                <input
                  type="number"
                  min="0"
                  max="359"
                  value={config.t1AngleDeg}
                  onChange={(e) =>
                    onUpdateConfig({ ...config, t1AngleDeg: parseInt(e.target.value, 10) || 0 })
                  }
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-2 text-center font-mono text-xs text-slate-900 font-bold focus:bg-white focus:outline-none focus:border-cyan-600"
                />
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block mb-0.5 font-mono">T2</span>
                <input
                  type="number"
                  min="0"
                  max="359"
                  value={config.t2AngleDeg}
                  onChange={(e) =>
                    onUpdateConfig({ ...config, t2AngleDeg: parseInt(e.target.value, 10) || 0 })
                  }
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-2 text-center font-mono text-xs text-slate-900 font-bold focus:bg-white focus:outline-none focus:border-cyan-600"
                />
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block mb-0.5 font-mono">T3</span>
                <input
                  type="number"
                  min="0"
                  max="359"
                  value={config.t3AngleDeg}
                  onChange={(e) =>
                    onUpdateConfig({ ...config, t3AngleDeg: parseInt(e.target.value, 10) || 0 })
                  }
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-2 text-center font-mono text-xs text-slate-900 font-bold focus:bg-white focus:outline-none focus:border-cyan-600"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3-Axis Selector Card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-900">
            02. Select Sensing Axis (X, Y, or Z)
          </h2>
          {isAxisLocked && (
            <span className="flex items-center gap-1 text-xs font-semibold text-amber-700">
              <Lock className="w-3.5 h-3.5" />
              <span>Locked to {lockedAxis?.toUpperCase()} for active session</span>
            </span>
          )}
        </div>

        <AxisOrientationGuide
          selectedAxis={isAxisLocked && lockedAxis ? lockedAxis : config.sensorAxis}
          onSelectAxis={
            isAxisLocked ? undefined : (axis) => onUpdateConfig({ ...config, sensorAxis: axis })
          }
        />

        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
          <label className="flex items-center gap-2 cursor-pointer select-none text-slate-600">
            <input
              type="checkbox"
              checked={isSimulatorMode}
              onChange={(e) => onToggleSimulator(e.target.checked)}
              className="rounded border-slate-300 text-cyan-600 focus:ring-cyan-500 cursor-pointer"
            />
            <span>Simulator Mode (synthetic 400 Hz signal for desktop testing)</span>
          </label>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3 pt-1">
        <button
          type="button"
          onClick={onStartFreshProcedure}
          className="min-h-[46px] px-5 py-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
        >
          <span>Start New 4-Run Session (Clear Values)</span>
        </button>

        <button
          type="button"
          onClick={onStartProcedure}
          className="min-h-[46px] flex-1 px-6 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-[0.99]"
        >
          <span>Continue to Run 1: &quot;O&quot; Measurement</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
