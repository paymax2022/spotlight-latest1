'use client';

import { useEffect, useState } from 'react';
import { getReports } from '@/services/mobilityAdminService';
import type { ReportSummary } from '@/types/mobility';
import { PageHeader, MobilityTabs, Card, StateNote, Kpi, btn, naira } from '../_ui';
import { colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function MobilityReportsPage() {
  const [data, setData] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getReports()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const cancelTotal = data?.cancellation.total || 1;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Reports"
        subtitle="Revenue, commission, trip and cancellation rollups."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <MobilityTabs active="reports" />

      {error && <StateNote kind="error">Failed to load reports: {error}</StateNote>}
      {loading && !data ? <StateNote kind="loading">Loading reports…</StateNote>
        : !data ? <StateNote kind="empty">No report data.</StateNote>
        : (
          <>
            <Card title="Revenue by zone">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                    <th style={thCell}>Zone</th><th style={thCell}>Trips</th><th style={thCell}>GBV</th><th style={thCell}>Platform revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.revenueByZone.map((z) => (
                    <tr key={z.zone} style={{ borderBottom: `1px solid ${colors.border}` }}>
                      <td style={tdCell}><strong>{z.zone}</strong></td>
                      <td style={tdCell}>{z.trips.toLocaleString('en-NG')}</td>
                      <td style={tdCell}>{naira(z.gbvKobo)}</td>
                      <td style={tdCell}>{naira(z.revenueKobo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Commission by tier">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                    <th style={thCell}>Tier</th><th style={thCell}>Trips</th><th style={thCell}>Driver payout</th><th style={thCell}>Platform</th>
                  </tr>
                </thead>
                <tbody>
                  {data.commissionByTier.map((c) => (
                    <tr key={c.tier} style={{ borderBottom: `1px solid ${colors.border}` }}>
                      <td style={tdCell}><strong style={{ textTransform: 'capitalize' }}>{c.tier}</strong></td>
                      <td style={tdCell}>{c.trips.toLocaleString('en-NG')}</td>
                      <td style={tdCell}>{naira(c.driverPayoutKobo)}</td>
                      <td style={tdCell}>{naira(c.platformKobo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Trips by day">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                    <th style={thCell}>Date</th><th style={thCell}>Completed</th><th style={thCell}>Cancelled</th><th style={thCell}>GBV</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tripsByDay.map((d) => (
                    <tr key={d.date} style={{ borderBottom: `1px solid ${colors.border}` }}>
                      <td style={tdCell}>{d.date}</td>
                      <td style={tdCell}>{d.completed.toLocaleString('en-NG')}</td>
                      <td style={tdCell}>{d.cancelled.toLocaleString('en-NG')}</td>
                      <td style={tdCell}>{naira(d.gbvKobo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Cancellation breakdown">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem' }}>
                <Kpi label="By rider" value={`${data.cancellation.byRider} · ${Math.round((data.cancellation.byRider / cancelTotal) * 100)}%`} />
                <Kpi label="By driver" value={`${data.cancellation.byDriver} · ${Math.round((data.cancellation.byDriver / cancelTotal) * 100)}%`} accent={colors.warning} />
                <Kpi label="By system" value={`${data.cancellation.bySystem} · ${Math.round((data.cancellation.bySystem / cancelTotal) * 100)}%`} />
                <Kpi label="Total cancellations" value={data.cancellation.total.toLocaleString('en-NG')} accent={colors.danger} />
              </div>
            </Card>
          </>
        )}
    </div>
  );
}
