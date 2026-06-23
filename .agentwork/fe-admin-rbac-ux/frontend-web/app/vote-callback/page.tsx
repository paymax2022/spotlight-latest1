'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';

type Status = 'verifying' | 'success' | 'already_processed' | 'failed' | 'missing_params';

export default function VoteCallbackPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<Status>('verifying');
  const [detail, setDetail] = useState<{
    votesCredited?: number;
    receiptNumber?: string | null;
    error?: string;
  }>({});

  useEffect(() => {
    const reference = searchParams?.get('reference') || searchParams?.get('trxref');
    const transactionId = searchParams?.get('transactionId');

    if (!reference) {
      setStatus('missing_params');
      return;
    }

    (async () => {
      try {
        const res = await fetch('/api/votes/paid/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transactionId: transactionId ?? '',
            paymentReference: reference,
          }),
        });
        const json = await res.json();

        if (!res.ok || !json.success) {
          setStatus('failed');
          setDetail({ error: json.error ?? 'Verification failed' });
          return;
        }

        if (json.alreadyProcessed) {
          setStatus('already_processed');
          setDetail({ votesCredited: json.votesCredited, receiptNumber: json.receiptNumber });
        } else {
          setStatus('success');
          setDetail({ votesCredited: json.votesCredited, receiptNumber: json.receiptNumber });
        }
      } catch (e) {
        setStatus('failed');
        setDetail({ error: 'Network error. Your payment may still have processed — check your email for a receipt.' });
      }
    })();
  }, [searchParams]);

  return (
    <main className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="bg-gray-900 rounded-2xl p-8 max-w-md w-full text-center shadow-2xl">
        {status === 'verifying' && (
          <>
            <div className="w-14 h-14 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-5" />
            <h1 className="text-xl font-bold text-white">Verifying your payment…</h1>
            <p className="text-gray-400 text-sm mt-2">Please wait while we confirm your votes.</p>
          </>
        )}

        {(status === 'success' || status === 'already_processed') && (
          <>
            <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-5">
              <span className="text-4xl">✅</span>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">
              {status === 'already_processed' ? 'Already Processed' : 'Payment Successful!'}
            </h1>
            {detail.votesCredited != null && detail.votesCredited > 0 && (
              <p className="text-amber-400 text-lg font-semibold mb-1">
                {detail.votesCredited.toLocaleString()} votes have been added
              </p>
            )}
            {detail.receiptNumber && (
              <p className="text-gray-500 text-xs mt-2">Receipt: {detail.receiptNumber}</p>
            )}
            <p className="text-gray-400 text-sm mt-3 mb-6">
              Thank you for your support! Every vote counts.
            </p>
            <button
              onClick={() => router.back()}
              className="w-full bg-amber-500 hover:bg-amber-400 text-black font-bold py-3 rounded-xl transition-all"
            >
              Back to contestant profile
            </button>
          </>
        )}

        {status === 'failed' && (
          <>
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-5">
              <span className="text-4xl">❌</span>
            </div>
            <h1 className="text-xl font-bold text-white mb-2">Payment Not Confirmed</h1>
            <p className="text-gray-400 text-sm mb-1">{detail.error}</p>
            <p className="text-gray-500 text-xs mb-6">No votes were added. You have not been charged.</p>
            <div className="flex gap-3">
              <button
                onClick={() => router.back()}
                className="flex-1 border border-gray-700 text-gray-300 py-3 rounded-xl text-sm"
              >
                Go back
              </button>
              <Link
                href="/contact"
                className="flex-1 bg-amber-500 hover:bg-amber-400 text-black font-bold py-3 rounded-xl text-sm flex items-center justify-center"
              >
                Contact support
              </Link>
            </div>
          </>
        )}

        {status === 'missing_params' && (
          <>
            <div className="w-16 h-16 bg-yellow-500/10 rounded-full flex items-center justify-center mx-auto mb-5">
              <span className="text-4xl">⚠️</span>
            </div>
            <h1 className="text-xl font-bold text-white mb-2">Missing Payment Reference</h1>
            <p className="text-gray-400 text-sm mb-6">
              We could not find a payment reference in this URL. If you completed a payment,
              your votes may still be credited via webhook. Check your email for confirmation.
            </p>
            <Link href="/" className="text-amber-400 hover:text-amber-300 text-sm underline">
              Return to homepage
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
