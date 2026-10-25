'use client';

// Central Commission & Profit — profit dashboard. Date-range picker + /report
// (groupBy category | service | day) and /earnings. Shows total Spotlight revenue,
// a breakdown table, and a lightweight inline bar chart for the day series (no chart
// lib is bundled in frontend-admin, so we render SVG bars directly). All money is
// integer kobo, formatted to ₦ only for display.

import { useEffect, useMemo, useState } from 'react';
import {
  getReport, listEarnings, getReferralSummary, buildCategoryPaymentBreakdown, formatNaira,
  type ReportRow, type Earning, type GroupBy, type ReferralSummary, type ReferralReward, type CategoryPaymentBreakdown,
} from '@/services/commissionService';
import { PageHeader, Card, Kpi, Badge, CommissionTabs, StateBlock, th, td, label, input, btn } from '../_ui';

function daysAgo(n: number): string { return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10); }

export default function CommissionProfitPage() {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(daysAgo(0));
  const [groupBy, setGroupBy] = useState<GroupBy>('category');

  const [rows, setRows] = useState<ReportRow[]>([]);
  const [earnings, setEarnings] = useState<Earning[]>([]);
  const [referral, setReferral] = useState<ReferralSummary | null>(null);
  const [referralRewards, setReferralRewards] = useState<ReferralReward[]>([]);
  const [categoryPaymentBreakdown, setCategoryPaymentBreakdown] = useState<CategoryPaymentBreakdown[]>([]);
  const [breakdownView, setBreakdownView] = useState<'category' | 'payment'>('payment');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [r, e, ref] = await Promise.all([
        getReport({ from, to, groupBy }),
        listEarnings({ from, to, limit: 50 }),
        getReferralSummary({ from, to }),
      ]);
      setRows(r); setEarnings(e);
      setReferral(ref.summary); setReferralRewards(ref.rewards);
      setCategoryPaymentBreakdown(buildCategoryPaymentBreakdown(e, ref.rewards));
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [from, to, groupBy]);

  const totals = useMemo(() => rows.reduce((acc, r) => ({
    revenue: acc.revenue + r.spotlightRevenueKobo,
    gross: acc.gross + r.grossAmountKobo,
    commission: acc.commission + r.commissionKobo,
    platform: acc.platform + r.platformChargeKobo,
    convenience: acc.convenience + r.convenienceFeeKobo,
    fixed: acc.fixed + r.fixedFeeKobo,
    count: acc.count + r.count,
  }), { revenue: 0, gross: 0, commission: 0, platform: 0, convenience: 0, fixed: 0, count: 0 }), [rows]);

  // Spotlight profit = Spotlight revenue − the referral commission it paid out.
  // Referral commission is CREDITED + PENDING (owed), reversals are excluded.
  const referralKobo = referral?.earnedKobo ?? 0;
  const profitKobo = totals.revenue - referralKobo;

  const isDay = groupBy === 'day';

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Commission & Profit"
        subtitle="Realized Spotlight revenue across every super-app module. Aggregated from immutable commission_earnings rows; all money is ₦ (kobo/100)."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <CommissionTabs active="profit" />

      <Card title="Date range">
        <div style={{ display: 'flex', gap: '0.9rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={label()}>From</label>
            <input type="date" style={{ ...input(), width: 160 }} value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label style={label()}>To</label>
            <input type="date" style={{ ...input(), width: 160 }} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label style={label()}>Group by</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['category', 'service', 'day'] as GroupBy[]).map((g) => (
                <button key={g} onClick={() => setGroupBy(g)} style={btn(groupBy === g ? 'primary' : 'ghost')}>{g}</button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <Card title="Spotlight profit">
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'baseline', fontSize: '1.05rem' }}>
          <span><strong>{formatNaira(totals.revenue)}</strong> Total Spotlight revenue</span>
          <span style={{ color: '#6f6b7d' }}>−</span>
          <span><strong>{formatNaira(referralKobo)}</strong> Referral commission</span>
          <span style={{ color: '#6f6b7d' }}>=</span>
          <span style={{ color: profitKobo >= 0 ? '#15803d' : '#dc2626' }}>
            <strong>{formatNaira(profitKobo)}</strong> Spotlight profit
          </span>
        </div>
        {referral && referral.pendingKobo > 0 ? (
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.82rem', color: '#6f6b7d' }}>
            Referral commission includes {formatNaira(referral.pendingKobo)} not yet credited to referrers.
            {referral.reversedKobo > 0 ? ` ${formatNaira(referral.reversedKobo)} was reversed and is excluded.` : ''}
          </p>
        ) : null}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Total Spotlight revenue" value={formatNaira(totals.revenue)} sub={`${totals.count.toLocaleString('en-NG')} transactions`} accent="#15803d" />
        <Kpi label="Referral commission" value={formatNaira(referralKobo)} sub={`${(referral?.count ?? 0).toLocaleString('en-NG')} referred purchases`} />
        <Kpi label="Gross processed" value={formatNaira(totals.gross)} />
        <Kpi label="Commission" value={formatNaira(totals.commission)} />
        <Kpi label="Platform charge" value={formatNaira(totals.platform)} />
        <Kpi label="Convenience fees" value={formatNaira(totals.convenience)} />
        <Kpi label="Fixed fees" value={formatNaira(totals.fixed)} />
      </div>

      {isDay && (
        <Card title="Daily revenue">
          <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No revenue in this range.">
            <RevenueBars rows={rows} />
          </StateBlock>
        </Card>
      )}

      <Card title={breakdownView === 'category' ? `Breakdown by ${groupBy}` : 'Breakdown by service & payment method'}>
        <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={() => setBreakdownView('category')}
            style={btn(breakdownView === 'category' ? 'primary' : 'ghost')}
          >
            By Category
          </button>
          <button
            onClick={() => setBreakdownView('payment')}
            style={btn(breakdownView === 'payment' ? 'primary' : 'ghost')}
          >
            By Service & Payment
          </button>
        </div>

        <StateBlock loading={loading} error={error} empty={breakdownView === 'category' ? rows.length === 0 : categoryPaymentBreakdown.length === 0} emptyText="No transactions in this range.">
          <div style={{ overflowX: 'auto' }}>
            {breakdownView === 'category' ? (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th()}>{isDay ? 'Day' : groupBy === 'service' ? 'Category / service' : 'Category'}</th>
                    <th style={th()}>Txns</th>
                    <th style={th()}>Gross</th>
                    <th style={th()}>Commission</th>
                    <th style={th()}>Platform</th>
                    <th style={th()}>Convenience</th>
                    <th style={th()}>Fixed</th>
                    <th style={th()}>Spotlight revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.groupKey}>
                      <td style={{ ...td(), fontWeight: 600 }}>{r.groupKey.replace(/_/g, ' ')}</td>
                      <td style={td()}>{r.count.toLocaleString('en-NG')}</td>
                      <td style={td()}>{formatNaira(r.grossAmountKobo)}</td>
                      <td style={td()}>{formatNaira(r.commissionKobo)}</td>
                      <td style={td()}>{formatNaira(r.platformChargeKobo)}</td>
                      <td style={td()}>{formatNaira(r.convenienceFeeKobo)}</td>
                      <td style={td()}>{formatNaira(r.fixedFeeKobo)}</td>
                      <td style={{ ...td(), fontWeight: 700, color: '#15803d' }}>{formatNaira(r.spotlightRevenueKobo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th()}>Service</th>
                    <th style={th()}>Payment method</th>
                    <th style={th()}>Txns</th>
                    <th style={th()}>Gross</th>
                    <th style={th()}>Commission</th>
                    <th style={th()}>Spotlight revenue</th>
                    <th style={th()}>Referral commission</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryPaymentBreakdown.map((b) => (
                    <tr key={`${b.category}|${b.service}|${b.paymentMethod}`}>
                      <td style={{ ...td(), fontWeight: 600 }}>{b.service || b.category}</td>
                      <td style={td()}><Badge label={b.paymentMethod} tone={b.paymentMethod === 'card' ? 'neutral' : b.paymentMethod === 'wallet' ? 'ok' : 'neutral'} /></td>
                      <td style={td()}>{b.count.toLocaleString('en-NG')}</td>
                      <td style={td()}>{formatNaira(b.grossAmountKobo)}</td>
                      <td style={td()}>{formatNaira(b.commissionKobo)}</td>
                      <td style={{ ...td(), fontWeight: 700, color: '#15803d' }}>{formatNaira(b.spotlightRevenueKobo)}</td>
                      <td style={{ ...td(), fontWeight: 600, color: b.referralCommissionKobo ? '#15803d' : '#999' }}>{b.referralCommissionKobo ? formatNaira(b.referralCommissionKobo) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </StateBlock>
      </Card>

      <Card title="Referral earnings">
        <StateBlock loading={loading} error={error} empty={referralRewards.length === 0} emptyText="No referral commission paid in this range.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th()}>When</th>
                  <th style={th()}>Source</th>
                  <th style={th()}>Purchase revenue</th>
                  <th style={th()}>Rate</th>
                  <th style={th()}>Referral paid</th>
                  <th style={th()}>Status</th>
                  <th style={th()}>Referrer / referred</th>
                </tr>
              </thead>
              <tbody>
                {referralRewards.map((r) => (
                  <tr key={r.id}>
                    <td style={td()}>{new Date(r.createdAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                    <td style={td()}><Badge label={r.module} tone="neutral" /></td>
                    <td style={td()}>{formatNaira(r.marginKobo)}</td>
                    <td style={td()}>{Math.round(r.appliedRate * 100)}%</td>
                    <td style={{ ...td(), fontWeight: 600 }}>{formatNaira(r.rewardKobo)}</td>
                    <td style={td()}><Badge label={r.status.toLowerCase()} tone={r.status === 'CREDITED' ? 'ok' : r.status === 'REVERSED' ? 'off' : 'neutral'} /></td>
                    <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.referrerRef} → {r.referredUserRef}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StateBlock>
      </Card>

      <Card title="Recent earnings">
        <StateBlock loading={loading} error={error} empty={earnings.length === 0} emptyText="No earnings recorded in this range.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th()}>When</th>
                  <th style={th()}>Service</th>
                  <th style={th()}>Payment method</th>
                  <th style={th()}>Gross</th>
                  <th style={th()}>Commission</th>
                  <th style={th()}>Spotlight revenue</th>
                </tr>
              </thead>
              <tbody>
                {earnings.map((e) => (
                  <tr key={e.id}>
                    <td style={td()}>{new Date(e.createdAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                    <td style={td()}>{e.service}{e.serviceSubtype ? ` / ${e.serviceSubtype}` : ''}</td>
                    <td style={td()}><Badge label={e.paymentMethod || 'unknown'} tone={e.paymentMethod === 'card' ? 'neutral' : e.paymentMethod === 'wallet' ? 'ok' : 'neutral'} /></td>
                    <td style={td()}>{formatNaira(e.grossAmountKobo)}</td>
                    <td style={td()}>{formatNaira(e.commissionKobo)}</td>
                    <td style={{ ...td(), fontWeight: 600, color: '#15803d' }}>{formatNaira(e.spotlightRevenueKobo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StateBlock>
      </Card>
    </div>
  );
}

function RevenueBars({ rows }: { rows: ReportRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.spotlightRevenueKobo));
  const barW = 100 / rows.length;
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" style={{ width: '100%', height: 180, display: 'block' }}>
      {rows.map((r, i) => {
        const h = (r.spotlightRevenueKobo / max) * 36;
        return (
          <rect key={r.groupKey} x={i * barW + barW * 0.15} y={38 - h} width={barW * 0.7} height={h} fill="#15803d" rx={0.3}>
            <title>{`${r.day ?? r.groupKey}: ${formatNaira(r.spotlightRevenueKobo)}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
