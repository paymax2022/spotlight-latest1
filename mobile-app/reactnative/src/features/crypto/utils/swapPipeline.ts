// Pure money-path logic for the provider-driven crypto BUY swap pipeline
// (backend/internal/cryptosvc, contracts/crypto-swaps.openapi.yaml).
//
// Kept free of runtime imports (types only) so it is unit-testable in isolation
// under `node --test` and carries no coupling to the axios client or RN runtime.
//
// IRON RULES honoured here:
//  • NGN is integer kobo — never a float, never a string for math.
//  • Crypto amounts (quoted/received/price) are decimal STRINGS carried verbatim.
//  • The client never recomputes server totals — the server quote is authoritative.
//  • Errors surface a stable machine code only; provider/database text never leaks.

import type { CryptoSwap, SwapStage, SwapStatus } from '../types/crypto.types';

/** The request body for POST /crypto/swaps/quote — exactly { asset, ngn_kobo }. */
export interface SwapQuoteBody {
  asset: string;
  ngn_kobo: number;
}

/**
 * Build the quote request body, failing closed on anything that is not a
 * positive, safe integer number of kobo. Guards the money path against a float
 * or an out-of-range amount ever reaching the wire.
 */
export function swapQuoteBody(asset: string, ngnKobo: number): SwapQuoteBody {
  const trimmed = (asset ?? '').trim();
  if (!trimmed) throw new Error('crypto swap: asset is required');
  if (!Number.isSafeInteger(ngnKobo)) {
    throw new Error('crypto swap: ngn_kobo must be a safe integer number of kobo');
  }
  if (ngnKobo <= 0) throw new Error('crypto swap: ngn_kobo must be positive');
  return { asset: trimmed, ngn_kobo: ngnKobo };
}

function requireString(raw: Record<string, unknown>, key: string): string {
  const v = raw[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`crypto swap: missing or invalid field "${key}"`);
  }
  return v;
}

function requireIntegerKobo(raw: Record<string, unknown>, key: string): number {
  const v = raw[key];
  if (!Number.isInteger(v as number)) {
    throw new Error(`crypto swap: field "${key}" must be an integer number of kobo`);
  }
  return v as number;
}

/**
 * Normalise the server's snake_case Swap into the camelCase client view. Kobo
 * fields are asserted to be integers (a float leaking in is a bug, not a value
 * to silently round); decimal-string fields are copied byte-for-byte so no
 * precision is lost through a float round-trip.
 */
export function normalizeSwap(raw: unknown): CryptoSwap {
  if (!raw || typeof raw !== 'object') {
    throw new Error('crypto swap: expected a swap object');
  }
  const r = raw as Record<string, unknown>;
  const status = requireString(r, 'status') as SwapStatus;
  const side = requireString(r, 'side');
  if (side !== 'buy') throw new Error(`crypto swap: unexpected side "${side}"`);

  const received = r.received_amount;
  const expires = r.expires_at;

  return {
    id: requireString(r, 'id'),
    status,
    side: 'buy',
    asset: requireString(r, 'asset'),
    ngnKobo: requireIntegerKobo(r, 'ngn_kobo'),
    feeKobo: requireIntegerKobo(r, 'fee_kobo'),
    feeBps: requireIntegerKobo(r, 'fee_bps'),
    totalKobo: requireIntegerKobo(r, 'total_kobo'),
    quotedAmount: requireString(r, 'quoted_amount'),
    price: requireString(r, 'price'),
    ...(typeof received === 'string' && received.length > 0 ? { receivedAmount: received } : {}),
    ...(typeof expires === 'string' && expires.length > 0 ? { expiresAt: expires } : {}),
  };
}

/** Collapse a SwapStatus into the bucket the processing/terminal screens use. */
export function swapStage(status: SwapStatus): SwapStage {
  switch (status) {
    case 'completed':
      return 'done';
    case 'failed':
    case 'expired':
      return 'failed';
    case 'needs_review':
      return 'review';
    case 'quoted':
    case 'confirming':
    case 'processing':
    default:
      return 'pending';
  }
}

/** User-facing copy for each stable machine code the swap pipeline can return. */
const SWAP_ERROR_COPY: Record<string, string> = {
  quote_expired: 'Your quoted price expired. Please get a fresh quote.',
  insufficient_funds: "You don't have enough in your wallet to complete this purchase.",
  limit_exceeded: 'This purchase exceeds your current trading limit. Try a smaller amount.',
  pin_invalid: 'That PIN is incorrect. Please try again.',
  pin_not_set: 'Set a transaction PIN in Settings before you can trade.',
  trading_not_allowed: "Crypto trading isn't available on your account yet.",
};

const GENERIC_SWAP_ERROR = 'Something went wrong. Please try again.';

export interface MappedSwapError {
  message: string;
  cryptoType: string;
}

/**
 * Map a thrown axios error from the swap pipeline into user-facing copy + a
 * stable machine code. The pipeline's error envelope is { success:false, error }
 * where `error` is a machine code (never provider/database text), so an unknown
 * code is shown as the generic message and never surfaced raw to the user.
 */
export function mapSwapError(err: unknown): MappedSwapError {
  const e = err as { response?: { data?: { error?: unknown } } };
  const rawCode = e?.response?.data?.error;
  const code = typeof rawCode === 'string' ? rawCode : '';
  const known = Object.prototype.hasOwnProperty.call(SWAP_ERROR_COPY, code);
  return {
    message: known ? SWAP_ERROR_COPY[code] : GENERIC_SWAP_ERROR,
    cryptoType: code || 'internal',
  };
}

/**
 * Whether the client should drive the BUY flow through the new provider swap
 * pipeline. Off unless EXPO_PUBLIC_CRYPTO_SWAPS is explicitly "true" — the Go
 * backend independently gates the routes behind FEATURE_CRYPTO_SWAPS_ENABLED.
 */
export function cryptoSwapsEnabled(): boolean {
  return String(process.env.EXPO_PUBLIC_CRYPTO_SWAPS ?? '').trim().toLowerCase() === 'true';
}
