'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { listVotingContests, formatNaira } from '@/services/connectAdminService';
import type { VotingContestSummary } from '@/types/connectAdmin';
import { PageHeader, ConnectTabs, Card, Badge, btn, th, td } from '../_ui';

const STATUSES = ['all', 'scheduled', 'live', 'closed', 'finalized'];

export default function ConnectVotingPage() {
  const [rows, setRows] = useState<VotingContestSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('all');

  const filter = useMemo(() => (status === 'all' ? undefined : status), [status]);
  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listVotingContests(filter)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Voting integrity" subtitle="Contests, paid-vote audit & integrity flags (§11.6). Paid votes are wallet money — volume in kobo → Naira." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ConnectTabs active="overview" />

      <Card>
        <label style={{ fontSize: '0.8rem', color: '#374151', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: '0.35rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem', textTransform: 'capitalize' }}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </Card>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      <Card>
        {loading ? <p style={{ color: '#6b7280' }}>Loading contests…</p> : rows.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No contests in this state.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Contest</th><th style={th()}>Status</th><th style={th()}>Paid votes</th><th style={th()}>Free votes</th><th style={th()}>Paid volume</th><th style={th()}>Integrity</th><th style={th()}>Flags</th><th style={th()}></th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td style={td()}><strong>{c.title}</strong></td>
                  <td style={td()}><Badge status={c.status === 'live' ? 'investigating' : c.status === 'finalized' ? 'resolved' : c.status === 'closed' ? 'closed' : 'normal'} label={c.status} /></td>
                  <td style={td()}>{c.paid_votes.toLocaleString('en-NG')}</td>
                  <td style={td()}>{c.free_votes.toLocaleString('en-NG')}</td>
                  <td style={td()}>{formatNaira(c.paid_vote_volume_kobo)}</td>
                  <td style={td()}><span style={{ fontWeight: 700, color: c.integrity_score >= 80 ? '#15803d' : c.integrity_score >= 60 ? '#d97706' : '#dc2626' }}>{c.integrity_score}</span></td>
                  <td style={td()}>{c.flags_open ? <Badge status="high" label={`${c.flags_open} open`} /> : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                  <td style={{ ...td(), textAlign: 'right' }}><Link href={`/admin/connect/voting/${c.id}`} style={{ color: '#1d4ed8', textDecoration: 'none', fontWeight: 600 }}>Open →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
