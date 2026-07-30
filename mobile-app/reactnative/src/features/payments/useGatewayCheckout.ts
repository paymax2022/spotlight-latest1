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
// Gated by EXPO_PUBLIC_SDK_CHECKOUT: when off (or when an access code can't be
// derived), the hook does not open the SDK and instead invokes `onFallback`, so
// callers keep their existing `Linking.openURL(authorizationUrl)` behavior.

import { useCallback, useState } from 'react';

import { useAuthStore } from '@/store/authStore';
import { usePaystackGateway } from './usePaystackGateway';
import { extractAccessCode, type PaystackGatewayController } from './paystackGateway';

/** In-app SDK checkout is opt-in per environment (matches the *_USE_MOCK convention). */
export const SDK_CHECKOUT_ENABLED = process.env.EXPO_PUBLIC_SDK_CHECKOUT === 'true';

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
  /**
   * Called instead of opening the SDK when the flag is off or no access code can
   * be derived. Callers pass their legacy `Linking.openURL(authorizationUrl)`
   * here so behavior degrades safely.
   */
  onFallback?: (result: GatewayInitResult) => void;
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

      // Flag off, or no access code to resume → defer to the caller's legacy
      // hosted-checkout redirect rather than failing.
      if (!SDK_CHECKOUT_ENABLED || !accessCode) {
        setPhase('idle');
        req.onFallback?.(init);
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
