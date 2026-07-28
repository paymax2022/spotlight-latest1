'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listApplications, decideApplication } from '@/services/referralAdminOpsService';
import type { AmbassadorApplication } from '@/types/referralAdminOps';
import { PageHeader, Card, Badge, btn, btnPrimary, btnDanger, th, td, timeAgo, StateBlock } from '../../_ui';

const STATUSES = ['all', 'pending', 'approved', 'rejected'];

export default function ApplicationsPage() {
  const [rows, setRows] = useState<AmbassadorApplication[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('pending');
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listApplications(status)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  async function decide(app: AmbassadorApplication, decision: 'approved' | 'rejected') {
    setBusy(app.id);
    try {
      await decideApplication(app.id, decision, `Application ${decision}`);
      setRows((cur) => (cur ?? []).map((r) => r.id === app.id ? { ...r, status: decision } : r));
    } catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Ambassadors — Application / approval queue"
        subtitle="Vet ambassador & agent applicants; KYC and reach review before approval (A-AMB-02)."
        action={<Link href="/admin/referral/ambassadors" style={{ ...btn(), textDecoration: 'none', color: '#374151' }}>← Directory</Link>}
      />

      <Card title="Applications" right={
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...btn(), cursor: 'pointer' }}>
          {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}
        </select>
      }>
        <StateBlock loading={loading} error={error} empty={!rows || rows.length === 0} emptyText="No applications.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Applicant</th><th style={th()}>Tier</th><th style={th()}>Reach</th>
              <th style={th()}>KYC</th><th style={th()}>Status</th><th style={th()}>Submitted</th><th style={th()} />
            </tr></thead>
            <tbody>
              {(rows ?? []).map((a) => (
                <tr key={a.id}>
                  <td style={td()}>{a.applicant_name}<br /><code style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{a.applicant_id}</code></td>
                  <td style={td()}>{a.requested_tier}</td>
                  <td style={td()}>{a.reach}</td>
                  <td style={td()}><Badge status={a.kyc_status === 'verified' ? 'active' : a.kyc_status === 'failed' ? 'critical' : 'pending'} label={a.kyc_status} /></td>
                  <td style={td()}><Badge status={a.status === 'approved' ? 'approved' : a.status === 'rejected' ? 'rejected' : 'pending'} label={a.status} /></td>
                  <td style={td()}>{timeAgo(a.submitted_at)}</td>
                  <td style={td()}>
                    {a.status === 'pending' ? (
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <button disabled={busy === a.id || a.kyc_status !== 'verified'} onClick={() => decide(a, 'approved')} style={btnPrimary()} title={a.kyc_status !== 'verified' ? 'KYC must be verified first' : ''}>Approve</button>
                        <button disabled={busy === a.id} onClick={() => decide(a, 'rejected')} style={btnDanger()}>Reject</button>
                      </div>
                    ) : '—'}
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
