// ── Marketplace — Transact OFFERS + Deal Room API (mock/live dispatch) ───────
//
// Offers are first-class NON-BINDING price proposals (POST /offers, /offers/:id/
// {accept,counter,decline}) — accepting one just agrees a number for the meetup.
// The Chat inbox + Deal Room now run on a LIVE messaging backend (mounted under
// the marketplace member group at /api/v1/marketplace/threads[/…/messages]):
//   POST /threads           get-or-create the buyer↔seller thread for a listing
//   GET  /threads           the caller's deal inbox
//   GET  /threads/:id       one thread
//   GET  /threads/:id/messages   thread history (also marks it read for caller)
//   POST /threads/:id/messages   send a message
// The mock module (offers.mock.ts) remains the offline/dev fallback, selected
// whenever MKT_USE_MOCK is true. The MockMessage shape matches the live Message
// shape ({ id, threadId, senderId, text, createdAt }), so screens are agnostic.
import { MKT_USE_MOCK, mktGet, mktPost, arr } from './client';
import * as M from './offers.mock';
import type { CreateOfferInput, Offer } from '../types';

export type { DealThread, MockMessage } from './offers.mock';

// ── Threads / messages (live when !MKT_USE_MOCK; mock is the offline fallback) ─
export async function listThreads(): Promise<M.DealThread[]> {
  if (MKT_USE_MOCK) return M.mockListThreads();
  return arr(await mktGet<M.DealThread[]>('/threads'));
}

export async function getThread(threadId: string): Promise<M.DealThread> {
  if (MKT_USE_MOCK) return M.mockGetThread(threadId);
  return mktGet<M.DealThread>('/threads/' + threadId);
}

/**
 * Open-or-create the deal thread for a listing (Contact seller / Make Offer) or a
 * seller (Message). Live: POST /threads {listingId} get-or-creates the buyer↔
 * seller thread for that listing. The listing-centric backend has no seller-only
 * thread endpoint, so a sellerId-only request (Message from a seller profile with
 * no listing context) degrades to the mock/local synthesis so the CTA never
 * dead-ends. Pass listingId or sellerId.
 */
export async function getOrCreateThread(opts: { listingId?: string; sellerId?: string }): Promise<M.DealThread> {
  if (!MKT_USE_MOCK && opts.listingId) {
    return mktPost<M.DealThread>('/threads', { listingId: opts.listingId });
  }
  // Mock mode, or a seller-only request the listing-centric backend can't serve.
  return M.mockGetOrCreateThread(opts);
}

export async function getMessages(threadId: string): Promise<M.MockMessage[]> {
  if (MKT_USE_MOCK) return M.mockGetMessages(threadId);
  // GET also marks the thread read for the caller on the backend.
  return arr(await mktGet<M.MockMessage[]>('/threads/' + threadId + '/messages'));
}

export async function sendMessage(threadId: string, text: string): Promise<M.MockMessage> {
  if (MKT_USE_MOCK) return M.mockSendMessage(threadId, text);
  return mktPost<M.MockMessage>('/threads/' + threadId + '/messages', { body: text });
}

// ── Offers (first-class) ─────────────────────────────────────────────────────
export async function listOffers(listingId: string): Promise<Offer[]> {
  if (MKT_USE_MOCK) return M.mockListOffers(listingId);
  // Live: GET /offers?listingId — participant-scoped negotiation history.
  return arr(await mktGet<Offer[]>('/offers', { listingId }));
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
