/**
 * Realtor lease-invoice money-path.
 *
 * Fixes a Blocker-severity gap: `realtor_pay_invoice` (Supabase RPC, SECURITY
 * DEFINER) used to be callable directly by the mobile client and would mark an
 * invoice paid, activate the lease and create an escrow deposit with ZERO
 * verification that any money moved — no wallet debit, no ledger entry, no
 * Paystack call. Any tenant could tap "Pay" and get a free lease.
 *
 * This module is the ONLY supported entry point now. It mirrors
 * `src/server/estate/dues.ts#payInvoice` exactly:
 *  - amounts are BIGINT kobo throughout (never floats)
 *  - paying REQUIRES an Idempotency-Key, passed through to the wallet ledger
 *  - the money mutation is a balanced double-entry posting performed by the
 *    shared `debitWallet` primitive (atomic `debit_wallet_atomic` RPC) — we
 *    never UPDATE a balance column directly
 *  - tier daily-limit checks run fail-closed inside `debitWallet`
 *    (`enforceWalletLimit` throws 403 for Tier 0 / exceeded caps)
 *  - only AFTER the debit is confirmed do we call the (now-hardened)
 *    `realtor_pay_invoice` SQL RPC via the service-role client to perform
 *    finalization (payment record, invoice→paid, lease→active, escrow,
 *    move-in checklist). The RPC itself additionally refuses to finalize
 *    unless it finds a matching ledger DEBIT for the idempotency key — see
 *    supabase/migrations/<the migration created alongside this file> — so the
 *    exploit is closed at the database layer too, not just here.
 *
 * PAYSTACK is intentionally NOT implemented here (out of scope for this fix —
 * see docs/qa/modules/realtor.md); it is refused with a clear 501 rather than
 * faked.
 */
import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';
import { debitWallet } from '@/src/server/wallet/service';

const INVOICE_COLS = 'id, lease_id, status, lines, total_kobo, due_date, paid_at, created_at';
const PAYMENT_COLS = 'id, invoice_id, user_id, channel, amount_kobo, escrow_held_kobo, status, reference, idempotency_key, paid_at';

export function mapInvoice(row: any) {
  return {
    id: row.id,
    leaseId: row.lease_id,
    status: row.status,
    lines: row.lines ?? [],
    totalKobo: row.total_kobo,
    dueDate: row.due_date ?? undefined,
    paidAt: row.paid_at ?? undefined,
    createdAt: row.created_at,
  };
}

export function mapPayment(row: any) {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    userId: row.user_id,
    channel: row.channel,
    amountKobo: row.amount_kobo,
    escrowHeldKobo: row.escrow_held_kobo,
    status: row.status,
    reference: row.reference,
    paidAt: row.paid_at ?? undefined,
  };
}

export interface PayInvoiceInput {
  userId: string;
  invoiceId: string;
  channel: 'WALLET' | 'PAYSTACK';
  idempotencyKey: string;
}

export interface PayInvoiceResult {
  alreadyProcessed: boolean;
  payment: ReturnType<typeof mapPayment>;
  invoice: ReturnType<typeof mapInvoice>;
  escrowHeldKobo: number;
}

export async function payInvoice(input: PayInvoiceInput): Promise<PayInvoiceResult> {
  const { userId, invoiceId, channel, idempotencyKey } = input;
  if (!idempotencyKey) throw new ApiError('Idempotency-Key header is required for realtor invoice payments.', 400);

  const supabase = createAdminClient();

  // Idempotent fast-path: realtor_payments.idempotency_key has a UNIQUE
  // constraint (supabase/migrations/20260620010000_realtor_lease_payments.sql).
  const { data: priorPayment, error: priorErr } = await supabase
    .from('realtor_payments')
    .select(PAYMENT_COLS)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (priorErr) throw new ApiError(`Failed to check prior payment: ${priorErr.message}`, 500);
  if (priorPayment) {
    const { data: invoiceRow } = await supabase
      .from('realtor_invoices')
      .select(INVOICE_COLS)
      .eq('id', (priorPayment as any).invoice_id)
      .maybeSingle();
    return {
      alreadyProcessed: true,
      payment: mapPayment(priorPayment),
      invoice: invoiceRow ? mapInvoice(invoiceRow) : { id: invoiceId, status: 'paid' } as any,
      escrowHeldKobo: (priorPayment as any).escrow_held_kobo ?? 0,
    };
  }

  // Load + authorize the invoice via its lease (mirrors the RPC's own
  // auth.uid() === tenant_id ownership check).
  const { data: invoice, error: invErr } = await supabase
    .from('realtor_invoices')
    .select(INVOICE_COLS)
    .eq('id', invoiceId)
    .maybeSingle();
  if (invErr) throw new ApiError(`Failed to load invoice: ${invErr.message}`, 500);
  if (!invoice) throw new ApiError('Invoice not found', 404);

  const { data: lease, error: leaseErr } = await supabase
    .from('realtor_leases')
    .select('id, tenant_id, listing_id, status')
    .eq('id', (invoice as any).lease_id)
    .maybeSingle();
  if (leaseErr) throw new ApiError(`Failed to load lease: ${leaseErr.message}`, 500);
  if (!lease || (lease as any).tenant_id !== userId) throw new ApiError('Invoice not found', 404);

  if ((invoice as any).status === 'paid') throw new ApiError('Invoice is already paid', 409);

  const amountKobo: number = (invoice as any).total_kobo;
  if (!Number.isInteger(amountKobo) || amountKobo <= 0) throw new ApiError('Invoice amount is invalid', 422);

  if (channel !== 'WALLET') {
    // Out of scope for this fix — see docs/qa/modules/realtor.md. Disclosed as a
    // gap rather than faked.
    throw new ApiError('This payment method is not yet supported for realtor invoices.', 501);
  }

  // Money mutation: debit the tenant's wallet via the shared ledger primitive.
  // Fail-closed tier check + balanced double-entry posting happen inside.
  const debitResult = await debitWallet(userId, {
    amountKobo,
    reference: idempotencyKey,
    idempotencyKey,
    description: `Realtor lease invoice — ${(invoice as any).id}`,
    metadata: {
      kind: 'realtor_invoice',
      invoice_id: invoiceId,
      lease_id: (lease as any).id,
      listing_id: (lease as any).listing_id,
      payer_id: userId,
    },
  });

  // Only NOW — after a confirmed (new or already-processed) debit — finalize
  // via the hardened SQL RPC. Use the service-role client (SECURITY DEFINER
  // RPC is now GRANTed to service_role only) and pass p_user_id explicitly
  // since there is no auth.uid() session on this server-side call.
  const { data: rpcResult, error: rpcErr } = await supabase.rpc('realtor_pay_invoice', {
    p_invoice_id: invoiceId,
    p_channel: channel,
    p_idempotency_key: idempotencyKey,
    p_user_id: userId,
  });

  if (rpcErr) {
    // The wallet has already been debited (or was already debited on a prior
    // attempt) — a finalization failure here must be surfaced loudly for
    // reconciliation, never swallowed.
    throw new ApiError(
      `Wallet debited but realtor invoice finalization failed (reconcile invoice ${invoiceId}): ${rpcErr.message}`,
      500,
    );
  }

  const { data: paymentRow } = await supabase
    .from('realtor_payments')
    .select(PAYMENT_COLS)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  const { data: invoiceRow } = await supabase
    .from('realtor_invoices')
    .select(INVOICE_COLS)
    .eq('id', invoiceId)
    .maybeSingle();

  return {
    alreadyProcessed: debitResult.alreadyProcessed,
    payment: paymentRow ? mapPayment(paymentRow) : (rpcResult as any),
    invoice: invoiceRow ? mapInvoice(invoiceRow) : { id: invoiceId, status: 'paid' } as any,
    escrowHeldKobo: (rpcResult as any)?.escrow_held ?? (paymentRow ? (paymentRow as any).escrow_held_kobo : 0),
  };
}
