// Web implementation of the Paystack gateway — loads the Paystack v2 Inline SDK
// (`PaystackPop`) and opens a popup for the exact amount. Metro also uses this
// file as the default; the native override lives in usePaystackGateway.native.tsx.

import { useCallback } from 'react';
import {
  PAYSTACK_PUBLIC_KEY,
  buildPaystackMetadata,
  type PaystackChargeArgs,
  type PaystackGatewayController,
} from './paystackGateway';

interface PaystackPopInstance {
  newTransaction(config: Record<string, unknown>): void;
}
type PaystackPopCtor = new () => PaystackPopInstance;

let scriptPromise: Promise<PaystackPopCtor> | null = null;

function loadPaystack(): Promise<PaystackPopCtor> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Paystack can only run in a browser'));
  }
  const w = window as unknown as { PaystackPop?: PaystackPopCtor };
  if (w.PaystackPop) return Promise.resolve(w.PaystackPop);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<PaystackPopCtor>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://js.paystack.co/v2/inline.js';
    script.async = true;
    script.onload = () =>
      w.PaystackPop ? resolve(w.PaystackPop) : reject(new Error('Paystack SDK unavailable'));
    script.onerror = () => reject(new Error('Failed to load the Paystack SDK'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

const NoSheet = () => null;

export function usePaystackGateway(): PaystackGatewayController {
  const open = useCallback((args: PaystackChargeArgs) => {
    if (!PAYSTACK_PUBLIC_KEY) {
      args.onError?.('Paystack key missing — set EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY.');
      return;
    }
    loadPaystack()
      .then((PaystackPop) => {
        const popup = new PaystackPop();
        popup.newTransaction({
          key: PAYSTACK_PUBLIC_KEY,
          email: args.email,
          amount: args.amountKobo, // kobo
          currency: 'NGN',
          ...(args.reference ? { reference: args.reference } : {}),
          metadata: buildPaystackMetadata(args),
          onSuccess: (t: { reference: string }) => args.onSuccess(t.reference),
          onCancel: () => args.onCancel?.(),
          onError: (e: { message: string }) => args.onError?.(e?.message ?? 'Payment error'),
        });
      })
      .catch((e: unknown) =>
        args.onError?.(e instanceof Error ? e.message : 'Paystack failed to load'),
      );
  }, []);

  return { open, Sheet: NoSheet };
}
