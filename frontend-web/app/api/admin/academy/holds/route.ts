// Admin: practical/safety/review holds. A hold blocks MASTERED independently of
// the quiz score, which is how practical failure gates progression (CASE 008).
import { errorResponse, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { asActorId, createAdminHold, listAdminHolds } from '@/src/server/services/academy/topics';
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
    const result = await listAdminHolds(supabase, {
      status: url.searchParams.get('status') ?? undefined,
      topicId: url.searchParams.get('topicId') ?? undefined,
      enrollmentId: url.searchParams.get('enrollmentId') ?? undefined,
      page,
      pageSize,
    });
    return successResponse({
      success: true,
      holds: result.rows,
      open: result.open,
      page,
      pageSize,
      total: result.total,
      hasMore: page * pageSize < result.total,
    });
  } catch (error) {
    return topicErrorResponse(error, 'Failed to load holds');
  }
}

export async function POST(request: Request) {
  try {
    if (!featureFlags.filmAcademyTopics()) {
      return errorResponse('Topic learning is not available yet', 503);
    }
    const admin = await assertAdminPermission(request, 'scores:manage');
    const body = (await request.json().catch(() => null)) as
      | { enrollmentId?: string; topicId?: string; holdType?: string; reason?: string }
      | null;
    const enrollmentId = String(body?.enrollmentId ?? '').trim();
    const topicId = String(body?.topicId ?? '').trim();
    const holdType = String(body?.holdType ?? '').trim();
    const reason = String(body?.reason ?? '').trim();
    if (!enrollmentId || !topicId || !holdType || !reason) {
      return errorResponse('enrollmentId, topicId, holdType and reason are required', 400);
    }

    const supabase = createAdminClient();
    const result = await createAdminHold(supabase, asActorId(admin.actorId), {
      enrollmentId,
      topicId,
      holdType,
      reason,
    });
    return successResponse({ success: true, result });
  } catch (error) {
    return topicErrorResponse(error, 'Failed to create the hold');
  }
}
