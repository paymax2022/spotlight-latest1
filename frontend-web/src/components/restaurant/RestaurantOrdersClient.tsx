'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listMyOrders } from '@/src/lib/restaurant/api';
import { formatNaira, orderStatusClass, orderStatusLabel } from '@/src/lib/restaurant/format';
import type { Order } from '@/src/types/restaurant';

export default function RestaurantOrdersClient() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const result = await listMyOrders();
        setOrders(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unable to load your orders.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <div style={{ height: 200, background: 'rgba(0,0,0,0.06)', borderRadius: 10 }} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h1 className="font-display text-3xl text-foreground" style={{ margin: 0 }}>My Food Orders</h1>
        <Link href="/restaurant" className="btn-outline py-2 px-3 text-[11px]">Order More</Link>
      </div>

      {error && <p className="form-error">{error}</p>}

      {orders.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--foreground-muted)' }}>
          <p style={{ fontSize: 32, marginBottom: 8 }}>🍽️</p>
          <p>You haven&apos;t placed any food orders yet.</p>
        </div>
      ) : (
        <div className="glass-card rounded-md" style={{ padding: '0 16px' }}>
          {orders.map((order) => (
            <Link
              key={order.id}
              href={`/restaurant/orders/${order.id}`}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '14px 0', borderBottom: '1px solid var(--border)', gap: 12, textDecoration: 'none', color: 'inherit',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>Order #{order.id.slice(0, 8)}</span>
                  <span className={orderStatusClass(order.status)} style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20 }}>
                    {orderStatusLabel(order.status)}
                  </span>
                </div>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--foreground-muted)' }}>
                  {order.items.length} item{order.items.length !== 1 ? 's' : ''} · {new Date(order.created_at).toLocaleString()}
                </p>
              </div>
              <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{formatNaira(order.total_kobo)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
