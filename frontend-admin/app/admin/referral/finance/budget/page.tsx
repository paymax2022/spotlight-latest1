'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getBudgetBurn, formatNaira } from '@/services/referralAdminOpsService';
import type { BudgetBurn } from '@/types/referralAdminOps';
import { PageHeader, Card, Kpi, Badge, btn, th, td, StateBlock } from '../../_ui';

export default function BudgetBurnPage() {
  const [data, setData] = useState<BudgetBurn | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getBudgetBurn()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const maxSpent = data ? Math.max(...data.trend.map((t) => t.spent_kobo), 1) : 1;
  const alertColor = (a: string) => a === 'breach' ? '#b91c1c' : a === 'warn' ? '#9a3412' : '#15803d';

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Finance — Budget & burn monitoring"
        subtitle="Real-time reward spend vs budget with exhaustion projections & alerts (A-FIN-03). Reward-to-LTV unit economics (A-FIN-04)."
        action={<Link href="/admin/referral/finance" style={{ ...btn(), textDecoration: 'none', color: '#374151' }}>← Payouts</Link>}
      />

      <StateBlock loading={loading} error={error} empty={!data}>
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px,1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Program budget" value={formatNaira(data.program_budget_kobo)} />
              <Kpi label="Program spent" value={formatNaira(data.program_spent_kobo)} sub={`${Math.round((data.program_spent_kobo / Math.max(data.program_budget_kobo, 1)) * 100)}% of budget`} accent={data.program_spent_kobo / data.program_budget_kobo > 0.8 ? '#9a3412' : undefined} />
              <Kpi label="Reward-to-LTV" value={`${(data.reward_to_ltv_ratio * 100).toFixed(1)}%`} sub={`Cap ${data.reward_to_ltv_cap_pct}%`} accent={data.reward_to_ltv_ratio * 100 > data.reward_to_ltv_cap_pct ? '#b91c1c' : '#15803d'} />
            </div>

            <Card title="Burn by scope">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={th()}>Scope</th><th style={th()}>Budget</th><th style={th()}>Spent</th>
                  <th style={th()}>Burn / day</th><th style={th()}>Projected exhaust</th><th style={th()}>Alert</th>
                </tr></thead>
                <tbody>
                  {data.lines.map((l) => {
                    const pct = Math.min(100, Math.round((l.spent_kobo / Math.max(l.budget_kobo, 1)) * 100));
                    return (
                      <tr key={l.scope}>
                        <td style={td()}>{l.scope}</td>
                        <td style={td()}>{formatNaira(l.budget_kobo)}</td>
                        <td style={td()}>
                          {formatNaira(l.spent_kobo)}
                          <div style={{ height: 6, background: '#f3f4f6', borderRadius: 9999, marginTop: 4 }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: alertColor(l.alert), borderRadius: 9999 }} />
                          </div>
                        </td>
                        <td style={td()}>{formatNaira(l.burn_rate_kobo_per_day)}</td>
                        <td style={td()}>{l.projected_exhaust_date ?? '—'}</td>
                        <td style={td()}><Badge status={l.alert === 'breach' ? 'critical' : l.alert === 'warn' ? 'high' : 'active'} label={l.alert} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>

            <Card title="Daily spend — last 14 days">
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.4rem', height: 130, overflowX: 'auto' }}>
                {data.trend.map((t) => (
                  <div key={t.date} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 30 }}>
                    <div style={{ width: 18, height: (t.spent_kobo / maxSpent) * 100 + 4, background: '#340075', borderRadius: 2 }} title={formatNaira(t.spent_kobo)} />
                    <span style={{ fontSize: '0.6rem', color: '#9ca3af', marginTop: 2 }}>{t.date.slice(5)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
