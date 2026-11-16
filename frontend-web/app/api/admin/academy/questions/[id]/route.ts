// Admin: one film question with its full review history — the review drawer's data.
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { getQuestion, reviewHistory } from '@/src/server/services/academy/assessment';

const PERMISSION = 'programs:manage';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    if (!featureFlags.filmAcademyAssessment()) {
      return errorResponse('Assessments are not available yet', 503);
    }
    await assertAdminPermission(request, PERMISSION);
    const { id } = await ctx.params;
    const supabase = createAdminClient();
    const question = await getQuestion(supabase, id);
    if (!question) return errorResponse('Question not found', 404);
    const reviews = await reviewHistory(supabase, id);
    return successResponse({ success: true, question, reviews });
  } catch (error) {
    return handleApiError(error, 'Failed to load the question');
  }
}
