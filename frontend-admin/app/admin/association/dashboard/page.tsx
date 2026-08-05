'use client';

import { useEffect, useState } from 'react';
import { getAssociationKpis, formatNaira, type AssociationKpis } from '@/services/associationAdminService';
import { AssociationTabs, Kpi, DisclosureNote, StateBlock, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function kindColor(kind: string) {
  if (/approved|active|paid|resolved|verified/.test(kind)) return colors.success;
  if (/rejected|suspended|failed|blocked|critical/.test(kind)) return colors.danger;
  if (/pending|flagged|review/.test(kind)) return colors.warning;
  return colors.info;
}

export default function AssociationDashboardPage() {
  const [data, setData] = useState<AssociationKpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getAssociationKpis()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <Page>
      <PageHeader
        title="Associations overview"
        subtitle="Association membership, application approvals and dues collection across the associations book."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <AssociationTabs active="overview" />

      <DisclosureNote>
        Live admin surface at <code>/api/finance/associations/admin</code>. Dues balances are projections of the
        immutable double-entry ledger (NL-8); every approval, member action and offline-payment decision is
        recorded to the immutable audit log (NL-12).
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No dashboard data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Associations" value={data.associations_total.toLocaleString('en-NG')} accent={colors.primary} />
              <Kpi label="Members" value={data.members_total.toLocaleString('en-NG')} sub={`${data.members_active} active / ${data.members_suspended} suspended`} />
              <Kpi label="Dues outstanding" value={formatNaira(data.dues_outstanding_kobo)} accent={data.dues_outstanding_kobo > 0 ? colors.warning : undefined} />
              <Kpi label="Dues collected (30d)" value={formatNaira(data.dues_collected_30d_kobo)} />
              <Kpi label="Approvals pending" value={data.approvals_pending.toLocaleString('en-NG')} accent={data.approvals_pending > 0 ? colors.warning : undefined} />
              <Kpi label="Offline payments pending" value={data.offline_payments_pending.toLocaleString('en-NG')} accent={data.offline_payments_pending > 0 ? colors.warning : undefined} />
            </div>

            <Card title="Recent activity">
              {data.activity.length === 0 ? <p style={{ color: colors.muted, marginTop: 12 }}>No recent activity.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
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
      </StateBlock>
    </Page>
  );
}
