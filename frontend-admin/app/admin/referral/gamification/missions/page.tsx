'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listMissionsAdmin } from '@/services/referralAdminOpsService';
import type { MissionAdmin } from '@/types/referralAdminOps';
import { PageHeader, Card, Badge, btn, input, label, th, td, timeAgo, StateBlock } from '../../_ui';

const STATUSES = ['all', 'draft', 'active', 'ended'];

export default function MissionsAdminPage() {
  const [rows, setRows] = useState<MissionAdmin[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('all');
  // Quest builder (mock-only local draft)
  const [name, setName] = useState('');
  const [condition, setCondition] = useState('');
  const [points, setPoints] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listMissionsAdmin(status)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  function addDraft() {
    if (!name.trim() || !condition.trim() || !points.trim()) { setMsg('Name, condition and points are required.'); return; }
    const draft: MissionAdmin = {
      id: `ms_draft_${Date.now()}`, name: name.trim(), condition: condition.trim(),
      points_reward: parseInt(points, 10) || 0, status: 'draft', participants: 0, completions: 0,
      starts_at: new Date().toISOString(), ends_at: null,
    };
    setRows((cur) => [draft, ...(cur ?? [])]);
    setName(''); setCondition(''); setPoints(''); setMsg('Draft mission added (non-cash points).');
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Gamification — Mission / quest builder"
        subtitle="Define quest conditions and non-cash point rewards (A-GAM-01)."
        action={<Link href="/admin/referral/gamification" style={{ ...btn(), textDecoration: 'none', color: '#374151' }}>← Overview</Link>}
      />

      <Card title="New quest">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: '0.75rem', alignItems: 'end' }}>
          <div><label style={label()}>Name</label><input style={input()} value={name} onChange={(e) => setName(e.target.value)} placeholder="Refer 5 verified users" /></div>
          <div><label style={label()}>Condition</label><input style={input()} value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="5 KYC-verified referrals" /></div>
          <div><label style={label()}>Points reward</label><input style={input()} value={points} onChange={(e) => setPoints(e.target.value)} placeholder="500" inputMode="numeric" /></div>
          <button onClick={addDraft} style={btn()}>Add draft</button>
        </div>
        {msg && <p style={{ color: msg.startsWith('Draft') ? '#15803d' : '#b91c1c', fontSize: '0.8rem', marginTop: '0.5rem' }}>{msg}</p>}
      </Card>

      <Card title="Missions" right={
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...btn(), cursor: 'pointer' }}>
          {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}
        </select>
      }>
        <StateBlock loading={loading} error={error} empty={!rows || rows.length === 0} emptyText="No missions.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Mission</th><th style={th()}>Condition</th><th style={th()}>Points</th><th style={th()}>Participants</th><th style={th()}>Completions</th><th style={th()}>Status</th><th style={th()}>Ends</th></tr></thead>
            <tbody>
              {(rows ?? []).map((m) => (
                <tr key={m.id}>
                  <td style={td()}>{m.name}</td>
                  <td style={td()}>{m.condition}</td>
                  <td style={td()}>{m.points_reward.toLocaleString('en-NG')} pts</td>
                  <td style={td()}>{m.participants}</td>
                  <td style={td()}>{m.completions}</td>
                  <td style={td()}><Badge status={m.status === 'active' ? 'active' : m.status === 'draft' ? 'draft' : 'closed'} label={m.status} /></td>
                  <td style={td()}>{m.ends_at ? timeAgo(m.ends_at) : 'No end'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
