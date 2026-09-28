// ── Server-initialized gateway checkout ─────────────────────────────────────
// For flows where the SERVER owns the transaction (wallet top-up, bills,
// registration): the caller's `initialize()` hits the server (which sets the
// Idempotency-Key and keeps ledger authority) and returns a Paystack
// `authorization_url`. This hook derives the access code from that URL and
// RESUMES the transaction inside the in-app Paystack SDK — no external browser —
// then calls `onResolved` so the caller can navigate to the transaction status
// screen. It is deliberately distinct from `usePurchasePayment`, which is a
// wallet/card chooser that CLIENT-initializes its own charge.
//
// The in-app SDK is the ONLY checkout path — there is no external-browser
// fallback. If a valid access code can't be derived from the server's
// authorization_url (which should never happen for a well-formed Paystack
// response), this surfaces as a hard error rather than silently degrading to
// Linking.openURL: a broken access code is a real bug worth seeing, not
// something to paper over by handing the user to a browser tab.

import { useCallback, useState } from 'react';

import { useAuthStore } from '@/store/authStore';
import { usePaystackGateway } from './usePaystackGateway';
import { extractAccessCode, type PaystackGatewayController } from './paystackGateway';

export type GatewayPhase = 'idle' | 'initializing' | 'awaiting' | 'done' | 'error';

export interface GatewayInitResult {
  /** Paystack hosted-checkout URL; its last path segment is the access code. */
  authorizationUrl: string;
  reference: string;
  /** Present for flows whose status screen keys off a transaction id (e.g. bills). */
  transactionId?: string;
}

export interface GatewayCheckoutRequest {
  /** Server initialize (already sets Idempotency-Key). */
  initialize: () => Promise<GatewayInitResult>;
  /** Navigate to the transaction status screen after the SDK checkout succeeds. */
  onResolved: (result: GatewayInitResult) => void;
  /** What is being paid for (Paystack metadata / diagnostics), e.g. 'wallet_topup'. */
  domain: string;
  /** Customer email; falls back to the signed-in user. */
  email?: string;
}

export interface GatewayCheckoutController {
  phase: GatewayPhase;
  error: string | null;
  /** Kick off: initialize server-side, then resume the transaction in the SDK. */
  start: (req: GatewayCheckoutRequest) => Promise<void>;
  /** Render once near the pay button — hosts the checkout WebView on native. */
  Sheet: PaystackGatewayController['Sheet'];
}

export function useGatewayCheckout(): GatewayCheckoutController {
  const [phase, setPhase] = useState<GatewayPhase>('idle');
  const [error, setError] = useState<string | null>(null);

  const gateway = usePaystackGateway();
  const user = useAuthStore((s) => s.user);

  const start = useCallback(
    async (req: GatewayCheckoutRequest) => {
      setError(null);
      setPhase('initializing');

      let init: GatewayInitResult;
      try {
        init = await req.initialize();
      } catch (e) {
        setPhase('error');
        setError(e instanceof Error ? e.message : 'Could not start payment. Please try again.');
        return;
      }

      const accessCode = extractAccessCode(init.authorizationUrl);

      // No external-browser fallback: a malformed authorization_url is a
      // server-side bug, not something to paper over by handing the user to
      // a browser tab.
      if (!accessCode) {
        setPhase('error');
        setError('Could not start the secure payment. Please try again.');
        return;
      }

      setPhase('awaiting');
      gateway.open({
        email: req.email ?? user?.email ?? 'customer@paymax.app',
        // Amount is fixed by the server-initialized transaction; resume ignores it.
        amountKobo: 0,
        domain: req.domain,
        accessCode,
        onSuccess: () => {
          setPhase('done');
          req.onResolved(init);
        },
        onCancel: () => {
          setPhase('idle');
        },
        onError: (message) => {
          setPhase('error');
          setError(message);
        },
      });
    },
    [gateway, user],
  );

  return { phase, error, start, Sheet: gateway.Sheet };
}
