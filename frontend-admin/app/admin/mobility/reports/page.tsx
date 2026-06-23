'use client';

import { useEffect, useState } from 'react';
import { getReports } from '@/services/mobilityAdminService';
import type { ReportSummary } from '@/types/mobility';
import { PageHeader, MobilityTabs, Card, StateNote, Kpi, btn, th, td, naira } from '../_ui';

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
                  <tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                    <th style={th()}>Zone</th><th style={th()}>Trips</th><th style={th()}>GBV</th><th style={th()}>Platform revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.revenueByZone.map((z) => (
                    <tr key={z.zone} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={td()}><strong>{z.zone}</strong></td>
                      <td style={td()}>{z.trips.toLocaleString('en-NG')}</td>
                      <td style={td()}>{naira(z.gbvKobo)}</td>
                      <td style={td()}>{naira(z.revenueKobo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Commission by tier">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                    <th style={th()}>Tier</th><th style={th()}>Trips</th><th style={th()}>Driver payout</th><th style={th()}>Platform</th>
                  </tr>
                </thead>
                <tbody>
                  {data.commissionByTier.map((c) => (
                    <tr key={c.tier} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={td()}><strong style={{ textTransform: 'capitalize' }}>{c.tier}</strong></td>
                      <td style={td()}>{c.trips.toLocaleString('en-NG')}</td>
                      <td style={td()}>{naira(c.driverPayoutKobo)}</td>
                      <td style={td()}>{naira(c.platformKobo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Trips by day">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                    <th style={th()}>Date</th><th style={th()}>Completed</th><th style={th()}>Cancelled</th><th style={th()}>GBV</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tripsByDay.map((d) => (
                    <tr key={d.date} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={td()}>{d.date}</td>
                      <td style={td()}>{d.completed.toLocaleString('en-NG')}</td>
                      <td style={td()}>{d.cancelled.toLocaleString('en-NG')}</td>
                      <td style={td()}>{naira(d.gbvKobo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Cancellation breakdown">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem' }}>
                <Kpi label="By rider" value={`${data.cancellation.byRider} · ${Math.round((data.cancellation.byRider / cancelTotal) * 100)}%`} />
                <Kpi label="By driver" value={`${data.cancellation.byDriver} · ${Math.round((data.cancellation.byDriver / cancelTotal) * 100)}%`} accent="#d97706" />
                <Kpi label="By system" value={`${data.cancellation.bySystem} · ${Math.round((data.cancellation.bySystem / cancelTotal) * 100)}%`} />
                <Kpi label="Total cancellations" value={data.cancellation.total.toLocaleString('en-NG')} accent="#dc2626" />
              </div>
            </Card>
          </>
        )}
    </div>
  );
}
