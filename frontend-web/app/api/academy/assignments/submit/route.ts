// Learner: submit (or resubmit) an assignment.
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveLearner } from '@/src/server/services/academy/learner';

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const body = (await request.json()) as {
      assignmentId?: string;
      submissionLink?: string;
      submissionText?: string;
    };

    if (!body.assignmentId) return errorResponse('assignmentId is required', 400);

    const link = (body.submissionLink ?? '').trim();
    const text = (body.submissionText ?? '').trim();
    if (!link && !text) {
      return errorResponse('Add a link or write your submission before sending it', 400);
    }
    if (link && !/^https?:\/\//i.test(link)) {
      return errorResponse('A submission link must start with http:// or https://', 400);
    }

    const supabase = createAdminClient();
    const learner = await resolveLearner(supabase, user.id);
    if (!learner.ok) return errorResponse('You are not enrolled yet', 403);

    // The assignment must be one of this learner's own, and open.
    const { data: assignment } = await supabase
      .from('academy_assignments')
      .select('id, status, program_id, batch_id')
      .eq('id', body.assignmentId)
      .maybeSingle();

    const a = assignment as
      | { id: string; status: string | null; program_id: string | null; batch_id: string | null }
      | null;

    const mine =
      !!a &&
      ((a.program_id && a.program_id === learner.programId) ||
        (a.batch_id && a.batch_id === learner.batchId));

    if (!mine) return errorResponse('Assignment not found in your curriculum', 404);
    if (a!.status === 'draft' || a!.status === 'closed') {
      return errorResponse('This assignment is not open for submissions', 409);
    }

    // A graded submission is final — silently overwriting it would erase the
    // tutor's score and feedback.
    const { data: existing } = await supabase
      .from('academy_assignment_submissions')
      .select('id, status, score')
      .eq('assignment_id', body.assignmentId)
      .eq('enrollment_id', learner.enrollmentId)
      .maybeSingle();

    if (existing && (existing as { status: string | null }).status === 'graded') {
      return errorResponse('This assignment has already been graded and cannot be resubmitted', 409);
    }

    const { error } = await supabase
      .from('academy_assignment_submissions')
      .upsert(
        {
          assignment_id: body.assignmentId,
          enrollment_id: learner.enrollmentId,
          submission_link: link || null,
          submission_text: text || null,
          submitted_at: new Date().toISOString(),
          status: 'submitted',
        },
        { onConflict: 'assignment_id,enrollment_id' },
      );

    if (error) {
      console.error('[academy/assignments/submit] upsert failed', error);
      return errorResponse('Could not save your submission', 500);
    }

    return successResponse({ success: true, assignmentId: body.assignmentId });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to submit assignment');
  }
}
