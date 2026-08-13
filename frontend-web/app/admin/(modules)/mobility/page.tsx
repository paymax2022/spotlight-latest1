'use client';

import { useEffect, useState } from 'react';
import { getDashboard } from '@/services/mobilityAdminService';
import type { MobilityDashboard } from '@/types/mobility';
import { PageHeader, MobilityTabs, Card, Kpi, StateNote, btn, naira } from './_ui';
import { colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function MobilityDashboardPage() {
  const [data, setData] = useState<MobilityDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getDashboard()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Mobility — Executive Dashboard"
        subtitle="Ride-hailing health: trips, GBV, revenue, driver earnings and safety at a glance."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <MobilityTabs active="dashboard" />

      {error && <StateNote kind="error">Failed to load dashboard: {error}</StateNote>}
      {loading && !data ? (
        <StateNote kind="loading">Loading dashboard…</StateNote>
      ) : !data ? (
        <StateNote kind="empty">No dashboard data available.</StateNote>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <Kpi label="Total trips" value={data.totalTrips.toLocaleString('en-NG')} sub={`${data.liveTrips} live now`} />
            <Kpi label="Gross booking value" value={naira(data.gbvKobo)} />
            <Kpi label="Platform revenue" value={naira(data.platformRevenueKobo)} accent={colors.info} />
            <Kpi label="Driver earnings" value={naira(data.driverEarningsKobo)} accent={colors.success} />
            <Kpi label="Completion rate" value={`${data.completionRate}%`} accent={colors.success} />
            <Kpi label="Cancellation rate" value={`${data.cancellationRate}%`} accent={data.cancellationRate > 10 ? colors.danger : colors.warning} />
            <Kpi label="Open safety incidents" value={String(data.openSafetyIncidents)} accent={data.openSafetyIncidents ? colors.danger : colors.success} href="/admin/mobility/safety" />
            <Kpi label="Active drivers" value={data.activeDrivers.toLocaleString('en-NG')} sub={`${data.onlineDrivers} online`} />
            <Kpi label="Pending verifications" value={String(data.pendingVerifications)} accent={colors.warning} href="/admin/mobility/drivers" />
          </div>

          <Card title="Top zones by GBV">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                  <th style={thCell}>Zone</th><th style={thCell}>Trips</th><th style={thCell}>GBV</th><th style={{ ...thCell, width: '40%' }}>Share</th>
                </tr>
              </thead>
              <tbody>
                {data.topZones.map((z) => {
                  const max = Math.max(...data.topZones.map((x) => x.gbvKobo), 1);
                  return (
                    <tr key={z.zone} style={{ borderBottom: `1px solid ${colors.border}` }}>
                      <td style={tdCell}><strong>{z.zone}</strong></td>
                      <td style={tdCell}>{z.trips.toLocaleString('en-NG')}</td>
                      <td style={tdCell}>{naira(z.gbvKobo)}</td>
                      <td style={tdCell}>
                        <div style={{ background: colors.border, borderRadius: 9999, height: 8, overflow: 'hidden' }}>
                          <div style={{ width: `${(z.gbvKobo / max) * 100}%`, height: '100%', background: colors.info, borderRadius: 9999 }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
