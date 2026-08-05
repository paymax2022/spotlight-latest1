'use client';

import { useEffect, useState } from 'react';
import { getGamificationConfig } from '@/services/academyAdminService';
import type { GamificationConfig } from '@/types/academyAdmin';
import { AcademyTabs, StateBlock, Bar, Kpi, DisclosureNote } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (['active', 'approved', 'published', 'funded', 'paid', 'completed', 'allocated', 'live', 'reconciled', 'disbursed', 'collected', 'released', 'core', 'issued', 'routed', 'ready', 'eligible', 'actioned', 'verified', 'resolved', 'plan_published', 'badge_earned', 'pool_funded', 'item_approved'].includes(s)) return colors.success;
  if (['pending', 'in_review', 'under_review', 'needs_info', 'scheduled', 'low_balance', 'review', 'in_translation', 'funding', 'fee_due', 'onboarding', 'frequent', 'packaged', 'matured', 'paused', 'processing', 'triaged', 'investigating', 'hide', 'warn', 'high', 'medium'].includes(s)) return colors.warning;
  if (['draft', 'authoring', 'open', 'upcoming', 'generated', 'partial', 'submitted', 'trial', 'requested', 'applied', 'cards_generated', 'exam_opened', 'campaign_launched'].includes(s)) return colors.info;
  if (['rejected', 'failed', 'suspended', 'blocked', 'unfunded', 'expired', 'duplicate', 'revoked', 'escalated', 'ban', 'critical', 'overdue', 'item_rejected'].includes(s)) return colors.danger;
  if (['refunded', 'reversed', 'redeemed', 'reward_redeemed'].includes(s)) return colors.primary;
  return colors.secondary;
}

function StatusBadge({ status, label: lbl }: { status: string; label?: string }) {
  return <Badge text={lbl ?? status.replace(/_/g, ' ')} color={statusColor(status)} />;
}

export default function GamificationPage() {
  const [cfg, setCfg] = useState<GamificationConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setCfg(await getGamificationConfig()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const maxXp = cfg ? Math.max(...cfg.xp_curve.map((l) => l.xp_required), 1) : 1;

  return (
    <Page>
      <PageHeader title="Gamification engine" subtitle="XP/level curves, streak rules & freezes, badge criteria, challenges/quests, leaderboard configs & resets; anti-cheat thresholds." actions={<Button onClick={load} variant="outline" sm>Refresh</Button>} />
      <AcademyTabs active="gamification" />
      <DisclosureNote>Requires <code>academy</code>. Gamification awards XP/badges only — monetary rewards are governed separately under Rewards (funded pools required).</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!cfg}>
        {cfg && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Streak daily XP" value={`${cfg.streak.daily_xp} XP`} accent={colors.primary} />
              <Kpi label="Freeze tokens / month" value={String(cfg.streak.freeze_tokens_per_month)} />
              <Kpi label="Streak grace window" value={`${cfg.streak.grace_hours}h`} />
              <Kpi label="Active badges" value={String(cfg.badges.filter((b) => b.status === 'active').length)} sub={`${cfg.badges.length} total`} />
              <Kpi label="Live challenges" value={String(cfg.challenges.filter((c) => c.status === 'live').length)} />
              <Kpi label="Leaderboards" value={String(cfg.leaderboards.length)} />
            </div>

            <Card title="XP / level curve">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {cfg.xp_curve.map((l) => (
                  <Bar key={l.level} value={l.xp_required} max={maxXp} labelLeft={`Level ${l.level}`} labelRight={`${l.xp_required.toLocaleString('en-NG')} XP`} />
                ))}
              </div>
            </Card>

            <Card title="Badges">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={thCell}>Badge</th><th style={thCell}>Criteria</th><th style={thCell}>Status</th><th style={thCell}>Awarded</th></tr></thead>
                <tbody>
                  {cfg.badges.map((b) => (
                    <tr key={b.id}><td style={tdCell}>{b.name}</td><td style={tdCell}>{b.criteria}</td><td style={tdCell}><StatusBadge status={b.status} /></td><td style={tdCell}>{b.awarded_count.toLocaleString('en-NG')}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Challenges / quests">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={thCell}>Challenge</th><th style={thCell}>Cadence</th><th style={thCell}>Status</th><th style={thCell}>Reward XP</th><th style={thCell}>Participants</th></tr></thead>
                <tbody>
                  {cfg.challenges.map((c) => (
                    <tr key={c.id}><td style={tdCell}>{c.name}</td><td style={tdCell}>{c.cadence}</td><td style={tdCell}><StatusBadge status={c.status} /></td><td style={tdCell}>{c.reward_xp}</td><td style={tdCell}>{c.participants.toLocaleString('en-NG')}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Leaderboards & anti-cheat">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={thCell}>Scope</th><th style={thCell}>Reset</th><th style={thCell}>Anti-cheat threshold</th></tr></thead>
                <tbody>
                  {cfg.leaderboards.map((l) => (
                    <tr key={l.id}><td style={tdCell}>{l.scope}</td><td style={tdCell}>{l.reset}</td><td style={tdCell}>{l.anti_cheat_threshold}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </StateBlock>
    </Page>
  );
}
