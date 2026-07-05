/**
 * Unified transfers feature — shared types.
 *
 * Three transfer flows live behind one screen:
 *   - wallet_wallet : Paymax P2P (wallet → wallet)
 *   - wallet_bank   : disburse from wallet to a Nigerian bank account
 *   - bank_bank     : provider pass-through; user funds from a source bank
 *                     (a pay-in / collection step) and we disburse to a
 *                     destination bank.
 */

export type TransferType = 'wallet_wallet' | 'wallet_bank' | 'bank_bank';

export interface Bank {
  code: string;
  name: string;
  slug: string;
}

export interface ResolvedAccount {
  accountName: string;
  accountNumber: string;
  bankCode: string;
}

export interface PinStatus {
  /** Whether the user has already created a transaction PIN. */
  hasPin: boolean;
}

/** Generic receipt model shared by all three flows + the receipt component. */
export interface TransferReceiptData {
  reference: string;
  amountKobo: number;
  feeKobo: number;
  totalKobo: number;
  /** Human-readable destination (name + bank/account or @paymax handle). */
  destinationName: string;
  destinationDetail?: string;
  /** "wallet", "bank", or a provider/network label. */
  sourceLabel: string;
  status: 'successful' | 'pending' | 'funds_reserved' | 'processing' | string;
  createdAt: string;
  provider?: string;
}

// ── Request payloads ────────────────────────────────────────────────────────

export interface WalletBankTransferInput {
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  amountKobo: number;
  narration?: string;
  saveBeneficiary?: boolean;
  pin: string;
}

export interface BankToBankTransferInput {
  source: {
    bankCode: string;
    bankName: string;
    accountNumber: string;
    accountName: string;
  };
  destination: {
    bankCode: string;
    bankName: string;
    accountNumber: string;
    accountName: string;
  };
  amountKobo: number;
  narration?: string;
  saveBeneficiary?: boolean;
  pin: string;
}
