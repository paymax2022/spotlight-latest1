'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { cancelOrder, getOrder, RestaurantApiError } from '@/src/lib/restaurant/api';
import { formatNaira, orderStatusClass, orderStatusLabel } from '@/src/lib/restaurant/format';
import type { Order } from '@/src/types/restaurant';

const TERMINAL_STATUSES = new Set(['delivered', 'cancelled', 'rejected', 'dispatch_failed', 'delivery_failed']);
const CANCELLABLE_STATUSES = new Set(['pending', 'confirmed']);
const TIMELINE: Array<{ key: string; label: string }> = [
  { key: 'pending', label: 'Order Placed' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'ready', label: 'Ready' },
  { key: 'picked_up', label: 'On the Way' },
  { key: 'delivered', label: 'Delivered' },
];
const POLL_MS = 6000;

export default function RestaurantOrderTrackingClient({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [authError, setAuthError] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const result = await getOrder(orderId);
        if (cancelled) return;
        if (!result) { setAuthError(true); return; }
        setOrder(result);
        if (!TERMINAL_STATUSES.has(result.status)) {
          timerRef.current = setTimeout(tick, POLL_MS);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load this order.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void tick();
    return () => { cancelled = true; if (timerRef.current) clearTimeout(timerRef.current); };
  }, [orderId]);

  async function onCancel() {
    if (!order) return;
    setCancelling(true);
    try {
      await cancelOrder(order.restaurant_id, order.id);
      setOrder((prev) => prev ? { ...prev, status: 'cancelled' } : prev);
    } catch (e) {
      setError(e instanceof RestaurantApiError ? e.message : 'Unable to cancel this order.');
    } finally {
      setCancelling(false);
    }
  }

  if (!loading && authError) {
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '40px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>🔒</div>
        <h3>Sign in to track this order</h3>
        <Link href={`/login?next=/restaurant/orders/${orderId}`} className="theme-btn">Sign In</Link>
      </div>
    );
  }

  if (loading) {
    return <div style={{ height: 300, background: 'rgba(0,0,0,0.06)', borderRadius: 10 }} />;
  }

  if (error && !order) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <p className="form-error">{error}</p>
        <Link href="/restaurant/orders" className="btn-outline py-2.5 px-4 text-[11px]">Back to My Orders</Link>
      </div>
    );
  }

  if (!order) return null;

  const timelineIndex = TIMELINE.findIndex((step) => step.key === order.status);
  const isTerminalFailure = order.status === 'cancelled' || order.status === 'rejected' || order.status === 'dispatch_failed' || order.status === 'delivery_failed';

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4">
      <div className="glass-card rounded-md p-4 md:p-5">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
          <div>
            <p className="section-label mb-2">Order #{order.id.slice(0, 8)}</p>
            <h1 className="font-display text-2xl text-foreground" style={{ marginBottom: 4 }}>
              {orderStatusLabel(order.status)}
            </h1>
          </div>
          <span className={orderStatusClass(order.status)} style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20 }}>
            {orderStatusLabel(order.status)}
          </span>
        </div>

        {error && <p className="form-error" style={{ marginTop: 10 }}>{error}</p>}

        {!isTerminalFailure && (
          <div style={{ display: 'flex', marginTop: 24, marginBottom: 8 }}>
            {TIMELINE.map((step, idx) => (
              <div key={step.key} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{
                  width: 12, height: 12, borderRadius: '50%', margin: '0 auto 6px',
                  background: idx <= timelineIndex ? 'var(--accent-gold)' : 'var(--border)',
                }} />
                <p style={{ fontSize: 10, color: idx <= timelineIndex ? 'var(--foreground)' : 'var(--foreground-dim)', margin: 0 }}>{step.label}</p>
              </div>
            ))}
          </div>
        )}

        {order.status === 'dispatch_failed' && (
          <p style={{ marginTop: 16, color: '#dc2626' }}>No rider could be found for this order. Please contact support for a refund.</p>
        )}

        {(order.status === 'ready' || order.status === 'picked_up') && order.delivery_code && (
          <div style={{ marginTop: 20, background: 'rgba(212,168,67,0.1)', border: '1px solid var(--accent-gold)', borderRadius: 10, padding: 16, textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--foreground-muted)' }}>Give this code to your rider</p>
            <p style={{ margin: '4px 0 0', fontSize: 28, fontWeight: 800, letterSpacing: '0.15em' }}>{order.delivery_code}</p>
          </div>
        )}

        <div style={{ marginTop: 24 }}>
          <h5 style={{ fontWeight: 700, marginBottom: 10 }}>Order Details</h5>
          {order.items.map((item) => (
            <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
              <span>{item.quantity}× {item.name}</span>
              <span>{formatNaira(item.subtotal_kobo)}</span>
            </div>
          ))}
          <p style={{ marginTop: 10, fontSize: 13, color: 'var(--foreground-muted)' }}>Delivering to: {order.delivery_address}</p>
        </div>
      </div>

      <aside>
        <div className="glass-card rounded-md p-4" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span>Subtotal</span><span>{formatNaira(order.subtotal_kobo)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span>Packaging</span><span>{formatNaira(order.packaging_fee_kobo)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span>Delivery</span><span>{formatNaira(order.delivery_kobo)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <span>Total</span><span>{formatNaira(order.total_kobo)}</span>
          </div>

          {order.status === 'delivered' && (
            <Link href={`/restaurant/orders/${order.id}/rate`} className="btn-primary py-2.5 px-4 text-[11px]" style={{ textAlign: 'center' }}>
              Rate Your Order
            </Link>
          )}
          {CANCELLABLE_STATUSES.has(order.status) && (
            <button type="button" className="btn-outline py-2.5 px-4 text-[11px]" disabled={cancelling} onClick={() => void onCancel()}>
              {cancelling ? 'Cancelling…' : 'Cancel Order'}
            </button>
          )}
          <Link href="/restaurant/orders" className="btn-outline py-2.5 px-4 text-[11px]" style={{ textAlign: 'center' }}>
            Back to My Orders
          </Link>
        </div>
      </aside>
    </div>
  );
}
