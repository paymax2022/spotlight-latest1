import { api } from '@/api/client';

/**
 * Virtual (dedicated) bank account provisioned for the user to fund their
 * wallet via direct bank transfer. Maps to GET /api/v1/virtual-accounts/me.
 */
export interface VirtualAccount {
  accountNumber: string;
  accountName: string;
  bankName: string;
  bankCode?: string;
  provider?: string;
  status?: string;
}

type ApiRecord = Record<string, unknown>;

function asRecord(value: unknown): ApiRecord {
  return typeof value === 'object' && value !== null ? (value as ApiRecord) : {};
}

function mapVirtualAccount(value: unknown): VirtualAccount | null {
  const record = asRecord(value);
  const accountNumber = String(
    record.account_number ?? record.accountNumber ?? '',
  ).trim();

  // No usable account number => treat as "not provisioned yet".
  if (!accountNumber) return null;

  return {
    accountNumber,
    accountName: String(record.account_name ?? record.accountName ?? '').trim(),
    bankName: String(record.bank_name ?? record.bankName ?? '').trim(),
    bankCode: record.bank_code != null || record.bankCode != null
      ? String(record.bank_code ?? record.bankCode)
      : undefined,
    provider: record.provider != null ? String(record.provider) : undefined,
    status: record.status != null ? String(record.status) : undefined,
  };
}

/**
 * Returns the user's virtual account, or `null` when none has been
 * provisioned yet. A 404 from the backend is treated as "no account".
 */
export async function getMyVirtualAccount(): Promise<VirtualAccount | null> {
  try {
    const response = await api.get('/api/v1/virtual-accounts/me');
    const data = response.data?.data ?? response.data;
    // Some backends wrap the record in an array or an `accounts` field.
    const record = Array.isArray(data)
      ? data[0]
      : data?.account ?? (Array.isArray(data?.accounts) ? data.accounts[0] : data);
    return mapVirtualAccount(record);
  } catch (err) {
    if ((err as { status?: number })?.status === 404) return null;
    throw err;
  }
}
