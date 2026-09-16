// Admin: assignment progress across a cohort — who has sent which part, and when.
//
// The console could already list SUBMISSIONS, but a submission list only shows
// what arrived. It cannot show what is MISSING, which is the whole question a
// tutor is asking in week 3: who has not sent part 2? This inverts it — every
// learner × every required part, present or not.
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';

type Row = Record<string, any>;

export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, 'applications:review');
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get('batchId');
    if (!batchId) return errorResponse('batchId is required', 400);

    const supabase = createAdminClient();

    // Learners of this batch: enrolments reached through their application.
    const { data: enrolRows, error: enrolErr } = await supabase
      .from('academy_enrollments')
      .select('id, program_id, application_id, academy_applications!inner(id, full_name, email, batch_id)')
      .eq('academy_applications.batch_id', batchId);

    if (enrolErr) {
      console.error('[admin/academy/progress] enrolments failed', enrolErr);
      return errorResponse(enrolErr.message, 500);
    }
    const enrolments = (enrolRows ?? []) as Row[];
    if (enrolments.length === 0) {
      return successResponse({ success: true, learners: [], assignments: [], totals: emptyTotals() });
    }

    const enrolmentIds = enrolments.map((e) => e.id as string);
    const programIds = [...new Set(enrolments.map((e) => e.program_id).filter(Boolean))] as string[];

    // Assignments reach a learner through their programme OR the batch, so both
    // are matched here exactly as the learner route does — otherwise the console
    // would show progress against a different set than the phone shows.
    const filters = [`batch_id.eq.${batchId}`];
    for (const pid of programIds) filters.push(`program_id.eq.${pid}`);

    const { data: assignRows, error: assignErr } = await supabase
      .from('academy_assignments')
      .select('id, title, week_number, due_date, max_score, status')
      .or(filters.join(','))
      .neq('status', 'draft')
      .order('week_number', { ascending: true, nullsFirst: true })
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true });

    if (assignErr) {
      console.error('[admin/academy/progress] assignments failed', assignErr);
      return errorResponse(assignErr.message, 500);
    }
    const assignments = (assignRows ?? []) as Row[];
    const assignmentIds = assignments.map((a) => a.id as string);

    if (assignmentIds.length === 0) {
      return successResponse({
        success: true,
        learners: enrolments.map((e) => baseLearner(e)),
        assignments: [],
        totals: emptyTotals(),
      });
    }

    const [partsRes, subsRes] = await Promise.all([
      supabase
        .from('academy_assignment_parts')
        .select('id, assignment_id, part_number, week_number, title, due_date, is_required')
        .in('assignment_id', assignmentIds)
        .order('part_number', { ascending: true }),
      supabase
        .from('academy_assignment_submissions')
        .select('id, assignment_id, enrollment_id, status, score, submitted_at')
        .in('assignment_id', assignmentIds)
        .in('enrollment_id', enrolmentIds),
    ]);

    if (partsRes.error) {
      console.error('[admin/academy/progress] parts failed', partsRes.error);
      return errorResponse(partsRes.error.message, 500);
    }
    if (subsRes.error) {
      console.error('[admin/academy/progress] submissions failed', subsRes.error);
      return errorResponse(subsRes.error.message, 500);
    }

    const parts = (partsRes.data ?? []) as Row[];
    const partIds = parts.map((p) => p.id as string);

    const partSubsRes = partIds.length
      ? await supabase
          .from('academy_assignment_part_submissions')
          .select('id, part_id, enrollment_id, status, score, submitted_at')
          .in('part_id', partIds)
          .in('enrollment_id', enrolmentIds)
      : { data: [], error: null };

    if (partSubsRes.error) {
      console.error('[admin/academy/progress] part submissions failed', partSubsRes.error);
      return errorResponse(partSubsRes.error.message, 500);
    }

    const partsByAssignment = new Map<string, Row[]>();
    for (const p of parts) {
      const list = partsByAssignment.get(p.assignment_id) ?? [];
      list.push(p);
      partsByAssignment.set(p.assignment_id, list);
    }

    // Keyed lookups so the per-learner loop stays linear rather than scanning.
    const subByKey = new Map<string, Row>();
    for (const s of (subsRes.data ?? []) as Row[]) subByKey.set(`${s.enrollment_id}:${s.assignment_id}`, s);
    const partSubByKey = new Map<string, Row>();
    for (const s of (partSubsRes.data ?? []) as Row[]) partSubByKey.set(`${s.enrollment_id}:${s.part_id}`, s);

    const now = Date.now();
    let totalExpected = 0, totalSubmitted = 0, totalGraded = 0, totalOverdue = 0;

    const learners = enrolments.map((e) => {
      const enrolmentId = e.id as string;
      const items = assignments.map((a) => {
        const aParts = (partsByAssignment.get(a.id as string) ?? []).filter((p) => p.is_required !== false);

        // A staged assignment is measured by its parts; a single-shot one by its
        // one submission. Counting both for a staged brief would double-count it.
        if (aParts.length > 0) {
          const partStates = aParts.map((p) => {
            const s = partSubByKey.get(`${enrolmentId}:${p.id}`) ?? null;
            const overdue = !s && !!p.due_date && new Date(p.due_date).getTime() < now;
            return {
              partId: p.id, partNumber: p.part_number, weekNumber: p.week_number,
              title: p.title, dueDate: p.due_date,
              submitted: !!s, graded: s?.status === 'graded',
              score: s?.score ?? null, submittedAt: s?.submitted_at ?? null,
              submissionId: s?.id ?? null, overdue,
            };
          });
          const submitted = partStates.filter((p) => p.submitted).length;
          const graded = partStates.filter((p) => p.graded).length;
          const overdue = partStates.filter((p) => p.overdue).length;
          totalExpected += partStates.length; totalSubmitted += submitted;
          totalGraded += graded; totalOverdue += overdue;
          return {
            assignmentId: a.id, title: a.title, weekNumber: a.week_number,
            staged: true, expected: partStates.length, submitted, graded, overdue,
            parts: partStates,
          };
        }

        const s = subByKey.get(`${enrolmentId}:${a.id}`) ?? null;
        const overdue = !s && !!a.due_date && new Date(a.due_date).getTime() < now;
        totalExpected += 1;
        if (s) totalSubmitted += 1;
        if (s?.status === 'graded') totalGraded += 1;
        if (overdue) totalOverdue += 1;
        return {
          assignmentId: a.id, title: a.title, weekNumber: a.week_number,
          staged: false, expected: 1,
          submitted: s ? 1 : 0, graded: s?.status === 'graded' ? 1 : 0,
          overdue: overdue ? 1 : 0,
          parts: [],
          submissionId: s?.id ?? null, score: s?.score ?? null,
          submittedAt: s?.submitted_at ?? null,
        };
      });

      const expected = items.reduce((n, i) => n + i.expected, 0);
      const submitted = items.reduce((n, i) => n + i.submitted, 0);
      return {
        ...baseLearner(e),
        expected,
        submitted,
        graded: items.reduce((n, i) => n + i.graded, 0),
        overdue: items.reduce((n, i) => n + i.overdue, 0),
        completionPct: expected > 0 ? Math.round((submitted / expected) * 100) : 0,
        items,
      };
    });

    // Furthest behind first: the list is a worklist, so the learners who need
    // chasing must not be buried under the ones who are done.
    learners.sort((a, b) => a.completionPct - b.completionPct || (b.overdue - a.overdue));

    return successResponse({
      success: true,
      learners,
      assignments: assignments.map((a) => ({
        id: a.id, title: a.title, weekNumber: a.week_number, dueDate: a.due_date,
        parts: (partsByAssignment.get(a.id as string) ?? []).map((p) => ({
          id: p.id, partNumber: p.part_number, weekNumber: p.week_number,
          title: p.title, dueDate: p.due_date, isRequired: p.is_required,
        })),
      })),
      totals: {
        learners: learners.length,
        expected: totalExpected,
        submitted: totalSubmitted,
        graded: totalGraded,
        overdue: totalOverdue,
        completionPct: totalExpected > 0 ? Math.round((totalSubmitted / totalExpected) * 100) : 0,
      },
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load assignment progress');
  }
}

function baseLearner(e: Row) {
  const app = e.academy_applications ?? {};
  return {
    enrollmentId: e.id as string,
    applicationId: e.application_id as string,
    name: (app.full_name as string) ?? null,
    email: (app.email as string) ?? null,
  };
}

function emptyTotals() {
  return { learners: 0, expected: 0, submitted: 0, graded: 0, overdue: 0, completionPct: 0 };
}
