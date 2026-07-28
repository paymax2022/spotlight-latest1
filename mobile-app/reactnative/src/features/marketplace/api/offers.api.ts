// ── Marketplace — Transact OFFERS + Deal Room API (mock/live dispatch) ───────
//
// Offers are first-class NON-BINDING price proposals (POST /offers, /offers/:id/
// {accept,counter,decline}) — accepting one just agrees a number for the meetup.
// The Chat inbox + Deal Room thread/message reads are mock-only today because no
// shared marketplace messaging shell is wired — see offers.mock.ts's
// TODO(messaging). In live mode, thread/message calls degrade gracefully to
// empty so the Deal Room still renders its (live) offer bubbles + meetup CTA.
import { MKT_USE_MOCK, mktPost } from './client';
import * as M from './offers.mock';
import type { CreateOfferInput, Offer } from '../types';

export type { DealThread, MockMessage } from './offers.mock';

// ── Threads / messages (mock-backed; live degrades gracefully) ───────────────
export async function listThreads(): Promise<M.DealThread[]> {
  if (MKT_USE_MOCK) return M.mockListThreads();
  // No live messaging endpoint owned by this agent yet.
  return [];
}

export async function getThread(threadId: string): Promise<M.DealThread> {
  return M.mockGetThread(threadId);
}

export async function getMessages(threadId: string): Promise<M.MockMessage[]> {
  if (MKT_USE_MOCK) return M.mockGetMessages(threadId);
  return [];
}

export async function sendMessage(threadId: string, text: string): Promise<M.MockMessage> {
  // Always local until a messaging shell exists (TODO messaging).
  return M.mockSendMessage(threadId, text);
}

// ── Offers (first-class) ─────────────────────────────────────────────────────
export async function listOffers(listingId: string): Promise<Offer[]> {
  if (MKT_USE_MOCK) return M.mockListOffers(listingId);
  // No dedicated GET /offers?listingId endpoint in the frozen contract; live
  // Deal Rooms hydrate offers from thread payloads. Return [] as a safe base.
  return [];
}

/** POST /offers {listingId, priceKobo, message?} */
export async function createOffer(input: CreateOfferInput): Promise<Offer> {
  if (MKT_USE_MOCK) return M.mockCreateOffer(input);
  return mktPost<Offer>('/offers', {
    listingId: input.listingId,
    priceKobo: input.offerPriceKobo,
    message: input.message,
  });
}

/** POST /offers/:id/accept */
export async function acceptOffer(offerId: string): Promise<Offer> {
  if (MKT_USE_MOCK) return M.mockAcceptOffer(offerId);
  return mktPost<Offer>(`/offers/${offerId}/accept`);
}

/** POST /offers/:id/counter {priceKobo} */
export async function counterOffer(offerId: string, priceKobo: number): Promise<Offer> {
  if (MKT_USE_MOCK) return M.mockCounterOffer(offerId, priceKobo);
  return mktPost<Offer>(`/offers/${offerId}/counter`, { priceKobo });
}

/** POST /offers/:id/decline */
export async function declineOffer(offerId: string): Promise<Offer> {
  if (MKT_USE_MOCK) return M.mockDeclineOffer(offerId);
  return mktPost<Offer>(`/offers/${offerId}/decline`);
}
