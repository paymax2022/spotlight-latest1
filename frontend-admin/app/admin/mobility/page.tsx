'use client';

import { useEffect, useState } from 'react';
import { getDashboard } from '@/services/mobilityAdminService';
import type { MobilityDashboard } from '@/types/mobility';
import { PageHeader, MobilityTabs, Card, Kpi, StateNote, btn, th, td, naira } from './_ui';

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
            <Kpi label="Platform revenue" value={naira(data.platformRevenueKobo)} accent="#1d4ed8" />
            <Kpi label="Driver earnings" value={naira(data.driverEarningsKobo)} accent="#16a34a" />
            <Kpi label="Completion rate" value={`${data.completionRate}%`} accent="#16a34a" />
            <Kpi label="Cancellation rate" value={`${data.cancellationRate}%`} accent={data.cancellationRate > 10 ? '#dc2626' : '#d97706'} />
            <Kpi label="Open safety incidents" value={String(data.openSafetyIncidents)} accent={data.openSafetyIncidents ? '#dc2626' : '#16a34a'} href="/admin/mobility/safety" />
            <Kpi label="Active drivers" value={data.activeDrivers.toLocaleString('en-NG')} sub={`${data.onlineDrivers} online`} />
            <Kpi label="Pending verifications" value={String(data.pendingVerifications)} accent="#d97706" href="/admin/mobility/drivers" />
          </div>

          <Card title="Top zones by GBV">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={th()}>Zone</th><th style={th()}>Trips</th><th style={th()}>GBV</th><th style={{ ...th(), width: '40%' }}>Share</th>
                </tr>
              </thead>
              <tbody>
                {data.topZones.map((z) => {
                  const max = Math.max(...data.topZones.map((x) => x.gbvKobo), 1);
                  return (
                    <tr key={z.zone} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={td()}><strong>{z.zone}</strong></td>
                      <td style={td()}>{z.trips.toLocaleString('en-NG')}</td>
                      <td style={td()}>{naira(z.gbvKobo)}</td>
                      <td style={td()}>
                        <div style={{ background: '#f3f4f6', borderRadius: 9999, height: 8, overflow: 'hidden' }}>
                          <div style={{ width: `${(z.gbvKobo / max) * 100}%`, height: '100%', background: '#1d4ed8', borderRadius: 9999 }} />
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
