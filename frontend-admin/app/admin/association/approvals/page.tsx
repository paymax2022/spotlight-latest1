'use client';

import { useEffect, useState } from 'react';
import { listApprovals, decideApplication, type ApprovalRecord } from '@/services/associationAdminService';
import { PageHeader, AssociationTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, AuditNote, btn, btnPrimary, btnDanger, th, td, label, select, fmtDate } from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Membership approvals" subtitle="Review and decide pending association membership applications." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <AssociationTabs active="approvals" />
      <DisclosureNote>Each decision posts to <code>/api/finance/associations/admin/approvals/:id/decision</code> and is recorded to the immutable audit log (NL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No applications match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Application</th><th style={th()}>Association</th><th style={th()}>Applicant</th><th style={th()}>Tier</th>
              <th style={th()}>Submitted</th><th style={th()}>Status</th><th style={th()}>Action</th>
            </tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{a.id}</code></td>
                  <td style={td()}>{a.association_name}</td>
                  <td style={td()}>{a.applicant_masked}</td>
                  <td style={td()}>{a.membership_tier}</td>
                  <td style={td()}>{fmtDate(a.submitted_at)}</td>
                  <td style={td()}><Badge status={a.status} /></td>
                  <td style={td()}>
                    {a.status === 'pending' ? (
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <button style={btnPrimary()} disabled={busy === a.id} onClick={() => decide(a, 'approve')}>{busy === a.id ? '…' : 'Approve'}</button>
                        <button style={btnDanger()} disabled={busy === a.id} onClick={() => decide(a, 'reject')}>Reject</button>
                      </div>
                    ) : <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
