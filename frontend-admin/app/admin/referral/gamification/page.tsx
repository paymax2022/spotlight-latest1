'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listMissionsAdmin, listRanksAdmin, listLeaderboards, listContests } from '@/services/referralAdminOpsService';
import type { MissionAdmin, RankAdmin, LeaderboardConfig, ContestAdmin } from '@/types/referralAdminOps';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';
import { NOT_REPORTED, errorMessage, numOrDash, textOrDash, timeAgo } from '../_ui';

const links = [
  { href: '/admin/referral/gamification/missions', label: 'Missions / quests' },
  { href: '/admin/referral/gamification/ranks', label: 'Ranks & badges' },
  { href: '/admin/referral/gamification/leaderboards', label: 'Leaderboards & contests' },
];

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
  // Loaded per surface, not as one Promise.all. GET /gamification/leaderboards
  // does not exist on the admin group (only the member's own board is mounted),
  // and while that refusal was the head of a Promise.all it blanked missions,
  // ranks and contests — all three of which the backend does serve — into the
  // "This page couldn't load" boundary. A surface that cannot be answered now
  // reports only itself.
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true); setErrors({});
    const [m, r, b, c] = await Promise.allSettled([listMissionsAdmin(), listRanksAdmin(), listLeaderboards(), listContests()]);
    const nextErrors: Record<string, string> = {};
    if (m.status === 'rejected') nextErrors.missions = errorMessage(m.reason);
    if (r.status === 'rejected') nextErrors.ranks = errorMessage(r.reason);
    if (b.status === 'rejected') nextErrors.leaderboards = errorMessage(b.reason);
    if (c.status === 'rejected') nextErrors.contests = errorMessage(c.reason);
    setMissions(m.status === 'fulfilled' ? m.value : null);
    setRanks(r.status === 'fulfilled' ? r.value : null);
    setBoards(b.status === 'fulfilled' ? b.value : null);
    setContests(c.status === 'fulfilled' ? c.value : null);
    setErrors(nextErrors);
    setLoading(false);
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
      ) : (
        <>
          {Object.entries(errors).map(([surface, message]) => (
            <p key={surface} style={{ color: colors.warning, fontSize: 13, marginBottom: 8 }}>{message}</p>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: 12, marginBottom: 20 }}>
            {/* A dash means "this surface could not be counted", not "zero". */}
            <Kpi label="Active missions" value={missions == null ? NOT_REPORTED : String(missions.filter((m) => m.status === 'active').length)} />
            <Kpi label="Ranks configured" value={ranks == null ? NOT_REPORTED : String(ranks.length)} />
            <Kpi label="Leaderboards" value={boards == null ? NOT_REPORTED : String(boards.length)} />
            <Kpi label="Live contests" value={contests == null ? NOT_REPORTED : String(contests.filter((c) => c.status === 'active').length)} accent={colors.primary} />
          </div>

          <Card title="Active missions (A-GAM-01)">
            {missions == null ? <p style={{ color: colors.muted }}>Not loaded.</p> : missions.length === 0 ? <p style={{ color: colors.muted }}>No missions.</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thCell}>Mission</th><th style={thCell}>Condition</th><th style={thCell}>Points</th><th style={thCell}>Completions</th><th style={thCell}>Status</th><th style={thCell}>Ends</th></tr></thead>
                  <tbody>
                    {missions.map((m) => (
                      <tr key={m.id}>
                        <td style={tdCell}>{m.name}</td>
                        <td style={tdCell}>{m.condition}</td>
                        <td style={tdCell}>{m.points_reward.toLocaleString('en-NG')} pts</td>
                        {/* gamification.Mission counts neither completions nor
                            participants — 0/0 would claim nobody finished. */}
                        <td style={tdCell}>{m.completions == null || m.participants == null ? NOT_REPORTED : `${numOrDash(m.completions)}/${numOrDash(m.participants)}`}</td>
                        <td style={tdCell}>{m.status ? <StatusBadge status={m.status} label={m.status} /> : NOT_REPORTED}</td>
                        <td style={tdCell}>{textOrDash(m.ends_at)}</td>
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
