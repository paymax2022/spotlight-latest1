// Source of truth the crypto screens code against (Backend role owns this file).
// Mirrors docs/crypto/data-model.md (Asset · CryptoQuote · Order · Position ·
// Transaction) and the Phase-3 (Crypto Buy/Sell MVP) surface in docs/crypto.
// IRON RULES honoured here (docs/crypto/architecture.md):
//  • Money is integer MINOR UNITS — fiat in kobo/cents, crypto in the asset's
//    base unit (8dp → we carry 1e8 "satoshi-style" minor units). Never floats.
//  • Fees, spreads, limits, availability are server-config — the client only
//    renders what the quote/asset payload says (never hard-coded here).
//    against a quoteId (price is never assumed stable).

/** Fiat currencies the invest wallet funds crypto from (NGN-first, USD where enabled). */
export type FiatCurrency = 'NGN' | 'USD';

/** Canonical fiat money object — integer minor units (kobo/cents) + ISO-4217. */
export interface FiatMoney {
  amount: number;
  currency: FiatCurrency;
}

/** A crypto amount — integer minor units in the asset's base precision. */
export interface CryptoAmount {
  amount: number;        // integer, minor units (10 ** asset.decimals per whole coin)
  symbol: string;        // 'BTC' | 'ETH' | 'USDT' …
}

export type AssetType = 'crypto';
export type RiskRating = 'low' | 'medium' | 'high';
export type AssetStatus = 'active' | 'paused' | 'delisted';

export interface SupportedNetwork {
  id: string;            // 'ethereum' | 'tron' | 'bitcoin' | 'base'
  name: string;          // 'Ethereum (ERC-20)'
  confirmations: number; // confirmations before credit
}

/**
 * A tradable crypto asset. Every control here is admin-set / server-driven —
 * the client treats it as read-only config (Rule 1: nothing hard-coded).
 */
export interface CryptoAsset {
  id: string;
  type: AssetType;
  symbol: string;        // 'BTC'
  name: string;          // 'Bitcoin'
  decimals: number;      // base-unit precision (8 for BTC, 6 for USDT…)
  iconColor: string;     // brand-palette token for the asset glyph tile
  riskRating: RiskRating;
  status: AssetStatus;
  // Capability flags — these come from the server, which is what actually enforces
  // them at fill time. A flag off here means the POST would be refused, not that the
  // UI chose to hide it.
  buyEnabled: boolean;
  sellEnabled: boolean;
  depositEnabled: boolean;
  withdrawalEnabled: boolean;
  // Limits (minor units of the settlement fiat) — server-config.
  minOrderAmount: number;
  // 0 means the server publishes no maximum (there is no such limit today). Screens
  // must read 0 as "no ceiling", never as "you may not trade".
  maxOrderAmount: number;
  // Pricing snapshot (display only; execution price comes from a fresh quote).
  price: FiatMoney;          // current indicative price per 1 coin
  // Absent when the feed quotes no previous-day open: "no data" is the truth, while
  // 0% would claim a flat market.
  change24hPct?: number;
  // Absent when the feed has no history. There is no market-cap source anywhere in
  // this stack, so the app never shows one.
  volume24h?: FiatMoney;
  supportedNetworks: SupportedNetwork[];
  description: string;
  riskDisclosure: string;
  kycTierRequired: number;   // min KYC tier to trade
}

export interface CandlePoint {
  t: string;             // ISO timestamp
  price: number;         // indicative price (settlement fiat, minor units)
}

export type ChartRange = '1H' | '1D' | '1W' | '1M' | '1Y';

export type OrderSide = 'buy' | 'sell';

/** A history row's kind: trades (buy/sell) plus on-chain movements. */
export type TxKind = OrderSide | 'deposit' | 'withdraw';
export type QuoteStatus = 'quoted' | 'locked' | 'consumed' | 'expired';
export type CryptoFeeType = 'paymax_fee' | 'provider_fee' | 'spread' | 'network_fee';

export interface CryptoFee {
  type: CryptoFeeType;
  amount: FiatMoney;
}

/** What the user typed: a fiat amount ("spend ₦x") or a crypto amount ("buy x BTC"). */
export type AmountBasis = 'fiat' | 'crypto';

/**
 * An executable quote. Every fee is itemised (docs: "never hide fees"). Execution
 * happens against `id` before `expiresAt` — past that the client must re-quote.
 */
export interface CryptoQuote {
  id: string;                  // 'cq_8Kds2' — server quote reference
  assetId: string;
  symbol: string;
  side: OrderSide;
  status: QuoteStatus;
  basis: AmountBasis;
  // Resolved both sides of the trade.
  fiat: FiatMoney;
  crypto: CryptoAmount;        // crypto bought/sold
  rate: FiatMoney;             // indicative price per 1 coin
  allInRate: FiatMoney;        // effective price per 1 coin after spread + fees
  // Absent when the server applies no spread. Displaying "0.50%" for a trade that
  // carries no spread is a invented number.
  spreadPct?: number;
  fees: CryptoFee[];
  totalFiat: FiatMoney;
  // Absent on the buy/sell plane: the quote carries only a price `source`, and this
  // platform neither routes the fill to a liquidity venue nor holds the asset with a
  // custodian — so no screen may name one.
  liquidityProvider?: string;
  custodyProvider?: string;
  // Absent when the server runs no pre-trade risk score.
  riskScore?: number;
  expiresAt: string;           // ISO — rate-lock countdown derives from this
}

export interface QuoteRequest {
  assetId: string;
  side: OrderSide;
  basis: AmountBasis;
  // null = the user has typed nothing yet. The screens must not build a quote from 0:
  // the server refuses a zero amount, and a preview of ₦0.00 is not information.
  amount: number | null;
  currency: FiatCurrency;
  lock?: boolean;
}

/** Subset of the crypto transaction state machine used by the buy/sell MVP. */
export type CryptoTxStatus =
  | 'QuoteAccepted'
  | 'Processing'
  | 'pending_review'
  | 'Filled'
  | 'PartiallyFilled'
  | 'Failed'
  | 'Reversed'
  | 'ComplianceHold';

export type DepositStatus = 'DepositDetected' | 'DepositConfirmed';

/** Any status a history row can carry: trades + deposit/withdrawal lifecycles. */
export type TxStatus = CryptoTxStatus | WithdrawalStatus | DepositStatus;

export type CryptoErrorType =
  | 'quote_expired'
  | 'insufficient_balance'
  | 'limit_exceeded'
  | 'asset_unavailable'
  | 'compliance_block'
  | 'provider_error'
  | 'internal';

/** Result of a buy/sell execution (server-authoritative). */
export interface CryptoOrder {
  id: string;
  reference: string;           // 'PMX-CR-123456' — user-facing
  assetId: string;
  symbol: string;
  side: OrderSide;
  status: CryptoTxStatus;
  fiat: FiatMoney;
  crypto: CryptoAmount;
  allInRate: FiatMoney;
  fees: CryptoFee[];
  totalFiat: FiatMoney;
  // Absent when the server does not name a broker for the fill — the legacy money
  // plane settles internally and reports no provider.
  provider?: string;
  // Absent when the order was settled internally instead of at an exchange — the
  // server publishes no provider reference for it, and inventing one would break the
  // rule that every order is traceable to a real provider fill.
  providerReference?: string;
  idempotencyKey: string;
  transactionId: string;
  failureReason?: string;
  createdAt: string;
}

/** Unified history row (docs/crypto/screens.md → crypto orders / transactions). */
export interface CryptoTransactionSummary {
  id: string;
  reference: string;
  side: TxKind;
  symbol: string;
  assetName: string;
  iconColor: string;
  status: TxStatus;
  fiat: FiatMoney;
  crypto: CryptoAmount;
  createdAt: string;
}

export interface CryptoTransactionDetail extends CryptoTransactionSummary {
  allInRate: FiatMoney;
  fees: CryptoFee[];
  totalFiat: FiatMoney;
  // The legacy fill plane records no broker, no liquidity partner and no custody
  // partner on an order, so all three are absent rather than blank strings; the
  // receipt hides those rows instead of printing an empty promise.
  provider?: string;
  providerReference?: string;
  liquidityProvider?: string;
  custodyProvider?: string;
  statusHistory: { status: TxStatus; at: string }[];
  failureReason?: string;
}

export interface Position {
  assetId: string;
  symbol: string;
  name: string;
  iconColor: string;
  riskRating: RiskRating;
  quantity: CryptoAmount;      // held amount
  averageCost: FiatMoney;      // average cost per 1 coin
  marketValue: FiatMoney;      // current value of the holding
  // Absent when the member has no fills for this asset: an unknown basis is not a
  // basis of zero, and P&L against zero would be a fabricated profit.
  costBasis?: FiatMoney;
  unrealizedGainLoss?: FiatMoney;
  unrealizedPct?: number;      // signed %
  price: FiatMoney;            // current price per coin
  change24hPct?: number;
}

export interface CryptoPortfolio {
  baseCurrency: FiatCurrency;
  totalValue: FiatMoney;       // crypto holdings market value
  totalCostBasis: FiatMoney;
  totalGainLoss?: FiatMoney;   // absent when no fill history exists to base it on
  totalGainLossPct?: number;
  dayChange: FiatMoney;
  // Absent when the feed has no previous-day open to compare against.
  dayChangePct?: number;
  investableBalance: FiatMoney; // available invest-wallet cash to deploy
  positions: Position[];
}

/** Why trading might be blocked — drives the restricted/KYC-pending states. */
export type EligibilityState =
  | 'eligible'
  | 'kyc_required'
  | 'kyc_pending'
  | 'suitability_required'
  | 'agreements_required'
  | 'restricted'
  | 'product_unavailable';

export interface CryptoEligibility {
  state: EligibilityState;
  kycTier: number;
  cryptoEnabled: boolean;      // server product flag for this user/region
  message: string;
  ctaRoute?: string;           // where the resolve-CTA sends the user
}

/** A single user watchlist entry — the asset id plus when it was added. */
export interface WatchlistEntry {
  assetId: string;
  addedAt: string;
}

export type AlertCondition = 'above' | 'below';
export type AlertStatus = 'active' | 'triggered' | 'paused';

export interface PriceAlert {
  id: string;
  assetId: string;
  symbol: string;
  iconColor: string;
  condition: AlertCondition;
  targetPrice: FiatMoney;       // fiat minor units, per 1 coin
  status: AlertStatus;
  triggeredAt: string | null;
  createdAt: string;
}

export interface NewPriceAlertDraft {
  assetId: string;
  condition: AlertCondition;
  targetPrice: number;          // fiat minor units
  currency: FiatCurrency;
}

export interface SwapDraft {
  fromAssetId: string;
  fromSymbol: string;
  toAssetId: string;
  toSymbol: string;
  fromAmount: number;          // crypto minor units of the `from` asset
}

/** An executable swap quote. Fee is charged in settlement fiat for transparency. */
export interface SwapQuote {
  id: string;                  // 'sq_…'
  fromAssetId: string;
  toAssetId: string;
  from: CryptoAmount;          // amount leaving
  to: CryptoAmount;            // amount received
  rate: number;                // `to` units per 1 `from` unit (display)
  spreadPct: number;
  fee: FiatMoney;              // swap fee in fiat
  fiatValue: FiatMoney;        // indicative fiat value of the trade
  liquidityProvider: string;
  expiresAt: string;
  // Set only when the exchange issued a firm quotation (Quidax: a 15-second window the
  // execution has to reference). Absent on the internal pricer, which quotes without
  // reserving anything.
  quotationId?: string;
}

/** What a swap execution needs: the trade itself, plus the firm quotation to honour. */
export interface SwapExecution {
  fromAssetId: string;
  toAssetId: string;
  fromUnits: number;
  quotationId?: string;
}

export interface SwapResult {
  id: string;
  reference: string;
  fromSymbol: string;
  toSymbol: string;
  status: CryptoTxStatus;
  from: CryptoAmount;
  to: CryptoAmount;
  fee: FiatMoney;
  provider: string;
  // Absent when the swap settled on the internal ledger instead of at a broker —
  // the server publishes no exchange fill id for it.
  providerReference?: string;
  idempotencyKey: string;
  transactionId: string;
  failureReason?: string;
  createdAt: string;
}

/** A custody-provider deposit address for one asset on one network. */
export interface DepositAddress {
  symbol: string;
  networkId: string;
  networkName: string;
  address: string;
  memo?: string;             // destination tag / memo where the network needs one
  minDeposit: CryptoAmount;  // amounts below this are not credited
  confirmations: number;     // confirmations before the deposit is credited
  custodyProvider: string;
}

/**
 * A settled money-IN credit as journaled by the backend (GET /crypto/deposits). A row exists
 * ONLY once the transfer reached its confirmation floor and was credited exactly once, so the
 * presence of a record IS the "credited" fact the deposit pending→credited screen waits on.
 * `units` are integer asset minor units; render with minorUnitScale.
 */
export interface CryptoDepositRecord {
  id: string;
  provider: string;
  providerOpId: string;
  symbol: string;
  network: string;
  address?: string;
  units: number;             // integer minor units
  minorUnitScale: number;    // e.g. 1e8 for BTC
  confirmations: number;
  requiredConfs: number;
  txHash?: string;
  createdAt: string;
  creditedAt: string;
  credited: boolean;         // confirmations >= requiredConfs
}

/** A saved, whitelisted destination address (Phase-4 withdrawal control). */
export interface CryptoAddress {
  id: string;
  label: string;
  symbol: string;          // asset the address belongs to
  networkId: string;       // must be one of the asset's supportedNetworks
  networkName: string;
  address: string;
  whitelisted: boolean;    // passed whitelist confirmation
  screened: boolean;       // passed address risk screening
  addedAt: string;
}

export interface NewAddressDraft {
  label: string;
  symbol: string;
  networkId: string;
  address: string;
}

/** Address risk-screening outcome (docs/crypto/compliance.md → address screening). */
export interface AddressScreening {
  risk: 'clear' | 'flagged';
  reason?: string;
}

/** Why a withdrawal might be blocked — drives the restricted/cooling states. */
export type WithdrawalGate =
  | 'eligible'
  | 'kyc_tier_required'      // needs Tier 2+
  | 'withdrawals_disabled'   // feature-flagged off / asset withdrawal disabled
  | 'cooling_period'         // new device/address cooling window
  | 'restricted';

export interface WithdrawalEligibility {
  gate: WithdrawalGate;
  kycTier?: number;              // absent when the server does not report a tier
  manualReviewOnly: boolean;
  dailyLimit: FiatMoney;
  dailyUsed: FiatMoney;
  manualReviewThreshold: FiatMoney;
  coolingEndsAt?: string;      // ISO, when gate === 'cooling_period'
  message: string;
}

export interface WithdrawalDraft {
  assetId: string;
  symbol: string;
  networkId: string;
  addressId: string;
  amount: number;              // crypto minor units
}

/** Itemised withdrawal preview — network fee is the headline transparency line. */
export interface WithdrawalQuote {
  symbol: string;
  networkId: string;
  networkName: string;
  amount: CryptoAmount;        // amount leaving the wallet
  networkFee: CryptoAmount;    // miner/network fee (in-asset)
  paymaxFee: FiatMoney;        // processing fee (fiat)
  receiveAmount: CryptoAmount; // amount arriving at the destination
  fiatValue: FiatMoney;        // indicative fiat value of the withdrawal
  requiresManualReview: boolean;
  expiresAt: string;
}

/** Withdrawal state machine subset (docs/crypto/data-model.md → Crypto Tx). */
export type WithdrawalStatus =
  | 'WithdrawalPendingReview'
  | 'WithdrawalApproved'
  | 'WithdrawalBroadcasting'
  | 'WithdrawalConfirmed'
  | 'WithdrawalFailed'
  | 'ComplianceHold'
  | 'Blocked';

export interface WithdrawalResult {
  id: string;
  reference: string;
  symbol: string;
  status: WithdrawalStatus;
  amount: CryptoAmount;
  networkFee: CryptoAmount;
  address: string;
  networkName: string;
  providerReference?: string;   // absent until the provider actually broadcasts
  idempotencyKey: string;
  createdAt: string;
  failureReason?: string;
}

export interface TradeDraft {
  assetId: string;
  symbol: string;
  side: OrderSide;
  basis: AmountBasis;
  amount: number;              // minor units of the `basis` side
  currency: FiatCurrency;
}
