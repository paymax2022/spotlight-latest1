// Learner: submit (or resubmit) ONE PART of a multi-part assignment.
//
// Deliberately a separate route from ../submit rather than an extra optional
// field on it. The two have different objects (an assignment vs a part), a
// different uniqueness key, and a different "already graded" rule — folding them
// together would mean one handler where half the branches are dead on any given
// call, and where a missing partId silently falls back to overwriting the
// whole-assignment submission. That fallback is exactly how a learner's week 1
// work would get replaced by their week 2 upload.
//
// Every guard here mirrors ../submit, because they protect the same things:
//   • the part must belong to THIS learner's curriculum (never trust the id);
//   • the parent assignment must still be open;
//   • a graded part is final — resubmitting would erase the tutor's score.
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveLearner } from '@/src/server/services/academy/learner';

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const body = (await request.json()) as {
      partId?: string;
      submissionLink?: string;
      submissionText?: string;
    };

    if (!body.partId) return errorResponse('partId is required', 400);

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

    // Resolve the part together with its parent, so ownership and openness are
    // both decided from the server's own rows rather than anything sent here.
    const { data: partRow } = await supabase
      .from('academy_assignment_parts')
      .select('id, part_number, week_number, assignment_id, academy_assignments(id, status, program_id, batch_id)')
      .eq('id', body.partId)
      .maybeSingle();

    const part = partRow as
      | {
          id: string;
          part_number: number;
          assignment_id: string;
          academy_assignments: { id: string; status: string | null; program_id: string | null; batch_id: string | null } | null;
        }
      | null;

    const parent = part?.academy_assignments ?? null;
    const mine =
      !!parent &&
      ((parent.program_id && parent.program_id === learner.programId) ||
        (parent.batch_id && parent.batch_id === learner.batchId));

    if (!mine) return errorResponse('Assignment not found in your curriculum', 404);
    if (parent!.status === 'draft' || parent!.status === 'closed') {
      return errorResponse('This assignment is not open for submissions', 409);
    }

    const { data: existing } = await supabase
      .from('academy_assignment_part_submissions')
      .select('id, status')
      .eq('part_id', body.partId)
      .eq('enrollment_id', learner.enrollmentId)
      .maybeSingle();

    if (existing && (existing as { status: string | null }).status === 'graded') {
      return errorResponse('This part has already been graded and cannot be resubmitted', 409);
    }

    const { error } = await supabase
      .from('academy_assignment_part_submissions')
      .upsert(
        {
          part_id: body.partId,
          enrollment_id: learner.enrollmentId,
          submission_link: link || null,
          submission_text: text || null,
          submitted_at: new Date().toISOString(),
          status: 'submitted',
        },
        { onConflict: 'part_id,enrollment_id' },
      );

    if (error) {
      console.error('[academy/assignments/parts/submit] upsert failed', error);
      return errorResponse('Could not save your submission', 500);
    }

    return successResponse({ success: true, partId: body.partId, assignmentId: part!.assignment_id });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to submit this part');
  }
}
