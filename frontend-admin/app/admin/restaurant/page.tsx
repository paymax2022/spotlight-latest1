'use client';

import { useEffect, useState } from 'react';
import { listOrders, listRestaurants } from '@/services/restaurantAdminService';
import type { Order, OrderStatus, Restaurant } from '@/types/restaurantAdmin';
import { PageHeader, Card, Kpi, Badge, btn, th, td, naira } from './_ui';

const STATUSES: (OrderStatus | '')[] = ['', 'placed', 'accepted', 'preparing', 'ready', 'assigned', 'picked_up', 'delivered', 'cancelled', 'refunded', 'no_rider'];

const ACTIVE: OrderStatus[] = ['placed', 'accepted', 'preparing', 'ready', 'assigned', 'picked_up'];

export default function RestaurantAdminPage() {
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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Restaurant & Delivery"
        subtitle="Read-only monitoring — restaurants and the live order queue."
        action={<button onClick={() => load(status)} style={btn()}>Refresh</button>}
      />

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Restaurants" value={String(restaurants.length)} accent="#340075" sub={`${restaurants.filter((r) => r.is_open).length} open`} />
        <Kpi label="Active orders" value={String(activeCount)} accent={activeCount ? '#d97706' : '#16a34a'} sub="In the fulfilment pipeline" />
        <Kpi label="Delivered" value={String(deliveredCount)} accent="#16a34a" />
        <Kpi label="No-rider" value={String(stuckCount)} accent={stuckCount ? '#dc2626' : '#16a34a'} sub="Needs dispatch attention" />
        <Kpi label="Gross (delivered)" value={naira(grossKobo)} />
      </div>

      <Card title="Restaurants">
        {loading && restaurants.length === 0 ? (
          <p style={{ color: '#6b7280' }}>Loading restaurants…</p>
        ) : restaurants.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No restaurants.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th style={th()}>Name</th>
                  <th style={th()}>Cuisine</th>
                  <th style={th()}>Address</th>
                  <th style={th()}>State</th>
                  <th style={th()}>Rating</th>
                </tr>
              </thead>
              <tbody>
                {restaurants.map((r) => (
                  <tr key={r.id}>
                    <td style={td()}><strong>{r.name}</strong></td>
                    <td style={td()}>{r.cuisine || '—'}</td>
                    <td style={td()}>{r.address || '—'}</td>
                    <td style={td()}><Badge status={r.is_open ? 'delivered' : 'cancelled'} label={r.is_open ? 'Open' : 'Closed'} /></td>
                    <td style={td()}>{r.rating?.toFixed(1) ?? '—'} ({r.rating_count ?? 0})</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div style={{ display: 'flex', gap: 6, margin: '1.25rem 0 1rem', flexWrap: 'wrap' }}>
        {STATUSES.map((s) => (
          <button
            key={s || 'all'}
            onClick={() => setStatus(s)}
            style={{ ...btn(), ...(status === s ? { background: '#340075', color: '#fff', borderColor: '#340075' } : {}) }}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      <Card title="Order queue">
        {loading ? (
          <p style={{ color: '#6b7280' }}>Loading orders…</p>
        ) : orders.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No orders for this filter.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th style={th()}>Order</th>
                  <th style={th()}>Restaurant</th>
                  <th style={th()}>Customer</th>
                  <th style={th()}>Rider</th>
                  <th style={th()}>Items</th>
                  <th style={th()}>Delivery</th>
                  <th style={th()}>Total</th>
                  <th style={th()}>Status</th>
                  <th style={th()}>Created</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td style={td()} title={o.id}>{o.id.slice(0, 10)}</td>
                    <td style={td()}>{o.restaurant_name || o.restaurant_id}</td>
                    <td style={td()} title={o.customer_id}>{o.customer_id.slice(0, 10)}…</td>
                    <td style={td()}>{o.rider_id ? o.rider_id : <span style={{ color: '#9ca3af' }}>unassigned</span>}</td>
                    <td style={td()}>{(o.items ?? []).reduce((s, it) => s + (it.quantity ?? 0), 0)}</td>
                    <td style={td()}>{naira(o.delivery_fee_kobo)}</td>
                    <td style={td()}><strong>{naira(o.total_kobo)}</strong></td>
                    <td style={td()}><Badge status={o.status} /></td>
                    <td style={td()}>{new Date(o.created_at).toLocaleString('en-NG')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: '#9ca3af' }}>
        Requires the <code>restaurant.manage</code> RBAC permission. Read-only monitoring — order
        mutations happen in the customer / restaurant / rider apps. The backend has no admin-wide
        order feed yet, so orders are aggregated from the role-scoped restaurant view.
      </p>
    </div>
  );
}
