// ── Marketplace — Sell mock fixtures + responders ────────────────────────────
//
// Powers MKT_USE_MOCK=true so the entire Sell group (screens 10–17) runs fully
// offline with no backend. Fixtures are authored in the same camelCase shape the
// shared client's deepCamel() would produce, so mock and live paths return
// identical types to the screens.
//
// This module OWNS the Sell slice of the mock world: a client-side listing store
// (create/update/submit/pause/resume/delete + mark-sold), an AI-prefill heuristic
// stand-in, category attribute schemas for the dynamic Attribute form, a
// fair-price estimator, boost tiers + a boost store, and a mock image presign.

import type {
  Boost,
  BoostQuote,
  BoostTier,
  Category,
  CreateListingInput,
  FairPriceBand,
  Listing,
  ListingCondition,
  ListingStatus,
  UpdateListingInput,
} from '../types';

export const mockDelay = (ms = 260) => new Promise<void>((r) => setTimeout(r, ms));

const now = () => new Date().toISOString();
const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

/** The signed-in seller id used to seed & filter "my listings" in mock mode. */
export const MOCK_SELF_SELLER_ID = 'seller_self';

// ─── Category attribute schemas (drive the dynamic Attribute form, screen 12) ─
// Live builds read these from GET /categories/:id. In mock mode we ship a small
// schema-per-category so the Attribute form has something to render. Shape mirrors
// a config-driven form: { fields: [{ key, label, type, required, options?, unit? }] }.

export interface AttributeFieldOption {
  value: string;
  label: string;
  /**
   * For a dependent field (see `dependsOnKey`): this option is only offered
   * when the parent field's current value equals `dependsOnValue`. Options
   * with no `dependsOnValue` are always offered.
   */
  dependsOnValue?: string;
}

export interface AttributeField {
  key: string;
  label: string;
  /**
   * Widget to render. 'enum' and 'bool' are legacy aliases of 'select' and
   * 'toggle' kept for backward compatibility with pre-existing fixtures/DB
   * rows — the dispatcher treats each pair identically.
   */
  type:
    | 'text'
    | 'number'
    | 'currency'
    | 'enum'
    | 'select'
    | 'multiselect'
    | 'radio'
    | 'segmented'
    | 'bool'
    | 'toggle'
    | 'stepper'
    | 'date'
    | 'color';
  required?: boolean;
  /** Surfaced on the search/filter UI when true. Purely descriptive to the client. */
  filterable?: boolean;
  /** Section heading this field renders under (e.g. "Specifications"). */
  group?: string;
  options?: AttributeFieldOption[];
  unit?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  /**
   * Marks this field as dependent on another field's value (e.g. Model
   * depends on Brand). The renderer filters `options` down to those whose
   * `dependsOnValue` matches the current value of the field named here, and
   * disables the control until the parent has a value.
   */
  dependsOnKey?: string;
}

export interface AttributeSchema {
  fields: AttributeField[];
}

const ATTRIBUTE_SCHEMAS: Record<string, AttributeSchema> = {
  cat_phones: {
    fields: [
      { key: 'brand', label: 'Brand', type: 'text', required: true, placeholder: 'e.g. Apple' },
      { key: 'model', label: 'Model', type: 'text', required: true, placeholder: 'e.g. iPhone 13 Pro Max' },
      {
        key: 'storage',
        label: 'Storage',
        type: 'enum',
        required: true,
        options: [
          { value: '64GB', label: '64GB' },
          { value: '128GB', label: '128GB' },
          { value: '256GB', label: '256GB' },
          { value: '512GB', label: '512GB' },
        ],
      },
      { key: 'color', label: 'Colour', type: 'text', required: false },
      { key: 'battery_health', label: 'Battery health', type: 'number', unit: '%', required: false },
    ],
  },
  cat_vehicles: {
    fields: [
      { key: 'make', label: 'Make', type: 'text', required: true, placeholder: 'e.g. Toyota' },
      { key: 'model', label: 'Model', type: 'text', required: true, placeholder: 'e.g. Corolla' },
      { key: 'year', label: 'Year', type: 'number', required: true, placeholder: 'e.g. 2015' },
      { key: 'mileage', label: 'Mileage', type: 'number', unit: 'km', required: true },
      {
        key: 'transmission',
        label: 'Transmission',
        type: 'enum',
        required: true,
        options: [
          { value: 'automatic', label: 'Automatic' },
          { value: 'manual', label: 'Manual' },
        ],
      },
      { key: 'vin', label: 'VIN', type: 'text', required: false },
    ],
  },
  cat_property: {
    fields: [
      {
        key: 'bedrooms',
        label: 'Bedrooms',
        type: 'enum',
        required: true,
        options: [
          { value: '1', label: '1' },
          { value: '2', label: '2' },
          { value: '3', label: '3' },
          { value: '4', label: '4+' },
        ],
      },
      {
        key: 'bathrooms',
        label: 'Bathrooms',
        type: 'enum',
        required: true,
        options: [
          { value: '1', label: '1' },
          { value: '2', label: '2' },
          { value: '3', label: '3+' },
        ],
      },
      {
        key: 'title_document',
        label: 'Title document',
        type: 'enum',
        required: true,
        options: [
          { value: 'c_of_o', label: 'C of O' },
          { value: 'deed', label: 'Deed of Assignment' },
          { value: 'governor_consent', label: "Governor's Consent" },
        ],
      },
      { key: 'furnished', label: 'Furnished', type: 'bool', required: false },
    ],
  },
  cat_gaming: {
    fields: [
      { key: 'platform', label: 'Platform', type: 'text', required: true, placeholder: 'e.g. PS5' },
      { key: 'storage', label: 'Storage', type: 'text', required: false },
    ],
  },
  cat_home: {
    fields: [
      { key: 'material', label: 'Material', type: 'text', required: false },
      { key: 'dimensions', label: 'Dimensions', type: 'text', required: false },
    ],
  },
  cat_fashion: {
    fields: [
      { key: 'size', label: 'Size', type: 'text', required: true },
      { key: 'brand', label: 'Brand', type: 'text', required: false },
    ],
  },
};

// The Category.attributeSchema field is typed as an open Record on the shared
// type; our AttributeSchema is a concrete shape. `asSchema` widens it for the
// literal so it satisfies Record<string, unknown> without losing our structure
// (AttributeFields.normalizeSchema narrows it back on the read side).
const asSchema = (s: AttributeSchema): Record<string, unknown> => s as unknown as Record<string, unknown>;

// Categories with attributeSchema attached — the sell-side view of GET /categories.
const SELL_CATEGORIES: Category[] = [
  { id: 'cat_phones', slug: 'phones', name: 'Phones & Tablets', parentId: null, icon: 'Smartphone', attributeSchema: asSchema(ATTRIBUTE_SCHEMAS.cat_phones), minPhotos: 3, minDescriptionWords: 8, riskTier: 1 },
  { id: 'cat_vehicles', slug: 'vehicles', name: 'Vehicles', parentId: null, icon: 'Car', attributeSchema: asSchema(ATTRIBUTE_SCHEMAS.cat_vehicles), minPhotos: 4, minDescriptionWords: 8, riskTier: 2 },
  { id: 'cat_property', slug: 'property', name: 'Property', parentId: null, icon: 'Home', attributeSchema: asSchema(ATTRIBUTE_SCHEMAS.cat_property), minPhotos: 4, minDescriptionWords: 12, riskTier: 2 },
  { id: 'cat_gaming', slug: 'gaming', name: 'Gaming', parentId: null, icon: 'Gamepad2', attributeSchema: asSchema(ATTRIBUTE_SCHEMAS.cat_gaming), minPhotos: 2, minDescriptionWords: 8, riskTier: 1 },
  { id: 'cat_home', slug: 'home', name: 'Home & Furniture', parentId: null, icon: 'Sofa', attributeSchema: asSchema(ATTRIBUTE_SCHEMAS.cat_home), minPhotos: 2, minDescriptionWords: 8, riskTier: 0 },
  { id: 'cat_fashion', slug: 'fashion', name: 'Fashion', parentId: null, icon: 'Shirt', attributeSchema: asSchema(ATTRIBUTE_SCHEMAS.cat_fashion), minPhotos: 2, minDescriptionWords: 8, riskTier: 0 },
];

// Categories that are escrow-eligible by default (drives the Price screen toggle).
const ESCROW_ELIGIBLE_CATEGORIES = new Set(['cat_phones', 'cat_gaming', 'cat_home', 'cat_fashion']);

export function mockIsEscrowEligibleCategory(categoryId: string | null | undefined): boolean {
  return !!categoryId && ESCROW_ELIGIBLE_CATEGORIES.has(categoryId);
}

export async function mockSellCategories(): Promise<Category[]> {
  await mockDelay(140);
  return SELL_CATEGORIES;
}

export async function mockSellCategory(id: string): Promise<Category> {
  await mockDelay(140);
  const c = SELL_CATEGORIES.find((x) => x.id === id);
  if (!c) throw Object.assign(new Error('Category not found'), { code: 'CATEGORY_NOT_FOUND', status: 404 });
  return c;
}

// ─── AI-prefill heuristic (client-side stand-in for the vision model) ─────────
// The real Smart Composer calls a server vision model on the first photo. Until
// that lands we mock it: derive a plausible category + title + attribute guesses
// from a tiny keyword table, keyed off the picked filename/uri when present, else
// fall back to a generic guess. Degrades to a "no confident guess" result so the
// composer can render a blank form (spec: AI failure never blocks listing).

export interface AiPrefillResult {
  categoryId: string | null;
  categoryName: string | null;
  suggestedTitle: string;
  suggestedCondition: ListingCondition;
  suggestedAttrs: Record<string, unknown>;
  confidence: number;
}

const AI_KEYWORD_MAP: Array<{ match: RegExp; categoryId: string; title: string; attrs: Record<string, unknown> }> = [
  { match: /iphone|samsung|phone|tecno|infinix|pixel/i, categoryId: 'cat_phones', title: 'Smartphone — describe model & storage', attrs: { brand: '' } },
  { match: /car|toyota|honda|benz|lexus|vehicle|corolla/i, categoryId: 'cat_vehicles', title: 'Vehicle — add make, model & year', attrs: { make: '' } },
  { match: /apartment|flat|house|land|property|duplex/i, categoryId: 'cat_property', title: 'Property listing — add bedrooms & title', attrs: {} },
  { match: /ps5|xbox|console|gaming|nintendo/i, categoryId: 'cat_gaming', title: 'Gaming console / accessory', attrs: {} },
  { match: /sofa|chair|table|furniture|bed/i, categoryId: 'cat_home', title: 'Home furniture item', attrs: {} },
  { match: /shirt|dress|shoe|bag|fashion|sneaker/i, categoryId: 'cat_fashion', title: 'Fashion item — add size', attrs: {} },
];

/**
 * Heuristic AI prefill. `hint` is the first photo's uri/filename (may be empty).
 * Simulates a ~10% "model timeout" so the composer's graceful-degradation path
 * is exercised in mock mode too — the caller catches and renders a blank form.
 */
export async function mockAiPrefill(hint: string): Promise<AiPrefillResult> {
  await mockDelay(600);
  // Simulated occasional model timeout → the composer degrades to a blank form.
  if (Math.random() < 0.1) {
    throw Object.assign(new Error('AI classification timed out'), { code: 'AI_PREFILL_TIMEOUT' });
  }
  const hit = AI_KEYWORD_MAP.find((k) => k.match.test(hint));
  const cat = hit ? SELL_CATEGORIES.find((c) => c.id === hit.categoryId) : SELL_CATEGORIES[0];
  return {
    categoryId: cat?.id ?? null,
    categoryName: cat?.name ?? null,
    suggestedTitle: hit?.title ?? 'New listing — add a clear title',
    suggestedCondition: 'used',
    suggestedAttrs: hit?.attrs ?? {},
    confidence: hit ? 0.72 : 0.35,
  };
}

// ─── Fair-price estimate (client stand-in for the server comps band) ──────────
// Live: FairPriceBand comes from the category/listing read model. Mock: a small
// per-category baseline widened ±25% so the Price screen always has a band.

const CATEGORY_MEDIAN_KOBO: Record<string, number> = {
  cat_phones: 45_000_000,
  cat_vehicles: 750_000_000,
  cat_property: 3_500_000_000,
  cat_gaming: 28_000_000,
  cat_home: 12_000_000,
  cat_fashion: 3_500_000,
};

export function mockFairPriceBand(categoryId: string | null | undefined): FairPriceBand | null {
  if (!categoryId) return null;
  const median = CATEGORY_MEDIAN_KOBO[categoryId];
  if (!median) return null;
  return {
    p25Kobo: Math.round(median * 0.78),
    p50Kobo: median,
    p75Kobo: Math.round(median * 1.28),
  };
}

// ─── Listing store (create / update / submit / lifecycle / mark-sold) ─────────

let listingSeq = 100;
const listingStore = new Map<string, Listing>();

function seedMyListings() {
  if (listingStore.size) return;
  const base: Partial<Listing> = {
    marketId: 'NG',
    sellerId: MOCK_SELF_SELLER_ID,
    currency: 'NGN',
    attrs: {},
    similarListingIds: [],
    qualityScore: 0.8,
  };
  const seeds: Listing[] = [
    {
      ...(base as Listing),
      id: 'lst_self_live',
      categoryId: 'cat_phones',
      category: { id: 'cat_phones', name: 'Phones & Tablets', slug: 'phones' },
      title: 'iPhone 12 — 128GB Blue (clean)',
      description: 'Neat UK-used iPhone 12, 128GB, battery health 91%. No scratches, comes with charger.',
      priceKobo: 38_500_000,
      condition: 'foreign_used',
      media: [{ id: 'sm1', urlThumb: '', urlCard: '', urlFull: '', blurhash: 'L6Pj0^jE.AyE_3t7t7R**0o#DgR4', sortOrder: 0 }],
      status: 'active',
      escrowEligible: true,
      fairPriceBand: mockFairPriceBand('cat_phones'),
      state: 'Lagos',
      lga: 'Ikeja',
      viewCount: 128,
      saveCount: 9,
      createdAt: daysAgo(3),
      updatedAt: daysAgo(1),
      expiresAt: daysFromNow(27),
    },
    {
      ...(base as Listing),
      id: 'lst_self_pending',
      categoryId: 'cat_home',
      category: { id: 'cat_home', name: 'Home & Furniture', slug: 'home' },
      title: 'Grey 3-seater fabric sofa',
      description: 'Comfortable 3-seater fabric sofa, barely used, from a smoke-free home.',
      priceKobo: 9_500_000,
      condition: 'used',
      media: [{ id: 'sm2', urlThumb: '', urlCard: '', urlFull: '', blurhash: 'L6Pj0^jE.AyE_3t7t7R**0o#DgR4', sortOrder: 0 }],
      status: 'pending_review',
      escrowEligible: true,
      fairPriceBand: mockFairPriceBand('cat_home'),
      state: 'Lagos',
      lga: 'Lekki',
      viewCount: 4,
      saveCount: 0,
      createdAt: daysAgo(0),
      updatedAt: daysAgo(0),
      expiresAt: daysFromNow(30),
    },
    {
      ...(base as Listing),
      id: 'lst_self_paused',
      categoryId: 'cat_gaming',
      category: { id: 'cat_gaming', name: 'Gaming', slug: 'gaming' },
      title: 'PS5 Disc Edition + 2 pads',
      description: 'PS5 disc edition with two controllers and three games. Working perfectly.',
      priceKobo: 42_000_000,
      condition: 'used',
      media: [{ id: 'sm3', urlThumb: '', urlCard: '', urlFull: '', blurhash: 'L6Pj0^jE.AyE_3t7t7R**0o#DgR4', sortOrder: 0 }],
      status: 'paused',
      escrowEligible: true,
      fairPriceBand: mockFairPriceBand('cat_gaming'),
      state: 'Lagos',
      viewCount: 210,
      saveCount: 18,
      createdAt: daysAgo(10),
      updatedAt: daysAgo(4),
      expiresAt: daysFromNow(20),
    },
  ];
  for (const s of seeds) listingStore.set(s.id, s);
}

function newListingId(): string {
  listingSeq += 1;
  return `lst_self_${listingSeq}`;
}

export async function mockCreateListing(input: CreateListingInput): Promise<Listing> {
  await mockDelay(320);
  seedMyListings();
  const id = newListingId();
  const cat = SELL_CATEGORIES.find((c) => c.id === input.categoryId);
  const listing: Listing = {
    id,
    marketId: 'NG',
    sellerId: MOCK_SELF_SELLER_ID,
    categoryId: input.categoryId,
    category: cat ? { id: cat.id, name: cat.name, slug: cat.slug } : undefined,
    title: input.title,
    description: input.description,
    priceKobo: input.priceKobo,
    currency: 'NGN',
    condition: input.condition,
    attrs: input.attrs ?? {},
    media: (input.mediaIds ?? []).map((mid, i) => ({ id: mid, urlThumb: mid, urlCard: mid, urlFull: mid, blurhash: '', sortOrder: i })),
    status: 'draft',
    qualityScore: 0.8,
    escrowEligible: input.escrowEligible ?? mockIsEscrowEligibleCategory(input.categoryId),
    fairPriceBand: mockFairPriceBand(input.categoryId),
    state: input.state,
    lga: input.lga,
    viewCount: 0,
    saveCount: 0,
    similarListingIds: [],
    createdAt: now(),
    updatedAt: now(),
    expiresAt: daysFromNow(30),
  };
  listingStore.set(id, listing);
  return listing;
}

export async function mockUpdateListing(id: string, input: UpdateListingInput): Promise<Listing> {
  await mockDelay(220);
  const existing = listingStore.get(id);
  if (!existing) throw Object.assign(new Error('Listing not found'), { code: 'LISTING_NOT_FOUND', status: 404 });
  const next: Listing = {
    ...existing,
    title: input.title ?? existing.title,
    description: input.description ?? existing.description,
    priceKobo: input.priceKobo ?? existing.priceKobo,
    attrs: input.attrs ?? existing.attrs,
    updatedAt: now(),
  };
  listingStore.set(id, next);
  return next;
}

/** Submit a draft → moderation. Auto-approve low-risk categories to 'active'. */
export async function mockSubmitListing(id: string): Promise<Listing> {
  await mockDelay(420);
  const existing = listingStore.get(id);
  if (!existing) throw Object.assign(new Error('Listing not found'), { code: 'LISTING_NOT_FOUND', status: 404 });
  const cat = SELL_CATEGORIES.find((c) => c.id === existing.categoryId);
  const autoApprove = (cat?.riskTier ?? 0) <= 1;
  const status: ListingStatus = autoApprove ? 'active' : 'pending_review';
  const next: Listing = { ...existing, status, updatedAt: now() };
  listingStore.set(id, next);
  return next;
}

export async function mockGetListing(id: string): Promise<Listing> {
  await mockDelay(160);
  seedMyListings();
  const l = listingStore.get(id);
  if (!l) throw Object.assign(new Error('Listing not found'), { code: 'LISTING_NOT_FOUND', status: 404 });
  return l;
}

async function transitionStatus(id: string, status: ListingStatus, extra?: Partial<Listing>): Promise<Listing> {
  await mockDelay(220);
  const existing = listingStore.get(id);
  if (!existing) throw Object.assign(new Error('Listing not found'), { code: 'LISTING_NOT_FOUND', status: 404 });
  const next: Listing = { ...existing, status, updatedAt: now(), ...extra };
  listingStore.set(id, next);
  return next;
}

export const mockPauseListing = (id: string) => transitionStatus(id, 'paused');
export const mockResumeListing = (id: string) => transitionStatus(id, 'active');
export const mockRenewListing = (id: string) => transitionStatus(id, 'active', { expiresAt: daysFromNow(30) });
export const mockMarkSold = (id: string) => transitionStatus(id, 'sold', { soldAt: now() });

export async function mockDeleteListing(id: string): Promise<{ ok: boolean }> {
  await mockDelay(200);
  listingStore.delete(id);
  return { ok: true };
}

export async function mockMyListings(): Promise<Listing[]> {
  await mockDelay(200);
  seedMyListings();
  return Array.from(listingStore.values())
    .filter((l) => l.sellerId === MOCK_SELF_SELLER_ID)
    .sort((a, b) => (b.createdAt < a.createdAt ? -1 : 1));
}

// ─── Image presign (mock) ─────────────────────────────────────────────────────
// The real presign endpoint (POST /listings/media/presign) is being added by
// another agent; contract assumed: { uploadUrl, fileUrl }. Mock returns a
// mock:// uploadUrl so the client PUT is skipped and the flow round-trips offline.

export async function mockPresignMedia(input: { fileName: string; mimeType: string }): Promise<{ uploadUrl: string; fileUrl: string }> {
  await mockDelay(160);
  const key = `marketplace/listings/${Date.now()}-${input.fileName}`;
  return { uploadUrl: `mock://r2/${key}`, fileUrl: key };
}

// ─── Boosts ───────────────────────────────────────────────────────────────────

const BOOST_TIERS: BoostTier[] = [
  { tier: 'spotlight_3d', durationDays: 3, priceKobo: 50_000, weight: 1.0, label: 'Spotlight — 3 days', description: 'Top of category results and a highlighted card for 3 days.' },
  { tier: 'spotlight_7d', durationDays: 7, priceKobo: 100_000, weight: 2.0, label: 'Spotlight — 7 days', description: 'A full week of premium placement — best value for fast-moving items.' },
  { tier: 'premium_14d', durationDays: 14, priceKobo: 180_000, weight: 3.0, label: 'Premium — 14 days', description: 'Two weeks across category, search, and the "Near you" home rail.' },
];

// Mirrors the real backend's seeded default (mkt_boost_daily_rate: ₦100/day).
const MOCK_BOOST_DAILY_RATE_KOBO = 10_000;
const MOCK_BASE_BOOST_WEIGHT = 1.0;

const boostStore = new Map<string, Boost>();

export async function mockBoostTiers(): Promise<BoostTier[]> {
  await mockDelay(140);
  return BOOST_TIERS;
}

// Mirrors the real ComputeBoostQuote: package mode looks up the tier;
// custom mode rounds the [now, endsAt) range up to whole days and prices at
// the flat daily rate — so the mock quote and the mock purchase always agree,
// same as the real endpoint and PurchaseBoost share one computation.
export async function mockBoostQuote(params: { tier?: string; endsAt?: string }): Promise<BoostQuote> {
  await mockDelay(120);
  const startsAt = now();
  if (params.tier) {
    const t = BOOST_TIERS.find((x) => x.tier === params.tier);
    if (!t) throw Object.assign(new Error('Unknown boost tier'), { code: 'INVALID_BOOST_TIER', status: 400 });
    return { mode: 'package', tier: t.tier, durationDays: t.durationDays, priceKobo: t.priceKobo, weight: t.weight, startsAt, endsAt: daysFromNow(t.durationDays) };
  }
  if (!params.endsAt) throw Object.assign(new Error('tier or endsAt is required'), { code: 'SCHEMA_VALIDATION_FAILED', status: 400 });
  const days = customBoostDaysFor(params.endsAt);
  return { mode: 'custom', durationDays: days, priceKobo: days * MOCK_BOOST_DAILY_RATE_KOBO, weight: MOCK_BASE_BOOST_WEIGHT, startsAt, endsAt: params.endsAt };
}

function customBoostDaysFor(endsAtIso: string): number {
  const ms = new Date(endsAtIso).getTime() - Date.now();
  return Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export async function mockCreateBoost(listingId: string, tier?: string, endsAt?: string): Promise<Boost> {
  await mockDelay(420);
  const id = `bst_${Date.now()}`;
  // Simulate an occasional reason-coded rejection → instant auto-refund, so the
  // Boost status screen's rejection/refund branch is exercisable in mock mode.
  const rejected = /reject/i.test(listingId);

  let boostTier: string, durationDays: number, priceKobo: number, weight: number;
  if (tier) {
    const t = BOOST_TIERS.find((x) => x.tier === tier);
    if (!t) throw Object.assign(new Error('Unknown boost tier'), { code: 'BOOST_TIER_NOT_FOUND', status: 404 });
    boostTier = t.tier; durationDays = t.durationDays; priceKobo = t.priceKobo; weight = t.weight;
  } else if (endsAt) {
    boostTier = 'custom';
    durationDays = customBoostDaysFor(endsAt);
    priceKobo = durationDays * MOCK_BOOST_DAILY_RATE_KOBO;
    weight = MOCK_BASE_BOOST_WEIGHT;
  } else {
    throw Object.assign(new Error('tier or endsAt is required'), { code: 'SCHEMA_VALIDATION_FAILED', status: 400 });
  }

  const boost: Boost = {
    id,
    listingId,
    sellerId: MOCK_SELF_SELLER_ID,
    tier: boostTier,
    durationDays,
    priceKobo,
    weight,
    status: rejected ? 'rejected_with_reason' : 'active',
    rejectionReasonCode: rejected ? 'listing_quality_below_threshold' : null,
    startsAt: rejected ? null : now(),
    endsAt: rejected ? null : (endsAt ?? daysFromNow(durationDays)),
    createdAt: now(),
  };
  boostStore.set(id, boost);
  return boost;
}

export async function mockGetBoost(id: string): Promise<Boost> {
  await mockDelay(160);
  const b = boostStore.get(id);
  if (!b) throw Object.assign(new Error('Boost not found'), { code: 'BOOST_NOT_FOUND', status: 404 });
  return b;
}
