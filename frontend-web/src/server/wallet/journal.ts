/**
 * Balanced double-entry journal primitive for the Next.js wallet plane.
 *
 * WHY THIS EXISTS (see docs/adr/ADR-PR98-wallet-plane-double-entry.md)
 * -------------------------------------------------------------------
 * `public.ledger_entries` is SHARED: the Go finance module
 * (backend/internal/finance/ledger) posts balanced DR/CR pairs into it, while
 * this Next.js wallet plane historically posted a SINGLE leg per money event
 * (a bare CREDIT for a top-up, a bare DEBIT for a spend). Because the table is
 * shared, one single-sided writer makes global conservation — `SUM(signed) = 0`
 * over the whole table — permanently unassertable, and it violates the CLAUDE.md
 * iron rule that every money mutation posts balanced double-entry.
 *
 * ADR-PR98 decision (option a): give every wallet-plane movement a counter-leg on
 * the SAME chart of accounts the Go ledger uses (`provider_clearing`,
 * `settlement`, `paymax_revenue`, …), so the shared table balances globally and
 * the two planes stay reconcilable.
 *
 * IDEMPOTENCY-KEY COMPATIBILITY (load-bearing)
 * --------------------------------------------
 * The PRIMARY (wallet-side) leg keeps the caller's idempotency key VERBATIM.
 * Only the counter-leg gets the `:counter` suffix. This is deliberate: entries
 * written before ADR-PR98 carry the un-suffixed key, and `checkIdempotencyKey`
 * looks up that exact string. Had we moved the wallet leg to a `:debit`/`:credit`
 * suffix (the Go convention), a replayed webhook for a pre-ADR event would miss
 * the dedup check and DOUBLE-CREDIT the user. Never change this.
 *
 * ATOMICITY
 * ---------
 * Both legs go in ONE `.insert([legA, legB])` call. PostgREST executes a
 * multi-row insert as a single statement, so it is all-or-nothing: a unique
 * violation on either leg rolls back both and no half-journal can be written.
 */
import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';
import { CREDIT_SIDE_TYPES, validateAmountKobo, type LedgerEntryType } from './ledger';

/**
 * Standing (system) account types this plane may post counter-legs to.
 *
 * These are a SUBSET of the Go ledger's chart of accounts
 * (backend/internal/finance/ledger/model.go `AccountType`) — deliberately the
 * same strings so a counter-leg written here lands on the very same
 * `ledger_accounts` row the Go plane uses, which is what makes cross-plane
 * reconciliation possible at all.
 */
export type StandingAccountType =
  | 'provider_clearing'         // money crossing the boundary to/from a PSP (Paystack, VA inflow)
  | 'settlement'                // generic platform clearing pot (admin adjustments, opening balances)
  | 'paymax_revenue'            // platform income (fees, paid votes)
  | 'referral_reward_expense'   // platform-funded referral bonuses
  | 'failed_transfer_suspense'; // funds reserved out of a wallet, awaiting provider outcome

/** Default counter-account for money entering a wallet from outside the platform. */
export const DEFAULT_CREDIT_COUNTER: StandingAccountType = 'provider_clearing';
/** Default counter-account for money leaving a wallet. */
export const DEFAULT_DEBIT_COUNTER: StandingAccountType = 'settlement';

/** Suffix appended to the caller's idempotency key for the counter-leg. */
export const COUNTER_LEG_SUFFIX = ':counter';

/**
 * The opposite side of a leg. CREDIT/DEBIT are ordinary movements;
 * REVERSAL_DEBIT/REVERSAL_CREDIT are the correction pair (the ledger is
 * append-only, so corrections are reversing entries — never UPDATEs).
 */
export const COUNTER_SIDE: Readonly<Record<LedgerEntryType, LedgerEntryType>> = Object.freeze({
  CREDIT: 'DEBIT',
  DEBIT: 'CREDIT',
  REVERSAL_DEBIT: 'REVERSAL_CREDIT',
  REVERSAL_CREDIT: 'REVERSAL_DEBIT',
});

export interface LedgerLegInsert {
  account_id: string;
  type: LedgerEntryType;
  amount_kobo: number;
  reference: string;
  idempotency_key: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Pure helpers (no I/O — unit-testable, and the basis of the CI invariant test)
// ---------------------------------------------------------------------------

/** Signed kobo contribution of one leg, using the same sign rule as wallet_balance. */
export function signedKobo(leg: Pick<LedgerLegInsert, 'type' | 'amount_kobo'>): number {
  return CREDIT_SIDE_TYPES.has(leg.type) ? leg.amount_kobo : -leg.amount_kobo;
}

/** Signed sum over a set of legs. Conservation holds iff this is exactly 0. */
export function journalSignedSum(legs: Pick<LedgerLegInsert, 'type' | 'amount_kobo'>[]): number {
  return legs.reduce((sum, leg) => sum + signedKobo(leg), 0);
}

/** True when the legs conserve value (equal credit and debit weight). */
export function journalIsBalanced(legs: Pick<LedgerLegInsert, 'type' | 'amount_kobo'>[]): boolean {
  return legs.length > 0 && journalSignedSum(legs) === 0;
}

export interface JournalInput {
  /**
   * The account the event is "about" — for a wallet movement, the user's
   * wallet-plane account (ledger_accounts.type = 'wallet'). This leg carries the
   * caller's idempotency key verbatim.
   */
  primaryAccountId: string;
  /** The standing account carrying the counter-leg. */
  counterAccountId: string;
  /** Side posted to the primary account; the counter-leg takes the opposite side. */
  primarySide: LedgerEntryType;
  amountKobo: number;
  reference: string;
  /** Caller's key. Used VERBATIM on the wallet leg — see the note at the top. */
  idempotencyKey: string;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Build the balanced pair for one money event. Pure — no I/O.
 * The primary leg is always index 0 so callers can identify it positionally.
 */
export function buildJournalLegs(input: JournalInput): [LedgerLegInsert, LedgerLegInsert] {
  validateAmountKobo(input.amountKobo);

  const description = input.description ?? null;
  const metadata = input.metadata ?? null;

  const primaryLeg: LedgerLegInsert = {
    account_id: input.primaryAccountId,
    type: input.primarySide,
    amount_kobo: input.amountKobo,
    reference: input.reference,
    idempotency_key: input.idempotencyKey,
    description,
    metadata,
  };

  const counterLeg: LedgerLegInsert = {
    account_id: input.counterAccountId,
    type: COUNTER_SIDE[input.primarySide],
    amount_kobo: input.amountKobo,
    reference: input.reference,
    idempotency_key: input.idempotencyKey + COUNTER_LEG_SUFFIX,
    description,
    metadata,
  };

  return [primaryLeg, counterLeg];
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Resolve (creating on first use) the standing ledger account for `type`.
 *
 * Standing accounts are singletons keyed by type with `user_id IS NULL AND
 * group_id IS NULL` — the same shape and the same uniqueness index
 * (`ledger_accounts_standing_type_key`) the Go `GetOrCreateStandingAccount`
 * relies on, so both planes converge on ONE row per type.
 */
export async function getOrCreateStandingAccount(type: StandingAccountType): Promise<string> {
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from('ledger_accounts')
    .select('id')
    .is('user_id', null)
    .is('group_id', null)
    .eq('type', type)
    .maybeSingle();

  if (existing) return (existing as { id: string }).id;

  const newId = crypto.randomUUID();
  const { error } = await supabase
    .from('ledger_accounts')
    .insert({ id: newId, user_id: null, type, currency: 'NGN' });

  if (error) {
    // Race: the Go plane (or a concurrent request) created it first — re-fetch.
    const { data: raced } = await supabase
      .from('ledger_accounts')
      .select('id')
      .is('user_id', null)
      .is('group_id', null)
      .eq('type', type)
      .maybeSingle();
    if (raced) return (raced as { id: string }).id;
    throw new ApiError(`Failed to resolve standing account '${type}'`, 500);
  }

  return newId;
}

export interface PostJournalResult {
  /** True when a unique violation showed the journal was already posted. */
  duplicate: boolean;
}

/**
 * Insert a balanced journal atomically.
 *
 * Refuses to write an unbalanced set — the guard is fail-closed and deliberate:
 * an imbalance here is a programming error, and letting it through is exactly
 * the regression ADR-PR98 exists to prevent.
 */
export async function postJournal(
  legs: LedgerLegInsert[],
  errorContext: string,
): Promise<PostJournalResult> {
  if (!journalIsBalanced(legs)) {
    throw new ApiError(
      `${errorContext}: refusing to post an unbalanced journal (signed sum ${journalSignedSum(legs)} kobo)`,
      500,
    );
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from('ledger_entries').insert(legs);

  if (error) {
    if (error.code === '23505') return { duplicate: true };
    throw new ApiError(`${errorContext}: ${error.message}`, 500);
  }

  return { duplicate: false };
}
