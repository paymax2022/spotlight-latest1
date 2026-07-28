'use client';

import { useEffect, useState } from 'react';
import { getLabDashboard, formatNaira } from '@/services/healthLabAdminService';
import type { LabDashboard } from '@/types/healthLabAdmin';
import { PageHeader, LabTabs, Card, Kpi, Badge, DisclosureNote, StateBlock, btn, th, td, timeAgo, pct } from '../../_ui';

export default function LabDashboardPage() {
  const [data, setData] = useState<LabDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getLabDashboard()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const maxTat = data ? Math.max(...data.tat_trend.map((p) => p.tat_hours), 1) : 1;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Laboratory overview"
        subtitle="Orders, GMV, turnaround time (TAT), chain-of-custody integrity, critical-result escalation, results release controls and held→released payment flow across the MLSCN-verified lab network."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <LabTabs active="overview" />

      <DisclosureNote>
        Paymax is the marketplace layer — MLSCN-licensed labs and registered scientists run all testing (HL-1).
        Supply is credential-gated (HL-2). Every sample is tracked on an immutable chain-of-custody; any break
        forces recollection and no result releases on a broken chain (HL-6). Abnormal/critical values trigger a
        defined human escalation — never silent (HL-7). Health data is sensitive under NDPA — results release only
        with consent + scientist sign-off (HL-8). Patient payment is held in escrow and released on result
        release/fulfilment (HL-9). All money is in ₦ (kobo internally).
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No dashboard data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Orders today" value={data.orders_today.toLocaleString('en-NG')} sub={`${data.orders_30d.toLocaleString('en-NG')} orders (30d)`} accent="#340075" />
              <Kpi label="GMV today" value={formatNaira(data.gmv_today_kobo)} sub={`${formatNaira(data.gmv_30d_kobo)} (30d)`} />
              <Kpi label="Net revenue (30d)" value={formatNaira(data.net_revenue_30d_kobo)} accent="#15803d" />
              <Kpi label="Take rate" value={pct(data.take_rate)} sub="Net ÷ GMV" />
              <Kpi label="Avg order value" value={formatNaira(data.avg_order_value_kobo)} />
              <Kpi label="Median TAT" value={`${data.tat_median_hours}h`} sub={`target ${data.tat_target_hours}h · ${data.tat_breaches} breaches`} accent={data.tat_median_hours > data.tat_target_hours ? '#b91c1c' : '#15803d'} />
              <Kpi label="Critical results open" value={data.critical_results_open.toLocaleString('en-NG')} sub={`${data.critical_results_30d} (30d) · HL-7 human path`} accent={data.critical_results_open > 0 ? '#b91c1c' : undefined} />
              <Kpi label="Escalation SLA" value={`${data.escalation_sla_minutes}m`} sub={`ack target ${data.escalation_sla_target_minutes}m (HL-7)`} accent={data.escalation_sla_minutes > data.escalation_sla_target_minutes ? '#b91c1c' : '#15803d'} />
              <Kpi label="Custody breaks open" value={data.custody_breaks_open.toLocaleString('en-NG')} sub={`${data.custody_breaks_30d} (30d) · HL-6 break→recollect`} accent={data.custody_breaks_open > 0 ? '#b91c1c' : undefined} />
              <Kpi label="Recollections required" value={data.recollections_required.toLocaleString('en-NG')} sub="HL-6 no result on broken chain" accent={data.recollections_required > 0 ? '#9a3412' : undefined} />
              <Kpi label="Samples in transit" value={data.samples_in_transit.toLocaleString('en-NG')} sub="last-mile custody" />
              <Kpi label="MLSCN pending" value={data.mlscn_pending_review.toLocaleString('en-NG')} sub="HL-2 credential gate" accent={data.mlscn_pending_review > 0 ? '#9a3412' : undefined} />
              <Kpi label="Catalog pending" value={data.catalog_pending_governance.toLocaleString('en-NG')} sub="test-definition governance" />
              <Kpi label="Results pending release" value={data.results_pending_release.toLocaleString('en-NG')} sub="HL-8 sign-off + consent" accent={data.results_pending_release > 0 ? '#9a3412' : undefined} />
              <Kpi label="Released (30d)" value={data.results_released_30d.toLocaleString('en-NG')} sub="results to patient vault" />
              <Kpi label="Payouts KYC hold" value={data.payouts_kyc_hold.toLocaleString('en-NG')} sub="HL-10 payout gate" accent={data.payouts_kyc_hold > 0 ? '#9a3412' : undefined} />
              <Kpi label="Held balance" value={formatNaira(data.held_balance_kobo)} sub="HL-9 escrow held" accent="#7c3aed" />
              <Kpi label="Released (30d) ₦" value={formatNaira(data.released_30d_kobo)} accent="#15803d" />
              <Kpi label="Refunded (30d) ₦" value={formatNaira(data.refunded_30d_kobo)} accent="#7c3aed" />
              <Kpi label="Labs active" value={data.labs_active.toLocaleString('en-NG')} sub={`${data.labs_suspended} suspended · ${data.phlebotomists_active} phlebotomists`} />
            </div>

            <Card title="Order mix (30d)">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Type</th><th style={th()}>Orders</th><th style={th()}>GMV</th><th style={th()}>Share</th></tr></thead>
                <tbody>
                  {data.order_mix.map((s) => (
                    <tr key={s.label}>
                      <td style={td()}>{s.label}</td>
                      <td style={td()}>{s.orders.toLocaleString('en-NG')}</td>
                      <td style={td()}>{formatNaira(s.gmv_kobo)}</td>
                      <td style={td()}>{pct(s.share_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Turnaround time trend (14d)" right={<span style={{ fontSize: '0.75rem', color: '#6b7280' }}>collection → result release · target {data.tat_target_hours}h</span>}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {data.tat_trend.map((p) => {
                  const w = (p.tat_hours / maxTat) * 100;
                  const over = p.tat_hours > data.tat_target_hours;
                  return (
                    <div key={p.date} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span style={{ width: 78, flexShrink: 0, fontSize: '0.72rem', color: '#9ca3af' }}>{p.date.slice(5)}</span>
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <div style={{ height: 10, width: `${w}%`, minWidth: 2, background: over ? '#b91c1c' : '#340075', borderRadius: 2 }} title={`${p.tat_hours}h`} />
                        <span style={{ fontSize: '0.7rem', color: over ? '#b91c1c' : '#6b7280', whiteSpace: 'nowrap' }}>{p.tat_hours}h</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card title="Recent activity">
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
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
