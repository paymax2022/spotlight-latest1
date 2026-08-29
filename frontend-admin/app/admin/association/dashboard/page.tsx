'use client';

import { useEffect, useState } from 'react';
import { getAssociationKpis, listAuditLog, formatNaira, type AssociationKpis, type AuditLogEntry } from '@/services/associationAdminService';
import { AssociationTabs, Kpi, DisclosureNote, StateBlock, OrgPicker, useSelectedOrg, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function actionColor(action: string) {
  if (/approve|activate|restore|publish/.test(action)) return colors.success;
  if (/reject|suspend|remove/.test(action)) return colors.danger;
  return colors.info;
}

export default function AssociationDashboardPage() {
  const orgId = useSelectedOrg();
  const [data, setData] = useState<AssociationKpis | null>(null);
  const [activity, setActivity] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [kpis, log] = await Promise.all([getAssociationKpis(), listAuditLog()]);
      setData(kpis); setActivity(log.slice(0, 10));
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orgId]);

  return (
    <Page>
      <PageHeader
        title="Associations overview"
        subtitle="Association membership, application approvals and dues collection for the selected organisation."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <AssociationTabs active="overview" />
      <OrgPicker />

      <DisclosureNote>
        Live admin surface at <code>/api/finance/associations/admin</code>. Dues balances are projections of the
        immutable double-entry ledger (NL-8); every approval, member action and offline-payment decision is
        recorded to the immutable audit log (NL-12).
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="Select an organisation above to see its dashboard.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Total members" value={data.totalMembers.toLocaleString('en-NG')} accent={colors.primary} />
              <Kpi label="Active members" value={data.activeMembers.toLocaleString('en-NG')} />
              <Kpi label="Unpaid members" value={data.unpaidMembers.toLocaleString('en-NG')} accent={data.unpaidMembers > 0 ? colors.warning : undefined} />
              <Kpi label="Dues outstanding" value={formatNaira(data.duesOutstandingKobo)} accent={data.duesOutstandingKobo > 0 ? colors.warning : undefined} />
              <Kpi label="Dues collected" value={formatNaira(data.duesCollectedKobo)} />
              <Kpi label="Approvals pending" value={data.pendingApprovals.toLocaleString('en-NG')} accent={data.pendingApprovals > 0 ? colors.warning : undefined} />
            </div>

            <Card title="Recent audit activity">
              {activity.length === 0 ? <p style={{ color: colors.muted, marginTop: 12 }}>No recent activity.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
                  <thead><tr><th style={thCell}>Action</th><th style={thCell}>Subject</th><th style={thCell}>When</th></tr></thead>
                  <tbody>
                    {activity.map((a) => (
                      <tr key={a.id}>
                        <td style={tdCell}><Badge text={a.action.replace(/_/g, ' ')} color={actionColor(a.action)} /></td>
                        <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{a.subjectType || '—'} {a.subjectId ? `· ${a.subjectId}` : ''}</code></td>
                        <td style={tdCell}>{timeAgo(a.createdAt)}</td>
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
