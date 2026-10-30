'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getBusRevenueReport, downloadBusRevenueCsv,
  type BusRevenueGroupBy, type BusRevenueReport, type BusRevenueRow,
} from '@/services/busReportsAdminService';
import { PageHeader, MobilityTabs, Card, StateNote, Kpi, btn, input, nairaFull } from '../../_ui';
import { colors, thCell, tdCell } from '@/components/ui/vuexy';

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export default function BusRevenuePage() {
  const today = new Date();
  const [from, setFrom] = useState(isoDay(new Date(today.getTime() - 29 * 86_400_000)));
  const [to, setTo] = useState(isoDay(today));
  const [groupBy, setGroupBy] = useState<BusRevenueGroupBy>('day');
  const [report, setReport] = useState<BusRevenueReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setReport(await getBusRevenueReport({ from, to, groupBy })); }
    catch (e) { setReport(null); setError(String(e)); }
    finally { setLoading(false); }
  }, [from, to, groupBy]);

  useEffect(() => { void load(); }, [load]);

  const exportCsv = async () => {
    setExporting(true); setError(null);
    try {
      const blob = await downloadBusRevenueCsv({ from, to, groupBy });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bus-revenue-${from}-${to}-by-${groupBy}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError(`CSV export failed: ${String(e)}`); }
    finally { setExporting(false); }
  };

  const t = report?.totals;
  const cols: [string, (r: BusRevenueRow) => string][] = [
    ['Tickets', (r) => String(r.ticketsCount)],
    ['Gross booked', (r) => nairaFull(r.grossBookedKobo)],
    ['Cancelled', (r) => String(r.cancelledCount)],
    ['Refunded', (r) => nairaFull(r.refundedKobo)],
    ['Manual refund owed', (r) => nairaFull(r.manualRefundKobo)],
    ['In escrow', (r) => nairaFull(r.heldKobo)],
    ['Released', (r) => String(r.releasedCount)],
    ['Net to operator', (r) => nairaFull(r.netToOperatorKobo)],
    ['Platform commission', (r) => nairaFull(r.platformCommissionKobo)],
  ];

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Bus Revenue"
        subtitle="Bookings, refunds, payouts and commission by day or operator. Payout figures are the settlement legs that actually posted."
        action={<button onClick={() => void exportCsv()} style={btn()} disabled={exporting || loading}>{exporting ? 'Exporting…' : 'Export CSV'}</button>}
      />
      <MobilityTabs active="bus" />

      <Card title="Period">
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'end' }}>
          <label style={{ fontSize: '0.8rem' }}>From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={input()} /></label>
          <label style={{ fontSize: '0.8rem' }}>To<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} style={input()} /></label>
          <label style={{ fontSize: '0.8rem' }}>Group by
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as BusRevenueGroupBy)} style={input()}>
              <option value="day">Day</option>
              <option value="operator">Operator</option>
            </select>
          </label>
          <button onClick={() => void load()} style={btn()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
        </div>
        <div style={{ fontSize: '0.75rem', color: colors.muted, marginTop: '0.5rem' }}>Dates are UTC booking dates, inclusive. Max 366 days.</div>
      </Card>

      {error && <StateNote kind="error">{error}</StateNote>}

      {t && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', margin: '1.25rem 0' }}>
          <Kpi label="Gross booked" value={nairaFull(t.grossBookedKobo)} sub={`${t.ticketsCount} tickets`} />
          <Kpi label="Refunded" value={nairaFull(t.refundedKobo)} sub={`${t.cancelledCount} cancelled`} />
          <Kpi label="Manual refund owed" value={nairaFull(t.manualRefundKobo)} accent={t.manualRefundKobo ? colors.danger : colors.success} />
          <Kpi label="Net to operators" value={nairaFull(t.netToOperatorKobo)} sub={`${t.releasedCount} released`} />
          <Kpi label="Platform commission" value={nairaFull(t.platformCommissionKobo)} />
        </div>
      )}

      <Card title={groupBy === 'day' ? 'By day' : 'By operator'}>
        {loading ? <StateNote kind="loading">Loading report…</StateNote>
          : !report || report.rows.length === 0 ? <StateNote kind="empty">No bus bookings in this period.</StateNote>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead><tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                  <th style={thCell}>{groupBy === 'day' ? 'Day' : 'Operator'}</th>
                  {cols.map(([h]) => <th key={h} style={thCell}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {[...report.rows, report.totals].map((r) => (
                    <tr key={r.key} style={{ borderBottom: `1px solid ${colors.border}`, fontWeight: r.key === 'total' ? 700 : undefined }}>
                      <td style={tdCell}>{r.label}</td>
                      {cols.map(([h, f]) => <td key={h} style={tdCell}>{f(r)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>
    </div>
  );
}
