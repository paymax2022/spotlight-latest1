'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { listOrders, listRestaurants } from '@/services/restaurantAdminService';
import type { Order, OrderStatus, Restaurant } from '@/types/restaurantAdmin';
import { naira } from './_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES: (OrderStatus | '')[] = ['', 'placed', 'accepted', 'preparing', 'ready', 'assigned', 'picked_up', 'delivered', 'cancelled', 'refunded', 'no_rider'];

const ACTIVE: OrderStatus[] = ['placed', 'accepted', 'preparing', 'ready', 'assigned', 'picked_up'];

const STATUS_COLOR: Record<string, string> = {
  placed: colors.info,
  accepted: colors.info,
  preparing: colors.warning,
  ready: colors.warning,
  assigned: colors.info,
  picked_up: colors.info,
  delivered: colors.success,
  cancelled: colors.secondary,
  refunded: colors.secondary,
  no_rider: colors.danger,
};

function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge text={label ?? status} color={STATUS_COLOR[status] ?? colors.secondary} />;
}

function KpiTile({ label, value, accent, sub }: { label: string; value: string; accent?: string; sub?: string }) {
  return (
    <Card style={{ padding: 14 }}>
      <div style={{ fontSize: 12, color: colors.muted }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent ?? colors.text, marginTop: 4 }}>{value}</div>
      {sub ? <div style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{sub}</div> : null}
    </Card>
  );
}

export default function RestaurantAdminPage() {
  const router = useRouter();
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(s: OrderStatus | '') {
    setLoading(true); setError(null);
    try {
      const [rs, os] = await Promise.all([listRestaurants(), listOrders(s || undefined as never)]);
      setRestaurants(rs);
      setOrders(os);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(status); }, [status]);

  const activeCount = orders.filter((o) => ACTIVE.includes(o.status)).length;
  const deliveredCount = orders.filter((o) => o.status === 'delivered').length;
  const stuckCount = orders.filter((o) => o.status === 'no_rider').length;
  const grossKobo = orders.filter((o) => o.status === 'delivered').reduce((s, o) => s + (o.total_kobo ?? 0), 0);

  return (
    <Page>
      <PageHeader
        title="Restaurant & Delivery"
        subtitle="Read-only monitoring — restaurants and the live order queue."
        actions={<Button variant="outline" onClick={() => load(status)}>Refresh</Button>}
      />

      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <KpiTile label="Restaurants" value={String(restaurants.length)} accent={colors.primary} sub={`${restaurants.filter((r) => r.is_open).length} open`} />
        <KpiTile label="Active orders" value={String(activeCount)} accent={activeCount ? colors.warning : colors.success} sub="In the fulfilment pipeline" />
        <KpiTile label="Delivered" value={String(deliveredCount)} accent={colors.success} />
        <KpiTile label="No-rider" value={String(stuckCount)} accent={stuckCount ? colors.danger : colors.success} sub="Needs dispatch attention" />
        <KpiTile label="Gross (delivered)" value={naira(grossKobo)} />
      </div>

      <Card title="Restaurants" style={{ marginBottom: '1.25rem' }}>
        {loading && restaurants.length === 0 ? (
          <p style={{ color: colors.muted }}>Loading restaurants…</p>
        ) : restaurants.length === 0 ? (
          <p style={{ color: colors.muted }}>No restaurants.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th style={thCell}>Name</th>
                  <th style={thCell}>Cuisine</th>
                  <th style={thCell}>Address</th>
                  <th style={thCell}>State</th>
                  <th style={thCell}>Rating</th>
                  <th style={thCell}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {restaurants.map((r) => (
                  <tr key={r.id}>
                    <td style={tdCell}><strong>{r.name}</strong></td>
                    <td style={tdCell}>{r.cuisine || '—'}</td>
                    <td style={tdCell}>{r.address || '—'}</td>
                    <td style={tdCell}><StatusBadge status={r.is_open ? 'delivered' : 'cancelled'} label={r.is_open ? 'Open' : 'Closed'} /></td>
                    <td style={tdCell}>{r.rating?.toFixed(1) ?? '—'} ({r.rating_count ?? 0})</td>
                    {/* The list was read-only with no way into a store. This is the
                        entry point to profile edit, force open/close and menu CRUD. */}
                    <td style={tdCell}>
                      <Button variant="outline" sm onClick={() => router.push(`/admin/restaurant/${r.id}`)}>
                        Manage
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div style={{ display: 'flex', gap: 6, margin: '1.25rem 0 1rem', flexWrap: 'wrap' }}>
        {STATUSES.map((s) => (
          <Button
            key={s || 'all'}
            sm
            variant={status === s ? 'primary' : 'outline'}
            onClick={() => setStatus(s)}
          >
            {s || 'All'}
          </Button>
        ))}
      </div>

      <Card title="Order queue">
        {loading ? (
          <p style={{ color: colors.muted }}>Loading orders…</p>
        ) : orders.length === 0 ? (
          <p style={{ color: colors.muted }}>No orders for this filter.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th style={thCell}>Order</th>
                  <th style={thCell}>Restaurant</th>
                  <th style={thCell}>Customer</th>
                  <th style={thCell}>Rider</th>
                  <th style={thCell}>Items</th>
                  <th style={thCell}>Delivery</th>
                  <th style={thCell}>Total</th>
                  <th style={thCell}>Status</th>
                  <th style={thCell}>Created</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td style={tdCell} title={o.id}>{o.id.slice(0, 10)}</td>
                    <td style={tdCell}>{o.restaurant_name || o.restaurant_id}</td>
                    <td style={tdCell} title={o.customer_id}>{o.customer_id.slice(0, 10)}…</td>
                    <td style={tdCell}>{o.rider_id ? o.rider_id : <span style={{ color: colors.muted }}>unassigned</span>}</td>
                    <td style={tdCell}>{(o.items ?? []).reduce((s, it) => s + (it.quantity ?? 0), 0)}</td>
                    <td style={tdCell}>{naira(o.delivery_fee_kobo)}</td>
                    <td style={tdCell}><strong>{naira(o.total_kobo)}</strong></td>
                    <td style={tdCell}><StatusBadge status={o.status} /></td>
                    <td style={tdCell}>{new Date(o.created_at).toLocaleString('en-NG')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: colors.muted }}>
        Requires the <code>restaurant.manage</code> RBAC permission. Read-only monitoring — order
        mutations happen in the customer / restaurant / rider apps. The backend has no admin-wide
        order feed yet, so orders are aggregated from the role-scoped restaurant view.
      </p>
    </Page>
  );
}
