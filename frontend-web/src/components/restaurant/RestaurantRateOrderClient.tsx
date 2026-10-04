'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getOrder, rateOrder, RestaurantApiError } from '@/src/lib/restaurant';
import type { Order } from '@/src/types/restaurant';

function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, fontSize: 32 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, color: n <= value ? 'var(--accent-gold)' : 'var(--border)' }}
          aria-label={`${n} star${n !== 1 ? 's' : ''}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export default function RestaurantRateOrderClient({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [restaurantStars, setRestaurantStars] = useState(0);
  const [riderStars, setRiderStars] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [authError, setAuthError] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const result = await getOrder(orderId);
        if (!result) { setAuthError(true); return; }
        setOrder(result);
      } catch (e) {
        setMessage(e instanceof Error ? e.message : 'Unable to load this order.');
      } finally {
        setLoading(false);
      }
    })();
  }, [orderId]);

  async function submit() {
    if (restaurantStars < 1) { setMessage('Please rate the restaurant.'); return; }
    setBusy(true);
    setMessage('');
    try {
      await rateOrder(orderId, {
        restaurant_stars: restaurantStars,
        rider_stars: order?.rider_id ? riderStars || undefined : undefined,
        comment: comment.trim() || undefined,
      });
      router.push('/restaurant/orders');
    } catch (e) {
      setMessage(e instanceof RestaurantApiError ? e.message : 'Unable to submit your rating.');
    } finally {
      setBusy(false);
    }
  }

  if (!loading && authError) {
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '40px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>🔒</div>
        <h3>Sign in to rate your order</h3>
        <Link href={`/login?next=/restaurant/orders/${orderId}/rate`} className="theme-btn">Sign In</Link>
      </div>
    );
  }

  if (loading) {
    return <div style={{ height: 240, background: 'rgba(0,0,0,0.06)', borderRadius: 10 }} />;
  }

  if (order && order.status !== 'delivered') {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <p>This order hasn&apos;t been delivered yet.</p>
        <Link href={`/restaurant/orders/${orderId}`} className="btn-outline py-2.5 px-4 text-[11px]">Back to Order</Link>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-md p-4 md:p-5" style={{ maxWidth: 480, margin: '0 auto' }}>
      <p className="section-label mb-2">Rate Your Order</p>
      <h1 className="font-display text-2xl text-foreground" style={{ marginBottom: 20 }}>How was it?</h1>

      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Restaurant</p>
        <StarPicker value={restaurantStars} onChange={setRestaurantStars} />
      </div>

      {order?.rider_id && (
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Rider (optional)</p>
          <StarPicker value={riderStars} onChange={setRiderStars} />
        </div>
      )}

      <label className="d-block" style={{ marginBottom: 16 }}>
        <span className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim">Comment (optional)</span>
        <textarea className="form-input mt-1" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
      </label>

      {message && <p className="form-error" style={{ marginBottom: 12 }}>{message}</p>}

      <button type="button" className="btn-primary py-2.5 px-4 text-[11px]" disabled={busy} onClick={() => void submit()}>
        {busy ? 'Submitting…' : 'Submit Rating'}
      </button>
    </div>
  );
}
