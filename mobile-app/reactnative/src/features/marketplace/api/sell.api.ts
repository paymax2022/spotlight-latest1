// ── Marketplace — Sell API (mock/live dispatch) ──────────────────────────────
//
// The Sell group's data layer (screens 10–17). Every function switches on
// MKT_USE_MOCK:
//   • mock  → ./sell.mock fixtures + in-memory store (offline-first, camelCase)
//   • live  → the shared client (mktGet/mktPost/…) which normalizes snake→camel
//             for responses and camel→snake for request bodies. Money POSTs
//             (boosts) carry an Idempotency-Key.
//
// Write everything camelCase — the client converts bodies to snake_case on the
// wire. Endpoints (base /api/v1/marketplace, proxied to Go /v1/marketplace):
//   POST /listings                 create draft
//   PUT  /listings/:id             update
//   POST /listings/:id/submit      → moderation / live
//   POST /listings/:id/pause | /resume | /renew
//   POST /listings/:id/mark-sold
//   DELETE /listings/:id
//   GET  /listings/:id
//   GET  /categories | /categories/:id (attribute schema)
//   GET  /sellers/:id/listings     (my listings, current user id)
//   POST /listings/media/presign   { uploadUrl, fileUrl }   (image upload)
//   GET  /boosts/tiers             (public)
//   POST /boosts                   (money — wallet debit; Idempotency-Key)
//   GET  /boosts/:id

import { MKT_USE_MOCK, mktGet, mktPost, mktPut, mktDelete } from './client';
import * as S from './sell.mock';
import type {
  Boost,
  BoostTier,
  Category,
  CreateBoostInput,
  CreateListingInput,
  Listing,
  UpdateListingInput,
} from '../types';

export type { AiPrefillResult, AttributeField, AttributeSchema } from './sell.mock';
export { mockIsEscrowEligibleCategory as isEscrowEligibleCategory, MOCK_SELF_SELLER_ID } from './sell.mock';

// ─── Categories (attribute schema for the Attribute form) ────────────────────

export async function getCategories(): Promise<Category[]> {
  if (MKT_USE_MOCK) return S.mockSellCategories();
  return mktGet<Category[]>('/categories');
}

export async function getCategory(id: string): Promise<Category> {
  if (MKT_USE_MOCK) return S.mockSellCategory(id);
  return mktGet<Category>(`/categories/${id}`);
}

// ─── AI prefill (client-side heuristic stand-in) ─────────────────────────────
// Mock-only today. In live mode there is no dedicated vision endpoint owned by
// this agent yet, so we degrade to the same heuristic (kept graceful — a failure
// resolves to a low-confidence "no guess" result the composer can ignore).

export async function aiPrefill(photoHint: string): Promise<S.AiPrefillResult> {
  // Heuristic runs client-side regardless of mock/live; it never blocks.
  return S.mockAiPrefill(photoHint);
}

// ─── Fair-price band (client estimate when the server has none) ──────────────

export function estimateFairPriceBand(categoryId: string | null | undefined) {
  return S.mockFairPriceBand(categoryId);
}

// ─── Image upload (presign → PUT → return fileUrl) ───────────────────────────
// Backend endpoint (Go marketplace): POST /media/presign { fileName, mimeType }
//   → { uploadUrl, fileUrl }. NOTE: it's mounted at /media/presign (NOT
//   /listings/media/presign) because Gin's radix router conflicts a static
//   "media" segment with the existing /listings/:id param route.
// Then PUT the raw bytes to uploadUrl and persist fileUrl on the listing.

export interface PresignResult {
  uploadUrl: string;
  fileUrl: string;
}

export async function presignMedia(input: { fileName: string; mimeType: string }): Promise<PresignResult> {
  if (MKT_USE_MOCK) return S.mockPresignMedia(input);
  return mktPost<PresignResult>('/media/presign', input);
}

/**
 * Full image upload: presign → PUT the picked file bytes to the presigned URL →
 * return the durable fileUrl to persist on the listing (as a mediaId). Mock
 * uploadUrls (mock://…) skip the network PUT so the flow round-trips offline.
 */
export async function uploadListingImage(file: { uri: string; name: string; mimeType: string }): Promise<string> {
  const { uploadUrl, fileUrl } = await presignMedia({ fileName: file.name, mimeType: file.mimeType });
  if (!uploadUrl.startsWith('mock://')) {
    const blob = await (await fetch(file.uri)).blob();
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      body: blob,
      headers: { 'Content-Type': file.mimeType },
    });
    if (!res.ok) throw new Error(`Image upload failed (${res.status})`);
  }
  return fileUrl;
}

// ─── Listing lifecycle ────────────────────────────────────────────────────────

export async function createListing(input: CreateListingInput): Promise<Listing> {
  if (MKT_USE_MOCK) return S.mockCreateListing(input);
  return mktPost<Listing>('/listings', input);
}

export async function updateListing(id: string, input: UpdateListingInput): Promise<Listing> {
  if (MKT_USE_MOCK) return S.mockUpdateListing(id, input);
  return mktPut<Listing>(`/listings/${id}`, input);
}

export async function submitListing(id: string): Promise<Listing> {
  if (MKT_USE_MOCK) return S.mockSubmitListing(id);
  return mktPost<Listing>(`/listings/${id}/submit`);
}

export async function getListing(id: string): Promise<Listing> {
  if (MKT_USE_MOCK) return S.mockGetListing(id);
  return mktGet<Listing>(`/listings/${id}`);
}

export async function pauseListing(id: string): Promise<Listing> {
  if (MKT_USE_MOCK) return S.mockPauseListing(id);
  return mktPost<Listing>(`/listings/${id}/pause`);
}

export async function resumeListing(id: string): Promise<Listing> {
  if (MKT_USE_MOCK) return S.mockResumeListing(id);
  return mktPost<Listing>(`/listings/${id}/resume`);
}

export async function renewListing(id: string): Promise<Listing> {
  if (MKT_USE_MOCK) return S.mockRenewListing(id);
  return mktPost<Listing>(`/listings/${id}/renew`);
}

/** Mark sold. `viaEscrow=false` = sold elsewhere (feeds review-eligibility). */
export async function markSold(id: string, viaEscrow: boolean): Promise<Listing> {
  if (MKT_USE_MOCK) return S.mockMarkSold(id);
  return mktPost<Listing>(`/listings/${id}/mark-sold`, { viaEscrow });
}

export async function deleteListing(id: string): Promise<{ ok: boolean }> {
  if (MKT_USE_MOCK) return S.mockDeleteListing(id);
  return mktDelete<{ ok: boolean }>(`/listings/${id}`);
}

/** The signed-in seller's own listings — GET /sellers/:id/listings with the
 *  current user id (full Listing rows so My Listings can show status + stats). */
export async function getMyListings(sellerId: string | null): Promise<Listing[]> {
  if (MKT_USE_MOCK) return S.mockMyListings();
  if (!sellerId) return [];
  return mktGet<Listing[]>(`/sellers/${sellerId}/listings`, { mine: 1 });
}

// ─── Boosts (money path — POST /boosts carries an Idempotency-Key) ───────────

export async function getBoostTiers(): Promise<BoostTier[]> {
  if (MKT_USE_MOCK) return S.mockBoostTiers();
  return mktGet<BoostTier[]>('/boosts/tiers');
}

export async function createBoost(input: CreateBoostInput, idempotencyKey: string): Promise<Boost> {
  if (MKT_USE_MOCK) return S.mockCreateBoost(input.listingId, input.tier);
  return mktPost<Boost>('/boosts', input, idempotencyKey);
}

export async function getBoost(id: string): Promise<Boost> {
  if (MKT_USE_MOCK) return S.mockGetBoost(id);
  return mktGet<Boost>(`/boosts/${id}`);
}
