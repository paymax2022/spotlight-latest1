// Pure helpers for the Mobility CARD-DIRECT rail (pay by debit card straight
// through Paystack — no wallet, no KYC-tier gate). Backend contract:
// docs/adr/ADR-PRTBD-mobility-card-direct.md. No React / RN / network imports
// here on purpose so it runs under `node --experimental-strip-types --test`.
//
// IRON RULE: the amount is NEVER built or sent from the client. The server
// quotes it, freezes it, and verifies the charge against it; the request body
// below deliberately has no amount field.

/** Server intent statuses (transport_paystack_intents.status). */
export type CardDirectStatusValue =
  | 'pending'
  | 'processing'
  | 'confirmed'
  | 'amount_mismatch'
  | 'order_failed'
  | 'refunding'
  | 'refunded';

export const CARD_DIRECT_TERMINAL: ReadonlySet<string> = new Set([
  'confirmed',
  'amount_mismatch',
  'order_failed',
  'refunded',
]);

export function isCardDirectTerminal(status: string | undefined): boolean {
  return !!status && CARD_DIRECT_TERMINAL.has(status);
}

/**
 * `refunding` = the server has started a gateway refund and is verifying the
 * outcome. It is deliberately NOT terminal (keep polling until `refunded`) and
 * NOT a plain failure (we must not claim the money is back yet).
 */
export function isCardDirectRefunding(status: string | undefined): boolean {
  return status === 'refunding';
}

export function isCardDirectFailure(status: string | undefined): boolean {
  return status === 'amount_mismatch' || status === 'order_failed' || status === 'refunded';
}

/**
 * Honest copy per failure status. `noun` is the thing being booked
 * ("parcel delivery", "ride"). 'refunded' is the only status that claims the
 * money is back — the others say it is being reversed, because the server only
 * marks `refunded` once the gateway actually accepted the refund.
 */
export function cardDirectFailureMessage(status: string | undefined, noun: string): string | undefined {
  switch (status) {
    case 'refunded':
      return `This payment couldn't be turned into a ${noun} booking, and has been refunded to your card/account. No money was kept.`;
    case 'refunding':
      return `This payment couldn't be turned into a ${noun} booking. Your refund is being processed - we're confirming it with the payment provider. This usually takes a moment.`;
    case 'amount_mismatch':
    case 'order_failed':
      return `This payment could not be turned into a ${noun} (the price may have changed). Any charge is being reversed and will not be kept.`;
    default:
      return undefined;
  }
}

/** Idempotency keys must satisfy the server's `^[A-Za-z0-9._=-]{8,100}$`. */
export const CARD_DIRECT_KEY_RE = /^[A-Za-z0-9._=-]{8,100}$/;

export interface CardDirectIntent {
  reference: string;
  authorizationUrl: string;
  accessCode?: string;
  amountKobo: number;
  /** pending for a fresh/unpaid replay; a terminal status when the key was already processed. */
  status?: CardDirectStatusValue;
}

export interface CardDirectStatus {
  reference: string;
  status: CardDirectStatusValue;
  amountKobo?: number;
}

export interface ParcelCardDirectInput {
  pickup: unknown;
  dropoff: unknown;
  category?: string;
  size?: string;
  speed?: string;
  declaredValueKobo?: number;
  receiverName: string;
  receiverPhone: string;
  prohibitedAck: boolean;
  email?: string;
  callbackUrl?: string;
}

/**
 * snake_case body for POST /mobility/parcels/paystack/initiate. Mirrors the
 * wallet booking body minus `payment_method`/`photo_url` and with NO amount.
 * Gateway-only fields (email, callback_url) are the only extras; the server
 * strips them before freezing the request.
 */
export function buildParcelCardDirectBody(req: ParcelCardDirectInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    pickup: req.pickup,
    dropoff: req.dropoff,
    category: req.category,
    size: req.size,
    speed: req.speed,
    declared_value_kobo: req.declaredValueKobo ?? 0,
    receiver_name: req.receiverName,
    receiver_phone: req.receiverPhone,
    prohibited_ack: req.prohibitedAck,
  };
  if (req.email) body.email = req.email;
  if (req.callbackUrl) body.callback_url = req.callbackUrl;
  return body;
}

export const PARCEL_CARD_DIRECT_BASE = '/mobility/parcels/paystack';

export function parcelCardDirectStatusPath(reference: string): string {
  return `${PARCEL_CARD_DIRECT_BASE}/${encodeURIComponent(reference)}/status`;
}

/** Route the Paystack WebView hands off to once the SDK reports success. */
export function parcelCardDirectResolverRoute(reference: string): string {
  return `/mobility/paystack/parcel/${encodeURIComponent(reference)}`;
}

/** Server shape → client shape ("parcelId" is the domain's entity id key). */
export function normalizeParcelStatus(raw: {
  reference: string;
  status: CardDirectStatusValue;
  amountKobo?: number;
  parcelId?: string;
}): CardDirectStatus & { parcelId?: string } {
  return { reference: raw.reference, status: raw.status, amountKobo: raw.amountKobo, parcelId: raw.parcelId };
}
