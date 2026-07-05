'use client';

import { useEffect, useState } from 'react';
import { getReferralDashboard, formatNaira } from '@/services/referralAdminService';
import type { ReferralDashboard } from '@/types/referralAdmin';
import { PageHeader, ReferralTabs, Card, Kpi, Badge, btn, th, td, timeAgo, StateBlock } from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Referral growth dashboard"
        subtitle="K-factor, referral CAC, GMV, fraud rate & reward burn (A-SADM-01). True K-factor EXCLUDES house-captured organic signups (§7A.6)."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <ReferralTabs active="dashboard" />

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No dashboard data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="K-factor (true)" value={data.k_factor.toFixed(2)} sub={`Incl. house ${data.k_factor_incl_house.toFixed(2)} — not used for growth`} accent="#340075" />
              <Kpi label="Referral CAC" value={formatNaira(data.referral_cac_kobo)} sub={`vs paid ${formatNaira(data.paid_cac_kobo)}`} accent={data.referral_cac_kobo < data.paid_cac_kobo ? '#15803d' : '#9a3412'} />
              <Kpi label="Referred GMV" value={formatNaira(data.gmv_kobo)} />
              <Kpi label="Fraud rate" value={pct(data.fraud_rate)} accent={data.fraud_rate > 0.03 ? '#b91c1c' : undefined} />
              <Kpi label="Reward burn" value={formatNaira(data.reward_burn_kobo)} sub={`of ${formatNaira(data.reward_budget_kobo)} budget`} accent={data.reward_burn_kobo / data.reward_budget_kobo > 0.8 ? '#9a3412' : undefined} />
              <Kpi label="Reward-to-LTV" value={pct(data.reward_to_ltv_ratio)} />
              <Kpi label="Referred signups" value={data.referred_signups.toLocaleString('en-NG')} sub={`Activated ${pct(data.activated_rate)}`} />
              <Kpi label="House-captured" value={data.house_signups.toLocaleString('en-NG')} sub="Organic — excluded from K-factor" accent="#7c3aed" />
            </div>

            <Card title="Signups & burn — last 14 days" right={<span style={{ fontSize: '0.75rem', color: '#6b7280' }}>Referred (green) vs house (purple); burn line = ₦</span>}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.4rem', height: 160, overflowX: 'auto' }}>
                {data.trend.map((t) => {
                  const total = t.referred + t.house || 1;
                  const refH = (t.referred / total) * 120;
                  const houseH = (t.house / total) * 120;
                  const burnH = (t.burn_kobo / maxBurn) * 30 + 4;
                  return (
                    <div key={t.date} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 34 }}>
                      <div style={{ width: 18, height: burnH, background: '#f59e0b', borderRadius: 2, marginBottom: 2 }} title={`Burn ${formatNaira(t.burn_kobo)}`} />
                      <div style={{ display: 'flex', flexDirection: 'column-reverse', width: 18 }}>
                        <div style={{ height: refH, background: '#22c55e' }} title={`Referred ${t.referred}`} />
                        <div style={{ height: houseH, background: '#a855f7' }} title={`House ${t.house}`} />
                      </div>
                      <span style={{ fontSize: '0.6rem', color: '#9ca3af', marginTop: 2 }}>{t.date.slice(5)}</span>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card title="Recent activity">
              {data.activity.length === 0 ? <p style={{ color: '#6b7280' }}>No recent activity.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th()}>Event</th><th style={th()}>Type</th><th style={th()}>Ref</th><th style={th()}>When</th></tr></thead>
                  <tbody>
                    {data.activity.map((a) => (
                      <tr key={a.id}>
                        <td style={td()}>{a.label}</td>
                        <td style={td()}><Badge status={a.kind === 'house_capture' ? 'house' : a.kind} label={a.kind.replace(/_/g, ' ')} /></td>
                        <td style={td()}><code style={{ fontSize: '0.78rem' }}>{a.ref ?? '—'}</code></td>
                        <td style={td()}>{timeAgo(a.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
