// ── Invest — mock data (used when EXPO_PUBLIC_INVEST_USE_MOCK !== 'false') ─────
import type {
  StockWithQuote, Profile, Eligibility, Agreement, SuitabilityQuestion,
  PortfolioView, WalletView, Watchlist, Order, MarketStatus, PublicOffer,
} from '../types/invest.types';

function q(symbol: string, price: number, prev: number, status: MarketStatus = 'open') {
  const change = price - prev;
  return {
    symbol, price_kobo: price, prev_close_kobo: prev, day_change_kobo: change,
    day_change_pct: prev ? (change / prev) * 100 : 0,
    high_52w_kobo: Math.round(price * 1.25), low_52w_kobo: Math.round(price * 0.75),
    volume: 250_000, market_status: status, data_status: 'delayed' as const,
    as_of: new Date().toISOString(),
  };
}

export const MOCK_STOCKS: StockWithQuote[] = [
  { id: 's1', symbol: 'DANGCEM', name: 'Dangote Cement Plc', exchange: 'NGX', sector: 'Industrial Goods', asset_class: 'equity', status: 'active', buy_enabled: true, sell_enabled: true, risk_rating: 'medium', minimum_order_amount: 1_000_000, maximum_order_amount: 0, kyc_tier_required: 2, settlement_days: 3, description: 'Largest cement producer in sub-Saharan Africa.', quote: q('DANGCEM', 47_500_00, 46_900_00) },
  { id: 's2', symbol: 'MTNN', name: 'MTN Nigeria Communications Plc', exchange: 'NGX', sector: 'Telecommunications', asset_class: 'equity', status: 'active', buy_enabled: true, sell_enabled: true, risk_rating: 'medium', minimum_order_amount: 1_000_000, maximum_order_amount: 0, kyc_tier_required: 2, settlement_days: 3, description: 'Leading telecoms operator in Nigeria.', quote: q('MTNN', 23_000_00, 23_400_00) },
  { id: 's3', symbol: 'GTCO', name: 'Guaranty Trust Holding Co Plc', exchange: 'NGX', sector: 'Financial Services', asset_class: 'equity', status: 'active', buy_enabled: true, sell_enabled: true, risk_rating: 'medium', minimum_order_amount: 500_000, maximum_order_amount: 0, kyc_tier_required: 2, settlement_days: 3, description: 'Tier-1 Nigerian banking group.', quote: q('GTCO', 5_500_00, 5_420_00) },
  { id: 's4', symbol: 'ZENITHBANK', name: 'Zenith Bank Plc', exchange: 'NGX', sector: 'Financial Services', asset_class: 'equity', status: 'active', buy_enabled: true, sell_enabled: true, risk_rating: 'medium', minimum_order_amount: 500_000, maximum_order_amount: 0, kyc_tier_required: 2, settlement_days: 3, description: 'One of Nigeria’s largest commercial banks.', quote: q('ZENITHBANK', 4_300_00, 4_280_00) },
  { id: 's5', symbol: 'NESTLE', name: 'Nestle Nigeria Plc', exchange: 'NGX', sector: 'Consumer Goods', asset_class: 'equity', status: 'active', buy_enabled: true, sell_enabled: true, risk_rating: 'low', minimum_order_amount: 1_000_000, maximum_order_amount: 0, kyc_tier_required: 2, settlement_days: 3, description: 'Food and beverage consumer-goods company.', quote: q('NESTLE', 95_000_00, 94_000_00) },
  { id: 's6', symbol: 'VETIVA-GREEN', name: 'Vetiva Griffin 30 ETF', exchange: 'NGX', sector: 'ETF', asset_class: 'etf', status: 'active', buy_enabled: true, sell_enabled: true, risk_rating: 'low', minimum_order_amount: 500_000, maximum_order_amount: 0, kyc_tier_required: 2, settlement_days: 3, description: 'ETF tracking the 30 most-capitalised NGX stocks.', quote: q('VETIVA-GREEN', 3_200_00, 3_180_00) },
];

export const MOCK_PROFILE: Profile = {
  id: 'p1', user_id: 'demo', kyc_tier: 2, risk_category: 'balanced', country: 'NG',
  residency_country: 'NG', investment_enabled: true, stock_trading_enabled: true,
  public_offer_enabled: true, rights_issue_enabled: true, status: 'approved',
};

export const MOCK_ELIGIBILITY: Eligibility = {
  kyc_tier: 2, kyc_ok: true, terms_accepted: true, suitability_complete: true,
  investment_enabled: true, stock_trading_enabled: true, status: 'approved', can_trade: true,
};

export const MOCK_AGREEMENTS: Agreement[] = [
  { key: 'investment_terms', title: 'Investment Terms of Service', version: 'v1', is_active: true, accepted: false },
  { key: 'risk_disclosure', title: 'Risk Disclosure Statement', version: 'v1', is_active: true, accepted: false },
  { key: 'no_advice', title: 'No Investment Advice Disclosure', version: 'v1', is_active: true, accepted: false },
  { key: 'fees', title: 'Fees Schedule', version: 'v1', is_active: true, accepted: false },
];

export const MOCK_SUITABILITY_QUESTIONS: SuitabilityQuestion[] = [
  { id: 'experience', text: 'How much experience do you have investing in stocks?', options: [{ label: 'None', value: 0 }, { label: 'Some', value: 2 }, { label: 'Experienced', value: 4 }] },
  { id: 'prices_fall', text: 'Do you understand that stock prices can fall and you may lose money?', options: [{ label: 'No', value: 0 }, { label: 'Yes', value: 3 }] },
  { id: 'objective', text: 'What is your main investment objective?', options: [{ label: 'Preserve capital', value: 1 }, { label: 'Balanced growth', value: 2 }, { label: 'Maximise growth', value: 4 }] },
  { id: 'horizon', text: 'How long do you plan to stay invested?', options: [{ label: '< 1 year', value: 1 }, { label: '1–5 years', value: 2 }, { label: '5+ years', value: 4 }] },
  { id: 'drop_reaction', text: 'If your portfolio dropped 20%, what would you do?', options: [{ label: 'Sell everything', value: 0 }, { label: 'Hold', value: 3 }, { label: 'Buy more', value: 4 }] },
  { id: 'no_guarantee', text: 'Do you acknowledge there are no guaranteed returns?', options: [{ label: 'No', value: 0 }, { label: 'Yes', value: 2 }] },
];

export const MOCK_WALLET: WalletView = {
  currency: 'NGN', available_cash_kobo: 150_000_00, locked_cash_kobo: 0,
  pending_settlement_kobo: 0, invested_value_kobo: 95_000_00,
  total_portfolio_value_kobo: 245_000_00, withdrawable_cash_kobo: 150_000_00,
};

export const MOCK_PORTFOLIO: PortfolioView = {
  total_value_kobo: 245_000_00, cash_balance_kobo: 150_000_00, invested_value_kobo: 95_000_00,
  pending_settlement_kobo: 0, total_gain_kobo: 5_200_00, today_gain_kobo: 600_00,
  positions: [
    { id: 'pos1', symbol: 'GTCO', stock_asset_id: 's3', quantity: 100, locked_quantity: 0, available_quantity: 100, average_cost_kobo: 5_200_00, current_price_kobo: 5_500_00, market_value_kobo: 550_000_00 / 10, unrealized_gain_kobo: 30_000 },
    { id: 'pos2', symbol: 'NESTLE', stock_asset_id: 's5', quantity: 5, locked_quantity: 0, available_quantity: 5, average_cost_kobo: 94_000_00, current_price_kobo: 95_000_00, market_value_kobo: 475_000_00 / 10, unrealized_gain_kobo: 5_000 },
  ],
};

export const MOCK_WATCHLISTS: Watchlist[] = [
  { id: 'w1', name: 'My Watchlist', is_default: true, items: [
    { id: 'i1', stock_asset_id: 's1', symbol: 'DANGCEM' },
    { id: 'i2', stock_asset_id: 's2', symbol: 'MTNN' },
  ] },
];

export const MOCK_ORDERS: Order[] = [
  { id: 'o1', symbol: 'GTCO', side: 'buy', order_type: 'market', amount_kobo: 520_000, quantity: 100, limit_price_kobo: 0, estimated_price_kobo: 5_200_00, executed_price_kobo: 5_200_00, filled_quantity: 100, fees_kobo: 10_000, total_amount_kobo: 530_000, status: 'Settled', provider_reference: 'mbk_demo', created_at: new Date(Date.now() - 86400000).toISOString() },
];

export const MOCK_PUBLIC_OFFERS: PublicOffer[] = [];
