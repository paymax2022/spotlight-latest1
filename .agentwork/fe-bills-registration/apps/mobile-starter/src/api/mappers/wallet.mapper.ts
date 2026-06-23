import { Wallet } from '@/types/billing';

type ApiRecord = Record<string, unknown>;

function asRecord(value: unknown): ApiRecord {
  return typeof value === 'object' && value !== null ? (value as ApiRecord) : {};
}

export function mapWalletFromApi(value: unknown): Wallet {
  const record = asRecord(value);

  // Backend returns available_kobo (integer kobo); divide by 100 for naira display.
  // Fallback to record.balance for any legacy responses that already carry naira.
  const availableKobo = record.available_kobo;
  const balance =
    availableKobo != null
      ? Number(availableKobo) / 100
      : Number(record.balance ?? 0);

  return {
    balance,
    currency: (record.currency ?? 'NGN') as Wallet['currency'],
    ledgerBalance:
      record.ledgerBalance == null && record.ledger_balance == null
        ? undefined
        : Number(record.ledgerBalance ?? record.ledger_balance),
    pendingBalance:
      record.pendingBalance == null && record.pending_balance == null
        ? undefined
        : Number(record.pendingBalance ?? record.pending_balance),
  };
}
