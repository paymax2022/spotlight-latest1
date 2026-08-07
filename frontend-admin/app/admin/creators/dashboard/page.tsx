'use client';

import { useEffect, useState } from 'react';
import { getCreatorsDashboard, formatNaira } from '@/services/creatorsAdminService';
import type { CreatorsDashboard } from '@/types/creatorsAdmin';
import { PageHeader, CreatorsTabs, Card, Kpi, Badge, DisclosureNote, StateBlock, btn, th, td, timeAgo, pct } from '../_ui';
import { colors } from '@/components/ui/vuexy';

export default function CreatorsDashboardPage() {
  const [data, setData] = useState<CreatorsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getCreatorsDashboard()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const maxEarn = data ? Math.max(...data.earnings_trend.map((p) => p.tips_kobo + p.subs_kobo + p.gated_kobo), 1) : 1;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Creators overview"
        subtitle="Creator earnings (tips, subscriptions, gated content), payout liability, moderation backlog and abuse signals across the Creator storefront rails."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <CreatorsTabs active="overview" />

      <DisclosureNote>
        Creator income delivers <strong>goods, content or perks — never a financial return or revenue share</strong> (NL-5).
        Payouts are gated on KYC tier (NL-10). All content passes moderation with age-appropriate controls (NL-11).
        Every state change posts an immutable audit event (NL-12). All amounts shown ₦ (stored as kobo).
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No dashboard data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Creators total" value={data.creators_total.toLocaleString('en-NG')} sub={`${data.creators_verified.toLocaleString('en-NG')} verified`} accent={colors.primary} />
              <Kpi label="Pending verification" value={data.creators_pending_verification.toLocaleString('en-NG')} accent={data.creators_pending_verification > 0 ? colors.warning : undefined} />
              <Kpi label="Active subscriptions" value={data.active_subscriptions.toLocaleString('en-NG')} />
              <Kpi label="Tips volume (30d)" value={formatNaira(data.tips_volume_30d_kobo)} />
              <Kpi label="Subs revenue (30d)" value={formatNaira(data.subs_revenue_30d_kobo)} />
              <Kpi label="Gated revenue (30d)" value={formatNaira(data.gated_revenue_30d_kobo)} />
              <Kpi label="Gross creator earnings (30d)" value={formatNaira(data.gross_creator_earnings_30d_kobo)} accent={colors.success} />
              <Kpi label="Platform fee (30d)" value={formatNaira(data.platform_fee_30d_kobo)} sub={`Take rate ${pct(data.take_rate)}`} />
              <Kpi label="Payout liability" value={formatNaira(data.payout_liability_kobo)} sub="Earnings owed, not yet paid" accent={data.payout_liability_kobo > 0 ? colors.warning : undefined} />
              <Kpi label="Payouts on KYC hold" value={data.payouts_kyc_hold.toLocaleString('en-NG')} sub={`${formatNaira(data.payouts_kyc_hold_kobo)} · NL-10 gate`} accent={data.payouts_kyc_hold > 0 ? colors.warning : undefined} />
              <Kpi label="Content pending moderation" value={data.content_pending_moderation.toLocaleString('en-NG')} accent={data.content_pending_moderation > 0 ? colors.warning : undefined} />
              <Kpi label="Content flagged (NL-11)" value={data.content_flagged_open.toLocaleString('en-NG')} accent={data.content_flagged_open > 0 ? colors.danger : undefined} />
              <Kpi label="Billing failures open" value={data.billing_failed_open.toLocaleString('en-NG')} accent={data.billing_failed_open > 0 ? colors.warning : undefined} />
              <Kpi label="Fraud open" value={data.fraud_open.toLocaleString('en-NG')} accent={data.fraud_open > 0 ? colors.danger : undefined} />
            </div>

            <Card title="Top creators (30d)">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Creator</th><th style={th()}>Category</th><th style={th()}>Subscribers</th><th style={th()}>Earnings (30d)</th></tr></thead>
                <tbody>
                  {data.top_creators.map((c) => (
                    <tr key={c.id}>
                      <td style={td()}>{c.handle_masked}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{c.id}</div></td>
                      <td style={td()}>{c.category}</td>
                      <td style={td()}>{c.subscribers.toLocaleString('en-NG')}</td>
                      <td style={td()}>{formatNaira(c.earnings_30d_kobo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Earnings mix (14d)" right={<span style={{ fontSize: '0.75rem', color: colors.muted }}>tips (purple) · subs (green) · gated (blue)</span>}>
              {data.earnings_trend.length === 0 ? <p style={{ color: colors.muted }}>No data.</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {data.earnings_trend.map((p) => {
                    const total = p.tips_kobo + p.subs_kobo + p.gated_kobo;
                    const w = (k: number) => (k / maxEarn) * 100;
                    return (
                      <div key={p.date} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <span style={{ width: 64, flexShrink: 0, fontSize: '0.72rem', color: colors.muted }}>{p.date.slice(5)}</span>
                        <div style={{ flex: 1, display: 'flex', height: 12, borderRadius: 3, overflow: 'hidden', background: colors.border }}>
                          <div style={{ width: `${w(p.tips_kobo)}%`, background: colors.primary }} title={`Tips ${formatNaira(p.tips_kobo)}`} />
                          <div style={{ width: `${w(p.subs_kobo)}%`, background: colors.success }} title={`Subs ${formatNaira(p.subs_kobo)}`} />
                          <div style={{ width: `${w(p.gated_kobo)}%`, background: colors.info }} title={`Gated ${formatNaira(p.gated_kobo)}`} />
                        </div>
                        <span style={{ width: 110, textAlign: 'right', fontSize: '0.7rem', color: colors.muted, whiteSpace: 'nowrap' }}>{formatNaira(total)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card title="Recent activity">
              {data.activity.length === 0 ? <p style={{ color: colors.muted }}>No recent activity.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th()}>Event</th><th style={th()}>Type</th><th style={th()}>Ref</th><th style={th()}>When</th></tr></thead>
                  <tbody>
                    {data.activity.map((a) => (
                      <tr key={a.id}>
                        <td style={td()}>{a.label}</td>
                        <td style={td()}><Badge status={a.kind} label={a.kind.replace(/_/g, ' ')} /></td>
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
