'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listMissionsAdmin } from '@/services/referralAdminOpsService';
import type { MissionAdmin } from '@/types/referralAdminOps';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES = ['all', 'draft', 'active', 'ended'];

function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const past = diff >= 0;
  const h = Math.floor(Math.abs(diff) / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return past ? `${h}h ago` : `in ${h}h`;
  const d = Math.floor(h / 24);
  return past ? `${d}d ago` : `in ${d}d`;
}

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (['active', 'approved', 'resolved', 'eligible', 'paid'].includes(s)) return colors.success;
  if (['closed', 'ended', 'draft'].includes(s)) return colors.secondary;
  if (['rejected', 'clawed_back', 'critical'].includes(s)) return colors.danger;
  return colors.secondary;
}

function StatusBadge({ status, label: lbl }: { status: string; label?: string }) {
  return <Badge text={lbl ?? status.replace(/_/g, ' ')} color={statusColor(status)} />;
}

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
    <Page>
      <PageHeader
        title="Gamification — Mission / quest builder"
        subtitle="Define quest conditions and non-cash point rewards (A-GAM-01)."
        actions={<Link href="/admin/referral/gamification" className="vx-btn vx-btn--outline vx-btn--sm" style={{ textDecoration: 'none' }}>← Overview</Link>}
      />

      <Card title="New quest" style={{ marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: 12, alignItems: 'end' }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 4 }}>Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Refer 5 verified users" />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 4 }}>Condition</label>
            <Input value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="5 KYC-verified referrals" />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 4 }}>Points reward</label>
            <Input value={points} onChange={(e) => setPoints(e.target.value)} placeholder="500" inputMode="numeric" />
          </div>
          <Button variant="outline" onClick={addDraft}>Add draft</Button>
        </div>
        {msg && <p style={{ color: msg.startsWith('Draft') ? colors.success : colors.danger, fontSize: 13, marginTop: 8 }}>{msg}</p>}
      </Card>

      <Card title="Missions">
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}
          </select>
        </div>
        {loading ? (
          <p style={{ color: colors.muted }}>Loading…</p>
        ) : error ? (
          <p style={{ color: colors.danger }}>{error}</p>
        ) : !rows || rows.length === 0 ? (
          <p style={{ color: colors.muted }}>No missions.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={thCell}>Mission</th><th style={thCell}>Condition</th><th style={thCell}>Points</th><th style={thCell}>Participants</th><th style={thCell}>Completions</th><th style={thCell}>Status</th><th style={thCell}>Ends</th></tr></thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td style={tdCell}>{m.name}</td>
                    <td style={tdCell}>{m.condition}</td>
                    <td style={tdCell}>{m.points_reward.toLocaleString('en-NG')} pts</td>
                    <td style={tdCell}>{m.participants}</td>
                    <td style={tdCell}>{m.completions}</td>
                    <td style={tdCell}><StatusBadge status={m.status === 'active' ? 'active' : m.status === 'draft' ? 'draft' : 'closed'} label={m.status} /></td>
                    <td style={tdCell}>{m.ends_at ? timeAgo(m.ends_at) : 'No end'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
