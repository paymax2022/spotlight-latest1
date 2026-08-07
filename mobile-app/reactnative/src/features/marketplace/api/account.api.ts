// ── Marketplace — Trust & Account API (mock/live dispatch) ───────────────────
//
// Data layer for the Account tab (§ Mobile-UX-Flows.md 28–34): media presign,
// reports, blocks, notification preferences, meetup safe-spots. Every function
// switches on MKT_USE_MOCK:
//   • mock → in-file fixtures/in-memory store (offline, camelCase already)
//   • live → the shared client (mktGet/mktPost/…) which normalizes snake↔camel.
//
// This file imports ONLY the foundation client (does NOT modify it, Discover,
// Sell, or Transact). Account-specific types are declared here because the
// foundation types.ts (frozen) does not carry them.

import { MKT_USE_MOCK, mktGet, mktPost, mktPatch, mktDelete, arr } from './client';
import type { Listing } from '../types';

// ─── Account-domain types (camelCase; mirror the Go snake_case wire) ─────────

export type ReportTargetType = 'listing' | 'seller' | 'chat';

export interface Report {
  id: string;
  reporterId: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  evidenceUrl?: string | null;
  note?: string | null;
  status: string;
  createdAt: string;
}

export interface CreateReportInput {
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  evidenceUrl?: string;
  note?: string;
}

export interface Block {
  id: string;
  userId: string;
  blockedUserId: string;
  createdAt: string;
  /** display-only, joined client-side in mock; live builds may enrich later. */
  blockedUserName?: string;
}

/** Per-category notification toggles (§33). */
export interface NotificationPrefs {
  newOffer: boolean;
  priceDrop: boolean;
  orderStatus: boolean;
  boostExpiry: boolean;
  promotional: boolean;
  userId?: string;
  updatedAt?: string;
}

export type NotificationPrefsPatch = Partial<
  Pick<NotificationPrefs, 'newOffer' | 'priceDrop' | 'orderStatus' | 'boostExpiry' | 'promotional'>
>;

/** A curated verified-safe meetup location (§27). */
export interface SafeSpot {
  id: string;
  name: string;
  kind: 'police_station' | 'bank_branch' | 'mall' | 'public_landmark' | string;
  address: string;
  state: string;
  lga: string;
  lat: number;
  lng: number;
  verified: boolean;
}

/** A wishlist entry joined to its current listing (§8 Saved Items). */
export interface SavedItem {
  id: string;
  userId: string;
  listingId: string;
  savedPriceKobo: number;
  createdAt: string;
  listing?: Listing;
}

/** Presigned listing-media upload envelope. */
export interface MediaPresign {
  uploadUrl: string;
  fileUrl: string;
  objectKey: string;
  bucket: string;
  mimeType: string;
  expiresIn: number;
  method: string;
}

// ─── Mock in-memory stores (process-lived; reset on reload) ──────────────────

const MOCK_ME = 'me';

let mockBlocks: Block[] = [
  { id: 'blk-1', userId: MOCK_ME, blockedUserId: 'seller_9', blockedUserName: 'FastDeals NG', createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString() },
];

let mockPrefs: NotificationPrefs = {
  userId: MOCK_ME,
  newOffer: true,
  priceDrop: true,
  orderStatus: true,
  boostExpiry: true,
  promotional: false,
  updatedAt: new Date().toISOString(),
};

const MOCK_SAFE_SPOTS: SafeSpot[] = [
  { id: 'ss-lag-01', name: 'Lagos State Police Command HQ Forecourt', kind: 'police_station', address: 'Louis Edet House, Ikeja', state: 'Lagos', lga: 'Ikeja', lat: 6.6018, lng: 3.3515, verified: true },
  { id: 'ss-lag-03', name: 'Ikeja City Mall Security Point', kind: 'mall', address: 'Alausa, Ikeja', state: 'Lagos', lga: 'Ikeja', lat: 6.6142, lng: 3.3585, verified: true },
  { id: 'ss-abj-01', name: 'FCT Police Command Forecourt, Garki', kind: 'police_station', address: 'Area 11, Garki', state: 'FCT', lga: 'Municipal', lat: 9.0361, lng: 7.4895, verified: true },
];

const delay = (ms = 220) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Media presign ───────────────────────────────────────────────────────────

export async function presignListingMedia(fileName: string, mimeType: string): Promise<MediaPresign> {
  if (MKT_USE_MOCK) {
    await delay();
    // Mock returns a local echo so the Sell composer can proceed offline; no real PUT.
    return {
      uploadUrl: `mock://upload/${encodeURIComponent(fileName)}`,
      fileUrl: `marketplace/${MOCK_ME}/${Date.now()}-${fileName}`,
      objectKey: `marketplace/${MOCK_ME}/${Date.now()}-${fileName}`,
      bucket: 'spotlight-open-mic',
      mimeType,
      expiresIn: 600,
      method: 'PUT',
    };
  }
  return mktPost<MediaPresign>('/media/presign', { fileName, mimeType });
}

// ─── Saved items / wishlist ──────────────────────────────────────────────────

export async function saveListing(listingId: string): Promise<SavedItem> {
  if (MKT_USE_MOCK) {
    await delay();
    return { id: `si-${Date.now()}`, userId: MOCK_ME, listingId, savedPriceKobo: 0, createdAt: new Date().toISOString() };
  }
  return mktPost<SavedItem>(`/listings/${listingId}/save`);
}

export async function unsaveListing(listingId: string): Promise<{ ok: boolean }> {
  if (MKT_USE_MOCK) {
    await delay();
    return { ok: true };
  }
  return mktDelete<{ ok: boolean }>(`/listings/${listingId}/save`);
}

export async function getSavedItems(): Promise<SavedItem[]> {
  if (MKT_USE_MOCK) {
    await delay();
    return [];
  }
  return arr(await mktGet<SavedItem[]>('/saved-items'));
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export async function createReport(input: CreateReportInput): Promise<Report> {
  if (MKT_USE_MOCK) {
    await delay();
    return {
      id: `rep-${Date.now()}`,
      reporterId: MOCK_ME,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      evidenceUrl: input.evidenceUrl ?? null,
      note: input.note ?? null,
      status: 'open',
      createdAt: new Date().toISOString(),
    };
  }
  // Backend wraps the row: { report: {...} } — unwrap to the row.
  const res = await mktPost<{ report: Report } | Report>('/reports', input);
  return (res as { report?: Report }).report ?? (res as Report);
}

// ─── Blocks ──────────────────────────────────────────────────────────────────

export async function listBlocks(): Promise<Block[]> {
  if (MKT_USE_MOCK) {
    await delay();
    return [...mockBlocks];
  }
  return arr(await mktGet<Block[]>('/blocks'));
}

export async function blockUser(blockedUserId: string, blockedUserName?: string): Promise<Block> {
  if (MKT_USE_MOCK) {
    await delay();
    const b: Block = { id: `blk-${Date.now()}`, userId: MOCK_ME, blockedUserId, blockedUserName, createdAt: new Date().toISOString() };
    mockBlocks = [b, ...mockBlocks];
    return b;
  }
  return mktPost<Block>('/blocks', { blockedUserId });
}

export async function unblockUser(blockId: string): Promise<{ ok: boolean }> {
  if (MKT_USE_MOCK) {
    await delay();
    mockBlocks = mockBlocks.filter((b) => b.id !== blockId);
    return { ok: true };
  }
  return mktDelete<{ ok: boolean }>(`/blocks/${blockId}`);
}

// ─── Notification feed (§ Mobile-UX-Flows 33 · NT-001/002/003) ───────────────
// The in-app inbox of delivered notifications, distinct from notification-prefs
// (opt-in toggles). Each row can deep-link to the listing/thread/seller it's about.

export type MktNotificationType =
  | 'listing_status' // your listing went live / was removed (NT-001)
  | 'new_offer' // a buyer made/updated an offer (NT-002)
  | 'new_message' // a new chat message (NT-002)
  | 'price_drop' // a saved-search or watched listing dropped in price (NT-003)
  | 'saved_search' // new results for a saved search (NT-003)
  | 'boost_expiry' // a boost is ending / has ended
  | 'review'; // a buyer reviewed you

export interface MktNotification {
  id: string;
  type: MktNotificationType;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  listingId?: string | null;
  threadId?: string | null;
  sellerId?: string | null;
}

const mkIso = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();

let mockNotifications: MktNotification[] = [
  { id: 'ntf-1', type: 'new_offer', title: 'New offer received', body: 'A buyer offered ₦480,000 for your iPhone 13 Pro Max.', read: false, createdAt: mkIso(8), listingId: 'lst_a1b2', threadId: 'thr_1' },
  { id: 'ntf-2', type: 'listing_status', title: 'Your listing is live', body: '“Clean Toyota Corolla 2015” has been approved and is now live.', read: false, createdAt: mkIso(52), listingId: 'lst_c3d4' },
  { id: 'ntf-3', type: 'price_drop', title: 'Price drop on a saved item', body: 'A listing on your wishlist dropped by ₦15,000.', read: false, createdAt: mkIso(140), listingId: 'lst_e5f6' },
  { id: 'ntf-4', type: 'saved_search', title: 'New results for “3-bed Lekki”', body: '4 new listings match your saved search.', read: true, createdAt: mkIso(60 * 20) },
  { id: 'ntf-5', type: 'boost_expiry', title: 'Boost ending soon', body: 'Your VIP boost on “MacBook Pro 2021” ends in 24 hours.', read: true, createdAt: mkIso(60 * 26), listingId: 'lst_g7h8' },
  { id: 'ntf-6', type: 'review', title: 'You got a new review', body: 'A buyer left you a 5-star review. Tap to respond.', read: true, createdAt: mkIso(60 * 48), sellerId: MOCK_ME },
];

export async function listNotifications(): Promise<MktNotification[]> {
  if (MKT_USE_MOCK) {
    await delay();
    return mockNotifications.map((n) => ({ ...n }));
  }
  return mktGet<MktNotification[]>('/notifications');
}

export async function markNotificationRead(id: string): Promise<{ ok: boolean }> {
  if (MKT_USE_MOCK) {
    await delay(80);
    mockNotifications = mockNotifications.map((n) => (n.id === id ? { ...n, read: true } : n));
    return { ok: true };
  }
  return mktPost<{ ok: boolean }>(`/notifications/${id}/read`);
}

export async function markAllNotificationsRead(): Promise<{ ok: boolean }> {
  if (MKT_USE_MOCK) {
    await delay(80);
    mockNotifications = mockNotifications.map((n) => ({ ...n, read: true }));
    return { ok: true };
  }
  return mktPost<{ ok: boolean }>('/notifications/read-all');
}

// ─── Followed sellers (LD-005) ───────────────────────────────────────────────

export interface FollowedSeller {
  id: string; // follow record id
  sellerId: string;
  sellerName: string;
  avatarUrl?: string | null;
  trustScore: number;
  activeListings: number;
  followedAt: string;
}

let mockFollows: FollowedSeller[] = [
  { id: 'fol-1', sellerId: 'usr_7f2a', sellerName: 'Tunde Electronics', trustScore: 0.86, activeListings: 42, followedAt: mkIso(60 * 24 * 3) },
  { id: 'fol-2', sellerId: 'usr_2b9e', sellerName: 'Lagos Auto Hub', trustScore: 0.64, activeListings: 12, followedAt: mkIso(60 * 24 * 10) },
];

export async function listFollowedSellers(): Promise<FollowedSeller[]> {
  if (MKT_USE_MOCK) {
    await delay();
    return mockFollows.map((f) => ({ ...f }));
  }
  return mktGet<FollowedSeller[]>('/followed-sellers');
}

export async function followSeller(sellerId: string, sellerName?: string): Promise<FollowedSeller> {
  if (MKT_USE_MOCK) {
    await delay(80);
    const existing = mockFollows.find((f) => f.sellerId === sellerId);
    if (existing) return { ...existing };
    const rec: FollowedSeller = { id: `fol-${Date.now()}`, sellerId, sellerName: sellerName ?? 'Seller', trustScore: 0.7, activeListings: 0, followedAt: new Date().toISOString() };
    mockFollows = [rec, ...mockFollows];
    return { ...rec };
  }
  return mktPost<FollowedSeller>(`/sellers/${sellerId}/follow`);
}

export async function unfollowSeller(sellerId: string): Promise<{ ok: boolean }> {
  if (MKT_USE_MOCK) {
    await delay(80);
    mockFollows = mockFollows.filter((f) => f.sellerId !== sellerId);
    return { ok: true };
  }
  return mktDelete<{ ok: boolean }>(`/sellers/${sellerId}/follow`);
}

// ─── Notification preferences ────────────────────────────────────────────────

export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  if (MKT_USE_MOCK) {
    await delay();
    return { ...mockPrefs };
  }
  return mktGet<NotificationPrefs>('/notification-prefs');
}

export async function updateNotificationPrefs(patch: NotificationPrefsPatch): Promise<NotificationPrefs> {
  if (MKT_USE_MOCK) {
    await delay();
    mockPrefs = { ...mockPrefs, ...patch, updatedAt: new Date().toISOString() };
    return { ...mockPrefs };
  }
  return mktPatch<NotificationPrefs>('/notification-prefs', patch);
}

// ─── Meetup safe-spots ───────────────────────────────────────────────────────

export async function getSafeSpots(filter?: { state?: string; lga?: string }): Promise<SafeSpot[]> {
  if (MKT_USE_MOCK) {
    await delay();
    return MOCK_SAFE_SPOTS.filter(
      (s) =>
        (!filter?.state || s.state.toLowerCase() === filter.state.toLowerCase()) &&
        (!filter?.lga || s.lga.toLowerCase() === filter.lga.toLowerCase()),
    );
  }
  return arr(await mktGet<SafeSpot[]>('/meetup/safe-spots', filter as Record<string, unknown>));
}
