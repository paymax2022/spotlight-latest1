// Admin: topic authoring overview. Every row carries the evaluated publication
// gate, so the console never shows a Publish button the server would refuse.
import { errorResponse, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { listAdminTopics } from '@/src/server/services/academy/topics';
import { paging, topicErrorResponse } from '@/src/server/services/academy/topics/http';

export async function GET(request: Request) {
  try {
    if (!featureFlags.filmAcademyTopics()) {
      return errorResponse('Topic learning is not available yet', 503);
    }
    await assertAdminPermission(request, 'programs:manage');
    const url = new URL(request.url);
    const { page, pageSize } = paging(url);
    const publishedParam = url.searchParams.get('published');
    const readyParam = url.searchParams.get('ready');
    const supabase = createAdminClient();

    const result = await listAdminTopics(supabase, {
      courseId: url.searchParams.get('courseId') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
      published:
        publishedParam === 'true' ? true : publishedParam === 'false' ? false : undefined,
      ready: readyParam === 'true' ? true : readyParam === 'false' ? false : undefined,
      q: url.searchParams.get('q') ?? undefined,
      page,
      pageSize,
    });

    return successResponse({
      success: true,
      topics: result.rows,
      summary: result.summary,
      page,
      pageSize,
      total: result.total,
      hasMore: page * pageSize < result.total,
    });
  } catch (error) {
    return topicErrorResponse(error, 'Failed to load topics');
  }
}
