// Learner: my assignments, and my submission + grade for each.
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveLearner } from '@/src/server/services/academy/learner';

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();

    const learner = await resolveLearner(supabase, user.id);
    if (!learner.ok) {
      return successResponse({ success: true, locked: true, reason: learner.reason, assignments: [] });
    }

    // An assignment reaches a learner through their programme or their batch.
    // Both are matched: a batch-wide brief carries no program_id, and a programme
    // assignment may carry no batch_id.
    const filters: string[] = [];
    if (learner.programId) filters.push(`program_id.eq.${learner.programId}`);
    if (learner.batchId) filters.push(`batch_id.eq.${learner.batchId}`);
    if (filters.length === 0) {
      return successResponse({ success: true, locked: false, assignments: [] });
    }

    const [assignRes, subRes] = await Promise.all([
      supabase
        .from('academy_assignments')
        .select('id, title, description, due_date, submission_format, max_score, rubric, status, module_id')
        .or(filters.join(','))
        .neq('status', 'draft')
        .order('due_date', { ascending: true }),
      supabase
        .from('academy_assignment_submissions')
        .select('id, assignment_id, submission_link, submission_text, submitted_at, score, grade, feedback, reviewed_at, status')
        .eq('enrollment_id', learner.enrollmentId),
    ]);

    if (assignRes.error) {
      console.error('[academy/assignments] list failed', assignRes.error);
      return errorResponse('Failed to load your assignments', 500);
    }
    if (subRes.error) {
      console.error('[academy/assignments] submissions failed', subRes.error);
      return errorResponse('Failed to load your submissions', 500);
    }

    const mine = new Map(
      (subRes.data ?? []).map((s) => [(s as { assignment_id: string }).assignment_id, s]),
    );

    const assignments = (assignRes.data ?? []).map((a) => {
      const row = a as Record<string, unknown>;
      return { ...row, submission: mine.get(row.id as string) ?? null };
    });

    return successResponse({
      success: true,
      locked: false,
      enrollmentId: learner.enrollmentId,
      assignments,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to load assignments');
  }
}
