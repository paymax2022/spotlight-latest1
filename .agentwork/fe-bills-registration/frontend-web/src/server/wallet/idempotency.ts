import { createAdminClient } from '@/lib/supabase/server';
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
export async function checkIdempotencyKey(idempotencyKey: string): Promise<IdempotencyCheckResult> {
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from('ledger_entries')
    .select('amount_kobo, type')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (existing) {
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
): Promise<{ intentId: string; paymentReference: string; authorizationUrl: string; amountKobo: number } | null> {
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from('wallet_topup_intents')
    .select('id, payment_reference, authorization_url, amount_kobo')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (!existing) return null;

  return {
    intentId: existing.id as string,
    paymentReference: existing.payment_reference as string,
    authorizationUrl: existing.authorization_url as string,
    amountKobo: existing.amount_kobo as number,
  };
}
