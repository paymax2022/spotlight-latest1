// ── Social P2P Escrow marketplace (Phase 3) ──────────────────────────────────
// NEW file added alongside the Phase-1 social lib (do NOT edit P1 files). Reuses
// the P1 social.constants helpers (formatNaira, API_BASE, USE_MOCK, idempotency).
// Escrow holds buyer funds until release/refund (NL-6). State machine:
//   HELD → RELEASED | REFUNDED | DISPUTED → (RELEASED | REFUNDED)

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { USE_MOCK, formatNaira } from './constants/social.constants';

export { formatNaira };

// P2P escrow marketplace lives on a DIFFERENT backend module than Social Pay
// (P1). Confirmed against backend/internal/app/top5_p3_routes.go
// (RegisterP2PMarket mounts finance.Group("/p2p")) + p2pmarket/handler.go
// Register, which re-adds "/p2p/..." itself → the full path is
// /api/finance/p2p/p2p/... "Listings"/"escrow" here map onto p2pmarket's
// listings/orders vocabulary (checkout/confirm/dispute), not a generic
// "/escrow/*" namespace.
const P2P_BASE = '/api/finance/p2p/p2p';

const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));
function escrowIdempotencyKey(): string {
  return `esc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

// ── NL-6 — escrow holds funds; never released without buyer confirmation. ─────
export const ESCROW_DISCLOSURE =
  'Paymax holds your payment in escrow. Funds are only released to the seller ' +
  'once you confirm you received the item. If something goes wrong, raise a ' +
  'dispute and Paymax will review it — your money stays protected meanwhile.';

// ── Types ──────────────────────────────────────────────────────────────────────
export type ListingStatus = 'active' | 'sold' | 'paused';
export type ListingCondition = 'new' | 'used' | 'refurbished';

export interface Listing {
  id:           string;
  title:        string;
  description:  string;
  priceKobo:    number;
  condition:    ListingCondition;
  category:     string;
  location:     string;
  status:       ListingStatus;
  thumbColor:   string;
  sellerHandle: string;
  sellerName:   string;
  sellerRating: number;        // 0–5
  sellerSales:  number;
  createdAtISO: string;
}

export interface CreateListingInput {
  title:       string;
  description: string;
  priceKobo:   number;
  condition:   ListingCondition;
  category:    string;
  location:    string;
}

export type EscrowStatus = 'HELD' | 'RELEASED' | 'REFUNDED' | 'DISPUTED';

export interface EscrowTrade {
  id:            string;
  listingId:     string;
  listingTitle:  string;
  amountKobo:    number;
  status:        EscrowStatus;
  role:          'buyer' | 'seller';
  counterparty:  string;       // handle
  thumbColor:    string;
  createdAtISO:  string;
  /** Populated when status === DISPUTED. */
  disputeReason?: string;
  disputeStatus?: 'open' | 'resolved_release' | 'resolved_refund';
}

export interface CheckoutInput {
  listingId:  string;
  amountKobo: number;
}

export interface DisputeInput {
  tradeId: string;
  reason:  string;
}

// ── Mock fixtures ─────────────────────────────────────────────────────────────
const MOCK_LISTINGS: Listing[] = [
  { id: 'l_iphone', title: 'iPhone 13 Pro — 256GB', description: 'Clean, no scratches. Battery 89%. Comes with box + charger.', priceKobo: 38_000_000, condition: 'used', category: 'Phones', location: 'Lagos', status: 'active', thumbColor: '#0051D5', sellerHandle: '@bisi', sellerName: 'Bisi Adeyemi', sellerRating: 4.8, sellerSales: 32, createdAtISO: daysAgo(2) },
  { id: 'l_ps5',    title: 'PlayStation 5 (Disc)',  description: 'Boxed, 2 controllers, 3 games included.',                   priceKobo: 55_000_000, condition: 'used', category: 'Gaming', location: 'Abuja', status: 'active', thumbColor: '#9333EA', sellerHandle: '@zeddgames', sellerName: 'Zedd', sellerRating: 4.6, sellerSales: 11, createdAtISO: daysAgo(5) },
  { id: 'l_desk',   title: 'Standing desk — electric', description: 'Adjustable height, like new. Pickup or delivery.',       priceKobo: 12_000_000, condition: 'refurbished', category: 'Home', location: 'Lagos', status: 'active', thumbColor: '#48B8AC', sellerHandle: '@ada', sellerName: 'Ada Eze', sellerRating: 5.0, sellerSales: 7, createdAtISO: daysAgo(1) },
  { id: 'l_sneaker',title: 'Air Jordan 1 — UK 9',  description: 'Brand new, deadstock. Receipt available.',                  priceKobo: 18_500_000, condition: 'new',  category: 'Fashion', location: 'Port Harcourt', status: 'sold', thumbColor: '#DC2626', sellerHandle: '@femi', sellerName: 'Femi Bakare', sellerRating: 4.9, sellerSales: 54, createdAtISO: daysAgo(8) },
];

const MOCK_TRADES: EscrowTrade[] = [
  { id: 't_held',   listingId: 'l_iphone', listingTitle: 'iPhone 13 Pro — 256GB', amountKobo: 38_000_000, status: 'HELD',     role: 'buyer',  counterparty: '@bisi',     thumbColor: '#0051D5', createdAtISO: minsAgo(120) },
  { id: 't_disp',   listingId: 'l_ps5',    listingTitle: 'PlayStation 5 (Disc)',  amountKobo: 55_000_000, status: 'DISPUTED', role: 'buyer',  counterparty: '@zeddgames', thumbColor: '#9333EA', createdAtISO: daysAgo(3), disputeReason: 'Item arrived with a faulty controller.', disputeStatus: 'open' },
  { id: 't_rel',    listingId: 'l_desk',   listingTitle: 'Standing desk — electric', amountKobo: 12_000_000, status: 'RELEASED', role: 'seller', counterparty: '@kemi',     thumbColor: '#48B8AC', createdAtISO: daysAgo(6) },
  { id: 't_ref',    listingId: 'l_sneaker',listingTitle: 'Air Jordan 1 — UK 9',   amountKobo: 18_500_000, status: 'REFUNDED', role: 'buyer',  counterparty: '@femi',     thumbColor: '#DC2626', createdAtISO: daysAgo(10), disputeReason: 'Wrong size shipped.', disputeStatus: 'resolved_refund' },
];

// ── API ─────────────────────────────────────────────────────────────────────
// Backend: GET /p2p/listings → { success, listings }.
export async function listListings(query?: string): Promise<Listing[]> {
  if (USE_MOCK) {
    await delay();
    const q = (query ?? '').trim().toLowerCase();
    if (!q) return MOCK_LISTINGS;
    return MOCK_LISTINGS.filter((l) => l.title.toLowerCase().includes(q) || l.category.toLowerCase().includes(q));
  }
  const res = await api.get(`${P2P_BASE}/listings`, { params: query ? { q: query } : undefined });
  const listings = (res.data as { listings?: Record<string, unknown>[] })?.listings ?? [];
  return listings.map(mapListing);
}

function mapListing(l: Record<string, unknown>): Listing {
  return {
    id: String(l.id ?? ''),
    title: String(l.title ?? ''),
    description: String(l.description ?? ''),
    priceKobo: Number(l.price_kobo ?? 0),
    condition: (String(l.condition ?? 'used') as ListingCondition),
    category: String(l.category ?? ''),
    location: String(l.location ?? ''),
    status: (String(l.status ?? 'active').toLowerCase() as ListingStatus),
    thumbColor: '#340075',
    sellerHandle: String(l.seller_handle ?? ''),
    sellerName: String(l.seller_name ?? ''),
    sellerRating: Number(l.seller_rating ?? 0),
    sellerSales: Number(l.seller_sales ?? 0),
    createdAtISO: String(l.created_at ?? new Date().toISOString()),
  };
}

// Backend: GET /p2p/listings/:listingId → { success, listing }.
export async function getListing(id: string): Promise<Listing> {
  if (USE_MOCK) {
    await delay();
    const l = MOCK_LISTINGS.find((x) => x.id === id);
    if (!l) throw new Error('Listing not found');
    return l;
  }
  const res = await api.get(`${P2P_BASE}/listings/${id}`);
  return mapListing((res.data as { listing?: Record<string, unknown> })?.listing ?? {});
}

// MISSING BACKEND ENDPOINT: no single-order GET exists (only actions:
// confirm/dispute/rate). Falls back to the mock trade until a GET
// /p2p/orders/:orderId read is added.
export async function getTrade(id: string): Promise<EscrowTrade> {
  if (USE_MOCK) {
    await delay();
    const t = MOCK_TRADES.find((x) => x.id === id);
    if (!t) throw new Error('Trade not found');
    return t;
  }
  const t = MOCK_TRADES.find((x) => x.id === id);
  if (!t) throw new Error('Trade not found');
  return t;
}

// MISSING BACKEND ENDPOINT: no "list my orders/trades" endpoint exists.
export async function listTrades(): Promise<EscrowTrade[]> {
  await delay();
  return MOCK_TRADES;
}

// Backend: POST /p2p/listings expects { title, description, price_kobo,
// condition, category, location } (Idempotency-Key) → { success, listing }.
export async function createListing(input: CreateListingInput): Promise<Listing> {
  if (USE_MOCK) {
    await delay();
    return {
      id: `l_${Date.now()}`, title: input.title, description: input.description, priceKobo: input.priceKobo,
      condition: input.condition, category: input.category, location: input.location, status: 'active',
      thumbColor: '#340075', sellerHandle: '@you', sellerName: 'You', sellerRating: 5, sellerSales: 0,
      createdAtISO: new Date().toISOString(),
    };
  }
  const res = await api.post(
    `${P2P_BASE}/listings`,
    {
      title: input.title,
      description: input.description,
      price_kobo: input.priceKobo,
      condition: input.condition,
      category: input.category,
      location: input.location,
    },
    { headers: { 'Idempotency-Key': escrowIdempotencyKey() } },
  );
  return mapListing((res.data as { listing?: Record<string, unknown> })?.listing ?? {});
}

// Backend: POST /p2p/listings/:listingId/checkout (Idempotency-Key) →
// { success, order }. "order" is the escrow trade in p2pmarket vocabulary.
export async function checkoutEscrow(input: CheckoutInput): Promise<EscrowTrade> {
  if (USE_MOCK) {
    await delay();
    const l = MOCK_LISTINGS.find((x) => x.id === input.listingId);
    return {
      id: `t_${Date.now()}`, listingId: input.listingId, listingTitle: l?.title ?? 'Item',
      amountKobo: input.amountKobo, status: 'HELD', role: 'buyer', counterparty: l?.sellerHandle ?? '@seller',
      thumbColor: l?.thumbColor ?? '#340075', createdAtISO: new Date().toISOString(),
    };
  }
  const l = MOCK_LISTINGS.find((x) => x.id === input.listingId);
  const res = await api.post(
    `${P2P_BASE}/listings/${input.listingId}/checkout`,
    {},
    { headers: { 'Idempotency-Key': escrowIdempotencyKey() } },
  );
  const order = (res.data as { order?: Record<string, unknown> })?.order ?? {};
  return {
    id: String(order.id ?? `t_${Date.now()}`),
    listingId: input.listingId,
    listingTitle: l?.title ?? 'Item',
    amountKobo: input.amountKobo,
    status: (String(order.status ?? 'HELD').toUpperCase() as EscrowStatus),
    role: 'buyer',
    counterparty: l?.sellerHandle ?? '@seller',
    thumbColor: l?.thumbColor ?? '#340075',
    createdAtISO: String(order.created_at ?? new Date().toISOString()),
  };
}

// Backend: POST /p2p/orders/:orderId/confirm (buyer confirms receipt →
// releases escrow to seller) → { success }.
export async function releaseEscrow(tradeId: string): Promise<{ ok: boolean; status: EscrowStatus }> {
  if (USE_MOCK) { await delay(); return { ok: true, status: 'RELEASED' }; }
  await api.post(
    `${P2P_BASE}/orders/${tradeId}/confirm`,
    {},
    { headers: { 'Idempotency-Key': escrowIdempotencyKey() } },
  );
  return { ok: true, status: 'RELEASED' };
}

// Backend: POST /p2p/orders/:orderId/dispute expects { reason } → { success }.
export async function raiseDispute(input: DisputeInput): Promise<{ ok: boolean; status: EscrowStatus }> {
  if (USE_MOCK) { await delay(); return { ok: true, status: 'DISPUTED' }; }
  await api.post(
    `${P2P_BASE}/orders/${input.tradeId}/dispute`,
    { reason: input.reason },
    { headers: { 'Idempotency-Key': escrowIdempotencyKey() } },
  );
  return { ok: true, status: 'DISPUTED' };
}

// ── Hooks ─────────────────────────────────────────────────────────────────────
const KEYS = {
  listings: (q: string) => ['social', 'listings', q] as const,
  listing:  (id: string) => ['social', 'listing', id] as const,
  trades:   ['social', 'escrow', 'trades'] as const,
  trade:    (id: string) => ['social', 'escrow', 'trade', id] as const,
};

export const useListings = (query = '') =>
  useQuery({ queryKey: KEYS.listings(query), queryFn: () => listListings(query) });

export const useListing = (id: string) =>
  useQuery({ queryKey: KEYS.listing(id), queryFn: () => getListing(id), enabled: !!id });

export const useTrades = () =>
  useQuery({ queryKey: KEYS.trades, queryFn: listTrades });

export const useTrade = (id: string) =>
  useQuery({ queryKey: KEYS.trade(id), queryFn: () => getTrade(id), enabled: !!id });

export function useCreateListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateListingInput) => createListing(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['social', 'listings'] }),
  });
}

export function useCheckoutEscrow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CheckoutInput) => checkoutEscrow(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.trades }),
  });
}

export function useReleaseEscrow(tradeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => releaseEscrow(tradeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.trade(tradeId) });
      qc.invalidateQueries({ queryKey: KEYS.trades });
    },
  });
}

export function useRaiseDispute(tradeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => raiseDispute({ tradeId, reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.trade(tradeId) });
      qc.invalidateQueries({ queryKey: KEYS.trades });
    },
  });
}
