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

/**
 * One row of GET /api/finance/admin/wallets/:user_id/transactions.
 *
 * Mirrors the Go handler's `wallet.Transaction`, which projects the four raw
 * ledger entry types down to a lowercase credit/debit pair and omits
 * account_id/idempotency_key. This type previously described the raw
 * ledger_entries row instead, so nothing matched and the table stayed empty.
 */
export interface LedgerEntry {
  id: string;
  type: 'credit' | 'debit';
  amount_kobo: number;
  reference: string;
  created_at: string;
}

export interface TransactionsResponse {
  transactions: LedgerEntry[];
  limit: number;
  offset: number;
  total: number;
}

export type DisputeStatus = 'open' | 'investigating' | 'resolved' | 'closed';
export type DisputeResolution = 'refund' | 'partial_refund' | 'no_action';

export interface Dispute {
  id: string;
  user_id: string;
  reference: string;
  module_type: string;
  type: string;
  description: string;
  status: DisputeStatus;
  resolution: DisputeResolution | null;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
}
