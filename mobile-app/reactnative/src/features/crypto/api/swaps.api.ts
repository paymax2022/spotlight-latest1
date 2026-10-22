// Provider-rail trading (Quidax via the Go `cryptosvc` pipeline). The server prices,
// holds, executes and settles; this file only moves its views to the screens.
//   GET  /api/v1/crypto/swaps/config      → exists only when the pipeline is mounted
//   GET  /api/v1/crypto/swaps/balances    → crypto held in the user's provider sub-account
//   POST /api/v1/crypto/swaps/quote       → Idempotency-Key; buy {ngn_kobo} | sell {amount}
//   POST /api/v1/crypto/swaps/:id/confirm → {pin}; 200 processing/completed, 202 needs_review
//   GET  /api/v1/crypto/swaps/:id         → follow a pending swap to a final state

import { mockAllowed } from '@/config/mockPolicy';
import { api } from '@/api/client';
import { unwrapEnvelope } from '../utils/envelope';
import { parseSwap, newSwapKey, swapErrorCode, type ProviderSwap, type SwapSide } from '../utils/providerSwap';

const USE_MOCK = mockAllowed(process.env.EXPO_PUBLIC_CRYPTO_USE_MOCK, true);

export type TradingRail = 'provider' | 'ledger';

export interface ProviderBalance {
  asset: string;
  /** Spendable / sellable units (decimal string). */
  available: string;
  locked: string;
  total: string;
}

/** Errors keep the server's code on `swapCode` and the HTTP status on `status`. */
export class SwapApiError extends Error {
  constructor(message: string, readonly swapCode: string | null, readonly status: number | null) {
    super(message);
  }
}

function toSwapError(err: unknown): SwapApiError {
  const e = err as { response?: { status?: number }; message?: string };
  return new SwapApiError(e?.message ?? 'Request failed', swapErrorCode(err), e?.response?.status ?? null);
}

const RAIL_TTL_MS = 60_000;
let railCache: { rail: TradingRail; at: number } | null = null;

/**
 * Which rail trades go to. A 404 on /swaps/config means the provider pipeline is not
 * mounted: stay on the legacy ledger endpoints. Any OTHER failure throws — a network
 * blip must never silently send a trade to the other rail.
 */
export async function getTradingRail(now: () => number = Date.now): Promise<TradingRail> {
  if (USE_MOCK) return 'ledger';
  if (railCache && now() - railCache.at < RAIL_TTL_MS) return railCache.rail;
  let rail: TradingRail;
  try {
    const cfg = unwrapEnvelope<{ rail?: string }>((await api.get('/api/v1/crypto/swaps/config')).data);
    rail = cfg?.rail === 'provider' ? 'provider' : 'ledger';
  } catch (err) {
    if ((err as { response?: { status?: number } })?.response?.status !== 404) throw toSwapError(err);
    rail = 'ledger';
  }
  railCache = { rail, at: now() };
  return rail;
}

export async function getProviderBalances(): Promise<ProviderBalance[]> {
  try {
    const rows = unwrapEnvelope<unknown>((await api.get('/api/v1/crypto/swaps/balances')).data);
    if (!Array.isArray(rows)) throw new Error('Malformed balances');
    return rows.map((r) => {
      const o = r as Record<string, unknown>;
      if (typeof o.asset !== 'string' || typeof o.available !== 'string' || typeof o.locked !== 'string' || typeof o.total !== 'string') {
        throw new Error('Malformed balance row');
      }
      return { asset: o.asset, available: o.available, locked: o.locked, total: o.total };
    });
  } catch (err) {
    throw toSwapError(err);
  }
}

export type SwapQuoteInput =
  | { side: 'buy'; asset: string; ngnKobo: number }
  | { side: 'sell'; asset: string; amount: string };

/** Price a buy or sell on the server. Each call is a NEW quote (fresh Idempotency-Key). */
export async function quoteProviderSwap(input: SwapQuoteInput, key: string = newSwapKey()): Promise<ProviderSwap> {
  const body = input.side === 'buy'
    ? { side: 'buy', asset: input.asset, ngn_kobo: input.ngnKobo }
    : { side: 'sell', asset: input.asset, amount: input.amount };
  try {
    const res = await api.post('/api/v1/crypto/swaps/quote', body, { headers: { 'Idempotency-Key': key } });
    return parseSwap(unwrapEnvelope(res.data));
  } catch (err) {
    throw toSwapError(err);
  }
}

/** Confirm with the transaction PIN. A 202 (outcome being reviewed) still returns the swap. */
export async function confirmProviderSwap(id: string, pin: string): Promise<ProviderSwap> {
  try {
    const res = await api.post(`/api/v1/crypto/swaps/${encodeURIComponent(id)}/confirm`, { pin });
    return parseSwap(unwrapEnvelope(res.data));
  } catch (err) {
    throw toSwapError(err);
  }
}

export async function getProviderSwap(id: string): Promise<ProviderSwap> {
  try {
    return parseSwap(unwrapEnvelope((await api.get(`/api/v1/crypto/swaps/${encodeURIComponent(id)}`)).data));
  } catch (err) {
    throw toSwapError(err);
  }
}

export type { ProviderSwap, SwapSide };
