'use client';

import { useEffect, useState } from 'react';
import { getSprayDashboard, formatNaira, type SprayDashboard } from '@/services/sprayAdminService';
import { PageHeader, SprayTabs, Card, Kpi, Badge, DisclosureNote, StateBlock, btn, th, td, timeAgo } from '../_ui';

export default function SprayDashboardPage() {
  const [data, setData] = useState<SprayDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getSprayDashboard()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Spray overview"
        subtitle="Event money-spraying — volume, unique sprayers and AML oversight across spray contexts."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <SprayTabs active="overview" />

      <DisclosureNote>
        Thin admin surface — the only backend admin route is the per-event <strong>leaderboard</strong>
        (<code>/api/spray/admin/spray/leaderboard/:contextRef</code>, RBAC <code>spray.read</code>) for AML oversight.
        Spray enforces single / daily-amount / daily-count AML limits server-side. Payout settlement is not yet
        exposed on the backend admin surface (mock view).
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No dashboard data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Events" value={data.events_total.toLocaleString('en-NG')} sub={`${data.events_live} live`} accent="#340075" />
              <Kpi label="Sprays (30d)" value={data.sprays_30d.toLocaleString('en-NG')} />
              <Kpi label="Spray volume (30d)" value={formatNaira(data.spray_volume_30d_kobo)} />
              <Kpi label="Unique sprayers (30d)" value={data.unique_sprayers_30d.toLocaleString('en-NG')} />
              <Kpi label="AML flags (30d)" value={data.aml_flags_30d.toLocaleString('en-NG')} accent={data.aml_flags_30d > 0 ? '#b91c1c' : undefined} />
              <Kpi label="Payouts pending" value={data.payouts_pending.toLocaleString('en-NG')} sub={formatNaira(data.payouts_pending_kobo)} accent={data.payouts_pending > 0 ? '#9a3412' : undefined} />
            </div>

            <Card title="Recent activity">
              {data.activity.length === 0 ? <p style={{ color: '#6b7280' }}>No recent activity.</p> : (
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
      </StateBlock>
    </div>
  );
}
