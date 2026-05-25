import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { listContests } from '@/src/server/openmic/persistence';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const year = searchParams.get('year');
    const contests = await listContests({
      month: month ? Number(month) : undefined,
      year: year ? Number(year) : undefined,
    });
    return successResponse({ success: true, contests });
  } catch (error) {
    return handleApiError(error, 'Failed to list open mic contests');
  }
}

