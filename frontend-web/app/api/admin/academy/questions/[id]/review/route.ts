// Admin: record an SME review decision on one film question. This is the ONLY path
// that makes a question exam-eligible (approve) — importing can never do so.
// Separation of duties is enforced by permission: import/edit holds programs:manage,
// approve/suspend holds scores:manage, so the reviewer is a different capability
// from the author. Writes the immutable academy_question_reviews audit row.
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { reviewQuestion, type ReviewDecision } from '@/src/server/services/academy/assessment';

const PERMISSION = 'scores:manage';
const DECISIONS: ReviewDecision[] = ['approve', 'reject', 'suspend', 'reactivate'];

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    if (!featureFlags.filmAcademyAssessment()) {
      return errorResponse('Assessments are not available yet', 503);
    }
    const identity = await assertAdminPermission(request, PERMISSION);
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as { decision?: string; note?: string } | null;
    const decision = String(body?.decision ?? '') as ReviewDecision;
    if (!DECISIONS.includes(decision)) {
      return errorResponse('decision must be approve, reject, suspend or reactivate', 400);
    }

    const supabase = createAdminClient();
    const result = await reviewQuestion(supabase, id, reviewerOrNull(identity.actorId), decision, String(body?.note ?? '').trim());
    if (!result.ok) return errorResponse(result.error ?? 'Failed to record the decision', 400);
    return successResponse({ success: true, status: result.status });
  } catch (error) {
    return handleApiError(error, 'Failed to review the question');
  }
}

// reviewer_id is a nullable FK to auth.users; the api-key path yields 'api-key',
// which is not a uuid, so it stores null and the audit row still captures the
// decision + transition (the permission check already gated who could act).
function reviewerOrNull(v: string | null | undefined): string | null {
  return v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null;
}
