'use client';

import { useEffect, useState } from 'react';
import { getLoyaltyDashboard, formatNaira, formatPoints } from '@/services/loyaltyAdminService';
import type { LoyaltyDashboard } from '@/types/loyaltyAdmin';
import { PageHeader, LoyaltyTabs, Card, Kpi, Badge, DisclosureNote, StateBlock, timeAgo, pct } from '../../events/_ui';
import { Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function LoyaltyDashboardPage() {
  const [data, setData] = useState<LoyaltyDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getLoyaltyDashboard()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const maxPts = data ? Math.max(...data.points_trend.flatMap((p) => [p.earned, p.redeemed]), 1) : 1;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Loyalty overview" subtitle="Points liability (non-cash), tier distribution, earn/redeem trend and redemption fraud across all live modules." action={<Button variant="outline" sm onClick={load}>Refresh</Button>} />
      <LoyaltyTabs active="overview" />

      <DisclosureNote>
        <strong>NL-4 — points are NOT cash.</strong> Points redeem only to airtime, bill credit,
        ticket discounts and perks — never bank cash-out. The liability figure is a <em>valuation</em>
        of outstanding points, not cash owed. Points are an append-only ledger (NL-8); every config
        change is audited (NL-12). Cash values shown ₦ (kobo); point balances labelled <code>pts</code>.
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No dashboard data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Points outstanding" value={formatPoints(data.points_outstanding)} sub="Unredeemed (non-cash)" accent={colors.primary} />
              <Kpi label="Liability valuation" value={formatNaira(data.points_liability_kobo)} sub="NL-4 — valuation, not cash owed" accent={colors.warning} />
              <Kpi label="Redemption value" value={`${formatNaira(data.points_redemption_value_kobo)} / pt`} />
              <Kpi label="Earned (30d)" value={formatPoints(data.points_earned_30d)} accent={colors.success} />
              <Kpi label="Redeemed (30d)" value={formatPoints(data.points_redeemed_30d)} />
              <Kpi label="Expiring (30d)" value={formatPoints(data.points_expiring_30d)} accent={data.points_expiring_30d > 0 ? colors.warning : undefined} />
              <Kpi label="Breakage rate" value={pct(data.breakage_rate)} sub="Expected unredeemed" />
              <Kpi label="Members" value={data.members_total.toLocaleString('en-NG')} />
              <Kpi label="Active earn rules" value={data.earn_rules_active.toLocaleString('en-NG')} />
              <Kpi label="Active catalog items" value={data.catalog_items_active.toLocaleString('en-NG')} />
              <Kpi label="Redemptions today" value={data.redemptions_today.toLocaleString('en-NG')} />
              <Kpi label="Redemption fraud open" value={data.redemption_fraud_open.toLocaleString('en-NG')} accent={data.redemption_fraud_open > 0 ? colors.danger : undefined} />
            </div>

            <Card title="Tier distribution">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={thCell}>Tier</th><th style={thCell}>Members</th><th style={thCell}>Share</th></tr></thead>
                <tbody>
                  {data.tier_distribution.map((t) => (
                    <tr key={t.tier}>
                      <td style={tdCell}>{t.tier}</td>
                      <td style={tdCell}>{t.members.toLocaleString('en-NG')}</td>
                      <td style={tdCell}>{pct(t.share_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Points earned vs redeemed (14d)" right={<span style={{ fontSize: '0.75rem', color: colors.muted }}>Earned (purple) vs redeemed (green)</span>}>
              {data.points_trend.length === 0 ? <p style={{ color: colors.muted }}>No data.</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {data.points_trend.map((p) => {
                    const eW = (p.earned / maxPts) * 100;
                    const rW = (p.redeemed / maxPts) * 100;
                    return (
                      <div key={p.date} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <span style={{ width: 78, flexShrink: 0, fontSize: '0.72rem', color: colors.muted }}>{p.date.slice(5)}</span>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <div style={{ height: 10, width: `${eW}%`, minWidth: 2, background: colors.primary, borderRadius: 2 }} title={`Earned ${formatPoints(p.earned)}`} />
                            <span style={{ fontSize: '0.7rem', color: colors.muted, whiteSpace: 'nowrap' }}>{formatPoints(p.earned)}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <div style={{ height: 10, width: `${rW}%`, minWidth: 2, background: colors.success, borderRadius: 2 }} title={`Redeemed ${formatPoints(p.redeemed)}`} />
                            <span style={{ fontSize: '0.7rem', color: colors.muted, whiteSpace: 'nowrap' }}>{formatPoints(p.redeemed)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card title="Recent activity">
              {data.activity.length === 0 ? <p style={{ color: colors.muted }}>No recent activity.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thCell}>Event</th><th style={thCell}>Type</th><th style={thCell}>Ref</th><th style={thCell}>When</th></tr></thead>
                  <tbody>
                    {data.activity.map((a) => (
                      <tr key={a.id}>
                        <td style={tdCell}>{a.label}</td>
                        <td style={tdCell}><Badge status={a.kind} label={a.kind.replace(/_/g, ' ')} /></td>
                        <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{a.ref ?? '—'}</code></td>
                        <td style={tdCell}>{timeAgo(a.created_at)}</td>
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
