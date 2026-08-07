// ── Marketplace — Discovery mock fixtures + mock responders ──────────────────
//
// Powers MKT_USE_MOCK=true so the entire Discover group (screens 1–9) runs fully
// offline, with no backend, in camelCase (fixtures are authored in the same
// camelCase shape the client's deepCamel() would produce, so mock and live paths
// return identical types to the screens). Also used as the offline-cache seed and
// as the graceful fallback when GET /search returns 501 SEARCH_NOT_WIRED.

import type {
  Category,
  Listing,
  ListingSummary,
  SavedItem,
  SavedSearch,
  SearchParams,
  SearchResponse,
  SearchSuggestion,
  SellerProfile,
  SellerSummary,
  Review,
} from '../types';

export const mockDelay = (ms = 260) => new Promise<void>((r) => setTimeout(r, ms));

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

const SELLER: SellerSummary = {
  id: 'seller_1',
  name: 'Bisi Adeyemi',
  trustScore: 0.86,
  verifiedIdBadge: true,
  verifiedBusinessBadge: false,
  tenureLabel: 'Member since 2023',
  responseTimeMinutes: 12,
  kycTier: 'tier2_sell',
};

const SELLER_2: SellerSummary = {
  id: 'seller_2',
  name: 'TechHub NG',
  trustScore: 0.94,
  verifiedIdBadge: true,
  verifiedBusinessBadge: true,
  tenureLabel: 'Member since 2021',
  responseTimeMinutes: 5,
  kycTier: 'tier3_business',
};

export const MOCK_LISTINGS: Listing[] = [
  {
    id: 'lst_iphone',
    marketId: 'NG',
    sellerId: SELLER.id,
    seller: SELLER,
    categoryId: 'cat_phones',
    category: { id: 'cat_phones', name: 'Phones & Tablets', slug: 'phones' },
    title: 'iPhone 13 Pro Max — 256GB Sierra Blue',
    description:
      'Clean US-used iPhone 13 Pro Max, 256GB, battery health 89%. No cracks, no repairs. Comes with box and original cable.',
    priceKobo: 65_000_000,
    condition: 'foreign_used',
    attrs: { storage: '256GB', color: 'Sierra Blue', battery_health: '89%' },
    media: [
      { id: 'm1', urlThumb: '', urlCard: '', urlFull: '', blurhash: 'L6Pj0^jE.AyE_3t7t7R**0o#DgR4', sortOrder: 0 },
      { id: 'm2', urlThumb: '', urlCard: '', urlFull: '', blurhash: 'L6Pj0^jE.AyE_3t7t7R**0o#DgR4', sortOrder: 1 },
      { id: 'm3', urlThumb: '', urlCard: '', urlFull: '', blurhash: 'L6Pj0^jE.AyE_3t7t7R**0o#DgR4', sortOrder: 2 },
    ],
    status: 'active',
    qualityScore: 0.82,
    escrowEligible: true,
    fairPriceBand: { p25Kobo: 58_000_000, p50Kobo: 64_000_000, p75Kobo: 71_000_000 },
    state: 'Lagos',
    lga: 'Ikeja',
    viewCount: 342,
    saveCount: 21,
    savedByMe: false,
    similarListingIds: ['lst_ps5', 'lst_macbook'],
    createdAt: daysAgo(2),
    updatedAt: daysAgo(1),
  },
  {
    id: 'lst_ps5',
    marketId: 'NG',
    sellerId: SELLER.id,
    seller: SELLER,
    categoryId: 'cat_gaming',
    category: { id: 'cat_gaming', name: 'Gaming', slug: 'gaming' },
    title: 'PlayStation 5 Disc Edition + 2 Controllers',
    description: 'Boxed PS5 disc edition, barely used, comes with two controllers and three games.',
    priceKobo: 55_000_000,
    condition: 'used',
    attrs: { edition: 'disc' },
    media: [{ id: 'm4', urlThumb: '', urlCard: '', urlFull: '', blurhash: 'L5H2EC=PM+yV0g-mq.wG9c010J}I', sortOrder: 0 }],
    status: 'active',
    qualityScore: 0.7,
    escrowEligible: true,
    fairPriceBand: { p25Kobo: 48_000_000, p50Kobo: 54_000_000, p75Kobo: 60_000_000 },
    state: 'Abuja',
    lga: 'Garki',
    viewCount: 128,
    saveCount: 9,
    savedByMe: true,
    similarListingIds: ['lst_iphone'],
    createdAt: daysAgo(5),
    updatedAt: daysAgo(4),
  },
  {
    id: 'lst_macbook',
    marketId: 'NG',
    sellerId: SELLER_2.id,
    seller: SELLER_2,
    categoryId: 'cat_phones',
    category: { id: 'cat_phones', name: 'Phones & Tablets', slug: 'phones' },
    title: 'MacBook Air M2 — 8GB / 256GB',
    description: 'Sealed MacBook Air M2, 1-year Apple warranty, comes with receipt.',
    priceKobo: 98_000_000,
    condition: 'new',
    attrs: { chip: 'M2', ram: '8GB', storage: '256GB' },
    media: [{ id: 'm5', urlThumb: '', urlCard: '', urlFull: '', blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj', sortOrder: 0 }],
    status: 'active',
    qualityScore: 0.9,
    escrowEligible: true,
    fairPriceBand: { p25Kobo: 92_000_000, p50Kobo: 98_000_000, p75Kobo: 105_000_000 },
    state: 'Lagos',
    lga: 'Lekki',
    viewCount: 501,
    saveCount: 44,
    savedByMe: false,
    similarListingIds: ['lst_iphone'],
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
  },
  {
    id: 'lst_sold',
    marketId: 'NG',
    sellerId: SELLER.id,
    seller: SELLER,
    categoryId: 'cat_home',
    category: { id: 'cat_home', name: 'Home & Furniture', slug: 'home' },
    title: 'Standing desk — electric (SOLD FIXTURE)',
    description: 'Used to demonstrate the listing-sold banner state on Listing Detail.',
    priceKobo: 12_000_000,
    condition: 'refurbished',
    attrs: {},
    media: [],
    status: 'sold',
    qualityScore: 0.5,
    escrowEligible: false,
    fairPriceBand: null,
    state: 'Lagos',
    lga: 'Yaba',
    viewCount: 74,
    saveCount: 3,
    savedByMe: false,
    similarListingIds: [],
    createdAt: daysAgo(20),
    updatedAt: daysAgo(3),
    soldAt: daysAgo(3),
  },
];

export const MOCK_CATEGORIES: Category[] = [
  { id: 'cat_phones', slug: 'phones', name: 'Phones & Tablets', parentId: null, icon: 'Smartphone', attributeSchema: {}, minPhotos: 3, minDescriptionWords: 8, quickFilters: [
    { key: 'storage', label: 'Storage', type: 'enum', options: [{ value: '64GB', label: '64GB' }, { value: '128GB', label: '128GB' }, { value: '256GB', label: '256GB' }] },
    { key: 'condition', label: 'Condition', type: 'enum', options: [{ value: 'new', label: 'New' }, { value: 'foreign_used', label: 'Foreign used' }] },
  ] },
  { id: 'cat_vehicles', slug: 'vehicles', name: 'Vehicles', parentId: null, icon: 'Car', attributeSchema: {}, minPhotos: 4, minDescriptionWords: 8, quickFilters: [
    { key: 'make', label: 'Make', type: 'enum', options: [{ value: 'toyota', label: 'Toyota' }, { value: 'honda', label: 'Honda' }] },
    { key: 'year_min', label: 'Year', type: 'range' },
    { key: 'mileage_max', label: 'Mileage', type: 'range' },
  ] },
  { id: 'cat_property', slug: 'property', name: 'Property', parentId: null, icon: 'Home', attributeSchema: {}, minPhotos: 4, minDescriptionWords: 12, quickFilters: [
    { key: 'bedrooms', label: 'Bedrooms', type: 'enum', options: [{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3+' }] },
    { key: 'title_document', label: 'Title', type: 'enum', options: [{ value: 'c_of_o', label: 'C of O' }, { value: 'deed', label: 'Deed' }] },
  ] },
  { id: 'cat_gaming', slug: 'gaming', name: 'Gaming', parentId: null, icon: 'Gamepad2', attributeSchema: {}, minPhotos: 2, minDescriptionWords: 8 },
  { id: 'cat_home', slug: 'home', name: 'Home & Furniture', parentId: null, icon: 'Sofa', attributeSchema: {}, minPhotos: 2, minDescriptionWords: 8 },
  { id: 'cat_fashion', slug: 'fashion', name: 'Fashion', parentId: null, icon: 'Shirt', attributeSchema: {}, minPhotos: 2, minDescriptionWords: 8 },
];

export function toSummary(l: Listing, boosted = false): ListingSummary {
  const media = l.media ?? [];
  return {
    id: l.id,
    title: l.title,
    priceKobo: l.priceKobo,
    condition: l.condition,
    thumbUrl: media[0]?.urlThumb ?? '',
    blurhash: media[0]?.blurhash ?? '',
    state: l.state,
    lga: l.lga,
    sellerTrustScore: l.seller?.trustScore ?? 0,
    escrowEligible: l.escrowEligible,
    boosted,
    fairPriceBand: l.fairPriceBand,
    lat: undefined,
    lng: undefined,
    createdAt: l.createdAt,
  };
}

const TRENDING = ['iPhone 13', 'PlayStation 5', 'Toyota Corolla', '2 bedroom flat Lekki', 'MacBook'];

// ── Mock responders (mirror the live API surface) ────────────────────────────

export async function mockSearch(params: SearchParams): Promise<SearchResponse> {
  await mockDelay();
  const q = (params.q ?? '').trim().toLowerCase();
  let results = MOCK_LISTINGS.filter((l) => l.status === 'active');
  if (q) results = results.filter((l) => l.title.toLowerCase().includes(q) || l.description.toLowerCase().includes(q));
  if (params.categoryId) results = results.filter((l) => l.categoryId === params.categoryId);
  if (params.condition) results = results.filter((l) => l.condition === params.condition);
  if (params.priceMin != null) results = results.filter((l) => l.priceKobo >= params.priceMin!);
  if (params.priceMax != null) results = results.filter((l) => l.priceKobo <= params.priceMax!);
  if (params.escrowEligibleOnly) results = results.filter((l) => l.escrowEligible);
  if (params.verifiedSellerOnly) results = results.filter((l) => l.seller?.verifiedIdBadge);
  if (params.state) results = results.filter((l) => l.state === params.state);

  const sort = params.sort ?? 'trusted_first';
  results = [...results].sort((a, b) => {
    switch (sort) {
      case 'price_asc': return a.priceKobo - b.priceKobo;
      case 'price_desc': return b.priceKobo - a.priceKobo;
      case 'newest': return b.createdAt.localeCompare(a.createdAt);
      case 'trusted_first':
      case 'relevance':
      default: return (b.seller?.trustScore ?? 0) - (a.seller?.trustScore ?? 0);
    }
  });

  return {
    results: results.map((l) => toSummary(l, l.id === 'lst_macbook')),
    facets: {
      categories: MOCK_CATEGORIES.map((c) => ({ id: c.id, name: c.name, count: MOCK_LISTINGS.filter((l) => l.categoryId === c.id && l.status === 'active').length })),
      conditions: [
        { value: 'new', count: MOCK_LISTINGS.filter((l) => l.condition === 'new').length },
        { value: 'foreign_used', count: MOCK_LISTINGS.filter((l) => l.condition === 'foreign_used').length },
        { value: 'used', count: MOCK_LISTINGS.filter((l) => l.condition === 'used').length },
      ],
      priceRanges: [
        { minKobo: 0, maxKobo: 50_000_000, count: MOCK_LISTINGS.filter((l) => l.priceKobo < 50_000_000).length },
        { minKobo: 50_000_000, maxKobo: 100_000_000, count: MOCK_LISTINGS.filter((l) => l.priceKobo >= 50_000_000).length },
      ],
    },
    nextCursor: null,
    tookMs: 42,
  };
}

export async function mockSuggest(q: string): Promise<SearchSuggestion[]> {
  await mockDelay(120);
  const query = q.trim().toLowerCase();
  if (!query) return [];
  const listingMatches: SearchSuggestion[] = MOCK_LISTINGS
    .filter((l) => l.status === 'active' && l.title.toLowerCase().includes(query))
    .slice(0, 5)
    .map((l) => ({ type: 'query', text: l.title }));
  const catMatches: SearchSuggestion[] = MOCK_CATEGORIES
    .filter((c) => c.name.toLowerCase().includes(query))
    .slice(0, 3)
    .map((c) => ({ type: 'category', text: c.name, categoryId: c.id }));
  return [...catMatches, ...listingMatches];
}

export async function mockTrending(): Promise<string[]> {
  await mockDelay(80);
  return TRENDING;
}

export async function mockGetListing(id: string): Promise<Listing> {
  await mockDelay();
  const l = MOCK_LISTINGS.find((x) => x.id === id);
  if (!l) throw Object.assign(new Error('Listing not found'), { code: 'LISTING_NOT_FOUND', status: 404 });
  return l;
}

export async function mockCategories(): Promise<Category[]> {
  await mockDelay(140);
  return MOCK_CATEGORIES;
}

export async function mockGetCategory(id: string): Promise<Category> {
  await mockDelay(140);
  const c = MOCK_CATEGORIES.find((x) => x.id === id);
  if (!c) throw Object.assign(new Error('Category not found'), { code: 'CATEGORY_NOT_FOUND', status: 404 });
  return c;
}

export async function mockHomeRails(): Promise<{ nearYou: ListingSummary[]; priceDrops: ListingSummary[]; escrowEligible: ListingSummary[] }> {
  await mockDelay();
  const active = MOCK_LISTINGS.filter((l) => l.status === 'active');
  return {
    nearYou: active.map((l) => toSummary(l)),
    priceDrops: active.filter((l) => l.id === 'lst_ps5').map((l) => toSummary(l)),
    escrowEligible: active.filter((l) => l.escrowEligible).map((l) => toSummary(l, l.id === 'lst_macbook')),
  };
}

export async function mockSellerProfile(id: string): Promise<SellerProfile> {
  await mockDelay();
  const s = MOCK_LISTINGS.find((l) => l.seller?.id === id)?.seller ?? SELLER;
  return {
    id,
    name: s.name,
    trustScore: s.trustScore,
    verifiedIdBadge: s.verifiedIdBadge,
    verifiedBusinessBadge: s.verifiedBusinessBadge,
    tenureLabel: s.tenureLabel,
    memberSince: '2023-01-01',
    responseTimeMinutes: s.responseTimeMinutes,
    responseRate: 0.92,
    completedEscrowCount: id === 'seller_2' ? 210 : 47,
    disputeCount: id === 'seller_2' ? 2 : 1,
    kycTier: s.kycTier ?? 'tier2_sell',
  };
}

export async function mockSellerListings(id: string): Promise<ListingSummary[]> {
  await mockDelay();
  return MOCK_LISTINGS.filter((l) => l.seller?.id === id && l.status === 'active').map((l) => toSummary(l));
}

export async function mockSellerReviews(id: string): Promise<Review[]> {
  await mockDelay();
  // seller_2 is a brand-new-review-less seller in the fixtures to exercise the
  // "New seller — 0 completed orders" state without hiding the section.
  if (id === 'seller_2') return [];
  return [
    { id: 'rev_1', dealId: 'deal_old_1', reviewerId: 'buyer_a', reviewerName: 'Chidi O.', rating: 5, comment: 'Smooth meetup, item exactly as described.', tags: ['as_described', 'smooth_meetup'], sellerReply: 'Thank you!', isPlaceholder: false, createdAt: daysAgo(14) },
    { id: 'rev_2', dealId: 'deal_old_2', reviewerId: 'buyer_b', reviewerName: 'Amaka N.', rating: 4, comment: null, tags: ['good_communication'], sellerReply: null, isPlaceholder: false, createdAt: daysAgo(30) },
  ];
}

export async function mockSavedItems(): Promise<SavedItem[]> {
  await mockDelay();
  // A saved PS5 whose price dropped since save → drives the "price changed" badge.
  const ps5 = MOCK_LISTINGS.find((l) => l.id === 'lst_ps5')!;
  const iphone = MOCK_LISTINGS.find((l) => l.id === 'lst_iphone')!;
  return [
    { listing: toSummary(ps5), savedPriceKobo: 60_000_000, savedAt: daysAgo(6) },
    { listing: toSummary(iphone), savedPriceKobo: 65_000_000, savedAt: daysAgo(3) },
  ];
}

let MOCK_SAVED_SEARCHES: SavedSearch[] = [
  { id: 'ss_1', query: 'iPhone 13', filters: { categoryId: 'cat_phones', priceMax: 70_000_000 }, alertEnabled: true, alertFrequency: 'instant', createdAt: daysAgo(4) },
  { id: 'ss_2', query: null, filters: { categoryId: 'cat_property', state: 'Lagos' }, alertEnabled: false, alertFrequency: 'off', createdAt: daysAgo(10) },
];

export async function mockListSavedSearches(): Promise<SavedSearch[]> {
  await mockDelay();
  return [...MOCK_SAVED_SEARCHES];
}

export async function mockCreateSavedSearch(query: string | undefined, filters: Record<string, unknown>): Promise<SavedSearch> {
  await mockDelay();
  const ss: SavedSearch = { id: `ss_${Date.now()}`, query: query ?? null, filters, alertEnabled: true, alertFrequency: 'instant', createdAt: new Date().toISOString() };
  MOCK_SAVED_SEARCHES = [ss, ...MOCK_SAVED_SEARCHES];
  return ss;
}

export async function mockDeleteSavedSearch(id: string): Promise<{ ok: boolean }> {
  await mockDelay(120);
  MOCK_SAVED_SEARCHES = MOCK_SAVED_SEARCHES.filter((s) => s.id !== id);
  return { ok: true };
}

export async function mockToggleSavedSearch(id: string, alertEnabled: boolean, frequency?: 'instant' | 'daily' | 'off'): Promise<SavedSearch> {
  await mockDelay(120);
  MOCK_SAVED_SEARCHES = MOCK_SAVED_SEARCHES.map((s) =>
    s.id === id ? { ...s, alertEnabled, alertFrequency: frequency ?? (alertEnabled ? 'instant' : 'off') } : s,
  );
  return MOCK_SAVED_SEARCHES.find((s) => s.id === id)!;
}
