/**
 * Estate Dues / Payments money-path (Block 29).
 *
 * Iron rules honoured:
 *  - amounts are BIGINT kobo throughout (never floats)
 *  - paying an invoice REQUIRES an Idempotency-Key (passed through to the
 *    wallet ledger) — re-submitting the same key is a no-op
 *  - the money mutation is a balanced double-entry posting performed by the
 *    shared `debitWallet` primitive (atomic `debit_wallet_atomic` RPC) — we
 *    never UPDATE a balance column directly
 *  - tier daily-limit checks run fail-closed inside `debitWallet`
 *    (`enforceWalletLimit` throws 403 for Tier 0 / exceeded caps)
 *  - an immutable audit trail is produced by (a) the ledger entry's metadata
 *    and (b) the `estate_payments` row; the invoice is then marked paid
 */
import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';
import { debitWallet } from '@/src/server/wallet/service';
import { getResidentContext } from '@/src/server/estate/resident';

const INVOICE_COLS = 'id, estate_id, resident_id, category, amount_kobo, due_date, status, created_at';

export function mapInvoice(row: any) {
  return {
    id: row.id, estateId: row.estate_id, residentId: row.resident_id, category: row.category,
    amountKobo: row.amount_kobo, dueDate: row.due_date, status: row.status, createdAt: row.created_at,
  };
}
export function mapPayment(row: any) {
  return {
    id: row.id, estateId: row.estate_id, invoiceId: row.invoice_id ?? undefined, payerId: row.payer_id,
    amountKobo: row.amount_kobo, method: row.method, status: row.status, reference: row.reference ?? undefined, createdAt: row.created_at,
  };
}

export async function listInvoices(userId: string) {
  const supabase = createAdminClient();
  const ctx = await getResidentContext(supabase, userId);
  if (!ctx) return [];
  const { data: rows, error } = await supabase
    .from('estate_dues_invoices')
    .select(INVOICE_COLS)
    .eq('estate_id', ctx.estateId)
    .eq('resident_id', userId)
    .order('due_date', { ascending: true });
  if (error) throw new ApiError(`Failed to list invoices: ${error.message}`, 500);
  // Surface overdue state without mutating the row (read-time projection).
  const now = Date.now();
  return (rows ?? []).map((r: any) => {
    const mapped = mapInvoice(r);
    if (mapped.status === 'pending' && +new Date(mapped.dueDate) < now) mapped.status = 'overdue';
    return mapped;
  });
}

export interface PayInvoiceInput {
  userId: string;
  invoiceId: string;
  idempotencyKey: string;
}

export async function payInvoice(input: PayInvoiceInput) {
  const { userId, invoiceId, idempotencyKey } = input;
  if (!idempotencyKey) throw new ApiError('Idempotency-Key header is required for dues payments.', 400);

  const supabase = createAdminClient();
  const ctx = await getResidentContext(supabase, userId);
  if (!ctx) throw new ApiError('Not a resident of any estate', 403);

  // Load + authorize the invoice.
  const { data: invoice, error: invErr } = await supabase
    .from('estate_dues_invoices')
    .select(INVOICE_COLS)
    .eq('id', invoiceId)
    .maybeSingle();
  if (invErr) throw new ApiError(`Failed to load invoice: ${invErr.message}`, 500);
  if (!invoice || (invoice as any).estate_id !== ctx.estateId || (invoice as any).resident_id !== userId) {
    throw new ApiError('Invoice not found', 404);
  }

  const amountKobo: number = (invoice as any).amount_kobo;
  if (!Number.isInteger(amountKobo) || amountKobo <= 0) throw new ApiError('Invoice amount is invalid', 422);

  // Idempotent fast-path: if this key already produced a payment, return it.
  const { data: priorPayment } = await supabase
    .from('estate_payments')
    .select('id, estate_id, invoice_id, payer_id, amount_kobo, method, status, reference, created_at')
    .eq('reference', idempotencyKey)
    .maybeSingle();
  if (priorPayment) {
    return { alreadyProcessed: true, payment: mapPayment(priorPayment), invoice: { ...mapInvoice(invoice), status: 'paid' } };
  }

  if ((invoice as any).status === 'paid') throw new ApiError('Invoice is already paid', 409);
  if ((invoice as any).status === 'waived') throw new ApiError('Invoice has been waived', 409);

  // Money mutation: debit the resident's wallet via the shared ledger primitive.
  // This enforces tier limits fail-closed and posts an immutable ledger entry.
  // The ledger's own UNIQUE(idempotency_key) guarantees no double-debit on retry.
  const result = await debitWallet(userId, {
    amountKobo,
    reference: idempotencyKey,
    idempotencyKey,
    description: `Estate dues — ${(invoice as any).category}`,
    metadata: {
      kind: 'estate_dues',
      estate_id: ctx.estateId,
      invoice_id: invoiceId,
      category: (invoice as any).category,
      payer_id: userId,
    },
  });

  // If the wallet was already debited under this key on a prior attempt, the
  // payment row may already exist — return it instead of inserting a duplicate.
  if (result.alreadyProcessed) {
    const { data: prior } = await supabase
      .from('estate_payments')
      .select('id, estate_id, invoice_id, payer_id, amount_kobo, method, status, reference, created_at')
      .eq('reference', idempotencyKey)
      .maybeSingle();
    if (prior) {
      await ensureInvoicePaid(supabase, invoiceId);
      return { alreadyProcessed: true, payment: mapPayment(prior), invoice: { ...mapInvoice(invoice), status: 'paid' } };
    }
    // else: debit committed but payment-record write was lost previously — fall
    // through and (re)create it idempotently below to reconcile.
  }

  // Record the domain payment (audit trail). Idempotent upsert on the unique
  // `reference` index means a concurrent/retry insert collapses to one row.
  const { data: payment, error: payErr } = await supabase
    .from('estate_payments')
    .upsert({
      estate_id: ctx.estateId,
      invoice_id: invoiceId,
      payer_id: userId,
      amount_kobo: amountKobo,
      method: 'wallet',
      status: 'successful',
      reference: idempotencyKey,
    }, { onConflict: 'reference' })
    .select('id, estate_id, invoice_id, payer_id, amount_kobo, method, status, reference, created_at')
    .single();
  if (payErr) {
    // Ledger already posted; surface a clear error so the payment can be reconciled.
    throw new ApiError(`Wallet debited but payment record failed: ${payErr.message}`, 500);
  }

  await ensureInvoicePaid(supabase, invoiceId);

  return {
    alreadyProcessed: result.alreadyProcessed,
    payment: mapPayment(payment),
    invoice: { ...mapInvoice(invoice), status: 'paid' },
  };
}

/** Mark the invoice paid; surface a clear error if the write fails (no fire-and-forget). */
async function ensureInvoicePaid(supabase: ReturnType<typeof createAdminClient>, invoiceId: string) {
  const { error } = await supabase.from('estate_dues_invoices').update({ status: 'paid' }).eq('id', invoiceId);
  if (error) {
    throw new ApiError(`Payment recorded but invoice status update failed (reconcile invoice ${invoiceId}): ${error.message}`, 500);
  }
}
