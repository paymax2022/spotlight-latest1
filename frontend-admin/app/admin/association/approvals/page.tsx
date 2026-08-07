'use client';

import { useEffect, useState } from 'react';
import { listApprovals, decideApplication, type ApprovalRecord } from '@/services/associationAdminService';
import { AssociationTabs, DisclosureNote, StateBlock, FilterBar, AuditNote, fmtDate } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string) {
  if (status === 'approved') return colors.success;
  if (status === 'rejected') return colors.danger;
  return colors.warning;
}

export default function ApprovalsPage() {
  const [rows, setRows] = useState<ApprovalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('pending');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listApprovals({ status: status || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  async function decide(a: ApprovalRecord, decision: 'approve' | 'reject') {
    const note = window.prompt(`${decision === 'approve' ? 'Approve' : 'Reject'} application for ${a.applicant_masked} (${a.association_name})? Optional note:`) ?? undefined;
    setBusy(a.id); setMsg(null);
    try { const res = await decideApplication(a.id, decision, note); setMsg(`${res.message} (audit ${res.audit_id})`); await load(); }
    catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <Page>
      <PageHeader title="Membership approvals" subtitle="Review and decide pending association membership applications." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <AssociationTabs active="approvals" />
      <DisclosureNote>Each decision posts to <code>/api/finance/associations/admin/approvals/:id/decision</code> and is recorded to the immutable audit log (NL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' }}>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No applications match.">
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
            <thead><tr>
              <th style={thCell}>Application</th><th style={thCell}>Association</th><th style={thCell}>Applicant</th><th style={thCell}>Tier</th>
              <th style={thCell}>Submitted</th><th style={thCell}>Status</th><th style={thCell}>Action</th>
            </tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{a.id}</code></td>
                  <td style={tdCell}>{a.association_name}</td>
                  <td style={tdCell}>{a.applicant_masked}</td>
                  <td style={tdCell}>{a.membership_tier}</td>
                  <td style={tdCell}>{fmtDate(a.submitted_at)}</td>
                  <td style={tdCell}><Badge text={a.status} color={statusColor(a.status)} /></td>
                  <td style={tdCell}>
                    {a.status === 'pending' ? (
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <Button variant="primary" sm disabled={busy === a.id} onClick={() => decide(a, 'approve')}>{busy === a.id ? '…' : 'Approve'}</Button>
                        <Button variant="danger" sm disabled={busy === a.id} onClick={() => decide(a, 'reject')}>Reject</Button>
                      </div>
                    ) : <span style={{ color: colors.muted, fontSize: '0.78rem' }}>—</span>}
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
