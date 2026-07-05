'use client';

import { useEffect, useState } from 'react';
import { getEventsDashboard, formatNaira } from '@/services/eventsAdminService';
import type { EventsDashboard } from '@/types/eventsAdmin';
import { PageHeader, EventsTabs, Card, Kpi, Badge, DisclosureNote, StateBlock, btn, th, td, timeAgo, pct } from '../_ui';

export default function EventsDashboardPage() {
  const [data, setData] = useState<EventsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getEventsDashboard()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const maxGmv = data ? Math.max(...data.gmv_trend.map((p) => p.gmv_kobo), 1) : 1;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Events overview"
        subtitle="GMV, ticket sales, closed-loop cashless float & liability, vendor settlement and fraud across the Ticketing + Cashless event wallet rails."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <EventsTabs active="overview" />

      <DisclosureNote>
        Cashless event wallets are <strong>closed-loop</strong> — value is spendable only inside the
        event ecosystem and unspent balance (residual) is refunded to the funding wallet at close
        (NL-3). Vendor & organiser payouts are gated on KYC tier (NL-10). Every state change posts an
        immutable audit event (NL-12). All amounts shown ₦ (stored as kobo).
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No dashboard data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="GMV today" value={formatNaira(data.gmv_today_kobo)} sub={`${data.tickets_sold_today.toLocaleString('en-NG')} tickets today`} accent="#340075" />
              <Kpi label="GMV (30d)" value={formatNaira(data.gmv_30d_kobo)} sub={`${data.tickets_sold_30d.toLocaleString('en-NG')} tickets (30d)`} />
              <Kpi label="Take rate" value={pct(data.take_rate)} sub="Net ÷ GMV" />
              <Kpi label="Net revenue (30d)" value={formatNaira(data.net_revenue_30d_kobo)} accent="#15803d" />
              <Kpi label="Avg ticket price" value={formatNaira(data.avg_ticket_price_kobo)} />
              <Kpi label="Cashless float" value={formatNaira(data.cashless_float_kobo)} sub="Loaded on event wallets (closed-loop)" accent="#0e7490" />
              <Kpi label="Cashless liability" value={formatNaira(data.cashless_liability_kobo)} sub="Unspent — owed back to customers" accent={data.cashless_liability_kobo > 0 ? '#9a3412' : undefined} />
              <Kpi label="Residual refund pending" value={formatNaira(data.residual_refund_pending_kobo)} sub="NL-3 watch — refund at close" accent={data.residual_refund_pending_kobo > 0 ? '#b91c1c' : undefined} />
              <Kpi label="Vendor float" value={formatNaira(data.vendor_float_kobo)} sub="Awaiting settlement" />
              <Kpi label="Events live" value={data.events_live.toLocaleString('en-NG')} />
              <Kpi label="Pending approval" value={data.events_pending_approval.toLocaleString('en-NG')} accent={data.events_pending_approval > 0 ? '#9a3412' : undefined} />
              <Kpi label="Vendors active" value={data.vendors_active.toLocaleString('en-NG')} />
              <Kpi label="Payouts on KYC hold" value={data.vendor_payouts_kyc_hold.toLocaleString('en-NG')} sub="NL-10 gate" accent={data.vendor_payouts_kyc_hold > 0 ? '#9a3412' : undefined} />
              <Kpi label="Settlement breaks" value={data.settlement_breaks_open.toLocaleString('en-NG')} sub={formatNaira(data.settlement_break_value_kobo)} accent={data.settlement_breaks_open > 0 ? '#b91c1c' : undefined} />
              <Kpi label="Fraud open" value={data.fraud_open.toLocaleString('en-NG')} accent={data.fraud_open > 0 ? '#b91c1c' : undefined} />
            </div>

            <Card title="Ticket mix (30d)">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Tier</th><th style={th()}>Sold</th><th style={th()}>GMV</th><th style={th()}>Share</th></tr></thead>
                <tbody>
                  {data.ticket_mix.map((s) => (
                    <tr key={s.tier}>
                      <td style={td()}>{s.tier}</td>
                      <td style={td()}>{s.sold.toLocaleString('en-NG')}</td>
                      <td style={td()}>{formatNaira(s.gmv_kobo)}</td>
                      <td style={td()}>{pct(s.share_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="GMV vs net revenue (14d)" right={<span style={{ fontSize: '0.75rem', color: '#6b7280' }}>GMV (purple) vs net (green)</span>}>
              {data.gmv_trend.length === 0 ? <p style={{ color: '#6b7280' }}>No data.</p> : (
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
