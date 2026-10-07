import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';
import type { LedgerEntryType } from './ledger';

export interface IdempotencyHit {
  alreadyProcessed: true;
  amountKobo: number;
  entryType: LedgerEntryType;
}

export interface IdempotencyMiss {
  alreadyProcessed: false;
}

export type IdempotencyCheckResult = IdempotencyHit | IdempotencyMiss;

/**
 * Look up an idempotency_key in ledger_entries.
 * Returns the existing entry details if found (caller should return cached result),
 * or { alreadyProcessed: false } if the key has not been used.
 *
 * The DB UNIQUE constraint on idempotency_key is the hard safety net for
 * concurrent requests — this check is an optimistic fast-path.
 */
export async function checkIdempotencyKey(idempotencyKey: string, userId?: string): Promise<IdempotencyCheckResult> {
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from('ledger_entries')
    .select('amount_kobo, type, account_id')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (existing) {
    // Caller-scoping: the un-suffixed key sits on the wallet leg, whose
    // ledger_account belongs to the wallet owner. A key that resolves to a
    // DIFFERENT member's entry is a collision, not a replay — silently
    // returning alreadyProcessed would mask the caller's missing mutation.
    if (userId) {
      const { data: acct } = await supabase
        .from('ledger_accounts')
        .select('user_id')
        .eq('id', existing.account_id as string)
        .maybeSingle();
      if (acct && (acct.user_id as string) !== userId) {
        throw new ApiError('Idempotency-Key conflicts with an existing transaction.', 409);
      }
    }
    return {
      alreadyProcessed: true,
      amountKobo: existing.amount_kobo as number,
      entryType: existing.type as LedgerEntryType,
    };
  }

  return { alreadyProcessed: false };
}

/**
 * Check if a topup intent with this idempotency_key already exists.
 * Returns the existing intent id if found, null otherwise.
 */
export async function checkTopupIdempotencyKey(
  idempotencyKey: string,
): Promise<{ intentId: string; userId: string; paymentReference: string; authorizationUrl: string; amountKobo: number } | null> {
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from('wallet_topup_intents')
    .select('id, user_id, payment_reference, authorization_url, amount_kobo')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (!existing) return null;

  return {
    intentId: existing.id as string,
    userId: existing.user_id as string,
    paymentReference: existing.payment_reference as string,
    authorizationUrl: existing.authorization_url as string,
    amountKobo: existing.amount_kobo as number,
  };
}
