'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listMissionsAdmin, listRanksAdmin, listLeaderboards, listContests } from '@/services/referralAdminOpsService';
import type { MissionAdmin, RankAdmin, LeaderboardConfig, ContestAdmin } from '@/types/referralAdminOps';
import { PageHeader, Card, Kpi, Badge, btn, th, td, timeAgo, StateBlock } from '../_ui';

const links = [
  { href: '/admin/referral/gamification/missions', label: 'Missions / quests' },
  { href: '/admin/referral/gamification/ranks', label: 'Ranks & badges' },
  { href: '/admin/referral/gamification/leaderboards', label: 'Leaderboards & contests' },
];

export default function GamificationOverviewPage() {
  const [missions, setMissions] = useState<MissionAdmin[] | null>(null);
  const [ranks, setRanks] = useState<RankAdmin[] | null>(null);
  const [boards, setBoards] = useState<LeaderboardConfig[] | null>(null);
  const [contests, setContests] = useState<ContestAdmin[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [m, r, b, c] = await Promise.all([listMissionsAdmin(), listRanksAdmin(), listLeaderboards(), listContests()]);
      setMissions(m); setRanks(r); setBoards(b); setContests(c);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Gamification admin"
        subtitle="Mission/quest builder, rank/badge config, leaderboards & contests (A-GAM-01..04). Points are non-cash — they never post to the reward ledger."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        {links.map((l) => <Link key={l.href} href={l.href} style={{ ...btn(), textDecoration: 'none', color: '#374151' }}>{l.label}</Link>)}
      </div>

      <StateBlock loading={loading} error={error} empty={!missions}>
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Kpi label="Active missions" value={String((missions ?? []).filter((m) => m.status === 'active').length)} />
            <Kpi label="Ranks configured" value={String((ranks ?? []).length)} />
            <Kpi label="Leaderboards" value={String((boards ?? []).length)} />
            <Kpi label="Live contests" value={String((contests ?? []).filter((c) => c.status === 'active').length)} accent="#7c3aed" />
          </div>

          <Card title="Active missions (A-GAM-01)">
            {!missions || missions.length === 0 ? <p style={{ color: '#6b7280' }}>No missions.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Mission</th><th style={th()}>Condition</th><th style={th()}>Points</th><th style={th()}>Completions</th><th style={th()}>Status</th><th style={th()}>Ends</th></tr></thead>
                <tbody>
                  {missions.map((m) => (
                    <tr key={m.id}>
                      <td style={td()}>{m.name}</td>
                      <td style={td()}>{m.condition}</td>
                      <td style={td()}>{m.points_reward.toLocaleString('en-NG')} pts</td>
                      <td style={td()}>{m.completions}/{m.participants}</td>
                      <td style={td()}><Badge status={m.status === 'active' ? 'active' : m.status === 'draft' ? 'draft' : 'closed'} label={m.status} /></td>
                      <td style={td()}>{m.ends_at ? timeAgo(m.ends_at) : 'No end'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      </StateBlock>
    </div>
  );
}
