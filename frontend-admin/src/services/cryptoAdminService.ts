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
import type { CryptoAsset, CryptoOrder, CryptoAssetConfigRequest } from '@/types/cryptoAdmin';

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

const delay = (ms = 220) => new Promise((r) => setTimeout(r, ms));

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
