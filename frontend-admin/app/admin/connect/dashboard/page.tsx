'use client';

import { useEffect, useState } from 'react';
import { getConnectDashboard, formatNaira } from '@/services/connectAdminService';
import type { ConnectDashboard } from '@/types/connectAdmin';
import { ConnectTabs, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function kindColor(kind: string): string {
  if (kind === 'resolved' || kind === 'closed') return colors.success;
  if (kind === 'critical') return colors.danger;
  if (kind === 'high' || kind === 'open') return colors.warning;
  return colors.info;
}

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
    <Page>
      <PageHeader title="Connect dashboard" subtitle="Trust & money control-plane — KPIs, queues and critical alerts (role-scoped, §11.1)." actions={<Button variant="outline" sm onClick={load}>Refresh</Button>} />
      <ConnectTabs active="overview" />
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      {loading ? (
        <Card><p style={{ color: colors.muted }}>Loading dashboard…</p></Card>
      ) : !data ? (
        <Card><p style={{ color: colors.muted }}>No data available.</p></Card>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="DAU" value={data.dau.toLocaleString('en-NG')} sub={`MAU ${data.mau.toLocaleString('en-NG')}`} />
            <Kpi label="Matches today" value={data.matches_today.toLocaleString('en-NG')} />
            <Kpi label="Live sessions" value={String(data.live_sessions)} />
            <Kpi label="Gift volume (today)" value={formatNaira(data.gift_volume_today_kobo)} sub={`30d ${formatNaira(data.gift_volume_30d_kobo)}`} accent={colors.primary} />
            <Kpi label="Open safety cases" value={String(data.open_cases)} accent={data.open_cases ? colors.warning : undefined} />
            <Kpi label="AML alerts open" value={String(data.aml_alerts_open)} accent={data.aml_alerts_open ? colors.danger : undefined} />
            <Kpi label="Payouts pending" value={String(data.payouts_pending)} />
            <Kpi label="Identity queue" value={String(data.identity_queue)} />
            <Kpi label="Underage queue" value={String(data.underage_queue)} accent={data.underage_queue ? colors.danger : undefined} />
            <Kpi label="Media review" value={String(data.media_queue)} />
          </div>

          <Card title="Recent activity">
            {data.activity.length === 0 ? (
              <p style={{ color: colors.muted }}>No recent activity.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
                <thead><tr><th style={thCell}>Event</th><th style={thCell}>Type</th><th style={thCell}>Ref</th><th style={thCell}>When</th></tr></thead>
                <tbody>
                  {data.activity.map((a) => (
                    <tr key={a.id}>
                      <td style={tdCell}>{a.label}</td>
                      <td style={tdCell}><Badge text={a.kind.replace(/_/g, ' ')} color={kindColor(a.kind)} /></td>
                      <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{a.ref ?? '—'}</code></td>
                      <td style={tdCell}>{timeAgo(a.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '0.85rem 1rem', background: colors.card }}>
      <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: '0.25rem', color: accent ?? colors.text }}>{value}</div>
      {sub ? <div style={{ fontSize: '0.75rem', color: colors.muted, marginTop: '0.15rem' }}>{sub}</div> : null}
    </div>
  );
}
