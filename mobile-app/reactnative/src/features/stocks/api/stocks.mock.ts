// ── Paymax Invest · Stocks — Mock fixtures ───────────────────────────────────
// Deterministic seed data so every UI state renders in mock mode. Flip
// EXPO_PUBLIC_STOCKS_USE_MOCK=false to hit the real Go endpoints (stocks.api.ts).
// All fiat is in minor units (NGN kobo / USD cents).

import type {
  CorporateAction,
  Dividend,
  PublicOffer,
  StockAsset,
  StockNews,
  StockOrder,
  StockPosition,
} from '../types/stocks.types';

const ngn = (major: number) => Math.round(major * 100);
const usd = (major: number) => Math.round(major * 100);

// ─── Whitelisted assets (admin-controlled in production) ──────────────────────

export const MOCK_STOCKS: StockAsset[] = [
  {
    id: 'stk_dangcem', type: 'stock', symbol: 'DANGCEM', name: 'Dangote Cement Plc',
    exchange: 'NGX', sector: 'Industrial Goods', currency: 'NGN',
    iconColor: '#0051D5', riskRating: 'low', status: 'active',
    buyEnabled: true, sellEnabled: true, marketStatus: 'open',
    price: { amount: ngn(485.50), currency: 'NGN' }, change24hPct: 1.36,
    dayChange: { amount: ngn(6.50), currency: 'NGN' },
    week52High: { amount: ngn(620.00), currency: 'NGN' },
    week52Low: { amount: ngn(298.00), currency: 'NGN' },
    marketCap: { amount: ngn(8_270_000_000_000), currency: 'NGN' }, volume: 1_240_500,
    bid: { amount: ngn(485.00), currency: 'NGN' }, ask: { amount: ngn(486.00), currency: 'NGN' },
    summary:
      'Dangote Cement is the largest cement producer in sub-Saharan Africa, with operations across ten African countries.',
    riskDisclosure:
      'Share prices can fall as well as rise. Past performance is not a guide to future returns.',
    feeBps: 25, settlementCycle: 'T+3',
    minOrderAmount: ngn(1_000), maxOrderAmount: ngn(50_000_000), kycTierRequired: 2,
  },
  {
    id: 'stk_mtnn', type: 'stock', symbol: 'MTNN', name: 'MTN Nigeria Communications Plc',
    exchange: 'NGX', sector: 'Telecoms', currency: 'NGN',
    iconColor: '#EAB308', riskRating: 'medium', status: 'active',
    buyEnabled: true, sellEnabled: true, marketStatus: 'open',
    price: { amount: ngn(232.80), currency: 'NGN' }, change24hPct: -0.94,
    dayChange: { amount: ngn(-2.20), currency: 'NGN' },
    week52High: { amount: ngn(280.00), currency: 'NGN' },
    week52Low: { amount: ngn(168.00), currency: 'NGN' },
    marketCap: { amount: ngn(4_870_000_000_000), currency: 'NGN' }, volume: 3_410_200,
    bid: { amount: ngn(232.50), currency: 'NGN' }, ask: { amount: ngn(233.10), currency: 'NGN' },
    summary:
      'MTN Nigeria is the largest mobile network operator in Nigeria by subscribers, offering voice, data and fintech services.',
    riskDisclosure:
      'Telecoms shares can be sensitive to regulation and currency moves, which can affect the price.',
    feeBps: 25, settlementCycle: 'T+3',
    minOrderAmount: ngn(1_000), maxOrderAmount: ngn(40_000_000), kycTierRequired: 2,
  },
  {
    id: 'stk_gtco', type: 'stock', symbol: 'GTCO', name: 'Guaranty Trust Holding Co Plc',
    exchange: 'NGX', sector: 'Banking', currency: 'NGN',
    iconColor: '#EA7F00', riskRating: 'medium', status: 'active',
    buyEnabled: true, sellEnabled: true, marketStatus: 'open',
    price: { amount: ngn(58.95), currency: 'NGN' }, change24hPct: 2.17,
    dayChange: { amount: ngn(1.25), currency: 'NGN' },
    week52High: { amount: ngn(72.00), currency: 'NGN' },
    week52Low: { amount: ngn(38.10), currency: 'NGN' },
    marketCap: { amount: ngn(1_730_000_000_000), currency: 'NGN' }, volume: 8_902_400,
    bid: { amount: ngn(58.80), currency: 'NGN' }, ask: { amount: ngn(59.05), currency: 'NGN' },
    summary:
      'GTCO is the holding company for Guaranty Trust Bank, one of Nigeria\'s most profitable and well-capitalised banks.',
    riskDisclosure:
      'Bank shares are exposed to interest-rate and credit cycles, which can move the price sharply.',
    feeBps: 25, settlementCycle: 'T+3',
    minOrderAmount: ngn(1_000), maxOrderAmount: ngn(40_000_000), kycTierRequired: 2,
  },
  {
    id: 'stk_zenithbank', type: 'stock', symbol: 'ZENITHBANK', name: 'Zenith Bank Plc',
    exchange: 'NGX', sector: 'Banking', currency: 'NGN',
    iconColor: '#BA1A1A', riskRating: 'medium', status: 'active',
    buyEnabled: true, sellEnabled: true, marketStatus: 'open',
    price: { amount: ngn(41.20), currency: 'NGN' }, change24hPct: 0.49,
    dayChange: { amount: ngn(0.20), currency: 'NGN' },
    week52High: { amount: ngn(49.50), currency: 'NGN' },
    week52Low: { amount: ngn(28.00), currency: 'NGN' },
    marketCap: { amount: ngn(1_290_000_000_000), currency: 'NGN' }, volume: 6_120_800,
    bid: { amount: ngn(41.10), currency: 'NGN' }, ask: { amount: ngn(41.30), currency: 'NGN' },
    summary:
      'Zenith Bank is a tier-1 Nigerian commercial bank with a strong corporate and retail banking franchise.',
    riskDisclosure:
      'Bank shares are exposed to interest-rate and credit cycles, which can move the price sharply.',
    feeBps: 25, settlementCycle: 'T+3',
    minOrderAmount: ngn(1_000), maxOrderAmount: ngn(40_000_000), kycTierRequired: 2,
  },
  {
    id: 'stk_aradel', type: 'stock', symbol: 'ARADEL', name: 'Aradel Holdings Plc',
    exchange: 'NGX', sector: 'Oil & Gas', currency: 'NGN',
    iconColor: '#16A34A', riskRating: 'high', status: 'active',
    buyEnabled: true, sellEnabled: true, marketStatus: 'open',
    price: { amount: ngn(584.00), currency: 'NGN' }, change24hPct: 4.28,
    dayChange: { amount: ngn(24.00), currency: 'NGN' },
    week52High: { amount: ngn(720.00), currency: 'NGN' },
    week52Low: { amount: ngn(320.00), currency: 'NGN' },
    marketCap: { amount: ngn(2_540_000_000_000), currency: 'NGN' }, volume: 412_900,
    bid: { amount: ngn(583.00), currency: 'NGN' }, ask: { amount: ngn(585.50), currency: 'NGN' },
    summary:
      'Aradel Holdings is an integrated Nigerian energy company with upstream, refining and gas operations.',
    riskDisclosure:
      'Energy shares are highly sensitive to oil prices and can be very volatile.',
    feeBps: 30, settlementCycle: 'T+3',
    minOrderAmount: ngn(1_000), maxOrderAmount: ngn(20_000_000), kycTierRequired: 2,
  },
  {
    id: 'stk_nestle', type: 'stock', symbol: 'NESTLE', name: 'Nestlé Nigeria Plc',
    exchange: 'NGX', sector: 'Consumer Goods', currency: 'NGN',
    iconColor: '#340075', riskRating: 'low', status: 'paused',
    buyEnabled: false, sellEnabled: false, marketStatus: 'closed',
    price: { amount: ngn(935.00), currency: 'NGN' }, change24hPct: -0.32,
    dayChange: { amount: ngn(-3.00), currency: 'NGN' },
    week52High: { amount: ngn(1_120.00), currency: 'NGN' },
    week52Low: { amount: ngn(810.00), currency: 'NGN' },
    marketCap: { amount: ngn(741_000_000_000), currency: 'NGN' }, volume: 86_300,
    bid: { amount: ngn(934.00), currency: 'NGN' }, ask: { amount: ngn(936.00), currency: 'NGN' },
    summary:
      'Nestlé Nigeria manufactures food and beverage products including Maggi, Milo and Golden Morn.',
    riskDisclosure:
      'Consumer-goods shares can be affected by input costs and consumer spending. This stock is temporarily paused on Paymax.',
    feeBps: 25, settlementCycle: 'T+3',
    minOrderAmount: ngn(1_000), maxOrderAmount: ngn(20_000_000), kycTierRequired: 2,
  },
  {
    id: 'stk_aapl', type: 'stock', symbol: 'AAPL', name: 'Apple Inc.',
    exchange: 'NASDAQ', sector: 'Technology', currency: 'USD',
    iconColor: '#0B1C30', riskRating: 'medium', status: 'active',
    buyEnabled: true, sellEnabled: true, marketStatus: 'closed',
    price: { amount: usd(228.40), currency: 'USD' }, change24hPct: 0.86,
    dayChange: { amount: usd(1.95), currency: 'USD' },
    week52High: { amount: usd(260.10), currency: 'USD' },
    week52Low: { amount: usd(164.08), currency: 'USD' },
    marketCap: { amount: usd(3_450_000_000_000), currency: 'USD' }, volume: 41_200_000,
    bid: { amount: usd(228.35), currency: 'USD' }, ask: { amount: usd(228.45), currency: 'USD' },
    summary:
      'Apple designs and sells consumer electronics, software and services including iPhone, Mac and the App Store.',
    riskDisclosure:
      'US-listed shares carry currency risk for NGN-funded accounts in addition to normal market risk.',
    feeBps: 20, settlementCycle: 'T+2',
    minOrderAmount: usd(1), maxOrderAmount: usd(200_000), kycTierRequired: 2,
  },
  {
    id: 'stk_tsla', type: 'stock', symbol: 'TSLA', name: 'Tesla, Inc.',
    exchange: 'NASDAQ', sector: 'Automotive', currency: 'USD',
    // NOTE: kept in sync with its NASDAQ peer AAPL — two stocks on the same
    // exchange can't be in different session states at the same time.
    iconColor: '#BA1A1A', riskRating: 'high', status: 'active',
    buyEnabled: true, sellEnabled: true, marketStatus: 'closed',
    price: { amount: usd(412.70), currency: 'USD' }, change24hPct: -2.41,
    dayChange: { amount: usd(-10.20), currency: 'USD' },
    week52High: { amount: usd(488.50), currency: 'USD' },
    week52Low: { amount: usd(182.00), currency: 'USD' },
    marketCap: { amount: usd(1_320_000_000_000), currency: 'USD' }, volume: 88_900_000,
    bid: { amount: usd(412.50), currency: 'USD' }, ask: { amount: usd(412.90), currency: 'USD' },
    summary:
      'Tesla designs and manufactures electric vehicles, battery energy storage and solar products.',
    riskDisclosure:
      'Tesla is a higher-risk, high-volatility stock and its price can swing sharply within a single session.',
    feeBps: 20, settlementCycle: 'T+2',
    minOrderAmount: usd(1), maxOrderAmount: usd(150_000), kycTierRequired: 2,
  },
  {
    id: 'stk_voo', type: 'stock', symbol: 'VOO', name: 'Vanguard S&P 500 ETF',
    exchange: 'NYSE', sector: 'ETF', currency: 'USD',
    iconColor: '#00453F', riskRating: 'low', status: 'active',
    buyEnabled: true, sellEnabled: true, marketStatus: 'closed',
    price: { amount: usd(548.10), currency: 'USD' }, change24hPct: 0.41,
    dayChange: { amount: usd(2.25), currency: 'USD' },
    week52High: { amount: usd(560.00), currency: 'USD' },
    week52Low: { amount: usd(458.20), currency: 'USD' },
    marketCap: { amount: usd(520_000_000_000), currency: 'USD' }, volume: 4_120_000,
    bid: { amount: usd(548.00), currency: 'USD' }, ask: { amount: usd(548.20), currency: 'USD' },
    summary:
      'The Vanguard S&P 500 ETF tracks the 500 largest US companies, offering broad, low-cost market exposure.',
    riskDisclosure:
      'ETFs spread risk across many companies but still fall when the broad market falls. Currency risk applies.',
    feeBps: 15, settlementCycle: 'T+2',
    minOrderAmount: usd(1), maxOrderAmount: usd(200_000), kycTierRequired: 2,
  },
];

// ─── Holdings (portfolio positions) ───────────────────────────────────────────

const dangcem = MOCK_STOCKS[0];
const gtco = MOCK_STOCKS[2];
const aapl = MOCK_STOCKS[6];

function buildPosition(asset: StockAsset, quantity: number, avgCostMinor: number): StockPosition {
  const marketValue = Math.round(asset.price.amount * quantity);
  const costBasis = Math.round(avgCostMinor * quantity);
  const gain = marketValue - costBasis;
  return {
    assetId: asset.id, symbol: asset.symbol, name: asset.name,
    exchange: asset.exchange, iconColor: asset.iconColor,
    quantity,
    averageCost: { amount: avgCostMinor, currency: asset.currency },
    marketValue: { amount: marketValue, currency: asset.currency },
    costBasis: { amount: costBasis, currency: asset.currency },
    unrealizedGainLoss: { amount: gain, currency: asset.currency },
    unrealizedPct: costBasis ? +((gain / costBasis) * 100).toFixed(2) : 0,
    price: asset.price, change24hPct: asset.change24hPct,
  };
}

export const MOCK_POSITIONS: StockPosition[] = [
  buildPosition(dangcem, 120, ngn(410.00)),
  buildPosition(gtco, 2_400, ngn(44.50)),
  buildPosition(aapl, 18, usd(190.20)),
];

// ─── Order history ──────────────────────────────────────────────────────────--

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

export const MOCK_ORDERS: StockOrder[] = [
  {
    id: 'so_1', reference: 'PMX-ST-840192', assetId: dangcem.id, symbol: 'DANGCEM',
    name: 'Dangote Cement Plc', side: 'buy', orderType: 'market', status: 'Filled',
    quantity: 50, filledQuantity: 50,
    price: { amount: ngn(484.00), currency: 'NGN' },
    gross: { amount: ngn(24_200.00), currency: 'NGN' },
    fees: [
      { type: 'commission', amount: { amount: ngn(60.50), currency: 'NGN' } },
      { type: 'provider_fee', amount: { amount: ngn(24.20), currency: 'NGN' } },
    ],
    total: { amount: ngn(24_284.70), currency: 'NGN' },
    provider: 'mock-broker', providerReference: 'BR-77120-AB',
    settlementDate: daysFromNow(3),
    idempotencyKey: 'st-mock-1', createdAt: hoursAgo(6),
    statusHistory: [
      { status: 'Submitted', at: hoursAgo(6) },
      { status: 'AcceptedByProvider', at: hoursAgo(6) },
      { status: 'Filled', at: hoursAgo(6) },
    ],
  },
  {
    id: 'so_2', reference: 'PMX-ST-839004', assetId: gtco.id, symbol: 'GTCO',
    name: 'Guaranty Trust Holding Co Plc', side: 'buy', orderType: 'market', status: 'PendingSettlement',
    quantity: 400, filledQuantity: 400,
    price: { amount: ngn(58.20), currency: 'NGN' },
    gross: { amount: ngn(23_280.00), currency: 'NGN' },
    fees: [
      { type: 'commission', amount: { amount: ngn(58.20), currency: 'NGN' } },
      { type: 'provider_fee', amount: { amount: ngn(23.28), currency: 'NGN' } },
    ],
    total: { amount: ngn(23_361.48), currency: 'NGN' },
    provider: 'mock-broker', providerReference: 'BR-76551-CD',
    settlementDate: daysFromNow(2),
    idempotencyKey: 'st-mock-2', createdAt: hoursAgo(20),
    statusHistory: [
      { status: 'Submitted', at: hoursAgo(20) },
      { status: 'AcceptedByProvider', at: hoursAgo(20) },
      { status: 'Filled', at: hoursAgo(19) },
      { status: 'PendingSettlement', at: hoursAgo(19) },
    ],
  },
  {
    id: 'so_3', reference: 'PMX-ST-838221', assetId: MOCK_STOCKS[4].id, symbol: 'ARADEL',
    name: 'Aradel Holdings Plc', side: 'buy', orderType: 'limit', status: 'Submitted',
    quantity: 20, filledQuantity: 0,
    price: { amount: ngn(584.00), currency: 'NGN' },
    limitPrice: { amount: ngn(560.00), currency: 'NGN' },
    gross: { amount: ngn(11_200.00), currency: 'NGN' },
    fees: [
      { type: 'commission', amount: { amount: ngn(33.60), currency: 'NGN' } },
      { type: 'provider_fee', amount: { amount: ngn(11.20), currency: 'NGN' } },
    ],
    total: { amount: ngn(11_244.80), currency: 'NGN' },
    provider: 'mock-broker', providerReference: 'BR-78003-EF',
    idempotencyKey: 'st-mock-3', createdAt: hoursAgo(2),
    statusHistory: [
      { status: 'AwaitingUserConfirmation', at: hoursAgo(2) },
      { status: 'Submitted', at: hoursAgo(2) },
    ],
  },
  {
    id: 'so_4', reference: 'PMX-ST-835517', assetId: gtco.id, symbol: 'GTCO',
    name: 'Guaranty Trust Holding Co Plc', side: 'sell', orderType: 'market', status: 'Settled',
    quantity: 600, filledQuantity: 600,
    price: { amount: ngn(57.80), currency: 'NGN' },
    gross: { amount: ngn(34_680.00), currency: 'NGN' },
    fees: [
      { type: 'commission', amount: { amount: ngn(86.70), currency: 'NGN' } },
      { type: 'provider_fee', amount: { amount: ngn(34.68), currency: 'NGN' } },
    ],
    total: { amount: ngn(34_558.62), currency: 'NGN' },
    provider: 'mock-broker', providerReference: 'BR-71220-GH',
    settlementDate: hoursAgo(48),
    idempotencyKey: 'st-mock-4', createdAt: hoursAgo(96),
    statusHistory: [
      { status: 'Submitted', at: hoursAgo(96) },
      { status: 'Filled', at: hoursAgo(96) },
      { status: 'PendingSettlement', at: hoursAgo(95) },
      { status: 'Settled', at: hoursAgo(48) },
    ],
  },
  {
    id: 'so_5', reference: 'PMX-ST-829884', assetId: MOCK_STOCKS[1].id, symbol: 'MTNN',
    name: 'MTN Nigeria Communications Plc', side: 'buy', orderType: 'market', status: 'Cancelled',
    quantity: 100, filledQuantity: 0,
    price: { amount: ngn(235.00), currency: 'NGN' },
    gross: { amount: ngn(23_500.00), currency: 'NGN' },
    fees: [
      { type: 'commission', amount: { amount: ngn(58.75), currency: 'NGN' } },
      { type: 'provider_fee', amount: { amount: ngn(23.50), currency: 'NGN' } },
    ],
    total: { amount: ngn(23_582.25), currency: 'NGN' },
    provider: 'mock-broker', providerReference: 'BR-75110-IJ',
    idempotencyKey: 'st-mock-5', createdAt: hoursAgo(120),
    failureReason: 'You cancelled this order before it was filled. No funds were debited.',
    statusHistory: [
      { status: 'Submitted', at: hoursAgo(120) },
      { status: 'CancelRequested', at: hoursAgo(119) },
      { status: 'Cancelled', at: hoursAgo(119) },
    ],
  },
];

// ─── News ─────────────────────────────────────────────────────────────────────

export const MOCK_NEWS: StockNews[] = [
  {
    id: 'nw_1', title: 'Dangote Cement reports higher quarterly volumes across West Africa',
    source: 'BusinessDay', publishedAt: hoursAgo(4),
    summary: 'The cement maker posted stronger sales as construction demand recovered across its key markets.',
  },
  {
    id: 'nw_2', title: 'GTCO declares interim dividend as half-year profit climbs',
    source: 'Nairametrics', publishedAt: hoursAgo(26),
    summary: 'The holding company announced an interim payout following a rise in net interest income.',
  },
  {
    id: 'nw_3', title: 'NGX All-Share Index extends gains on banking rally',
    source: 'The Guardian', publishedAt: hoursAgo(50),
    summary: 'Nigerian equities rose for a third straight session, led by tier-1 banking names.',
  },
];

// ─── Dividends ──────────────────────────────────────────────────────────────--

export const MOCK_DIVIDENDS: Dividend[] = [
  {
    id: 'dv_1', symbol: 'GTCO', exDate: daysFromNow(8), payDate: daysFromNow(22),
    amountPerShare: { amount: ngn(2.50), currency: 'NGN' }, status: 'announced',
  },
  {
    id: 'dv_2', symbol: 'DANGCEM', exDate: hoursAgo(30 * 24), payDate: hoursAgo(10 * 24),
    amountPerShare: { amount: ngn(30.00), currency: 'NGN' }, status: 'paid',
  },
];

// ─── Corporate actions ────────────────────────────────────────────────────────

export const MOCK_CORPORATE_ACTIONS: CorporateAction[] = [
  {
    id: 'ca_1', symbol: 'MTNN', type: 'agm', title: 'Annual General Meeting',
    description: 'MTN Nigeria will hold its AGM; holders of record on the ex-date are eligible to vote.',
    exDate: daysFromNow(14), status: 'upcoming',
  },
  {
    id: 'ca_2', symbol: 'AAPL', type: 'split', title: 'Stock split (historical)',
    description: 'Apple completed a 4-for-1 stock split, increasing the number of shares outstanding.',
    exDate: hoursAgo(400 * 24), status: 'completed',
  },
];

// ─── Public offers (IPO / rights) ─────────────────────────────────────────────

export const MOCK_OFFERS: PublicOffer[] = [
  {
    id: 'of_1', symbol: 'GREENTECH', name: 'GreenTech Energy Plc', kind: 'ipo',
    priceLow: { amount: ngn(18.00), currency: 'NGN' }, priceHigh: { amount: ngn(22.00), currency: 'NGN' },
    openDate: hoursAgo(2 * 24), closeDate: daysFromNow(6), minUnits: 1_000, status: 'open',
    summary:
      'GreenTech Energy is raising primary capital to fund renewable-energy projects across Nigeria. Shares will list on the NGX.',
  },
  {
    id: 'of_2', symbol: 'ZENITHBANK', name: 'Zenith Bank Plc', kind: 'rights',
    priceLow: { amount: ngn(36.00), currency: 'NGN' }, priceHigh: { amount: ngn(36.00), currency: 'NGN' },
    openDate: daysFromNow(3), closeDate: daysFromNow(24), minUnits: 100, status: 'upcoming',
    summary:
      'Existing Zenith Bank shareholders may subscribe for additional shares at a discount under this rights issue.',
  },
];
