/**
 * Pure ledger types and math — no Supabase, no I/O.
 *
 * Balance formula:
 *   CREDIT          → +amount  (money in)
 *   DEBIT           → -amount  (money out)
 *   REVERSAL_CREDIT → -amount  (reversal of a credit: money returned)
 *   REVERSAL_DEBIT  → +amount  (reversal of a debit: money restored)
 */

export type LedgerEntryType = 'CREDIT' | 'DEBIT' | 'REVERSAL_CREDIT' | 'REVERSAL_DEBIT';

export const CREDIT_SIDE_TYPES: ReadonlySet<LedgerEntryType> = new Set([
  'CREDIT',
  'REVERSAL_DEBIT',
]);

export interface LedgerEntryRow {
  id: string;
  account_id: string;
  type: LedgerEntryType;
  amount_kobo: number;
  reference: string;
  idempotency_key: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface LedgerAccountRow {
  id: string;
  user_id: string;
  type: string;
  currency: string;
  created_at: string;
}

export interface WalletBalanceRow {
  account_id: string;
  user_id: string;
  account_type: string;
  currency: string;
  available_kobo: number;
  last_transaction_at: string | null;
}

/**
 * Compute the wallet balance from a list of ledger entries.
 *
 * This is the pure projection function that mirrors the SQL view.
 * Amounts must be positive integers (kobo). Throws if any amount violates this.
 */
export function computeWalletBalance(entries: Pick<LedgerEntryRow, 'type' | 'amount_kobo'>[]): number {
  for (const entry of entries) {
    validateAmountKobo(entry.amount_kobo);
  }

  return entries.reduce((sum, entry) => {
    return CREDIT_SIDE_TYPES.has(entry.type)
      ? sum + entry.amount_kobo
      : sum - entry.amount_kobo;
  }, 0);
}

/**
 * Validate that a kobo amount is a positive integer.
 * Called at every point where an amount enters the system.
 */
export function validateAmountKobo(amount: number): void {
  if (!Number.isInteger(amount)) {
    throw new Error(`Amount must be an integer (kobo). Got: ${amount}`);
  }
  if (amount <= 0) {
    throw new Error(`Amount must be positive (kobo). Got: ${amount}`);
  }
}

/**
 * Build an idempotency key for a ledger entry.
 * Format: <operation>:<external-ref>:<side>
 * e.g. "topup:PAY_ref_abc:CREDIT"
 */
export function buildIdempotencyKey(
  operation: string,
  externalRef: string,
  side: LedgerEntryType,
): string {
  return `${operation}:${externalRef}:${side}`;
}
