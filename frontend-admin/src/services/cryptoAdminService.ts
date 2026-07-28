// ── Admin — Paymax Crypto service ────────────────────────────────────────────
// Talks to the Go backend admin control plane at /api/v1/admin/crypto/* (RBAC:
// requires the `crypto.admin` permission — see backend/internal/crypto/routes.go
// + model.go PermAdmin). Mock-flagged for dev: flip with
// NEXT_PUBLIC_CRYPTO_ADMIN_USE_MOCK=false to hit the live endpoints.
//
// Money model (iron rule: integers, never floats): cash_kobo / price_kobo /
// value_kobo are NGN kobo. units / minor_unit_scale are integer asset-minor-unit
// fields — never rendered as money, only formatKobo() output is money-facing.

import { env } from '@/config/env';
import type {
  CryptoAsset, CryptoOrder, CryptoAssetConfigRequest,
  CryptoWithdrawal, CryptoWithdrawalDecisionRequest,
  CryptoSwapOrder, CryptoAddress, CryptoAddressDecisionRequest,
  CryptoReconRow, CryptoReconSummary,
} from '@/types/cryptoAdmin';

const USE_MOCK = (process.env.NEXT_PUBLIC_CRYPTO_ADMIN_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function base(): string {
  // env.apiBaseUrl already ends with /api/v1; crypto admin is mounted directly
  // at /api/v1/admin/crypto (no extra prefix-stripping needed, unlike marketplace).
  return `${env.apiBaseUrl}/admin/crypto`;
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

export function formatKobo(kobo: number | null | undefined): string {
  if (kobo == null) return '—';
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

function delay<T = void>(value?: T, ms = 220): Promise<T> {
  return new Promise((r) => setTimeout(() => r(value as T), ms));
}

async function parseErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (body?.error) return typeof body.error === 'string' ? body.error : (body.error.message ?? fallback);
    return `${fallback}: ${res.status}`;
  } catch {
    return `${fallback}: ${res.status}`;
  }
}

// ─── Mock datasets ────────────────────────────────────────────────────────────

const now = Date.now();
const iso = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();

const MOCK_ASSETS: CryptoAsset[] = [
  { id: 'ast_btc', symbol: 'BTC', name: 'Bitcoin', minor_unit_scale: 100_000_000, is_active: true, created_at: iso(60 * 24 * 30), updated_at: iso(60 * 24) },
  { id: 'ast_eth', symbol: 'ETH', name: 'Ethereum', minor_unit_scale: 1_000_000_000, is_active: true, created_at: iso(60 * 24 * 30), updated_at: iso(60 * 24 * 3) },
  { id: 'ast_usdt', symbol: 'USDT', name: 'Tether USD', minor_unit_scale: 1_000_000, is_active: true, created_at: iso(60 * 24 * 30), updated_at: iso(60 * 24 * 10) },
  { id: 'ast_dgex', symbol: 'DGEX', name: 'Dogecoin Experimental (delisted)', minor_unit_scale: 100_000_000, is_active: false, created_at: iso(60 * 24 * 60), updated_at: iso(60 * 24 * 20) },
];

const MOCK_ORDERS: CryptoOrder[] = [
  { id: 'ord_c1', user_id: 'usr_7f2a', asset_id: 'ast_btc', symbol: 'BTC', side: 'buy', status: 'filled', cash_kobo: 50_000_000, units: 76_923, price_kobo: 65_000_000_00, reference: 'ldg_fill_9911', created_at: iso(120) },
  { id: 'ord_c2', user_id: 'usr_2b9e', asset_id: 'ast_eth', symbol: 'ETH', side: 'sell', status: 'filled', cash_kobo: 12_000_000, units: 3_500_000, price_kobo: 342_000_00, reference: 'ldg_fill_9912', created_at: iso(240) },
  { id: 'ord_c3', user_id: 'usr_9a1c', asset_id: 'ast_usdt', symbol: 'USDT', side: 'buy', status: 'pending', cash_kobo: 8_000_000, units: 5_300_000, price_kobo: 150_000, reference: '', created_at: iso(15) },
  { id: 'ord_c4', user_id: 'usr_4d8e', asset_id: 'ast_btc', symbol: 'BTC', side: 'sell', status: 'failed', cash_kobo: 0, units: 40_000, price_kobo: 65_100_000_00, reference: '', created_at: iso(600) },
];

// ─── Admin — orders ───────────────────────────────────────────────────────────

// GET /admin/crypto/orders — all users' fills, paginated.
export async function adminListOrders(limit = 50, offset = 0): Promise<CryptoOrder[]> {
  if (USE_MOCK) return delay([...MOCK_ORDERS]);
  const res = await fetch(`${base()}/orders?limit=${limit}&offset=${offset}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Orders fetch failed'));
  const body = await res.json();
  return body?.orders ?? [];
}

// ─── Admin — asset catalogue ──────────────────────────────────────────────────

// GET /admin/crypto/assets — all assets, including inactive/delisted.
export async function adminListAssets(): Promise<CryptoAsset[]> {
  if (USE_MOCK) return delay([...MOCK_ASSETS]);
  const res = await fetch(`${base()}/assets`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Assets fetch failed'));
  const body = await res.json();
  return body?.assets ?? [];
}

// POST /admin/crypto/assets — create or update (upsert by symbol) a catalogue
// asset. No dedicated reason/audit field on this endpoint server-side today;
// the console still requires an operator note client-side for traceability and
// surfaces it in the confirmation message (kept local — not sent unless the
// backend contract adds an audit field).
export async function adminConfigAsset(input: CryptoAssetConfigRequest): Promise<CryptoAsset> {
  if (!input.symbol || !input.symbol.trim()) throw new Error('symbol is required.');
  if (!input.name || !input.name.trim()) throw new Error('name is required.');
  if (!input.minor_unit_scale || input.minor_unit_scale <= 0) throw new Error('minor_unit_scale must be a positive integer.');
  if (USE_MOCK) {
    await delay();
    const existing = MOCK_ASSETS.find((a) => a.symbol === input.symbol.trim().toUpperCase());
    const updated: CryptoAsset = {
      id: existing?.id ?? `ast_${input.symbol.trim().toLowerCase()}`,
      symbol: input.symbol.trim().toUpperCase(),
      name: input.name.trim(),
      minor_unit_scale: input.minor_unit_scale,
      is_active: input.is_active,
      created_at: existing?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (existing) Object.assign(existing, updated);
    else MOCK_ASSETS.push(updated);
    return updated;
  }
  const res = await fetch(`${base()}/assets`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Asset config failed'));
  const body = await res.json();
  return body?.asset ?? body;
}

// ─── Admin — withdrawal / AML approval queue ─────────────────────────────────
// NOTE: the admin withdrawal routes are NOT yet wired server-side (only member
// /api/v1/crypto/withdrawals* exist). These fetch paths target the PLANNED admin
// routes so the console goes live the moment the backend adds them; until then
// USE_MOCK (default true) serves fixtures so the surface renders standalone.

const MOCK_WITHDRAWALS: CryptoWithdrawal[] = [
  {
    id: 'wd_c1', user_id: 'usr_7f2a', asset_id: 'ast_btc', symbol: 'BTC',
    address_id: 'adr_1', address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', network: 'bitcoin',
    status: 'requested', units: 250_000, network_fee_units: 1_500, fee_kobo: 50_000,
    price_kobo: 65_000_000_00, value_kobo: 16_250_000, provider: 'fireblocks', reference: 'wd_ref_5501',
    aml_flags: ['first_withdrawal', 'amount_threshold'], aml_score: 42,
    created_at: iso(12), updated_at: iso(12),
  },
  {
    id: 'wd_c2', user_id: 'usr_2b9e', asset_id: 'ast_usdt', symbol: 'USDT',
    address_id: 'adr_2', address: '0x9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c', network: 'ethereum',
    status: 'requested', units: 5_000_000, network_fee_units: 2_000_000, fee_kobo: 30_000,
    price_kobo: 150_000, value_kobo: 7_500_000, provider: 'fireblocks', reference: 'wd_ref_5502',
    aml_flags: ['sanctioned_address', 'mixer_exposure', 'high_risk_geo'], aml_score: 91,
    created_at: iso(35), updated_at: iso(35),
  },
  {
    id: 'wd_c3', user_id: 'usr_9a1c', asset_id: 'ast_eth', symbol: 'ETH',
    address_id: 'adr_3', address: '0x1234abcd5678ef901234abcd5678ef901234abcd', network: 'ethereum',
    status: 'pending', units: 2_000_000_000, network_fee_units: 500_000_000, fee_kobo: 20_000,
    price_kobo: 342_000_00, value_kobo: 6_840_000, provider: 'fireblocks', reference: 'wd_ref_5503',
    aml_flags: ['velocity'], aml_score: 28,
    created_at: iso(180), updated_at: iso(60),
  },
  {
    id: 'wd_c4', user_id: 'usr_4d8e', asset_id: 'ast_btc', symbol: 'BTC',
    address_id: 'adr_4', address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', network: 'bitcoin',
    status: 'confirmed', units: 100_000, network_fee_units: 1_200, fee_kobo: 50_000,
    price_kobo: 65_100_000_00, value_kobo: 6_510_000, provider: 'fireblocks',
    tx_hash: '0xabc123def456abc123def456abc123def456abc123def456abc123def456abcd',
    reference: 'wd_ref_5490', aml_flags: [], aml_score: 8,
    created_at: iso(1440), updated_at: iso(1200),
  },
];

// GET /admin/crypto/withdrawals?status=&limit=&offset=
export async function adminListWithdrawals(status = '', limit = 50, offset = 0): Promise<CryptoWithdrawal[]> {
  if (USE_MOCK) {
    await delay();
    return status ? MOCK_WITHDRAWALS.filter((w) => w.status === status) : [...MOCK_WITHDRAWALS];
  }
  const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (status) qs.set('status', status);
  const res = await fetch(`${base()}/withdrawals?${qs.toString()}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Withdrawals fetch failed'));
  const body = await res.json();
  return body?.withdrawals ?? [];
}

// POST /admin/crypto/withdrawals/:id/decision — approve (requested→pending) or
// reject (requested→failed). Operator note is mandatory and audited.
export async function adminDecideWithdrawal(id: string, input: CryptoWithdrawalDecisionRequest): Promise<CryptoWithdrawal> {
  if (!input.note || !input.note.trim()) throw new Error('An operator note is required to decide a withdrawal.');
  if (USE_MOCK) {
    await delay();
    const w = MOCK_WITHDRAWALS.find((x) => x.id === id);
    if (!w) throw new Error('Withdrawal not found.');
    w.status = input.decision === 'approve' ? 'pending' : 'failed';
    if (input.decision === 'reject') w.failure_reason = input.note.trim();
    w.updated_at = new Date().toISOString();
    return { ...w };
  }
  const res = await fetch(`${base()}/withdrawals/${encodeURIComponent(id)}/decision`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Withdrawal decision failed'));
  const body = await res.json();
  return body?.withdrawal ?? body;
}

// ─── Admin — swap monitoring ─────────────────────────────────────────────────
// GET /admin/crypto/swaps — recent asset→asset swaps across all users.

const MOCK_SWAPS: CryptoSwapOrder[] = [
  { id: 'swp_1', user_id: 'usr_7f2a', from_asset_id: 'ast_btc', from_symbol: 'BTC', to_asset_id: 'ast_usdt', to_symbol: 'USDT', status: 'filled', from_units: 100_000, to_units: 43_300_000, from_price_kobo: 65_000_000_00, to_price_kobo: 150_000, cash_kobo: 6_500_000, spread_kobo: 32_500, spread_bps: 50, reference: 'ldg_swp_2201', created_at: iso(45) },
  { id: 'swp_2', user_id: 'usr_2b9e', from_asset_id: 'ast_eth', from_symbol: 'ETH', to_asset_id: 'ast_btc', to_symbol: 'BTC', status: 'filled', from_units: 1_000_000_000, to_units: 52_600, from_price_kobo: 342_000_00, to_price_kobo: 65_000_000_00, cash_kobo: 3_420_000, spread_kobo: 17_100, spread_bps: 50, reference: 'ldg_swp_2202', created_at: iso(90) },
  { id: 'swp_3', user_id: 'usr_9a1c', from_asset_id: 'ast_usdt', from_symbol: 'USDT', to_asset_id: 'ast_eth', to_symbol: 'ETH', status: 'filled', from_units: 10_000_000, to_units: 292_000_000, from_price_kobo: 150_000, to_price_kobo: 342_000_00, cash_kobo: 15_000_000, spread_kobo: 375_000, spread_bps: 250, reference: 'ldg_swp_2203', anomaly: 'spread 250bps exceeds 100bps corridor cap', created_at: iso(20) },
  { id: 'swp_4', user_id: 'usr_4d8e', from_asset_id: 'ast_btc', from_symbol: 'BTC', to_asset_id: 'ast_eth', to_symbol: 'ETH', status: 'failed', from_units: 20_000, to_units: 0, from_price_kobo: 65_100_000_00, to_price_kobo: 342_000_00, cash_kobo: 0, spread_kobo: 0, spread_bps: 0, reference: '', anomaly: 'to-leg credit failed after from-leg debit — check for orphaned units', created_at: iso(300) },
];

export async function adminListSwaps(limit = 50, offset = 0): Promise<CryptoSwapOrder[]> {
  if (USE_MOCK) return delay([...MOCK_SWAPS]);
  const res = await fetch(`${base()}/swaps?limit=${limit}&offset=${offset}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Swaps fetch failed'));
  const body = await res.json();
  return body?.swaps ?? [];
}

// ─── Admin — address allow-list review ───────────────────────────────────────
// GET /admin/crypto/addresses — whitelisted withdrawal destinations pending or
// completed review.

const MOCK_ADDRESSES: CryptoAddress[] = [
  { id: 'adr_1', user_id: 'usr_7f2a', asset_id: 'ast_btc', symbol: 'BTC', label: 'Ledger cold wallet', network: 'bitcoin', address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', is_active: false, review_status: 'pending', screening_result: 'clean', verified_at: null, created_at: iso(30) },
  { id: 'adr_2', user_id: 'usr_2b9e', asset_id: 'ast_usdt', symbol: 'USDT', label: 'Binance deposit', network: 'ethereum', address: '0x9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c', is_active: false, review_status: 'pending', screening_result: 'flagged: OFAC-adjacent cluster', verified_at: null, created_at: iso(50) },
  { id: 'adr_3', user_id: 'usr_9a1c', asset_id: 'ast_eth', symbol: 'ETH', label: 'MetaMask hot', network: 'ethereum', address: '0x1234abcd5678ef901234abcd5678ef901234abcd', is_active: true, review_status: 'approved', screening_result: 'clean', verified_at: iso(600), created_at: iso(720) },
  { id: 'adr_4', user_id: 'usr_4d8e', asset_id: 'ast_btc', symbol: 'BTC', label: 'Unknown recipient', network: 'bitcoin', address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', is_active: false, review_status: 'rejected', screening_result: 'flagged: known mixer', verified_at: null, created_at: iso(2000) },
];

export async function adminListAddresses(review = '', limit = 100, offset = 0): Promise<CryptoAddress[]> {
  if (USE_MOCK) {
    await delay();
    return review ? MOCK_ADDRESSES.filter((a) => a.review_status === review) : [...MOCK_ADDRESSES];
  }
  const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (review) qs.set('review_status', review);
  const res = await fetch(`${base()}/addresses?${qs.toString()}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Addresses fetch failed'));
  const body = await res.json();
  return body?.addresses ?? [];
}

// POST /admin/crypto/addresses/:id/decision — approve or reject an allow-list
// entry. Note is mandatory and audited.
export async function adminDecideAddress(id: string, input: CryptoAddressDecisionRequest): Promise<CryptoAddress> {
  if (!input.note || !input.note.trim()) throw new Error('An operator note is required to review an address.');
  if (USE_MOCK) {
    await delay();
    const a = MOCK_ADDRESSES.find((x) => x.id === id);
    if (!a) throw new Error('Address not found.');
    a.review_status = input.decision === 'approve' ? 'approved' : 'rejected';
    a.is_active = input.decision === 'approve';
    if (input.decision === 'approve') a.verified_at = new Date().toISOString();
    return { ...a };
  }
  const res = await fetch(`${base()}/addresses/${encodeURIComponent(id)}/decision`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Address decision failed'));
  const body = await res.json();
  return body?.address ?? body;
}

// ─── Admin — reconciliation (on-chain vs ledger) ─────────────────────────────
// GET /admin/crypto/reconciliation — per-asset drift between the on-chain
// custodial balance and the summed holding projections in the finance ledger.
// Mirrors the FX SF-8 recon pattern: drift ≠ 0 is a break to investigate.

const MOCK_RECON: CryptoReconRow[] = [
  { asset_id: 'ast_btc', symbol: 'BTC', minor_unit_scale: 100_000_000, ledger_units: 12_500_000, onchain_units: 12_500_000, drift_units: 0, price_kobo: 65_000_000_00, status: 'ok', last_checked_at: iso(5) },
  { asset_id: 'ast_eth', symbol: 'ETH', minor_unit_scale: 1_000_000_000, ledger_units: 48_200_000_000, onchain_units: 48_199_500_000, drift_units: -500_000, price_kobo: 342_000_00, status: 'break', last_checked_at: iso(5) },
  { asset_id: 'ast_usdt', symbol: 'USDT', minor_unit_scale: 1_000_000, ledger_units: 3_200_000_000, onchain_units: 3_202_000_000, drift_units: 2_000_000, price_kobo: 150_000, status: 'break', last_checked_at: iso(5) },
];

export async function adminGetReconciliation(): Promise<CryptoReconSummary> {
  if (USE_MOCK) {
    await delay();
    const rows = [...MOCK_RECON];
    return { rows, breaks: rows.filter((r) => r.status === 'break').length, as_of: new Date().toISOString() };
  }
  const res = await fetch(`${base()}/reconciliation`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Reconciliation fetch failed'));
  const body = await res.json();
  const rows: CryptoReconRow[] = body?.rows ?? [];
  return { rows, breaks: body?.breaks ?? rows.filter((r) => r.status === 'break').length, as_of: body?.as_of ?? new Date().toISOString() };
}
