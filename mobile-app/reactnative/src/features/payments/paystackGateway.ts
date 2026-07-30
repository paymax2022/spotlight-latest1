// ── Paystack gateway (client-side Inline SDK) ────────────────────────────────
// A DIRECT Paystack charge for a purchase amount — NOT a wallet top-up. The
// caller pays the exact amount on the Paystack gateway and runs its own
// fulfilment (e.g. placeOrder) on the success callback.
//
//   web    → js.paystack.co/v2 inline `PaystackPop` (see usePaystackGateway.tsx)
//   native → the same inline JS inside a react-native-webview (…native.tsx)
//
// Both read the public key from EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY (the same
// pk_test_… used by the web app's NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY).
//
// NOTE: a client success callback is not proof of payment. Production must
// confirm server-side via the Paystack webhook before final fulfilment.

import type React from 'react';

export const PAYSTACK_PUBLIC_KEY = process.env.EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY ?? '';

export interface PaystackMetaField {
  display_name: string;
  variable_name: string;
  value: string;
}

export interface PaystackChargeArgs {
  /** Customer email — Paystack requires it to open a transaction. */
  email: string;
  /** Amount in kobo (integer minor units). */
  amountKobo: number;
  /**
   * What is being paid for, e.g. 'food_order' | 'vote_purchase'. Sent in
   * metadata.domain so the Paystack webhook can route/reconcile the charge.
   */
  domain: string;
  /** Optional idempotent reference; one is generated when omitted. */
  reference?: string;
  /**
   * When set, the SDK RESUMES a transaction already created server-side via the
   * Paystack Initialize API (`resumeTransaction(accessCode)`) instead of opening
   * a fresh client-initialized one (`newTransaction`). Use this for flows where
   * the server owns the transaction (wallet top-up, bills, registration): the
   * server keeps the Idempotency-Key + ledger authority and the client only
   * completes the checkout. Obtain it from the initialize response's
   * authorization_url via `extractAccessCode`.
   */
  accessCode?: string;
  metadataFields?: PaystackMetaField[];
  onSuccess: (reference: string) => void;
  onCancel?: () => void;
  onError?: (message: string) => void;
}

/**
 * Pull the Paystack access code out of an Initialize response's
 * `authorization_url`. Paystack returns `https://checkout.paystack.com/<code>`;
 * the access code is the last path segment. Returns null for empty, malformed,
 * or non-Paystack URLs so callers can fail safely.
 */
export function extractAccessCode(authorizationUrl: string): string | null {
  if (!authorizationUrl || typeof authorizationUrl !== 'string') return null;
  const noProto = authorizationUrl.replace(/^[a-z]+:\/\//i, '');
  const [pathPart] = noProto.split(/[?#]/);
  const segments = pathPart.split('/').filter(Boolean);
  if (segments.length < 2) return null; // need host + at least one path segment
  const host = segments[0].toLowerCase();
  if (!host.includes('paystack.')) return null; // only Paystack checkout URLs
  const code = segments[segments.length - 1].trim();
  return code.length > 0 ? code : null;
}

/**
 * Metadata sent with every gateway charge. `purpose: 'paymax_gateway'` is the
 * marker the server webhook (gateway-handler.ts) matches on to claim, verify and
 * record the charge; `domain` tells it which flow it belongs to.
 */
export function buildPaystackMetadata(args: PaystackChargeArgs): Record<string, unknown> {
  return {
    purpose: 'paymax_gateway',
    domain: args.domain,
    ...(args.metadataFields ? { custom_fields: args.metadataFields } : {}),
  };
}

export interface PaystackGatewayController {
  /** Open the Paystack gateway for a charge. */
  open: (args: PaystackChargeArgs) => void;
  /**
   * Render once near the pay button. On native this hosts the checkout WebView;
   * on web it renders nothing (the SDK opens its own popup).
   */
  Sheet: React.FC;
}
