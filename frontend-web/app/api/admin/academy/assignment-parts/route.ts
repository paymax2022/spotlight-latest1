// Admin: define and grade the PARTS of an assignment — the week 1-4 timeline.
//
// A part is one week's deliverable inside a larger brief. Creating parts is what
// turns a single-shot assignment into a staged one; an assignment with no parts
// keeps its original whole-submission behaviour, so this is purely additive to
// the existing flow.
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';

const PART_COLS = 'id, assignment_id, part_number, week_number, title, description, due_date, max_score, is_required, created_at';

/** GET /assignment-parts?assignmentId=… — the parts of one assignment, in order. */
export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, 'applications:review');
    const assignmentId = new URL(request.url).searchParams.get('assignmentId');
    if (!assignmentId) return errorResponse('assignmentId is required', 400);

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('academy_assignment_parts')
      .select(PART_COLS)
      .eq('assignment_id', assignmentId)
      .order('part_number', { ascending: true });

    if (error) {
      console.error('[admin/academy/assignment-parts] list failed', error);
      return errorResponse(error.message, 500);
    }
    return successResponse({ success: true, parts: data ?? [] });
  } catch (error) {
    return handleApiError(error, 'Failed to load assignment parts');
  }
}

/** POST — create a part. */
export async function POST(request: Request) {
  try {
    await assertAdminPermission(request, 'applications:review');
    const body = (await request.json()) as Record<string, unknown>;

    const assignmentId = String(body.assignment_id ?? '').trim();
    const title = String(body.title ?? '').trim();
    if (!assignmentId) return errorResponse('assignment_id is required', 400);
    if (!title) return errorResponse('A part title is required', 400);

    const weekNumber = Number(body.week_number ?? 0);
    if (!Number.isInteger(weekNumber) || weekNumber < 1) {
      return errorResponse('Week must be a whole number of 1 or more', 400);
    }

    const maxScore = body.max_score === null || body.max_score === undefined || body.max_score === ''
      ? null
      : Number(body.max_score);
    if (maxScore !== null && (!Number.isFinite(maxScore) || maxScore <= 0)) {
      return errorResponse('Maximum score must be greater than zero, or left blank', 400);
    }

    const supabase = createAdminClient();

    // The parent must exist: a part hanging off a missing assignment would never
    // reach a learner, and the FK error alone would not say why.
    const { data: parent } = await supabase
      .from('academy_assignments')
      .select('id')
      .eq('id', assignmentId)
      .maybeSingle();
    if (!parent) return errorResponse('Assignment not found', 404);

    // Default the part number to the next free slot rather than asking the
    // caller to know it — two admins adding a part at once would otherwise
    // collide on the (assignment_id, part_number) unique index.
    let partNumber = Number(body.part_number ?? 0);
    if (!Number.isInteger(partNumber) || partNumber < 1) {
      const { data: last } = await supabase
        .from('academy_assignment_parts')
        .select('part_number')
        .eq('assignment_id', assignmentId)
        .order('part_number', { ascending: false })
        .limit(1)
        .maybeSingle();
      partNumber = Number((last as { part_number?: number } | null)?.part_number ?? 0) + 1;
    }

    const { data, error } = await supabase
      .from('academy_assignment_parts')
      .insert({
        assignment_id: assignmentId,
        part_number: partNumber,
        week_number: weekNumber,
        title,
        description: String(body.description ?? ''),
        due_date: body.due_date ? String(body.due_date) : null,
        max_score: maxScore,
        is_required: body.is_required === undefined ? true : !!body.is_required,
      })
      .select(PART_COLS)
      .single();

    if (error) {
      // 23505 is the (assignment_id, part_number) unique index.
      if ((error as { code?: string }).code === '23505') {
        return errorResponse(`Part ${partNumber} already exists on this assignment`, 409);
      }
      console.error('[admin/academy/assignment-parts] create failed', error);
      return errorResponse(error.message, 500);
    }
    return successResponse({ success: true, part: data }, 201);
  } catch (error) {
    return handleApiError(error, 'Failed to create assignment part');
  }
}

/** PATCH — edit a part, or grade one learner's submission of it. */
export async function PATCH(request: Request) {
  try {
    const identity = await assertAdminPermission(request, 'applications:review');
    const body = (await request.json()) as Record<string, unknown>;
    const supabase = createAdminClient();

    // ── Grading a part submission ───────────────────────────────────────────
    if (body.partSubmissionId) {
      const id = String(body.partSubmissionId);
      const { data: sub } = await supabase
        .from('academy_assignment_part_submissions')
        .select('id, part_id, academy_assignment_parts(max_score)')
        .eq('id', id)
        .maybeSingle();
      if (!sub) return errorResponse('Part submission not found', 404);

      if (body.score === undefined || body.score === null) {
        return errorResponse('score is required', 400);
      }
      // A part whose max_score is null is progress-only; 100 is the implied
      // ceiling so a typo of 500 is still caught rather than stored.
      const maxScore = Number(
        (sub as { academy_assignment_parts?: { max_score?: number | null } }).academy_assignment_parts?.max_score ?? 100,
      );
      const score = Number(body.score);
      if (!Number.isFinite(score) || score < 0 || score > maxScore) {
        return errorResponse(`Score must be between 0 and ${maxScore}`, 400);
      }

      const { error } = await supabase
        .from('academy_assignment_part_submissions')
        .update({
          score,
          grade: (body.grade as string) ?? null,
          feedback: (body.feedback as string) ?? null,
          reviewed_by: identity.actorId,
          reviewed_at: new Date().toISOString(),
          status: 'graded',
        })
        .eq('id', id);

      if (error) {
        console.error('[admin/academy/assignment-parts] grade failed', error);
        return errorResponse(error.message, 500);
      }
      return successResponse({ success: true, partSubmissionId: id, score });
    }

    // ── Editing the part itself ─────────────────────────────────────────────
    if (!body.id) return errorResponse('id or partSubmissionId is required', 400);

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.title !== undefined) {
      const t = String(body.title).trim();
      if (!t) return errorResponse('A part title is required', 400);
      patch.title = t;
    }
    if (body.description !== undefined) patch.description = String(body.description);
    if (body.due_date !== undefined) patch.due_date = body.due_date ? String(body.due_date) : null;
    if (body.is_required !== undefined) patch.is_required = !!body.is_required;
    if (body.week_number !== undefined) {
      const w = Number(body.week_number);
      if (!Number.isInteger(w) || w < 1) return errorResponse('Week must be a whole number of 1 or more', 400);
      patch.week_number = w;
    }
    if (body.max_score !== undefined) {
      const m = body.max_score === null || body.max_score === '' ? null : Number(body.max_score);
      if (m !== null && (!Number.isFinite(m) || m <= 0)) {
        return errorResponse('Maximum score must be greater than zero, or left blank', 400);
      }
      patch.max_score = m;
    }

    const { data, error } = await supabase
      .from('academy_assignment_parts')
      .update(patch)
      .eq('id', String(body.id))
      .select(PART_COLS)
      .single();

    if (error) {
      console.error('[admin/academy/assignment-parts] update failed', error);
      return errorResponse(error.message, 500);
    }
    return successResponse({ success: true, part: data });
  } catch (error) {
    return handleApiError(error, 'Failed to update assignment part');
  }
}

/** DELETE /assignment-parts?id=… — remove a part and any submissions of it. */
export async function DELETE(request: Request) {
  try {
    await assertAdminPermission(request, 'applications:review');
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return errorResponse('id is required', 400);

    const supabase = createAdminClient();

    // Deleting cascades to learners' submissions for this part — say so rather
    // than discovering it after the fact.
    const { count } = await supabase
      .from('academy_assignment_part_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('part_id', id);

    const { error } = await supabase.from('academy_assignment_parts').delete().eq('id', id);
    if (error) {
      console.error('[admin/academy/assignment-parts] delete failed', error);
      return errorResponse(error.message, 500);
    }
    return successResponse({ success: true, deletedSubmissions: count ?? 0 });
  } catch (error) {
    return handleApiError(error, 'Failed to delete assignment part');
  }
}
