// Connect model: no escrow orders. Safe-spots come from /meetup/safe-spots
// (mock-backed until it lands). Reviews are the OPTIONAL self-reported rating a
// user leaves after marking a deal complete in the Deal Room — posted against a
// dealId (the thread), not an order.
import { MKT_USE_MOCK, mktGet, mktPost } from './client';
import * as M from './meetup.mock';
import type { Review } from '../types';
import { normalizeSafeSpots, type SafeSpot } from '../meetupSpots';

export type { SafeSpot };

// The live endpoint's shape differs from the mock's ({ kind, lat, lng } vs { category,
// distanceKm }), so BOTH go through normalizeSafeSpots — the sheet never sees a field
// the server did not send. `near` (the user's position, when known) adds distances.
export async function getSafeSpots(near?: { lat: number; lng: number } | null): Promise<SafeSpot[]> {
  if (MKT_USE_MOCK) return normalizeSafeSpots(await M.mockGetSafeSpots(), near);
  try {
    return normalizeSafeSpots(await mktGet<unknown>('/meetup/safe-spots'), near);
  } catch {
    // Endpoint unavailable — fall back to the offline suggestions.
    return normalizeSafeSpots(await M.mockGetSafeSpots(), near);
  }
}

// The ADR-023 "mark met" signal: a thread participant marks the deal met (they
// transacted off-platform), unlocking review-writes. Idempotent on the backend
// (first mark wins). Mock mode is a no-op — mock threads are unlocked locally.
export async function markDealMet(dealId: string): Promise<void> {
  if (MKT_USE_MOCK) return;
  await mktPost<unknown>(`/deals/${dealId}/mark-met`);
}

// productQualityRating is the second sub-score — how the buyer rates the ITEM,
// separate from `rating` (the overall/counterparty score). Optional: a
// reviewer who skips it still submits a valid review with rating alone.
export async function submitReview(
  dealId: string,
  input: { rating: number; productQualityRating?: number; tags: string[]; text?: string },
): Promise<Review> {
  if (MKT_USE_MOCK) return M.mockSubmitReview(dealId, input.rating, input.productQualityRating, input.tags, input.text);
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
