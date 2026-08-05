'use client';

import { useEffect, useState } from 'react';
import { getDashboard, formatNaira } from '@/services/insuranceAdminService';
import type { InsuranceDashboard } from '@/types/insuranceAdmin';
import {
  PageHeader,
  InsuranceTabs,
  Card,
  Kpi,
  Badge,
  DisclosureNote,
  StateBlock,
  btn,
  th,
  td,
  timeAgo,
} from '../_ui';
import { colors } from '@/components/ui/vuexy';

export default function InsuranceDashboardPage() {
  const [data, setData] = useState<InsuranceDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getDashboard()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const maxPremium = data ? Math.max(...data.premium_vs_commission.map((p) => p.premium_kobo), 1) : 1;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Insurance overview"
        subtitle="GWP, attach rate, claims ratio, commission, reconciliation breaks & provider health across MyCover.ai and Octamile rails."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <InsuranceTabs active="dashboard" />

      <DisclosureNote>
        All cover is underwritten by NAICOM-licensed insurers via MyCover.ai &amp; Octamile. Paymax
        does not underwrite — it distributes embedded and voluntary micro-insurance on their behalf.
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No dashboard data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="GWP today" value={formatNaira(data.gwp_today_kobo)} sub={`${data.policies_bound_today.toLocaleString('en-NG')} bound today`} accent={colors.primary} />
              <Kpi label="GWP (30d)" value={formatNaira(data.gwp_30d_kobo)} sub={`Collected ${formatNaira(data.premium_collected_30d_kobo)}`} />
              <Kpi label="Active policies" value={data.policies_active.toLocaleString('en-NG')} />
              <Kpi label="Attach rate" value={pct(data.attach_rate)} sub="Embedded on eligible events" />
              <Kpi label="Claims ratio" value={pct(data.claims_ratio)} sub="Incurred ÷ earned premium" accent={data.claims_ratio > 0.7 ? colors.danger : undefined} />
              <Kpi label="Open claims" value={data.claims_open.toLocaleString('en-NG')} sub={`${data.claims_settled_30d.toLocaleString('en-NG')} settled (30d)`} />
              <Kpi label="Commission (30d)" value={formatNaira(data.commission_earned_30d_kobo)} accent={colors.success} />
              <Kpi label="Recon breaks open" value={data.reconciliation_breaks_open.toLocaleString('en-NG')} sub={formatNaira(data.reconciliation_break_value_kobo)} accent={data.reconciliation_breaks_open > 0 ? colors.danger : undefined} />
              <Kpi label="Refunds pending" value={data.refunds_pending.toLocaleString('en-NG')} />
              <Kpi label="Renewals due (7d)" value={data.renewals_due_7d.toLocaleString('en-NG')} />
            </div>

            <Card title="Provider health">
              {data.provider_health.length === 0 ? <p style={{ color: colors.muted }}>No provider health data.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th()}>Provider</th>
                      <th style={th()}>Underwriter</th>
                      <th style={th()}>Status</th>
                      <th style={th()}>Uptime</th>
                      <th style={th()}>Quote p95</th>
                      <th style={th()}>Webhook lag</th>
                      <th style={th()}>Open breaks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.provider_health.map((p) => (
                      <tr key={p.provider}>
                        <td style={td()}>{p.provider}</td>
                        <td style={td()}>{p.underwriter}</td>
                        <td style={td()}><Badge status={p.status} /></td>
                        <td style={td()}>{p.uptime_pct.toFixed(2)}%</td>
                        <td style={td()}>{p.quote_p95_ms.toLocaleString('en-NG')} ms</td>
                        <td style={td()}>{p.webhook_lag_s.toLocaleString('en-NG')} s</td>
                        <td style={td()}>{p.open_breaks.toLocaleString('en-NG')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card title="Premium vs commission (14d)" right={<span style={{ fontSize: '0.75rem', color: colors.muted }}>Premium (purple) vs commission (green)</span>}>
              {data.premium_vs_commission.length === 0 ? <p style={{ color: colors.muted }}>No data.</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {data.premium_vs_commission.map((p) => {
                    const premW = (p.premium_kobo / maxPremium) * 100;
                    const commW = (p.commission_kobo / maxPremium) * 100;
                    return (
                      <div key={p.date} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <span style={{ width: 78, flexShrink: 0, fontSize: '0.72rem', color: colors.muted }}>{p.date.slice(5)}</span>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <div style={{ height: 10, width: `${premW}%`, minWidth: 2, background: colors.primary, borderRadius: 2 }} title={`Premium ${formatNaira(p.premium_kobo)}`} />
                            <span style={{ fontSize: '0.7rem', color: colors.muted, whiteSpace: 'nowrap' }}>{formatNaira(p.premium_kobo)}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <div style={{ height: 10, width: `${commW}%`, minWidth: 2, background: colors.success, borderRadius: 2 }} title={`Commission ${formatNaira(p.commission_kobo)}`} />
                            <span style={{ fontSize: '0.7rem', color: colors.muted, whiteSpace: 'nowrap' }}>{formatNaira(p.commission_kobo)}</span>
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
