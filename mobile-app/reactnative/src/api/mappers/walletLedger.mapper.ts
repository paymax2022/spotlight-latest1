/**
 * Pure logic for wallet ledger reads — kept side-effect-free so it is unit
 * testable under `node --test` (see tests/unit/wallet/ledgerHistory.spec.ts).
 */

/**
 * Reference prefix stamped on BOTH legs of the ADR-045 wallet-plane
 * consolidation sweep (supabase/migrations/20261209000100):
 *   DEBIT  on the legacy 'wallet' account        → 'wallet-plane-consolidate:<from_id>'
 *   CREDIT on the unified 'user_wallet' account  → 'wallet-plane-consolidate:<from_id>'
 *
 * These are internal migration bookkeeping, not user activity. They stay in
 * `ledger_entries` (append-only, audit) but are excluded from user-facing
 * history and totals: the pair nets to zero across the user's spendable
 * balance, so counting it would inflate BOTH Income and Expenses by the swept
 * amount and read as a phantom debit+credit pair in the transaction list.
 */
export const INTERNAL_SWEEP_REFERENCE_PREFIX = 'wallet-plane-consolidate:';

/** PostgREST LIKE pattern matching every consolidation-sweep leg. */
export const INTERNAL_SWEEP_REFERENCE_LIKE = `${INTERNAL_SWEEP_REFERENCE_PREFIX}%`;

/** True when a ledger reference belongs to an internal plane-consolidation sweep. */
export function isInternalSweepReference(reference: unknown): boolean {
  return typeof reference === 'string' && reference.startsWith(INTERNAL_SWEEP_REFERENCE_PREFIX);
}

/**
 * Account ids from `wallet_balance` rows for the user's spendable planes.
 *
 * History follows the USER, not the current account: post-consolidation a user
 * can hold BOTH a 'user_wallet' account (new activity) and a legacy 'wallet'
 * account (pre-sweep history, swept to zero but never deleted). Picking one —
 * the old order-by-account_type-limit-1 — silently dropped the other plane's
 * history. Returns the ids deduped and sorted for deterministic behaviour.
 */
export function selectSpendableAccountIds(
  rows: ReadonlyArray<Record<string, unknown>>,
): string[] {
  const ids = new Set<string>();
  for (const r of rows) {
    const id = String(r?.account_id ?? '').trim();
    if (id) ids.add(id);
  }
  return [...ids].sort();
}

// Balance formula (see the wallet_balance view):
//   CREDIT, REVERSAL_DEBIT  → money IN  (+)
//   DEBIT,  REVERSAL_CREDIT → money OUT (−)
const CREDIT_TYPES = new Set(['CREDIT', 'REVERSAL_DEBIT']);

/** Net direction of a ledger entry type on the wallet balance. */
export function isCreditLedgerType(type: unknown): boolean {
  return CREDIT_TYPES.has(String(type ?? 'DEBIT'));
}

export interface LedgerFlowTotals {
  incomeKobo: number;
  expensesKobo: number;
  entryCount: number;
}

/**
 * Income/Expense totals over raw `ledger_entries` rows. Internal sweep legs
 * are skipped (defensive layer under the server-side `NOT LIKE` filter — a
 * caller that forgets the filter still gets correct totals). All amounts are
 * integer kobo.
 */
export function summarizeLedgerRows(
  rows: ReadonlyArray<Record<string, unknown>>,
): LedgerFlowTotals {
  let incomeKobo = 0;
  let expensesKobo = 0;
  let entryCount = 0;
  for (const r of rows) {
    if (isInternalSweepReference(r?.reference)) continue;
    const amt = Number(r?.amount_kobo ?? 0);
    if (isCreditLedgerType(r?.type)) incomeKobo += amt;
    else expensesKobo += amt;
    entryCount += 1;
  }
  return { incomeKobo, expensesKobo, entryCount };
}
