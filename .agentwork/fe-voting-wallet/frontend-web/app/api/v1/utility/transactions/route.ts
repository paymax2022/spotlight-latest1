import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { listUserUtilityTransactions } from '@/src/server/utility/service';
import { pagination, requireUtilityUser, utilityUnavailableResponse } from '../_utils';

export async function GET(request: Request) {
  const unavailable = utilityUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    const user = await requireUtilityUser(request);
    const meta = pagination(request);
    const transactions = await listUserUtilityTransactions(user.id, meta);
    return NextResponse.json({ success: true, transactions, meta: { ...meta, count: transactions.length } });
  } catch (err) {
    return handleApiError(err);
  }
}
