// ── Marketplace — Transact OFFER + thread mocks ──────────────────────────────
//
// Offers are FIRST-CLASS objects (price + status), not chat text. This mock also
// backs the Chat inbox + Deal Room: since no dedicated marketplace messaging
// shell exists in the app yet, we model each conversation ("thread") around its
// listing + its offers, and keep the free chat text local (see MockMessage).
// TODO(messaging): when a shared Paymax messaging shell is wired for the
// marketplace, replace MockMessage/thread storage with it and keep offers here.
import type { CreateOfferInput, Offer, OfferStatus } from '../types';
import { MOCK_LISTINGS } from './discovery.mock';

const now = () => new Date().toISOString();
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const delay = (ms = 240) => new Promise((r) => setTimeout(r, ms));

export const MOCK_ME = 'me';

// ── Local (non-escrow) chat text — clearly separate from structured offers ───
export interface MockMessage {
  id: string;
  threadId: string;
  senderId: string; // MOCK_ME or the counterparty id
  text: string;
  createdAt: string;
}

// ── A Deal Room thread: listing context + counterparty, per the Chat inbox ───
export interface DealThread {
  id: string;
  listingId: string;
  listingTitle: string;
  listingThumbUrl: string;
  listingPriceKobo: number;
  escrowEligible: boolean;
  counterpartyId: string;
  counterpartyName: string;
  /** buyer = I'm buying from them; seller = they're buying from me. */
  myRole: 'buyer' | 'seller';
  unread: number;
  lastMessageAt: string;
  /** ADR-023 "mark met" signal: true once a participant marked the deal met,
   *  which unlocks review-writes. Optional — absent/false ⇒ not yet met. */
  met?: boolean;
}

const threads: DealThread[] = [
  {
    id: 'th_iphone',
    listingId: 'lst_iphone',
    listingTitle: 'iPhone 13 Pro Max — 256GB Sierra Blue',
    listingThumbUrl: '',
    listingPriceKobo: 65_000_000,
    escrowEligible: true,
    counterpartyId: 'seller_1',
    counterpartyName: 'Bisi Adeyemi',
    myRole: 'buyer',
    unread: 2,
    lastMessageAt: minsAgo(8),
  },
  {
    id: 'th_ps5',
    listingId: 'lst_ps5',
    listingTitle: 'PlayStation 5 Disc Edition + 2 Controllers',
    listingThumbUrl: '',
    listingPriceKobo: 55_000_000,
    escrowEligible: true,
    counterpartyId: 'seller_2',
    counterpartyName: 'Tunde Okafor',
    myRole: 'buyer',
    unread: 0,
    lastMessageAt: minsAgo(120),
  },
  {
    id: 'th_desk',
    listingId: 'lst_desk',
    listingTitle: 'Standing desk — electric, adjustable',
    listingThumbUrl: '',
    listingPriceKobo: 12_000_000,
    escrowEligible: false, // furniture — meetup-eligible, not escrow
    counterpartyId: 'buyer_x',
    counterpartyName: 'Chidi (buyer)',
    myRole: 'seller',
    unread: 1,
    lastMessageAt: minsAgo(45),
  },
];

const threadById = new Map(threads.map((t) => [t.id, t]));

const messages: MockMessage[] = [
  { id: 'm1', threadId: 'th_iphone', senderId: 'seller_1', text: "Hi! Yes it's available. Battery health 89%.", createdAt: minsAgo(30) },
  { id: 'm2', threadId: 'th_iphone', senderId: MOCK_ME, text: 'Great — would you take a bit less?', createdAt: minsAgo(25) },
  { id: 'm3', threadId: 'th_iphone', senderId: 'seller_1', text: "Let's talk. Send me an offer.", createdAt: minsAgo(8) },
  { id: 'm4', threadId: 'th_desk', senderId: 'buyer_x', text: 'Can we meet at Ikeja? Cash on pickup.', createdAt: minsAgo(45) },
];

const offers: Offer[] = [
  {
    id: 'off_1',
    listingId: 'lst_iphone',
    buyerId: MOCK_ME,
    offerPriceKobo: 60_000_000,
    status: 'countered',
    parentOfferId: null,
    createdAt: minsAgo(20),
    expiresAt: hoursFromNow(24),
  },
  {
    id: 'off_2',
    listingId: 'lst_iphone',
    buyerId: MOCK_ME,
    offerPriceKobo: 62_000_000,
    status: 'pending',
    parentOfferId: 'off_1',
    createdAt: minsAgo(6),
    expiresAt: hoursFromNow(24),
  },
];

// ── Inbox / thread reads ─────────────────────────────────────────────────────
export async function mockListThreads(): Promise<DealThread[]> {
  await delay(220);
  return [...threads].sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1));
}

export async function mockGetThread(threadId: string): Promise<DealThread> {
  await delay(160);
  const t = threadById.get(threadId);
  if (!t) throw new Error('THREAD_NOT_FOUND');
  return t;
}

// Open-or-create the deal thread for a listing (Contact seller / Make Offer) or
// a seller (Message from the profile). Reuses an existing thread when one is
// already modelled; otherwise synthesizes one from the listing/seller fixtures so
// the Deal Room always has context. Threads are mock-backed in both modes (there
// is no live messaging shell yet — see offers.api.ts), so this drives both.
export async function mockGetOrCreateThread(opts: { listingId?: string; sellerId?: string }): Promise<DealThread> {
  await delay(180);
  if (opts.listingId) {
    const existing = threads.find((t) => t.listingId === opts.listingId);
    if (existing) return existing;
    const l = MOCK_LISTINGS.find((x) => x.id === opts.listingId);
    const created: DealThread = {
      id: `th_${opts.listingId}`,
      listingId: opts.listingId,
      listingTitle: l?.title ?? 'Listing',
      listingThumbUrl: (l?.media ?? [])[0]?.urlThumb ?? '',
      listingPriceKobo: l?.priceKobo ?? 0,
      escrowEligible: l?.escrowEligible ?? false,
      counterpartyId: l?.sellerId ?? 'seller',
      counterpartyName: l?.seller?.name ?? 'Seller',
      myRole: 'buyer',
      unread: 0,
      lastMessageAt: now(),
    };
    threads.push(created);
    threadById.set(created.id, created);
    return created;
  }
  if (opts.sellerId) {
    const existing = threads.find((t) => t.counterpartyId === opts.sellerId);
    if (existing) return existing;
    const l = MOCK_LISTINGS.find((x) => x.sellerId === opts.sellerId);
    const created: DealThread = {
      id: `th_seller_${opts.sellerId}`,
      listingId: l?.id ?? '',
      listingTitle: l?.title ?? 'Direct message',
      listingThumbUrl: (l?.media ?? [])[0]?.urlThumb ?? '',
      listingPriceKobo: l?.priceKobo ?? 0,
      escrowEligible: l?.escrowEligible ?? false,
      counterpartyId: opts.sellerId,
      counterpartyName: l?.seller?.name ?? 'Seller',
      myRole: 'buyer',
      unread: 0,
      lastMessageAt: now(),
    };
    threads.push(created);
    threadById.set(created.id, created);
    return created;
  }
  throw new Error('getOrCreateThread requires listingId or sellerId');
}

export async function mockGetMessages(threadId: string): Promise<MockMessage[]> {
  await delay(160);
  return messages.filter((m) => m.threadId === threadId);
}

export async function mockSendMessage(threadId: string, text: string): Promise<MockMessage> {
  await delay(120);
  const msg: MockMessage = { id: `m_${Date.now()}`, threadId, senderId: MOCK_ME, text, createdAt: now() };
  messages.push(msg);
  const t = threadById.get(threadId);
  if (t) t.lastMessageAt = msg.createdAt;
  return msg;
}

// ── Offers ───────────────────────────────────────────────────────────────────
export async function mockListOffers(listingId: string): Promise<Offer[]> {
  await delay(160);
  return offers.filter((o) => o.listingId === listingId).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export async function mockCreateOffer(input: CreateOfferInput): Promise<Offer> {
  await delay(320);
  const offer: Offer = {
    id: `off_${Date.now()}`,
    listingId: input.listingId,
    buyerId: MOCK_ME,
    offerPriceKobo: input.offerPriceKobo,
    status: 'pending',
    parentOfferId: null,
    createdAt: now(),
    expiresAt: hoursFromNow(24),
  };
  offers.push(offer);
  return offer;
}

function transition(offerId: string, status: OfferStatus): Offer {
  const o = offers.find((x) => x.id === offerId);
  if (!o) throw new Error('OFFER_NOT_FOUND');
  o.status = status;
  return o;
}

export async function mockAcceptOffer(offerId: string): Promise<Offer> {
  await delay(240);
  return transition(offerId, 'accepted');
}

export async function mockDeclineOffer(offerId: string): Promise<Offer> {
  await delay(240);
  return transition(offerId, 'declined');
}

export async function mockCounterOffer(offerId: string, priceKobo: number): Promise<Offer> {
  await delay(260);
  transition(offerId, 'countered');
  const counter: Offer = {
    id: `off_${Date.now()}`,
    listingId: offers.find((x) => x.id === offerId)?.listingId ?? '',
    buyerId: MOCK_ME,
    offerPriceKobo: priceKobo,
    status: 'pending',
    parentOfferId: offerId,
    createdAt: now(),
    expiresAt: hoursFromNow(24),
  };
  offers.push(counter);
  return counter;
}
