import { User } from '@/types/auth';

type ApiRecord = Record<string, unknown>;

function asRecord(value: unknown): ApiRecord {
  return typeof value === 'object' && value !== null ? (value as ApiRecord) : {};
}

export function mapUserFromApi(value: unknown): User {
  const record = asRecord(value);
  return {
    id: String(record.id ?? ''),
    fullName: String(record.fullName ?? record.full_name ?? record.name ?? ''),
    email: String(record.email ?? ''),
    phone: record.phone ? String(record.phone) : undefined,
    walletBalance: Number(record.walletBalance ?? record.wallet_balance ?? 0),
    kycStatus: record.kycStatus || record.kyc_status ? String(record.kycStatus ?? record.kyc_status) : undefined
  };
}
