// ── Paymax Marketplace — shared camelCase domain types ───────────────────────
//
// SINGLE SOURCE OF TRUTH for the marketplace feature. Every screen and every
// sibling domain agent (Sell, Transact, Trust/Account) imports its types from
// here. Derived 1:1 from the Go domain model
// (backend/internal/marketplace/model.go), but expressed in camelCase because
// the shared client (./api/client.ts) deep-normalizes every backend response
// snake_case → camelCase and converts request bodies camelCase → snake_case.
//
// RULE: enum string VALUES below match the backend SQL/Go enums EXACTLY (the Go
// constants are the authority). Only the TS identifier casing differs. Do not
// rename a value without changing the backend enum first.

// ─── Enums (values mirror backend model.go verbatim) ─────────────────────────

/** mkt_listings.status — ListingStatus in model.go */
export type ListingStatus =
  | 'draft'
  | 'pending_review'
  | 'active'
  | 'paused'
  | 'expired'
  | 'sold'
  | 'removed_policy'
  | 'removed_user';

/**
 * mkt_orders.status — OrderStatus in model.go. This is the escrow FSM the
 * Transact agent drives. Order of the union follows the FSM progression:
 *   initiated → funded → seller_accepted → in_delivery → delivered
 *            → inspection_window → released
 * with cancelled / disputed / refunded / split_settled as branch/terminal states.
 */
export type OrderStatus =
  | 'initiated'
  | 'funded'
  | 'seller_accepted'
  | 'in_delivery'
  | 'delivered'
  | 'inspection_window'
  | 'released'
  | 'cancelled'
  | 'disputed'
  | 'refunded'
  | 'split_settled';

/** mkt_disputes.status — DisputeStatus in model.go */
export type DisputeStatus =
  | 'opened'
  | 'evidence_window'
  | 'under_review'
  | 'decided'
  | 'executed'
  | 'closed'
  | 'appealed';

/** mkt_boosts.status — BoostStatus in model.go */
export type BoostStatus =
  | 'purchased'
  | 'active'
  | 'completed'
  | 'rejected_with_reason'
  | 'auto_refunded';

/** KYCTier in model.go — trust gate for the buy/sell CTAs. */
export type KYCTier = 'tier0_browse' | 'tier1_buy' | 'tier2_sell' | 'tier3_business';

/** mkt_disputes.decision (DecisionRefundBuyer / DecisionReleaseSeller / DecisionSplit). */
export type DisputeDecision = 'refund_buyer' | 'release_seller' | 'split';

/** CreateOrderInput.delivery_option (§3.1). */
export type DeliveryOption = 'pickup' | 'rider_delivery';

/** FundInput.payment_method (§3.1). */
export type PaymentMethod = 'wallet' | 'card' | 'bank_transfer';

/** EvidenceInput.type (§3.1). */
export type EvidenceType = 'photo' | 'chat_excerpt' | 'document';

/** Item condition (mkt_listings.condition — free string on the backend; these are
 *  the day-one Nigerian classifieds vocabulary the UI renders/labels). */
export type ListingCondition = 'new' | 'used' | 'foreign_used' | 'local_used' | 'refurbished';

// KYC tier ordering — used to gate the escrow buy CTA fail-closed (undefined = tier0).
const KYC_TIER_RANK: Record<KYCTier, number> = {
  tier0_browse: 0,
  tier1_buy: 1,
  tier2_sell: 2,
  tier3_business: 3,
};

export function kycTierAtLeast(tier: KYCTier | undefined | null, min: KYCTier): boolean {
  if (!tier) return false;
  return KYC_TIER_RANK[tier] >= KYC_TIER_RANK[min];
}

// ─── Media / pricing value objects ───────────────────────────────────────────

export interface ListingMedia {
  id: string;
  urlThumb: string;
  urlCard: string;
  urlFull: string;
  blurhash: string;
  sortOrder: number;
}

/** Server-computed fair-price band (§ Listing Detail fair-price chip). */
export interface FairPriceBand {
  p25Kobo: number;
  p50Kobo: number;
  p75Kobo: number;
}

// ─── Listing ─────────────────────────────────────────────────────────────────

// Compact seller summary embedded on listing cards / detail (trust card source).
export interface SellerSummary {
  id: string;
  name: string;
  trustScore: number;
  verifiedIdBadge: boolean;
  verifiedBusinessBadge: boolean;
  tenureLabel: string;
  responseTimeMinutes: number | null;
  kycTier?: KYCTier;
}

/** Full listing — mirrors mkt_listings (Listing in model.go) plus the read-model
 *  join fields the detail screen needs (seller card, media, fair-price band). */
export interface Listing {
  id: string;
  marketId: string;
  sellerId: string;
  seller?: SellerSummary;
  categoryId: string;
  category?: { id: string; name: string; slug: string };
  title: string;
  description: string;
  priceKobo: number;
  currency?: string;
  condition: ListingCondition;
  attrs: Record<string, unknown>;
  media: ListingMedia[];
  status: ListingStatus;
  qualityScore: number;
  escrowEligible: boolean;
  fairPriceBand: FairPriceBand | null;
  state: string;
  lga?: string;
  moderationReasonCode?: string | null;
  viewCount: number;
  saveCount: number;
  savedByMe?: boolean;
  similarListingIds: string[];
  createdAt: string;
  updatedAt?: string;
  expiresAt?: string;
  soldAt?: string | null;
}

/** Lightweight card shape returned by /search results and seller listings grids. */
export interface ListingSummary {
  id: string;
  /** mkt_listings.category_id. The API has always sent it (the client deep-camels
   *  every response); it was simply never declared, so nothing could use it. The
   *  card needs it to show what a listing IS while it has no photo. */
  categoryId?: string;
  title: string;
  priceKobo: number;
  condition: ListingCondition;
  thumbUrl: string;
  blurhash: string;
  state: string;
  lga?: string;
  sellerTrustScore: number;
  escrowEligible: boolean;
  boosted: boolean;
  fairPriceBand?: FairPriceBand | null;
  lat?: number;
  lng?: number;
  createdAt: string;
}

// ─── Category ─────────────────────────────────────────────────────────────────

/** mkt_categories (Category in model.go). attributeSchema drives the schema-driven
 *  quick filters (Category Landing) and the Sell attribute form. */
export interface Category {
  id: string;
  marketId?: string;
  parentId: string | null;
  slug: string;
  name: string;
  /** Lucide icon NAME (e.g. 'Car'), resolved client-side as Icons[icon]. */
  icon?: string;
  /** Display order within the parent; ties fall back to name. */
  sortOrder?: number;
  attributeSchema: Record<string, unknown>;
  quickFilters?: CategoryQuickFilter[];
  riskTier?: number;
  commissionBps?: number;
  isActive?: boolean;
  minPhotos?: number;
  minDescriptionWords?: number;
}

/** One config-driven quick-filter chip for a Category Landing (schema-derived). */
export interface CategoryQuickFilter {
  key: string;
  label: string;
  type: 'enum' | 'range' | 'bool';
  options?: Array<{ value: string; label: string }>;
}

// ─── Search ──────────────────────────────────────────────────────────────────

export type SearchSort = 'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'trusted_first';

export interface SearchParams {
  q?: string;
  categoryId?: string;
  priceMin?: number;
  priceMax?: number;
  condition?: ListingCondition;
  verifiedSellerOnly?: boolean;
  escrowEligibleOnly?: boolean;
  deliveryAvailable?: boolean;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  state?: string;
  lga?: string;
  sort?: SearchSort;
  cursor?: string;
  limit?: number;
}

export interface SearchFacets {
  categories: Array<{ id: string; name: string; count: number }>;
  conditions: Array<{ value: ListingCondition; count: number }>;
  priceRanges: Array<{ minKobo: number; maxKobo: number; count: number }>;
}

export interface SearchResponse {
  results: ListingSummary[];
  facets: SearchFacets;
  nextCursor: string | null;
  tookMs: number;
}

/** Instant-suggest payload for the Search screen. */
export interface SearchSuggestion {
  type: 'query' | 'category';
  text: string;
  categoryId?: string;
}

// ─── Seller profile & reviews ────────────────────────────────────────────────

/** GET /sellers/:id/profile — TrustProfile join in model.go. */
export interface SellerProfile {
  id: string;
  name: string;
  avatarUrl?: string;
  trustScore: number;
  verifiedIdBadge: boolean;
  verifiedBusinessBadge: boolean;
  tenureLabel: string;
  memberSince?: string;
  responseTimeMinutes: number | null;
  responseRate?: number;
  completedEscrowCount: number;
  disputeCount: number;
  kycTier: KYCTier;
}

/** mkt_reviews (Review in model.go). In the connect model reviews are optional
 *  and self-reported after a deal is marked complete in the Deal Room, so they
 *  hang off a dealId (the thread) rather than a released escrow order. */
export interface Review {
  id: string;
  dealId: string;
  reviewerId: string;
  revieweeId?: string;
  reviewerName?: string;
  rating: number | null;
  comment: string | null;
  tags?: string[];
  sellerReply: string | null;
  isPlaceholder: boolean;
  moderationState?: string;
  createdAt: string;
}

// ─── Order (escrow FSM — Transact agent) ─────────────────────────────────────

/** mkt_orders (Order in model.go). Money fields are integer kobo. */
export interface Order {
  id: string;
  marketId: string;
  listingId: string;
  listingTitle?: string;
  listingThumbUrl?: string;
  buyerId: string;
  sellerId: string;
  offerId: string | null;
  amountKobo: number;
  escrowFeeKobo: number;
  deliveryFeeKobo: number;
  totalPayableKobo?: number;
  status: OrderStatus;
  ledgerFundRef: string | null;
  ledgerReleaseRef: string | null;
  deliveryRef: string | null;
  podPhotoUrl?: string | null;
  inspectionDeadline: string | null;
  createdAt: string;
  updatedAt: string;
  fundedAt?: string | null;
  deliveredAt?: string | null;
  releasedAt?: string | null;
  cancelledAt?: string | null;
}

export interface CreateOrderInput {
  listingId: string;
  offerId?: string;
  deliveryOption: DeliveryOption;
}

export interface FundOrderInput {
  paymentMethod: PaymentMethod;
}

// ─── Offer (mkt_offers) ──────────────────────────────────────────────────────

export type OfferStatus = 'pending' | 'accepted' | 'declined' | 'countered' | 'expired';

export interface Offer {
  id: string;
  listingId: string;
  buyerId: string;
  offerPriceKobo: number;
  status: OfferStatus | string;
  parentOfferId?: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface CreateOfferInput {
  listingId: string;
  offerPriceKobo: number;
  message?: string;
}

// ─── Dispute (mkt_disputes) ──────────────────────────────────────────────────

export type DisputeReasonCode =
  | 'item_not_as_described'
  | 'item_not_received'
  | 'item_damaged'
  | 'counterfeit'
  | 'other';

export interface EvidenceInput {
  type: EvidenceType;
  urlOrText: string;
}

export interface OpenDisputeInput {
  reasonCode: DisputeReasonCode;
  description: string;
  evidence: EvidenceInput[];
}

export interface Dispute {
  id: string;
  orderId: string;
  openedBy: string;
  reasonCode: DisputeReasonCode | string;
  status: DisputeStatus;
  decision: DisputeDecision | null;
  decisionNotes: string | null;
  requiresDualApproval?: boolean;
  evidenceDeadline: string;
  createdAt: string;
  decidedAt?: string | null;
  executedAt?: string | null;
}

// ─── Boost (mkt_boosts) ──────────────────────────────────────────────────────

export interface BoostTier {
  tier: string;
  durationDays: number;
  priceKobo: number;
  label: string;
  description: string;
}

export interface Boost {
  id: string;
  listingId: string;
  sellerId: string;
  tier: string;
  durationDays: number;
  priceKobo: number;
  status: BoostStatus;
  rejectionReasonCode: string | null;
  startsAt: string | null;
  endsAt: string | null;
  createdAt?: string;
}

export interface CreateBoostInput {
  listingId: string;
  tier: string;
}

// ─── Saved search (mkt_saved_searches) ───────────────────────────────────────

export type AlertFrequency = 'instant' | 'daily' | 'off';

export interface SavedSearch {
  id: string;
  userId?: string;
  marketId?: string;
  query: string | null;
  filters: Record<string, unknown>;
  alertEnabled: boolean;
  alertFrequency?: AlertFrequency;
  lastNotifiedAt?: string | null;
  createdAt: string;
}

export interface CreateSavedSearchInput {
  query?: string;
  filters: Record<string, unknown>;
  alertEnabled?: boolean;
}

// ─── Listing create/update (Sell agent) ──────────────────────────────────────

export interface CreateListingInput {
  categoryId: string;
  title: string;
  description: string;
  priceKobo: number;
  condition: ListingCondition;
  attrs: Record<string, unknown>;
  mediaIds: string[];
  state: string;
  lga?: string;
  escrowEligible?: boolean;
}

export interface UpdateListingInput {
  title?: string;
  description?: string;
  priceKobo?: number;
  attrs?: Record<string, unknown>;
}

// ─── Saved items / wishlist (Discover Saved Items screen) ────────────────────

/** A wishlist entry: the listing summary plus the price it was saved at, so the
 *  UI can flag a price change (§ Saved Items "price changed" badge). */
export interface SavedItem {
  listing: ListingSummary;
  savedPriceKobo: number;
  savedAt: string;
}
