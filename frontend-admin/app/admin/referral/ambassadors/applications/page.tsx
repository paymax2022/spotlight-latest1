'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listApplications, decideApplication } from '@/services/referralAdminOpsService';
import type { AmbassadorApplication } from '@/types/referralAdminOps';
import { timeAgo } from '../../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader
        title="Ambassadors — Application / approval queue"
        subtitle="Vet ambassador & agent applicants; KYC and reach review before approval (A-AMB-02)."
        actions={<Link href="/admin/referral/ambassadors"><Button variant="outline">← Directory</Button></Link>}
      />

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '14px 14px 0' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Applications</h2>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}
          </select>
        </div>

        {loading ? (
          <p style={{ color: colors.muted, fontSize: 13, padding: 14 }}>Loading…</p>
        ) : error ? (
          <p style={{ color: colors.danger, fontSize: 13, padding: 14 }}>{error}</p>
        ) : !rows || rows.length === 0 ? (
          <p style={{ color: colors.muted, fontSize: 13, padding: 14 }}>No applications.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 14 }}>
            <thead><tr>
              <th style={thCell}>Applicant</th><th style={thCell}>Tier</th><th style={thCell}>Reach</th>
              <th style={thCell}>KYC</th><th style={thCell}>Status</th><th style={thCell}>Submitted</th><th style={thCell} />
            </tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td style={tdCell}>{a.applicant_name}<br /><code style={{ fontSize: '0.72rem', color: colors.muted }}>{a.applicant_id}</code></td>
                  <td style={tdCell}>{a.requested_tier}</td>
                  <td style={tdCell}>{a.reach}</td>
                  <td style={tdCell}><Badge text={a.kyc_status} color={a.kyc_status === 'verified' ? colors.success : a.kyc_status === 'failed' ? colors.danger : colors.warning} /></td>
                  <td style={tdCell}><Badge text={a.status} color={a.status === 'approved' ? colors.success : a.status === 'rejected' ? colors.danger : colors.warning} /></td>
                  <td style={tdCell}>{timeAgo(a.submitted_at)}</td>
                  <td style={tdCell}>
                    {a.status === 'pending' ? (
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <Button variant="primary" sm disabled={busy === a.id || a.kyc_status !== 'verified'} onClick={() => decide(a, 'approved')} title={a.kyc_status !== 'verified' ? 'KYC must be verified first' : ''}>Approve</Button>
                        <Button variant="danger" sm disabled={busy === a.id} onClick={() => decide(a, 'rejected')}>Reject</Button>
                      </div>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
