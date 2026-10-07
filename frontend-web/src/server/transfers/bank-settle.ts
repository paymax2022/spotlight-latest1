/**
 * Bank-transfer settlement — the ONE place a wallet-to-bank transfer reaches a
 * terminal state.
 *
 * Two callers reach it (AUD-FE-004 residual):
 *   - the Paystack webhook (transfer.success / .failed / .reversed), and
 *   - GET /api/v1/transfers/bank/[id] verify-on-read — a dropped webhook used
 *     to leave the transfer non-terminal forever, and for failures left the
 *     sender's reserved funds unrefunded.
 *
 * Idempotency: the reversal legs carry `bank-transfer-refund:<id>:transfer.<event>`
 * exactly as the webhook always wrote them, so a late webhook delivery after a
 * verify-on-read settle (or vice versa) no-ops on the ledger UNIQUE constraint
 * and on the terminal-status check.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { buildJournalLegs, getOrCreateStandingAccount } from '@/src/server/wallet/journal';
import { WALLET_ACCOUNT_TYPE } from '@/src/server/wallet/account-type';

export type BankTransferTerminalOutcome = 'success' | 'failed' | 'reversed';

export interface BankTransferSettleRow {
  id: string;
  user_id: string;
  status: string;
  amount_kobo: number;
  fee_kobo: number;
  sender_entry_id: string | null;
}

/** Statuses past which a bank_transfer never moves again. */
export function isTerminalBankTransferStatus(status: string): boolean {
  return status === 'successful' || status === 'failed' || status === 'reversed';
}

/**
 * Apply a terminal outcome to a bank_transfer row.
 *
 * success:            mark 'successful' — funds were already debited at
 *                     reservation, no ledger action.
 * failed / reversed:  post a balanced REVERSAL_DEBIT / REVERSAL_CREDIT pair
 *                     (ADR-040) restoring the sender's balance and draining
 *                     the same `provider_clearing` pot the reservation filled,
 *                     then mark 'failed' / 'reversed'.
 *
 * Callers MUST pass only transfers that are still non-terminal.
 */
export async function applyBankTransferOutcome(
  transfer: BankTransferSettleRow,
  outcome: BankTransferTerminalOutcome,
  reason?: string | null,
): Promise<void> {
  const supabase = createAdminClient();

  if (outcome === 'success') {
    await supabase
      .from('bank_transfers')
      .update({ status: 'successful', updated_at: new Date().toISOString() })
      .eq('id', transfer.id);
    return;
  }

  // Refund: REVERSAL_DEBIT restores the sender's wallet, REVERSAL_CREDIT
  // drains provider_clearing — both legs in one insert so a unique violation
  // rolls back the pair rather than leaving a half-posted correction.
  const refundKobo = transfer.amount_kobo + transfer.fee_kobo;
  const refundRef = `REFUND_${transfer.id.slice(0, 8).toUpperCase()}`;
  const refundKey = `bank-transfer-refund:${transfer.id}:transfer.${outcome}`;

  const { data: accountRow } = await supabase
    .from('ledger_accounts')
    .select('id')
    .eq('user_id', transfer.user_id)
    .eq('type', WALLET_ACCOUNT_TYPE)
    .maybeSingle();

  if (!accountRow) {
    // Marking the row terminal without posting the refund legs would strand the
    // sender's reserved amount+fee with no automated recovery. Throwing keeps
    // the status non-terminal so the next webhook / verify-on-read retries.
    throw new Error(`bank transfer ${transfer.id}: no wallet ledger account for user ${transfer.user_id}`);
  }

  let reversalEntryId: string | null = null;

  const counterAccountId = await getOrCreateStandingAccount('provider_clearing');
  const metadata = {
    bank_transfer_id: transfer.id,
    original_entry_id: transfer.sender_entry_id,
    reason: reason ?? 'Transfer failed',
  };

  const legs = buildJournalLegs({
    primaryAccountId: (accountRow as { id: string }).id,
    counterAccountId,
    primarySide: 'REVERSAL_DEBIT',
    amountKobo: refundKobo,
    reference: refundRef,
    idempotencyKey: refundKey,
    description: `Refund for failed bank transfer ${transfer.id}`,
    metadata,
  });

  const { data: entryRows, error: entryError } = await supabase
    .from('ledger_entries')
    .insert(legs)
    .select('id, idempotency_key');

  if (entryError) {
    if ((entryError as { code?: string }).code !== '23505') {
      // The refund did NOT post — do not mark the row terminal or the money is
      // stranded. Throw and let the next delivery/verify-on-read retry.
      throw entryError;
    }
    // A previous attempt already posted these exact legs — recover its id so
    // reversal_entry_id still points at the real entry.
    const { data: existing } = await supabase
      .from('ledger_entries')
      .select('id')
      .eq('idempotency_key', refundKey)
      .maybeSingle();
    reversalEntryId = (existing as { id: string } | null)?.id ?? null;
  } else if (entryRows) {
    // The wallet leg is the one carrying the un-suffixed key.
    const walletRow = (entryRows as { id: string; idempotency_key: string }[])
      .find((r) => r.idempotency_key === refundKey);
    reversalEntryId = walletRow?.id ?? null;
  }

  await supabase
    .from('bank_transfers')
    .update({
      status: outcome === 'reversed' ? 'reversed' : 'failed',
      reversal_entry_id: reversalEntryId,
      failure_reason: reason ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', transfer.id);
}

export interface PaystackTransferCheck {
  /** Terminal outcome Paystack reports, or null when still in-flight/unknown. */
  outcome: BankTransferTerminalOutcome | null;
  reason?: string | null;
}

/**
 * Verify-on-read: ask Paystack's transfer API for the authoritative status of
 * a transfer we initiated. Fail-CLOSED in the safe direction — an unreachable
 * API, an error reply, or a reply naming a DIFFERENT reference yields no
 * outcome, and the caller leaves our row exactly as it was. Only a real
 * success/failed/reversed moves the transfer.
 */
export async function fetchPaystackTransferOutcome(
  transferIdOrCode: string,
  expectedReference: string | null,
): Promise<PaystackTransferCheck> {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) return { outcome: null };

  let payload: {
    status?: boolean;
    data?: { status?: string; reference?: string; reason?: string | null } | null;
  };
  try {
    const res = await fetch(
      `https://api.paystack.co/transfer/${encodeURIComponent(transferIdOrCode)}`,
      {
        headers: { Authorization: `Bearer ${secretKey}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      },
    );
    payload = await res.json();
  } catch {
    return { outcome: null };
  }

  const data = payload?.data;
  if (!payload || payload.status !== true || !data) return { outcome: null };

  // A reply whose reference is not ours must never settle our row.
  if (expectedReference && data.reference && data.reference !== expectedReference) {
    return { outcome: null };
  }

  switch (data.status) {
    case 'success':  return { outcome: 'success',  reason: data.reason };
    case 'failed':   return { outcome: 'failed',   reason: data.reason };
    case 'reversed': return { outcome: 'reversed', reason: data.reason };
    // 'pending', 'processing', 'otp', 'blocked', … — none of these are final.
    default:         return { outcome: null };
  }
}
