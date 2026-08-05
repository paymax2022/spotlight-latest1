'use client';

// A1 — Referral Program Configuration. Editable tier + milestone tables (current
// live version + draft), effective-date scheduler, future-only warning banner.
// RBAC: referral.admin.config (Product / Finance).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getProgramConfig, publishProgramConfig, formatNaira, formatPct } from '@/services/referralRewardsAdminService';
import type { ProgramConfig, TierRow, MilestoneRow } from '@/types/referralRewardsAdmin';
import { Page, PageHeader, Card, Button, Input, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';
import { timeAgo } from '../_ui';

const REWARDS_TABS = [
  { href: '/admin/referral-rewards/config', label: 'A1 · Config', key: 'config' },
  { href: '/admin/referral-rewards/analytics', label: 'A2 · Analytics', key: 'analytics' },
  { href: '/admin/referral-rewards/fraud', label: 'A3 · Fraud queue', key: 'fraud' },
  { href: '/admin/referral-rewards/ledger', label: 'A4 · Ledger', key: 'ledger' },
  { href: '/admin/referral-rewards/case', label: 'A5 · Case view', key: 'case' },
  { href: '/admin/referral-rewards/milestones', label: 'A6 · Milestones', key: 'milestones' },
  { href: '/admin/referral-rewards/module-status', label: 'A7 · Module status', key: 'module-status' },
];

function RewardsTabs({ active }: { active: string }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20, borderBottom: `1px solid ${colors.border}`, paddingBottom: 8 }}>
      {REWARDS_TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          style={{
            textDecoration: 'none', padding: '6px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600,
            color: active === t.key ? '#fff' : colors.text,
            background: active === t.key ? colors.primary : tint(colors.primary, 0.06),
          }}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

function WarningBanner({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ border: `1px solid ${colors.warning}`, background: tint(colors.warning, 0.1), color: colors.text, borderRadius: 8, padding: '11px 14px', fontSize: 13, marginBottom: 20, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <span aria-hidden style={{ fontWeight: 700, color: colors.warning }}>⚠</span>
      <div>{children}</div>
    </div>
  );
}

const TIER_BADGE: Record<string, string> = {
  starter: colors.secondary,
  growth: colors.info,
  pro: colors.primary,
  elite: colors.warning,
};

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
    <Page>
      <PageHeader
        title="Referral Program Configuration"
        subtitle="Edit tier thresholds/rates and milestone bonuses without a deploy. Publishing creates a NEW versioned config; it never recomputes rewards already earned. (A1)"
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <RewardsTabs active="config" />

      <WarningBanner>
        <strong>Changes apply to future transactions only.</strong> Publishing a new version
        affects transactions from the effective date forward — already-computed rewards are
        never retroactively recalculated (PRD §6.1 A1, §3 invariants).
      </WarningBanner>

      {loading ? (
        <p style={{ color: colors.muted }}>Loading…</p>
      ) : error ? (
        <p style={{ color: colors.danger }}>{error}</p>
      ) : live ? (
        <>
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Current live config</h2>
              <span style={{ fontSize: 13, color: colors.text }}>
                Version <strong>v{live.version}</strong> · <Badge text={live.is_active ? 'Active' : 'Inactive'} color={live.is_active ? colors.success : colors.danger} /> · effective {timeAgo(live.effective_from)}
              </span>
            </div>
            <p style={{ fontSize: 13, color: colors.muted, margin: 0 }}>
              The tables below are a <strong>draft</strong> seeded from the live version. Edit and publish to create v{live.version + 1}.
            </p>
          </Card>

          <Card title="Draft — Volume accelerator (tier table)" style={{ marginBottom: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
              <thead><tr><th style={thCell}>Tier</th><th style={thCell}>Min active</th><th style={thCell}>Max active</th><th style={thCell}>Rate (fraction of margin)</th><th style={thCell}>Rate %</th></tr></thead>
              <tbody>
                {tiers.map((t, i) => (
                  <tr key={t.tier}>
                    <td style={tdCell}><Badge text={t.tier} color={TIER_BADGE[t.tier.toLowerCase()] ?? colors.secondary} /></td>
                    <td style={tdCell}><Input type="number" min={0} value={t.min_count} onChange={(e) => setTier(i, { min_count: Number(e.target.value) })} /></td>
                    <td style={tdCell}>
                      <Input type="number" min={0} value={t.max_count ?? ''} placeholder="∞ (open-ended)" onChange={(e) => setTier(i, { max_count: e.target.value === '' ? null : Number(e.target.value) })} />
                    </td>
                    <td style={tdCell}><Input type="number" step={0.01} min={0} max={1} value={t.rate} onChange={(e) => setTier(i, { rate: Number(e.target.value) })} /></td>
                    <td style={{ ...tdCell, color: colors.muted }}>{formatPct(t.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Draft — Milestone bonuses (one-time)" style={{ marginBottom: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
              <thead><tr><th style={thCell}>Threshold (active referrals)</th><th style={thCell}>Bonus (kobo)</th><th style={thCell}>Bonus (₦)</th></tr></thead>
              <tbody>
                {milestones.map((m, i) => (
                  <tr key={m.threshold}>
                    <td style={tdCell}><Input type="number" min={1} value={m.threshold} onChange={(e) => setMilestone(i, { threshold: Number(e.target.value) })} /></td>
                    <td style={tdCell}><Input type="number" min={0} value={m.bonus_kobo} onChange={(e) => setMilestone(i, { bonus_kobo: Number(e.target.value) })} /></td>
                    <td style={{ ...tdCell, color: colors.muted }}>{formatNaira(m.bonus_kobo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Effective-date scheduler">
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 12 }}>
              <div style={{ minWidth: 260 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 4 }}>Effective from (leave blank = now)</label>
                <input type="datetime-local" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
              </div>
              <Button variant="primary" onClick={publish} disabled={publishing}>
                {publishing ? 'Publishing…' : `Publish new version (v${live.version + 1})`}
              </Button>
            </div>
            {publishResult && (
              <div style={{ marginTop: 14, border: `1px solid ${colors.success}`, background: tint(colors.success, 0.1), color: colors.success, borderRadius: 8, padding: '11px 14px', fontSize: 13 }}>
                Published <strong>v{publishResult.version}</strong>. {publishResult.warning}
              </div>
            )}
          </Card>
        </>
      ) : null}
    </Page>
  );
}
