'use client';

import { useEffect, useState } from 'react';
import { getDashboard, formatNaira } from '@/services/staysAdminService';
import type { StaysDashboard } from '@/types/staysAdmin';
import {
  PageHeader,
  StaysTabs,
  Card,
  Kpi,
  Badge,
  DisclosureNote,
  StateBlock,
  btn,
  th,
  td,
  timeAgo,
  pct,
} from '../_ui';

export default function StaysDashboardPage() {
  const [data, setData] = useState<StaysDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getDashboard()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const maxGmv = data ? Math.max(...data.gmv_trend.map((p) => p.gmv_kobo), 1) : 1;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Stays overview"
        subtitle="GMV, take rate, conversion, commission, reconciliation breaks & supplier mix across the bedbank (RateHawk, ZentrumHub) and direct rails."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <StaysTabs active="overview" />

      <DisclosureNote>
        Inventory spans a dual rail: bedbank suppliers (RateHawk, ZentrumHub) and Paymax direct
        hotels. Supplier source and FX are disclosed at quote and booking; cross-currency net rates
        are converted to ₦ at the applied FX rate. Money is held in escrow until supplier confirms.
      </DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No dashboard data available.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="GMV today" value={formatNaira(data.gmv_today_kobo)} sub={`${data.bookings_today.toLocaleString('en-NG')} bookings today`} accent="#340075" />
              <Kpi label="GMV (30d)" value={formatNaira(data.gmv_30d_kobo)} sub={`${data.bookings_30d.toLocaleString('en-NG')} bookings (30d)`} />
              <Kpi label="Take rate" value={pct(data.take_rate)} sub="Net revenue ÷ GMV" />
              <Kpi label="Conversion" value={pct(data.conversion)} sub="Search → book" />
              <Kpi label="Net revenue (30d)" value={formatNaira(data.net_revenue_30d_kobo)} accent="#15803d" />
              <Kpi label="Commission (30d)" value={formatNaira(data.commission_30d_kobo)} accent="#15803d" />
              <Kpi label="Recon breaks open" value={data.reconciliation_breaks_open.toLocaleString('en-NG')} sub={formatNaira(data.reconciliation_break_value_kobo)} accent={data.reconciliation_breaks_open > 0 ? '#b91c1c' : undefined} />
              <Kpi label="Refunds pending" value={data.refunds_pending.toLocaleString('en-NG')} />
              <Kpi label="Paid-but-unconfirmed" value={data.paid_unconfirmed.toLocaleString('en-NG')} sub="#1 invariant watch" accent="#b91c1c" />
              <Kpi label="Mapping conflicts" value={data.mapping_conflicts_open.toLocaleString('en-NG')} accent={data.mapping_conflicts_open > 0 ? '#9a3412' : undefined} />
              <Kpi label="Moderation pending" value={data.moderation_pending.toLocaleString('en-NG')} accent={data.moderation_pending > 0 ? '#9a3412' : undefined} />
              <Kpi label="Avg booking value" value={formatNaira(data.avg_booking_value_kobo)} />
            </div>

            <Card title="Supplier mix (30d)">
              {data.supplier_mix.length === 0 ? <p style={{ color: '#6b7280' }}>No supplier mix data.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th()}>Supplier</th>
                      <th style={th()}>Rail</th>
                      <th style={th()}>Bookings</th>
                      <th style={th()}>GMV</th>
                      <th style={th()}>Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.supplier_mix.map((s) => (
                      <tr key={s.supplier}>
                        <td style={td()}>{s.supplier}</td>
                        <td style={td()}><Badge status={s.rail} /></td>
                        <td style={td()}>{s.bookings.toLocaleString('en-NG')}</td>
                        <td style={td()}>{formatNaira(s.gmv_kobo)}</td>
                        <td style={td()}>{pct(s.share_pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
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
