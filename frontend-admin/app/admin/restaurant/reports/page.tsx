'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getGMVReport, getNetRevenueReport, getCohortReport, exportReportCsv,
  type GMVReport, type NetRevenueReport, type CohortReport, type ReportQuery,
} from '@/services/restaurantAdminService';
import { useRestaurantPermissions, AccessNotice, naira } from '../_ui';
import { Page, PageHeader, Card, Button, Input, colors, thCell, tdCell } from '@/components/ui/vuexy';

// FOOD-UAT-G-007: GMV / net revenue / cohort dashboards (restaurant.admin.reports).
// frontend-admin ships no charting library, so "charts" are CSS bars over a table.
// Net revenue = platform share (settlements.fee_kobo); GMV = settled order totals.
// `zone` is a substring match on the order's delivery address.

type Tab = 'gmv' | 'net-revenue' | 'cohorts';
const TABS: { id: Tab; label: string }[] = [
  { id: 'gmv', label: 'GMV' },
  { id: 'net-revenue', label: 'Net revenue' },
  { id: 'cohorts', label: 'Cohorts' },
];

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`;

function Bars({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 140, margin: '12px 0', overflowX: 'auto' }} role="img" aria-label="bar chart">
      {rows.map((r) => (
        <div key={r.label} title={`${r.label}: ${naira(r.value)}`} style={{ flex: '1 0 14px', maxWidth: 48, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
          <div style={{ height: `${Math.round((r.value / max) * 100)}%`, minHeight: r.value > 0 ? 2 : 0, background: colors.primary, borderRadius: '3px 3px 0 0' }} />
        </div>
      ))}
    </div>
  );
}

export default function RestaurantReportsPage() {
  const { can } = useRestaurantPermissions();
  const [tab, setTab] = useState<Tab>('gmv');
  const today = new Date();
  const [from, setFrom] = useState(isoDay(new Date(today.getTime() - 29 * 86_400_000)));
  const [to, setTo] = useState(isoDay(today));
  const [restaurantId, setRestaurantId] = useState('');
  const [zone, setZone] = useState('');
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('day');
  const [gmv, setGmv] = useState<GMVReport | null>(null);
  const [net, setNet] = useState<NetRevenueReport | null>(null);
  const [cohorts, setCohorts] = useState<CohortReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useCallback((): ReportQuery => ({
    from, to, group_by: groupBy,
    restaurant_id: restaurantId.trim() || undefined,
    zone: zone.trim() || undefined,
  }), [from, to, groupBy, restaurantId, zone]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = query();
      if (tab === 'gmv') setGmv(await getGMVReport(q));
      else if (tab === 'net-revenue') setNet(await getNetRevenueReport(q));
      else setCohorts(await getCohortReport({ from: q.from, to: q.to }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [tab, query]);

  useEffect(() => { void load(); }, [load]);

  const exportCsv = async () => {
    try {
      const blob = await exportReportCsv(tab, query());
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `restaurant-${tab}-${from}_${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    }
  };

  const maxOffset = cohorts ? Math.max(0, ...cohorts.cohorts.flatMap((c) => c.retention.map((r) => r.month_offset))) : 0;

  return (
    <Page>
      <PageHeader
        title="Reports"
        subtitle="GMV, platform net revenue and customer cohorts for food delivery."
        actions={<Button variant="primary" onClick={() => void exportCsv()}>Export CSV</Button>}
      />
      {!can(['restaurant.admin.reports']) && <AccessNotice perm="restaurant.admin.reports" />}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }} role="tablist">
        {TABS.map((t) => (
          <Button key={t.id} role="tab" aria-selected={tab === t.id} variant={tab === t.id ? 'primary' : 'outline'} onClick={() => setTab(t.id)}>{t.label}</Button>
        ))}
      </div>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ fontSize: 12 }}>From<br /><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label style={{ fontSize: 12 }}>To<br /><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          {tab !== 'cohorts' && (
            <>
              <label style={{ fontSize: 12 }}>Restaurant ID (optional)<br /><Input value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)} placeholder="uuid" /></label>
              <label style={{ fontSize: 12 }}>Zone / area (optional)<br /><Input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="e.g. Lekki" /></label>
              <label style={{ fontSize: 12 }}>Group by<br />
                <select className="vx-input" value={groupBy} onChange={(e) => setGroupBy(e.target.value as 'day' | 'week' | 'month')}>
                  <option value="day">Day</option><option value="week">Week</option><option value="month">Month</option>
                </select>
              </label>
            </>
          )}
          <Button variant="outline" onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : 'Apply'}</Button>
        </div>
      </Card>

      {error && <Card style={{ marginBottom: 16, borderColor: colors.danger, color: colors.danger }}>{error}</Card>}

      {tab === 'gmv' && gmv && (
        <Card title={`GMV — ${naira(gmv.total_kobo)} across ${gmv.orders} settled orders`}>
          <Bars rows={gmv.buckets.map((b) => ({ label: b.bucket, value: b.gmv_kobo }))} />
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr><th style={thCell}>Period</th><th style={thCell}>Orders</th><th style={thCell}>GMV</th></tr></thead>
            <tbody>
              {gmv.buckets.map((b) => <tr key={b.bucket}><td style={tdCell}>{b.bucket}</td><td style={tdCell}>{b.orders}</td><td style={tdCell}>{naira(b.gmv_kobo)}</td></tr>)}
              {gmv.buckets.length === 0 && <tr><td style={tdCell} colSpan={3}>No settled orders in range.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}

      {tab === 'net-revenue' && net && (
        <Card title={`Net revenue (platform share) — ${naira(net.total_kobo)} across ${net.orders} settlements`}>
          <Bars rows={net.buckets.map((b) => ({ label: b.bucket, value: b.fee_kobo }))} />
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr><th style={thCell}>Period</th><th style={thCell}>Settlements</th><th style={thCell}>Platform fee</th></tr></thead>
            <tbody>
              {net.buckets.map((b) => <tr key={b.bucket}><td style={tdCell}>{b.bucket}</td><td style={tdCell}>{b.orders}</td><td style={tdCell}>{naira(b.fee_kobo)}</td></tr>)}
              {net.buckets.length === 0 && <tr><td style={tdCell} colSpan={3}>No settlements in range.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}

      {tab === 'cohorts' && cohorts && (
        <Card title="First-order cohorts — customers active N months after their first settled order">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={thCell}>Cohort</th><th style={thCell}>Customers</th><th style={thCell}>Repeat rate</th>
                  {Array.from({ length: maxOffset + 1 }, (_, i) => <th key={i} style={thCell}>M+{i}</th>)}
                </tr>
              </thead>
              <tbody>
                {cohorts.cohorts.map((c) => (
                  <tr key={c.cohort_month}>
                    <td style={tdCell}>{c.cohort_month}</td>
                    <td style={tdCell}>{c.customers}</td>
                    <td style={tdCell}>{pct(c.repeat_rate_bps)}</td>
                    {Array.from({ length: maxOffset + 1 }, (_, i) => {
                      const r = c.retention.find((x) => x.month_offset === i);
                      return <td key={i} style={tdCell}>{r ? `${pct(r.rate_bps)} (${r.active_customers})` : '—'}</td>;
                    })}
                  </tr>
                ))}
                {cohorts.cohorts.length === 0 && <tr><td style={tdCell} colSpan={3}>No cohorts in range.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </Page>
  );
}
