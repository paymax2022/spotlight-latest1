'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listMissionsAdmin, listRanksAdmin, listLeaderboards, listContests } from '@/services/referralAdminOpsService';
import type { MissionAdmin, RankAdmin, LeaderboardConfig, ContestAdmin } from '@/types/referralAdminOps';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const links = [
  { href: '/admin/referral/gamification/missions', label: 'Missions / quests' },
  { href: '/admin/referral/gamification/ranks', label: 'Ranks & badges' },
  { href: '/admin/referral/gamification/leaderboards', label: 'Leaderboards & contests' },
];

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

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <Card style={{ padding: '14px 16px' }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.muted, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: accent ?? colors.text }}>{value}</div>
      {sub ? <div style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{sub}</div> : null}
    </Card>
  );
}

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
    <Page>
      <PageHeader
        title="Gamification admin"
        subtitle="Mission/quest builder, rank/badge config, leaderboards & contests (A-GAM-01..04). Points are non-cash — they never post to the reward ledger."
        actions={<Button variant="outline" sm onClick={load}>Refresh</Button>}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {links.map((l) => <Link key={l.href} href={l.href} className="vx-btn vx-btn--outline vx-btn--sm" style={{ textDecoration: 'none' }}>{l.label}</Link>)}
      </div>

      {loading ? (
        <p style={{ color: colors.muted }}>Loading…</p>
      ) : error ? (
        <p style={{ color: colors.danger }}>{error}</p>
      ) : !missions ? null : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: 12, marginBottom: 20 }}>
            <Kpi label="Active missions" value={String((missions ?? []).filter((m) => m.status === 'active').length)} />
            <Kpi label="Ranks configured" value={String((ranks ?? []).length)} />
            <Kpi label="Leaderboards" value={String((boards ?? []).length)} />
            <Kpi label="Live contests" value={String((contests ?? []).filter((c) => c.status === 'active').length)} accent={colors.primary} />
          </div>

          <Card title="Active missions (A-GAM-01)">
            {missions.length === 0 ? <p style={{ color: colors.muted }}>No missions.</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thCell}>Mission</th><th style={thCell}>Condition</th><th style={thCell}>Points</th><th style={thCell}>Completions</th><th style={thCell}>Status</th><th style={thCell}>Ends</th></tr></thead>
                  <tbody>
                    {missions.map((m) => (
                      <tr key={m.id}>
                        <td style={tdCell}>{m.name}</td>
                        <td style={tdCell}>{m.condition}</td>
                        <td style={tdCell}>{m.points_reward.toLocaleString('en-NG')} pts</td>
                        <td style={tdCell}>{m.completions}/{m.participants}</td>
                        <td style={tdCell}><StatusBadge status={m.status === 'active' ? 'active' : m.status === 'draft' ? 'draft' : 'closed'} label={m.status} /></td>
                        <td style={tdCell}>{m.ends_at ? timeAgo(m.ends_at) : 'No end'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}
