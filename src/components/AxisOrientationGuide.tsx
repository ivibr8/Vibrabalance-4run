import React from 'react';
import { SensorAxis } from '../types/balancing';

interface Props {
  selectedAxis: SensorAxis;
  onSelectAxis?: (axis: SensorAxis) => void;
  compact?: boolean;
}

export const AxisOrientationGuide: React.FC<Props> = ({
  selectedAxis,
  onSelectAxis,
  compact = false,
}) => {
  const axesInfo: {
    id: 'x' | 'y' | 'z';
    label: string;
    short: string;
    tip: string;
    badgeColor: string;
  }[] = [
    {
      id: 'z',
      label: 'Z-Axis (In / Out of Screen)',
      short: 'Z Axis',
      tip: 'Phone lying flat on top of bearing housing (+Z points through the screen).',
      badgeColor: 'bg-amber-50 text-amber-800 border-amber-300',
    },
    {
      id: 'x',
      label: 'X-Axis (Left ↔ Right)',
      short: 'X Axis',
      tip: 'Phone edge pressed sideways to measure horizontal bearing vibration.',
      badgeColor: 'bg-rose-50 text-rose-800 border-rose-300',
    },
    {
      id: 'y',
      label: 'Y-Axis (Bottom ↔ Top)',
      short: 'Y Axis',
      tip: 'Top edge of phone pointed toward or perpendicular to the shaft centerline.',
      badgeColor: 'bg-emerald-50 text-emerald-800 border-emerald-300',
    },
  ];

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
      <div className="flex flex-col sm:flex-row items-center gap-5">
        {/* W3C / Android / iOS 3-Axis Coordinate Diagram */}
        <div className="shrink-0 flex flex-col items-center">
          <svg
            viewBox="0 0 200 180"
            className={compact ? 'w-36 h-32' : 'w-44 h-40'}
            aria-label="Smartphone 3-Axis Accelerometer Diagram"
          >
            <defs>
              <marker id="arrowX" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill="#e11d48" />
              </marker>
              <marker id="arrowY" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill="#059669" />
              </marker>
              <marker id="arrowZ" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill="#d97706" />
              </marker>
            </defs>

            <rect
              x="64"
              y="32"
              width="68"
              height="120"
              rx="10"
              fill="#1e293b"
              stroke="#475569"
              strokeWidth="2"
            />
            <rect
              x="69"
              y="40"
              width="58"
              height="102"
              rx="5"
              fill="#f8fafc"
              stroke="#cbd5e1"
              strokeWidth="1"
            />
            <circle cx="98" cy="36" r="1.8" fill="#64748b" />
            <circle cx="98" cy="91" r="3.5" fill="#0f172a" />

            {/* +Y Axis: Bottom to Top */}
            <line
              x1="98"
              y1="91"
              x2="98"
              y2="12"
              stroke="#059669"
              strokeWidth={selectedAxis === 'y' ? '3.5' : '2'}
              markerEnd="url(#arrowY)"
            />
            <text
              x="106"
              y="18"
              fill="#047857"
              fontSize="10"
              fontWeight="bold"
              fontFamily="monospace"
            >
              +Y (Top)
            </text>

            {/* +X Axis: Left to Right */}
            <line
              x1="98"
              y1="91"
              x2="182"
              y2="91"
              stroke="#e11d48"
              strokeWidth={selectedAxis === 'x' ? '3.5' : '2'}
              markerEnd="url(#arrowX)"
            />
            <text
              x="138"
              y="83"
              fill="#be123c"
              fontSize="10"
              fontWeight="bold"
              fontFamily="monospace"
            >
              +X (Right)
            </text>

            {/* +Z Axis: Out of Screen */}
            <line
              x1="98"
              y1="91"
              x2="42"
              y2="132"
              stroke="#d97706"
              strokeWidth={selectedAxis === 'z' ? '3.5' : '2'}
              markerEnd="url(#arrowZ)"
            />
            <text
              x="4"
              y="148"
              fill="#b45309"
              fontSize="10"
              fontWeight="bold"
              fontFamily="monospace"
            >
              +Z (Screen)
            </text>
          </svg>
          <span className="text-[11px] text-slate-500 font-mono text-center">
            Phone 3-Axis Coordinates
          </span>
        </div>

        {/* Selectable X / Y / Z Axis Buttons */}
        <div className="flex-1 space-y-2.5 w-full">
          <p className="text-xs text-slate-600 leading-relaxed">
            Pick the phone axis aligned with the machine&apos;s radial vibration direction before starting the 4 runs, and keep the same phone mounting &amp; orientation for every run.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {axesInfo.map((ax) => {
              const active = selectedAxis === ax.id;
              const isInteractive = Boolean(onSelectAxis);
              return (
                <button
                  key={ax.id}
                  type="button"
                  disabled={!isInteractive}
                  onClick={() => onSelectAxis?.(ax.id)}
                  className={`text-left p-3 rounded-xl border transition-all min-h-[44px] ${
                    isInteractive ? 'cursor-pointer' : 'cursor-default opacity-85'
                  } ${
                    active
                      ? 'bg-white border-cyan-600 ring-2 ring-cyan-600/20 shadow-xs'
                      : 'bg-white/75 border-slate-200 hover:bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-bold text-slate-900">{ax.short}</span>
                    <span
                      className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border ${ax.badgeColor}`}
                    >
                      {ax.id.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1.5 leading-snug">{ax.tip}</p>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
