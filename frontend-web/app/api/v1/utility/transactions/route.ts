import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { listUserUtilityTransactions } from '@/src/server/utility/service';
import { requireUtilityUser, utilityGoProxyEnabled, utilityUnavailableResponse } from '../_utils';

export async function GET(request: Request) {
  const unavailable = utilityUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    const user = await requireUtilityUser(request);
    const { searchParams } = new URL(request.url);

    if (utilityGoProxyEnabled()) {
      // Proxy to Go backend (query params forwarded automatically)
      const upstream = await proxyToGoBackend(request, '/api/finance/utilitybills/transactions');
      if (upstream.status >= 400) return upstream;
      const data = await upstream.json() as Record<string, unknown>;
      const transactions = Array.isArray(data.transactions) ? data.transactions : [];
      const limit = typeof data.limit === 'number' ? data.limit : 20;
      const offset = typeof data.offset === 'number' ? data.offset : 0;
      return NextResponse.json({
        success: true,
        transactions,
        meta: { limit, offset, count: transactions.length },
      });
    }

    const limit = Number(searchParams.get('limit') ?? 20);
    const offset = Number(searchParams.get('offset') ?? 0);
    const transactions = await listUserUtilityTransactions(user.id, { limit, offset });
    return NextResponse.json({
      success: true,
      transactions,
      meta: { limit, offset, count: transactions.length },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
