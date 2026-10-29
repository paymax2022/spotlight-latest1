// Pure refund-eligibility helpers, mirroring backend/internal/top5events
// (splitRefund, refundWithinWindow and RequestRefund's guard). The customer's
// "you get back ₦X" preview must be the same arithmetic the organiser's decision
// produces — a screen that estimates it differently teaches the buyer to distrust
// the receipt. Server rules stay authoritative: this only decides what to offer.

import type { RefundState, TicketState } from './types';

const MAX_REFUND_REASON_LEN = 500;

export interface RefundSplit {
  refundKobo: number;
  feeKobo:    number;
}

// Integer-truncated fee, exactly like the Go `amount * feeBps / 10000` on int64
// kobo. Kobo amounts are integers here, so no rounding step is added.
export function splitRefund(amountKobo: number, feeBps: number): RefundSplit {
  const amount = Math.max(0, Math.trunc(amountKobo));
  const bps = Math.min(10_000, Math.max(0, Math.trunc(feeBps)));
  const fee = Math.floor((amount * bps) / 10_000);
  return { refundKobo: amount - fee, feeKobo: fee };
}

// A zero cutoff means "no time limit" (the server's own reading); a negative one
// is treated as closed rather than as an open window.
export function refundWindowClosed(startsAt: string, cutoffHours: number | undefined, now: number = Date.now()): boolean {
  if (!cutoffHours || cutoffHours <= 0) return false;
  const start = new Date(startsAt).getTime();
  if (Number.isNaN(start)) return false;
  return now > start - cutoffHours * 3_600_000;
}

export type RefundBlocker = 'used' | 'refunded' | 'unpaid' | 'cancelled' | 'window';

export interface RefundCandidate {
  state:          TicketState | string;
  price_paid_kobo: number;
  orderStatus?:   string;
  eventState?:    string;
  startsAt?:     string;
  cutoffHours?:  number;
}

// Why the Request refund button is hidden, in the order the server checks. `null`
// means the request would be accepted; the organiser still decides the outcome.
// A transferred ticket stays eligible: the server refunds the account that paid,
// not the one holding the pass, so hiding it here would deny a real right.
export function refundBlocker(t: RefundCandidate, now: number = Date.now()): RefundBlocker | null {
  if (t.price_paid_kobo <= 0) return 'unpaid';
  if (t.orderStatus && t.orderStatus !== 'PAID') return 'unpaid';
  if (t.state === 'REFUNDED') return 'refunded';
  if (t.state === 'USED') return 'used';
  if (t.state !== 'ISSUED' && t.state !== 'TRANSFERRED') return 'unpaid';
  // A cancelled event refunds on its own; asking again would queue a second debit.
  if (t.eventState === 'CANCELLED') return 'cancelled';
  if (refundWindowClosed(t.startsAt ?? '', t.cutoffHours, now)) return 'window';
  return null;
}

export const REFUND_BLOCKER_COPY: Record<RefundBlocker, string> = {
  used: 'This ticket was already scanned at the gate.',
  refunded: 'This ticket has already been refunded.',
  unpaid: 'This seat carries no money to return.',
  cancelled: 'The event was cancelled — refunds run automatically, you do not need to ask.',
  window: 'The refund window for this event has closed.',
};

// Live requests a customer is still waiting on. Terminal states (REFUNDED,
// REJECTED after a decision) are history, not something to re-open.
export function isRefundPending(status: RefundState | string): boolean {
  return status === 'REQUESTED' || status === 'APPROVED' || status === 'PROCESSING';
}

export function clampRefundReason(reason: string): string {
  return reason.trim().slice(0, MAX_REFUND_REASON_LEN);
}
