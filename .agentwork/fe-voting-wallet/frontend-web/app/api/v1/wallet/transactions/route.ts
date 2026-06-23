import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { requireKycTier } from '@/src/server/kyc/gate';
import { listTransactions } from '@/src/server/wallet/service';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  if (!featureFlags.wallet()) return errorResponse('Wallet feature is not available.', 503);

  try {
    const user = await requireRequestUser(request);
    await requireKycTier(user.id, 1);

    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 100);
    const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);

    const transactions = await listTransactions(user.id, { limit, offset });

    return NextResponse.json({
      success: true,
      transactions,
      meta: { limit, offset, count: transactions.length },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
