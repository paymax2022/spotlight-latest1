export type UtilityCategory = 'airtime' | 'data' | 'electricity' | 'cable_tv' | 'internet' | 'education';

export type UtilityTransactionStatus =
  | 'initiated'
  | 'wallet_debited'
  | 'provider_pending'
  | 'successful'
  | 'failed'
  | 'reversed'
  | 'disputed';

export type ProviderHealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

export interface UtilityProviderRow {
  id: string;
  name: string;
  code: string;
  adapter_code: string;
  status: 'active' | 'disabled' | 'maintenance';
  supported_categories: UtilityCategory[];
  priority: number;
  health_status: ProviderHealthStatus;
  credentials: Record<string, unknown> | null;
  config: Record<string, unknown>;
}

export interface UtilityBillerRow {
  id: string;
  category: UtilityCategory;
  name: string;
  code: string;
  status: 'active' | 'disabled';
  requires_validation: boolean;
  customer_reference_label: string;
  dynamic_fields: unknown[];
}

export interface UtilityProductRow {
  id: string;
  biller_id: string;
  category: UtilityCategory;
  name: string;
  code: string;
  amount_type: 'fixed' | 'variable';
  amount_kobo: number | null;
  min_amount_kobo: number | null;
  max_amount_kobo: number | null;
  convenience_fee_kobo: number;
  markup_bps: number;
  provider_discount_bps: number;
  status: 'active' | 'disabled';
  metadata: Record<string, unknown>;
}

export interface UtilityProductMappingRow {
  id: string;
  provider_id: string;
  product_id: string;
  provider_product_code: string;
  provider_biller_code: string | null;
  provider_cost_kobo: number | null;
  provider_discount_bps: number;
  status: 'active' | 'disabled';
}

export interface UtilityTransactionRow {
  id: string;
  user_id: string;
  category: UtilityCategory;
  biller_id: string;
  product_id: string | null;
  provider_id: string | null;
  provider_mapping_id: string | null;
  customer_reference: string;
  customer_name: string | null;
  amount_kobo: number;
  convenience_fee_kobo: number;
  retail_amount_kobo: number;
  provider_cost_kobo: number;
  gross_profit_kobo: number;
  gross_margin_bps: number;
  status: UtilityTransactionStatus;
  provider_reference: string | null;
  token: string | null;
  receipt_number: string | null;
  idempotency_key: string;
  failure_reason: string | null;
  provider_response: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface UtilityProviderAttemptRow {
  id: string;
  transaction_id: string;
  provider_id: string;
  provider_mapping_id: string | null;
  attempt_number: number;
  status: 'started' | 'successful' | 'pending' | 'failed' | 'timeout' | 'error';
  request_idempotency_key: string;
  provider_reference: string | null;
  message: string | null;
  raw_response: Record<string, unknown> | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  timeout_ms: number | null;
}

export interface UtilityCategorySettingRow {
  category: UtilityCategory;
  enabled: boolean;
  availability_message: string | null;
  daily_limit_kobo: number | null;
  min_amount_kobo: number | null;
  max_amount_kobo: number | null;
  default_commission_bps: number;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface UtilityPricing {
  amountKobo: number;
  convenienceFeeKobo: number;
  retailAmountKobo: number;
  providerCostKobo: number;
  grossProfitKobo: number;
  grossMarginBps: number;
}

export interface UtilityPayInput {
  category: UtilityCategory;
  billerId: string;
  productId: string;
  customerReference: string;
  amountKobo?: number;
  paymentSource?: 'wallet' | 'paystack';
  metadata?: Record<string, unknown>;
}
