// ── Paymax Invest · Stocks — Constants ───────────────────────────────────────
// Display catalogue + illustrative fee config + UI option lists.
// All money is integer minor units. Fees here are MOCK defaults only — in
// production every value comes from the server asset/estimate payload.

import { Colors } from '@/constants/colors';
import type {
  ChartRange,
  FiatCurrency,
  MarketStatus,
  OrderSide,
  RiskRating,
  StockExchange,
} from '../types/stocks.types';

/** Feature flag gating the whole stocks surface. */
export const STOCKS_FEATURE_FLAG = 'invest_stocks';

/** Settlement fiat for the MVP (NGN-first). */
export const DEFAULT_FIAT: FiatCurrency = 'NGN';

/** Fiat display metadata. */
export const FIAT_META: Record<FiatCurrency, { symbol: string; decimals: number; flag: string }> = {
  NGN: { symbol: '₦', decimals: 2, flag: '🇳🇬' },
  USD: { symbol: '$', decimals: 2, flag: '🇺🇸' },
};

// ─── Fee config (transparency line in the order breakdown) ────────────────────
// Illustrative basis-point markup — server overrides per asset/tier. The
// per-asset `feeBps` on a StockAsset takes priority over this default.

export const PAYMAX_FEE_BPS = 25;       // 0.25% Paymax commission (default)
export const PROVIDER_FEE_BPS = 10;     // 0.10% broker/provider fee

export const STOCK_FEE_LABEL: Record<string, string> = {
  commission: 'Commission',
  paymax_fee: 'Paymax fee',
  provider_fee: 'Provider fee',
};

/** Suggested fiat amounts per currency (minor units), for quick-buy chips. */
export const SUGGESTED_AMOUNTS: Record<FiatCurrency, number[]> = {
  NGN: [10_000_00, 50_000_00, 100_000_00, 500_000_00],  // ₦10k, ₦50k, ₦100k, ₦500k
  USD: [50_00, 100_00, 500_00, 1_000_00],               // $50, $100, $500, $1,000
};

// ─── Chart ranges ─────────────────────────────────────────────────────────────

export const CHART_RANGES: { value: ChartRange; label: string }[] = [
  { value: '1D', label: '1D' },
  { value: '1W', label: '1W' },
  { value: '1M', label: '1M' },
  { value: '3M', label: '3M' },
  { value: '1Y', label: '1Y' },
];

// ─── Risk rating → chip styling (design tokens only) ──────────────────────────

export const RISK_STYLE: Record<RiskRating, { label: string; fg: string; bg: string }> = {
  low:    { label: 'Lower risk',  fg: Colors.tertiaryContainer, bg: Colors.iconBgTeal },
  medium: { label: 'Medium risk', fg: Colors.onWarning,         bg: Colors.iconBgGold },
  high:   { label: 'Higher risk', fg: Colors.error,             bg: Colors.iconBgRed },
};

// ─── Order status → chip styling (stock state machine) ────────────────────────
// Teal = completed/settled · Purple = in-flight · Gold = action/hold · Red = terminal-bad.

export const STOCK_STATUS_STYLE: Record<
  string,
  { label: string; fg: string; bg: string }
> = {
  Draft:                    { label: 'Draft',         fg: Colors.onSurfaceVariant,      bg: Colors.surfaceContainerHigh },
  PreCheckFailed:           { label: 'Check failed',  fg: Colors.error,                 bg: Colors.iconBgRed },
  AwaitingUserConfirmation: { label: 'Confirm',       fg: Colors.onWarning,             bg: Colors.iconBgGold },
  Submitted:                { label: 'Submitted',     fg: Colors.onPrimaryFixedVariant, bg: Colors.iconBgPurple },
  AcceptedByProvider:       { label: 'Accepted',      fg: Colors.onPrimaryFixedVariant, bg: Colors.iconBgPurple },
  PartiallyFilled:          { label: 'Partial fill',  fg: Colors.onPrimaryFixedVariant, bg: Colors.iconBgPurple },
  Filled:                   { label: 'Filled',        fg: Colors.tertiaryContainer,     bg: Colors.iconBgTeal },
  PendingSettlement:        { label: 'Settling',      fg: Colors.onPrimaryFixedVariant, bg: Colors.iconBgPurple },
  Settled:                  { label: 'Settled',       fg: Colors.tertiaryContainer,     bg: Colors.iconBgTeal },
  CancelRequested:          { label: 'Cancelling',    fg: Colors.onWarning,             bg: Colors.iconBgGold },
  Cancelled:                { label: 'Cancelled',     fg: Colors.error,                 bg: Colors.iconBgRed },
  Rejected:                 { label: 'Rejected',      fg: Colors.error,                 bg: Colors.iconBgRed },
  Failed:                   { label: 'Failed',        fg: Colors.error,                 bg: Colors.iconBgRed },
  ReversalPending:          { label: 'Reversing',     fg: Colors.onWarning,             bg: Colors.iconBgGold },
  Reversed:                 { label: 'Reversed',      fg: Colors.error,                 bg: Colors.iconBgRed },
};

// ─── Market status → chip styling ─────────────────────────────────────────────

export const MARKET_STATUS_STYLE: Record<MarketStatus, { label: string; fg: string; bg: string }> = {
  open:   { label: 'Market open',    fg: Colors.tertiaryContainer,     bg: Colors.iconBgTeal },
  closed: { label: 'Market closed',  fg: Colors.onSurfaceVariant,      bg: Colors.surfaceContainerHigh },
  pre:    { label: 'Pre-market',     fg: Colors.onPrimaryFixedVariant, bg: Colors.iconBgPurple },
  post:   { label: 'After-hours',    fg: Colors.onPrimaryFixedVariant, bg: Colors.iconBgPurple },
};

// ─── Exchange labels ──────────────────────────────────────────────────────────

export const EXCHANGE_LABEL: Record<StockExchange, string> = {
  NGX: 'Nigerian Exchange',
  NASDAQ: 'NASDAQ',
  NYSE: 'New York Stock Exchange',
};

// ─── Sector taxonomy (filter chips) ───────────────────────────────────────────

export const SECTORS: string[] = [
  'Banking',
  'Industrial Goods',
  'Consumer Goods',
  'Telecoms',
  'Oil & Gas',
  'Technology',
  'Automotive',
  'ETF',
];

// ─── Order side display ───────────────────────────────────────────────────────

export const SIDE_LABEL: Record<OrderSide, string> = {
  buy: 'Buy',
  sell: 'Sell',
};

// ─── Risk / education copy (education-first) ──────────────────────────────────

export const NO_ADVICE_DISCLOSURE =
  'This is general information, not financial advice. Paymax does not recommend specific stocks.';

export const SETTLEMENT_NOTE =
  'Trades settle on the exchange settlement cycle. Sale proceeds are available to withdraw once the trade has settled.';

export const MARKET_CLOSED_NOTE =
  'The market is currently closed. Orders placed now are queued and execute when the market next opens.';
