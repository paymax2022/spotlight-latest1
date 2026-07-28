'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { listCompanyClaims, reviewCompanyClaim } from '@/services/connectNetworkAdminService';
import type { CompanyPageClaim, ReviewAction } from '@/types/connectNetworkAdmin';
import { PageHeader, Card, Badge, btn, th, td, timeAgo } from '../_ui';

const STATUSES = ['all', 'claim_submitted', 'under_review', 'approved', 'rejected'];

export default function ConnectCompanyClaimsPage() {
  const [rows, setRows] = useState<CompanyPageClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('all');
  const [busy, setBusy] = useState<string | null>(null);

  const q = useMemo(() => (status === 'all' ? undefined : status), [status]);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await listCompanyClaims(q)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [q]);
  useEffect(() => { void load(); }, [load]);

  async function act(id: string, action: ReviewAction) {
    setBusy(id);
    try { await reviewCompanyClaim(id, action); await load(); }
    catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Company page claim review" subtitle="ADM-CP-01 · Approve or reject page-ownership claims. Evidence is a vault pointer — raw documents are not rendered." action={<button onClick={() => void load()} style={btn()}>Refresh</button>} />

      <Card>
        <label style={{ fontSize: '0.8rem', color: '#374151', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: '0.35rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem', textTransform: 'capitalize' }}>
            {STATUSES.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
      </Card>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      <Card>
        {loading ? <p style={{ color: '#6b7280' }}>Loading claims…</p> : rows.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No claims match this filter.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Company</th><th style={th()}>Claimant</th><th style={th()}>Domain</th><th style={th()}>Evidence</th><th style={th()}>Status</th><th style={th()}>Submitted</th><th style={th()}>Review</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td style={td()}><strong>{c.companyName}</strong><div style={{ color: '#9ca3af', fontSize: '0.72rem' }}>{c.companyPageId}</div></td>
                  <td style={td()}>{c.claimantHandle}<div style={{ color: '#9ca3af', fontSize: '0.72rem' }}>{c.claimantId}</div></td>
                  <td style={td()}><Badge status={c.domainVerified ? 'resolved' : 'high'} label={c.domainVerified ? 'verified' : 'unverified'} /></td>
                  <td style={td()}><code style={{ fontSize: '0.75rem' }}>{c.evidenceRef}</code></td>
                  <td style={td()}><Badge status={c.status === 'approved' ? 'resolved' : c.status === 'rejected' ? 'critical' : c.status === 'under_review' ? 'investigating' : 'open'} label={c.status.replace(/_/g, ' ')} /></td>
                  <td style={td()}>{timeAgo(c.submittedAt)}</td>
                  <td style={td()}>{c.status === 'claim_submitted' || c.status === 'under_review' ? (
                    <span style={{ display: 'flex', gap: '0.35rem' }}>
                      <button disabled={busy === c.id} onClick={() => act(c.id, 'approve')} style={{ ...btn(), color: '#15803d', borderColor: '#bbf7d0' }}>Approve</button>
                      <button disabled={busy === c.id} onClick={() => act(c.id, 'reject')} style={{ ...btn(), color: '#b91c1c', borderColor: '#fecaca' }}>Reject</button>
                    </span>
                  ) : <span style={{ color: '#9ca3af', fontSize: '0.8rem' }}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
