'use client';

import { useEffect, useState } from 'react';
import { getGamificationConfig } from '@/services/academyAdminService';
import type { GamificationConfig } from '@/types/academyAdmin';
import { PageHeader, AcademyTabs, Card, Badge, StateBlock, Bar, Kpi, DisclosureNote, btn, th, td } from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Gamification engine" subtitle="XP/level curves, streak rules & freezes, badge criteria, challenges/quests, leaderboard configs & resets; anti-cheat thresholds." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <AcademyTabs active="gamification" />
      <DisclosureNote>Requires <code>academy</code>. Gamification awards XP/badges only — monetary rewards are governed separately under Rewards (funded pools required).</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!cfg}>
        {cfg && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Streak daily XP" value={`${cfg.streak.daily_xp} XP`} accent="#340075" />
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
                <thead><tr><th style={th()}>Badge</th><th style={th()}>Criteria</th><th style={th()}>Status</th><th style={th()}>Awarded</th></tr></thead>
                <tbody>
                  {cfg.badges.map((b) => (
                    <tr key={b.id}><td style={td()}>{b.name}</td><td style={td()}>{b.criteria}</td><td style={td()}><Badge status={b.status} /></td><td style={td()}>{b.awarded_count.toLocaleString('en-NG')}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Challenges / quests">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Challenge</th><th style={th()}>Cadence</th><th style={th()}>Status</th><th style={th()}>Reward XP</th><th style={th()}>Participants</th></tr></thead>
                <tbody>
                  {cfg.challenges.map((c) => (
                    <tr key={c.id}><td style={td()}>{c.name}</td><td style={td()}>{c.cadence}</td><td style={td()}><Badge status={c.status} /></td><td style={td()}>{c.reward_xp}</td><td style={td()}>{c.participants.toLocaleString('en-NG')}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Leaderboards & anti-cheat">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Scope</th><th style={th()}>Reset</th><th style={th()}>Anti-cheat threshold</th></tr></thead>
                <tbody>
                  {cfg.leaderboards.map((l) => (
                    <tr key={l.id}><td style={td()}>{l.scope}</td><td style={td()}>{l.reset}</td><td style={td()}>{l.anti_cheat_threshold}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
