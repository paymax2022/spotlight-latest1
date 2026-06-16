import { successResponse, handleApiError } from '@/src/lib/api/responses';
import { adminUtilityReport } from '@/src/server/utility/service';
import { toCsv } from '@/src/server/utility/export';
import { requireUtilitySupport, utilityAdminUnavailableResponse } from '../../_utils';

export async function GET(request: Request) {
  const unavailable = utilityAdminUnavailableResponse();
  if (unavailable) return unavailable;
  try {
    await requireUtilitySupport(request);
    const report = await adminUtilityReport('profitability');
    if (new URL(request.url).searchParams.get('format') === 'csv') {
      return new Response(toCsv([report as Record<string, unknown>]), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="utility-profitability.csv"',
        },
      });
    }
    return successResponse({ success: true, report });
  } catch (err) {
    return handleApiError(err);
  }
}
