'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { listIdentityReviews } from '@/services/connectAdminService';
import type { IdentityReview } from '@/types/connectAdmin';
import { PageHeader, ConnectTabs, Card, Badge, btn, th, td, timeAgo } from '../_ui';

const STATES = ['all', 'pending', 'in_review', 'approved', 'rejected', 'resubmit'];

export default function ConnectIdentityPage() {
  const [rows, setRows] = useState<IdentityReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState('all');

  const filter = useMemo(() => (state === 'all' ? undefined : state), [state]);
  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listIdentityReviews(filter)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Verification review queue" subtitle="Selfie/liveness + ID review (§11.2 AU-04). Raw verification documents are encrypted at rest and NEVER rendered inline — masked references only." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ConnectTabs active="overview" />

      <Card>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ fontSize: '0.8rem', color: '#374151', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            State
            <select value={state} onChange={(e) => setState(e.target.value)} style={{ padding: '0.35rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem', textTransform: 'capitalize' }}>
              {STATES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
          <span style={{ fontSize: '0.78rem', color: '#9ca3af' }}>PII never logged — masked doc references only.</span>
        </div>
      </Card>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      <Card>
        {loading ? <p style={{ color: '#6b7280' }}>Loading review queue…</p> : rows.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No verification reviews in this state.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>User</th><th style={th()}>Doc type</th><th style={th()}>Badge target</th><th style={th()}>Doc ref (masked)</th><th style={th()}>Liveness</th><th style={th()}>State</th><th style={th()}>Submitted</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><Link href={`/admin/connect/users/${r.user_id}`} style={{ color: '#1d4ed8', textDecoration: 'none' }}>{r.handle}</Link></td>
                  <td style={{ ...td(), textTransform: 'capitalize' }}>{r.doc_type.replace(/_/g, ' ')}</td>
                  <td style={td()}><Badge status="normal" label={r.badge_target} /></td>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.doc_ref_masked}</code></td>
                  <td style={td()}>{r.liveness_score != null ? `${Math.round(r.liveness_score * 100)}%` : '—'}</td>
                  <td style={td()}><Badge status={r.state === 'approved' ? 'resolved' : r.state === 'rejected' ? 'critical' : r.state === 'in_review' ? 'investigating' : 'open'} label={r.state.replace(/_/g, ' ')} /></td>
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
