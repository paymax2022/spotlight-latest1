// Talks to the Go backend admin control plane at /api/v1/admin/crypto/* (RBAC:
// requires the `crypto.admin` permission — see backend/internal/crypto/routes.go
// + model.go PermAdmin). Mock-flagged for dev: flip with
// NEXT_PUBLIC_CRYPTO_ADMIN_USE_MOCK=false to hit the live endpoints.
// Money model (iron rule: integers, never floats): cash_kobo / price_kobo /
// value_kobo are NGN kobo. units / minor_unit_scale are integer asset-minor-unit
// fields — never rendered as money, only formatKobo() output is money-facing.

import { apiV1 } from '@/config/env';
import { operationKey } from './idempotency';
import type {
  CryptoAsset, CryptoOrder, CryptoAssetConfigRequest,
  CryptoWithdrawal, CryptoWithdrawalDecisionRequest,
  CryptoSwapOrder, CryptoAddress, CryptoAddressDecisionRequest,
  CryptoReconRow, CryptoReconSummary, CryptoReviewSwap, CryptoSwapResolveRequest,
  CryptoFeeScheduleResponse, CryptoFeeScheduleUpdate, CryptoFeeScheduleVersion,
} from '@/types/cryptoAdmin';

// LIVE by default. Set NEXT_PUBLIC_CRYPTO_ADMIN_USE_MOCK=true for fixtures.
// Verified before flipping: every path this service calls exists at
// /api/v1/admin/crypto (internal/crypto/routes.go) with matching methods —
// GET addresses/assets/orders/reconciliation/swaps/withdrawals, POST assets,
// POST withdrawals/:id/decision, POST addresses/:id/decision.
// It mattered most for adminDecideWithdrawal: approving a crypto withdrawal
// mutated an in-memory array and reported success, so the operator believed a
// payout had been released.
const USE_MOCK = (process.env.NEXT_PUBLIC_CRYPTO_ADMIN_USE_MOCK ?? 'false').toLowerCase() === 'true';

function base(): string {
  // at /api/v1/admin/crypto (no extra prefix-stripping needed, unlike marketplace).
  return `${apiV1()}/admin/crypto`;
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return { 'Content-Type': 'application/json' };
  return { 'Content-Type': 'application/json' };
}

export function formatKobo(kobo: number | null | undefined): string {
  if (kobo == null) return '—';
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

function delay<T = void>(value?: T, ms = 220): Promise<T> {
  return new Promise((r) => setTimeout(() => r(value as T), ms));
}

// adminConfigAsset has a real, verified live endpoint (see the header comment
// above), so fixture mode has nothing to add and refuses loudly instead of
// reporting a write it did not perform. See docs/audit/ADMIN_SIMULATED_WRITES.md.
const NOT_IN_FIXTURE_MODE =
  'is unavailable in fixture mode: this console will not report a write it did not perform. ' +
  'Unset NEXT_PUBLIC_CRYPTO_ADMIN_USE_MOCK (or set it to false — the default) to make this change against the live backend.';

async function parseErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (body?.error) return typeof body.error === 'string' ? body.error : (body.error.message ?? fallback);
    return `${fallback}: ${res.status}`;
  } catch {
    return `${fallback}: ${res.status}`;
  }
}

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

// GET /admin/crypto/orders — all users' fills, paginated.
export async function adminListOrders(limit = 50, offset = 0): Promise<CryptoOrder[]> {
  if (USE_MOCK) return delay([...MOCK_ORDERS]);
  const res = await fetch(`${base()}/orders?limit=${limit}&offset=${offset}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Orders fetch failed'));
  const body = await res.json();
  return body?.orders ?? [];
}

// GET /admin/crypto/assets — all assets, including inactive/delisted.
export async function adminListAssets(): Promise<CryptoAsset[]> {
  if (USE_MOCK) return delay([...MOCK_ASSETS]);
  const res = await fetch(`${base()}/assets`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Assets fetch failed'));
  const body = await res.json();
  return body?.assets ?? [];
}

// POST /admin/crypto/assets — create or update (upsert by symbol) a catalogue
// the console still requires an operator note client-side for traceability and
// surfaces it in the confirmation message (kept local — not sent unless the
// backend contract adds an audit field).
export async function adminConfigAsset(input: CryptoAssetConfigRequest): Promise<CryptoAsset> {
  if (!input.symbol || !input.symbol.trim()) throw new Error('symbol is required.');
  if (!input.name || !input.name.trim()) throw new Error('name is required.');
  if (!input.minor_unit_scale || input.minor_unit_scale <= 0) throw new Error('minor_unit_scale must be a positive integer.');
  if (USE_MOCK) throw new Error(`Configuring a crypto asset ${NOT_IN_FIXTURE_MODE}`);
  const res = await fetch(`${base()}/assets`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Asset config failed'));
  const body = await res.json();
  return body?.asset ?? body;
}

// NOTE: the admin withdrawal routes are NOT yet wired server-side (only member
// /api/v1/crypto/withdrawals* exist). These fetch paths target the PLANNED admin
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
    method: 'POST',
    headers: { ...authHeaders(), 'Idempotency-Key': operationKey('crypto:withdrawal-decision', id) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Withdrawal decision failed'));
  const body = await res.json();
  return body?.withdrawal ?? body;
}

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

// GET /admin/crypto/swaps/review — swaps parked in needs_review by the NEW swap
// pipeline (backend/internal/cryptosvc, table crypto_swaps), with the user's NGN still
// held. DISTINCT from adminListSwaps above, which reads the LEGACY crypto_swap_orders.
// Read-only this round: it surfaces held money so ops can see it; settle/release/retry
// decision controls are a follow-up. Flag-gated server-side by FEATURE_CRYPTO_SWAPS_ENABLED
// — when the flag is off the route is not mounted (404) and this returns [].

const MOCK_REVIEW_SWAPS: CryptoReviewSwap[] = [
  { id: '7b1e9d2a-0000-4000-8000-000000000001', user_id: 'usr_7f2a', status: 'needs_review', asset: 'USDT', ngn_kobo: 1_000_000, fee_kobo: 7_500, held_kobo: 1_007_500, provider: 'quidax', provider_swap_id: 'qdx_swp_5501', has_provider_id: true, updated_at: iso(90), age_seconds: 90 * 60 },
  { id: '3c2d4e5f-0000-4000-8000-000000000002', user_id: 'usr_2b9e', status: 'needs_review', asset: 'BTC', ngn_kobo: 5_000_000, fee_kobo: 37_500, held_kobo: 5_037_500, provider: 'quidax', has_provider_id: false, updated_at: iso(240), age_seconds: 240 * 60 },
];

export async function adminListReviewSwaps(limit = 50, offset = 0): Promise<CryptoReviewSwap[]> {
  if (USE_MOCK) return delay([...MOCK_REVIEW_SWAPS]);
  const res = await fetch(`${base()}/swaps/review?limit=${limit}&offset=${offset}`, { cache: 'no-store', headers: authHeaders() });
  if (res.status === 404) return []; // flag off / pipeline not mounted — no parked swaps to show
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Review queue fetch failed'));
  const body = await res.json();
  return body?.swaps ?? [];
}

// POST /admin/crypto/swaps/:id/resolve — apply a human decision to a parked swap. This is a
// MONEY-PATH mutation (release reverses the NGN hold; retry re-polls the provider), so the
// decision validity is enforced server-side and fixture mode refuses loudly rather than
// reporting a release it did not perform (see adminConfigAsset / ADMIN_SIMULATED_WRITES.md).
export async function adminResolveReviewSwap(id: string, input: CryptoSwapResolveRequest): Promise<CryptoReviewSwap> {
  if (!input.note || !input.note.trim()) throw new Error('An operator note is required to resolve a swap.');
  if (input.decision !== 'release' && input.decision !== 'retry') throw new Error('decision must be release or retry.');
  if (USE_MOCK) throw new Error(`Resolving a parked swap ${NOT_IN_FIXTURE_MODE}`);
  const res = await fetch(`${base()}/swaps/${encodeURIComponent(id)}/resolve`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Idempotency-Key': operationKey('crypto:swap-resolve', id) },
    body: JSON.stringify({ decision: input.decision, note: input.note.trim() }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Swap resolve failed'));
  const body = await res.json();
  return body?.swap ?? body;
}

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
    method: 'POST',
    headers: { ...authHeaders(), 'Idempotency-Key': operationKey('crypto:address-decision', id) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Address decision failed'));
  const body = await res.json();
  return body?.address ?? body;
}

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

// ── Fee schedule ────────────────────────────────────────────────────────────────────────────
// GET/PUT /admin/crypto/fee-schedule (backend/internal/cryptosvc/admin.go, ADR-PR761). The swap
// markup in integer basis points: a rate for majors, one for everything else, per-asset overrides.
// A new version prices NEW quotes only. Versions are append-only server-side, so a mistake is
// corrected with another version, never by editing history.

const FEE_ASSET_RE = /^[A-Za-z0-9]{2,12}$/;
const FEE_MAX_ASSETS = 50;
const FEE_MAX_REASON = 500;

/** Thrown when the schedule changed since the operator loaded it (HTTP 409 version_conflict). */
export class FeeScheduleConflictError extends Error {
  constructor(message = 'version_conflict') {
    super(message);
    this.name = 'FeeScheduleConflictError';
  }
}

const isBps = (v: unknown, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;

/** Client-side mirror of the backend rules, so a bad edit never leaves the browser. null = valid. */
export function validateFeeScheduleUpdate(input: CryptoFeeScheduleUpdate, ceilingBps: number): string | null {
  if (!Number.isInteger(input.expected_version) || input.expected_version < 0) return 'Missing schedule version — reload the page.';
  if (!isBps(input.major_bps, ceilingBps)) return `Major markup must be a whole number of basis points, at most ${ceilingBps}.`;
  if (!isBps(input.other_bps, ceilingBps)) return `Other-assets markup must be a whole number of basis points, at most ${ceilingBps}.`;
  if (input.majors.length > FEE_MAX_ASSETS || Object.keys(input.overrides).length > FEE_MAX_ASSETS) return `At most ${FEE_MAX_ASSETS} major assets and ${FEE_MAX_ASSETS} overrides.`;
  for (const m of input.majors) if (!FEE_ASSET_RE.test(m.trim())) return `"${m}" is not a valid asset code.`;
  for (const [a, bps] of Object.entries(input.overrides)) {
    if (!FEE_ASSET_RE.test(a.trim())) return `"${a}" is not a valid asset code.`;
    if (!isBps(bps, ceilingBps)) return `Override for ${a.toUpperCase()} must be a whole number of basis points, at most ${ceilingBps}.`;
  }
  const reason = input.reason.trim();
  if (!reason) return 'A reason is required (it is recorded in the audit log).';
  if (reason.length > FEE_MAX_REASON) return `The reason must be at most ${FEE_MAX_REASON} characters.`;
  return null;
}

/** Upper-case, trim, de-duplicate and sort, so equal schedules produce equal bodies and keys. */
function normaliseFeeUpdate(input: CryptoFeeScheduleUpdate): CryptoFeeScheduleUpdate {
  const majors = Array.from(new Set(input.majors.map((m) => m.trim().toUpperCase()))).sort();
  const overrides: Record<string, number> = {};
  for (const a of Object.keys(input.overrides).map((k) => k.trim().toUpperCase()).sort()) {
    const orig = Object.entries(input.overrides).find(([k]) => k.trim().toUpperCase() === a);
    if (orig) overrides[a] = orig[1];
  }
  return { ...input, majors, overrides, reason: input.reason.trim() };
}

// Small stable string hash (not security): the idempotency key must change when the content does,
// because the backend rejects a reused key with a different body.
function contentHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const MOCK_FEE_SCHEDULE: CryptoFeeScheduleResponse = {
  ceiling_bps: 150,
  current: { version: 0, major_bps: 75, other_bps: 100, majors: ['BTC', 'ETH', 'USDC', 'USDT'], overrides: {}, reason: 'configured default', created_by: 'system', created_at: '' },
  history: [],
};

/** null = the pipeline is not mounted (flag off) or has no fee store — nothing to show. */
export async function adminGetFeeSchedule(): Promise<CryptoFeeScheduleResponse | null> {
  if (USE_MOCK) return delay({ ...MOCK_FEE_SCHEDULE });
  const res = await fetch(`${base()}/fee-schedule`, { cache: 'no-store', headers: authHeaders() });
  if (res.status === 404 || res.status === 503) return null;
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Fee schedule fetch failed'));
  return (await res.json()) as CryptoFeeScheduleResponse;
}

/** PRICING mutation. Fixture mode refuses loudly rather than report a change it did not make. */
export async function adminUpdateFeeSchedule(input: CryptoFeeScheduleUpdate, ceilingBps = 150): Promise<CryptoFeeScheduleVersion> {
  const bad = validateFeeScheduleUpdate(input, ceilingBps);
  if (bad) throw new Error(bad);
  if (USE_MOCK) throw new Error(`Changing the fee schedule ${NOT_IN_FIXTURE_MODE}`);
  const body = normaliseFeeUpdate(input);
  const json = JSON.stringify(body);
  const res = await fetch(`${base()}/fee-schedule`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Idempotency-Key': operationKey('crypto:fee-schedule', body.expected_version, contentHash(json)) },
    body: json,
  });
  if (res.status === 409) {
    const err = await res.json().catch(() => ({} as { error?: string }));
    if (err?.error === 'version_conflict') throw new FeeScheduleConflictError();
    throw new Error(`Fee schedule change refused: ${err?.error ?? 'conflict'}`);
  }
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Fee schedule update failed'));
  const out = await res.json();
  return (out?.current ?? out) as CryptoFeeScheduleVersion;
}
