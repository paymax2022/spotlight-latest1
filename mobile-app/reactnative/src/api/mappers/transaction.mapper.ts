import { Transaction, Receipt, ServiceType, TransactionStatus } from '@/types/transaction';

type ApiRecord = Record<string, unknown>;

function asRecord(v: unknown): ApiRecord {
  return typeof v === 'object' && v !== null ? (v as ApiRecord) : {};
}

const SUPABASE_STATUS_MAP: Record<string, TransactionStatus> = {
  initiated:       'PROCESSING',
  wallet_debited:  'PROCESSING',
  provider_pending:'PENDING',
  successful:      'SUCCESSFUL',
  failed:          'FAILED',
  disputed:        'FAILED',
  reversed:        'REVERSED',
};

const SUPABASE_CATEGORY_MAP: Record<string, ServiceType> = {
  airtime:     'AIRTIME',
  data:        'DATA',
  electricity: 'ELECTRICITY',
  cable_tv:    'CABLE_TV',
  education:   'EDUCATION',
};

export function mapTransactionFromSupabase(raw: unknown): Transaction {
  const r       = asRecord(raw);
  const biller  = asRecord(r.biller);
  const product = asRecord(r.product);
  return {
    id:                 String(r.id ?? ''),
    serviceType:        SUPABASE_CATEGORY_MAP[String(r.category ?? '')] ?? 'AIRTIME',
    status:             SUPABASE_STATUS_MAP[String(r.status ?? '')] ?? 'PENDING',
    amount:             Number(r.amount_kobo ?? 0),
    charges:            Number(r.convenience_fee_kobo ?? 0),
    totalAmount:        Number(r.retail_amount_kobo ?? 0),
    reference:          String(r.receipt_number ?? ''),
    customerIdentifier: String(r.customer_reference ?? ''),
    providerName:       biller.name  ? String(biller.name)  : undefined,
    productName:        product.name ? String(product.name) : undefined,
    token:              r.token ? String(r.token) : undefined,
    createdAt:          String(r.created_at ?? ''),
  };
}

export function mapReceiptFromSupabase(raw: unknown): Receipt {
  const r       = asRecord(raw);
  const biller  = asRecord(r.biller);
  const product = asRecord(r.product);
  return {
    transactionId:      String(r.id ?? ''),
    reference:          String(r.receipt_number ?? ''),
    status:             SUPABASE_STATUS_MAP[String(r.status ?? '')] ?? 'PENDING',
    serviceType:        SUPABASE_CATEGORY_MAP[String(r.category ?? '')] ?? 'AIRTIME',
    amount:             Number(r.amount_kobo ?? 0),
    charges:            Number(r.convenience_fee_kobo ?? 0),
    totalAmount:        Number(r.retail_amount_kobo ?? 0),
    customerIdentifier: String(r.customer_reference ?? ''),
    customerName:       r.customer_name ? String(r.customer_name) : undefined,
    providerName:       biller.name  ? String(biller.name)  : undefined,
    productName:        product.name ? String(product.name) : undefined,
    token:              r.token ? String(r.token) : undefined,
    createdAt:          String(r.created_at ?? ''),
  };
}

export function mapTransactionFromApi(raw: unknown): Transaction {
  const r = asRecord(raw);
  return {
    id:                 String(r.id ?? ''),
    serviceType:        String(r.serviceType ?? r.service_type ?? 'AIRTIME') as ServiceType,
    status:             String(r.status ?? 'PENDING') as TransactionStatus,
    amount:             Number(r.amount ?? 0),
    charges:            Number(r.charges ?? 0),
    totalAmount:        Number(r.totalAmount ?? r.total_amount ?? 0),
    reference:          String(r.reference ?? ''),
    customerIdentifier: String(r.customerIdentifier ?? r.customer_identifier ?? ''),
    providerName:       r.providerName ? String(r.providerName) : r.provider_name ? String(r.provider_name) : undefined,
    providerRoute:      r.providerRoute ? String(r.providerRoute) : r.provider_route ? String(r.provider_route) : undefined,
    providerAttempts:   r.providerAttempts ? String(r.providerAttempts) : r.provider_attempts ? String(r.provider_attempts) : undefined,
    productName:        r.productName ? String(r.productName) : r.product_name ? String(r.product_name) : undefined,
    token:              r.token ? String(r.token) : undefined,
    units:              r.units ? String(r.units) : undefined,
    createdAt:          String(r.createdAt ?? r.created_at ?? ''),
  };
}

export function mapReceiptFromApi(raw: unknown): Receipt {
  const r = asRecord(raw);
  return {
    transactionId:      String(r.transactionId ?? r.transaction_id ?? ''),
    reference:          String(r.reference ?? ''),
    status:             String(r.status ?? ''),
    serviceType:        String(r.serviceType ?? r.service_type ?? ''),
    amount:             Number(r.amount ?? 0),
    charges:            Number(r.charges ?? 0),
    totalAmount:        Number(r.totalAmount ?? r.total_amount ?? 0),
    customerIdentifier: String(r.customerIdentifier ?? r.customer_identifier ?? ''),
    customerName:       r.customerName ? String(r.customerName) : r.customer_name ? String(r.customer_name) : undefined,
    productName:        r.productName ? String(r.productName) : r.product_name ? String(r.product_name) : undefined,
    providerName:       r.providerName ? String(r.providerName) : r.provider_name ? String(r.provider_name) : undefined,
    providerRoute:      r.providerRoute ? String(r.providerRoute) : r.provider_route ? String(r.provider_route) : undefined,
    providerAttempts:   r.providerAttempts ? String(r.providerAttempts) : r.provider_attempts ? String(r.provider_attempts) : undefined,
    token:              r.token ? String(r.token) : undefined,
    units:              r.units ? String(r.units) : undefined,
    createdAt:          String(r.createdAt ?? r.created_at ?? ''),
    supportMessage:     r.supportMessage ? String(r.supportMessage) : r.support_message ? String(r.support_message) : undefined,
  };
}
