// Admin: edit an exam's definition. Editing never changes published state; use the
// publish route for that. Permission: programs:manage.
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { updateExam, type ExamInput } from '@/src/server/services/academy/assessment';

const PERMISSION = 'programs:manage';

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    if (!featureFlags.filmAcademyAssessment()) {
      return errorResponse('Assessments are not available yet', 503);
    }
    const identity = await assertAdminPermission(request, PERMISSION);
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as Partial<ExamInput> | null;
    if (!body) return errorResponse('Invalid JSON body', 400);

    const supabase = createAdminClient();
    const exam = await updateExam(supabase, id, body, uuidOrNull(identity.actorId));
    if (!exam) return errorResponse('Exam not found', 404);
    return successResponse({ success: true, exam });
  } catch (error) {
    return handleApiError(error, 'Failed to update the exam');
  }
}

function uuidOrNull(v: string | null | undefined): string | null {
  return v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null;
}
