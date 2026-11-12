'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch, isUnauthorized, redirectToLogin } from '@/src/lib/auth/flow';

type Receipt = {
  receipt_number: string | null;
  transaction_id: string;
  category: string;
  customer_reference: string;
  customer_name: string | null;
  amount_kobo: number;
  convenience_fee_kobo: number;
  retail_amount_kobo: number;
  status: string;
  token: string | null;
  created_at: string;
};

function formatNaira(kobo: number | null | undefined) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format((kobo ?? 0) / 100);
}

function statusTone(status: string) {
  if (status === 'successful') return 'success';
  if (status === 'provider_pending' || status === 'wallet_debited' || status === 'initiated') return 'pending';
  if (status === 'reversed' || status === 'failed') return 'failed';
  return 'neutral';
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function UtilityReceiptClient({ transactionId }: { transactionId: string }) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await authFetch(`/api/v1/utility/transactions/${transactionId}/receipt`, { cache: 'no-store' });
        if (isUnauthorized(response)) {
          redirectToLogin(`/utility/receipt/${transactionId}`);
          return;
        }
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.success === false) {
          throw new Error(String(payload?.error || 'Unable to load receipt.'));
        }
        if (!cancelled) setReceipt(payload.receipt as Receipt);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load receipt.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [transactionId]);

  if (loading) {
    return (
      <section className="u-wrap u-receipt-shell" id="receipt" aria-live="polite">
        <div className="u-receipt-message">
          <p className="u-eyebrow"><i /> PAYMENT RECEIPT</p>
          <p>Loading receipt…</p>
        </div>
      </section>
    );
  }

  if (error || !receipt) {
    return (
      <section className="u-wrap u-receipt-shell" id="receipt">
        <div className="u-receipt-message">
          <p className="u-eyebrow"><i /> PAYMENT RECEIPT</p>
          <h2>We couldn&apos;t find that receipt.</h2>
          <p>{error || 'This transaction may still be processing.'}</p>
          <Link className="u-cta u-full" href="/utility">
            Back to payment desk
            <svg aria-hidden="true"><use href="#u-arrow" /></svg>
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="u-wrap u-receipt-shell" id="receipt">
      <article className="u-receipt">
        <header className="u-receipt-head">
          <div>
            <p className="u-eyebrow"><i /> PAYMENT RECEIPT</p>
            <h2>{receipt.receipt_number || receipt.transaction_id}</h2>
            <p className="u-receipt-date">{formatDate(receipt.created_at)}</p>
          </div>
          <span className="u-status" data-tone={statusTone(receipt.status)}>
            {receipt.status.replace(/_/g, ' ')}
          </span>
        </header>

        <div className="u-receipt-grid">
          <dl className="u-receipt-rows">
            <div>
              <dt>Service</dt>
              <dd className="u-cap">{receipt.category.replace(/_/g, ' ')}</dd>
            </div>
            <div>
              <dt>Customer reference</dt>
              <dd>{receipt.customer_reference}</dd>
            </div>
            {receipt.customer_name ? (
              <div>
                <dt>Customer name</dt>
                <dd>{receipt.customer_name}</dd>
              </div>
            ) : null}
            <div>
              <dt>Transaction ID</dt>
              <dd className="u-mono">{receipt.transaction_id}</dd>
            </div>
            {receipt.token ? (
              <div>
                <dt>Token</dt>
                <dd className="u-mono">{receipt.token}</dd>
              </div>
            ) : null}
          </dl>

          <aside className="u-receipt-total" aria-label="Payment total">
            <p className="u-eyebrow"><i /> AMOUNT</p>
            <dl>
              <div>
                <dt>Bill amount</dt>
                <dd>{formatNaira(receipt.amount_kobo)}</dd>
              </div>
              <div>
                <dt>Convenience fee</dt>
                <dd>{formatNaira(receipt.convenience_fee_kobo)}</dd>
              </div>
              <div className="u-total">
                <dt>Total paid</dt>
                <dd>{formatNaira(receipt.retail_amount_kobo)}</dd>
              </div>
            </dl>
            <div className="u-receipt-actions">
              <button type="button" className="u-cta u-full" onClick={() => window.print()}>
                Print receipt
                <svg aria-hidden="true"><use href="#u-arrow" /></svg>
              </button>
              <Link className="u-cta u-ghost u-full" href="/utility">Back to payment desk</Link>
            </div>
          </aside>
        </div>
      </article>
    </section>
  );
}
