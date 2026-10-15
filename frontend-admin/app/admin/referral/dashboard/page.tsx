'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getReferralDashboardFigures, formatNaira, type DashboardFigures } from '@/services/referralAdminService';
import { Page, PageHeader, Card, Button, colors } from '@/components/ui/vuexy';
import { FixtureBanner } from '../../_shared/ui';
import { USE_MOCK, USE_MOCK_ENV } from '@/services/referralAdminService';

const REFERRAL_TABS = [
  { href: '/admin/referral/dashboard', label: 'Overview', key: 'dashboard' },
  { href: '/admin/referral/campaigns', label: 'Campaigns', key: 'campaigns' },
  { href: '/admin/referral/rewards', label: 'Rewards & Ledger', key: 'rewards' },
  { href: '/admin/referral/attribution', label: 'Attribution', key: 'attribution' },
  { href: '/admin/referral/house', label: 'House ledger', key: 'house' },
  { href: '/admin/referral/config', label: 'Config', key: 'config' },
];

function ReferralTabs({ active }: { active: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
      {REFERRAL_TABS.map((t) => (
        <Link key={t.key} href={t.href} style={{
          textDecoration: 'none', padding: '6px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600,
          color: active === t.key ? '#fff' : colors.text,
          background: active === t.key ? colors.primary : colors.headBg,
          border: `1px solid ${active === t.key ? colors.primary : colors.border}`,
        }}>{t.label}</Link>
      ))}
    </div>
  );
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

const NOT_COMPUTED = 'Not computed yet';

function show<T>(v: T | null, render: (x: T) => string): string {
  return v === null ? 'Not available' : render(v);
}

export default function ReferralDashboardPage() {
  const [figures, setFigures] = useState<DashboardFigures | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setFigures(await getReferralDashboardFigures()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  return (
    <Page>
      <PageHeader
        title="Referral growth dashboard"
        subtitle="Figures from the referral analytics, finance and risk endpoints. True K-factor EXCLUDES house-captured organic signups (§7A.6)."
        actions={<Button variant="outline" sm onClick={load}>Refresh</Button>}
      />
      <FixtureBanner active={USE_MOCK} envVar={USE_MOCK_ENV} />
      <ReferralTabs active="dashboard" />

      {loading ? (
        <p style={{ color: colors.muted }}>Loading…</p>
      ) : error ? (
        <p style={{ color: colors.danger }}>{error}</p>
      ) : !figures ? (
        <p style={{ color: colors.muted }}>No dashboard data available.</p>
      ) : (
        <>
          {figures.failedSources.length > 0 ? (
            <p style={{ color: colors.danger, marginBottom: 12 }}>
              Could not load: {figures.failedSources.join(', ')}. Those figures show as not available.
            </p>
          ) : null}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
            <Kpi
              label="K-factor (true)"
              value={show(figures.kFactor, (k) => k.toFixed(2))}
              sub={figures.referrers === null ? undefined : `${figures.referrers.toLocaleString('en-NG')} referrers`}
              accent={colors.primary}
            />
            <Kpi
              label="Referral CAC"
              value={show(figures.referralCacKobo, formatNaira)}
              sub={figures.paidCacKobo ? `vs paid ${formatNaira(figures.paidCacKobo)}` : 'No paid-CAC benchmark set'}
              accent={figures.referralCacKobo !== null && figures.paidCacKobo && figures.referralCacKobo < figures.paidCacKobo ? colors.success : undefined}
            />
            <Kpi label="Referred GMV" value={NOT_COMPUTED} />
            <Kpi
              label="Fraud rate"
              value={NOT_COMPUTED}
              sub={figures.openAlerts === null ? undefined : `${figures.openAlerts} open alerts · ${figures.activeBlocks ?? 0} active blocks`}
            />
            <Kpi
              label="Reward burn"
              value={show(figures.rewardSpentKobo, formatNaira)}
              sub={figures.globalBudgetKobo === null ? 'No active global budget' : `of ${formatNaira(figures.globalBudgetKobo)} global budget`}
            />
            <Kpi label="Reward-to-LTV" value={show(figures.rewardToLtv, pct)} />
            <Kpi
              label="Referred signups"
              value={show(figures.referredSignups, (n) => n.toLocaleString('en-NG'))}
              sub="Activation: not computed yet"
            />
            <Kpi
              label="House-captured"
              value={show(figures.houseSignups, (n) => n.toLocaleString('en-NG'))}
              sub="Organic — excluded from K-factor"
              accent={colors.primary}
            />
          </div>

          <Card title="Signups & burn — last 14 days" style={{ marginBottom: 20 }}>
            <p style={{ color: colors.muted, margin: 0 }}>
              {NOT_COMPUTED}: the daily series has no endpoint yet.
            </p>
          </Card>

          <Card title="Recent activity">
            <p style={{ color: colors.muted, margin: 0 }}>{NOT_COMPUTED}: there is no activity feed endpoint yet.</p>
          </Card>
        </>
      )}
    </Page>
  );
}
