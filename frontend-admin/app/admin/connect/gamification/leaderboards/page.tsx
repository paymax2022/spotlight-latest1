'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getLeaderboardsAdmin, type ConnectLeaderboards } from '@/services/connectAdminOpsService';
import { PageHeader, Card, btn, th, td, timeAgo } from '../../_ui';

export default function ConnectLeaderboardsPage() {
  const [data, setData] = useState<ConnectLeaderboards | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getLeaderboardsAdmin()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <Link href="/admin/connect/gamification" style={{ color: '#1d4ed8', textDecoration: 'none', fontSize: '0.85rem' }}>← Gamification</Link>
      <div style={{ height: 8 }} />
      <PageHeader title="Leaderboards" subtitle="Scores are non-cash XP. View and moderate ranked boards." action={<button onClick={load} style={btn()}>Refresh</button>} />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      {loading ? (
        <Card><p style={{ color: '#6b7280' }}>Loading leaderboard…</p></Card>
      ) : !data || data.entries.length === 0 ? (
        <Card><p style={{ color: '#6b7280' }}>No leaderboard entries.</p></Card>
      ) : (
        <Card title={`${data.season_name} · updated ${timeAgo(data.updated_at)}`}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Rank</th><th style={th()}>Player</th><th style={th()}>Region</th><th style={th()}>Score (XP, non-cash)</th></tr></thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.user_id}>
                  <td style={td()}><strong>#{e.rank}</strong></td>
                  <td style={td()}>{e.display_name}<div style={{ color: '#9ca3af', fontSize: '0.72rem' }}>{e.user_id}</div></td>
                  <td style={td()}>{e.region}</td>
                  <td style={td()}>{e.score.toLocaleString()} XP</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
