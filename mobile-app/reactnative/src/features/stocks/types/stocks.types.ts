// ── Paymax Invest · Stocks — Type Contract ───────────────────────────────────
// Source of truth the stocks screens code against. Mirrors the crypto module
// (Asset · Order · Position · Portfolio) for the equities/ETF surface.
//
// IRON RULES (same as crypto):
//  • Money is integer MINOR UNITS — fiat in kobo/cents. Never floats.
//  • Fees, limits, availability are server-config — the client renders what the
//    asset/estimate payload says (never hard-coded).
//  • Every order mutation carries an Idempotency-Key.

// ─── Money primitives ─────────────────────────────────────────────────────────

/** Fiat currencies the invest wallet funds stock orders from (NGN-first, USD where enabled). */
export type FiatCurrency = 'NGN' | 'USD';

/** Canonical fiat money object — integer minor units (kobo/cents) + ISO-4217. */
export interface FiatMoney {
  amount: number;        // integer, minor units (e.g. 105000 = ₦1,050.00)
  currency: FiatCurrency;
}

// ─── Market / asset enums ─────────────────────────────────────────────────────

export type StockExchange = 'NGX' | 'NASDAQ' | 'NYSE';
export type MarketStatus = 'open' | 'closed' | 'pre' | 'post';
export type RiskRating = 'low' | 'medium' | 'high';
export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';

/** Stock order state machine (broker/provider lifecycle). */
export type StockOrderStatus =
  | 'Draft'
  | 'PreCheckFailed'
  | 'AwaitingUserConfirmation'
  | 'Submitted'
  | 'AcceptedByProvider'
  | 'PartiallyFilled'
  | 'Filled'
  | 'PendingSettlement'
  | 'Settled'
  | 'CancelRequested'
  | 'Cancelled'
  | 'Rejected'
  | 'Failed'
  | 'ReversalPending'
  | 'Reversed';

// ─── Asset (admin-whitelisted, server-driven config) ──────────────────────────

/**
 * A tradable stock / ETF. Every control here is admin-set / server-driven — the
 * client treats it as read-only config (nothing hard-coded).
 */
export interface StockAsset {
  id: string;
  type: 'stock';
  symbol: string;            // 'DANGCEM'
  name: string;              // 'Dangote Cement Plc'
  exchange: StockExchange;
  sector: string;
  currency: FiatCurrency;
  iconColor: string;         // brand-palette token for the ticker glyph tile
  riskRating: RiskRating;
  status: 'active' | 'paused' | 'delisted';
  // Capability flags.
  buyEnabled: boolean;
  sellEnabled: boolean;
  marketStatus: MarketStatus;
  // Pricing snapshot (display only; execution price comes from the estimate/fill).
  price: FiatMoney;          // last/indicative price per share
  change24hPct: number;      // signed % move
  dayChange: FiatMoney;      // signed price change today (per share)
  week52High: FiatMoney;
  week52Low: FiatMoney;
  marketCap: FiatMoney;
  volume: number;            // shares traded
  bid: FiatMoney;
  ask: FiatMoney;
  summary: string;
  riskDisclosure: string;
  // Fees / settlement / limits — server-config.
  feeBps: number;            // commission in basis points
  settlementCycle: string;   // 'T+3' (NGX) / 'T+2' (US)
  minOrderAmount: number;    // minor units of the settlement fiat
  maxOrderAmount: number;
  kycTierRequired: number;
}

export interface Candle {
  t: string;                 // ISO timestamp
  price: number;             // indicative price (settlement fiat, minor units)
}

export type ChartRange = '1D' | '1W' | '1M' | '3M' | '1Y';

// ─── News / dividends / corporate actions ─────────────────────────────────────

export interface StockNews {
  id: string;
  title: string;
  source: string;
  publishedAt: string;       // ISO
  summary: string;
}

export interface Dividend {
  id: string;
  symbol: string;
  exDate: string;            // ISO
  payDate: string;           // ISO
  amountPerShare: FiatMoney;
  status: 'announced' | 'paid';
}

export interface CorporateAction {
  id: string;
  symbol: string;
  type: string;              // 'split' | 'bonus' | 'agm' …
  title: string;
  description: string;
  exDate: string;            // ISO
  status: string;
}

// ─── Fees / order estimate ────────────────────────────────────────────────────

export interface Fee {
  type: string;
  amount: FiatMoney;
}

/** Pre-trade estimate the entry screen previews; the API executes the same math. */
export interface OrderEstimate {
  side: OrderSide;
  orderType: OrderType;
  symbol: string;
  assetId: string;
  quantity: number;          // whole shares
  estPrice: FiatMoney;       // indicative price per share
  limitPrice?: FiatMoney;    // for limit orders
  gross: FiatMoney;          // qty * (limit ?? est) price
  fees: Fee[];
  total: FiatMoney;          // buy: gross + fees / sell: gross - fees
  settlementCycle: string;
}

// ─── Order (server-authoritative result) ──────────────────────────────────────

export interface StockOrder {
  id: string;
  reference: string;             // 'PMX-ST-123456' — user-facing
  assetId: string;
  symbol: string;
  name: string;
  side: OrderSide;
  orderType: OrderType;
  status: StockOrderStatus;
  quantity: number;
  filledQuantity: number;
  price: FiatMoney;              // executed / indicative price per share
  limitPrice?: FiatMoney;
  gross: FiatMoney;
  fees: Fee[];
  total: FiatMoney;
  provider: string;
  providerReference: string;     // every order traceable to a provider ref
  settlementDate?: string;       // ISO
  idempotencyKey: string;
  failureReason?: string;
  createdAt: string;
  statusHistory: { status: StockOrderStatus; at: string }[];
}

// ─── Portfolio / positions ────────────────────────────────────────────────────

export interface StockPosition {
  assetId: string;
  symbol: string;
  name: string;
  exchange: StockExchange;
  iconColor: string;
  quantity: number;              // shares held
  averageCost: FiatMoney;        // average cost per share
  marketValue: FiatMoney;        // current value of the holding
  costBasis: FiatMoney;          // total invested
  unrealizedGainLoss: FiatMoney;
  unrealizedPct: number;         // signed %
  price: FiatMoney;              // current price per share
  change24hPct: number;
}

export interface StockPortfolio {
  baseCurrency: FiatCurrency;
  totalValue: FiatMoney;         // holdings market value
  totalCostBasis: FiatMoney;
  totalGainLoss: FiatMoney;
  totalGainLossPct: number;
  dayChange: FiatMoney;
  dayChangePct: number;
  investableBalance: FiatMoney;  // available invest-wallet cash to deploy
  positions: StockPosition[];
}

// ─── Public offers (IPO / rights issues) ──────────────────────────────────────

export interface PublicOffer {
  id: string;
  symbol: string;
  name: string;
  kind: 'ipo' | 'rights';
  priceLow: FiatMoney;
  priceHigh: FiatMoney;
  openDate: string;              // ISO
  closeDate: string;             // ISO
  minUnits: number;
  status: 'open' | 'upcoming' | 'closed';
  summary: string;
}

// ─── Draft the screens build up before hitting a mutation ─────────────────────

export interface OrderDraft {
  assetId: string;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;              // whole shares
  limitPrice?: number;           // fiat minor units per share (limit orders)
}
