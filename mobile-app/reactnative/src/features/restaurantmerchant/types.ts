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

export interface BankAccount {
  id: string;
  bankName: string;
  bankCode: string;
  accountNumberMasked: string;
  accountName: string;
  isVerified: boolean;
  isDefault: boolean;
  createdAt?: string;
}

export interface AddBankAccountInput {
  bankName: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
}

// A merchant wallet→bank withdrawal (money path). status: pending→processing→
// paid|failed|reversed. With the backend NoopDisburser a fresh request rests at
// `processing` until a provider webhook flips it.
export type WithdrawalStatus = 'pending' | 'processing' | 'paid' | 'failed' | 'reversed';

export interface Withdrawal {
  id: string;
  bankAccountId: string;
  amountKobo: Kobo;
  currency: string;
  status: WithdrawalStatus;
  providerReference?: string | null;
  failureReason?: string | null;
  alreadyProcessed?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface RequestWithdrawalInput {
  amountKobo: Kobo;
  bankAccountId: string;
}
