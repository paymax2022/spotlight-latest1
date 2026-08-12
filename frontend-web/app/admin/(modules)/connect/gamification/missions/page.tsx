'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listMissionsAdmin, type ConnectMission } from '@/services/connectAdminOpsService';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

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
    <Page>
      <Link href="/admin/connect/gamification" style={{ color: colors.info, textDecoration: 'none', fontSize: '0.85rem' }}>← Gamification</Link>
      <div style={{ height: 8 }} />
      <PageHeader title="Missions / quests" subtitle="Create & edit tasks. Rewards are non-cash XP and coins only." actions={<Button variant="outline" sm onClick={() => load(filter)}>Refresh</Button>} />

      <Card title="New mission (mock)">
        <p style={{ color: colors.muted, fontSize: '0.82rem', margin: '0 0 0.75rem' }}>Form is mock-only; saving is wired to the backend in a later phase. Rewards never represent cash.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
          <Field label="Title"><Input placeholder="Verified First Match" /></Field>
          <Field label="Goal"><Input placeholder="Get 1 mutual match" /></Field>
          <Field label="Reward XP (non-cash)"><Input type="number" placeholder="250" /></Field>
          <Field label="Reward coins (non-cash)"><Input type="number" placeholder="50" /></Field>
        </div>
        <Button variant="primary" style={{ marginTop: '0.75rem' }} onClick={() => alert('Mock only — wire to backend in a later phase.')}>Save mission</Button>
      </Card>

      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {STATUSES.map((s) => (
          <Button key={s || 'all'} variant={filter === s ? 'primary' : 'outline'} sm onClick={() => setFilter(s)}>{s || 'All'}</Button>
        ))}
      </div>
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <Card>
        {loading ? <p style={{ color: colors.muted }}>Loading missions…</p> : rows.length === 0 ? (
          <p style={{ color: colors.muted }}>No missions for this filter.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Mission</th><th style={thCell}>Goal</th><th style={thCell}>Reward (non-cash)</th><th style={thCell}>Status</th><th style={thCell}>Completions</th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td style={tdCell}><strong>{m.title}</strong><div style={{ color: colors.muted, fontSize: '0.78rem' }}>{m.description}</div></td>
                  <td style={tdCell}>{m.goal}</td>
                  <td style={tdCell}>{m.reward_xp} XP · {m.reward_coins} coins</td>
                  <td style={tdCell}><Badge text={m.status} color={m.status === 'active' ? colors.success : m.status === 'scheduled' ? colors.info : m.status === 'draft' ? colors.secondary : colors.secondary} /></td>
                  <td style={tdCell}>{m.completions.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block', fontSize: '0.78rem', color: colors.muted, fontWeight: 600 }}>{label}<div style={{ marginTop: 4 }}>{children}</div></label>;
}
