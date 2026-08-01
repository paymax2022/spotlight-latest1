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
}
