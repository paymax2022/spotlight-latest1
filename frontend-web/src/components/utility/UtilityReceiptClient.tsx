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

function statusClass(status: string) {
  if (status === 'successful') return 'badge-approved';
  if (status === 'provider_pending' || status === 'wallet_debited' || status === 'initiated') return 'badge-pending';
  if (status === 'reversed' || status === 'failed') return 'badge-rejected';
  return 'badge-paid';
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
    return <div className="glass-card rounded-md p-4 max-w-lg mx-auto"><p className="text-foreground-muted mb-0">Loading receipt…</p></div>;
  }

  if (error || !receipt) {
    return (
      <div className="glass-card rounded-md p-4 max-w-lg mx-auto">
        <p className="text-foreground-muted mb-3">{error || 'Receipt not found.'}</p>
        <Link href="/utility" className="btn-outline py-2 px-3 text-[11px]">Back to Utility Bills</Link>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-md p-4 md:p-5 max-w-lg mx-auto print:shadow-none">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className="section-label mb-2">Utility Bills</p>
          <h1 className="font-display text-2xl md:text-3xl text-foreground">Payment Receipt</h1>
        </div>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-[11px] font-semibold ${statusClass(receipt.status)}`}>
          {receipt.status.replace(/_/g, ' ')}
        </span>
      </div>

      <dl className="space-y-3">
        <div className="flex justify-between gap-3 border-b border-border pb-2">
          <dt className="text-foreground-dim text-[11px] uppercase tracking-[0.12em]">Receipt Number</dt>
          <dd className="text-foreground font-semibold m-0">{receipt.receipt_number || receipt.transaction_id}</dd>
        </div>
        <div className="flex justify-between gap-3 border-b border-border pb-2">
          <dt className="text-foreground-dim text-[11px] uppercase tracking-[0.12em]">Category</dt>
          <dd className="text-foreground m-0 capitalize">{receipt.category.replace(/_/g, ' ')}</dd>
        </div>
        <div className="flex justify-between gap-3 border-b border-border pb-2">
          <dt className="text-foreground-dim text-[11px] uppercase tracking-[0.12em]">Customer Reference</dt>
          <dd className="text-foreground m-0">{receipt.customer_reference}</dd>
        </div>
        {receipt.customer_name ? (
          <div className="flex justify-between gap-3 border-b border-border pb-2">
            <dt className="text-foreground-dim text-[11px] uppercase tracking-[0.12em]">Customer Name</dt>
            <dd className="text-foreground m-0">{receipt.customer_name}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-3 border-b border-border pb-2">
          <dt className="text-foreground-dim text-[11px] uppercase tracking-[0.12em]">Amount</dt>
          <dd className="text-foreground m-0">{formatNaira(receipt.amount_kobo)}</dd>
        </div>
        <div className="flex justify-between gap-3 border-b border-border pb-2">
          <dt className="text-foreground-dim text-[11px] uppercase tracking-[0.12em]">Fee</dt>
          <dd className="text-foreground m-0">{formatNaira(receipt.convenience_fee_kobo)}</dd>
        </div>
        <div className="flex justify-between gap-3 border-b border-border pb-2">
          <dt className="text-foreground-dim text-[11px] uppercase tracking-[0.12em]">Total Paid</dt>
          <dd className="text-foreground font-bold text-lg m-0">{formatNaira(receipt.retail_amount_kobo)}</dd>
        </div>
        {receipt.token ? (
          <div className="flex justify-between gap-3 border-b border-border pb-2">
            <dt className="text-foreground-dim text-[11px] uppercase tracking-[0.12em]">Token</dt>
            <dd className="text-foreground font-mono font-semibold m-0">{receipt.token}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-3">
          <dt className="text-foreground-dim text-[11px] uppercase tracking-[0.12em]">Date</dt>
          <dd className="text-foreground m-0">{new Date(receipt.created_at).toLocaleString()}</dd>
        </div>
      </dl>

      <div className="mt-5 flex flex-wrap gap-2 print:hidden">
        <button type="button" className="btn-outline py-2 px-3 text-[11px]" onClick={() => window.print()}>Print</button>
        <Link href="/utility" className="btn-primary py-2 px-3 text-[11px]">Back to Utility Bills</Link>
      </div>
    </div>
  );
}
