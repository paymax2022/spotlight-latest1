import { User } from '@/types/auth';

type ApiRecord = Record<string, unknown>;

function asRecord(v: unknown): ApiRecord {
  return typeof v === 'object' && v !== null ? (v as ApiRecord) : {};
}

export function mapUserFromApi(raw: unknown): User {
  const r = asRecord(raw);
  return {
    id:            String(r.id ?? ''),
    fullName:      String(r.fullName ?? r.full_name ?? ''),
    email:         String(r.email ?? ''),
    phone:         String(r.phone ?? ''),
    walletBalance: Number(r.walletBalance ?? r.wallet_balance ?? 0),
    kycStatus:     r.kycStatus ? String(r.kycStatus) : r.kyc_status ? String(r.kyc_status) : undefined,
  };
}
