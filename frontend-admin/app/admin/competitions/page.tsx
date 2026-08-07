'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getCompetitionOverview } from '@/services/competitionsService';
import type { CompetitionOverview } from '@/types/competitions';
import { Page, PageHeader, Card, Button, Badge, colors, tint } from '@/components/ui/vuexy';

function StatCard({ label, value, trend, icon }: { label: string; value: string | number; trend?: number; icon?: string }) {
  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '1rem', background: colors.card }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.4, color: colors.muted, fontWeight: 600 }}>{label}</span>
        {icon && <span style={{ fontSize: '1.25rem' }}>{icon}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
        <span style={{ fontSize: '1.75rem', fontWeight: 700, color: colors.text }}>{value}</span>
        {trend !== undefined && <span style={{ fontSize: '0.75rem', color: trend >= 0 ? colors.success : colors.danger, fontWeight: 600 }}>{trend >= 0 ? '+' : ''}{trend}%</span>}
      </div>
    </div>
  );
}

export default function AdminCompetitionsPage() {
  const [data, setData] = useState<CompetitionOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void getCompetitionOverview().then((res) => {
      setData(res);
      setLoading(false);
    });
  }, []);

  if (loading) return <Page><PageHeader title="Contests Dashboard" /><p style={{ color: colors.muted }}>Loading...</p></Page>;
  if (!data) return <Page><PageHeader title="Contests Dashboard" /><p style={{ color: colors.danger }}>Failed to load dashboard data.</p></Page>;

  return (
    <Page>
      <PageHeader
        title="Contests Dashboard"
        subtitle="Manage competitions, participants, results, and voting across all contest types."
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Link href="/admin/competitions/list">
              <Button variant="primary">Create Contest</Button>
            </Link>
            <Link href="/admin/competitions/settings">
              <Button variant="outline">Settings</Button>
            </Link>
          </div>
        }
      />

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        <StatCard label="Active Contests" value={data.totalContests} icon="🏆" />
        <StatCard label="Open Mic Editions" value={data.openMicContests} icon="🎤" />
        <StatCard label="Reality TV" value={data.realityTvContests} icon="📺" />
        <StatCard label="Multi-Skill" value={data.multiSkillContests} icon="🎯" />
      </div>

      {/* Quick Navigation Grid */}
      <Card title="Contest Management" style={{ marginBottom: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 12, marginTop: 12 }}>
          <Link href="/admin/competitions/list" style={{ textDecoration: 'none' }}>
            <div style={{ padding: 16, border: `1px solid ${colors.border}`, borderRadius: '0.5rem', background: tint(colors.primary, 0.04), cursor: 'pointer', transition: 'all .15s' }}
              onMouseEnter={(e) => e.currentTarget.style.background = tint(colors.primary, 0.08)}
              onMouseLeave={(e) => e.currentTarget.style.background = tint(colors.primary, 0.04)}
            >
              <div style={{ fontSize: 20, marginBottom: 8 }}>📊</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 4 }}>Competitions</div>
              <div style={{ fontSize: 12, color: colors.muted }}>List, create, and manage contests</div>
            </div>
          </Link>

          <Link href="/admin/competitions/participants" style={{ textDecoration: 'none' }}>
            <div style={{ padding: 16, border: `1px solid ${colors.border}`, borderRadius: '0.5rem', background: tint(colors.info, 0.04), cursor: 'pointer', transition: 'all .15s' }}
              onMouseEnter={(e) => e.currentTarget.style.background = tint(colors.info, 0.08)}
              onMouseLeave={(e) => e.currentTarget.style.background = tint(colors.info, 0.04)}
            >
              <div style={{ fontSize: 20, marginBottom: 8 }}>👥</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 4 }}>Participants</div>
              <div style={{ fontSize: 12, color: colors.muted }}>Manage entries and qualifications</div>
            </div>
          </Link>

          <Link href="/admin/competitions/results" style={{ textDecoration: 'none' }}>
            <div style={{ padding: 16, border: `1px solid ${colors.border}`, borderRadius: '0.5rem', background: tint(colors.success, 0.04), cursor: 'pointer', transition: 'all .15s' }}
              onMouseEnter={(e) => e.currentTarget.style.background = tint(colors.success, 0.08)}
              onMouseLeave={(e) => e.currentTarget.style.background = tint(colors.success, 0.04)}
            >
              <div style={{ fontSize: 20, marginBottom: 8 }}>🎯</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 4 }}>Results</div>
              <div style={{ fontSize: 12, color: colors.muted }}>Leaderboard and prize distribution</div>
            </div>
          </Link>

          <Link href="/admin/voting/visibility" style={{ textDecoration: 'none' }}>
            <div style={{ padding: 16, border: `1px solid ${colors.border}`, borderRadius: '0.5rem', background: tint(colors.warning, 0.04), cursor: 'pointer', transition: 'all .15s' }}
              onMouseEnter={(e) => e.currentTarget.style.background = tint(colors.warning, 0.08)}
              onMouseLeave={(e) => e.currentTarget.style.background = tint(colors.warning, 0.04)}
            >
              <div style={{ fontSize: 20, marginBottom: 8 }}>🗳️</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 4 }}>Voting Control</div>
              <div style={{ fontSize: 12, color: colors.muted }}>Manage visibility & moderation</div>
            </div>
          </Link>

          <Link href="/admin/competitions/open-mic" style={{ textDecoration: 'none' }}>
            <div style={{ padding: 16, border: `1px solid ${colors.border}`, borderRadius: '0.5rem', background: tint(colors.secondary, 0.04), cursor: 'pointer', transition: 'all .15s' }}
              onMouseEnter={(e) => e.currentTarget.style.background = tint(colors.secondary, 0.08)}
              onMouseLeave={(e) => e.currentTarget.style.background = tint(colors.secondary, 0.04)}
            >
              <div style={{ fontSize: 20, marginBottom: 8 }}>🎤</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 4 }}>Open Mic Editions</div>
              <div style={{ fontSize: 12, color: colors.muted }}>Create and manage editions</div>
            </div>
          </Link>

          <Link href="/admin/competitions/settings" style={{ textDecoration: 'none' }}>
            <div style={{ padding: 16, border: `1px solid ${colors.border}`, borderRadius: '0.5rem', background: tint(colors.muted, 0.04), cursor: 'pointer', transition: 'all .15s' }}
              onMouseEnter={(e) => e.currentTarget.style.background = tint(colors.muted, 0.08)}
              onMouseLeave={(e) => e.currentTarget.style.background = tint(colors.muted, 0.04)}
            >
              <div style={{ fontSize: 20, marginBottom: 8 }}>⚙️</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 4 }}>Settings</div>
              <div style={{ fontSize: 12, color: colors.muted }}>Rules, templates & config</div>
            </div>
          </Link>
        </div>
      </Card>

      {/* Recent Activity */}
      <Card title="Getting Started">
        <ul style={{ margin: 0, paddingLeft: 20, color: colors.text, fontSize: 14, lineHeight: 1.6 }}>
          <li>View all active contests in the <strong>Competitions</strong> section</li>
          <li>Manage participant entries and qualifications in <strong>Participants</strong></li>
          <li>Monitor results, leaderboards, and prize distribution in <strong>Results</strong></li>
          <li>Control voting visibility and moderation in <strong>Voting Control</strong></li>
          <li>Create new editions and manage contest configuration</li>
        </ul>
      </Card>
    </Page>
  );
}
