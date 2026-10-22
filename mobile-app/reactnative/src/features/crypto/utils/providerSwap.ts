// Provider-rail trading (POST /crypto/swaps/quote → POST /crypto/swaps/:id/confirm →
// GET /crypto/swaps/:id). The SERVER prices, holds and settles; the app only shows the
// server's quote, collects the PIN and follows the swap to a final state.
// Pure helpers, no RN imports, so they run under node --test.

export type SwapStatus =
  | 'quoted' | 'confirming' | 'processing' | 'completed' | 'failed' | 'expired' | 'needs_review';
export type SwapSide = 'buy' | 'sell';

/** The server's SwapView. NGN is integer kobo; crypto amounts are decimal strings. */
export interface ProviderSwap {
  id: string;
  status: SwapStatus;
  side: SwapSide;
  asset: string;
  /** Sell only: crypto units sold. */
  amount?: string;
  ngnKobo: number;
  feeKobo: number;
  feeBps: number;
  /** NGN through the wallet: a buy debits ngn+fee, a sell credits ngn-fee. */
  totalKobo: number;
  /** Crypto quoted (buy: units received; sell: NGN, as a decimal string). */
  quotedAmount: string;
  receivedAmount?: string;
  price: string;
  expiresAt?: string;
}

const STATUSES: readonly SwapStatus[] = ['quoted', 'confirming', 'processing', 'completed', 'failed', 'expired', 'needs_review'];
const isKobo = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isStr = (v: unknown): v is string => typeof v === 'string';

/** Validate a server SwapView. Anything malformed throws: money is never guessed. */
export function parseSwap(raw: unknown): ProviderSwap {
  const r = (raw ?? {}) as Record<string, unknown>;
  const ok =
    isStr(r.id) && r.id !== '' &&
    STATUSES.includes(r.status as SwapStatus) &&
    (r.side === 'buy' || r.side === 'sell') &&
    isStr(r.asset) && r.asset !== '' &&
    isKobo(r.ngn_kobo) && isKobo(r.fee_kobo) && isKobo(r.total_kobo) &&
    typeof r.fee_bps === 'number' && Number.isInteger(r.fee_bps) &&
    isStr(r.quoted_amount) && isStr(r.price);
  if (!ok) throw new Error('The server returned an order we could not read. Nothing was charged by the app.');
  return {
    id: r.id as string,
    status: r.status as SwapStatus,
    side: r.side as SwapSide,
    asset: r.asset as string,
    amount: isStr(r.amount) ? r.amount : undefined,
    ngnKobo: r.ngn_kobo as number,
    feeKobo: r.fee_kobo as number,
    feeBps: r.fee_bps as number,
    totalKobo: r.total_kobo as number,
    quotedAmount: r.quoted_amount as string,
    receivedAmount: isStr(r.received_amount) ? r.received_amount : undefined,
    price: r.price as string,
    expiresAt: isStr(r.expires_at) ? r.expires_at : undefined,
  };
}

/** Whole seconds until the quote expires (0 once expired or if unknown). */
export function secondsLeft(expiresAt: string | undefined, nowMs: number): number {
  if (!expiresAt) return 0;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((t - nowMs) / 1000));
}

/** What the app should show for a swap status. */
export type SwapPhase = 'done' | 'failed' | 'expired' | 'review' | 'pending';

export function phaseOf(status: SwapStatus): SwapPhase {
  switch (status) {
    case 'completed': return 'done';
    case 'failed': return 'failed';
    case 'expired': return 'expired';
    case 'needs_review': return 'review';
    default: return 'pending'; // quoted / confirming / processing
  }
}

/** Polling back-off while a swap is pending: 1s, 2s, 3s… capped at 5s. */
export function pollDelayMs(attempt: number): number {
  return Math.min(5000, 1000 * Math.max(1, attempt + 1));
}

/** How long the processing screen follows a pending swap before handing off to history. */
export const POLL_BUDGET_MS = 60_000;

/** The server's error code (`{ success:false, error:<code> }`) from an axios-style error. */
export function swapErrorCode(err: unknown): string | null {
  const e = err as { swapCode?: unknown; response?: { data?: { error?: unknown; code?: unknown } } } | undefined;
  const code = e?.swapCode ?? e?.response?.data?.error ?? e?.response?.data?.code;
  return typeof code === 'string' && code !== '' ? code : null;
}

/** A PIN problem the user fixes by re-entering it (they stay on the review screen). */
export function isSwapPinError(code: string | null): boolean {
  return code === 'pin_invalid' || code === 'pin_required';
}

/** User-facing copy for a server error code. Never vague about whether money moved. */
export function swapErrorMessage(code: string | null, side: SwapSide): string {
  const verb = side === 'buy' ? 'buy' : 'sale';
  switch (code) {
    case 'pin_invalid': return 'That PIN is incorrect. Check it and try again.';
    case 'pin_required': return 'Enter your 4-digit transaction PIN.';
    case 'pin_not_set': return 'Set a transaction PIN in Settings before you trade.';
    case 'step_up_unavailable': return "We can't verify PINs right now, so nothing was charged. Try again shortly.";
    case 'quote_expired': return 'This price expired before you confirmed. Nothing was charged — get a fresh quote.';
    case 'insufficient_funds': return "Your wallet doesn't have enough to cover this buy and its fee. Nothing was charged.";
    case 'limit_exceeded': return 'This would go over your account limit, so nothing was charged. Try a smaller amount.';
    case 'trading_not_allowed': return 'Crypto trading needs a verified account. Complete verification to continue.';
    case 'rate_limited': return 'Too many attempts. Wait a minute, then try again.';
    case 'idempotency_conflict': return 'This order changed while it was being sent. Go back and start again.';
    case 'swap_not_confirmable': return `This ${verb} can no longer be confirmed. Nothing further was charged.`;
    case 'not_found': return 'We could not find this order.';
    case 'invalid_request': return 'Check the amount and try again.';
    case 'provider_unavailable': return 'Our crypto partner is unavailable right now. Try again shortly.';
    default: return `We couldn't complete this ${verb}. Check your transaction history before trying again.`;
  }
}

// ── amounts ─────────────────────────────────────────────────────────────────

const UNITS_RE = /^[0-9]{1,20}(\.[0-9]{1,18})?$/;

/** Normalise a typed crypto amount ("1,5" → "1.5", trims zeros) or null when invalid. */
export function normaliseUnits(input: string): string | null {
  const s = input.trim().replace(',', '.');
  if (!UNITS_RE.test(s)) return null;
  const [int, frac = ''] = s.split('.');
  const i = int.replace(/^0+(?=\d)/, '');
  const f = frac.replace(/0+$/, '');
  const out = f ? `${i}.${f}` : i;
  return /^0(\.0*)?$/.test(out) ? null : out; // zero is not a sellable amount
}

/** Compare two non-negative decimal strings exactly (no floats): -1, 0 or 1. */
export function compareUnits(a: string, b: string): number {
  const [ai, af = ''] = a.split('.');
  const [bi, bf = ''] = b.split('.');
  const ia = ai.replace(/^0+/, ''), ib = bi.replace(/^0+/, '');
  if (ia.length !== ib.length) return ia.length < ib.length ? -1 : 1;
  if (ia !== ib) return ia < ib ? -1 : 1;
  const n = Math.max(af.length, bf.length);
  const fa = af.padEnd(n, '0'), fb = bf.padEnd(n, '0');
  return fa === fb ? 0 : fa < fb ? -1 : 1;
}

// ── one-shot PIN hand-off (review → processing), never through route params ──

let pendingPin: string | null = null;
export function setSwapPin(pin: string): void { pendingPin = pin ? pin : null; }
export function takeSwapPin(): string | null { const p = pendingPin; pendingPin = null; return p; }

/** A fresh Idempotency-Key for one quote request (a re-quote gets a new one). */
export function newSwapKey(rand: () => string = defaultRand): string {
  return `swq-${rand()}`;
}
function defaultRand(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
