import { useCallback, useRef, useState } from "react";
import type { ProbPoint } from "../lib/types";

/** Series identity is fixed: Home, Draw, Away. Palette validated for CVD on the
 *  light surface (adjacency blue-cyan-magenta) with direct line-end labels as
 *  secondary encoding. Status colors (green/amber/red) are reserved for badges
 *  and never appear here. */
const SERIES = [
  { key: "Home", color: "#24559c" },
  { key: "Draw", color: "#0993a4" },
  { key: "Away", color: "#c2589a" },
] as const;

const W = 640;
const H = 180;
const PAD = { top: 12, right: 74, bottom: 24, left: 40 };

function fmtTime(ms: number): string {
  return new Date(ms).toISOString().slice(11, 16);
}

export function ProbChart({ history }: { history: ProbPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const pts = history.filter((p) => p.probs?.length === 3);
  if (pts.length < 2) {
    return <div className="chart-empty">Not enough odds history yet — the chart draws as ticks accumulate.</div>;
  }

  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const ys = pts.flatMap((p) => p.probs);
  const yMin = Math.max(0, Math.min(...ys) - 0.05);
  const yMax = Math.min(1, Math.max(...ys) + 0.05);

  const x = (t: number) => PAD.left + ((t - t0) / Math.max(1, t1 - t0)) * innerW;
  const y = (v: number) => PAD.top + (1 - (v - yMin) / Math.max(1e-9, yMax - yMin)) * innerH;

  const paths = SERIES.map((_, si) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.probs[si]).toFixed(1)}`).join(" "),
  );

  const onMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const px = ((e.clientX - rect.left) / rect.width) * W;
      const frac = (px - PAD.left) / innerW;
      const target = t0 + frac * (t1 - t0);
      let best = 0;
      let bestD = Infinity;
      pts.forEach((p, i) => {
        const d = Math.abs(p.t - target);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      setHover(best);
    },
    [pts, t0, t1, innerW],
  );

  const hp = hover !== null ? pts[hover] : null;
  const gridVals = [0.25, 0.5, 0.75].filter((v) => v > yMin && v < yMax);

  return (
    <div className="chart">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Implied probability over time for home, draw and away"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {gridVals.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="grid" />
            <text x={PAD.left - 6} y={y(v) + 3} textAnchor="end" className="axis">
              {Math.round(v * 100)}%
            </text>
          </g>
        ))}
        <text x={PAD.left} y={H - 8} className="axis">
          {fmtTime(t0)}
        </text>
        <text x={W - PAD.right} y={H - 8} textAnchor="end" className="axis">
          {fmtTime(t1)}
        </text>

        {paths.map((d, si) => (
          <path key={si} d={d} fill="none" stroke={SERIES[si].color} strokeWidth={2} className="series-line" />
        ))}

        {/* direct labels at line ends — identity never rides on color alone */}
        {SERIES.map((s, si) => (
          <text
            key={s.key}
            x={W - PAD.right + 6}
            y={y(pts[pts.length - 1].probs[si]) + 3}
            className="series-label"
            fill={s.color}
          >
            {s.key} {(pts[pts.length - 1].probs[si] * 100).toFixed(1)}%
          </text>
        ))}

        {hp && (
          <g>
            <line x1={x(hp.t)} x2={x(hp.t)} y1={PAD.top} y2={H - PAD.bottom} className="crosshair" />
            {SERIES.map((s, si) => (
              <circle key={s.key} cx={x(hp.t)} cy={y(hp.probs[si])} r={4} fill={s.color} stroke="#fafaf7" strokeWidth={1.5} />
            ))}
          </g>
        )}
      </svg>
      {hp && (
        <div className="chart-tooltip" style={{ left: `${(x(hp.t) / W) * 100}%` }}>
          <div className="tt-time mono">{fmtTime(hp.t)} UTC</div>
          {SERIES.map((s, si) => (
            <div key={s.key} className="tt-row">
              <i style={{ background: s.color }} />
              <span>{s.key}</span>
              <b className="mono">{(hp.probs[si] * 100).toFixed(1)}%</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
