export type KycStatus = 'none' | 'pending' | 'submitted' | 'verified' | 'failed';

export interface KycProfile {
  user_id: string;
  kyc_tier: number;
  kyc_status: KycStatus;
  kyc_submitted_at: string | null;
  kyc_verified_at: string | null;
  phone_verified: boolean;
  document_type: string | null;
  requested_tier: number | null;
}

export interface WalletBalance {
  user_id: string;
  balance_kobo: number;
}

export interface LedgerEntry {
  id: string;
  account_id: string;
  type: 'CREDIT' | 'DEBIT' | 'REVERSAL_CREDIT' | 'REVERSAL_DEBIT';
  amount_kobo: number;
  reference: string;
  idempotency_key: string;
  created_at: string;
}

export interface TransactionsResponse {
  entries: LedgerEntry[];
  total: number;
}
