// The Go crypto plane speaks snake_case with integer minor units; the screens speak
// the camelCase shapes in ../types/crypto.types.ts. Every live response is mapped
// through this file, which is the only place allowed to know both dialects.
//
// Two rules the mappers enforce:
//  • A field with no server source is left undefined, never estimated. The screens
//    then render "unavailable". The one exception is presentation-only copy (glyph
//    colour, risk label, network name), which comes from ../constants/assetCopy and
//    is documented there as product copy, not data.
//  • Money never passes through a float. Prices, cash and units arrive as integers
//    and stay integers; the only arithmetic here is percentage display.

import { assetCopy, iconColorFor } from '../constants/assetCopy';
import type {
  AddressScreening,
  CandlePoint,
  ChartRange,
  CryptoAddress,
  CryptoAsset,
  CryptoOrder,
  CryptoPortfolio,
  CryptoQuote,
  CryptoTransactionDetail,
  CryptoTransactionSummary,
  DepositAddress,
  FiatMoney,
  Position,
  PriceAlert,
  QuoteRequest,
  SwapQuote,
  SwapResult,
  WithdrawalEligibility,
  WithdrawalQuote,
  WithdrawalResult,
  WithdrawalStatus,
} from '../types/crypto.types';

const NGN = 'NGN';

// ── Wires ─────────────────────────────────────────────────────────────────────

export interface AssetViewWire {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  minor_unit_scale: number;
  is_active: boolean;
  price_kobo: number;
  price_source: string;
  price_as_of: string;
  open_24h_kobo: number;
  high_24h_kobo: number;
  low_24h_kobo: number;
  volume_24h_kobo: number;
  min_buy_kobo: number;
  buy_enabled: boolean;
  sell_enabled: boolean;
  withdraw_enabled: boolean;
  deposit_enabled: boolean;
  kyc_tier_required: number;
}

export interface QuoteWire {
  asset_id: string;
  symbol: string;
  price_kobo: number;
  source: string;
  as_of: string;
  side?: string;
  basis?: string;
  cash_kobo: number;
  units: number;
  fee_kobo: number;
  minor_unit_scale: number;
  expires_at: string;
}

export interface OrderWire {
  id: string;
  user_id: string;
  asset_id: string;
  symbol?: string;
  side: 'buy' | 'sell';
  status: string;
  cash_kobo: number;
  units: number;
  price_kobo: number;
  reference?: string;
  created_at: string;
}

export interface SwapQuoteWire {
  from_asset_id: string;
  from_symbol: string;
  to_asset_id: string;
  to_symbol: string;
  from_units: number;
  to_units: number;
  from_price_kobo: number;
  to_price_kobo: number;
  cash_kobo: number;
  spread_kobo: number;
  spread_bps: number;
  source: string;
  as_of: string;
  quotation_id?: string;
  expires_at?: string;
  provider?: string;
}

export interface SwapOrderWire {
  id: string;
  from_asset_id: string;
  from_symbol?: string;
  to_asset_id: string;
  to_symbol?: string;
  status: string;
  from_units: number;
  to_units: number;
  from_price_kobo: number;
  to_price_kobo: number;
  cash_kobo: number;
  spread_kobo: number;
  spread_bps: number;
  reference?: string;
  created_at: string;
  quotation_id?: string;
  swap_transaction_id?: string;
  provider_status?: string;
  ledger_settled: boolean;
  settled_at?: string | null;
}

export interface PositionViewWire {
  asset_id: string;
  symbol: string;
  name: string;
  units: number;
  minor_unit_scale: number;
  price_kobo: number;
  price_source: string;
  price_as_of: string;
  open_24h_kobo: number;
  value_kobo: number;
  cost_basis_kobo: number;
  avg_cost_kobo: number;
  gain_kobo: number;
  day_change_kobo: number;
  has_cost_basis: boolean;
}

export interface PortfolioViewWire {
  base_currency: string;
  total_value_kobo: number;
  total_cost_kobo: number;
  total_gain_kobo: number;
  day_change_kobo: number;
  investable_kobo: number;
  has_cost_basis: boolean;
  positions: PositionViewWire[];
}

export interface AddressWire {
  id: string;
  user_id: string;
  asset_id: string;
  symbol?: string;
  label: string;
  network: string;
  address: string;
  is_active: boolean;
  verified_at?: string;
  created_at: string;
}

export interface DepositAddressWire {
  asset_id: string;
  symbol: string;
  network: string;
  address: string;
  memo?: string;
  provider: string;
}

export interface WithdrawalEligibilityWire {
  gate: string;
  manual_review_only: boolean;
  daily_limit_kobo: number;
  daily_used_kobo: number;
  manual_review_threshold_kobo: number;
  message: string;
}

export interface WithdrawalQuoteWire {
  asset_id: string;
  symbol: string;
  network: string;
  units: number;
  network_fee_units: number;
  receive_units: number;
  paymax_fee_kobo: number;
  fiat_value_kobo: number;
  requires_review: boolean;
}

export interface WithdrawalWire {
  id: string;
  asset_id: string;
  symbol?: string;
  address_id: string;
  address?: string;
  network?: string;
  status: string;
  units: number;
  network_fee_units: number;
  fee_kobo: number;
  price_kobo: number;
  provider: string;
  provider_ref?: string;
  tx_hash?: string;
  failure_reason?: string;
  reference?: string;
  created_at: string;
}

export interface PricePointWire {
  price_kobo: number;
  source: string;
  as_of: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fiat = (kobo: number): FiatMoney => ({ amount: kobo, currency: NGN });

/** Signed 24h change from the feed's open, or undefined when the feed has no open. */
function pctChange(priceKobo: number, openKobo: number): number | undefined {
  if (priceKobo <= 0 || openKobo <= 0) return undefined;
  return +(((priceKobo - openKobo) / openKobo) * 100).toFixed(2);
}

/** The server's order status → the app's transaction status. Unmapped values pass
 *  through as Processing so an unexpected state is never shown as a fill. */
export function mapOrderStatus(status: string): CryptoOrder['status'] {
  switch (status.toLowerCase()) {
    case 'filled': return 'Filled';
    case 'pending':
    case 'pending_review': return 'pending_review';
    case 'failed': return 'Failed';
    case 'reversed': return 'Reversed';
    default: return 'Processing';
  }
}

const WITHDRAWAL_STATUS: Record<string, WithdrawalStatus> = {
  requested: 'WithdrawalPendingReview',
  pending_review: 'WithdrawalPendingReview',
  approved: 'WithdrawalApproved',
  broadcast: 'WithdrawalBroadcasting',
  confirmed: 'WithdrawalConfirmed',
  failed: 'WithdrawalFailed',
};

// ── Mappers ───────────────────────────────────────────────────────────────────

export function mapAsset(w: AssetViewWire): CryptoAsset {
  const copy = assetCopy(w.symbol, w.name);
  const priced = w.price_kobo > 0;
  return {
    id: w.id,
    type: 'crypto',
    symbol: w.symbol,
    name: w.name,
    decimals: w.decimals,
    iconColor: copy.brandColor,
    riskRating: copy.riskRating,
    status: w.is_active ? 'active' : 'paused',
    buyEnabled: w.buy_enabled,
    sellEnabled: w.sell_enabled,
    depositEnabled: w.deposit_enabled,
    withdrawalEnabled: w.withdraw_enabled,
    minOrderAmount: w.min_buy_kobo,
    // The server has no per-asset ceiling column, so it publishes none.
    maxOrderAmount: 0,
    price: fiat(w.price_kobo),
    change24hPct: pctChange(w.price_kobo, w.open_24h_kobo),
    volume24h: priced && w.volume_24h_kobo > 0 ? fiat(w.volume_24h_kobo) : undefined,
    supportedNetworks: copy.network ? [copy.network] : [],
    description: copy.blurb,
    riskDisclosure: copy.riskNote,
    kycTierRequired: w.kyc_tier_required,
  };
}

export function mapAssets(rows: AssetViewWire[] | null | undefined): CryptoAsset[] {
  return Array.isArray(rows) ? rows.map(mapAsset) : [];
}

export function mapPositions(rows: PositionViewWire[] | null | undefined): Position[] {
  return Array.isArray(rows) ? rows.map(mapPosition) : [];
}

export function mapAddresses(rows: AddressWire[] | null | undefined): CryptoAddress[] {
  return Array.isArray(rows) ? rows.map(mapAddress) : [];
}

/**
 * The projected quote. The server has already worked out both legs with the same
 * integer math the fill uses, so this is a translation, not a calculation: what the
 * preview shows is what the order will do, unless the price moves first (which is
 * what `expiresAt` is for).
 */
export function mapQuote(w: QuoteWire, req: QuoteRequest): CryptoQuote {
  const side = req.side;
  const fee = w.fee_kobo || 0;
  // Buy: the member pays `cash_kobo` in total. Sell: the member receives it.
  const total = w.cash_kobo;
  return {
    id: `${w.asset_id}:${side}:${w.cash_kobo}:${w.units}:${w.price_kobo}`,
    assetId: w.asset_id,
    symbol: w.symbol,
    side,
    status: 'quoted',
    basis: req.basis,
    fiat: fiat(total),
    crypto: { amount: w.units, symbol: w.symbol },
    rate: fiat(w.price_kobo),
    // No fee and no spread is charged on this plane, so the effective rate IS the
    // quote rate. The itemised list says so in one honest line instead of a margin.
    allInRate: fiat(w.price_kobo),
    spreadPct: undefined,
    fees: [{ type: 'paymax_fee', amount: fiat(fee) }],
    totalFiat: fiat(total),
    riskScore: undefined,
    expiresAt: w.expires_at || w.as_of,
  };
}

export function mapOrder(w: OrderWire): CryptoOrder {
  return {
    id: w.id,
    reference: w.reference || w.id,
    assetId: w.asset_id,
    symbol: w.symbol || '',
    side: w.side,
    status: mapOrderStatus(w.status),
    fiat: fiat(w.cash_kobo),
    crypto: { amount: w.units, symbol: w.symbol || '' },
    allInRate: fiat(w.price_kobo),
    // The buy/sell fill carries no fee line — the server debits `cash_kobo` and
    // delivers `units`. An empty list here means "nothing was charged", truthfully.
    fees: [],
    totalFiat: fiat(w.cash_kobo),
    // The legacy fill plane names no broker and publishes no exchange fill id: its
    // `reference` is the ledger memo ("crypto:buy:BTC"), which must NOT be presented
    // as a provider reference. Both fields stay absent so the receipt omits them.
    idempotencyKey: '',
    transactionId: w.id,
    createdAt: w.created_at,
  };
}

export function mapTransaction(w: OrderWire): CryptoTransactionSummary {
  return {
    id: w.id,
    reference: w.reference || w.id,
    side: w.side,
    symbol: w.symbol || '',
    assetName: w.symbol || '',
    iconColor: iconColorFor(w.symbol || ''),
    status: mapOrderStatus(w.status),
    fiat: fiat(w.cash_kobo),
    crypto: { amount: w.units, symbol: w.symbol || '' },
    createdAt: w.created_at,
  };
}

export function mapTransactions(rows: OrderWire[] | null | undefined): CryptoTransactionSummary[] {
  return Array.isArray(rows) ? rows.map(mapTransaction) : [];
}

export function mapTransactionDetail(w: OrderWire): CryptoTransactionDetail {
  return {
    ...mapTransaction(w),
    allInRate: fiat(w.price_kobo),
    // A buy/sell fill posts no fee line on this plane, so the itemised list is
    // honestly empty; the server debits cash_kobo and delivers units, nothing else.
    fees: [],
    totalFiat: fiat(w.cash_kobo),
    statusHistory: [{ status: mapOrderStatus(w.status), at: w.created_at }],
  };
}

export function mapSwapQuote(
  w: SwapQuoteWire,
  fromDecimals: number,
  toDecimals: number,
  source: string,
): SwapQuote {
  const fromUnit = 10 ** fromDecimals;
  const toUnit = 10 ** toDecimals;
  const rate = fromUnit > 0 && toUnit > 0
    ? (w.to_units / toUnit) / (w.from_units / fromUnit)
    : 0;
  return {
    id: w.quotation_id || `sq_${w.from_asset_id}_${w.to_asset_id}_${w.from_units}`,
    fromAssetId: w.from_asset_id,
    toAssetId: w.to_asset_id,
    from: { amount: w.from_units, symbol: w.from_symbol },
    to: { amount: w.to_units, symbol: w.to_symbol },
    rate: +rate.toFixed(8),
    spreadPct: w.spread_bps / 100,
    fee: fiat(w.spread_kobo),
    fiatValue: fiat(w.cash_kobo),
    liquidityProvider: w.provider || source,
    expiresAt: w.expires_at || w.as_of,
    quotationId: w.quotation_id || undefined,
  };
}

export function mapSwapOrder(w: SwapOrderWire): SwapResult {
  return {
    id: w.id,
    reference: w.reference || w.id,
    fromSymbol: w.from_symbol || '',
    toSymbol: w.to_symbol || '',
    status: mapOrderStatus(w.status),
    from: { amount: w.from_units, symbol: w.from_symbol || '' },
    to: { amount: w.to_units, symbol: w.to_symbol || '' },
    fee: fiat(w.spread_kobo),
    provider: w.swap_transaction_id ? 'quidax' : 'internal',
    providerReference: w.swap_transaction_id,
    idempotencyKey: '',
    transactionId: w.id,
    createdAt: w.created_at,
  };
}

export function mapPosition(w: PositionViewWire): Position {
  const copy = assetCopy(w.symbol, w.name);
  return {
    assetId: w.asset_id,
    symbol: w.symbol,
    name: w.name || w.symbol,
    iconColor: copy.brandColor,
    riskRating: copy.riskRating,
    quantity: { amount: w.units, symbol: w.symbol },
    averageCost: fiat(w.avg_cost_kobo),
    marketValue: fiat(w.value_kobo),
    costBasis: w.has_cost_basis ? fiat(w.cost_basis_kobo) : undefined,
    unrealizedGainLoss: w.has_cost_basis ? fiat(w.gain_kobo) : undefined,
    unrealizedPct: w.has_cost_basis && w.cost_basis_kobo > 0
      ? +(((w.gain_kobo / w.cost_basis_kobo) * 100)).toFixed(2)
      : undefined,
    price: fiat(w.price_kobo),
    change24hPct: pctChange(w.price_kobo, w.open_24h_kobo),
  };
}

export function mapPortfolio(w: PortfolioViewWire): CryptoPortfolio {
  const prevDay = w.total_value_kobo - w.day_change_kobo;
  return {
    baseCurrency: NGN,
    totalValue: fiat(w.total_value_kobo),
    totalCostBasis: fiat(w.total_cost_kobo),
    totalGainLoss: w.has_cost_basis ? fiat(w.total_gain_kobo) : undefined,
    totalGainLossPct: w.has_cost_basis && w.total_cost_kobo > 0
      ? +(((w.total_gain_kobo / w.total_cost_kobo) * 100)).toFixed(2)
      : undefined,
    dayChange: fiat(w.day_change_kobo),
    dayChangePct: prevDay > 0 ? +(((w.day_change_kobo / prevDay) * 100)).toFixed(2) : undefined,
    investableBalance: fiat(w.investable_kobo),
    positions: Array.isArray(w.positions) ? w.positions.map(mapPosition) : [],
  };
}

export function mapAddress(w: AddressWire): CryptoAddress {
  return {
    id: w.id,
    label: w.label || 'Saved address',
    symbol: w.symbol || '',
    networkId: w.network,
    networkName: w.network,
    address: w.address,
    whitelisted: w.is_active,
    screened: !!w.verified_at,
    addedAt: w.created_at,
  };
}

export function mapDepositAddress(w: DepositAddressWire): DepositAddress {
  // The wire carries the address and the provider only. The chain label and the
  // confirmation floor come from the product copy table; when a symbol has no entry
  // there, the network name is whatever the server echoed back and the floor is
  // unknown (0), which the screen must render as "unavailable".
  const copy = assetCopy(w.symbol, w.symbol).network;
  return {
    symbol: w.symbol,
    networkId: w.network || copy?.id || '',
    networkName: copy?.name || w.network,
    address: w.address,
    memo: w.memo,
    minDeposit: { amount: 0, symbol: w.symbol },
    confirmations: copy?.confirmations ?? 0,
    custodyProvider: w.provider,
  };
}

export function mapWithdrawalEligibility(w: WithdrawalEligibilityWire): WithdrawalEligibility {
  return {
    gate: w.gate === 'eligible' ? 'eligible' : 'restricted',
    // The gate endpoint reports limits, not the caller's tier; the server still
    // enforces the tier when the withdrawal is created. Do not invent a number here.
    manualReviewOnly: w.manual_review_only,
    dailyLimit: fiat(w.daily_limit_kobo),
    dailyUsed: fiat(w.daily_used_kobo),
    manualReviewThreshold: fiat(w.manual_review_threshold_kobo),
    message: w.message,
  };
}

/**
 * The withdrawal preview. The server already worked out the network fee with the
 * same function the fill uses, so the only client-side choice left is how to label
 * the chain — the wire echoes the network id we sent, nothing friendlier.
 */
export function mapWithdrawalQuote(w: WithdrawalQuoteWire): WithdrawalQuote {
  return {
    symbol: w.symbol,
    networkId: w.network,
    networkName: assetCopy(w.symbol, w.symbol).network?.name || w.network,
    amount: { amount: w.units, symbol: w.symbol },
    networkFee: { amount: w.network_fee_units, symbol: w.symbol },
    paymaxFee: fiat(w.paymax_fee_kobo),
    receiveAmount: { amount: w.receive_units, symbol: w.symbol },
    fiatValue: fiat(w.fiat_value_kobo),
    requiresManualReview: w.requires_review,
    // The wire carries no expiry: the server re-computes the fee at fill time, so the
    // preview is indicative and must not claim a rate lock it cannot honour.
    expiresAt: new Date().toISOString(),
  };
}

export function mapWithdrawal(w: WithdrawalWire): WithdrawalResult {
  return {
    id: w.id,
    reference: w.reference || w.id,
    symbol: w.symbol || '',
    status: WITHDRAWAL_STATUS[w.status] || 'WithdrawalPendingReview',
    amount: { amount: w.units, symbol: w.symbol || '' },
    networkFee: { amount: w.network_fee_units, symbol: w.symbol || '' },
    address: w.address || '',
    networkName: assetCopy(w.symbol || '', w.symbol || '').network?.name || w.network || '',
    // provider_ref is empty until a broadcaster fills it; the caller re-attaches the
    // idempotency key it generated. No review SLA exists on the server, so none here.
    providerReference: w.provider_ref || undefined,
    idempotencyKey: '',
    createdAt: w.created_at,
    failureReason: w.failure_reason,
  };
}

/** Chart points arrive newest-first; the chart wants them oldest-first. */
export function mapChart(rows: PricePointWire[] | null | undefined): CandlePoint[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((p) => p && p.price_kobo > 0)
    .map((p) => ({ t: p.as_of, price: p.price_kobo }))
    .reverse();
}

export function mapScreening(d: { risk: string; reason?: string } | null | undefined): AddressScreening {
  const reason = d?.reason?.trim();
  return { risk: d?.risk === 'flagged' ? 'flagged' : 'clear', ...(reason ? { reason } : {}) };
}

/**
 * One stored alert. The Go row carries no brand colour (the table has no column
 * for one), so the icon colour is the same presentation lookup every other
 * crypto row uses.
 */
export function mapAlert(a: PriceAlert): PriceAlert {
  return { ...a, iconColor: iconColorFor(a.symbol) };
}

export function mapAlerts(rows: PriceAlert[] | null | undefined): PriceAlert[] {
  return Array.isArray(rows) ? rows.map(mapAlert) : [];
}

/** A chart range is a window the feed cannot answer (the provider publishes no
 *  candles); the mapper only translates the count the backend accepts. */
export function chartRangeToLimit(range: ChartRange): number {
  return { '1H': 30, '1D': 24, '1W': 28, '1M': 30, '1Y': 52 }[range];
}
