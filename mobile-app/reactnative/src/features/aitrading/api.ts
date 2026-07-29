// ── Paymax AI Trading — mobile API client ────────────────────────────────────
// Talks to the Go trading module (backend/internal/trading, mounted at
// /v1/trading via the frontend-web proxy). Backend JSON is snake_case; screens use
// camelCase — normalized here. Money POSTs carry an Idempotency-Key.
//
// PAPER/accounting only: the fund wallet holds cash via the finance ledger and
// mints/redeems units; there is NO live venue execution. Access is gated by the
// decoupled Module-KYC (never the app's Tier 0-3).
//
// TRADING_USE_MOCK defaults TRUE so the stack is demoable offline. Set
// EXPO_PUBLIC_TRADING_USE_MOCK=false to hit the real proxy.

import { api } from '@/api/client';

export const TRADING_BASE = '/api/v1/trading';
export const TRADING_USE_MOCK =
  (process.env.EXPO_PUBLIC_TRADING_USE_MOCK ?? 'true').toLowerCase() !== 'false';

// ── Types (camelCase) ─────────────────────────────────────────────────────────
export type TradingKycStatus =
  | 'NOT_STARTED' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'BYPASSED' | 'EXPIRED';

export interface KycState {
  status: TradingKycStatus;
  hasAccess: boolean;
  bypassExpiresAt: string | null;
}
export interface Position {
  units: number;              // integer-scaled (1e6 = 1.0 unit)
  navPerUnitKobo: number;
  valueKobo: number;
}
export interface SubscribeResult { unitsMinted: number; navPerUnitKobo: number; }
export interface RedeemResult { cashKobo: number; navPerUnitKobo: number; }

// ── camel/snake helpers ───────────────────────────────────────────────────────
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && (v as object).constructor === Object;
const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
function deepCamel<T>(v: unknown): T {
  if (Array.isArray(v)) return v.map((x) => deepCamel(x)) as unknown as T;
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, val]) => [camel(k), deepCamel(val)])) as T;
  return v as T;
}
function unwrap<T>(res: { data?: unknown }): T {
  const body = res.data as { data?: unknown } | unknown;
  const payload = isObj(body) && 'data' in body ? (body as { data: unknown }).data : body;
  return deepCamel<T>(payload);
}

export function newIdempotencyKey(): string {
  return `trd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ── In-memory mock (offline demo) ─────────────────────────────────────────────
const mock = {
  status: 'NOT_STARTED' as TradingKycStatus,
  units: 0,
  navPerUnitKobo: 1_000_000, // par: ₦10,000 / unit
};
const mockHasAccess = () => mock.status === 'APPROVED' || mock.status === 'BYPASSED';
const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 200));

// ── Endpoints ─────────────────────────────────────────────────────────────────
export async function getKyc(): Promise<KycState> {
  if (TRADING_USE_MOCK) return delay({ status: mock.status, hasAccess: mockHasAccess(), bypassExpiresAt: null });
  const res = await api.get(`${TRADING_BASE}/kyc/status`);
  return unwrap<KycState>(res);
}

export async function submitKyc(): Promise<{ status: TradingKycStatus }> {
  if (TRADING_USE_MOCK) { mock.status = 'SUBMITTED'; return delay({ status: mock.status }); }
  const res = await api.post(`${TRADING_BASE}/kyc/submit`);
  return unwrap(res);
}

export async function getPosition(): Promise<Position> {
  if (TRADING_USE_MOCK) return delay({ units: mock.units, navPerUnitKobo: mock.navPerUnitKobo, valueKobo: Math.round((mock.units * mock.navPerUnitKobo) / 1_000_000) });
  const res = await api.get(`${TRADING_BASE}/wallet`);
  return unwrap<Position>(res);
}

export async function subscribe(amountKobo: number, idem = newIdempotencyKey()): Promise<SubscribeResult> {
  if (TRADING_USE_MOCK) {
    const minted = Math.floor((amountKobo * 1_000_000) / mock.navPerUnitKobo);
    mock.units += minted;
    return delay({ unitsMinted: minted, navPerUnitKobo: mock.navPerUnitKobo });
  }
  const res = await api.post(`${TRADING_BASE}/wallet/subscribe`, { amount_kobo: amountKobo }, { headers: { 'Idempotency-Key': idem } });
  return unwrap<SubscribeResult>(res);
}

export async function redeem(units: number, idem = newIdempotencyKey()): Promise<RedeemResult> {
  if (TRADING_USE_MOCK) {
    const cash = Math.round((units * mock.navPerUnitKobo) / 1_000_000);
    mock.units = Math.max(0, mock.units - units);
    return delay({ cashKobo: cash, navPerUnitKobo: mock.navPerUnitKobo });
  }
  const res = await api.post(`${TRADING_BASE}/wallet/redeem`, { units }, { headers: { 'Idempotency-Key': idem } });
  return unwrap<RedeemResult>(res);
}

// Formatting + unit helpers.
export const UNIT_SCALE = 1_000_000;
export function formatNaira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function formatUnits(units: number): string {
  return (units / UNIT_SCALE).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}
