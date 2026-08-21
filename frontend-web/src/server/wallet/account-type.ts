/**
 * The ledger account type holding a user's spendable naira balance (ADR-045).
 *
 * There used to be two. The base migration restricted `ledger_accounts.type` to
 * `'wallet'`, so this Next.js wallet created that; the Go finance ledger
 * (internal/finance/ledger) creates `'user_wallet'`, and 20260912000001 widened
 * the CHECK to admit both rather than unifying them. The result was two spendable
 * pots per user, mutated by whichever process happened to run — and a balance read
 * that summed both, so the split was invisible until money crossed the boundary.
 *
 * It crossed when the card rail started funding checkouts (ADR-041): the top-up
 * credited `'wallet'` while the Go module escrow debited `'user_wallet'`, so a
 * card-paid order was charged, credited, and then failed for insufficient funds.
 *
 * Every site that resolves a user's wallet account MUST use this constant. The
 * defect was three string literals in three files drifting from a fourth.
 */
export const WALLET_ACCOUNT_TYPE = 'user_wallet' as const;

/**
 * The pre-ADR-045 type. Retained ONLY for read paths that must keep seeing a
 * residual balance (the displayed balance, reconciliation). Never write to it and
 * never resolve an account for a mutation with it — 20261209000100 sweeps existing
 * balances into WALLET_ACCOUNT_TYPE.
 */
export const LEGACY_WALLET_ACCOUNT_TYPE = 'wallet' as const;

/** Both planes, for read-only balance/reconciliation queries. */
export const SPENDABLE_WALLET_TYPES = [WALLET_ACCOUNT_TYPE, LEGACY_WALLET_ACCOUNT_TYPE] as const;
