import { NextResponse } from 'next/server';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { payInvoice } from '@/src/server/estate/dues';

// POST /api/v1/estate/dues/[id]/pay — pay a dues invoice from the wallet.
// Money mutation: requires an Idempotency-Key; posts a balanced ledger debit
// (tier-checked, atomic) and records an estate_payments audit row.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const idempotencyKey = request.headers.get('Idempotency-Key');
  if (!idempotencyKey) return errorResponse('Idempotency-Key header is required for dues payments.', 400);
  try {
    const user = await requireRequestUser(request);
    const result = await payInvoice({ userId: user.id, invoiceId: params.id, idempotencyKey });
    return NextResponse.json(
      { success: true, already_processed: result.alreadyProcessed, payment: result.payment, invoice: result.invoice },
      { status: result.alreadyProcessed ? 200 : 201 },
    );
  } catch (error) { return handleApiError(error, 'Failed to pay dues'); }
}
