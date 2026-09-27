'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch, isUnauthorized, redirectToLogin } from '@/src/lib/auth/flow';

type Phase = 'verifying' | 'polling' | 'successful' | 'failed';

const TERMINAL_STATUSES = new Set(['successful', 'failed', 'reversed']);
const MAX_POLLS = 10;
const POLL_INTERVAL_MS = 3000;

export default function UtilityPaystackStatusClient({ reference }: { reference: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('verifying');
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [statusLabel, setStatusLabel] = useState('');
  const [error, setError] = useState('');
  const pollCount = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function parse(response: Response) {
      if (isUnauthorized(response)) {
        redirectToLogin(`/utility/paystack/${reference}`);
        return null;
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.success === false) {
        throw new Error(String(payload?.error || 'Payment could not be confirmed.'));
      }
      return payload;
    }

    async function pollTransaction(id: string) {
      if (cancelled) return;
      try {
        const response = await authFetch(`/api/v1/utility/transactions/${id}`, { cache: 'no-store' });
        const payload = await parse(response);
        if (!payload || cancelled) return;
        const status = String(payload.transaction?.status || '');
        setStatusLabel(status);
        if (TERMINAL_STATUSES.has(status)) {
          setPhase(status === 'successful' ? 'successful' : 'failed');
          return;
        }
        pollCount.current += 1;
        if (pollCount.current >= MAX_POLLS) {
          setPhase('failed');
          setError('Still processing — check "Recent Payments" on the Utility Bills page shortly.');
          return;
        }
        setPhase('polling');
        setTimeout(() => void pollTransaction(id), POLL_INTERVAL_MS);
      } catch (err) {
        if (!cancelled) {
          setPhase('failed');
          setError(err instanceof Error ? err.message : 'Unable to check payment status.');
        }
      }
    }

    async function verify() {
      try {
        const response = await authFetch('/api/v1/utility/paystack/verify', {
          method: 'POST',
          body: JSON.stringify({ reference }),
        }, { json: true });
        const payload = await parse(response);
        if (!payload || cancelled) return;
        const transaction = payload.transaction;
        if (transaction?.id) setTransactionId(String(transaction.id));
        const status = String(transaction?.status || '');
        setStatusLabel(status);
        if (TERMINAL_STATUSES.has(status)) {
          setPhase(status === 'successful' ? 'successful' : 'failed');
        } else if (transaction?.id) {
          setPhase('polling');
          setTimeout(() => void pollTransaction(String(transaction.id)), POLL_INTERVAL_MS);
        } else {
          setPhase('failed');
          setError('Payment could not be confirmed.');
        }
      } catch (err) {
        if (!cancelled) {
          setPhase('failed');
          setError(err instanceof Error ? err.message : 'Payment could not be confirmed.');
        }
      }
    }

    void verify();
    return () => { cancelled = true; };
  }, [reference]);

  return (
    <div className="glass-card rounded-md p-4 md:p-5 max-w-lg mx-auto text-center">
      <p className="section-label mb-2">Utility Bills</p>
      <h1 className="font-display text-2xl md:text-3xl text-foreground mb-4">Card Payment</h1>

      {(phase === 'verifying' || phase === 'polling') && (
        <>
          <p className="text-foreground-muted mb-1">
            {phase === 'verifying' ? 'Confirming your payment with Paystack…' : 'Waiting for your bill to be fulfilled…'}
          </p>
          {statusLabel ? <p className="text-foreground-dim text-xs mb-0">{statusLabel.replace(/_/g, ' ')}</p> : null}
        </>
      )}

      {phase === 'successful' && (
        <>
          <p className="text-foreground-muted mb-4">Your payment was successful.</p>
          <div className="flex flex-wrap justify-center gap-2">
            {transactionId ? (
              <Link href={`/utility/receipt/${transactionId}`} className="btn-primary py-2.5 px-4 text-[11px]">
                View Receipt
              </Link>
            ) : null}
            <Link href="/utility" className="btn-outline py-2.5 px-4 text-[11px]">Back to Utility Bills</Link>
          </div>
        </>
      )}

      {phase === 'failed' && (
        <>
          <p className="text-foreground-muted mb-4">{error || 'Your payment could not be confirmed.'}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" className="btn-outline py-2.5 px-4 text-[11px]" onClick={() => router.push('/utility')}>
              Back to Utility Bills
            </button>
          </div>
        </>
      )}
    </div>
  );
}
