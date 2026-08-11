'use client';

import { useEffect, useState } from 'react';
import { getGroupsDashboard, formatNaira, type GroupsDashboard } from '@/services/groupsAdminService';
import { PageHeader, GroupsTabs, Card, Kpi, Badge, DisclosureNote, StateBlock, btn, th, td, timeAgo } from '../_ui';

export default function GroupsDashboardPage() {
  const [data, setData] = useState<GroupsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getGroupsDashboard()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Groups overview"
        subtitle="Group savings / contribution pools — pooled balances, dues collection and membership across the groups book."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <GroupsTabs active="overview" />

      <DisclosureNote>
        Read-only oversight — the groups backend exposes <strong>no admin route group</strong>; surfaces read the
        member projections at <code>/api/finance/groups</code>. Pooled balances are projections of the immutable
        double-entry ledger (NL-8).
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No dashboard data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Groups" value={data.groups_total.toLocaleString('en-NG')} sub={`${data.groups_active} active`} accent="#340075" />
              <Kpi label="Members" value={data.members_total.toLocaleString('en-NG')} />
              <Kpi label="Pooled balance" value={formatNaira(data.pooled_balance_kobo)} sub="Customer money held (NL-8)" />
              <Kpi label="Dues collected (30d)" value={formatNaira(data.dues_collected_30d_kobo)} />
              <Kpi label="Invites pending" value={data.invites_pending.toLocaleString('en-NG')} accent={data.invites_pending > 0 ? '#9a3412' : undefined} />
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
