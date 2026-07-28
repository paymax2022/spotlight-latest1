'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listMissionsAdmin, type ConnectMission } from '@/services/connectAdminOpsService';
import { PageHeader, Card, Badge, btn, th, td } from '../../_ui';

const STATUSES = ['', 'active', 'scheduled', 'ended', 'draft'];

export default function ConnectMissionsPage() {
  const [rows, setRows] = useState<ConnectMission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  async function load(status: string) {
    setLoading(true); setError(null);
    try { setRows(await listMissionsAdmin(status || undefined)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(filter); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <Link href="/admin/connect/gamification" style={{ color: '#1d4ed8', textDecoration: 'none', fontSize: '0.85rem' }}>← Gamification</Link>
      <div style={{ height: 8 }} />
      <PageHeader title="Missions / quests" subtitle="Create & edit tasks. Rewards are non-cash XP and coins only." action={<button onClick={() => load(filter)} style={btn()}>Refresh</button>} />

      <Card title="New mission (mock)">
        <p style={{ color: '#6b7280', fontSize: '0.82rem', margin: '0 0 0.75rem' }}>Form is mock-only; saving is wired to the backend in a later phase. Rewards never represent cash.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
          <Field label="Title"><input style={inputStyle} placeholder="Verified First Match" /></Field>
          <Field label="Goal"><input style={inputStyle} placeholder="Get 1 mutual match" /></Field>
          <Field label="Reward XP (non-cash)"><input style={inputStyle} type="number" placeholder="250" /></Field>
          <Field label="Reward coins (non-cash)"><input style={inputStyle} type="number" placeholder="50" /></Field>
        </div>
        <button style={{ ...btn(), marginTop: '0.75rem' }} onClick={() => alert('Mock only — wire to backend in a later phase.')}>Save mission</button>
      </Card>

      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {STATUSES.map((s) => (
          <button key={s || 'all'} onClick={() => setFilter(s)} style={{ ...btn(), background: filter === s ? '#340075' : '#fff', color: filter === s ? '#fff' : '#374151' }}>{s || 'All'}</button>
        ))}
      </div>
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <Card>
        {loading ? <p style={{ color: '#6b7280' }}>Loading missions…</p> : rows.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No missions for this filter.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Mission</th><th style={th()}>Goal</th><th style={th()}>Reward (non-cash)</th><th style={th()}>Status</th><th style={th()}>Completions</th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td style={td()}><strong>{m.title}</strong><div style={{ color: '#6b7280', fontSize: '0.78rem' }}>{m.description}</div></td>
                  <td style={td()}>{m.goal}</td>
                  <td style={td()}>{m.reward_xp} XP · {m.reward_coins} coins</td>
                  <td style={td()}><Badge status={m.status === 'active' ? 'resolved' : m.status === 'scheduled' ? 'normal' : m.status === 'draft' ? 'low' : 'closed'} label={m.status} /></td>
                  <td style={td()}>{m.completions.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

const inputStyle = { width: '100%', padding: '0.4rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem' } as const;
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block', fontSize: '0.78rem', color: '#6b7280', fontWeight: 600 }}>{label}<div style={{ marginTop: 4 }}>{children}</div></label>;
}
