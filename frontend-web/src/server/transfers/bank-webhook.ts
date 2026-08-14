/**
 * Block 11 — Bank Transfer Webhook Handler
 *
 * Handles Paystack `transfer.success` and `transfer.failed` events.
 *
 * transfer.success:
 *   - Mark bank_transfer as 'successful'
 *   - No ledger action needed — funds were already debited at reservation
 *
 * transfer.failed / transfer.reversed:
 *   - Post a balanced REVERSAL_DEBIT / REVERSAL_CREDIT pair (ADR-PR98) to restore
 *     the sender's balance and drain the provider_clearing pot
 *   - Mark bank_transfer as 'failed' / 'reversed'
 *
 * Idempotency: status check on bank_transfers prevents double-processing.
 * Signature: verified independently from the main webhook fan-out.
 */

import crypto from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/server';
import { buildJournalLegs, getOrCreateStandingAccount } from '@/src/server/wallet/journal';

interface BankWebhookResult {
  processed: boolean;
  duplicate: boolean;
  error?: string;
}

type PaystackTransferEvent = {
  event: string;
  data: {
    transfer_code?: string;
    reference?: string;
    id?: number;
    amount?: number;
    reason?: string;
    status?: string;
    recipient?: {
      recipient_code?: string;
    };
  };
};

export async function handleBankTransferWebhook(
  rawBody: string,
  signature: string,
): Promise<BankWebhookResult> {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) return { processed: false, duplicate: false, error: 'Paystack not configured' };

  // Re-verify signature independently
  const expected = crypto.createHmac('sha512', secretKey).update(rawBody).digest('hex');
  if (expected !== signature) {
    return { processed: false, duplicate: false, error: 'Invalid signature' };
  }

  const event = JSON.parse(rawBody) as PaystackTransferEvent;

  // Only handle transfer events
  if (!event.event.startsWith('transfer.')) {
    return { processed: false, duplicate: false };
  }

  const transferCode = event.data?.transfer_code;
  const reference = event.data?.reference;

  if (!transferCode && !reference) {
    return { processed: false, duplicate: false, error: 'Missing transfer_code and reference' };
  }

  const supabase = createAdminClient();

  // Find the bank_transfer by Paystack transfer_code or reference
  const query = supabase
    .from('bank_transfers')
    .select('id, user_id, status, amount_kobo, fee_kobo, sender_entry_id')
    .limit(1);

  if (transferCode) {
    query.eq('paystack_transfer_code', transferCode);
  } else {
    query.eq('reference', reference!);
  }

  const { data: rows } = await query;
  const transfer = (rows ?? [])[0] as {
    id: string;
    user_id: string;
    status: string;
    amount_kobo: number;
    fee_kobo: number;
    sender_entry_id: string;
  } | undefined;

  if (!transfer) {
    // Not our transfer — silently ignore
    return { processed: false, duplicate: false };
  }

  // Already in a terminal state — duplicate webhook
  if (transfer.status === 'successful' || transfer.status === 'failed' || transfer.status === 'reversed') {
    return { processed: false, duplicate: true };
  }

  const isSuccess  = event.event === 'transfer.success';
  const isFailed   = event.event === 'transfer.failed';
  const isReversed = event.event === 'transfer.reversed';

  if (!isSuccess && !isFailed && !isReversed) {
    // Intermediate status update (transfer.otp, etc.) — acknowledge but don't act
    return { processed: false, duplicate: false };
  }

  if (isSuccess) {
    await supabase
      .from('bank_transfers')
      .update({ status: 'successful', updated_at: new Date().toISOString() })
      .eq('id', transfer.id);

    return { processed: true, duplicate: false };
  }

  // Failed or reversed — refund: insert REVERSAL_DEBIT to restore sender's balance
  const refundKobo = transfer.amount_kobo + transfer.fee_kobo;
  const refundRef  = `REFUND_${transfer.id.slice(0, 8).toUpperCase()}`;
  const refundKey  = `bank-transfer-refund:${transfer.id}:${event.event}`;

  // Find the sender's ledger account
  const { data: accountRow } = await supabase
    .from('ledger_accounts')
    .select('id')
    .eq('user_id', transfer.user_id)
    .eq('type', 'wallet')
    .maybeSingle();

  let reversalEntryId: string | null = null;

  if (accountRow) {
    // ADR-PR98: the refund is a BALANCED correction, not a lone credit —
    // REVERSAL_DEBIT restores the sender's wallet while REVERSAL_CREDIT drains
    // the same `provider_clearing` pot that reserve_for_bank_transfer filled
    // (the money never actually reached the provider). Both legs go in one
    // insert, so a unique violation rolls back the pair rather than leaving a
    // half-posted correction.
    const counterAccountId = await getOrCreateStandingAccount('provider_clearing');
    const metadata = {
      bank_transfer_id: transfer.id,
      original_entry_id: transfer.sender_entry_id,
      reason: event.data.reason ?? 'Transfer failed',
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

    if (!entryError && entryRows) {
      // The wallet leg is the one carrying the un-suffixed key.
      const walletRow = (entryRows as { id: string; idempotency_key: string }[])
        .find((r) => r.idempotency_key === refundKey);
      reversalEntryId = walletRow?.id ?? null;
    }
  }

  await supabase
    .from('bank_transfers')
    .update({
      status:            isReversed ? 'reversed' : 'failed',
      reversal_entry_id: reversalEntryId,
      failure_reason:    event.data.reason ?? null,
      updated_at:        new Date().toISOString(),
    })
    .eq('id', transfer.id);

  return { processed: true, duplicate: false };
}
