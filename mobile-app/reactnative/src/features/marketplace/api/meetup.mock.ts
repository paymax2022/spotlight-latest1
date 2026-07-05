// ── Marketplace — Meetup safe-spots + self-reported review mocks ─────────────
//
// The connect model has no escrow/orders, so meetup safe-spots and reviews no
// longer hang off an order FSM. Safe-spots back Meetup Mode; reviews are the
// OPTIONAL, self-reported rating a user can leave after marking a deal complete
// in the Deal Room. Neither depends on an order record any more.
import type { Review } from '../types';

const now = () => new Date().toISOString();
const delay = (ms = 220) => new Promise((r) => setTimeout(r, ms));

export const MOCK_ME = 'me';

// ── Meetup safe-spots (a sibling agent may add /meetup/safe-spots; mock here) ──
export interface SafeSpot {
  id: string;
  name: string;
  category: 'police' | 'bank' | 'mall' | 'public';
  address: string;
  distanceKm: number;
  verified: boolean;
}

const SAFE_SPOTS: SafeSpot[] = [
  { id: 'ss1', name: 'Area F Police Station forecourt', category: 'police', address: 'Ikeja, Lagos', distanceKm: 1.2, verified: true },
  { id: 'ss2', name: 'GTBank Allen Avenue branch', category: 'bank', address: 'Allen Ave, Ikeja', distanceKm: 2.1, verified: true },
  { id: 'ss3', name: 'Ikeja City Mall — main entrance', category: 'mall', address: 'Obafemi Awolowo Way', distanceKm: 3.4, verified: true },
  { id: 'ss4', name: 'Computer Village info desk (well-lit)', category: 'public', address: 'Otigba St, Ikeja', distanceKm: 0.8, verified: false },
];

export async function mockGetSafeSpots(): Promise<SafeSpot[]> {
  await delay(200);
  return SAFE_SPOTS;
}

// ── Reviews — self-reported after a deal is marked complete ──────────────────
// Keyed by dealId (the Deal Room thread id) instead of an order id: reviews are
// no longer structurally gated behind a released escrow order.
const reviews: Review[] = [];

export async function mockSubmitReview(
  dealId: string,
  rating: number,
  tags: string[],
  text?: string,
): Promise<Review> {
  await delay(320);
  const review: Review = {
    id: `rev_${Date.now()}`,
    dealId,
    reviewerId: MOCK_ME,
    reviewerName: 'You',
    rating,
    comment: text ?? null,
    tags,
    sellerReply: null,
    isPlaceholder: false,
    createdAt: now(),
  };
  reviews.push(review);
  return review;
}

export async function mockGetReviewForDeal(dealId: string): Promise<Review | null> {
  await delay(120);
  return reviews.find((r) => r.dealId === dealId) ?? null;
}
