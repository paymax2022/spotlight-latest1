'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getMarketplaceAnalytics, formatKobo } from '@/services/marketplaceAdminService';
import type { MktAnalytics } from '@/types/marketplaceAdmin';
import {
  PageHeader, MarketplaceTabs, Card, Kpi, DisclosureNote, StateBlock, FilterBar,
  PermissionBanner, btn, th, td, label as lbl, select,
  MARKETPLACE_PERMS, useMarketplacePermission,
} from '../_ui';

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

function pct(cur: number, prev: number): { text: string; up: boolean } {
  if (prev <= 0) return { text: '—', up: true };
  const d = ((cur - prev) / prev) * 100;
  return { text: `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`, up: d >= 0 };
}

const compactNaira = (kobo: number) => {
  const naira = kobo / 100;
  if (naira >= 1e9) return `₦${(naira / 1e9).toFixed(2)}B`;
  if (naira >= 1e6) return `₦${(naira / 1e6).toFixed(2)}M`;
  if (naira >= 1e3) return `₦${(naira / 1e3).toFixed(1)}k`;
  return `₦${naira.toFixed(0)}`;
};
const compactNum = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

export default function AnalyticsPage() {
  const { allowed: canView } = useMarketplacePermission(MARKETPLACE_PERMS.analytics, MARKETPLACE_PERMS.auditRead);
  const [data, setData] = useState<MktAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>(30);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await getMarketplaceAnalytics(range)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [range]);
  useEffect(() => { void load(); }, [load]);

  const gmvDelta = data ? pct(data.gmv_kobo, data.gmv_prev_kobo) : null;
  const maxGmv = useMemo(() => (data ? Math.max(...data.gmv_series.map((p) => p.gmv_kobo), 1) : 1), [data]);
  const funnel = data?.funnel;
  const viewToContact = funnel && funnel.views > 0 ? (funnel.contacts / funnel.views) * 100 : 0;
  const contactToDeal = funnel && funnel.contacts > 0 ? (funnel.deals / funnel.contacts) * 100 : 0;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Marketplace — Analytics"
        subtitle="GMV facilitated, platform revenue, activity, and the discovery→contact→deal funnel."
        action={<button onClick={() => void load()} style={btn()}>Refresh</button>}
      />
      <MarketplaceTabs active="analytics" />
      <DisclosureNote>
        Read-only. GMV is the transaction value <em>facilitated</em> (Paymax connects buyers and sellers; it does not hold
        deal funds — ADR-023). Revenue is the platform take (category commission + boost ad revenue). Figures are
        window totals/averages; timezone Africa/Lagos.
      </DisclosureNote>

      {!canView && <PermissionBanner permission={MARKETPLACE_PERMS.analytics} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <FilterBar>
        <div>
          <label style={lbl()}>Window</label>
          <select style={select()} value={range} onChange={(e) => setRange(Number(e.target.value) as Range)}>
            {RANGES.map((r) => <option key={r} value={r}>Last {r} days</option>)}
          </select>
        </div>
      </FilterBar>

      <StateBlock loading={loading} error={null} empty={!data} emptyText="No analytics available.">
        {data ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label={`GMV (last ${data.range_days}d)`} value={compactNaira(data.gmv_kobo)} sub={gmvDelta ? `${gmvDelta.text} vs prior ${data.range_days}d` : undefined} accent={gmvDelta?.up ? '#15803d' : '#b91c1c'} />
              <Kpi label="Platform revenue" value={compactNaira(data.revenue_kobo)} sub="commission + boosts" accent="#340075" />
              <Kpi label="Active listings" value={compactNum(data.active_listings)} sub={`${compactNum(data.new_listings)} new this window`} />
              <Kpi label="Daily active users" value={compactNum(data.dau)} sub="avg / day" />
              <Kpi label="Deals closed" value={compactNum(data.funnel.deals)} sub={`${contactToDeal.toFixed(1)}% of contacts`} />
            </div>

            <Card title={`GMV — last ${data.range_days} days`}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 160, overflowX: 'auto', paddingTop: '0.5rem' }}>
                {data.gmv_series.map((p) => (
                  <div key={p.date} title={`${p.date}: ${formatKobo(p.gmv_kobo)} · ${p.deals} deals`}
                    style={{ flex: '1 0 8px', minWidth: 8, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                    <div style={{ height: `${Math.max(4, (p.gmv_kobo / maxGmv) * 100)}%`, background: 'linear-gradient(#7c3aed,#340075)', borderRadius: '3px 3px 0 0' }} />
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#9ca3af', fontSize: '0.72rem', marginTop: '0.4rem' }}>
                <span>{data.gmv_series[0]?.date}</span>
                <span>peak {compactNaira(maxGmv)}/day</span>
                <span>{data.gmv_series[data.gmv_series.length - 1]?.date}</span>
              </div>
            </Card>

            <Card title="Conversion funnel">
              <FunnelBar label="Listing views" value={funnel!.views} pctOfTop={100} color="#340075" />
              <FunnelBar label="Seller contacts (chats)" value={funnel!.contacts} pctOfTop={funnel!.views ? (funnel!.contacts / funnel!.views) * 100 : 0} color="#7c3aed" note={`${viewToContact.toFixed(2)}% of views`} />
              <FunnelBar label="Deals closed" value={funnel!.deals} pctOfTop={funnel!.views ? (funnel!.deals / funnel!.views) * 100 : 0} color="#15803d" note={`${contactToDeal.toFixed(1)}% of contacts`} />
            </Card>

            <Card title="Top categories by GMV">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={th()}>Category</th><th style={th()}>GMV</th><th style={th()}>Share</th><th style={th()}>Active listings</th>
                </tr></thead>
                <tbody>
                  {data.top_categories.map((c) => {
                    const share = data.gmv_kobo > 0 ? (c.gmv_kobo / data.gmv_kobo) * 100 : 0;
                    return (
                      <tr key={c.category_id}>
                        <td style={td()}>{c.name}</td>
                        <td style={td()}>{compactNaira(c.gmv_kobo)}</td>
                        <td style={td()}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{ height: 6, width: 90, background: '#f3f4f6', borderRadius: 4, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${share}%`, background: '#340075' }} />
                            </div>
                            <span style={{ color: '#6b7280', fontSize: '0.78rem' }}>{share.toFixed(1)}%</span>
                          </div>
                        </td>
                        <td style={td()}>{compactNum(c.active_listings)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </>
        ) : null}
      </StateBlock>
    </div>
  );
}

function FunnelBar({ label, value, pctOfTop, color, note }: { label: string; value: number; pctOfTop: number; color: string; note?: string }) {
  return (
    <div style={{ marginBottom: '0.85rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: '#374151', marginBottom: '0.25rem' }}>
        <span style={{ fontWeight: 600 }}>{label}</span>
        <span>{compactNum(value)}{note ? <span style={{ color: '#9ca3af' }}> · {note}</span> : null}</span>
      </div>
      <div style={{ height: 22, background: '#f3f4f6', borderRadius: 6, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.max(2, pctOfTop)}%`, background: color, borderRadius: 6, transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}
