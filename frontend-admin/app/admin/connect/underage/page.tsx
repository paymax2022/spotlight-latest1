'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { listUnderageFlags } from '@/services/connectAdminService';
import type { UnderageFlag } from '@/types/connectAdmin';
import { PageHeader, ConnectTabs, Card, Badge, btn, th, td, timeAgo } from '../_ui';

const STATUSES = ['all', 'open', 'confirmed_minor', 'cleared'];

export default function ConnectUnderagePage() {
  const [rows, setRows] = useState<UnderageFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('all');

  const filter = useMemo(() => (status === 'all' ? undefined : status), [status]);
  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listUnderageFlags(filter)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Underage flag queue" subtitle="18+ hard age gate (§11.2). Suspected-minor accounts are blocked and routed here immediately — every flag opens a case, never silent. DOB is masked." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ConnectTabs active="overview" />

      <Card>
        <label style={{ fontSize: '0.8rem', color: '#374151', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: '0.35rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem', textTransform: 'capitalize' }}>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
      </Card>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      <Card>
        {loading ? <p style={{ color: '#6b7280' }}>Loading underage queue…</p> : rows.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No underage flags in this state.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>User</th><th style={th()}>Signal</th><th style={th()}>Declared DOB (masked)</th><th style={th()}>Status</th><th style={th()}>Case</th><th style={th()}>Flagged</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><Link href={`/admin/connect/users/${r.user_id}`} style={{ color: '#1d4ed8', textDecoration: 'none' }}>{r.handle}</Link></td>
                  <td style={{ ...td(), textTransform: 'capitalize' }}>{r.signal.replace(/_/g, ' ')}</td>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.declared_dob_masked}</code></td>
                  <td style={td()}><Badge status={r.status === 'confirmed_minor' ? 'critical' : r.status === 'cleared' ? 'resolved' : 'open'} label={r.status.replace(/_/g, ' ')} /></td>
                  <td style={td()}>{r.case_id ? <Link href="/admin/connect/cases" style={{ color: '#1d4ed8', textDecoration: 'none' }}>{r.case_id}</Link> : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                  <td style={td()}>{timeAgo(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
