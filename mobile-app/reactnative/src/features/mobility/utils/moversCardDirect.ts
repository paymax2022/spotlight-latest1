// Pure helpers for the MOVERS card-direct rail (pay by debit card straight
// through Paystack — no wallet, no KYC-tier gate), charged at BID ACCEPTANCE.
// Backend contract: docs/adr/ADR-PRTBD-mobility-card-direct.md, movers domain
// (backend/internal/transport/paystackcheckout/movers.go). Shared status/copy
// helpers live in ./cardDirect.ts; this file only holds what is movers
// specific. No React / RN / network imports so it runs under
// `node --experimental-strip-types --test`.
//
// IRON RULE: the amount is NEVER built or sent from the client. The server reads
// the accepted bid itself, freezes it, and verifies the charge against it; the
// body below carries only (job_id, bid_id) — the bid's amount shown on screen is
// display only and is deliberately NOT sent.

import type { CardDirectStatus } from './cardDirect';

export const MOVERS_CARD_DIRECT_BASE = '/mobility/movers/paystack';

export interface MoversCardDirectInput {
  jobId: string;
  bidId: string;
  email?: string;
  callbackUrl?: string;
}

/**
 * snake_case body for POST /mobility/movers/paystack/initiate. Identifies the
 * job and the bid being accepted; carries NO amount. Gateway-only fields
 * (email, callback_url) are the only extras; the server strips them before
 * freezing the request.
 */
export function buildMoversCardDirectBody(req: MoversCardDirectInput): Record<string, unknown> {
  if (!req.jobId || !req.bidId) {
    throw new Error('A move and a bid are required to pay for a move.');
  }
  const body: Record<string, unknown> = { job_id: req.jobId, bid_id: req.bidId };
  if (req.email) body.email = req.email;
  if (req.callbackUrl) body.callback_url = req.callbackUrl;
  return body;
}

export function moversCardDirectStatusPath(reference: string): string {
  return `${MOVERS_CARD_DIRECT_BASE}/${encodeURIComponent(reference)}/status`;
}

/** Route the Paystack WebView hands off to once the SDK reports success. */
export function moversCardDirectResolverRoute(reference: string): string {
  return `/mobility/paystack/movers/${encodeURIComponent(reference)}`;
}

/** Route of the booked move once the charge is confirmed. */
export function moversConfirmedRoute(moveId: string): string {
  return `/mobility/movers/${moveId}`;
}

/** Server shape → client shape ("moveId" is the domain's entity id key). */
export function normalizeMoversStatus(raw: {
  reference: string;
  status: CardDirectStatus['status'];
  amountKobo?: number;
  moveId?: string;
}): CardDirectStatus & { moveId?: string } {
  return { reference: raw.reference, status: raw.status, amountKobo: raw.amountKobo, moveId: raw.moveId };
}
