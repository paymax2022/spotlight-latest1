// ── Movers — mock seed data + bidding engine ─────────────────────────────────
// All money is integer kobo. Bids arrive from providers; the client never sets
// the price — it displays bid amounts and the escrow fare from the SERVER.

import type {
  MoverJob,
  MoverBid,
  MoverQuoteRequest,
  TruckSize,
  Place,
} from '../types/modes.types';

const now = () => Date.now();
const iso = (msAgo = 0) => new Date(now() - msAgo).toISOString();

const DEFAULT_PICKUP: Place = { address: '14 Admiralty Way, Lekki Phase 1', lat: 6.4459, lng: 3.473 };
const DEFAULT_DROPOFF: Place = { address: '7 Glover Rd, Ikoyi', lat: 6.4521, lng: 3.4361 };

const SIZE_BASE: Record<TruckSize, number> = {
  pickup: 35_000_00,
  small_van: 55_000_00,
  box_truck: 95_000_00,
  large_truck: 160_000_00,
};

function mockBids(truckSize: TruckSize, helpers: number): MoverBid[] {
  const base = SIZE_BASE[truckSize] + helpers * 8_000_00;
  return [
    { id: 'bid_1', providerName: 'SwiftMove Logistics', providerRating: 4.8, reviews: 312, amountKobo: Math.round(base * 0.98), etaNote: 'Available your date · 4-man crew', currency: 'NGN', createdAt: iso(120_000) },
    { id: 'bid_2', providerName: 'Naija Movers Co.',    providerRating: 4.6, reviews: 188, amountKobo: Math.round(base * 1.05), etaNote: 'Padded truck · insured', currency: 'NGN', createdAt: iso(90_000) },
    { id: 'bid_3', providerName: 'CartonKing Relocations', providerRating: 4.9, reviews: 540, amountKobo: Math.round(base * 1.12), etaNote: 'Packing included · 6-man crew', currency: 'NGN', createdAt: iso(40_000) },
  ];
}

export function makeMoverJob(req: MoverQuoteRequest, overrides: Partial<MoverJob> = {}): MoverJob {
  return {
    id: `mov_${now()}`,
    phase: 'quote_requested',
    pickup: req.pickup,
    dropoff: req.dropoff,
    truckSize: req.truckSize,
    helpers: req.helpers,
    inventory: req.inventory,
    moveAt: req.moveAt,
    bids: [],
    acceptedBid: null,
    fareKobo: null,
    currency: 'NGN',
    paymentStatus: 'none',
    createdAt: iso(),
    completedAt: null,
    rated: false,
    ...overrides,
  };
}

export const moverStore: { active: MoverJob | null } = { active: null };

export const MOCK_MOVER_HISTORY: MoverJob[] = [
  {
    id: 'mov_h1', phase: 'completion_confirmed',
    pickup: DEFAULT_PICKUP, dropoff: DEFAULT_DROPOFF,
    truckSize: 'box_truck', helpers: 4, inventory: ['Bed & mattress', 'Sofa set', 'Fridge / freezer', 'Boxes / cartons'],
    moveAt: iso(86_400_000 * 12),
    bids: [], acceptedBid: { id: 'bid_x', providerName: 'SwiftMove Logistics', providerRating: 4.8, reviews: 312, amountKobo: 98_000_00, etaNote: '4-man crew', currency: 'NGN', createdAt: iso(86_400_000 * 13) },
    fareKobo: 98_000_00, currency: 'NGN', paymentStatus: 'settled',
    createdAt: iso(86_400_000 * 14), completedAt: iso(86_400_000 * 12 - 10_800_000), rated: true,
  },
];

/** Advances the active job: bids arrive ~6s after a quote request. */
export function advanceMockMover(j: MoverJob): MoverJob {
  if (['completion_confirmed', 'cancelled'].includes(j.phase)) return j;
  const ageMs = now() - new Date(j.createdAt).getTime();
  if (j.phase === 'quote_requested' && ageMs > 6_000) {
    j.bids = mockBids(j.truckSize, j.helpers);
    j.phase = 'bids_received';
  }
  // crew assigned shortly after a bid is accepted, then in-progress
  if (j.phase === 'bid_accepted' && j.acceptedBid) {
    const sinceAccept = now() - new Date(j.acceptedBid.createdAt).getTime();
    if (sinceAccept > 8_000) j.phase = 'crew_assigned';
  }
  if (j.phase === 'crew_assigned' && j.acceptedBid) {
    const sinceAccept = now() - new Date(j.acceptedBid.createdAt).getTime();
    if (sinceAccept > 16_000) j.phase = 'in_progress';
  }
  return j;
}
