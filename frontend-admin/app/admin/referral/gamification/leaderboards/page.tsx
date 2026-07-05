'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listLeaderboards, listContests } from '@/services/referralAdminOpsService';
import type { LeaderboardConfig, ContestAdmin } from '@/types/referralAdminOps';
import { PageHeader, Card, Badge, btn, th, td, timeAgo, StateBlock } from '../../_ui';

export default function LeaderboardsPage() {
  const [boards, setBoards] = useState<LeaderboardConfig[] | null>(null);
  const [contests, setContests] = useState<ContestAdmin[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [b, c] = await Promise.all([listLeaderboards(), listContests()]);
      setBoards(b); setContests(c);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Gamification — Leaderboards & contests"
        subtitle="Leaderboard scope, reset cycles and prizes (A-GAM-03); time-bound contests & challenges (A-GAM-04). Prizes are non-cash perks."
        action={<Link href="/admin/referral/gamification" style={{ ...btn(), textDecoration: 'none', color: '#374151' }}>← Overview</Link>}
      />

      <StateBlock loading={loading} error={error} empty={!boards}>
        <>
          <Card title="Leaderboards (A-GAM-03)">
            {!boards || boards.length === 0 ? <p style={{ color: '#6b7280' }}>No leaderboards.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Name</th><th style={th()}>Scope</th><th style={th()}>Metric</th><th style={th()}>Reset</th><th style={th()}>Prize</th><th style={th()}>Status</th></tr></thead>
                <tbody>
                  {boards.map((b) => (
                    <tr key={b.id}>
                      <td style={td()}>{b.name}</td>
                      <td style={td()}>{b.scope}</td>
                      <td style={td()}>{b.metric}</td>
                      <td style={td()}>{b.reset_cycle}</td>
                      <td style={td()}>{b.prize}</td>
                      <td style={td()}><Badge status={b.status === 'active' ? 'active' : 'paused'} label={b.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="Contests & challenges (A-GAM-04)">
            {!contests || contests.length === 0 ? <p style={{ color: '#6b7280' }}>No contests.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Name</th><th style={th()}>Participants</th><th style={th()}>Prize</th><th style={th()}>Starts</th><th style={th()}>Ends</th><th style={th()}>Status</th></tr></thead>
                <tbody>
                  {contests.map((c) => (
                    <tr key={c.id}>
                      <td style={td()}>{c.name}</td>
                      <td style={td()}>{c.participants.toLocaleString('en-NG')}</td>
                      <td style={td()}>{c.prize}</td>
                      <td style={td()}>{timeAgo(c.starts_at)}</td>
                      <td style={td()}>{timeAgo(c.ends_at)}</td>
                      <td style={td()}><Badge status={c.status === 'active' ? 'active' : c.status === 'scheduled' ? 'scheduled' : 'closed'} label={c.status} /></td>
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
