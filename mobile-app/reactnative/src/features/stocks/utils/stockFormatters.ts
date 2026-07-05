// ── Paymax Invest · Stocks — Formatters & estimate math ──────────────────────
// All money is minor units (integer). Display helpers convert to major units.
// The estimate/fee math lives here so the mock API and the screens compute the
// exact same numbers (the screens preview an estimate; the API executes one).

import {
  CHART_RANGES,
  FIAT_META,
  PAYMAX_FEE_BPS,
  PROVIDER_FEE_BPS,
} from '../constants/stocks.constants';
import type {
  Candle,
  ChartRange,
  Fee,
  FiatCurrency,
  FiatMoney,
  OrderEstimate,
  OrderSide,
  OrderType,
  StockAsset,
} from '../types/stocks.types';

// silence unused-import lint when CHART_RANGES is only referenced for typing
void CHART_RANGES;

// ─── Display ──────────────────────────────────────────────────────────────────

/** Format fiat minor units as a localized major-unit string with the symbol. */
export function formatMoney(amount: number, currency: FiatCurrency, opts?: { decimals?: boolean }): string {
  const meta = FIAT_META[currency];
  const major = amount / 10 ** meta.decimals;
  const decimals = opts?.decimals === false ? 0 : meta.decimals;
  const body = major.toLocaleString('en-NG', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${meta.symbol}${body}`;
}

export function formatMoneyObj(m: FiatMoney, opts?: { decimals?: boolean }): string {
  return formatMoney(m.amount, m.currency, opts);
}

/** Compact fiat for cards/tiles: 1_250_000_00 NGN → "₦1.25M". */
export function formatMoneyCompact(amount: number, currency: FiatCurrency): string {
  const meta = FIAT_META[currency];
  const major = amount / 10 ** meta.decimals;
  let body: string;
  if (major >= 1_000_000_000_000) body = `${(major / 1_000_000_000_000).toFixed(major % 1_000_000_000_000 === 0 ? 0 : 2)}T`;
  else if (major >= 1_000_000_000) body = `${(major / 1_000_000_000).toFixed(major % 1_000_000_000 === 0 ? 0 : 2)}B`;
  else if (major >= 1_000_000) body = `${(major / 1_000_000).toFixed(major % 1_000_000 === 0 ? 0 : 2)}M`;
  else if (major >= 10_000) body = `${(major / 1_000).toFixed(major % 1_000 === 0 ? 0 : 1)}K`;
  else body = major.toLocaleString('en-NG', { maximumFractionDigits: 2 });
  return `${meta.symbol}${body}`;
}

/** Format a share count (whole shares; allow a couple decimals for fractional). */
export function formatShares(n: number): string {
  const body = n.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return `${body} ${n === 1 ? 'share' : 'shares'}`;
}

export function formatPct(pct: number): string {
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

/** Parse a user-typed fiat string into integer minor units. */
export function parseToMinor(input: string, currency: FiatCurrency): number {
  const meta = FIAT_META[currency];
  const cleaned = input.replace(/[^0-9.]/g, '');
  if (!cleaned) return 0;
  const major = parseFloat(cleaned);
  if (Number.isNaN(major)) return 0;
  return Math.round(major * 10 ** meta.decimals);
}

/** Minor units → plain major-unit string for editable inputs (no symbol/grouping). */
export function minorToInput(amount: number, currency: FiatCurrency): string {
  if (!amount) return '';
  const meta = FIAT_META[currency];
  return (amount / 10 ** meta.decimals).toString();
}

// ─── Time ──────────────────────────────────────────────────────────────────---

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

/** Generate an Idempotency-Key for a money mutation (iron rule). */
export function newIdempotencyKey(prefix = 'st'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function totalFees(fees: Fee[]): number {
  return fees.reduce((sum, f) => sum + f.amount.amount, 0);
}

// ─── Estimate engine (mock) ───────────────────────────────────────────────────
// Deterministic so the entry screen's live preview and the executed order agree.

/**
 * Build an OrderEstimate from an asset + draft.
 * gross  = quantity * (limitPrice ?? estPrice)
 * fees   = commission (asset.feeBps) + provider fee, both in basis points of gross
 * total  = buy: gross + fees / sell: max(0, gross - fees)
 */
export function buildEstimate(
  asset: StockAsset,
  draft: { side: OrderSide; orderType: OrderType; quantity: number; limitPrice?: number },
): OrderEstimate {
  const { side, orderType, quantity, limitPrice } = draft;
  const currency = asset.currency;
  const estUnit = asset.price.amount;                                  // per share
  const unit = orderType === 'limit' && limitPrice ? limitPrice : estUnit;

  const grossMinor = Math.round(unit * quantity);

  const feeBps = asset.feeBps || PAYMAX_FEE_BPS;
  const commission = Math.round((grossMinor * feeBps) / 10_000);
  const providerFee = Math.round((grossMinor * PROVIDER_FEE_BPS) / 10_000);

  const fees: Fee[] = [
    { type: 'commission', amount: { amount: commission, currency } },
    { type: 'provider_fee', amount: { amount: providerFee, currency } },
  ];
  const feeSum = commission + providerFee;

  const totalMinor = side === 'buy' ? grossMinor + feeSum : Math.max(0, grossMinor - feeSum);

  return {
    side,
    orderType,
    symbol: asset.symbol,
    assetId: asset.id,
    quantity,
    estPrice: { amount: estUnit, currency },
    limitPrice: orderType === 'limit' && limitPrice ? { amount: limitPrice, currency } : undefined,
    gross: { amount: grossMinor, currency },
    fees,
    total: { amount: totalMinor, currency },
    settlementCycle: asset.settlementCycle,
  };
}

// ─── Chart (deterministic mock generator) ─────────────────────────────────────

/** Deterministic price history for the asset chart (ported from crypto). */
export function chartFor(asset: StockAsset, range: ChartRange): Candle[] {
  const points = { '1D': 24, '1W': 28, '1M': 30, '3M': 26, '1Y': 52 }[range];
  const stepMs = {
    '1D': 3_600_000,
    '1W': 6 * 3_600_000,
    '1M': 86_400_000,
    '3M': 3 * 86_400_000,
    '1Y': 7 * 86_400_000,
  }[range];
  const base = asset.price.amount;
  const seed = (asset.symbol + range).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const amp = asset.riskRating === 'high' ? 0.05 : asset.riskRating === 'medium' ? 0.03 : 0.012;
  return Array.from({ length: points }).map((_, i) => {
    const wobble = Math.sin((seed + i) / 3) * amp + Math.cos((seed + i) / 6) * amp * 0.6;
    const drift = (asset.change24hPct / 100) * (i / points);
    return {
      t: new Date(Date.now() - (points - i) * stepMs).toISOString(),
      price: Math.max(1, Math.round(base * (1 + wobble + drift - amp / 2))),
    };
  });
}
