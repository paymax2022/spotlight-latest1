// ── Restaurant merchant — types ──────────────────────────────────────────────
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
  isOpen: boolean;
  createdAt?: string;
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

export interface CreateStoreInput {
  name: string;
  description?: string;
  address: string;
  logoUrl?: string;
}

export interface UpdateStoreInput {
  name?: string;
  description?: string;
  address?: string;
  logoUrl?: string;
  /** Integer kobo per takeaway pack. 0 is a real value, so this is only omitted
   *  when the owner is not changing the price. */
  packagingFeeKobo?: Kobo;
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
