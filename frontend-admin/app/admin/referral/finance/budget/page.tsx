'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getBudgetBurn, formatNaira } from '@/services/referralAdminOpsService';
import type { BudgetBurn } from '@/types/referralAdminOps';
import { Page, PageHeader, Card, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (['active', 'approved', 'resolved', 'eligible', 'paid'].includes(s)) return colors.success;
  if (['closed', 'ended', 'draft'].includes(s)) return colors.secondary;
  if (['rejected', 'clawed_back', 'critical'].includes(s)) return colors.danger;
  if (['open', 'pending', 'high'].includes(s)) return colors.warning;
  return colors.secondary;
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
  const alertColor = (a: string) => a === 'breach' ? colors.danger : a === 'warn' ? colors.warning : colors.success;

  return (
    <Page>
      <PageHeader
        title="Finance — Budget & burn monitoring"
        subtitle="Real-time reward spend vs budget with exhaustion projections & alerts (A-FIN-03). Reward-to-LTV unit economics (A-FIN-04)."
        actions={<Link href="/admin/referral/finance" className="vx-btn vx-btn--outline vx-btn--sm" style={{ textDecoration: 'none' }}>← Payouts</Link>}
      />

      {loading ? (
        <p style={{ color: colors.muted }}>Loading…</p>
      ) : error ? (
        <p style={{ color: colors.danger }}>{error}</p>
      ) : !data ? null : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px,1fr))', gap: 12, marginBottom: 20 }}>
            <Kpi label="Program budget" value={data.program_budget_kobo === null ? 'Not set' : formatNaira(data.program_budget_kobo)} sub={data.program_budget_kobo === null ? 'No active global budget' : undefined} />
            <Kpi
              label="Program spent"
              value={data.program_spent_kobo === null ? 'Not available' : formatNaira(data.program_spent_kobo)}
              sub={data.program_spent_kobo !== null && data.program_budget_kobo ? `${Math.round((data.program_spent_kobo / data.program_budget_kobo) * 100)}% of budget` : undefined}
              accent={data.program_spent_kobo !== null && data.program_budget_kobo && data.program_spent_kobo / data.program_budget_kobo > 0.8 ? colors.warning : undefined}
            />
            <Kpi
              label="Reward-to-LTV"
              value={data.reward_to_ltv_ratio === null ? 'Not available' : `${(data.reward_to_ltv_ratio * 100).toFixed(1)}%`}
              sub={data.reward_to_ltv_cap_pct === null ? 'Cap not set' : `Cap ${data.reward_to_ltv_cap_pct}%`}
              accent={data.reward_to_ltv_ratio !== null && data.reward_to_ltv_cap_pct !== null && data.reward_to_ltv_ratio * 100 > data.reward_to_ltv_cap_pct ? colors.danger : undefined}
            />
          </div>

          <Card title="Burn by scope" style={{ marginBottom: 20 }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={thCell}>Scope</th><th style={thCell}>Budget</th><th style={thCell}>Spent</th>
                  <th style={thCell}>Burn / day</th><th style={thCell}>Projected exhaust</th><th style={thCell}>Alert</th>
                </tr></thead>
                <tbody>
                  {data.lines.map((l) => {
                    const pct = Math.min(100, Math.round((l.spent_kobo / Math.max(l.budget_kobo, 1)) * 100));
                    return (
                      <tr key={l.scope}>
                        <td style={tdCell}>{l.scope}</td>
                        <td style={tdCell}>{formatNaira(l.budget_kobo)}</td>
                        <td style={tdCell}>
                          {formatNaira(l.spent_kobo)}
                          <div style={{ height: 6, background: colors.headBg, borderRadius: 9999, marginTop: 4 }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: alertColor(l.alert), borderRadius: 9999 }} />
                          </div>
                        </td>
                        <td style={tdCell}>{l.burn_rate_kobo_per_day === null ? 'Not computed yet' : formatNaira(l.burn_rate_kobo_per_day)}</td>
                        <td style={tdCell}>{l.projected_exhaust_date ?? '—'}</td>
                        <td style={tdCell}><StatusBadge status={l.alert === 'breach' ? 'critical' : l.alert === 'warn' ? 'high' : 'active'} label={l.alert} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Daily spend — last 14 days">
            {data.trend.length === 0 ? <p style={{ color: colors.muted, margin: 0 }}>Not computed yet: the daily spend series has no endpoint yet.</p> : null}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 130, overflowX: 'auto' }}>
              {data.trend.map((t) => (
                <div key={t.date} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 30 }}>
                  <div style={{ width: 18, height: (t.spent_kobo / maxSpent) * 100 + 4, background: colors.primary, borderRadius: 2 }} title={formatNaira(t.spent_kobo)} />
                  <span style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>{t.date.slice(5)}</span>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </Page>
  );
}
