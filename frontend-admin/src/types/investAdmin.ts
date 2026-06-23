// ── Admin — Paymax Invest types (mirror of backend/internal/invest) ───────────

export interface InvestOverview {
  assets_total: number;
  assets_tradable: number;
  orders_total: number;
  orders_pending_settlement: number;
  orders_failed: number;
  investors: number;
  open_offers: number;
}

export interface AdminStockAsset {
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
  settlement_days: number;
  description?: string;
}

export interface AdminOrder {
  id: string;
  user_id: string;
  symbol: string;
  side: 'buy' | 'sell';
  order_type: 'market' | 'limit';
  quantity: number;
  filled_quantity: number;
  amount_kobo: number;
  fees_kobo: number;
  total_amount_kobo: number;
  status: string;
  provider_reference: string;
  failure_reason?: string;
  created_at: string;
}

export interface FeeConfig {
  commission_bps: number;
  min_fee_kobo: number;
}

export interface AuditEntry {
  id: string;
  admin_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  reason: string;
  created_at: string;
}

export interface ReconSummary {
  broker_clearing_net_kobo: number;
  fee_income_kobo: number;
  user_cash_total_kobo: number;
  locked_cash_total_kobo: number;
  settlement_suspense_kobo: number;
  external_funding_net_kobo: number;
  stuck_settlements: number;
  trapped_funds: number;
  balanced: boolean;
}

export interface ReconResult {
  summary: ReconSummary;
  stuck_settlements: AdminOrder[];
  trapped_funds: AdminOrder[];
}

export interface AssetUpdate {
  status?: AdminStockAsset['status'];
  buy_enabled?: boolean;
  sell_enabled?: boolean;
  risk_rating?: AdminStockAsset['risk_rating'];
  minimum_order_amount?: number;
  maximum_order_amount?: number;
  kyc_tier_required?: number;
  reason?: string;
}
