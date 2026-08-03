// ── Restaurant merchant — API wrapper ────────────────────────────────────────
// Owner-facing store & menu management against the Go backend (BASE
// /api/v1/restaurant). Talks LIVE by default (real operational data); set
// EXPO_PUBLIC_RESTAURANT_MERCHANT_USE_MOCK=true for an offline in-memory stub.
//
// Backend contract (mapped snake_case → camelCase here):
//   GET    /restaurant/mine                          → core store[]
//   POST   /restaurant                               → create store (is_open=false)
//   GET    /restaurant/:id                           → { restaurant, categories:[{items}] }
//   PATCH  /restaurant/:id                           → update profile
//   PATCH  /restaurant/:id/availability              → open/close
//   POST   /restaurant/:id/menu/categories           → add category
//   DELETE /restaurant/:id/menu/categories/:categoryId
//   POST   /restaurant/:id/menu/items                → add item
//   PATCH  /restaurant/:id/menu/items/:itemId        → price/availability
//   DELETE /restaurant/:id/menu/items/:itemId

import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  MerchantStore,
  MerchantStoreDetail,
  MerchantMenuCategory,
  MerchantMenuItem,
  CreateStoreInput,
  UpdateStoreInput,
  MerchantEarnings,
  BankAccount,
  AddBankAccountInput,
  Withdrawal,
  RequestWithdrawalInput,
} from './types';

export const USE_MOCK =
  (process.env.EXPO_PUBLIC_RESTAURANT_MERCHANT_USE_MOCK ?? 'false').toLowerCase() === 'true';

const BASE = '/api/v1/restaurant';
const enc = encodeURIComponent;
const unwrap = <T>(res: { data: { data?: T } & T }): T => (res.data?.data ?? res.data) as T;

function mapStore(r: any): MerchantStore {
  return {
    id: r.id,
    ownerId: r.owner_id,
    name: r.name,
    description: r.description ?? '',
    address: r.address,
    logoUrl: r.logo_url ?? null,
    isOpen: !!r.is_open,
    createdAt: r.created_at,
  };
}
function mapItem(i: any): MerchantMenuItem {
  return {
    id: i.id,
    categoryId: i.category_id,
    restaurantId: i.restaurant_id,
    name: i.name,
    description: i.description ?? '',
    priceKobo: i.price_kobo ?? 0,
    imageUrl: i.image_url ?? null,
    isAvailable: !!i.is_available,
  };
}
function mapCategory(c: any): MerchantMenuCategory {
  return { id: c.id, restaurantId: c.restaurant_id, name: c.name, items: (c.items ?? []).map(mapItem) };
}

// ── Offline stub (only when USE_MOCK) ─────────────────────────────────────────
let mockStore: MerchantStore = {
  id: 'r-demo', name: 'My Kitchen', description: '', address: '1 Demo Street, Lagos', isOpen: false,
};
let mockCats: MerchantMenuCategory[] = [];
let seq = 0;
const nextId = (p: string) => `${p}-${(seq += 1)}`;
const delay = (ms = 220) => new Promise<void>((r) => setTimeout(r, ms));

// ── Store ─────────────────────────────────────────────────────────────────────
export async function getMyStores(): Promise<MerchantStore[]> {
  if (USE_MOCK) { await delay(); return [mockStore]; }
  return unwrap<any[]>(await api.get(`${BASE}/mine`)).map(mapStore);
}

export async function createStore(input: CreateStoreInput): Promise<MerchantStore> {
  if (USE_MOCK) {
    await delay();
    mockStore = { ...mockStore, name: input.name, description: input.description ?? '', address: input.address };
    return mockStore;
  }
  const body = { name: input.name, description: input.description, address: input.address, logo_url: input.logoUrl };
  return mapStore(unwrap<any>(await api.post(`${BASE}`, body)));
}

export async function getStoreDetail(id: string): Promise<MerchantStoreDetail> {
  if (USE_MOCK) { await delay(); return { store: mockStore, categories: mockCats }; }
  const d = unwrap<any>(await api.get(`${BASE}/${enc(id)}`));
  return { store: mapStore(d.restaurant ?? d), categories: (d.categories ?? []).map(mapCategory) };
}

export async function updateStore(id: string, patch: UpdateStoreInput): Promise<MerchantStore> {
  if (USE_MOCK) {
    await delay();
    mockStore = {
      ...mockStore,
      name: patch.name ?? mockStore.name,
      description: patch.description ?? mockStore.description,
      address: patch.address ?? mockStore.address,
      logoUrl: patch.logoUrl ?? mockStore.logoUrl,
    };
    return mockStore;
  }
  const body: Record<string, unknown> = {};
  if (patch.name !== undefined) body.name = patch.name;
  if (patch.description !== undefined) body.description = patch.description;
  if (patch.address !== undefined) body.address = patch.address;
  if (patch.logoUrl !== undefined) body.logo_url = patch.logoUrl;
  return mapStore(unwrap<any>(await api.patch(`${BASE}/${enc(id)}`, body)));
}

export async function setAvailability(id: string, isOpen: boolean): Promise<MerchantStore> {
  if (USE_MOCK) { await delay(); mockStore = { ...mockStore, isOpen }; return mockStore; }
  return mapStore(unwrap<any>(await api.patch(`${BASE}/${enc(id)}/availability`, { is_open: isOpen })));
}

// ── Menu ──────────────────────────────────────────────────────────────────────
export async function createCategory(id: string, name: string): Promise<MerchantMenuCategory> {
  if (USE_MOCK) {
    await delay();
    const c: MerchantMenuCategory = { id: nextId('c'), name, items: [] };
    mockCats = [...mockCats, c];
    return c;
  }
  return mapCategory(unwrap<any>(await api.post(`${BASE}/${enc(id)}/menu/categories`, { name })));
}

export async function deleteCategory(id: string, categoryId: string): Promise<void> {
  if (USE_MOCK) { await delay(); mockCats = mockCats.filter((c) => c.id !== categoryId); return; }
  await api.delete(`${BASE}/${enc(id)}/menu/categories/${enc(categoryId)}`);
}

export async function createItem(
  id: string,
  input: { categoryId: string; name: string; description?: string; priceKobo: number },
): Promise<MerchantMenuItem> {
  if (USE_MOCK) {
    await delay();
    const it: MerchantMenuItem = {
      id: nextId('i'), categoryId: input.categoryId, name: input.name,
      description: input.description ?? '', priceKobo: input.priceKobo, isAvailable: true,
    };
    mockCats = mockCats.map((c) => (c.id === input.categoryId ? { ...c, items: [...c.items, it] } : c));
    return it;
  }
  const body = { category_id: input.categoryId, name: input.name, description: input.description, price_kobo: input.priceKobo };
  return mapItem(unwrap<any>(await api.post(`${BASE}/${enc(id)}/menu/items`, body)));
}

export async function updateItem(
  id: string,
  itemId: string,
  patch: { priceKobo?: number; isAvailable?: boolean },
): Promise<MerchantMenuItem> {
  if (USE_MOCK) {
    await delay();
    let updated: MerchantMenuItem | undefined;
    mockCats = mockCats.map((c) => ({
      ...c,
      items: c.items.map((it) => {
        if (it.id !== itemId) return it;
        updated = { ...it, priceKobo: patch.priceKobo ?? it.priceKobo, isAvailable: patch.isAvailable ?? it.isAvailable };
        return updated;
      }),
    }));
    return updated as MerchantMenuItem;
  }
  const body: Record<string, unknown> = {};
  if (patch.priceKobo !== undefined) body.price_kobo = patch.priceKobo;
  if (patch.isAvailable !== undefined) body.is_available = patch.isAvailable;
  return mapItem(unwrap<any>(await api.patch(`${BASE}/${enc(id)}/menu/items/${enc(itemId)}`, body)));
}

export async function deleteItem(id: string, itemId: string): Promise<void> {
  if (USE_MOCK) {
    await delay();
    mockCats = mockCats.map((c) => ({ ...c, items: c.items.filter((it) => it.id !== itemId) }));
    return;
  }
  await api.delete(`${BASE}/${enc(id)}/menu/items/${enc(itemId)}`);
}

// ── Settlement bank accounts (capture only — no money movement) ───────────────
function mapBank(b: any): BankAccount {
  return {
    id: b.id,
    bankName: b.bank_name,
    bankCode: b.bank_code,
    accountNumberMasked: b.account_number_masked,
    accountName: b.account_name,
    isVerified: !!b.is_verified,
    isDefault: !!b.is_default,
    createdAt: b.created_at,
  };
}
let mockBanks: BankAccount[] = [];

export async function getBankAccounts(): Promise<BankAccount[]> {
  if (USE_MOCK) { await delay(); return mockBanks; }
  return unwrap<any[]>(await api.get(`${BASE}/bank-accounts`)).map(mapBank);
}

export async function addBankAccount(input: AddBankAccountInput): Promise<BankAccount> {
  if (USE_MOCK) {
    await delay();
    const b: BankAccount = {
      id: nextId('b'), bankName: input.bankName, bankCode: input.bankCode,
      accountNumberMasked: '****' + input.accountNumber.slice(-4), accountName: input.accountName,
      isVerified: false, isDefault: mockBanks.length === 0,
    };
    mockBanks = [...mockBanks, b];
    return b;
  }
  const body = {
    bank_name: input.bankName, bank_code: input.bankCode,
    account_number: input.accountNumber, account_name: input.accountName,
  };
  return mapBank(unwrap<any>(await api.post(`${BASE}/bank-accounts`, body)));
}

export async function setDefaultBankAccount(accountId: string): Promise<void> {
  if (USE_MOCK) { await delay(); mockBanks = mockBanks.map((b) => ({ ...b, isDefault: b.id === accountId })); return; }
  await api.patch(`${BASE}/bank-accounts/${enc(accountId)}/default`, {});
}

export async function deleteBankAccount(accountId: string): Promise<void> {
  if (USE_MOCK) { await delay(); mockBanks = mockBanks.filter((b) => b.id !== accountId); return; }
  await api.delete(`${BASE}/bank-accounts/${enc(accountId)}`);
}

// ── Withdrawals (MONEY PATH: wallet → saved bank account) ─────────────────────
function mapWithdrawal(w: any): Withdrawal {
  return {
    id: w.id,
    bankAccountId: w.bank_account_id,
    amountKobo: w.amount_kobo ?? 0,
    currency: w.currency ?? 'NGN',
    status: w.status,
    providerReference: w.provider_reference ?? null,
    failureReason: w.failure_reason ?? null,
    alreadyProcessed: !!w.already_processed,
    createdAt: w.created_at,
    updatedAt: w.updated_at,
  };
}
let mockWithdrawals: Withdrawal[] = [];

// requestWithdrawal reserves a withdrawal. The Idempotency-Key header is REQUIRED
// by the backend (money mutation) — generated per call and sent as the 3rd axios arg.
export async function requestWithdrawal(input: RequestWithdrawalInput): Promise<Withdrawal> {
  if (USE_MOCK) {
    await delay();
    const w: Withdrawal = {
      id: nextId('w'), bankAccountId: input.bankAccountId, amountKobo: input.amountKobo,
      currency: 'NGN', status: 'processing',
    };
    mockWithdrawals = [w, ...mockWithdrawals];
    return w;
  }
  const body = { amount_kobo: input.amountKobo, bank_account_id: input.bankAccountId };
  return mapWithdrawal(
    unwrap<any>(await api.post(`${BASE}/withdrawals`, body, {
      headers: { 'Idempotency-Key': generateIdempotencyKey() },
    })),
  );
}

export async function getWithdrawals(): Promise<Withdrawal[]> {
  if (USE_MOCK) { await delay(); return mockWithdrawals; }
  return unwrap<any[]>(await api.get(`${BASE}/withdrawals`)).map(mapWithdrawal);
}

// ── Earnings (read-only) ──────────────────────────────────────────────────────
export async function getEarnings(): Promise<MerchantEarnings> {
  if (USE_MOCK) { await delay(); return { paidOutKobo: 0, pendingKobo: 0, runs: [] }; }
  const d = unwrap<any>(await api.get(`${BASE}/earnings`));
  return {
    paidOutKobo: d.paid_out_kobo ?? 0,
    pendingKobo: d.pending_kobo ?? 0,
    runs: (d.runs ?? []).map((r: any) => ({
      id: r.id,
      periodKey: r.period_key,
      netKobo: r.net_kobo ?? 0,
      status: r.status,
      processedAt: r.processed_at ?? null,
    })),
  };
}
