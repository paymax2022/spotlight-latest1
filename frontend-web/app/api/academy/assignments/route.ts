// Learner: my assignments, and my submission + grade for each.
//
// Paginated, and parts-aware.
//
// PAGINATION: the screen used to render every assignment a learner had, in one
// response. A cohort's brief list grows all term, so the payload and the render
// grew with it; `page`/`pageSize` bound both. The parameters are optional and
// default to the first page, so an older client keeps working — it simply sees
// the first page instead of everything.
//
// PARTS: an assignment may be broken into parts, each scheduled in a programme
// week and submitted separately (migration 20270116000000). An assignment with
// NO parts is unchanged: one whole-assignment submission, as before. Both
// shapes ship in the same payload so the screen renders them uniformly.
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveLearner } from '@/src/server/services/academy/learner';

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

/** Clamp rather than reject: a silly page size is a client bug, not a reason to 400 a learner's work list. */
function readPaging(url: URL): { page: number; pageSize: number } {
  const rawPage = Number(url.searchParams.get('page') ?? '1');
  const rawSize = Number(url.searchParams.get('pageSize') ?? String(DEFAULT_PAGE_SIZE));
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const pageSize = Number.isFinite(rawSize) && rawSize >= 1
    ? Math.min(Math.floor(rawSize), MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
  return { page, pageSize };
}

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const { page, pageSize } = readPaging(new URL(request.url));

    const learner = await resolveLearner(supabase, user.id);
    if (!learner.ok) {
      return successResponse({
        success: true, locked: true, reason: learner.reason, assignments: [],
        page, pageSize, total: 0, hasMore: false,
      });
    }

    // An assignment reaches a learner through their programme or their batch.
    // Both are matched: a batch-wide brief carries no program_id, and a programme
    // assignment may carry no batch_id.
    const filters: string[] = [];
    if (learner.programId) filters.push(`program_id.eq.${learner.programId}`);
    if (learner.batchId) filters.push(`batch_id.eq.${learner.batchId}`);
    if (filters.length === 0) {
      return successResponse({
        success: true, locked: false, assignments: [],
        page, pageSize, total: 0, hasMore: false,
      });
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // Ordered by the timeline the admin set: week first, then deadline, then a
    // stable id tiebreaker. Without the tiebreaker two assignments sharing a week
    // and due_date could swap places between pages, so one would be shown twice
    // and another never — the classic unstable-pagination hole.
    //
    // NULLS FIRST on week_number is deliberate: an unscheduled brief (every
    // assignment that predates the timeline) must stay visible at the top rather
    // than being buried after the scheduled ones.
    const assignQuery = supabase
      .from('academy_assignments')
      .select(
        'id, title, description, due_date, submission_format, max_score, rubric, status, module_id, week_number',
        { count: 'exact' },
      )
      .or(filters.join(','))
      .neq('status', 'draft')
      .order('week_number', { ascending: true, nullsFirst: true })
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(from, to);

    const { data: assignRows, error: assignErr, count } = await assignQuery;
    if (assignErr) {
      console.error('[academy/assignments] list failed', assignErr);
      return errorResponse('Failed to load your assignments', 500);
    }

    const rows = assignRows ?? [];
    const assignmentIds = rows.map((a) => (a as { id: string }).id);

    // Submissions are fetched for THIS PAGE only. Fetching the learner's whole
    // history would undo the point of paginating.
    const [subRes, partRes] = await Promise.all([
      assignmentIds.length
        ? supabase
            .from('academy_assignment_submissions')
            .select('id, assignment_id, submission_link, submission_text, submitted_at, score, grade, feedback, reviewed_at, status')
            .eq('enrollment_id', learner.enrollmentId)
            .in('assignment_id', assignmentIds)
        : Promise.resolve({ data: [], error: null }),
      assignmentIds.length
        ? supabase
            .from('academy_assignment_parts')
            .select('id, assignment_id, part_number, week_number, title, description, due_date, max_score, is_required')
            .in('assignment_id', assignmentIds)
            .order('part_number', { ascending: true })
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (subRes.error) {
      console.error('[academy/assignments] submissions failed', subRes.error);
      return errorResponse('Failed to load your submissions', 500);
    }
    if (partRes.error) {
      console.error('[academy/assignments] parts failed', partRes.error);
      return errorResponse('Failed to load the assignment timeline', 500);
    }

    const partRows = (partRes.data ?? []) as Array<Record<string, unknown>>;
    const partIds = partRows.map((p) => p.id as string);

    const partSubRes = partIds.length
      ? await supabase
          .from('academy_assignment_part_submissions')
          .select('id, part_id, submission_link, submission_text, submitted_at, score, grade, feedback, reviewed_at, status')
          .eq('enrollment_id', learner.enrollmentId)
          .in('part_id', partIds)
      : { data: [], error: null };

    if (partSubRes.error) {
      console.error('[academy/assignments] part submissions failed', partSubRes.error);
      return errorResponse('Failed to load your submissions', 500);
    }

    const mine = new Map(
      (subRes.data ?? []).map((s) => [(s as { assignment_id: string }).assignment_id, s]),
    );
    const minePart = new Map(
      (partSubRes.data ?? []).map((s) => [(s as { part_id: string }).part_id, s]),
    );

    const partsByAssignment = new Map<string, Array<Record<string, unknown>>>();
    for (const p of partRows) {
      const key = p.assignment_id as string;
      const list = partsByAssignment.get(key) ?? [];
      list.push({ ...p, submission: minePart.get(p.id as string) ?? null });
      partsByAssignment.set(key, list);
    }

    const assignments = rows.map((a) => {
      const row = a as Record<string, unknown>;
      const parts = partsByAssignment.get(row.id as string) ?? [];
      const required = parts.filter((p) => p.is_required !== false);
      const done = required.filter((p) => p.submission != null).length;
      return {
        ...row,
        submission: mine.get(row.id as string) ?? null,
        parts,
        // Progress is computed HERE so the learner's screen and the admin console
        // cannot drift on what "complete" means.
        partsTotal: required.length,
        partsSubmitted: done,
        partsComplete: required.length > 0 && done === required.length,
      };
    });

    const total = count ?? assignments.length;
    return successResponse({
      success: true,
      locked: false,
      enrollmentId: learner.enrollmentId,
      assignments,
      page,
      pageSize,
      total,
      hasMore: from + assignments.length < total,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to load assignments');
  }
}
