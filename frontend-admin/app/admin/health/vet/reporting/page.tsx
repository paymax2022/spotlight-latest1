'use client';

import { useEffect, useState } from 'react';
import { getReporting, formatNaira } from '@/services/healthVetAdminService';
import type { VetReportingData } from '@/types/healthVetAdmin';
import { PageHeader, VetTabs, Card, Kpi, DisclosureNote, StateBlock, FilterBar, btn, btnPrimary, th, td, select, label, pct } from '../../_ui';

const PERIODS = [
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'ytd', label: 'Year to date' },
];

export default function VetReportingPage() {
  const [data, setData] = useState<VetReportingData | null>(null);
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
      <PageHeader title="Veterinary reporting" subtitle="GMV, appointment completion, no-show/refund rates, e-prescription discipline (HL-3), emergency (SOS) routing (HL-11) and KYC-held payouts (HL-10). All money in ₦." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <VetTabs active="reporting" />

      <DisclosureNote>
        Operational + compliance reporting for the vet vertical. e-Rx POM share (HL-3), SOS-routed count (HL-11)
        and KYC-held payouts (HL-10) are the headline safety metrics; GMV/net are in ₦ (kobo internally).
      </DisclosureNote>

      <FilterBar>
        <div>
          <label style={label()}>Period</label>
          <select style={select()} value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
        <button style={btnPrimary()} onClick={load}>Apply</button>
      </FilterBar>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No reporting data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="GMV" value={formatNaira(data.gmv_kobo)} sub={data.period_label} accent="#340075" />
              <Kpi label="Net revenue" value={formatNaira(data.net_revenue_kobo)} accent="#15803d" />
              <Kpi label="Appointments" value={data.appointments.toLocaleString('en-NG')} sub={`${data.tele_appointments.toLocaleString('en-NG')} tele · ${data.home_appointments.toLocaleString('en-NG')} home · ${data.clinic_appointments.toLocaleString('en-NG')} clinic`} />
              <Kpi label="Completion rate" value={pct(data.completion_rate)} />
              <Kpi label="No-show rate" value={pct(data.no_show_rate)} accent={data.no_show_rate > 0.06 ? '#b91c1c' : undefined} />
              <Kpi label="Refund rate" value={pct(data.refund_rate)} />
              <Kpi label="e-Prescriptions" value={data.eprescriptions.toLocaleString('en-NG')} sub={`POM share ${pct(data.pom_share)} · HL-3`} />
              <Kpi label="SOS routed" value={data.sos_routed.toLocaleString('en-NG')} sub="HL-11 in-person" accent={data.sos_routed > 0 ? '#b91c1c' : undefined} />
              <Kpi label="Payouts KYC hold" value={data.payouts_kyc_hold.toLocaleString('en-NG')} sub="HL-10" accent={data.payouts_kyc_hold > 0 ? '#9a3412' : undefined} />
            </div>

            <Card title="GMV by state">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>State</th><th style={th()}>Appointments</th><th style={th()}>GMV</th><th style={th()}>Share</th></tr></thead>
                <tbody>
                  {data.by_state.map((s) => (
                    <tr key={s.state}>
                      <td style={td()}>{s.state}</td>
                      <td style={td()}>{s.appointments.toLocaleString('en-NG')}</td>
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
                      <span style={{ width: 64, flexShrink: 0, fontSize: '0.72rem', color: '#9ca3af' }}>{m.month}</span>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <div style={{ height: 10, width: `${gmvW}%`, minWidth: 2, background: '#340075', borderRadius: 2 }} title={`GMV ${formatNaira(m.gmv_kobo)}`} />
                          <span style={{ fontSize: '0.7rem', color: '#6b7280', whiteSpace: 'nowrap' }}>{formatNaira(m.gmv_kobo)}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <div style={{ height: 10, width: `${netW}%`, minWidth: 2, background: '#15803d', borderRadius: 2 }} title={`Net ${formatNaira(m.net_kobo)}`} />
                          <span style={{ fontSize: '0.7rem', color: '#6b7280', whiteSpace: 'nowrap' }}>{formatNaira(m.net_kobo)} · {m.appointments.toLocaleString('en-NG')} appts</span>
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
