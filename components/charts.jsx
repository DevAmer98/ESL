"use client";
// -----------------------------------------------------------------------------
// components/charts.jsx — dependency-free SVG charts.
//
// A charting library would be ~100 KB of client JS to draw two figures. These
// are plain SVG, scale with their container, and stay legible in the console's
// dark palette.
// -----------------------------------------------------------------------------
import { useId } from "react";

const INK = "var(--ink)";
const GRID = "var(--line)";
const FAINT = "var(--faint)";

/** Grouped bar chart. series = [{ key, label, color }] over rows of {label,…}. */
export function BarChart({ data, series, height = 220, valueFormat = (v) => v }) {
  const W = 640;
  const H = height;
  const pad = { top: 12, right: 12, bottom: 28, left: 38 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0)));
  // Round the axis up to something human — 7 becomes 10, not 7.
  const niceMax = (() => {
    const mag = 10 ** Math.floor(Math.log10(max));
    return Math.ceil(max / mag) * mag;
  })();

  const groupW = innerW / Math.max(1, data.length);
  const barW = Math.min(18, (groupW - 8) / series.length);
  const ticks = 4;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img">
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const v = (niceMax / ticks) * i;
        const y = pad.top + innerH - (v / niceMax) * innerH;
        return (
          <g key={i}>
            <line x1={pad.left} x2={W - pad.right} y1={y} y2={y} stroke={GRID}
              strokeDasharray="2 4" />
            <text x={pad.left - 6} y={y + 3.5} textAnchor="end" fontSize="10" fill={FAINT}>
              {valueFormat(Math.round(v))}
            </text>
          </g>
        );
      })}

      {data.map((d, di) => (
        <g key={di}>
          {series.map((s, si) => {
            const v = Number(d[s.key]) || 0;
            const h = (v / niceMax) * innerH;
            const x = pad.left + di * groupW + (groupW - barW * series.length) / 2 + si * barW;
            return (
              <rect key={s.key} x={x} y={pad.top + innerH - h} width={barW - 2}
                height={Math.max(0, h)} fill={s.color} rx="2">
                <title>{`${d.label} · ${s.label}: ${v}`}</title>
              </rect>
            );
          })}
          <text x={pad.left + di * groupW + groupW / 2} y={H - 9} textAnchor="middle"
            fontSize="10" fill={FAINT}>{d.label}</text>
        </g>
      ))}
    </svg>
  );
}

/** Donut with a centred percentage — the success-rate figure. */
export function Donut({ value, total, size = 190, label }) {
  const pct = total > 0 ? value / total : 0;
  const r = size / 2 - 16;
  const c = 2 * Math.PI * r;
  const id = useId();

  const tone = pct >= 0.95 ? "var(--ok)" : pct >= 0.8 ? "var(--warn)" : "var(--bad)";

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bad)"
        strokeWidth="14" opacity={total > 0 ? 1 : 0.25} />
      <circle id={id} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone}
        strokeWidth="14" strokeLinecap="butt"
        strokeDasharray={`${c * pct} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x={size / 2} y={size / 2 + 2} textAnchor="middle" fontSize="30"
        fontWeight="800" fill={INK} fontFamily="ui-monospace, monospace">
        {total > 0 ? `${Math.round(pct * 100)}%` : "—"}
      </text>
      {label && (
        <text x={size / 2} y={size / 2 + 24} textAnchor="middle" fontSize="11" fill={FAINT}>
          {label}
        </text>
      )}
    </svg>
  );
}

/** Simple multi-series line chart for the time-series analytics tabs. */
export function LineChart({ data, series, height = 220, valueFormat = (v) => v }) {
  const W = 640;
  const H = height;
  const pad = { top: 12, right: 12, bottom: 28, left: 44 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const values = data.flatMap((d) => series.map((s) => Number(d[s.key])).filter(Number.isFinite));
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;

  const x = (i) => pad.left + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v) => pad.top + innerH - ((Number(v) - min) / span) * innerH;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img">
      {Array.from({ length: 5 }, (_, i) => {
        const v = min + (span / 4) * i;
        return (
          <g key={i}>
            <line x1={pad.left} x2={W - pad.right} y1={y(v)} y2={y(v)} stroke={GRID}
              strokeDasharray="2 4" />
            <text x={pad.left - 6} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill={FAINT}>
              {valueFormat(Math.round(v * 10) / 10)}
            </text>
          </g>
        );
      })}

      {series.map((s) => {
        const pts = data
          .map((d, i) => (Number.isFinite(Number(d[s.key])) ? `${x(i)},${y(d[s.key])}` : null))
          .filter(Boolean)
          .join(" ");
        return <polyline key={s.key} points={pts} fill="none" stroke={s.color}
          strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />;
      })}

      {data.map((d, i) =>
        i % Math.ceil(data.length / 8 || 1) === 0 ? (
          <text key={i} x={x(i)} y={H - 9} textAnchor="middle" fontSize="10" fill={FAINT}>
            {d.label}
          </text>
        ) : null,
      )}
    </svg>
  );
}

export function Legend({ series }) {
  return (
    <div className="inline" style={{ gap: 14, fontSize: 12, color: "var(--dim)" }}>
      {series.map((s) => (
        <span key={s.key} className="inline" style={{ gap: 6 }}>
          <span style={{ width: 9, height: 9, borderRadius: 9, background: s.color,
            display: "inline-block" }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}
