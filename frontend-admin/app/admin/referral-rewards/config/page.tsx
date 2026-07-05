'use client';

// A1 — Referral Program Configuration. Editable tier + milestone tables (current
// live version + draft), effective-date scheduler, future-only warning banner.
// RBAC: referral.admin.config (Product / Finance).

import { useEffect, useState } from 'react';
import { getProgramConfig, publishProgramConfig, formatNaira, formatPct } from '@/services/referralRewardsAdminService';
import type { ProgramConfig, TierRow, MilestoneRow } from '@/types/referralRewardsAdmin';
import { PageHeader, RewardsTabs, Card, Badge, WarningBanner, StateBlock, btn, btnPrimary, th, td, input, label, timeAgo } from '../_ui';

export default function ReferralRewardsConfigPage() {
  const [live, setLive] = useState<ProgramConfig | null>(null);
  const [tiers, setTiers] = useState<TierRow[]>([]);
  const [milestones, setMilestones] = useState<MilestoneRow[]>([]);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<{ version: number; warning: string } | null>(null);

  async function load() {
    setLoading(true); setError(null); setPublishResult(null);
    try {
      const c = await getProgramConfig();
      setLive(c);
      setTiers(JSON.parse(JSON.stringify(c.tier_table)));
      setMilestones(JSON.parse(JSON.stringify(c.milestone_table)));
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function setTier(i: number, patch: Partial<TierRow>) {
    setTiers((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function setMilestone(i: number, patch: Partial<MilestoneRow>) {
    setMilestones((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function publish() {
    setPublishing(true); setError(null); setPublishResult(null);
    try {
      const res = await publishProgramConfig({
        tier_table: tiers,
        milestone_table: milestones,
        effective_from: effectiveFrom || undefined,
      });
      setPublishResult({ version: res.config.version, warning: res.warning });
      setLive(res.config);
    } catch (e) { setError(String(e)); }
    finally { setPublishing(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Referral Program Configuration"
        subtitle="Edit tier thresholds/rates and milestone bonuses without a deploy. Publishing creates a NEW versioned config; it never recomputes rewards already earned. (A1)"
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <RewardsTabs active="config" />

      <WarningBanner>
        <strong>Changes apply to future transactions only.</strong> Publishing a new version
        affects transactions from the effective date forward — already-computed rewards are
        never retroactively recalculated (PRD §6.1 A1, §3 invariants).
      </WarningBanner>

      <StateBlock loading={loading} error={error} empty={false}>
        {live && (
          <>
            <Card
              title="Current live config"
              right={<span>Version <strong>v{live.version}</strong> · <Badge status={live.is_active ? 'active' : 'voided'} label={live.is_active ? 'Active' : 'Inactive'} /> · effective {timeAgo(live.effective_from)}</span>}
            >
              <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: 0 }}>
                The tables below are a <strong>draft</strong> seeded from the live version. Edit and publish to create v{live.version + 1}.
              </p>
            </Card>

            <Card title="Draft — Volume accelerator (tier table)">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Tier</th><th style={th()}>Min active</th><th style={th()}>Max active</th><th style={th()}>Rate (fraction of margin)</th><th style={th()}>Rate %</th></tr></thead>
                <tbody>
                  {tiers.map((t, i) => (
                    <tr key={t.tier}>
                      <td style={td()}><Badge status={t.tier} /></td>
                      <td style={td()}><input style={input()} type="number" min={0} value={t.min_count} onChange={(e) => setTier(i, { min_count: Number(e.target.value) })} /></td>
                      <td style={td()}>
                        <input style={input()} type="number" min={0} value={t.max_count ?? ''} placeholder="∞ (open-ended)" onChange={(e) => setTier(i, { max_count: e.target.value === '' ? null : Number(e.target.value) })} />
                      </td>
                      <td style={td()}><input style={input()} type="number" step={0.01} min={0} max={1} value={t.rate} onChange={(e) => setTier(i, { rate: Number(e.target.value) })} /></td>
                      <td style={{ ...td(), color: '#6b7280' }}>{formatPct(t.rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Draft — Milestone bonuses (one-time)">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Threshold (active referrals)</th><th style={th()}>Bonus (kobo)</th><th style={th()}>Bonus (₦)</th></tr></thead>
                <tbody>
                  {milestones.map((m, i) => (
                    <tr key={m.threshold}>
                      <td style={td()}><input style={input()} type="number" min={1} value={m.threshold} onChange={(e) => setMilestone(i, { threshold: Number(e.target.value) })} /></td>
                      <td style={td()}><input style={input()} type="number" min={0} value={m.bonus_kobo} onChange={(e) => setMilestone(i, { bonus_kobo: Number(e.target.value) })} /></td>
                      <td style={{ ...td(), color: '#6b7280' }}>{formatNaira(m.bonus_kobo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Effective-date scheduler">
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 260 }}>
                  <label style={label()}>Effective from (leave blank = now)</label>
                  <input style={input()} type="datetime-local" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
                </div>
                <button onClick={publish} disabled={publishing} style={btnPrimary()}>
                  {publishing ? 'Publishing…' : `Publish new version (v${live.version + 1})`}
                </button>
              </div>
              {publishResult && (
                <div style={{ marginTop: '0.9rem', border: '1px solid #86efac', background: '#f0fdf4', color: '#166534', borderRadius: '0.5rem', padding: '0.7rem 0.9rem', fontSize: '0.85rem' }}>
                  Published <strong>v{publishResult.version}</strong>. {publishResult.warning}
                </div>
              )}
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
