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
  metadataFields?: PaystackMetaField[];
  onSuccess: (reference: string) => void;
  onCancel?: () => void;
  onError?: (message: string) => void;
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
