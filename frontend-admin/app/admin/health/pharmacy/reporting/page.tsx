'use client';

import { useEffect, useState } from 'react';
import { getReporting, formatNaira } from '@/services/healthPharmacyAdminService';
import type { ReportingData } from '@/types/healthAdmin';
import { PageHeader, PharmacyTabs, Card, Kpi, DisclosureNote, StateBlock, FilterBar, btn, th, td, label, select, pct } from '../../_ui';

export default function ReportingPage() {
  const [data, setData] = useState<ReportingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState('30d');

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getReporting({ period })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [period]);

  const maxGmv = data ? Math.max(...data.monthly.map((m) => m.gmv_kobo), 1) : 1;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Pharmacy reporting" subtitle="Period reporting on GMV, net revenue, Rx vs OTC mix, NAFDAC-block and controlled-block rates, recalls and KYC-held payouts." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <PharmacyTabs active="reporting" />
      <DisclosureNote>Compliance metrics surface the HEALTH invariants: NAFDAC block rate (HL-5), controlled-substance blocks (HL-4), recalls issued, and KYC-held payouts (HL-10). All money is reported in ₦.</DisclosureNote>

      <FilterBar>
        <div>
          <label style={label()}>Period</label>
          <select style={select()} value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No reporting data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label={`GMV (${data.period_label})`} value={formatNaira(data.gmv_kobo)} accent="#340075" />
              <Kpi label="Net revenue" value={formatNaira(data.net_revenue_kobo)} accent="#15803d" />
              <Kpi label="Orders" value={data.orders.toLocaleString('en-NG')} sub={`${data.rx_orders.toLocaleString('en-NG')} Rx · ${data.otc_orders.toLocaleString('en-NG')} OTC`} />
              <Kpi label="Refund rate" value={pct(data.refund_rate)} />
              <Kpi label="Avg verify time" value={`${data.avg_verify_minutes}m`} sub="Rx pharmacist (HL-3)" />
              <Kpi label="NAFDAC block rate" value={pct(data.nafdac_block_rate)} sub="catalog writes rejected (HL-5)" accent="#9a3412" />
              <Kpi label="Controlled blocked" value={data.controlled_blocked.toLocaleString('en-NG')} sub="HL-4" accent={data.controlled_blocked > 0 ? '#b91c1c' : undefined} />
              <Kpi label="Recalls issued" value={data.recalls_issued.toLocaleString('en-NG')} />
              <Kpi label="Payouts KYC hold" value={data.payouts_kyc_hold.toLocaleString('en-NG')} sub="HL-10" accent={data.payouts_kyc_hold > 0 ? '#9a3412' : undefined} />
            </div>

            <Card title="Orders & GMV by state">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>State</th><th style={th()}>Orders</th><th style={th()}>GMV</th><th style={th()}>Share</th></tr></thead>
                <tbody>
                  {data.by_state.map((s) => (
                    <tr key={s.state}>
                      <td style={td()}>{s.state}</td>
                      <td style={td()}>{s.orders.toLocaleString('en-NG')}</td>
                      <td style={td()}>{formatNaira(s.gmv_kobo)}</td>
                      <td style={td()}>{pct(s.share_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Monthly GMV vs net (6 months)" right={<span style={{ fontSize: '0.75rem', color: '#6b7280' }}>GMV (purple) vs net (green)</span>}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {data.monthly.map((m) => {
                  const gmvW = (m.gmv_kobo / maxGmv) * 100;
                  const netW = (m.net_kobo / maxGmv) * 100;
                  return (
                    <div key={m.month} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span style={{ width: 70, flexShrink: 0, fontSize: '0.72rem', color: '#9ca3af' }}>{m.month}</span>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <div style={{ height: 10, width: `${gmvW}%`, minWidth: 2, background: '#340075', borderRadius: 2 }} />
                          <span style={{ fontSize: '0.7rem', color: '#6b7280', whiteSpace: 'nowrap' }}>{formatNaira(m.gmv_kobo)} · {m.orders.toLocaleString('en-NG')} ord</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <div style={{ height: 10, width: `${netW}%`, minWidth: 2, background: '#15803d', borderRadius: 2 }} />
                          <span style={{ fontSize: '0.7rem', color: '#6b7280', whiteSpace: 'nowrap' }}>{formatNaira(m.net_kobo)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
