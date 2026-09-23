import { NextResponse } from 'next/server';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { payInvoice } from '@/src/server/realtor/invoices';

// POST /api/v1/realtor/invoices/[id]/pay — pay a realtor lease invoice.
//
// This route (plus src/server/realtor/invoices.ts) is now the ONLY supported
// way to pay a realtor invoice — the Supabase RPC `realtor_pay_invoice` it
// calls internally is locked to service_role (see
// supabase/migrations/20270220000000_realtor_pay_invoice_require_verified_debit.sql),
// closing a Blocker-severity exploit where the mobile client called that RPC
// directly and got a free lease with no payment.
//
// Money mutation: requires an Idempotency-Key; posts a balanced ledger debit
// (tier-checked, atomic, fail-closed) via debitWallet BEFORE the invoice/
// lease/escrow rows are ever touched.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const idempotencyKey = request.headers.get('Idempotency-Key');
  if (!idempotencyKey) return errorResponse('Idempotency-Key header is required for realtor invoice payments.', 400);
  try {
    const user = await requireRequestUser(request);
    const body = await request.json().catch(() => ({}));
    const channel = body?.channel === 'PAYSTACK' ? 'PAYSTACK' : 'WALLET';
    const result = await payInvoice({ userId: user.id, invoiceId: params.id, channel, idempotencyKey });
    return NextResponse.json(
      {
        success: true,
        already_processed: result.alreadyProcessed,
        payment: result.payment,
        invoice: result.invoice,
        escrow_held_kobo: result.escrowHeldKobo,
      },
      { status: result.alreadyProcessed ? 200 : 201 },
    );
  } catch (error) { return handleApiError(error, 'Failed to pay realtor invoice'); }
}
