export interface Wallet {
  balance: number;
  currency: string;
  ledgerBalance?: number;
  pendingBalance?: number;
  /**
   * True when NO balance source could produce a figure — `balance` is then a
   * placeholder (0) and must not be rendered as the user's real balance
   * (₦0.00 would mask money they actually have). Spend-path checks treat it
   * as 0, which fails closed; display surfaces should show an unavailable
   * state instead.
   */
  balanceUnavailable?: boolean;
}

export interface TransferRecipient {
  userId: string;
  displayName: string;
  maskedPhone: string;
  avatarUrl: string | null;
}

export interface WalletTransfer {
  id: string;
  reference: string;
  amountKobo: number;
  feeKobo: number;
  totalDebitKobo: number;
  narration: string | null;
  status: 'successful' | 'failed' | 'reversed';
  receiverDisplayName: string;
  alreadyProcessed: boolean;
  createdAt: string;
}

export interface Beneficiary {
  id: string;
  bankCode: string;
  bankName: string;
  accountNumberLast4: string;
  accountName: string;
  nickname: string | null;
  lastUsedAt: string | null;
}

export interface BankTransferResult {
  transferId: string;
  reference: string;
  amountKobo: number;
  feeKobo: number;
  totalDebitKobo: number;
  accountName: string;
  accountNumberLast4: string;
  bankName: string;
  status: string;
  alreadyProcessed: boolean;
  createdAt: string;
}
