'use client';

import { useCallback, useEffect, useState } from 'react';
import { listOrdersAging, formatKobo } from '@/services/marketplaceAdminService';
import type { MktOrder } from '@/types/marketplaceAdmin';
import {
  PageHeader, MarketplaceTabs, Card, Kpi, StatusBadge, DisclosureNote, StateBlock, FilterBar,
  PermissionBanner, btn, th, td, input, label as lbl, timeAgo, fmtDate,
  MARKETPLACE_PERMS, useMarketplacePermission,
} from '../_ui';

export default function OrdersAgingPage() {
  const { allowed: canView } = useMarketplacePermission(MARKETPLACE_PERMS.ordersAging);
  const [rows, setRows] = useState<MktOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [minAgeHours, setMinAgeHours] = useState(72);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await listOrdersAging(minAgeHours)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [minAgeHours]);
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const totalAtRisk = rows.reduce((sum, o) => sum + o.amount_kobo, 0);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Marketplace — Orders Aging Dashboard"
        subtitle="Stuck / aging non-terminal escrow orders (e.g. in_delivery > 72h) that may need manual intervention."
        action={<button onClick={() => void load()} style={btn()}>Refresh</button>}
      />
      <MarketplaceTabs active="orders-aging" />
      <DisclosureNote>
        Backed by <code>GET /v1/marketplace/admin/orders/aging</code> (RBAC <code>marketplace.admin.orders.aging</code>). Read-only —
        use the Dispute workbench to intervene on a stuck order once a dispute is opened.
      </DisclosureNote>

      {!canView && <PermissionBanner permission={MARKETPLACE_PERMS.ordersAging} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Aging orders" value={String(rows.length)} accent={rows.length > 0 ? '#9a3412' : undefined} />
        <Kpi label="Total value at risk" value={formatKobo(totalAtRisk)} />
        <Kpi label="Min age filter" value={`${minAgeHours}h`} />
      </div>

      <FilterBar>
        <div style={{ maxWidth: 160 }}>
          <label style={lbl()}>Min age (hours)</label>
          <input style={input()} type="number" min={1} value={minAgeHours} onChange={(e) => setMinAgeHours(Number(e.target.value) || 72)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <button style={btn()} onClick={() => void load()}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={null} empty={rows.length === 0} emptyText="No aging orders — everything is moving on schedule.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Order</th><th style={th()}>Listing</th><th style={th()}>Amount</th>
              <th style={th()}>Status</th><th style={th()}>Age</th><th style={th()}>Last updated</th>
            </tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{o.id}</code></td>
                  <td style={td()}>{o.listing_title ?? o.listing_id}</td>
                  <td style={td()}>{formatKobo(o.amount_kobo)}</td>
                  <td style={td()}><StatusBadge status={o.status} /></td>
                  <td style={td()}>{o.age_hours != null ? `${o.age_hours}h` : timeAgo(o.created_at)}</td>
                  <td style={td()}>{fmtDate(o.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
