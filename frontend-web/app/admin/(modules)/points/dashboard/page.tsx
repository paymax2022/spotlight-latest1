'use client';

import { useEffect, useState } from 'react';
import { getPointsDashboard, type PointsDashboard } from '@/services/pointsAdminService';
import { PageHeader, PointsTabs, Card, Kpi, Badge, DisclosureNote, StateBlock, btn, th, td, timeAgo } from '../_ui';

const num = (n: number) => n.toLocaleString('en-NG');

export default function PointsDashboardPage() {
  const [data, setData] = useState<PointsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getPointsDashboard()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Points overview"
        subtitle="Loyalty points liability, earn / redeem flow and the points ledger across the member base."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <PointsTabs active="overview" />

      <DisclosureNote>
        Thin admin surface — points are administered via the loyalty admin group. The live admin route is a member
        membership lookup (<code>/api/loyalty/admin/loyalty/memberships/:userId</code>, RBAC <code>loyalty.read</code>),
        surfaced on the Balances tab. The points ledger is <strong>append-only</strong> — points accrue only as a
        side effect of live-module actions, never via a self-award endpoint (NL-4).
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No dashboard data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Members" value={num(data.members_total)} accent="#340075" />
              <Kpi label="Points in circulation" value={num(data.points_in_circulation)} sub="Outstanding liability" />
              <Kpi label="Points earned (30d)" value={num(data.points_earned_30d)} />
              <Kpi label="Points redeemed (30d)" value={num(data.points_redeemed_30d)} />
              <Kpi label="Redemptions (30d)" value={num(data.redemptions_30d)} />
              <Kpi label="Catalog items" value={num(data.catalog_items)} />
            </div>

            <Card title="Recent activity">
              {data.activity.length === 0 ? <p style={{ color: '#6b7280' }}>No recent activity.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th()}>Event</th><th style={th()}>Type</th><th style={th()}>Ref</th><th style={th()}>When</th></tr></thead>
                  <tbody>
                    {data.activity.map((a) => (
                      <tr key={a.id}>
                        <td style={td()}>{a.label}</td>
                        <td style={td()}><Badge status={a.kind} label={a.kind} /></td>
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
