// Pure helpers for the CAR HIRE card-direct rail (pay by debit card straight
// through Paystack — no wallet, no KYC-tier gate). Backend contract:
// docs/adr/ADR-PR522-mobility-card-direct.md ("Partial refunds (car hire)"),
// backend/internal/transport/paystackcheckout/carhire.go. Shared status/copy
// helpers live in ./cardDirect.ts; this file only holds what is car-hire
// specific. No React / RN / network imports so it runs under
// `node --experimental-strip-types --test`.
//
// IRON RULES
//  1. The amount is NEVER built or sent from the client. ONE charge = fare +
//     deposit, quoted/frozen/verified by the server; the body has no money field.
//  2. NEVER claim money is back before the backend says so. A card refund is
//     "sent" (the gateway accepted it) — the bank may then take days; until then
//     it is "on its way". Card refunds are NEVER described as wallet money.
//  3. A card-funded hire cannot be extended (the server refuses it, 409
//     EXTENSION_NOT_AVAILABLE_FOR_CARD) — the UI must not offer it.

import type { CardDirectStatus } from './cardDirect';

export const CARHIRE_CARD_DIRECT_BASE = '/mobility/car-hire/paystack';

export const CARHIRE_MAX_HOURS = 720;

export type CarHireRail = 'card' | 'wallet';
export type CarHireDepositStatus = 'none' | 'held' | 'returning' | 'returned';
export type CarHireRefundStatus = 'none' | 'pending' | 'refunded' | 'failed';

const HIRE_TYPES = new Set(['hourly', 'daily', 'airport', 'event', 'executive']);

export interface CarHireCardDirectInput {
  hireType: 'hourly' | 'daily' | 'airport' | 'event' | 'executive';
  vehicleClass: string;
  startAt: string; // ISO datetime
  durationHours: number;
  chauffeur: boolean;
  pickupAddress?: string;
  specialRequest?: string;
  email?: string;
  callbackUrl?: string;
}

/**
 * snake_case body for POST /mobility/car-hire/paystack/initiate. Mirrors the
 * wallet booking body minus `payment_method`, and with NO amount (the server
 * prices fare + deposit). The Idempotency-Key is a HEADER, never a body field.
 * Gateway-only fields (email, callback_url) are the only extras; the server
 * strips them before freezing the request.
 */
export function buildCarHireCardDirectBody(req: CarHireCardDirectInput): Record<string, unknown> {
  if (!HIRE_TYPES.has(req.hireType)) throw new Error('Choose a valid hire type.');
  if (!Number.isInteger(req.durationHours) || req.durationHours < 1 || req.durationHours > CARHIRE_MAX_HOURS) {
    throw new Error(`Hire duration must be a whole number of hours between 1 and ${CARHIRE_MAX_HOURS}.`);
  }
  if (Number.isNaN(Date.parse(req.startAt))) throw new Error('Choose a valid start date.');
  const body: Record<string, unknown> = {
    hire_type: req.hireType,
    vehicle_class: req.vehicleClass,
    start_at: req.startAt,
    duration_hours: req.durationHours,
    chauffeur: req.chauffeur,
  };
  if (req.pickupAddress) body.pickup_address = req.pickupAddress;
  if (req.specialRequest) body.special_request = req.specialRequest;
  if (req.email) body.email = req.email;
  if (req.callbackUrl) body.callback_url = req.callbackUrl;
  return body;
}

export function carHireCardDirectStatusPath(reference: string): string {
  return `${CARHIRE_CARD_DIRECT_BASE}/${encodeURIComponent(reference)}/status`;
}

/** Route the Paystack WebView hands off to once the SDK reports success. */
export function carHireCardDirectResolverRoute(reference: string): string {
  return `/mobility/paystack/carhire/${encodeURIComponent(reference)}`;
}

/** Server shape → client shape ("bookingId" is the domain's entity id key). */
export function normalizeCarHireStatus(raw: {
  reference: string;
  status: CardDirectStatus['status'];
  amountKobo?: number;
  bookingId?: string;
}): CardDirectStatus & { bookingId?: string } {
  return { reference: raw.reference, status: raw.status, amountKobo: raw.amountKobo, bookingId: raw.bookingId };
}

// ── booking model ───────────────────────────────────────────────────────────

interface BookingFields {
  phase?: string;
  status?: string;
  fundingRail?: string;
  depositStatus?: string;
  refundStatus?: string;
  chauffeurKobo?: number;
}

/**
 * The backend detail uses `status` (+ fundingRail / depositStatus /
 * refundStatus); the screens use `phase`. Bookings that already carry `phase`
 * (the mock store) pass through untouched; missing display-only fields get safe
 * defaults. Money fields are never invented.
 */
export function normalizeCarHireBooking<T extends object>(rawIn: T): T & {
  phase: string;
  chauffeurKobo: number;
  currency: 'NGN';
  fundingRail: CarHireRail;
  depositStatus: CarHireDepositStatus;
  refundStatus: CarHireRefundStatus;
} {
  const raw = rawIn as T & BookingFields;
  const rail: CarHireRail = raw.fundingRail === 'card' ? 'card' : 'wallet';
  return {
    ...raw,
    phase: (raw.phase ?? raw.status ?? 'requested') as string,
    chauffeurKobo: typeof raw.chauffeurKobo === 'number' ? raw.chauffeurKobo : 0,
    currency: 'NGN',
    fundingRail: rail,
    depositStatus: (raw.depositStatus as CarHireDepositStatus) ?? 'none',
    refundStatus: (raw.refundStatus as CarHireRefundStatus) ?? 'none',
  };
}

export function canExtendCarHire(b: { phase?: string; fundingRail?: string }): boolean {
  if (b.fundingRail === 'card') return false;
  return b.phase === 'confirmed' || b.phase === 'active' || b.phase === 'extended';
}

/** Ending (completing) a CARD hire needs it to have started; the wallet rail keeps allowing it from confirmed. */
export function canEndCarHire(b: { phase?: string; fundingRail?: string }): boolean {
  if (b.fundingRail === 'card') return b.phase === 'active' || b.phase === 'extended';
  return b.phase === 'confirmed' || b.phase === 'active' || b.phase === 'extended';
}

/** Cancel is a pre-activation action (a started card hire is completed, not cancelled). */
export function canCancelCarHire(b: { phase?: string }): boolean {
  return b.phase === 'confirmed';
}

const naira = (kobo: number): string => `₦${Math.round(kobo / 100).toLocaleString('en-NG')}`;

/**
 * The one-line truth about the deposit. 'returned' means the refund was ACCEPTED
 * and sent (card: by the payment provider) — never that it has landed.
 */
export function carHireDepositCopy(b: {
  fundingRail?: string;
  phase?: string;
  depositStatus?: string;
  depositKobo: number;
}): string {
  const card = b.fundingRail === 'card';
  const amt = naira(b.depositKobo);
  switch (b.depositStatus) {
    case 'returned':
      return card
        ? `Your ${amt} deposit has been sent back to your card. Your bank can take a few days to show it.`
        : `Your ${amt} deposit was returned to your wallet.`;
    case 'returning':
      return card
        ? `Your ${amt} deposit is on its way back to your card. We'll update this as soon as the refund is sent.`
        : `Your ${amt} deposit is being returned to your wallet.`;
    case 'none':
      return '';
    case 'held':
    default:
      return card
        ? `${amt} deposit held — returned to the same card when the hire is completed (it can take a few days to show).`
        : `${amt} deposit held in escrow — refunded on completion.`;
  }
}

/** Honest copy for a CANCELLED booking's refund. Empty when there is nothing to say. */
export function carHireRefundCopy(refundStatus: string | undefined, rail: string | undefined): string {
  const card = rail === 'card';
  switch (refundStatus) {
    case 'refunded':
      return card
        ? 'Your refund has been sent to your card. Your bank can take a few days to show it.'
        : 'Your refund was returned to your wallet.';
    case 'pending':
      return card
        ? 'Your refund is being processed. It is on its way to your card and we will keep retrying until it is sent.'
        : 'Your refund is being processed.';
    case 'failed':
      return 'We could not complete your refund automatically. Our team has been alerted — please contact support.';
    default:
      return '';
  }
}
