'use client';

import { useEffect, useState } from 'react';
import { getSavingsDashboard, formatNaira } from '@/services/savingsAdminService';
import type { SavingsDashboard } from '@/types/savingsAdmin';
import { PageHeader, SavingsTabs, Card, Kpi, Badge, DisclosureNote, StateBlock, btn, th, td, timeAgo, pct } from '../_ui';

export default function SavingsDashboardPage() {
  const [data, setData] = useState<SavingsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getSavingsDashboard()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const maxFloat = data ? Math.max(...data.float_trend.map((p) => p.float_kobo), 1) : 1;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Savings overview"
        subtitle="Float liability, vault / Ajo circle / group-target totals, payout queue and auto-save health across the savings book."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <SavingsTabs active="overview" />

      <DisclosureNote>
        NL-2 — Savings products earn <strong>zero yield</strong>: vaults, Ajo pools and group targets hold
        principal only. NL-7 — Ajo is <strong>peer rotation</strong>; Paymax provides ledger + escrow only and
        never advances credit. NL-8 — every balance is a projection of the immutable double-entry ledger.
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No dashboard data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Total float liability" value={formatNaira(data.total_float_liability_kobo)} sub="Customer money held (NL-8)" accent="#340075" />
              <Kpi label="Ledger balance" value={formatNaira(data.ledger_balance_kobo)} sub="Sum of ledger projections" />
              <Kpi label="Unreconciled delta" value={formatNaira(data.unreconciled_delta_kobo)} sub="Custody vs ledger" accent={data.unreconciled_delta_kobo !== 0 ? '#b91c1c' : '#15803d'} />
              <Kpi label="Vaults" value={data.vaults_total.toLocaleString('en-NG')} sub={`${data.vaults_locked.toLocaleString('en-NG')} locked / ${data.vaults_flex.toLocaleString('en-NG')} flex`} />
              <Kpi label="Vault balance" value={formatNaira(data.vault_balance_kobo)} />
              <Kpi label="Ajo circles" value={data.circles_total.toLocaleString('en-NG')} sub={`${data.circles_active.toLocaleString('en-NG')} active`} />
              <Kpi label="Circle collections (30d)" value={formatNaira(data.circle_collections_30d_kobo)} />
              <Kpi label="Payout queue" value={data.payout_queue_count.toLocaleString('en-NG')} sub={formatNaira(data.payout_queue_value_kobo)} accent={data.payout_queue_count > 0 ? '#9a3412' : undefined} />
              <Kpi label="Group targets" value={data.targets_total.toLocaleString('en-NG')} sub={formatNaira(data.target_balance_kobo)} />
              <Kpi label="Defaults open" value={data.defaults_open.toLocaleString('en-NG')} sub={formatNaira(data.default_exposure_kobo)} accent={data.defaults_open > 0 ? '#b91c1c' : undefined} />
              <Kpi label="Force-unlocks (30d)" value={data.force_unlocks_30d.toLocaleString('en-NG')} sub="Audited overrides" />
              <Kpi label="Auto-save runs today" value={data.auto_save_runs_today.toLocaleString('en-NG')} sub={`${data.auto_save_failures_today} failed`} accent={data.auto_save_failures_today > 0 ? '#9a3412' : undefined} />
            </div>

            <Card title="Product mix">
              {data.product_mix.length === 0 ? <p style={{ color: '#6b7280' }}>No product data.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th()}>Product</th><th style={th()}>Count</th><th style={th()}>Balance</th><th style={th()}>Share</th></tr></thead>
                  <tbody>
                    {data.product_mix.map((m) => (
                      <tr key={m.product}>
                        <td style={td()}><Badge status={m.product} /></td>
                        <td style={td()}>{m.count.toLocaleString('en-NG')}</td>
                        <td style={td()}>{formatNaira(m.balance_kobo)}</td>
                        <td style={td()}>{pct(m.share_pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card title="Float liability trend (14d)" right={<span style={{ fontSize: '0.75rem', color: '#6b7280' }}>Customer money held</span>}>
              {data.float_trend.length === 0 ? <p style={{ color: '#6b7280' }}>No data.</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {data.float_trend.map((p) => {
                    const w = (p.float_kobo / maxFloat) * 100;
                    return (
                      <div key={p.date} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <span style={{ width: 78, flexShrink: 0, fontSize: '0.72rem', color: '#9ca3af' }}>{p.date.slice(5)}</span>
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <div style={{ height: 10, width: `${w}%`, minWidth: 2, background: '#340075', borderRadius: 2 }} title={formatNaira(p.float_kobo)} />
                          <span style={{ fontSize: '0.7rem', color: '#6b7280', whiteSpace: 'nowrap' }}>{formatNaira(p.float_kobo)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card title="Recent activity">
              {data.activity.length === 0 ? <p style={{ color: '#6b7280' }}>No recent activity.</p> : (
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
