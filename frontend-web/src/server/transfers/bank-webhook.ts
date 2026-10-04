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
 *   - Post a balanced REVERSAL_DEBIT / REVERSAL_CREDIT pair (ADR-040) to restore
 *     the sender's balance and drain the provider_clearing pot
 *   - Mark bank_transfer as 'failed' / 'reversed'
 *
 * Idempotency: status check on bank_transfers prevents double-processing.
 * The settle itself lives in ./bank-settle, shared with the verify-on-read
 * fallback (GET /api/v1/transfers/bank/[id]) — one code path, one idempotency
 * key shape, so a late webhook after a verify settle is a safe no-op.
 * Signature: verified independently from the main webhook fan-out.
 */

import crypto from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/server';
import {
  applyBankTransferOutcome,
  isTerminalBankTransferStatus,
} from '@/src/server/transfers/bank-settle';

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
    sender_entry_id: string | null;
  } | undefined;

  if (!transfer) {
    // Not our transfer — silently ignore
    return { processed: false, duplicate: false };
  }

  // Already in a terminal state — duplicate webhook
  if (isTerminalBankTransferStatus(transfer.status)) {
    return { processed: false, duplicate: true };
  }

  const isSuccess  = event.event === 'transfer.success';
  const isFailed   = event.event === 'transfer.failed';
  const isReversed = event.event === 'transfer.reversed';

  if (!isSuccess && !isFailed && !isReversed) {
    // Intermediate status update (transfer.otp, etc.) — acknowledge but don't act
    return { processed: false, duplicate: false };
  }

  await applyBankTransferOutcome(
    transfer,
    isSuccess ? 'success' : isReversed ? 'reversed' : 'failed',
    event.data.reason,
  );

  return { processed: true, duplicate: false };
}
