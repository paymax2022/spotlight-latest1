'use client';

import { useEffect, useState } from 'react';
import { getDashboard, formatNaira } from '@/services/staysAdminService';
import type { StaysDashboard } from '@/types/staysAdmin';
import {
  StaysTabs,
  Card,
  Kpi,
  Badge,
  DisclosureNote,
  StateBlock,
  timeAgo,
  pct,
} from '../_ui';
import { Page, PageHeader, Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader
        title="Stays overview"
        subtitle="GMV, take rate, conversion, commission, reconciliation breaks & supplier mix across the bedbank (RateHawk, ZentrumHub) and direct rails."
        actions={<Button variant="outline" sm onClick={load}>Refresh</Button>}
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
              <Kpi label="GMV today" value={formatNaira(data.gmv_today_kobo)} sub={`${data.bookings_today.toLocaleString('en-NG')} bookings today`} accent={colors.primary} />
              <Kpi label="GMV (30d)" value={formatNaira(data.gmv_30d_kobo)} sub={`${data.bookings_30d.toLocaleString('en-NG')} bookings (30d)`} />
              <Kpi label="Take rate" value={pct(data.take_rate)} sub="Net revenue ÷ GMV" />
              <Kpi label="Conversion" value={pct(data.conversion)} sub="Search → book" />
              <Kpi label="Net revenue (30d)" value={formatNaira(data.net_revenue_30d_kobo)} accent={colors.success} />
              <Kpi label="Commission (30d)" value={formatNaira(data.commission_30d_kobo)} accent={colors.success} />
              <Kpi label="Recon breaks open" value={data.reconciliation_breaks_open.toLocaleString('en-NG')} sub={formatNaira(data.reconciliation_break_value_kobo)} accent={data.reconciliation_breaks_open > 0 ? colors.danger : undefined} />
              <Kpi label="Refunds pending" value={data.refunds_pending.toLocaleString('en-NG')} />
              <Kpi label="Paid-but-unconfirmed" value={data.paid_unconfirmed.toLocaleString('en-NG')} sub="#1 invariant watch" accent={colors.danger} />
              <Kpi label="Mapping conflicts" value={data.mapping_conflicts_open.toLocaleString('en-NG')} accent={data.mapping_conflicts_open > 0 ? colors.warning : undefined} />
              <Kpi label="Moderation pending" value={data.moderation_pending.toLocaleString('en-NG')} accent={data.moderation_pending > 0 ? colors.warning : undefined} />
              <Kpi label="Avg booking value" value={formatNaira(data.avg_booking_value_kobo)} />
            </div>

            <Card title="Supplier mix (30d)">
              {data.supplier_mix.length === 0 ? <p style={{ color: colors.muted }}>No supplier mix data.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thCell}>Supplier</th>
                      <th style={thCell}>Rail</th>
                      <th style={thCell}>Bookings</th>
                      <th style={thCell}>GMV</th>
                      <th style={thCell}>Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.supplier_mix.map((s) => (
                      <tr key={s.supplier}>
                        <td style={tdCell}>{s.supplier}</td>
                        <td style={tdCell}><Badge status={s.rail} /></td>
                        <td style={tdCell}>{s.bookings.toLocaleString('en-NG')}</td>
                        <td style={tdCell}>{formatNaira(s.gmv_kobo)}</td>
                        <td style={tdCell}>{pct(s.share_pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card title="GMV vs net revenue (14d)" right={<span style={{ fontSize: '0.75rem', color: colors.muted }}>GMV (purple) vs net (green)</span>}>
              {data.gmv_trend.length === 0 ? <p style={{ color: colors.muted }}>No data.</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {data.gmv_trend.map((p) => {
                    const gmvW = (p.gmv_kobo / maxGmv) * 100;
                    const netW = (p.net_kobo / maxGmv) * 100;
                    return (
                      <div key={p.date} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <span style={{ width: 78, flexShrink: 0, fontSize: '0.72rem', color: colors.muted }}>{p.date.slice(5)}</span>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <div style={{ height: 10, width: `${gmvW}%`, minWidth: 2, background: colors.primary, borderRadius: 2 }} title={`GMV ${formatNaira(p.gmv_kobo)}`} />
                            <span style={{ fontSize: '0.7rem', color: colors.muted, whiteSpace: 'nowrap' }}>{formatNaira(p.gmv_kobo)}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <div style={{ height: 10, width: `${netW}%`, minWidth: 2, background: colors.success, borderRadius: 2 }} title={`Net ${formatNaira(p.net_kobo)}`} />
                            <span style={{ fontSize: '0.7rem', color: colors.muted, whiteSpace: 'nowrap' }}>{formatNaira(p.net_kobo)}</span>
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
                  <thead><tr><th style={thCell}>Event</th><th style={thCell}>Type</th><th style={thCell}>Ref</th><th style={thCell}>When</th></tr></thead>
                  <tbody>
                    {data.activity.map((a) => (
                      <tr key={a.id}>
                        <td style={tdCell}>{a.label}</td>
                        <td style={tdCell}><Badge status={a.kind} label={a.kind.replace(/_/g, ' ')} /></td>
                        <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{a.ref ?? '—'}</code></td>
                        <td style={tdCell}>{timeAgo(a.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </>
        )}
      </StateBlock>
    </Page>
  );
}
