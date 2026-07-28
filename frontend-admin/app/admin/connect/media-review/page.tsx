'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { listMediaReview } from '@/services/connectAdminService';
import type { MediaReviewItem } from '@/types/connectAdmin';
import { PageHeader, ConnectTabs, Card, Badge, btn, th, td, timeAgo } from '../_ui';

const STATES = ['all', 'pending', 'approved', 'rejected'];

export default function ConnectMediaReviewPage() {
  const [rows, setRows] = useState<MediaReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState('all');

  const filter = useMemo(() => (state === 'all' ? undefined : state), [state]);
  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listMediaReview(filter)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Media review" subtitle="Media is moderated BEFORE public visibility (§11.4 AM-09). AI reason codes shown; raw media is not rendered inline." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ConnectTabs active="cases" />

      <Card>
        <label style={{ fontSize: '0.8rem', color: '#374151', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          State
          <select value={state} onChange={(e) => setState(e.target.value)} style={{ padding: '0.35rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem', textTransform: 'capitalize' }}>
            {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </Card>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      <Card>
        {loading ? <p style={{ color: '#6b7280' }}>Loading media queue…</p> : rows.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No media items in this state.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>User</th><th style={th()}>Media</th><th style={th()}>AI reason codes</th><th style={th()}>AI confidence</th><th style={th()}>State</th><th style={th()}>Submitted</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><Link href={`/admin/connect/users/${r.user_id}`} style={{ color: '#1d4ed8', textDecoration: 'none' }}>{r.handle}</Link></td>
                  <td style={{ ...td(), textTransform: 'capitalize' }}>{r.media_kind.replace(/_/g, ' ')}</td>
                  <td style={td()}>{r.ai_reason_codes.length ? r.ai_reason_codes.map((c) => <Badge key={c} status="high" label={c} />) : <span style={{ color: '#9ca3af' }}>clean</span>}</td>
                  <td style={td()}>{Math.round(r.ai_confidence * 100)}%</td>
                  <td style={td()}><Badge status={r.state === 'approved' ? 'resolved' : r.state === 'rejected' ? 'critical' : 'open'} label={r.state} /></td>
                  <td style={td()}>{timeAgo(r.submitted_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
