// ── FX Exchange — Formatters & quote math ────────────────────────────────────
// All money is minor units (integer). Display helpers convert to major units.
// Quote/fee math lives here so the mock API and the screens compute identically.

import { CURRENCIES } from '../constants/fx.constants';
import type {
  CurrencyCode,
  Money,
  Quote,
  QuoteFee,
  QuoteRequest,
  QuoteRoute,
  Rail,
} from '../types/fx.types';
import {
  PAYMAX_SPREAD_BPS,
  PROVIDER_FEE_BPS,
  RAIL_FEE_FLAT,
  RATE_LOCK_SECONDS,
} from '../constants/fx.constants';

// ─── Display ──────────────────────────────────────────────────────────────────

/** Format minor units as a localized major-unit string with the currency symbol. */
export function formatMoney(amount: number, currency: CurrencyCode, opts?: { decimals?: boolean }): string {
  const meta = CURRENCIES[currency];
  const major = amount / 10 ** meta.decimals;
  const decimals = opts?.decimals === false ? 0 : meta.decimals;
  const body = major.toLocaleString('en-NG', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  // Symbols that read better as suffixes for stablecoins/MoMo currencies.
  if (meta.kind === 'stablecoin' || currency === 'KES' || currency === 'XAF') {
    return `${body} ${meta.symbol}`;
  }
  return `${meta.symbol}${body}`;
}

export function formatMoneyObj(m: Money, opts?: { decimals?: boolean }): string {
  return formatMoney(m.amount, m.currency, opts);
}

/** Compact display for cards: 1_250_000_00 NGN → "₦1.25M". */
export function formatMoneyCompact(amount: number, currency: CurrencyCode): string {
  const meta = CURRENCIES[currency];
  const major = amount / 10 ** meta.decimals;
  const sym = meta.kind === 'stablecoin' ? '' : meta.symbol;
  const suffix = meta.kind === 'stablecoin' ? ` ${meta.symbol}` : '';
  let body: string;
  if (major >= 1_000_000) body = `${(major / 1_000_000).toFixed(major % 1_000_000 === 0 ? 0 : 2)}M`;
  else if (major >= 10_000) body = `${(major / 1_000).toFixed(major % 1_000 === 0 ? 0 : 1)}K`;
  else body = major.toLocaleString('en-NG', { maximumFractionDigits: 2 });
  return `${sym}${body}${suffix}`;
}

/** Rate display, e.g. "1 USD = ₦1,581.43". */
export function formatRate(from: CurrencyCode, to: CurrencyCode, rate: number): string {
  const toMeta = CURRENCIES[to];
  const formatted = rate.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return `1 ${from} = ${toMeta.symbol}${formatted}`;
}

export function formatPct(pct: number): string {
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

/** Parse a user-typed major-unit string into integer minor units. */
export function parseToMinor(input: string, currency: CurrencyCode): number {
  const meta = CURRENCIES[currency];
  const cleaned = input.replace(/[^0-9.]/g, '');
  if (!cleaned) return 0;
  const major = parseFloat(cleaned);
  if (Number.isNaN(major)) return 0;
  return Math.round(major * 10 ** meta.decimals);
}

/** Minor units → plain major-unit string for editable inputs (no symbol/grouping). */
export function minorToInput(amount: number, currency: CurrencyCode): string {
  if (!amount) return '';
  const meta = CURRENCIES[currency];
  return (amount / 10 ** meta.decimals).toString();
}

// ─── Time / countdown ─────────────────────────────────────────────────────────

/** Seconds remaining until an ISO expiry (clamped ≥ 0). */
export function secondsUntil(iso: string): number {
  return Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
}

export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** Mask an account number / IBAN / wallet address for list display. */
export function maskAccount(value: string): string {
  const v = value.replace(/\s/g, '');
  if (v.length <= 4) return v;
  return `•••• ${v.slice(-4)}`;
}

export function totalFees(fees: QuoteFee[], currency: CurrencyCode): number {
  return fees
    .filter((f) => f.amount.currency === currency)
    .reduce((sum, f) => sum + f.amount.amount, 0);
}

/** Generate an Idempotency-Key for a money mutation (iron rule). */
export function newIdempotencyKey(prefix = 'fx'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Quote engine (mock) ──────────────────────────────────────────────────────
// A small deterministic pricing model so the mock API and screens agree.
// Base mid-market rates expressed as 1 unit of `from` → units of `to`.

const BASE_USD_RATES: Record<CurrencyCode, number> = {
  USD: 1, NGN: 1598.2, EUR: 0.92, GBP: 0.79, GHS: 14.8, KES: 129.5,
  XAF: 602.5, ZAR: 18.4, USDC: 1, USDT: 1,
};

/** Mid-market rate from→to derived via USD triangulation. */
export function midRate(from: CurrencyCode, to: CurrencyCode): number {
  if (from === to) return 1;
  const fromPerUsd = BASE_USD_RATES[from];
  const toPerUsd = BASE_USD_RATES[to];
  return toPerUsd / fromPerUsd;
}

function chooseRoute(from: CurrencyCode, to: CurrencyCode, rail: Rail): { route: QuoteRoute; alt: QuoteRoute } {
  // Default routing bias (spec §3): FX/USD-EUR inbound → eversend; NGN/Francophone/issuing → maplerad.
  const eversendBias = to === 'USD' || to === 'EUR' || from === 'USD' || from === 'EUR';
  const primary = eversendBias ? 'eversend' : 'maplerad';
  const secondary = eversendBias ? 'maplerad' : 'eversend';
  const corridor = `${from}-${to}`;
  return {
    route: { provider: primary, corridor, rail },
    alt: { provider: secondary, corridor, rail },
  };
}

/**
 * Build a Quote deterministically. Spread + fees itemized (transparency, spec §9).
 * The all-in rate is what the customer effectively gets after spread + fees.
 */
export function buildQuote(req: QuoteRequest): Quote {
  const { source, destination, amountType, intent } = req;
  const rail: Rail = req.destinationRail ?? (intent === 'conversion' ? 'wallet' : 'bank_transfer');
  const mid = midRate(source, destination);

  // Paymax customer rate = mid − spread (customer receives slightly less than mid).
  const spreadFactor = 1 - PAYMAX_SPREAD_BPS / 10_000;
  const allInRate = +(mid * spreadFactor).toFixed(4);

  // Resolve source/destination amounts from amountType.
  let sourceAmount: number;
  let destAmount: number;
  if (amountType === 'source') {
    sourceAmount = req.amount;
    destAmount = Math.round(req.amount * allInRate);
  } else {
    destAmount = req.amount;
    sourceAmount = Math.round(req.amount / allInRate);
  }

  // Fees, expressed in source currency where natural.
  const spreadAmount = Math.round((sourceAmount * PAYMAX_SPREAD_BPS) / 10_000);
  const providerFee = Math.round((sourceAmount * PROVIDER_FEE_BPS) / 10_000);
  const railFee = RAIL_FEE_FLAT[rail] ?? 0;

  const fees: QuoteFee[] = [
    { type: 'provider_fee', amount: { amount: providerFee, currency: source } },
    { type: 'rail_fee', amount: { amount: railFee, currency: source } },
    { type: 'paymax_spread', amount: { amount: spreadAmount, currency: source } },
  ];

  const { route, alt } = chooseRoute(source, destination, rail);
  const altAllIn = +(mid * (1 - (PAYMAX_SPREAD_BPS + 18) / 10_000)).toFixed(4);

  return {
    id: `q_${Math.random().toString(36).slice(2, 8)}`,
    status: req.lock ? 'locked' : 'quoted',
    amountType,
    source: { amount: sourceAmount, currency: source },
    destination: { amount: destAmount, currency: destination },
    rate: +mid.toFixed(4),
    allInRate,
    fees,
    route,
    alternatives: [
      {
        provider: alt.provider,
        corridor: alt.corridor,
        rail,
        allInRate: altAllIn,
        destination: { amount: Math.round(sourceAmount * altAllIn), currency: destination },
      },
    ],
    locked: Boolean(req.lock),
    expiresAt: new Date(Date.now() + RATE_LOCK_SECONDS * 1000).toISOString(),
    intent,
  };
}
