'use client';

import { useEffect, useState } from 'react';
import { getReporting, formatNaira } from '@/services/healthLabAdminService';
import type { LabReportingData } from '@/types/healthLabAdmin';
import { LabTabs, Kpi, DisclosureNote, StateBlock, FilterBar, pct } from '../../_ui';
import { Page, PageHeader, Card, Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

const PERIODS = [
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'ytd', label: 'Year to date' },
];

export default function LabReportingPage() {
  const [data, setData] = useState<LabReportingData | null>(null);
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
    <Page>
      <PageHeader title="Laboratory reporting" subtitle="GMV, TAT, custody integrity (HL-6), critical-result escalation compliance (HL-7), refunds and KYC-held payouts (HL-10). All money in ₦." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <LabTabs active="reporting" />

      <DisclosureNote>
        Operational + compliance reporting for the lab vertical. Custody-break rate (HL-6) and
        critical-escalation compliance (HL-7) are the headline safety metrics; GMV/net are in ₦ (kobo internally).
      </DisclosureNote>

      <FilterBar>
        <div>
          <label>Period</label>
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
        <Button variant="primary" onClick={load}>Apply</Button>
      </FilterBar>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No reporting data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="GMV" value={formatNaira(data.gmv_kobo)} sub={data.period_label} accent={colors.primary} />
              <Kpi label="Net revenue" value={formatNaira(data.net_revenue_kobo)} accent={colors.success} />
              <Kpi label="Orders" value={data.orders.toLocaleString('en-NG')} sub={`${data.home_collection_orders.toLocaleString('en-NG')} home · ${data.walk_in_orders.toLocaleString('en-NG')} walk-in`} />
              <Kpi label="Refund rate" value={pct(data.refund_rate)} />
              <Kpi label="Median TAT" value={`${data.tat_median_hours}h`} sub={`breach rate ${pct(data.tat_breach_rate)}`} />
              <Kpi label="Custody break rate" value={pct(data.custody_break_rate)} sub="HL-6" accent={data.custody_break_rate > 0.01 ? colors.danger : colors.success} />
              <Kpi label="Critical results" value={data.critical_results.toLocaleString('en-NG')} sub="HL-7" />
              <Kpi label="Escalation compliance" value={pct(data.critical_escalation_compliance)} sub="ack within SLA (HL-7)" accent={data.critical_escalation_compliance < 0.95 ? colors.danger : colors.success} />
              <Kpi label="Payouts KYC hold" value={data.payouts_kyc_hold.toLocaleString('en-NG')} sub="HL-10" accent={data.payouts_kyc_hold > 0 ? colors.warning : undefined} />
            </div>

            <Card title="GMV by state">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={thCell}>State</th><th style={thCell}>Orders</th><th style={thCell}>GMV</th><th style={thCell}>Share</th></tr></thead>
                <tbody>
                  {data.by_state.map((s) => (
                    <tr key={s.state}>
                      <td style={tdCell}>{s.state}</td>
                      <td style={tdCell}>{s.orders.toLocaleString('en-NG')}</td>
                      <td style={tdCell}>{formatNaira(s.gmv_kobo)}</td>
                      <td style={tdCell}>{pct(s.share_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Monthly GMV vs net (6 months)">
              <p style={{ fontSize: '0.75rem', color: colors.muted, margin: '0 0 0.75rem' }}>GMV (purple) vs net (green)</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {data.monthly.map((m) => {
                  const gmvW = (m.gmv_kobo / maxGmv) * 100;
                  const netW = (m.net_kobo / maxGmv) * 100;
                  return (
                    <div key={m.month} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span style={{ width: 64, flexShrink: 0, fontSize: '0.72rem', color: colors.muted }}>{m.month}</span>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <div style={{ height: 10, width: `${gmvW}%`, minWidth: 2, background: colors.primary, borderRadius: 2 }} title={`GMV ${formatNaira(m.gmv_kobo)}`} />
                          <span style={{ fontSize: '0.7rem', color: colors.muted, whiteSpace: 'nowrap' }}>{formatNaira(m.gmv_kobo)}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <div style={{ height: 10, width: `${netW}%`, minWidth: 2, background: colors.success, borderRadius: 2 }} title={`Net ${formatNaira(m.net_kobo)}`} />
                          <span style={{ fontSize: '0.7rem', color: colors.muted, whiteSpace: 'nowrap' }}>{formatNaira(m.net_kobo)} · {m.orders.toLocaleString('en-NG')} orders</span>
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
    </Page>
  );
}
