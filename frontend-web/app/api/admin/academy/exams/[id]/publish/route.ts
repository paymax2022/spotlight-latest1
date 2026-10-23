// Admin: publish / unpublish an exam. Publishing runs the pool preflight — the exam
// only goes live when its draw scope has at least draw_count APPROVED questions, so
// a DRAFT-heavy bank can never be reached by a learner. Permission: scores:manage
// (release authority, distinct from authoring's programs:manage).
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { publishExam, unpublishExam } from '@/src/server/services/academy/assessment';

const PERMISSION = 'scores:manage';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    if (!featureFlags.filmAcademyAssessment()) {
      return errorResponse('Assessments are not available yet', 503);
    }
    await assertAdminPermission(request, PERMISSION);
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as { action?: string } | null;
    const action = String(body?.action ?? 'publish');

    const supabase = createAdminClient();
    if (action === 'unpublish') {
      const ok = await unpublishExam(supabase, id);
      return ok ? successResponse({ success: true, published: false })
        : errorResponse('Could not unpublish the exam', 500);
    }

    const result = await publishExam(supabase, id);
    if (!result.published) {
      // 409 with the exact shortfall is the actionable answer, not a silent 200.
      return errorResponse(result.reason ?? 'Cannot publish this exam yet', 409);
    }
    return successResponse({ success: true, published: true, pool: result });
  } catch (error) {
    return handleApiError(error, 'Failed to publish the exam');
  }
}
