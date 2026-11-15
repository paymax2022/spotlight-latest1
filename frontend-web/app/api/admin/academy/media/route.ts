// Admin: the teaching-media production queue. This is a workflow surface, not
// an asset store; a record existing is not evidence a file exists.
import { errorResponse, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { listAdminMedia } from '@/src/server/services/academy/topics';
import { paging, topicErrorResponse } from '@/src/server/services/academy/topics/http';

export async function GET(request: Request) {
  try {
    if (!featureFlags.filmAcademyTopics()) {
      return errorResponse('Topic learning is not available yet', 503);
    }
    await assertAdminPermission(request, 'programs:manage');
    const url = new URL(request.url);
    const { page, pageSize } = paging(url, 50);
    const supabase = createAdminClient();
    const result = await listAdminMedia(supabase, {
      courseId: url.searchParams.get('courseId') ?? undefined,
      topicId: url.searchParams.get('topicId') ?? undefined,
      productionState: url.searchParams.get('productionState') ?? undefined,
      rightsStatus: url.searchParams.get('rightsStatus') ?? undefined,
      accessibilityStatus: url.searchParams.get('accessibilityStatus') ?? undefined,
      q: url.searchParams.get('q') ?? undefined,
      page,
      pageSize,
    });
    return successResponse({
      success: true,
      media: result.rows,
      summary: result.summary,
      page,
      pageSize,
      total: result.total,
      hasMore: page * pageSize < result.total,
    });
  } catch (error) {
    return topicErrorResponse(error, 'Failed to load the media queue');
  }
}
