'use client';

import { useEffect, useState } from 'react';
import { getConnectDashboard, formatNaira } from '@/services/connectAdminService';
import type { ConnectDashboard } from '@/types/connectAdmin';
import { PageHeader, ConnectTabs, Card, Badge, btn, th, td, timeAgo } from '../_ui';

export default function ConnectDashboardPage() {
  const [data, setData] = useState<ConnectDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getConnectDashboard()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Connect dashboard" subtitle="Trust & money control-plane — KPIs, queues and critical alerts (role-scoped, §11.1)." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ConnectTabs active="overview" />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      {loading ? (
        <Card><p style={{ color: '#6b7280' }}>Loading dashboard…</p></Card>
      ) : !data ? (
        <Card><p style={{ color: '#6b7280' }}>No data available.</p></Card>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="DAU" value={data.dau.toLocaleString('en-NG')} sub={`MAU ${data.mau.toLocaleString('en-NG')}`} />
            <Kpi label="Matches today" value={data.matches_today.toLocaleString('en-NG')} />
            <Kpi label="Live sessions" value={String(data.live_sessions)} />
            <Kpi label="Gift volume (today)" value={formatNaira(data.gift_volume_today_kobo)} sub={`30d ${formatNaira(data.gift_volume_30d_kobo)}`} accent="#340075" />
            <Kpi label="Open safety cases" value={String(data.open_cases)} accent={data.open_cases ? '#9a3412' : undefined} />
            <Kpi label="AML alerts open" value={String(data.aml_alerts_open)} accent={data.aml_alerts_open ? '#b91c1c' : undefined} />
            <Kpi label="Payouts pending" value={String(data.payouts_pending)} />
            <Kpi label="Identity queue" value={String(data.identity_queue)} />
            <Kpi label="Underage queue" value={String(data.underage_queue)} accent={data.underage_queue ? '#b91c1c' : undefined} />
            <Kpi label="Media review" value={String(data.media_queue)} />
          </div>

          <Card title="Recent activity">
            {data.activity.length === 0 ? (
              <p style={{ color: '#6b7280' }}>No recent activity.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Event</th><th style={th()}>Type</th><th style={th()}>Ref</th><th style={th()}>When</th></tr></thead>
                <tbody>
                  {data.activity.map((a) => (
                    <tr key={a.id}>
                      <td style={td()}>{a.label}</td>
                      <td style={td()}><Badge status={a.kind} label={a.kind.replace(/_/g, ' ')} /></td>
                      <td style={td()}><code style={{ fontSize: '0.78rem' }}>{a.ref ?? '—'}</code></td>
                      <td style={td()}>{timeAgo(a.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.85rem 1rem', background: '#fff' }}>
      <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3, color: '#6b7280', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: '0.25rem', color: accent ?? '#111827' }}>{value}</div>
      {sub ? <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.15rem' }}>{sub}</div> : null}
    </div>
  );
}
