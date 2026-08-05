'use client';

import { useEffect, useState } from 'react';
import { getSavingsDashboard, formatNaira } from '@/services/savingsAdminService';
import type { SavingsDashboard } from '@/types/savingsAdmin';
import { SavingsTabs, Kpi, DisclosureNote, StateBlock, timeAgo, pct } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const SUCCESS_STATUSES = new Set(['active', 'open', 'matured', 'completed', 'settled', 'reconciled', 'resolved', 'paid', 'healthy', 'approved', 'on_track', 'recovered', 'cleared', 'balanced', 'verified', 'contribution']);
const DANGER_STATUSES = new Set(['rejected', 'failed', 'defaulted', 'blocked', 'high', 'critical', 'breached', 'suspended', 'impersonation', 'abuse']);
const WARNING_STATUSES = new Set(['pending', 'forming', 'scheduled', 'queued', 'flagged', 'degraded', 'at_risk', 'locked', 'grace', 'review', 'under_review', 'late', 'medium', 'debit', 'hold']);
const INFO_STATUSES = new Set(['investigating', 'processing', 'collecting', 'flex', 'normal', 'invited', 'payment', 'split', 'payout']);
const PRIMARY_STATUSES = new Set(['refunded', 'reversed', 'reversal', 'make_good', 'pool', 'request']);

function badgeColor(status: string): string {
  const s = status.toLowerCase();
  if (SUCCESS_STATUSES.has(s)) return colors.success;
  if (DANGER_STATUSES.has(s)) return colors.danger;
  if (WARNING_STATUSES.has(s)) return colors.warning;
  if (INFO_STATUSES.has(s)) return colors.info;
  if (PRIMARY_STATUSES.has(s)) return colors.primary;
  return colors.secondary;
}

function badgeText(status: string, label?: string): string {
  const t = (label ?? status.replace(/_/g, ' ')).toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

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
    <Page>
      <PageHeader
        title="Savings overview"
        subtitle="Float liability, vault / Ajo circle / group-target totals, payout queue and auto-save health across the savings book."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
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
              <Kpi label="Total float liability" value={formatNaira(data.total_float_liability_kobo)} sub="Customer money held (NL-8)" accent={colors.primary} />
              <Kpi label="Ledger balance" value={formatNaira(data.ledger_balance_kobo)} sub="Sum of ledger projections" />
              <Kpi label="Unreconciled delta" value={formatNaira(data.unreconciled_delta_kobo)} sub="Custody vs ledger" accent={data.unreconciled_delta_kobo !== 0 ? colors.danger : colors.success} />
              <Kpi label="Vaults" value={data.vaults_total.toLocaleString('en-NG')} sub={`${data.vaults_locked.toLocaleString('en-NG')} locked / ${data.vaults_flex.toLocaleString('en-NG')} flex`} />
              <Kpi label="Vault balance" value={formatNaira(data.vault_balance_kobo)} />
              <Kpi label="Ajo circles" value={data.circles_total.toLocaleString('en-NG')} sub={`${data.circles_active.toLocaleString('en-NG')} active`} />
              <Kpi label="Circle collections (30d)" value={formatNaira(data.circle_collections_30d_kobo)} />
              <Kpi label="Payout queue" value={data.payout_queue_count.toLocaleString('en-NG')} sub={formatNaira(data.payout_queue_value_kobo)} accent={data.payout_queue_count > 0 ? colors.warning : undefined} />
              <Kpi label="Group targets" value={data.targets_total.toLocaleString('en-NG')} sub={formatNaira(data.target_balance_kobo)} />
              <Kpi label="Defaults open" value={data.defaults_open.toLocaleString('en-NG')} sub={formatNaira(data.default_exposure_kobo)} accent={data.defaults_open > 0 ? colors.danger : undefined} />
              <Kpi label="Force-unlocks (30d)" value={data.force_unlocks_30d.toLocaleString('en-NG')} sub="Audited overrides" />
              <Kpi label="Auto-save runs today" value={data.auto_save_runs_today.toLocaleString('en-NG')} sub={`${data.auto_save_failures_today} failed`} accent={data.auto_save_failures_today > 0 ? colors.warning : undefined} />
            </div>

            <Card title="Product mix">
              {data.product_mix.length === 0 ? <p style={{ color: colors.muted }}>No product data.</p> : (
                <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thCell}>Product</th><th style={thCell}>Count</th><th style={thCell}>Balance</th><th style={thCell}>Share</th></tr></thead>
                  <tbody>
                    {data.product_mix.map((m) => (
                      <tr key={m.product}>
                        <td style={tdCell}><Badge text={badgeText(m.product)} color={badgeColor(m.product)} /></td>
                        <td style={tdCell}>{m.count.toLocaleString('en-NG')}</td>
                        <td style={tdCell}>{formatNaira(m.balance_kobo)}</td>
                        <td style={tdCell}>{pct(m.share_pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </Card>

            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Float liability trend (14d)</h2>
                <span style={{ fontSize: '0.75rem', color: colors.muted }}>Customer money held</span>
              </div>
              {data.float_trend.length === 0 ? <p style={{ color: colors.muted }}>No data.</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {data.float_trend.map((p) => {
                    const w = (p.float_kobo / maxFloat) * 100;
                    return (
                      <div key={p.date} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <span style={{ width: 78, flexShrink: 0, fontSize: '0.72rem', color: colors.muted }}>{p.date.slice(5)}</span>
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <div style={{ height: 10, width: `${w}%`, minWidth: 2, background: colors.primary, borderRadius: 2 }} title={formatNaira(p.float_kobo)} />
                          <span style={{ fontSize: '0.7rem', color: colors.muted, whiteSpace: 'nowrap' }}>{formatNaira(p.float_kobo)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
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
                        <td style={tdCell}><Badge text={badgeText(a.kind, a.kind.replace(/_/g, ' '))} color={badgeColor(a.kind)} /></td>
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
      </StateBlock>
    </Page>
  );
}
