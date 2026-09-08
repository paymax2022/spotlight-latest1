import { successResponse, handleApiError } from '@/src/lib/api/responses';
import { getUserUtilityTransaction } from '@/src/server/utility/service';
import { requireUtilityUser, utilityUnavailableResponse } from '../../../_utils';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const unavailable = utilityUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    const user = await requireUtilityUser(request);
    const transaction = await getUserUtilityTransaction(user.id, params.id);
    return successResponse({
      success: true,
      receipt: {
        receipt_number: transaction.receipt_number,
        transaction_id: transaction.id,
        category: transaction.category,
        customer_reference: transaction.customer_reference,
        customer_name: transaction.customer_name,
        amount_kobo: transaction.amount_kobo,
        convenience_fee_kobo: transaction.convenience_fee_kobo,
        retail_amount_kobo: transaction.retail_amount_kobo,
        status: transaction.status,
        token: transaction.token,
        created_at: transaction.created_at,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
