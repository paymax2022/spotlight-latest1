// ── Paymax Invest (Stocks) — Mobile types ────────────────────────────────────
// Mirror of the Go backend DTOs (backend/internal/invest/model.go). All money is
// integer minor units (kobo). Quantities are decimals (numeric(20,4)).

export type ProfileStatus =
  | 'not_started' | 'started' | 'kyc_required' | 'kyc_pending' | 'kyc_rejected'
  | 'terms_required' | 'suitability_required' | 'approved' | 'restricted' | 'suspended';

export type RiskCategory =
  | 'conservative' | 'balanced' | 'growth' | 'aggressive' | 'restricted';

export interface Profile {
  id: string;
  user_id: string;
  kyc_tier: number;
  risk_category: RiskCategory;
  country: string;
  residency_country: string;
  investment_enabled: boolean;
  stock_trading_enabled: boolean;
  public_offer_enabled: boolean;
  rights_issue_enabled: boolean;
  status: ProfileStatus;
}

export interface Eligibility {
  kyc_tier: number;
  kyc_ok: boolean;
  terms_accepted: boolean;
  suitability_complete: boolean;
  investment_enabled: boolean;
  stock_trading_enabled: boolean;
  status: ProfileStatus;
  can_trade: boolean;
}

export interface Agreement {
  key: string;
  title: string;
  version: string;
  body_url?: string;
  is_active: boolean;
  accepted: boolean;
}

export interface SuitabilityOption { label: string; value: number }
export interface SuitabilityQuestion { id: string; text: string; options: SuitabilityOption[] }
export interface SuitabilityResult {
  suitability_profile_id: string;
  score: number;
  risk_category: RiskCategory;
  eligibility: string[];
}

export type MarketStatus = 'open' | 'closed' | 'pre' | 'post';
export type DataStatus = 'delayed' | 'real_time';

export interface Quote {
  symbol: string;
  price_kobo: number;
  prev_close_kobo: number;
  day_change_kobo: number;
  day_change_pct: number;
  high_52w_kobo: number;
  low_52w_kobo: number;
  volume: number;
  market_status: MarketStatus;
  data_status: DataStatus;
  as_of: string;
}

export interface StockAsset {
  id: string;
  symbol: string;
  name: string;
  exchange: string;
  sector: string;
  asset_class: 'equity' | 'etf';
  status: 'active' | 'suspended' | 'delisted';
  buy_enabled: boolean;
  sell_enabled: boolean;
  risk_rating: 'low' | 'medium' | 'high';
  minimum_order_amount: number;
  maximum_order_amount: number;
  kyc_tier_required: number;
  logo_url?: string;
  description?: string;
  settlement_days: number;
}

export interface StockWithQuote extends StockAsset {
  quote: Quote;
}

export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';
export type OrderStatus =
  | 'Draft' | 'PendingReview' | 'AwaitingConfirmation' | 'CashLocked' | 'Submitted'
  | 'Accepted' | 'PartiallyFilled' | 'Filled' | 'PendingSettlement' | 'Settled'
  | 'CancelRequested' | 'Cancelled' | 'Rejected' | 'Failed' | 'ReversalPending'
  | 'Reversed' | 'ComplianceHold';

export interface Order {
  id: string;
  symbol: string;
  side: OrderSide;
  order_type: OrderType;
  amount_kobo: number;
  quantity: number;
  limit_price_kobo: number;
  estimated_price_kobo: number;
  executed_price_kobo: number;
  filled_quantity: number;
  fees_kobo: number;
  total_amount_kobo: number;
  status: OrderStatus;
  provider_reference: string;
  failure_reason?: string;
  created_at: string;
}

export interface Receipt {
  order: Order;
  risk_disclosure: string;
  settlement_note: string;
}

export interface Position {
  id: string;
  symbol: string;
  stock_asset_id: string;
  quantity: number;
  locked_quantity: number;
  available_quantity: number;
  average_cost_kobo: number;
  current_price_kobo: number;
  market_value_kobo: number;
  unrealized_gain_kobo: number;
}

export interface PortfolioView {
  total_value_kobo: number;
  cash_balance_kobo: number;
  invested_value_kobo: number;
  pending_settlement_kobo: number;
  total_gain_kobo: number;
  today_gain_kobo: number;
  positions: Position[];
}

export interface WalletView {
  currency: string;
  available_cash_kobo: number;
  locked_cash_kobo: number;
  pending_settlement_kobo: number;
  invested_value_kobo: number;
  total_portfolio_value_kobo: number;
  withdrawable_cash_kobo: number;
}

export interface Watchlist {
  id: string;
  name: string;
  is_default: boolean;
  items: { id: string; stock_asset_id: string; symbol: string }[];
}

export interface BuyOrderRequest {
  symbol: string;
  order_type?: OrderType;
  amount_kobo?: number;
  quantity?: number;
  limit_price_kobo?: number;
  pin: string;
}

export interface SellOrderRequest {
  symbol: string;
  order_type?: OrderType;
  quantity: number;
  limit_price_kobo?: number;
  pin: string;
}

export interface PublicOffer {
  id: string;
  issuer_name: string;
  symbol: string;
  offer_price_kobo: number;
  minimum_subscription_kobo: number;
  opening_date?: string;
  closing_date?: string;
  status: string;
}
