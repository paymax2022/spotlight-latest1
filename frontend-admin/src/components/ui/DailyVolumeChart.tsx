import { useMemo, useRef, useState } from 'react';
import { colors } from '@/components/ui/vuexy';
import { formatKobo, type AdminTransactionsSummaryDay } from '@/services/transactionsAdminService';

// Inline SVG bar chart — no chart library is bundled in frontend-admin (see
// app/admin/commission/profit/page.tsx's RevenueBars for the established
// pattern this extends). Built to the dataviz skill's spec: a real Y axis
// with gridlines + rounded-number ticks, a thinned X axis so dates never
// collide, capped/rounded bars with a surface gap between them, an HTML
// hover tooltip (not a native SVG <title>, which is unstyled and slow), and
// a table-view toggle as the accessibility twin of the chart.
//
// `days` must already be date-ordered ascending (the summary endpoint
// returns it that way).

const VB_W = 760;
const VB_H = 260;
const MARGIN = { top: 16, right: 12, bottom: 30, left: 64 };
const PLOT_W = VB_W - MARGIN.left - MARGIN.right;
const PLOT_H = VB_H - MARGIN.top - MARGIN.bottom;
const MAX_BAR_W = 24;
const BAR_GAP_MIN = 2;
const MAX_X_LABELS = 8;

/** Smallest "nice" number (1/2/5 × 10^n) that is >= v. Powers the Y axis so
 * ticks land on round numbers (₦5,000 / ₦10,000, never ₦7,432). */
function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  for (const step of [1, 2, 5, 10]) {
    if (step * base >= v) return step * base;
  }
  return 10 * base;
}

function formatKoboCompact(kobo: number): string {
  const naira = kobo / 100;
  if (naira === 0) return '₦0';
  if (naira >= 1_000_000) return `₦${(naira / 1_000_000).toFixed(naira % 1_000_000 === 0 ? 0 : 1)}M`;
  if (naira >= 1_000) return `₦${(naira / 1_000).toFixed(naira % 1_000 === 0 ? 0 : 1)}K`;
  return `₦${naira.toFixed(0)}`;
}

function formatDayShort(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-NG', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function DailyVolumeChart({ days }: { days: AdminTransactionsSummaryDay[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [tablesView, setTablesView] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const yMax = useMemo(() => niceCeil(Math.max(1, ...days.map((d) => d.amount_kobo))), [days]);
  const yTicks = useMemo(() => {
    const n = 4;
    return Array.from({ length: n + 1 }, (_, i) => (yMax / n) * i);
  }, [yMax]);

  // Show at most MAX_X_LABELS date labels — every Nth bar — so dates never
  // collide regardless of range length (7 days or 90).
  const xLabelStride = Math.max(1, Math.ceil(days.length / MAX_X_LABELS));

  if (days.length === 0) return null;

  const bandW = PLOT_W / days.length;
  const barW = Math.min(MAX_BAR_W, Math.max(1, bandW - BAR_GAP_MIN));

  function yFor(amountKobo: number): number {
    return MARGIN.top + PLOT_H - (amountKobo / yMax) * PLOT_H;
  }

  function handleMove(e: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = VB_W / rect.width;
    const xInVb = (e.clientX - rect.left) * scaleX;
    const idx = Math.min(days.length - 1, Math.max(0, Math.floor((xInVb - MARGIN.left) / bandW)));
    setHoverIndex(idx);
  }

  const hovered = hoverIndex != null ? days[hoverIndex] : null;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.4rem' }}>
        <button
          onClick={() => setTablesView((v) => !v)}
          style={{
            fontSize: '0.75rem',
            color: colors.info,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          {tablesView ? 'View as chart' : 'View as table'}
        </button>
      </div>

      {tablesView ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', fontSize: '0.75rem', color: colors.muted, padding: '4px 8px', borderBottom: `1px solid ${colors.border}` }}>Day</th>
                <th style={{ textAlign: 'right', fontSize: '0.75rem', color: colors.muted, padding: '4px 8px', borderBottom: `1px solid ${colors.border}` }}>Transactions</th>
                <th style={{ textAlign: 'right', fontSize: '0.75rem', color: colors.muted, padding: '4px 8px', borderBottom: `1px solid ${colors.border}` }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.day}>
                  <td style={{ fontSize: '0.8rem', color: colors.text, padding: '4px 8px', borderBottom: `1px solid ${colors.border}` }}>{d.day}</td>
                  <td style={{ fontSize: '0.8rem', color: colors.text, padding: '4px 8px', borderBottom: `1px solid ${colors.border}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{d.count.toLocaleString('en-NG')}</td>
                  <td style={{ fontSize: '0.8rem', color: colors.text, padding: '4px 8px', borderBottom: `1px solid ${colors.border}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatKobo(d.amount_kobo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            style={{ width: '100%', height: 220, display: 'block' }}
            onPointerMove={handleMove}
            onPointerLeave={() => setHoverIndex(null)}
            role="img"
            aria-label="Daily transaction volume bar chart"
          >
            {/* Y gridlines + tick labels — recessive hairlines, rounded values */}
            {yTicks.map((t) => {
              const y = yFor(t);
              return (
                <g key={t}>
                  <line x1={MARGIN.left} x2={VB_W - MARGIN.right} y1={y} y2={y} stroke={colors.border} strokeWidth={1} />
                  <text x={MARGIN.left - 8} y={y} textAnchor="end" dominantBaseline="middle" fontSize={11} fill={colors.muted}>
                    {formatKoboCompact(t)}
                  </text>
                </g>
              );
            })}

            {/* X axis baseline */}
            <line
              x1={MARGIN.left}
              x2={VB_W - MARGIN.right}
              y1={MARGIN.top + PLOT_H}
              y2={MARGIN.top + PLOT_H}
              stroke={colors.border}
              strokeWidth={1}
            />

            {/* Bars */}
            {days.map((d, i) => {
              const cx = MARGIN.left + bandW * i + bandW / 2;
              const barTop = yFor(d.amount_kobo);
              const barH = Math.max(0, MARGIN.top + PLOT_H - barTop);
              const isHover = hoverIndex === i;
              return (
                <g key={d.day}>
                  {/* Full-band invisible hit area — bigger than the thin bar itself */}
                  <rect x={MARGIN.left + bandW * i} y={MARGIN.top} width={bandW} height={PLOT_H} fill="transparent" />
                  <rect
                    x={cx - barW / 2}
                    y={barTop}
                    width={barW}
                    height={barH}
                    rx={4}
                    fill={isHover ? colors.info : colors.primary}
                  />
                </g>
              );
            })}

            {/* X tick labels — thinned so dates never collide */}
            {days.map((d, i) => {
              if (i % xLabelStride !== 0) return null;
              const cx = MARGIN.left + bandW * i + bandW / 2;
              return (
                <text key={d.day} x={cx} y={MARGIN.top + PLOT_H + 18} textAnchor="middle" fontSize={11} fill={colors.muted}>
                  {formatDayShort(d.day)}
                </text>
              );
            })}

            {/* Crosshair on the hovered band */}
            {hovered && hoverIndex != null && (
              <line
                x1={MARGIN.left + bandW * hoverIndex + bandW / 2}
                x2={MARGIN.left + bandW * hoverIndex + bandW / 2}
                y1={MARGIN.top}
                y2={MARGIN.top + PLOT_H}
                stroke={colors.border}
                strokeWidth={1}
              />
            )}
          </svg>

          {hovered && hoverIndex != null && (
            <div
              style={{
                position: 'absolute',
                left: `${((MARGIN.left + bandW * hoverIndex + bandW / 2) / VB_W) * 100}%`,
                top: 4,
                transform: 'translateX(-50%)',
                background: colors.text,
                color: '#fff',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: '0.75rem',
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
                zIndex: 1,
              }}
            >
              <div style={{ fontWeight: 700 }}>{formatKobo(hovered.amount_kobo)}</div>
              <div style={{ opacity: 0.85 }}>
                {hovered.count.toLocaleString('en-NG')} transaction{hovered.count === 1 ? '' : 's'} · {hovered.day}
              </div>
            </div>
          )}

          <p style={{ fontSize: '0.7rem', color: colors.muted, marginTop: '0.4rem', textAlign: 'center' }}>
            X axis: day · Y axis: transaction amount (₦)
          </p>
        </div>
      )}
    </div>
  );
}
