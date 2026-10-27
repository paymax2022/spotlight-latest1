// Merchant-side (store owner) shapes, matching the Go backend's core restaurant
// + menu contract (snake_case on the wire, mapped to camelCase in api.ts). This
// is deliberately separate from the consumer discovery `Restaurant` shape in
// src/features/food/types.ts (rating/ETA/packaging), which a merchant doesn't set.

export type Kobo = number;

export interface MerchantStore {
  id: string;
  ownerId?: string;
  name: string;
  description?: string;
  address: string;
  logoUrl?: string | null;
  /** Storefront banner. Like logoUrl, a viewable (signed, short-lived) URL — re-read the store to refresh. */
  bannerUrl?: string | null;
  isOpen: boolean;
  createdAt?: string;
  /** Server-held pin, when one has been geocoded or confirmed — seeds the
   *  address picker's map when editing rather than starting pin-less. */
  geoLat?: number | null;
  geoLng?: number | null;
  /**
   * Price of ONE takeaway pack, integer kobo. The platform seeds ₦200; the owner
   * sets their own, and 0 is a legitimate choice meaning "I don't charge for
   * packaging". Absent from an older payload reads as unknown, not as free.
   */
  packagingFeeKobo?: Kobo;
}

export interface MerchantMenuItem {
  id: string;
  categoryId: string;
  restaurantId?: string;
  name: string;
  description?: string;
  priceKobo: Kobo;
  imageUrl?: string | null;
  isAvailable: boolean;
  /** Optimistic-concurrency token; echo back as expectedVersion on edit (FOOD-UAT-B-006). */
  version?: number;
  /** Seller-set per-order cap; undefined = platform default (FOOD-UAT-B-008). */
  maxQtyPerOrder?: number;
}

export interface MerchantMenuCategory {
  id: string;
  restaurantId?: string;
  name: string;
  items: MerchantMenuItem[];
}

export interface MerchantStoreDetail {
  store: MerchantStore;
  categories: MerchantMenuCategory[];
}

/**
 * A pin the owner confirmed with the map-assisted address picker
 * (AddressAutocompleteInput), alongside the free-text address. Optional — the
 * server falls back to geocoding the text itself when this is absent — but
 * when present it is more precise than a best-effort server geocode, since
 * it's the exact spot the owner picked rather than a rooftop-centroid guess.
 */
export interface StoreGeoPoint {
  lat: number;
  lng: number;
  plusCode?: string;
}

export interface CreateStoreInput {
  name: string;
  description?: string;
  address: string;
  logoUrl?: string;
  geo?: StoreGeoPoint;
  // No banner here on purpose: the POST cannot mint a presign URL (it has no store id
  // yet), so a banner is uploaded and PATCHed right after the outlet is created.
}

export interface UpdateStoreInput {
  name?: string;
  description?: string;
  address?: string;
  /** A logo `objectKey` from presignStoreImage, or an http(s) link. */
  logoUrl?: string;
  /** A banner `objectKey` from presignStoreImage, or an http(s) link. */
  bannerUrl?: string;
  /** Integer kobo per takeaway pack. 0 is a real value, so this is only omitted
   *  when the owner is not changing the price. */
  packagingFeeKobo?: Kobo;
  geo?: StoreGeoPoint;
}

/**
 * One opening window on one weekday, in 24-hour "HH:MM" strings.
 *
 * `dayOfWeek` is 0 = Sunday … 6 = Saturday, matching Go's time.Weekday on the server.
 * A close earlier than the open is an OVERNIGHT window (22:00 → 02:00 spans midnight),
 * and "00:00" as a close means up to midnight.
 */
export interface StoreHourWindow {
  dayOfWeek: number;
  open: string;
  close: string;
}

/** GET /restaurant/:id/hours. `openNow` is the server's own verdict, switch included. */
export interface StoreHours {
  openNow: boolean;
  windows: StoreHourWindow[];
}

export interface EarningsRun {
  id: string;
  periodKey: string;
  netKobo: Kobo;
  status: string;
  processedAt?: string | null;
}

export interface MerchantEarnings {
  paidOutKobo: Kobo;
  pendingKobo: Kobo;
  runs: EarningsRun[];
}

/**
 * Per-outlet payout readiness — the capability↔KYB bridge (foodhub A17).
 *
 * The merchant capability lets a person trade; KYB lets an OUTLET be paid
 * (payout runs select `kyb_status = 'approved'`, PY-007). They are separate on
 * purpose — banking is per outlet — so this reports the join.
 */
export interface OutletPayoutReadiness {
  restaurantId: string;
  name: string;
  /** 'none' when the outlet has no KYB record at all. */
  kybStatus: string;
  payable: boolean;
  /** Owner-facing, empty when payable. */
  reason?: string;
  /** Settled earnings already held behind the gate, integer kobo. */
  unpaidKobo: Kobo;
}

/** Business types the KYB submit gate accepts (mirrors the backend's kybBusinessTypes). */
export type KYBBusinessType = 'sole_proprietor' | 'limited_company' | 'partnership' | 'ngo';

/**
 * A restaurant's Know-Your-Business verification record (backend/internal/restaurant/kyb.go).
 * Closing the store is always allowed; OPENING requires `status === 'approved'` — see
 * ADR-033's fail-closed gate in SetAvailability. `documents` is the set of uploaded doc
 * types (e.g. 'cac_certificate'), required for any business_type other than
 * 'sole_proprietor' before submit.
 */
export interface RestaurantKYB {
  restaurantId: string;
  legalName: string;
  businessType: KYBBusinessType | '';
  /** CAC RC/BN number — required for every business_type except sole_proprietor. */
  rcNumber: string;
  tin: string;
  contactEmail: string;
  contactPhone: string;
  /** Settlement (payout) account — the merchant's OWN bank account, not a credential. */
  bankCode: string;
  accountNumber: string;
  accountName: string;
  status: string; // 'draft' | 'submitted' | 'under_review' | 'needs_more_info' | 'approved' | 'rejected'
  decisionReason?: string;
  documents: string[];
}

/** A member of one outlet's staff. */
export interface StaffMember {
  userId: string;
  email?: string;
  role: 'OWNER' | 'MANAGER' | 'CASHIER' | 'KITCHEN' | 'RIDER';
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'REMOVED';
  acceptedAt?: string | null;
  createdAt?: string;
}

/**
 * The one-time invite token.
 *
 * Only its hash is stored server-side, so this value is unrecoverable once the
 * screen loses it. The UI must hand it over immediately rather than promise to
 * show it again later.
 */
export interface StaffInvite {
  userId: string;
  role: StaffMember['role'];
  token: string;
}

// UserLookup used to be declared here too, as { userId, ... } — a second
// definition of the same name, disagreeing with the one in api.ts ({ user_id,
// to reach for the wrong same-named type. Removed rather than fixed in place,
// so the mistake can't be made again by importing from here. See api.ts.
