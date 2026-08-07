// ── Paymax Invest · Crypto — Formatters & quote math ─────────────────────────
// All money is minor units (integer). Display helpers convert to major units.
// The quote/fee math lives here so the mock API and the screens compute the
// exact same numbers (the screens preview a quote; the API executes one).

import {
  FIAT_META,
  PAYMAX_FEE_BPS,
  PROVIDER_FEE_BPS,
  QUOTE_EXPIRY_SECONDS,
  SPREAD_BPS_BY_RISK,
  SWAP_FEE_BPS,
  SWAP_SPREAD_BPS,
} from '../constants/crypto.constants';
import type {
  CryptoAsset,
  CryptoFee,
  CryptoQuote,
  FiatCurrency,
  FiatMoney,
  QuoteRequest,
  SwapQuote,
} from '../types/crypto.types';

// ─── Display ──────────────────────────────────────────────────────────────────

/** Format fiat minor units as a localized major-unit string with the symbol. */
export function formatFiat(amount: number, currency: FiatCurrency, opts?: { decimals?: boolean }): string {
  const meta = FIAT_META[currency];
  const major = amount / 10 ** meta.decimals;
  const decimals = opts?.decimals === false ? 0 : meta.decimals;
  const body = major.toLocaleString('en-NG', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${meta.symbol}${body}`;
}

export function formatFiatObj(m: FiatMoney, opts?: { decimals?: boolean }): string {
  return formatFiat(m.amount, m.currency, opts);
}

/** Compact fiat for cards/tiles: 1_250_000_00 NGN → "₦1.25M". */
export function formatFiatCompact(amount: number, currency: FiatCurrency): string {
  const meta = FIAT_META[currency];
  const major = amount / 10 ** meta.decimals;
  let body: string;
  if (major >= 1_000_000_000) body = `${(major / 1_000_000_000).toFixed(major % 1_000_000_000 === 0 ? 0 : 2)}B`;
  else if (major >= 1_000_000) body = `${(major / 1_000_000).toFixed(major % 1_000_000 === 0 ? 0 : 2)}M`;
  else if (major >= 10_000) body = `${(major / 1_000).toFixed(major % 1_000 === 0 ? 0 : 1)}K`;
  else body = major.toLocaleString('en-NG', { maximumFractionDigits: 2 });
  return `${meta.symbol}${body}`;
}

/** Format a crypto amount in minor units → trimmed major-unit string + symbol. */
export function formatCrypto(amount: number, symbol: string, decimals: number): string {
  const major = amount / 10 ** decimals;
  // Show up to `decimals` places but trim trailing zeros for readability.
  const body = major.toLocaleString('en-US', { maximumFractionDigits: decimals });
  return `${body} ${symbol}`;
}

/** Per-coin price line, e.g. "1 BTC = ₦98,420,000.00". */
export function formatPrice(symbol: string, price: FiatMoney): string {
  return `1 ${symbol} = ${formatFiatObj(price)}`;
}

export function formatPct(pct: number): string {
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

/** Parse a user-typed fiat string into integer minor units. */
export function parseFiatToMinor(input: string, currency: FiatCurrency): number {
  const meta = FIAT_META[currency];
  const cleaned = input.replace(/[^0-9.]/g, '');
  if (!cleaned) return 0;
  const major = parseFloat(cleaned);
  if (Number.isNaN(major)) return 0;
  return Math.round(major * 10 ** meta.decimals);
}

/** Parse a user-typed crypto string into integer base-unit minor units. */
export function parseCryptoToMinor(input: string, decimals: number): number {
  const cleaned = input.replace(/[^0-9.]/g, '');
  if (!cleaned) return 0;
  const major = parseFloat(cleaned);
  if (Number.isNaN(major)) return 0;
  return Math.round(major * 10 ** decimals);
}

/** Minor units → plain major-unit string for editable inputs (no symbol/grouping). */
export function fiatMinorToInput(amount: number, currency: FiatCurrency): string {
  if (!amount) return '';
  const meta = FIAT_META[currency];
  return (amount / 10 ** meta.decimals).toString();
}

// ─── Time / countdown ─────────────────────────────────────────────────────────

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

export function totalFeesFiat(fees: CryptoFee[]): number {
  return fees.reduce((sum, f) => sum + f.amount.amount, 0);
}

/** Generate an Idempotency-Key for a money mutation (iron rule). */
export function newIdempotencyKey(prefix = 'cr'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Quote engine (mock) ──────────────────────────────────────────────────────
// Deterministic so the entry screen's live preview and the executed order agree.

/**
 * Build a CryptoQuote from an asset + request. Fees and spread are itemised for
 * transparency; the all-in rate is the effective per-coin price the user gets.
 * Buy:  user spends `totalFiat` (gross incl. fees) → receives `crypto`.
 * Sell: user sells `crypto` → receives `totalFiat` (net after fees).
 */
export function buildQuote(asset: CryptoAsset, req: QuoteRequest): CryptoQuote {
  const { side, basis, amount, currency } = req;
  const decimals = asset.decimals;
  const unitPrice = asset.price.amount;                 // fiat minor units per 1 coin
  const spreadBps = SPREAD_BPS_BY_RISK[asset.riskRating];

  // All-in unit price: buys cost a touch more, sells pay a touch less.
  const spreadFactor = side === 'buy' ? 1 + spreadBps / 10_000 : 1 - spreadBps / 10_000;
  const allInUnit = Math.round(unitPrice * spreadFactor);

  // Resolve crypto quantity + the net trade value (pre-fee, at all-in rate).
  const feeBpsTotal = PAYMAX_FEE_BPS + PROVIDER_FEE_BPS;
  let cryptoMinor: number;
  let tradeFiat: number;       // value of the crypto at the all-in rate (pre-fee)
  if (basis === 'fiat') {
    if (side === 'buy') {
      // Fiat basis on a BUY: the entered `amount` is the GROSS the user pays
      // (crypto value + percentage fees). Carve the % fees back out so the
      // total-to-pay equals exactly what the user typed — fees are NOT added on
      // top of the entered amount.
      tradeFiat = Math.round((amount * 10_000) / (10_000 + feeBpsTotal));
    } else {
      // Fiat basis on a SELL: the entered `amount` is the trade value; the user
      // receives that value minus fees (applied below).
      tradeFiat = amount;
    }
    cryptoMinor = Math.round((tradeFiat / allInUnit) * 10 ** decimals);
  } else {
    cryptoMinor = amount;
    tradeFiat = Math.round((amount / 10 ** decimals) * allInUnit);
  }

  // Fees expressed in settlement fiat (percentage fees are charged on trade value).
  const paymaxFee = Math.round((tradeFiat * PAYMAX_FEE_BPS) / 10_000);
  const providerFee = Math.round((tradeFiat * PROVIDER_FEE_BPS) / 10_000);
  const spreadFiat = Math.round((tradeFiat * spreadBps) / 10_000);
  const feeSum = paymaxFee + providerFee;

  // Buy: total debit = trade value + fees. Sell: total credit = trade value − fees.
  let totalFiat: number;
  if (side === 'buy' && basis === 'fiat') {
    // Gross is fixed to exactly what the user entered; absorb sub-kobo rounding
    // into the trade value so `total === entered` and `trade + fees === total`
    // both hold precisely.
    totalFiat = amount;
    tradeFiat = amount - feeSum;
    cryptoMinor = Math.round((tradeFiat / allInUnit) * 10 ** decimals);
  } else if (side === 'buy') {
    totalFiat = tradeFiat + feeSum;
  } else {
    totalFiat = Math.max(0, tradeFiat - feeSum);
  }

  const fees: CryptoFee[] = [
    { type: 'spread', amount: { amount: spreadFiat, currency } },
    { type: 'paymax_fee', amount: { amount: paymaxFee, currency } },
    { type: 'provider_fee', amount: { amount: providerFee, currency } },
  ];

  return {
    id: `cq_${Math.random().toString(36).slice(2, 8)}`,
    assetId: asset.id,
    symbol: asset.symbol,
    side,
    status: req.lock ? 'locked' : 'quoted',
    basis,
    fiat: { amount: tradeFiat, currency },
    crypto: { amount: cryptoMinor, symbol: asset.symbol },
    rate: { amount: unitPrice, currency },
    allInRate: { amount: allInUnit, currency },
    spreadPct: spreadBps / 100,
    fees,
    totalFiat: { amount: totalFiat, currency },
    liquidityProvider: 'mock-liquidity',
    custodyProvider: 'mock-custody',
    riskScore: asset.riskRating === 'high' ? 64 : asset.riskRating === 'medium' ? 38 : 18,
    expiresAt: new Date(Date.now() + QUOTE_EXPIRY_SECONDS * 1000).toISOString(),
  };
}

/**
 * Build a crypto-to-crypto swap quote. The two assets are priced via their fiat
 * values (triangulation), then a spread + fee is applied. Settlement-fiat fee is
 * itemised for transparency, mirroring the buy/sell breakdown.
 */
export function buildSwapQuote(from: CryptoAsset, to: CryptoAsset, fromAmountMinor: number): SwapQuote {
  const fromUnit = 10 ** from.decimals;
  const toUnit = 10 ** to.decimals;

  // Fiat value of what's being swapped in (settlement fiat is the `from` price's).
  const fromFiat = Math.round((fromAmountMinor / fromUnit) * from.price.amount);

  // The customer receives value after BOTH the spread AND the swap fee. The fee
  // must actually reduce the output — mirroring buy/sell, where the itemised fee
  // is charged, not merely displayed.
  const feeFiat = Math.round((fromFiat * SWAP_FEE_BPS) / 10_000);
  const netFiat = Math.max(0, Math.round(fromFiat * (1 - SWAP_SPREAD_BPS / 10_000)) - feeFiat);
  const toAmountMinor = to.price.amount > 0 ? Math.round((netFiat / to.price.amount) * toUnit) : 0;

  const rate = fromAmountMinor > 0 ? (toAmountMinor / toUnit) / (fromAmountMinor / fromUnit) : 0;

  return {
    id: `sq_${Math.random().toString(36).slice(2, 8)}`,
    fromAssetId: from.id,
    toAssetId: to.id,
    from: { amount: fromAmountMinor, symbol: from.symbol },
    to: { amount: toAmountMinor, symbol: to.symbol },
    rate: +rate.toFixed(8),
    spreadPct: SWAP_SPREAD_BPS / 100,
    fee: { amount: feeFiat, currency: from.price.currency },
    fiatValue: { amount: fromFiat, currency: from.price.currency },
    liquidityProvider: 'mock-liquidity',
    expiresAt: new Date(Date.now() + QUOTE_EXPIRY_SECONDS * 1000).toISOString(),
  };
}
