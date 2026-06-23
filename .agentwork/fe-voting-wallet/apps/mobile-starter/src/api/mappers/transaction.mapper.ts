import { Receipt, ServiceType, Transaction, TransactionStatus } from '@/types/billing';

type ApiRecord = Record<string, unknown>;

function asRecord(value: unknown): ApiRecord {
  return typeof value === 'object' && value !== null ? (value as ApiRecord) : {};
}

function optionalString(value: unknown) {
  return value == null ? undefined : String(value);
}

/**
 * Map utility transaction statuses to the mobile TransactionStatus enum.
 *
 * Utility statuses: pending | wallet_debited | provider_pending | requerying |
 *                   fulfilled | failed | reversed | refunded
 * Legacy statuses (bills v1): PENDING | PROCESSING | SUCCESSFUL | FAILED | REFUNDED | REVERSED
 */
function mapStatus(raw: unknown): TransactionStatus {
  const s = String(raw ?? '').toLowerCase();
  if (s === 'fulfilled' || s === 'successful' || s === 'success' || s === 'completed') return 'SUCCESSFUL';
  if (s === 'failed' || s === 'failure') return 'FAILED';
  if (s === 'reversed') return 'REVERSED';
  if (s === 'refunded') return 'REFUNDED';
  if (s === 'wallet_debited' || s === 'provider_pending' || s === 'requerying' || s === 'processing') return 'PROCESSING';
  return 'PENDING';
}

/**
 * Map utility category strings to the mobile ServiceType enum.
 * Accepts both DB format (AIRTIME, DATA, ELECTRICITY, CABLE_TV) and legacy camelCase.
 */
function mapServiceType(raw: unknown): ServiceType {
  const s = String(raw ?? '').toUpperCase().replace(/[^A-Z_]/g, '_');
  if (s === 'DATA') return 'DATA';
  if (s.includes('ELECTRIC')) return 'ELECTRICITY';
  if (s.includes('CABLE')) return 'CABLE_TV';
  return 'AIRTIME';
}

export function mapTransactionFromApi(value: unknown): Transaction {
  const record = asRecord(value);

  // Utility API uses kobo amounts; legacy billing used naira amounts directly.
  // retail_amount_kobo is the authoritative amount field from utility_transactions.
  const retailKobo = record.retail_amount_kobo;
  const amountKobo = record.amount_kobo;
  const amount =
    retailKobo != null
      ? Number(retailKobo) / 100
      : amountKobo != null
      ? Number(amountKobo) / 100
      : Number(record.amount ?? 0);

  const feeKobo = record.convenience_fee_kobo;
  const charges = feeKobo != null ? Number(feeKobo) / 100 : Number(record.charges ?? 0);

  return {
    id: String(record.id ?? record.transactionId ?? record.transaction_id ?? ''),
    serviceType: mapServiceType(record.category ?? record.serviceType ?? record.service_type),
    status: mapStatus(record.status),
    amount,
    charges,
    totalAmount: amount + charges,
    reference: String(record.provider_reference ?? record.reference ?? record.idempotency_key ?? ''),
    customerIdentifier: String(
      record.customer_reference ?? record.customerIdentifier ?? record.customer_identifier ??
      record.phoneNumber ?? record.meterNumber ?? record.smartCardNumber ?? ''
    ),
    providerName: optionalString(
      record.biller_name ?? record.providerName ?? record.provider_name ?? record.network ?? record.discoName
    ),
    productName: optionalString(record.product_name ?? record.productName ?? record.planName ?? record.packageName),
    token: optionalString(record.token),
    units: optionalString(record.units),
    createdAt: String(record.created_at ?? record.createdAt ?? new Date().toISOString()),
  };
}

export function mapReceiptFromApi(value: unknown): Receipt {
  const record = asRecord(value);
  const transaction = mapTransactionFromApi(value);
  return {
    ...transaction,
    transactionId: String(record.transactionId ?? record.transaction_id ?? transaction.id),
    customerName: optionalString(record.customerName ?? record.customer_name),
    supportMessage: optionalString(record.supportMessage ?? record.support_message),
  };
}
