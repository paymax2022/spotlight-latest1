'use client';

import { useEffect, useState } from 'react';
import { listApprovals, decideApplication, type ApprovalRecord } from '@/services/associationAdminService';
import { AssociationTabs, DisclosureNote, StateBlock, AuditNote, OrgPicker, useSelectedOrg, fmtDate } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string) {
  if (status === 'APPROVED') return colors.success;
  if (status === 'REJECTED') return colors.danger;
  return colors.warning;
}

export default function ApprovalsPage() {
  const orgId = useSelectedOrg();
  const [rows, setRows] = useState<ApprovalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listApprovals()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orgId]);

  async function decide(a: ApprovalRecord, decision: 'approve' | 'reject') {
    const note = window.prompt(`${decision === 'approve' ? 'Approve' : 'Reject'} application from ${a.applicantName}? Optional note:`) ?? undefined;
    setBusy(a.id); setMsg(null);
    try { await decideApplication(a.id, decision, note); setMsg(`Application ${a.id}: ${decision} recorded to immutable audit (NL-12).`); await load(); }
    catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <Page>
      <PageHeader title="Membership approvals" subtitle="Review and decide pending association membership applications." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <AssociationTabs active="approvals" />
      <OrgPicker />
      <DisclosureNote>
        Each decision posts to <code>/api/finance/associations/admin/approvals/:id/decision</code> and is recorded to the
        immutable audit log (NL-12). This queue only ever holds applications still awaiting a decision — approved and
        rejected applications drop out of it once decided.
      </DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No applications awaiting decision.">
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
            <thead><tr>
              <th style={thCell}>Application</th><th style={thCell}>Applicant</th><th style={thCell}>Category</th><th style={thCell}>Chapter</th>
              <th style={thCell}>Paid</th><th style={thCell}>Submitted</th><th style={thCell}>Status</th><th style={thCell}>Action</th>
            </tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{a.id}</code></td>
                  <td style={tdCell}>{a.applicantName}</td>
                  <td style={tdCell}>{a.category || '—'}</td>
                  <td style={tdCell}>{a.chapter || '—'}</td>
                  <td style={tdCell}>{a.paid ? 'Yes' : 'No'}</td>
                  <td style={tdCell}>{fmtDate(a.submittedAt)}</td>
                  <td style={tdCell}><Badge text={a.status.replace(/_/g, ' ')} color={statusColor(a.status)} /></td>
                  <td style={tdCell}>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <Button variant="primary" sm disabled={busy === a.id} onClick={() => decide(a, 'approve')}>{busy === a.id ? '…' : 'Approve'}</Button>
                      <Button variant="danger" sm disabled={busy === a.id} onClick={() => decide(a, 'reject')}>Reject</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </Page>
  );
}
