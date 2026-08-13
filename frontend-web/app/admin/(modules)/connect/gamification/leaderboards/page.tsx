'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getLeaderboardsAdmin, type ConnectLeaderboards } from '@/services/connectAdminOpsService';
import { timeAgo } from '../../_ui';
import { Page, PageHeader, Card, Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

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
    <Page>
      <Link href="/admin/connect/gamification" style={{ color: colors.info, textDecoration: 'none', fontSize: '0.85rem' }}>← Gamification</Link>
      <div style={{ height: 8 }} />
      <PageHeader title="Leaderboards" subtitle="Scores are non-cash XP. View and moderate ranked boards." actions={<Button variant="outline" sm onClick={load}>Refresh</Button>} />
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      {loading ? (
        <Card><p style={{ color: colors.muted }}>Loading leaderboard…</p></Card>
      ) : !data || data.entries.length === 0 ? (
        <Card><p style={{ color: colors.muted }}>No leaderboard entries.</p></Card>
      ) : (
        <Card title={`${data.season_name} · updated ${timeAgo(data.updated_at)}`}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Rank</th><th style={thCell}>Player</th><th style={thCell}>Region</th><th style={thCell}>Score (XP, non-cash)</th></tr></thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.user_id}>
                  <td style={tdCell}><strong>#{e.rank}</strong></td>
                  <td style={tdCell}>{e.display_name}<div style={{ color: colors.muted, fontSize: '0.72rem' }}>{e.user_id}</div></td>
                  <td style={tdCell}>{e.region}</td>
                  <td style={tdCell}>{e.score.toLocaleString()} XP</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Page>
  );
}
