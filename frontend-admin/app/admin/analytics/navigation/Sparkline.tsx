'use client';

export type SeriesPoint = { day: string; total: number };

const DAY_MS = 86_400_000;

/** Expand a sparse by-day series into a dense one (gaps = 0). */
export function densify(points: SeriesPoint[]): number[] {
  const valid = points
    .map((p) => ({ t: Date.parse(p.day), v: Number(p.total) || 0 }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  if (valid.length === 0) return [];
  const byDay = new Map<number, number>();
  for (const p of valid) {
    const k = Math.floor(p.t / DAY_MS);
    byDay.set(k, (byDay.get(k) ?? 0) + p.v);
  }
  const first = Math.floor(valid[0].t / DAY_MS);
  const last = Math.floor(valid[valid.length - 1].t / DAY_MS);
  const out: number[] = [];
  for (let d = first; d <= last; d++) out.push(byDay.get(d) ?? 0);
  return out;
}

export default function Sparkline({
  points,
  color = '#7367f0',
  width = 600,
  height = 160,
}: {
  points: SeriesPoint[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const values = densify(points);
  const pad = 8;
  const max = Math.max(1, ...values);
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  // One point: centre it; avoids dividing by (length - 1) === 0.
  const x = (i: number) => (values.length <= 1 ? width / 2 : pad + (i * innerW) / (values.length - 1));
  const y = (v: number) => pad + innerH - (v / max) * innerH;
  const coords = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const base = (pad + innerH).toFixed(1);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Views over time"
      style={{ width: '100%', height }}
      preserveAspectRatio="none"
    >
      <line x1={pad} x2={width - pad} y1={base} y2={base} stroke="#ddd" />
      {values.length > 1 && (
        <polygon
          data-testid="area"
          points={`${x(0).toFixed(1)},${base} ${coords.join(' ')} ${x(values.length - 1).toFixed(1)},${base}`}
          fill={color}
          opacity={0.15}
        />
      )}
      {values.length > 1 && (
        <polyline data-testid="line" points={coords.join(' ')} fill="none" stroke={color} strokeWidth={2} />
      )}
      {values.length === 1 && <circle data-testid="dot" cx={x(0)} cy={y(values[0])} r={4} fill={color} />}
    </svg>
  );
}
