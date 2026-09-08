// ── Admin — Paymax Invest service ────────────────────────────────────────────
// Talks to the Go backend admin control plane at /api/v1/admin/invest/* (RBAC:
// requires the `invest.manage` permission). Mock-flagged for dev: flip with
// NEXT_PUBLIC_INVEST_ADMIN_USE_MOCK=false to hit the live endpoints.

import { apiV1 } from '@/config/env';
import { operationKey } from './idempotency';
import type {
  InvestOverview, AdminStockAsset, AdminOrder, FeeConfig, AuditEntry, AssetUpdate,
  ReconResult, Dividend, CorporateAction, ProviderHealth,
} from '@/types/investAdmin';

// LIVE by default. Set NEXT_PUBLIC_INVEST_ADMIN_USE_MOCK=true for fixtures.
//
// Verified before flipping: every endpoint this service calls is registered at
// /api/v1/admin/invest (internal/invest/routes.go) with matching methods —
// GET assets/audit/corporate-actions/dividends/fees/orders/overview/providers,
// POST assets, PATCH assets/:id, PUT fees, POST dividends, POST
// corporate-actions, POST settlement/run.
//
// It mattered most for runSettlement, whose fixture branch returned 3 — rendered
// to the operator as "3 settlements processed" while nothing ran.
const USE_MOCK = (process.env.NEXT_PUBLIC_INVEST_ADMIN_USE_MOCK ?? 'false').toLowerCase() === 'true';

function base(): string {
  return `${apiV1()}/admin/invest`;
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));

// Every write below has a verified live endpoint (see the header comment above),
// so fixture mode has nothing to add and refuses loudly instead of reporting a
// write it did not perform — the same treatment runSettlement's fixture branch
// already needed once (it used to return the literal 3, rendered as "3
// settlements processed" while nothing ran). See
// docs/audit/ADMIN_SIMULATED_WRITES.md.
const NOT_IN_FIXTURE_MODE =
  'is unavailable in fixture mode: this console will not report a write it did not perform. ' +
  'Unset NEXT_PUBLIC_INVEST_ADMIN_USE_MOCK (or set it to false — the default) to make this change against the live backend.';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(base() + path, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers as Record<string, string> | undefined) },
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return (body?.data ?? body) as T;
}

// ─── Mock datasets ────────────────────────────────────────────────────────────

const MOCK_OVERVIEW: InvestOverview = {
  assets_total: 10, assets_tradable: 9, orders_total: 1284,
  orders_pending_settlement: 37, orders_failed: 6, investors: 412, open_offers: 1,
};

const MOCK_ASSETS: AdminStockAsset[] = [
  { id: 's1', symbol: 'DANGCEM', name: 'Dangote Cement Plc', exchange: 'NGX', sector: 'Industrial Goods', asset_class: 'equity', status: 'active', buy_enabled: true, sell_enabled: true, risk_rating: 'medium', minimum_order_amount: 1_000_000, maximum_order_amount: 0, kyc_tier_required: 2, settlement_days: 3 },
  { id: 's2', symbol: 'MTNN', name: 'MTN Nigeria', exchange: 'NGX', sector: 'Telecommunications', asset_class: 'equity', status: 'active', buy_enabled: true, sell_enabled: true, risk_rating: 'medium', minimum_order_amount: 1_000_000, maximum_order_amount: 0, kyc_tier_required: 2, settlement_days: 3 },
  { id: 's9', symbol: 'ARADEL', name: 'Aradel Holdings Plc', exchange: 'NGX', sector: 'Oil & Gas', asset_class: 'equity', status: 'active', buy_enabled: false, sell_enabled: false, risk_rating: 'high', minimum_order_amount: 1_000_000, maximum_order_amount: 0, kyc_tier_required: 2, settlement_days: 3 },
];

const MOCK_ORDERS: AdminOrder[] = [
  { id: 'o1', user_id: 'u-1842', symbol: 'GTCO', side: 'buy', order_type: 'market', quantity: 100, filled_quantity: 100, amount_kobo: 520_000, fees_kobo: 10_000, total_amount_kobo: 530_000, status: 'Settled', provider_reference: 'mbk_1', created_at: new Date(Date.now() - 86400000).toISOString() },
  { id: 'o2', user_id: 'u-2210', symbol: 'MTNN', side: 'buy', order_type: 'market', quantity: 25, filled_quantity: 0, amount_kobo: 575_000, fees_kobo: 0, total_amount_kobo: 0, status: 'Failed', provider_reference: '', failure_reason: 'broker rejected: insufficient liquidity', created_at: new Date(Date.now() - 3600000).toISOString() },
  { id: 'o3', user_id: 'u-1842', symbol: 'NESTLE', side: 'sell', order_type: 'market', quantity: 5, filled_quantity: 5, amount_kobo: 4_750_000, fees_kobo: 71_250, total_amount_kobo: 4_678_750, status: 'PendingSettlement', provider_reference: 'msk_3', created_at: new Date(Date.now() - 7200000).toISOString() },
];

const MOCK_FEES: FeeConfig = { commission_bps: 150, min_fee_kobo: 10_000 };

const MOCK_AUDIT: AuditEntry[] = [
  { id: 'a1', admin_id: 'admin-1', action: 'asset.update', entity_type: 'stock_asset', entity_id: 's9', reason: 'Awaiting compliance sign-off', created_at: new Date(Date.now() - 5400000).toISOString() },
  { id: 'a2', admin_id: 'admin-1', action: 'fees.update', entity_type: 'fee_config', entity_id: '', reason: 'Q3 pricing review', created_at: new Date(Date.now() - 9000000).toISOString() },
];

// ─── API ──────────────────────────────────────────────────────────────────────

export async function getOverview(): Promise<InvestOverview> {
  if (USE_MOCK) { await delay(); return MOCK_OVERVIEW; }
  return req<InvestOverview>('/overview');
}

export async function listAssets(): Promise<AdminStockAsset[]> {
  if (USE_MOCK) { await delay(); return MOCK_ASSETS; }
  return req<AdminStockAsset[]>('/assets');
}

export async function updateAsset(id: string, patch: AssetUpdate): Promise<AdminStockAsset> {
  if (USE_MOCK) throw new Error(`Updating an asset ${NOT_IN_FIXTURE_MODE}`);
  return req<AdminStockAsset>(`/assets/${id}`, { method: 'PATCH', headers: { 'Idempotency-Key': operationKey('invest:asset-update', id) }, body: JSON.stringify(patch) });
}

export async function createAsset(payload: Partial<AdminStockAsset>): Promise<AdminStockAsset> {
  if (USE_MOCK) throw new Error(`Creating an asset ${NOT_IN_FIXTURE_MODE}`);
  return req<AdminStockAsset>('/assets', { method: 'POST', headers: { 'Idempotency-Key': operationKey('invest:asset-create', payload.symbol ?? '') }, body: JSON.stringify(payload) });
}

export async function listOrders(status?: string): Promise<AdminOrder[]> {
  if (USE_MOCK) { await delay(); return status ? MOCK_ORDERS.filter((o) => o.status === status) : MOCK_ORDERS; }
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  return req<AdminOrder[]>(`/orders${qs}`);
}

export async function listFailedOrders(): Promise<AdminOrder[]> {
  if (USE_MOCK) { await delay(); return MOCK_ORDERS.filter((o) => o.status === 'Failed'); }
  return req<AdminOrder[]>('/orders/failed');
}

export async function getPendingSettlements(): Promise<{ due: AdminOrder[]; pending: AdminOrder[] }> {
  if (USE_MOCK) {
    await delay();
    const pending = MOCK_ORDERS.filter((o) => o.status === 'PendingSettlement');
    return { due: pending, pending };
  }
  const res = await fetch(base() + '/settlement/pending', { headers: authHeaders(), cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || 'Request failed');
  return { due: body.due ?? [], pending: body.pending ?? [] };
}

export async function runSettlement(): Promise<number> {
  if (USE_MOCK) throw new Error(`Running settlement ${NOT_IN_FIXTURE_MODE}`);
  const res = await req<{ processed: number }>('/settlement/run', { method: 'POST', headers: { 'Idempotency-Key': operationKey('invest:settlement-run') } });
  return res.processed;
}

export async function getFees(): Promise<FeeConfig> {
  if (USE_MOCK) { await delay(); return MOCK_FEES; }
  return req<FeeConfig>('/fees');
}

export async function updateFees(fc: FeeConfig & { reason?: string }): Promise<FeeConfig> {
  if (USE_MOCK) throw new Error(`Updating fee config ${NOT_IN_FIXTURE_MODE}`);
  return req<FeeConfig>('/fees', { method: 'PUT', headers: { 'Idempotency-Key': operationKey('invest:fees-update', fc.commission_bps) }, body: JSON.stringify(fc) });
}

export async function listAudit(): Promise<AuditEntry[]> {
  if (USE_MOCK) { await delay(); return MOCK_AUDIT; }
  return req<AuditEntry[]>('/audit');
}

export async function listDividends(): Promise<Dividend[]> {
  if (USE_MOCK) { await delay(); return [{ id: 'd1', symbol: 'GTCO', amount_per_share_kobo: 30_00, currency: 'NGN', payment_date: '2026-07-15', status: 'announced', source: 'NGX' }]; }
  return req<Dividend[]>('/dividends');
}

export async function createDividend(payload: { symbol: string; amount_per_share_kobo: number; ex_date?: string; record_date?: string; payment_date?: string; source?: string }): Promise<{ id: string }> {
  if (USE_MOCK) throw new Error(`Creating a dividend ${NOT_IN_FIXTURE_MODE}`);
  return req<{ id: string }>('/dividends', { method: 'POST', headers: { 'Idempotency-Key': operationKey('invest:dividend-create', payload.symbol) }, body: JSON.stringify(payload) });
}

export async function listCorporateActions(): Promise<CorporateAction[]> {
  if (USE_MOCK) { await delay(); return [{ id: 'c1', symbol: 'DANGCEM', type: 'bonus', title: '1-for-10 bonus issue', status: 'announced', effective_date: '2026-08-01', source: 'Registrar' }]; }
  return req<CorporateAction[]>('/corporate-actions');
}

export async function createCorporateAction(payload: { symbol: string; type: string; title: string; description?: string; effective_date?: string; record_date?: string; payment_date?: string; source?: string }): Promise<{ id: string }> {
  if (USE_MOCK) throw new Error(`Creating a corporate action ${NOT_IN_FIXTURE_MODE}`);
  return req<{ id: string }>('/corporate-actions', { method: 'POST', headers: { 'Idempotency-Key': operationKey('invest:corporate-action-create', payload.symbol) }, body: JSON.stringify(payload) });
}

export async function getProviderHealth(): Promise<ProviderHealth[]> {
  if (USE_MOCK) {
    await delay();
    return [
      { role: 'broker', provider: 'mock-broker', healthy: true, detail: 'mock/no health check' },
      { role: 'market_data', provider: 'mock-market-data', healthy: true, detail: 'mock/no health check' },
    ];
  }
  return req<ProviderHealth[]>('/providers/health');
}

export async function getReconciliation(): Promise<ReconResult> {
  if (USE_MOCK) {
    await delay();
    return {
      summary: {
        broker_clearing_net_kobo: 0, fee_income_kobo: 152_500, user_cash_total_kobo: 61_500_000,
        locked_cash_total_kobo: 0, settlement_suspense_kobo: 4_678_750, external_funding_net_kobo: 66_178_750,
        stuck_settlements: 0, trapped_funds: 0, balanced: true,
      },
      stuck_settlements: [],
      trapped_funds: [],
    };
  }
  const res = await fetch(base() + '/reconciliation', { headers: authHeaders(), cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || 'Request failed');
  return body as ReconResult;
}
