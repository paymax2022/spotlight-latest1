import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { adminListUtilityTransactions } from '@/src/server/utility/service';
import { adminPagination, requireUtilitySupport, utilityAdminUnavailableResponse } from '../_utils';

export async function GET(request: Request) {
  const unavailable = utilityAdminUnavailableResponse();
  if (unavailable) return unavailable;
  try {
    await requireUtilitySupport(request);
    const meta = adminPagination(request);
    const status = new URL(request.url).searchParams.get('status') || undefined;
    const transactions = await adminListUtilityTransactions({ ...meta, status });
    return NextResponse.json({ success: true, transactions, meta: { ...meta, count: transactions.length } });
  } catch (err) {
    return handleApiError(err);
  }
}
