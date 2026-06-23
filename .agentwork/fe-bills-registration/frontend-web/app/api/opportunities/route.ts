import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { listOpenOpportunities } from '@/src/server/user/hub';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = String(searchParams.get('query') || '').toLowerCase();
    const category = String(searchParams.get('category') || '').toLowerCase();
    const freeOnly = searchParams.get('free') === '1';
    const opportunities = (await listOpenOpportunities()).filter((item) => {
      if (query && !`${item.title} ${item.programType} ${item.location || ''}`.toLowerCase().includes(query)) return false;
      if (category && !item.programType.toLowerCase().includes(category)) return false;
      if (freeOnly && Number(item.applicationFee || 0) > 0) return false;
      return true;
    });
    return successResponse({ success: true, opportunities });
  } catch (error) {
    return handleApiError(error, 'Failed to load opportunities');
  }
}
