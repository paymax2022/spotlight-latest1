// Admin: the practical review queue. Submitted work is oldest-first so nothing
// waits indefinitely; graded history is newest-first for audit reading.
import { errorResponse, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { listPracticalQueue } from '@/src/server/services/academy/topics';
import { paging, topicErrorResponse } from '@/src/server/services/academy/topics/http';

export async function GET(request: Request) {
  try {
    if (!featureFlags.filmAcademyTopics()) {
      return errorResponse('Topic learning is not available yet', 503);
    }
    await assertAdminPermission(request, 'scores:manage');
    const url = new URL(request.url);
    const { page, pageSize } = paging(url);
    const supabase = createAdminClient();
    const result = await listPracticalQueue(supabase, {
      status: url.searchParams.get('status') ?? undefined,
      topicId: url.searchParams.get('topicId') ?? undefined,
      page,
      pageSize,
    });
    return successResponse({
      success: true,
      submissions: result.rows,
      pending: result.pending,
      page,
      pageSize,
      total: result.total,
      hasMore: page * pageSize < result.total,
    });
  } catch (error) {
    return topicErrorResponse(error, 'Failed to load the practical review queue');
  }
}
