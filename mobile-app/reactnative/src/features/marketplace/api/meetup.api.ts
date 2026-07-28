// ── Marketplace — Meetup safe-spots + reviews API (mock/live dispatch) ───────
//
// Connect model: no escrow orders. Safe-spots come from /meetup/safe-spots
// (mock-backed until it lands). Reviews are the OPTIONAL self-reported rating a
// user leaves after marking a deal complete in the Deal Room — posted against a
// dealId (the thread), not an order.
import { MKT_USE_MOCK, mktGet, mktPost } from './client';
import * as M from './meetup.mock';
import type { Review } from '../types';

export type { SafeSpot } from './meetup.mock';

// ── Meetup safe-spots — GET /meetup/safe-spots (being added elsewhere) ───────
export async function getSafeSpots(): Promise<M.SafeSpot[]> {
  if (MKT_USE_MOCK) return M.mockGetSafeSpots();
  try {
    return await mktGet<M.SafeSpot[]>('/meetup/safe-spots');
  } catch {
    // Endpoint not live yet — fall back to the offline suggestions.
    return M.mockGetSafeSpots();
  }
}

// ── Reviews — POST /deals/:id/review {rating, tags, text} ────────────────────
export async function submitReview(
  dealId: string,
  input: { rating: number; tags: string[]; text?: string },
): Promise<Review> {
  if (MKT_USE_MOCK) return M.mockSubmitReview(dealId, input.rating, input.tags, input.text);
  return mktPost<Review>(`/deals/${dealId}/review`, input);
}

export async function getReviewForDeal(dealId: string): Promise<Review | null> {
  if (MKT_USE_MOCK) return M.mockGetReviewForDeal(dealId);
  try {
    return await mktGet<Review>(`/deals/${dealId}/review`);
  } catch {
    return null;
  }
}
