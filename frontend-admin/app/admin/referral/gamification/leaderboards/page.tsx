'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listLeaderboards, listContests } from '@/services/referralAdminOpsService';
import type { LeaderboardConfig, ContestAdmin } from '@/types/referralAdminOps';
import { Page, PageHeader, Card, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';
import { errorMessage, numOrDash, textOrDash, timeAgo } from '../../_ui';

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (['active', 'approved', 'resolved', 'eligible', 'paid'].includes(s)) return colors.success;
  if (['closed', 'ended', 'draft', 'paused'].includes(s)) return colors.secondary;
  if (['rejected', 'clawed_back', 'critical'].includes(s)) return colors.danger;
  if (['scheduled'].includes(s)) return colors.info;
  return colors.secondary;
}

function StatusBadge({ status, label: lbl }: { status: string; label?: string }) {
  return <Badge text={lbl ?? status.replace(/_/g, ' ')} color={statusColor(status)} />;
}

export default function LeaderboardsPage() {
  const [boards, setBoards] = useState<LeaderboardConfig[] | null>(null);
  const [contests, setContests] = useState<ContestAdmin[] | null>(null);
  const [loading, setLoading] = useState(true);
  // Each surface fails alone. GET /gamification/leaderboards was never
  // registered (only the member's own GET /gamification/leaderboard exists), and
  // a thrown loader used to take the contests table — a route that does answer —
  // down with it. That is the "This page couldn't load" boundary on this tab.
  const [boardsError, setBoardsError] = useState<string | null>(null);
  const [contestsError, setContestsError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setBoardsError(null); setContestsError(null);
    const [b, c] = await Promise.allSettled([listLeaderboards(), listContests()]);
    if (b.status === 'fulfilled') setBoards(b.value); else { setBoards(null); setBoardsError(errorMessage(b.reason)); }
    if (c.status === 'fulfilled') setContests(c.value); else { setContests(null); setContestsError(errorMessage(c.reason)); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  return (
    <Page>
      <PageHeader
        title="Gamification — Leaderboards & contests"
        subtitle="Leaderboard scope, reset cycles and prizes (A-GAM-03); time-bound contests & challenges (A-GAM-04). Prizes are non-cash perks."
        actions={<Link href="/admin/referral/gamification" className="vx-btn vx-btn--outline vx-btn--sm" style={{ textDecoration: 'none' }}>← Overview</Link>}
      />

      {loading ? (
        <p style={{ color: colors.muted }}>Loading…</p>
      ) : (
        <>
          <Card title="Leaderboards (A-GAM-03)" style={{ marginBottom: 20 }}>
            {boardsError ? <p style={{ color: colors.warning, fontSize: 13 }}>{boardsError}</p>
              : !boards ? <p style={{ color: colors.muted }}>Not loaded.</p>
              : boards.length === 0 ? <p style={{ color: colors.muted }}>No leaderboards.</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thCell}>Name</th><th style={thCell}>Scope</th><th style={thCell}>Metric</th><th style={thCell}>Reset</th><th style={thCell}>Prize</th><th style={thCell}>Status</th></tr></thead>
                  <tbody>
                    {boards.map((b) => (
                      <tr key={b.id}>
                        <td style={tdCell}>{b.name}</td>
                        <td style={tdCell}>{b.scope}</td>
                        <td style={tdCell}>{b.metric}</td>
                        <td style={tdCell}>{b.reset_cycle}</td>
                        <td style={tdCell}>{b.prize}</td>
                        <td style={tdCell}><StatusBadge status={b.status === 'active' ? 'active' : 'paused'} label={b.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Contests & challenges (A-GAM-04)">
            {contestsError ? <p style={{ color: colors.danger, fontSize: 13 }}>{contestsError}</p>
              : !contests ? <p style={{ color: colors.muted }}>Not loaded.</p>
              : contests.length === 0 ? <p style={{ color: colors.muted }}>No contests.</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thCell}>Name</th><th style={thCell}>Participants</th><th style={thCell}>Prize</th><th style={thCell}>Starts</th><th style={thCell}>Ends</th><th style={thCell}>Status</th></tr></thead>
                  <tbody>
                    {contests.map((c) => (
                      <tr key={c.id}>
                        <td style={tdCell}>{c.name}</td>
                        {/* gamification.Contest counts no participants; a 0 here
                            reads as "nobody entered" rather than "nobody asked". */}
                        <td style={tdCell}>{numOrDash(c.participants)}</td>
                        {/* PrizeConfig is a structured object; flattened by the
                            service, absent when the row defines no pool. */}
                        <td style={tdCell}>{textOrDash(c.prize)}</td>
                        <td style={tdCell}>{timeAgo(c.starts_at)}</td>
                        <td style={tdCell}>{timeAgo(c.ends_at)}</td>
                        <td style={tdCell}><StatusBadge status={c.status === 'active' ? 'active' : c.status === 'scheduled' ? 'scheduled' : 'closed'} label={c.status} /></td>
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
