/**
 * GET /api/v1/transfers/bank/:id — transfer status, verify-on-read.
 *
 * The transfer lifecycle is completed by the Paystack webhook, which is
 * best-effort: delayed, dropped, or undeliverable entirely (local dev, a bad
 * deploy window). A dropped transfer.success left the row spinning in
 * 'provider_initiated'; a dropped transfer.failed was worse — the sender's
 * reserved funds sat unrefunded with no path back (AUD-FE-004 residual).
 *
 * So while the transfer is non-terminal this read asks Paystack, the
 * authority, and applies the outcome through the SAME settle the webhook runs
 * (src/server/transfers/bank-settle.ts) — same status transition, same
 * `bank-transfer-refund:<id>:transfer.<event>` ledger idempotency key. The two
 * paths can race safely; whichever lands second is a no-op.
 *
 * Fails CLOSED in the safe direction: unreachable Paystack, an error reply,
 * or a reply naming a different reference changes nothing — a payment we
 * cannot confirm is left pending, never marked failed.
 */
import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { requireFeature } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import {
  applyBankTransferOutcome,
  fetchPaystackTransferOutcome,
  isTerminalBankTransferStatus,
} from '@/src/server/transfers/bank-settle';

interface BankTransferRow {
  id: string;
  user_id: string;
  status: string;
  reference: string | null;
  amount_kobo: number;
  fee_kobo: number;
  sender_entry_id: string | null;
  paystack_transfer_code: string | null;
  paystack_transfer_id: number | null;
  failure_reason: string | null;
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    requireFeature('walletBankTransfers');
    const user = await requireRequestUser(request);
    const { id } = await ctx.params;

    const supabase = createAdminClient();
    const { data } = await supabase
      .from('bank_transfers')
      .select(
        'id, user_id, status, reference, amount_kobo, fee_kobo, sender_entry_id,' +
        ' paystack_transfer_code, paystack_transfer_id, failure_reason',
      )
      .eq('id', id)
      .maybeSingle();

    const transfer = (data as BankTransferRow | null) ?? null;
    if (!transfer || transfer.user_id !== user.id) {
      return NextResponse.json({ success: false, error: 'Transfer not found' }, { status: 404 });
    }

    let status = transfer.status;

    if (!isTerminalBankTransferStatus(status)) {
      const providerKey =
        transfer.paystack_transfer_code ??
        (transfer.paystack_transfer_id != null ? String(transfer.paystack_transfer_id) : null);

      if (providerKey) {
        const check = await fetchPaystackTransferOutcome(providerKey, transfer.reference);
        if (check.outcome) {
          await applyBankTransferOutcome(transfer, check.outcome, check.reason);
          status =
            check.outcome === 'success'
              ? 'successful'
              : check.outcome; // 'failed' | 'reversed' map 1:1
        }
      }
      // No provider key = the Paystack call itself never completed at initiate
      // ('funds_reserved'). There is nothing to verify — it stays pending for
      // ops to resolve, unchanged behaviour.
    }

    return NextResponse.json({
      success: true,
      transfer: {
        id: transfer.id,
        reference: transfer.reference,
        status,
        amount_kobo: transfer.amount_kobo,
        fee_kobo: transfer.fee_kobo,
        total_debit_kobo: transfer.amount_kobo + transfer.fee_kobo,
        failure_reason: transfer.failure_reason ?? null,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
