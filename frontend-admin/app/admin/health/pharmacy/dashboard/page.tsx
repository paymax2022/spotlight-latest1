'use client';

import { useEffect, useState } from 'react';
import { getPharmacyDashboard, formatNaira } from '@/services/healthPharmacyAdminService';
import type { PharmacyDashboard } from '@/types/healthAdmin';
import { PageHeader, PharmacyTabs, Card, Kpi, Badge, DisclosureNote, StateBlock, btn, th, td, timeAgo, pct } from '../../_ui';

export default function PharmacyDashboardPage() {
  const [data, setData] = useState<PharmacyDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getPharmacyDashboard()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const maxGmv = data ? Math.max(...data.gmv_trend.map((p) => p.gmv_kobo), 1) : 1;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Pharmacy overview"
        subtitle="Orders, GMV, Rx-verification SLA, credential/catalog governance and held→released payment flow across the PCN-verified pharmacy network."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <PharmacyTabs active="overview" />

      <DisclosureNote>
        Paymax is the marketplace layer — licensed PCN pharmacies dispense (HL-1). Supply is credential-gated
        (HL-2), POM needs a pharmacist-verified e-prescription with server-side dispense-once (HL-3),
        controlled substances are excluded at MVP (HL-4), and only NAFDAC-registered products are listed (HL-5).
        Patient payment is held in escrow and released on delivery/pickup (HL-9). All money is in ₦ (kobo internally).
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
              <Kpi label="Rx pending verify" value={data.rx_pending_verification.toLocaleString('en-NG')} sub="HL-3 pharmacist gate" accent={data.rx_pending_verification > 0 ? '#9a3412' : undefined} />
              <Kpi label="Rx verify SLA" value={`${data.rx_verify_sla_minutes}m`} sub={`target ${data.rx_verify_sla_target_minutes}m · ${data.rx_verify_breaches} breaches`} accent={data.rx_verify_sla_minutes > data.rx_verify_sla_target_minutes ? '#b91c1c' : '#15803d'} />
              <Kpi label="PCN pending review" value={data.pcn_pending_review.toLocaleString('en-NG')} sub="HL-2 credential gate" accent={data.pcn_pending_review > 0 ? '#9a3412' : undefined} />
              <Kpi label="Catalog pending" value={data.catalog_pending_governance.toLocaleString('en-NG')} sub={`${data.catalog_unregistered_blocked} NAFDAC-blocked (HL-5)`} />
              <Kpi label="Controlled blocked" value={data.controlled_attempts_blocked.toLocaleString('en-NG')} sub="HL-4 excluded at MVP" accent={data.controlled_attempts_blocked > 0 ? '#b91c1c' : undefined} />
              <Kpi label="Recalls open" value={data.recalls_open.toLocaleString('en-NG')} accent={data.recalls_open > 0 ? '#9a3412' : undefined} />
              <Kpi label="Payouts KYC hold" value={data.payouts_kyc_hold.toLocaleString('en-NG')} sub="HL-10 payout gate" accent={data.payouts_kyc_hold > 0 ? '#9a3412' : undefined} />
              <Kpi label="Held balance" value={formatNaira(data.held_balance_kobo)} sub="HL-9 escrow held" accent="#7c3aed" />
              <Kpi label="Released (30d)" value={formatNaira(data.released_30d_kobo)} accent="#15803d" />
              <Kpi label="Refunded (30d)" value={formatNaira(data.refunded_30d_kobo)} accent="#7c3aed" />
              <Kpi label="Pharmacies active" value={data.pharmacies_active.toLocaleString('en-NG')} sub={`${data.pharmacies_suspended} suspended`} />
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

            <Card title="GMV vs net revenue (14d)" right={<span style={{ fontSize: '0.75rem', color: '#6b7280' }}>GMV (purple) vs net (green)</span>}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {data.gmv_trend.map((p) => {
                  const gmvW = (p.gmv_kobo / maxGmv) * 100;
                  const netW = (p.net_kobo / maxGmv) * 100;
                  return (
                    <div key={p.date} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span style={{ width: 78, flexShrink: 0, fontSize: '0.72rem', color: '#9ca3af' }}>{p.date.slice(5)}</span>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <div style={{ height: 10, width: `${gmvW}%`, minWidth: 2, background: '#340075', borderRadius: 2 }} title={`GMV ${formatNaira(p.gmv_kobo)}`} />
                          <span style={{ fontSize: '0.7rem', color: '#6b7280', whiteSpace: 'nowrap' }}>{formatNaira(p.gmv_kobo)}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <div style={{ height: 10, width: `${netW}%`, minWidth: 2, background: '#15803d', borderRadius: 2 }} title={`Net ${formatNaira(p.net_kobo)}`} />
                          <span style={{ fontSize: '0.7rem', color: '#6b7280', whiteSpace: 'nowrap' }}>{formatNaira(p.net_kobo)}</span>
                        </div>
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
