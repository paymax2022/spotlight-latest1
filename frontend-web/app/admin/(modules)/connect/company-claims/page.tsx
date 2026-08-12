'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { listCompanyClaims, reviewCompanyClaim } from '@/services/connectNetworkAdminService';
import type { CompanyPageClaim, ReviewAction } from '@/types/connectNetworkAdmin';
import { timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES = ['all', 'claim_submitted', 'under_review', 'approved', 'rejected'];

function statusColor(status: string): string {
  if (status === 'approved') return colors.success;
  if (status === 'rejected') return colors.danger;
  if (status === 'under_review') return colors.info;
  return colors.warning;
}

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
    <Page>
      <PageHeader title="Company page claim review" subtitle="ADM-CP-01 · Approve or reject page-ownership claims. Evidence is a vault pointer — raw documents are not rendered." actions={<Button variant="outline" sm onClick={() => void load()}>Refresh</Button>} />

      <Card style={{ marginBottom: 16 }}>
        <label style={{ fontSize: '0.8rem', color: colors.text, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: '0.35rem 0.5rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', fontSize: '0.85rem', textTransform: 'capitalize' }}>
            {STATUSES.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
      </Card>

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      <Card style={{ padding: 0, overflow: 'auto' }}>
        {loading ? <p style={{ color: colors.muted, padding: 14 }}>Loading claims…</p> : rows.length === 0 ? (
          <p style={{ color: colors.muted, padding: 14 }}>No claims match this filter.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Company</th><th style={thCell}>Claimant</th><th style={thCell}>Domain</th><th style={thCell}>Evidence</th><th style={thCell}>Status</th><th style={thCell}>Submitted</th><th style={thCell}>Review</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td style={tdCell}><strong>{c.companyName}</strong><div style={{ color: colors.muted, fontSize: '0.72rem' }}>{c.companyPageId}</div></td>
                  <td style={tdCell}>{c.claimantHandle}<div style={{ color: colors.muted, fontSize: '0.72rem' }}>{c.claimantId}</div></td>
                  <td style={tdCell}><Badge text={c.domainVerified ? 'verified' : 'unverified'} color={c.domainVerified ? colors.success : colors.warning} /></td>
                  <td style={tdCell}><code style={{ fontSize: '0.75rem' }}>{c.evidenceRef}</code></td>
                  <td style={tdCell}><Badge text={c.status.replace(/_/g, ' ')} color={statusColor(c.status)} /></td>
                  <td style={tdCell}>{timeAgo(c.submittedAt)}</td>
                  <td style={tdCell}>{c.status === 'claim_submitted' || c.status === 'under_review' ? (
                    <span style={{ display: 'flex', gap: '0.35rem' }}>
                      <Button variant="outline" sm disabled={busy === c.id} onClick={() => act(c.id, 'approve')} style={{ color: colors.success, borderColor: colors.success }}>Approve</Button>
                      <Button variant="danger" sm disabled={busy === c.id} onClick={() => act(c.id, 'reject')}>Reject</Button>
                    </span>
                  ) : <span style={{ color: colors.muted, fontSize: '0.8rem' }}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
