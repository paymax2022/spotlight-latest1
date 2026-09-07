'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatNaira, getLiveSavingsDashboard } from '@/services/savingsAdminService';
import type { LiveSavingsDashboard } from '@/types/savingsAdmin';
import { SavingsTabs, Kpi, DisclosureNote, StateBlock } from '../_ui';
import { Page, PageHeader, Card, Button, colors } from '@/components/ui/vuexy';

/**
 * Savings overview — LIVE.
 *
 * This page used to run entirely on fixtures: invented float liability, an
 * invented ledger-vs-custody delta, invented auto-save runs and failures, an
 * invented activity feed. It now reads GET /api/savings/admin/dashboard, which
 * is backed by real queries over savings_vaults, savings_vault_ledger,
 * ajo_circles, ajo_members, ajo_cycles, group_targets and group_target_ledger.
 *
 * WHAT WAS REMOVED, AND WHY IT IS NOT SHOWN AS ZERO. Six figures had no source
 * in any table and are simply gone rather than rendered as 0:
 *
 *   total_float_liability / unreconciled_delta — both compare the ledger against
 *     CUSTODY (bank / virtual accounts). Nothing in savings can see custody, so a
 *     delta computed from one side is not a reconciliation. The fixture showed
 *     "balanced", which is a claim, not a measurement.
 *   auto_save_runs_today / auto_save_failures_today — the scheduler records no
 *     per-run history here. A zero failure count asserts nothing failed.
 *   force_unlocks_30d — no force-unlock endpoint exists to have produced any.
 *   float_trend / activity — need a time series and an event feed; neither exists.
 *
 * Losing them is the point. An operations console that shows six confident
 * numbers it never measured is worse than one that shows fifteen it did.
 */
export default function SavingsDashboardPage() {
  const [data, setData] = useState<LiveSavingsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getLiveSavingsDashboard());
    } catch (e) {
      // Shown verbatim. A 403 here means the admin lacks savings.admin.view,
      // which is a different problem from the backend being down, and the
      // operator can only tell them apart if we stop flattening both to
      // "could not load".
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totalHeld = data?.ledger_balance_kobo ?? 0;
  const share = (kobo: number) => (totalHeld > 0 ? Math.round((kobo / totalHeld) * 100) : 0);

  return (
    <Page>
      <PageHeader
        title="Savings overview"
        subtitle="Vaults, Ajo circles and group targets — balances projected from the ledger, live from the savings backend."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <SavingsTabs active="overview" />

      <DisclosureNote>
        NL-2 — Savings products earn <strong>zero yield</strong>: vaults, Ajo pools and group targets hold
        principal only, and the vault ledger rejects any row whose reason is interest or yield. NL-7 — Ajo is{' '}
        <strong>peer rotation</strong>; Paymax provides ledger + escrow only and never advances credit, so default
        exposure is what members owe each other. NL-8 — every balance below is a projection of the double-entry
        ledger, summed per request, never a stored column.
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No savings data available.">
        {data && (
          <>
            {/* Money held, by product. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Customer money held" value={formatNaira(data.ledger_balance_kobo)} sub="Ledger projection, all products" accent={colors.primary} />
              <Kpi label="Vault balance" value={formatNaira(data.vault_balance_kobo)} sub={`${data.vaults_total.toLocaleString('en-NG')} vaults`} />
              <Kpi label="Target balance" value={formatNaira(data.target_balance_kobo)} sub={`${data.targets_open.toLocaleString('en-NG')} of ${data.targets_total.toLocaleString('en-NG')} still open`} />
              <Kpi label="Payout queue" value={formatNaira(data.payout_queue_value_kobo)} sub={`${data.payout_queue_count.toLocaleString('en-NG')} cycle(s) awaiting payout`} accent={data.payout_queue_count > 0 ? colors.warning : undefined} />
            </div>

            {/* Risk — the part an operator acts on. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Members defaulted" value={data.defaults_open.toLocaleString('en-NG')} sub={`of ${data.members_total.toLocaleString('en-NG')} members`} accent={data.defaults_open > 0 ? colors.danger : undefined} />
              <Kpi label="Behind, not yet defaulted" value={data.members_at_risk.toLocaleString('en-NG')} sub="≥1 missed contribution" accent={data.members_at_risk > 0 ? colors.warning : undefined} />
              <Kpi label="Peer exposure" value={formatNaira(data.default_exposure_kobo)} sub="Owed between members (NL-7)" accent={data.default_exposure_kobo > 0 ? colors.danger : undefined} />
              <Kpi label="Missed contributions" value={data.missed_contributions_total.toLocaleString('en-NG')} sub="All circles, all time" />
            </div>

            {/* Composition. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Vaults locked / flex" value={`${data.vaults_locked.toLocaleString('en-NG')} / ${data.vaults_flex.toLocaleString('en-NG')}`} sub={`${data.vaults_matured.toLocaleString('en-NG')} matured`} />
              <Kpi label="Circles active" value={data.circles_active.toLocaleString('en-NG')} sub={`${data.circles_forming.toLocaleString('en-NG')} forming · ${data.circles_total.toLocaleString('en-NG')} total`} />
              <Kpi label="Collected (30d)" value={formatNaira(data.circle_collections_30d_kobo)} sub="Ajo cycles paid out" />
            </div>

            <Card title="Product mix">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: `1px solid ${colors.border ?? '#e5e7eb'}` }}>Product</th>
                    <th style={{ textAlign: 'right', padding: '0.5rem', borderBottom: `1px solid ${colors.border ?? '#e5e7eb'}` }}>Count</th>
                    <th style={{ textAlign: 'right', padding: '0.5rem', borderBottom: `1px solid ${colors.border ?? '#e5e7eb'}` }}>Balance</th>
                    <th style={{ textAlign: 'right', padding: '0.5rem', borderBottom: `1px solid ${colors.border ?? '#e5e7eb'}` }}>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {data.product_mix.map((row) => (
                    <tr key={row.product}>
                      <td style={{ padding: '0.5rem', textTransform: 'capitalize' }}>{row.product}</td>
                      <td style={{ padding: '0.5rem', textAlign: 'right' }}>{row.count.toLocaleString('en-NG')}</td>
                      <td style={{ padding: '0.5rem', textAlign: 'right' }}>{formatNaira(row.balance_kobo)}</td>
                      {/* Computed from the same figures shown, not reported separately. */}
                      <td style={{ padding: '0.5rem', textAlign: 'right' }}>{share(row.balance_kobo)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <p style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: '1rem', lineHeight: 1.6 }}>
              <strong>Not shown, because nothing measures it:</strong> custody float and the ledger-vs-custody
              delta (reconciliation needs a bank/VA balance the savings backend cannot see), auto-save runs and
              failures today (the scheduler keeps no per-run history), force-unlocks in the last 30 days (no such
              endpoint exists), and the float trend and activity feed (no time series, no event source). These were
              previously displayed as figures. They were fixtures.
            </p>
          </>
        )}
      </StateBlock>
    </Page>
  );
}
