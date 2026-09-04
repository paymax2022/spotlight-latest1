import { env } from '@/config/env';
import { operationKey } from './idempotency';
import type {
  Transfer,
  ProviderHealth,
  TransferFilters,
} from '@/types/transfersAdmin';

// Backend may not be running — default to fixtures unless explicitly disabled.
const USE_FIXTURES =
  (process.env.NEXT_PUBLIC_TRANSFERS_ADMIN_USE_MOCK ?? 'true') !== 'false';

// Go backend mounts finance admin routes under /api/finance/admin/...
// env.apiBaseUrl looks like http://localhost:8080/api/v1 → /api.
export function adminApiBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api');
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  if (!token) return { 'Content-Type': 'application/json' };
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// Idempotency-Key per the house iron rule (see services/idempotency.ts). Keyed on
// the operation identity so a double-click/retry dedupes at the backend instead of
// double-posting a reversal/retry.
function idempotencyKeyFor(action: string, id: string): string {
  return operationKey('transfer', action, id);
}

export function formatKobo(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const now = Date.now();
const iso = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();

const FIXTURE_TRANSFERS: Transfer[] = [
  {
    id: 'trf_01HZX1A',
    reference: 'TRF-2026-0001',
    user_id: 'usr_8f2a',
    type: 'wallet_to_bank',
    source_type: 'wallet',
    provider: 'paystack',
    bank_name: 'Guaranty Trust Bank',
    account_name: 'Adaeze Okonkwo',
    account_number_last4: '4521',
    amount_kobo: 4_500_000,
    fee_kobo: 5_000,
    status: 'successful',
    narration: 'Wallet withdrawal to GTB',
    provider_transfer_ref: 'PSK_TRF_af81be2',
    created_at: iso(180),
    updated_at: iso(176),
    ledger_entry_ids: ['led_a1', 'led_a2'],
    provider_response: '{"status":"success","transfer_code":"TRF_af81be2"}',
  },
  {
    id: 'trf_01HZX2B',
    reference: 'TRF-2026-0002',
    user_id: 'usr_3c7d',
    type: 'wallet_to_bank',
    source_type: 'wallet',
    provider: 'monnify',
    failover_from: 'paystack',
    bank_name: 'Access Bank',
    account_name: 'Emeka Balogun',
    account_number_last4: '9087',
    amount_kobo: 1_250_000,
    fee_kobo: 2_500,
    status: 'provider_initiated',
    narration: 'Payout (failed over from Paystack)',
    provider_transfer_ref: 'MNFY_REF_77c0d1',
    created_at: iso(42),
    updated_at: iso(38),
    ledger_entry_ids: ['led_b1', 'led_b2'],
    provider_response: '{"status":"pending","reference":"MNFY_REF_77c0d1"}',
  },
  {
    id: 'trf_01HZX3C',
    reference: 'TRF-2026-0003',
    user_id: 'usr_5e1f',
    type: 'bank_to_bank',
    source_type: 'bank',
    provider: 'paystack',
    bank_name: 'Zenith Bank',
    account_name: 'Bright Logistics Ltd',
    account_number_last4: '2210',
    amount_kobo: 8_000_000,
    fee_kobo: 10_000,
    status: 'awaiting_funding',
    narration: 'Bank-to-bank sweep — awaiting source funding',
    provider_transfer_ref: '',
    created_at: iso(15),
    updated_at: iso(15),
    ledger_entry_ids: ['led_c1'],
    funding_ledger_entry_ids: ['led_c1'],
    payout_ledger_entry_ids: [],
    provider_response: '',
  },
  {
    id: 'trf_01HZX4D',
    reference: 'TRF-2026-0004',
    user_id: 'usr_9a4b',
    type: 'bank_to_bank',
    source_type: 'bank',
    provider: 'monnify',
    bank_name: 'First Bank of Nigeria',
    account_name: 'Chidinma Eze',
    account_number_last4: '6643',
    amount_kobo: 3_200_000,
    fee_kobo: 6_000,
    status: 'funded',
    narration: 'Bank-to-bank — funded, payout pending',
    provider_transfer_ref: '',
    created_at: iso(70),
    updated_at: iso(55),
    ledger_entry_ids: ['led_d1', 'led_d2'],
    funding_ledger_entry_ids: ['led_d1'],
    payout_ledger_entry_ids: ['led_d2'],
    provider_response: '',
  },
  {
    id: 'trf_01HZX5E',
    reference: 'TRF-2026-0005',
    user_id: 'usr_2b8c',
    type: 'wallet_to_bank',
    source_type: 'wallet',
    provider: 'paystack',
    bank_name: 'United Bank for Africa',
    account_name: 'Tunde Adeyemi',
    account_number_last4: '1198',
    amount_kobo: 950_000,
    fee_kobo: 2_500,
    status: 'reversed',
    narration: 'Payout failed at provider — reversed to wallet',
    provider_transfer_ref: 'PSK_TRF_failed_4d2',
    created_at: iso(310),
    updated_at: iso(300),
    ledger_entry_ids: ['led_e1', 'led_e2', 'led_e3', 'led_e4'],
    provider_response: '{"status":"failed","message":"Account name mismatch"}',
  },
  {
    id: 'trf_01HZX6F',
    reference: 'TRF-2026-0006',
    user_id: 'usr_7d3e',
    type: 'wallet_to_bank',
    source_type: 'wallet',
    provider: 'monnify',
    bank_name: 'Kuda Microfinance Bank',
    account_name: 'Ngozi Umeh',
    account_number_last4: '5530',
    amount_kobo: 620_000,
    fee_kobo: 2_500,
    status: 'failed',
    narration: 'Payout rejected by provider',
    provider_transfer_ref: 'MNFY_REF_rej_91',
    created_at: iso(25),
    updated_at: iso(22),
    ledger_entry_ids: ['led_f1', 'led_f2'],
    provider_response: '{"status":"failed","message":"Insufficient provider float"}',
  },
  {
    id: 'trf_01HZX7G',
    reference: 'TRF-2026-0007',
    user_id: 'usr_4f9a',
    type: 'wallet_to_wallet',
    source_type: 'wallet',
    provider: 'paystack',
    bank_name: '—',
    account_name: 'Spotlight Wallet (internal)',
    account_number_last4: '0000',
    amount_kobo: 150_000,
    fee_kobo: 0,
    status: 'funds_reserved',
    narration: 'Internal wallet-to-wallet — reserved',
    provider_transfer_ref: '',
    created_at: iso(6),
    updated_at: iso(6),
    ledger_entry_ids: ['led_g1'],
    provider_response: '',
  },
];

const FIXTURE_HEALTH: ProviderHealth[] = [
  { provider: 'paystack', healthy: true, last_checked: iso(1) },
  { provider: 'monnify', healthy: true, last_checked: iso(2) },
];

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), 120));
}

// ─── API ─────────────────────────────────────────────────────────────────────

export async function listTransfers(filters: TransferFilters = {}): Promise<Transfer[]> {
  if (USE_FIXTURES) {
    let rows = [...FIXTURE_TRANSFERS];
    if (filters.status) rows = rows.filter((t) => t.status === filters.status);
    if (filters.provider) rows = rows.filter((t) => t.provider === filters.provider);
    if (filters.source_type) rows = rows.filter((t) => t.source_type === filters.source_type);
    return delay(rows);
  }
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.provider) params.set('provider', filters.provider);
  if (filters.source_type) params.set('source_type', filters.source_type);
  const qs = params.toString();
  const res = await fetch(`${adminApiBase()}/finance/admin/transfers${qs ? `?${qs}` : ''}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Transfers list failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : data.data ?? data.transfers ?? [];
}

export async function getTransfer(id: string): Promise<Transfer> {
  if (USE_FIXTURES) {
    const found = FIXTURE_TRANSFERS.find((t) => t.id === id);
    if (!found) throw new Error(`Transfer ${id} not found`);
    return delay(found);
  }
  const res = await fetch(`${adminApiBase()}/finance/admin/transfers/${encodeURIComponent(id)}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Transfer fetch failed: ${res.status}`);
  return res.json();
}

export async function getProviderHealth(): Promise<ProviderHealth[]> {
  if (USE_FIXTURES) return delay([...FIXTURE_HEALTH]);
  const res = await fetch(`${adminApiBase()}/finance/admin/transfers/provider-health`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Provider health fetch failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : data.data ?? [];
}

// One funnel for the two sensitive money-moving writes. Both have real,
// verified live endpoints (POST /finance/admin/transfers/:id/{retry,reverse}),
// so fixture mode refuses loudly instead of reporting a transfer action it did
// not perform. See docs/audit/ADMIN_SIMULATED_WRITES.md.
// NOTE: the real Reverse handler does not bind a JSON body at all — the
// `reason` sent below is silently discarded server-side with no audit trail
// of it. Not the simulated-write bug this pass fixes, but worth a backend
// follow-up (accept + record the reason).
async function postAction(id: string, action: 'retry' | 'reverse', body?: Record<string, unknown>): Promise<void> {
  if (USE_FIXTURES) {
    throw new Error(
      `Transfer ${action} is unavailable in fixture mode: this console will not report a write it did not perform. ` +
      'Set NEXT_PUBLIC_TRANSFERS_ADMIN_USE_MOCK=false to make this change against the live backend.',
    );
  }
  const res = await fetch(
    `${adminApiBase()}/finance/admin/transfers/${encodeURIComponent(id)}/${action}`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Idempotency-Key': idempotencyKeyFor(action, id) },
      body: JSON.stringify(body ?? {}),
    },
  );
  if (!res.ok) throw new Error(`Transfer ${action} failed: ${res.status}`);
}

export async function retryTransfer(id: string): Promise<void> {
  return postAction(id, 'retry');
}

export async function reverseTransfer(id: string, reason: string): Promise<void> {
  return postAction(id, 'reverse', { reason });
}
