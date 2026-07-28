'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { listJobModeration, reviewJob } from '@/services/connectNetworkAdminService';
import type { JobPosting, ReviewAction } from '@/types/connectNetworkAdmin';
import { PageHeader, Card, Badge, btn, th, td, timeAgo } from '../_ui';

const STATUSES = ['all', 'pending', 'approved', 'rejected', 'flagged'];

export default function ConnectJobsModerationPage() {
  const [rows, setRows] = useState<JobPosting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('all');
  const [busy, setBusy] = useState<string | null>(null);

  const q = useMemo(() => (status === 'all' ? undefined : status), [status]);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await listJobModeration(q)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [q]);
  useEffect(() => { void load(); }, [load]);

  async function act(id: string, action: ReviewAction) {
    setBusy(id);
    try { await reviewJob(id, action); await load(); }
    catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Job posting moderation" subtitle="ADM-JB-01 · Approve, reject or flag Phase-6 job postings. AI reason codes shown; poster trust is a band, not a score." action={<button onClick={() => void load()} style={btn()}>Refresh</button>} />

      <Card>
        <label style={{ fontSize: '0.8rem', color: '#374151', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: '0.35rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem', textTransform: 'capitalize' }}>
            {STATUSES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
      </Card>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      <Card>
        {loading ? <p style={{ color: '#6b7280' }}>Loading postings…</p> : rows.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No job postings match this filter.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Title</th><th style={th()}>Company</th><th style={th()}>Type</th><th style={th()}>AI codes</th><th style={th()}>Poster trust</th><th style={th()}>Status</th><th style={th()}>Submitted</th><th style={th()}>Review</th></tr></thead>
            <tbody>
              {rows.map((j) => (
                <tr key={j.id}>
                  <td style={td()}><strong>{j.title}</strong><div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>{j.location}</div></td>
                  <td style={td()}>{j.companyName}</td>
                  <td style={td()}>{j.employmentType.replace(/_/g, ' ')}</td>
                  <td style={td()}>{j.aiReasonCodes.length ? <span style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>{j.aiReasonCodes.map((c) => <Badge key={c} status="high" label={c} />)}</span> : <span style={{ color: '#9ca3af' }}>none</span>}</td>
                  <td style={td()}><Badge status="normal" label={j.posterTrustBand} /></td>
                  <td style={td()}><Badge status={j.status === 'approved' ? 'resolved' : j.status === 'rejected' ? 'critical' : j.status === 'flagged' ? 'high' : 'open'} label={j.status} /></td>
                  <td style={td()}>{timeAgo(j.submittedAt)}</td>
                  <td style={td()}><ReviewButtons id={j.id} busy={busy === j.id} disabled={j.status !== 'pending' && j.status !== 'flagged'} onAct={act} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function ReviewButtons({ id, busy, disabled, onAct }: { id: string; busy: boolean; disabled?: boolean; onAct: (id: string, a: ReviewAction) => void }) {
  if (disabled) return <span style={{ color: '#9ca3af', fontSize: '0.8rem' }}>—</span>;
  return (
    <span style={{ display: 'flex', gap: '0.35rem' }}>
      <button disabled={busy} onClick={() => onAct(id, 'approve')} style={{ ...btn(), color: '#15803d', borderColor: '#bbf7d0' }}>Approve</button>
      <button disabled={busy} onClick={() => onAct(id, 'flag')} style={{ ...btn(), color: '#9a3412', borderColor: '#fed7aa' }}>Flag</button>
      <button disabled={busy} onClick={() => onAct(id, 'reject')} style={{ ...btn(), color: '#b91c1c', borderColor: '#fecaca' }}>Reject</button>
    </span>
  );
}
