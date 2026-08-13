// Transfers admin console — domain types (snake_case mirrors the Go backend).
// RBAC: finance.admin.transfers. Money amounts are integer kobo (minor units).

export type TransferType = 'wallet_to_wallet' | 'wallet_to_bank' | 'bank_to_bank';
export type TransferSourceType = 'wallet' | 'bank';
export type TransferProvider = 'paystack' | 'monnify';

export type TransferStatus =
  | 'funds_reserved'
  | 'awaiting_funding'
  | 'funded'
  | 'provider_initiated'
  | 'successful'
  | 'failed'
  | 'reversed';

export interface Transfer {
  id: string;
  reference: string;
  user_id: string;
  type: TransferType;
  source_type: TransferSourceType;
  provider: TransferProvider;
  failover_from?: TransferProvider | null;
  bank_name: string;
  account_name: string;
  account_number_last4: string;
  amount_kobo: number;
  fee_kobo: number;
  status: TransferStatus;
  narration: string;
  provider_transfer_ref: string;
  created_at: string;
  updated_at: string;
  ledger_entry_ids?: string[];
  // Detail-only enrichment (bank→bank has a funding leg + a payout leg).
  funding_ledger_entry_ids?: string[];
  payout_ledger_entry_ids?: string[];
  provider_response?: string;
}

export interface ProviderHealth {
  provider: TransferProvider;
  healthy: boolean;
  last_checked: string;
}

export interface TransferFilters {
  status?: TransferStatus;
  provider?: TransferProvider;
  source_type?: TransferSourceType;
}

// Statuses where a Retry re-attempt is permitted (held / failed states).
export const RETRYABLE_STATUSES: TransferStatus[] = [
  'funds_reserved',
  'awaiting_funding',
  'funded',
  'failed',
];

// Statuses where a manual Reverse is permitted (pre-settlement only — never
// after the funds have left as a successful payout).
export const REVERSIBLE_STATUSES: TransferStatus[] = [
  'funds_reserved',
  'awaiting_funding',
  'funded',
  'provider_initiated',
  'failed',
];
