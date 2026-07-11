'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { listContentReports, moderatePost } from '@/services/connectNetworkAdminService';
import type { ContentReport, ReviewAction } from '@/types/connectNetworkAdmin';
import { PageHeader, Card, Badge, btn, th, td, timeAgo } from '../_ui';

const STATUSES = ['all', 'open', 'reviewing', 'actioned', 'dismissed'];

export default function ConnectContentModerationPage() {
  const [rows, setRows] = useState<ContentReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('all');
  const [busy, setBusy] = useState<string | null>(null);

  const q = useMemo(() => (status === 'all' ? undefined : status), [status]);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await listContentReports(q)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [q]);
  useEffect(() => { void load(); }, [load]);

  async function act(r: ContentReport, action: ReviewAction) {
    setBusy(r.id);
    try { await moderatePost(r.postId, action); await load(); }
    catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Content moderation queue" subtitle="ADM-CN-01 · Reported posts & comments. Action routes to POST /networking/posts/:id/moderation." action={<button onClick={() => void load()} style={btn()}>Refresh</button>} />

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
        {loading ? <p style={{ color: '#6b7280' }}>Loading reports…</p> : rows.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No content reports match this filter.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Type</th><th style={th()}>Reason</th><th style={th()}>AI codes</th><th style={th()}>Author</th><th style={th()}>Reporter</th><th style={th()}>Status</th><th style={th()}>When</th><th style={th()}>Moderate</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><Badge status="normal" label={r.contentType} /><div style={{ color: '#9ca3af', fontSize: '0.72rem', marginTop: 2 }}>{r.contentId}</div></td>
                  <td style={td()}>{r.reason}</td>
                  <td style={td()}>{r.aiReasonCodes.length ? <span style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>{r.aiReasonCodes.map((c) => <Badge key={c} status="high" label={c} />)}</span> : <span style={{ color: '#9ca3af' }}>none</span>}</td>
                  <td style={td()}>{r.authorId}</td>
                  <td style={td()}>{r.reporterId ?? 'system / AI'}</td>
                  <td style={td()}><Badge status={r.status === 'actioned' ? 'resolved' : r.status === 'dismissed' ? 'closed' : r.status === 'reviewing' ? 'investigating' : 'open'} label={r.status} /></td>
                  <td style={td()}>{timeAgo(r.createdAt)}</td>
                  <td style={td()}>{r.status === 'open' || r.status === 'reviewing' ? (
                    <span style={{ display: 'flex', gap: '0.35rem' }}>
                      <button disabled={busy === r.id} onClick={() => act(r, 'reject')} style={{ ...btn(), color: '#b91c1c', borderColor: '#fecaca' }}>Take down</button>
                      <button disabled={busy === r.id} onClick={() => act(r, 'flag')} style={{ ...btn(), color: '#9a3412', borderColor: '#fed7aa' }}>Escalate</button>
                      <button disabled={busy === r.id} onClick={() => act(r, 'approve')} style={{ ...btn(), color: '#15803d', borderColor: '#bbf7d0' }}>Dismiss</button>
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
