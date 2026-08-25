// Admin: review and grade learner submissions.
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';

const SELECT =
  'id, assignment_id, enrollment_id, submission_link, submission_text, submitted_at, score, grade, feedback, reviewed_at, status, ' +
  'academy_assignments(title, max_score, due_date), ' +
  'academy_enrollments(id, academy_applications(full_name, email))';

export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, 'applications:review');
    const url = new URL(request.url);
    const status = url.searchParams.get('status');

    const supabase = createAdminClient();
    let query = supabase.from('academy_assignment_submissions').select(SELECT);
    if (status) query = query.eq('status', status);

    const { data, error } = await query.order('submitted_at', { ascending: false }).limit(200);
    if (error) {
      console.error('[admin/academy/submissions] list failed', error);
      return errorResponse(error.message, 500);
    }

    return successResponse({ success: true, submissions: data ?? [] });
  } catch (error) {
    return handleApiError(error, 'Failed to load submissions');
  }
}

export async function PATCH(request: Request) {
  try {
    const identity = await assertAdminPermission(request, 'applications:review');
    const body = (await request.json()) as {
      submissionId?: string;
      score?: number;
      grade?: string;
      feedback?: string;
    };

    if (!body.submissionId) return errorResponse('submissionId is required', 400);
    if (body.score === undefined || body.score === null) {
      return errorResponse('score is required', 400);
    }

    const supabase = createAdminClient();

    const { data: submission } = await supabase
      .from('academy_assignment_submissions')
      .select('id, assignment_id, academy_assignments(max_score)')
      .eq('id', body.submissionId)
      .maybeSingle();

    if (!submission) return errorResponse('Submission not found', 404);

    // A score outside the rubric would corrupt any average computed from it, so it
    // is rejected rather than clamped — a tutor typing 95 into a /50 assignment has
    // made a mistake worth surfacing.
    const maxScore = Number(
      (submission as { academy_assignments?: { max_score?: number } }).academy_assignments
        ?.max_score ?? 100,
    );
    const score = Number(body.score);
    if (!Number.isFinite(score) || score < 0 || score > maxScore) {
      return errorResponse(`Score must be between 0 and ${maxScore}`, 400);
    }

    const { error } = await supabase
      .from('academy_assignment_submissions')
      .update({
        score,
        grade: body.grade ?? null,
        feedback: body.feedback ?? null,
        reviewed_by: identity.actorId,
        reviewed_at: new Date().toISOString(),
        status: 'graded',
      })
      .eq('id', body.submissionId);

    if (error) {
      console.error('[admin/academy/submissions] grade failed', error);
      return errorResponse(error.message, 500);
    }

    return successResponse({ success: true, submissionId: body.submissionId, score });
  } catch (error) {
    return handleApiError(error, 'Failed to grade submission');
  }
}
