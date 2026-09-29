'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { getPaystackOrderStatus } from '@/src/lib/restaurant/api';
import type { RestaurantPaystackStatus } from '@/src/types/restaurant';

const TERMINAL: Set<string> = new Set(['confirmed', 'order_failed', 'refunded', 'amount_mismatch']);
const MAX_POLLS = 10;
const POLL_MS = 3000;

export default function RestaurantPaystackStatusClient() {
  const searchParams = useSearchParams();
  const reference = searchParams.get('reference') || searchParams.get('trxref') || '';
  const [status, setStatus] = useState<RestaurantPaystackStatus | null>(null);
  const [error, setError] = useState('');
  const pollsRef = useRef(0);

  useEffect(() => {
    if (!reference) { setError('Missing payment reference.'); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const result = await getPaystackOrderStatus(reference);
        if (cancelled) return;
        if (!result) return; // redirected to login
        setStatus(result);
        pollsRef.current += 1;
        if (!TERMINAL.has(result.status) && pollsRef.current < MAX_POLLS) {
          timer = setTimeout(poll, POLL_MS);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to check payment status.');
      }
    }
    void poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [reference]);

  if (error) {
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '40px 20px', textAlign: 'center' }}>
        <p style={{ fontSize: 40 }}>⚠️</p>
        <p className="form-error">{error}</p>
        <Link href="/restaurant/orders" className="btn-outline py-2.5 px-4 text-[11px]">View My Orders</Link>
      </div>
    );
  }

  if (!status) {
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '40px 20px', textAlign: 'center' }}>
        <p style={{ fontSize: 40 }}>⏳</p>
        <p>Verifying your payment…</p>
      </div>
    );
  }

  const phase = status.status;
  const headline = {
    confirmed: '✅ Payment confirmed!',
    order_failed: '❌ Order could not be placed',
    amount_mismatch: '⚠️ Payment amount mismatch',
    refunded: '↩️ Payment refunded',
    pending: '⏳ Waiting for payment confirmation…',
    processing: '⏳ Processing your payment…',
  }[phase] || phase;

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '40px 20px', textAlign: 'center' }}>
      <p style={{ fontSize: 40 }}>{TERMINAL.has(phase) ? (phase === 'confirmed' ? '✅' : '⚠️') : '⏳'}</p>
      <h3>{headline}</h3>
      {status.orderId && phase === 'confirmed' ? (
        <Link href={`/restaurant/orders/${status.orderId}`} className="theme-btn" style={{ marginTop: 16, display: 'inline-block' }}>
          Track Your Order
        </Link>
      ) : (
        <Link href="/restaurant/orders" className="btn-outline py-2.5 px-4 text-[11px]" style={{ marginTop: 16, display: 'inline-block' }}>
          View My Orders
        </Link>
      )}
    </div>
  );
}
