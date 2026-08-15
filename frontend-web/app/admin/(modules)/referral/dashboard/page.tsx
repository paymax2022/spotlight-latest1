'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getReferralDashboard, formatNaira } from '@/services/referralAdminService';
import type { ReferralDashboard } from '@/types/referralAdmin';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

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
  if (s === 'house') return colors.primary;
  if (['active', 'approved', 'resolved', 'eligible', 'paid'].includes(s)) return colors.success;
  if (['closed', 'ended', 'draft'].includes(s)) return colors.secondary;
  if (['rejected', 'clawed_back', 'critical'].includes(s)) return colors.danger;
  return colors.info;
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

export default function ReferralDashboardPage() {
  const [data, setData] = useState<ReferralDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getReferralDashboard()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const maxBurn = data ? Math.max(...data.trend.map((t) => t.burn_kobo), 1) : 1;

  return (
    <Page>
      <PageHeader
        title="Referral growth dashboard"
        subtitle="K-factor, referral CAC, GMV, fraud rate & reward burn (A-SADM-01). True K-factor EXCLUDES house-captured organic signups (§7A.6)."
        actions={<Button variant="outline" sm onClick={load}>Refresh</Button>}
      />
      <ReferralTabs active="dashboard" />

      {loading ? (
        <p style={{ color: colors.muted }}>Loading…</p>
      ) : error ? (
        <p style={{ color: colors.danger }}>{error}</p>
      ) : !data ? (
        <p style={{ color: colors.muted }}>No dashboard data available.</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
            <Kpi label="K-factor (true)" value={data.k_factor.toFixed(2)} sub={`Incl. house ${data.k_factor_incl_house.toFixed(2)} — not used for growth`} accent={colors.primary} />
            <Kpi label="Referral CAC" value={formatNaira(data.referral_cac_kobo)} sub={`vs paid ${formatNaira(data.paid_cac_kobo)}`} accent={data.referral_cac_kobo < data.paid_cac_kobo ? colors.success : colors.warning} />
            <Kpi label="Referred GMV" value={formatNaira(data.gmv_kobo)} />
            <Kpi label="Fraud rate" value={pct(data.fraud_rate)} accent={data.fraud_rate > 0.03 ? colors.danger : undefined} />
            <Kpi label="Reward burn" value={formatNaira(data.reward_burn_kobo)} sub={`of ${formatNaira(data.reward_budget_kobo)} budget`} accent={data.reward_burn_kobo / data.reward_budget_kobo > 0.8 ? colors.warning : undefined} />
            <Kpi label="Reward-to-LTV" value={pct(data.reward_to_ltv_ratio)} />
            <Kpi label="Referred signups" value={data.referred_signups.toLocaleString('en-NG')} sub={`Activated ${pct(data.activated_rate)}`} />
            <Kpi label="House-captured" value={data.house_signups.toLocaleString('en-NG')} sub="Organic — excluded from K-factor" accent={colors.primary} />
          </div>

          <Card title="Signups & burn — last 14 days" style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: colors.muted }}>Referred (green) vs house (purple); burn line = ₦</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 160, overflowX: 'auto' }}>
              {data.trend.map((t) => {
                const total = t.referred + t.house || 1;
                const refH = (t.referred / total) * 120;
                const houseH = (t.house / total) * 120;
                const burnH = (t.burn_kobo / maxBurn) * 30 + 4;
                return (
                  <div key={t.date} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 34 }}>
                    <div style={{ width: 18, height: burnH, background: colors.warning, borderRadius: 2, marginBottom: 2 }} title={`Burn ${formatNaira(t.burn_kobo)}`} />
                    <div style={{ display: 'flex', flexDirection: 'column-reverse', width: 18 }}>
                      <div style={{ height: refH, background: colors.success }} title={`Referred ${t.referred}`} />
                      <div style={{ height: houseH, background: colors.primary }} title={`House ${t.house}`} />
                    </div>
                    <span style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>{t.date.slice(5)}</span>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="Recent activity">
            {data.activity.length === 0 ? <p style={{ color: colors.muted }}>No recent activity.</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thCell}>Event</th><th style={thCell}>Type</th><th style={thCell}>Ref</th><th style={thCell}>When</th></tr></thead>
                  <tbody>
                    {data.activity.map((a) => (
                      <tr key={a.id}>
                        <td style={tdCell}>{a.label}</td>
                        <td style={tdCell}><StatusBadge status={a.kind === 'house_capture' ? 'house' : a.kind} label={a.kind.replace(/_/g, ' ')} /></td>
                        <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{a.ref ?? '—'}</code></td>
                        <td style={tdCell}>{timeAgo(a.created_at)}</td>
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
