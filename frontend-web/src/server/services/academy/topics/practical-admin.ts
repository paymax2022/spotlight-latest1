// Practical assessment administration: authoring, review queue, grading and
// the hold-ledger effects of opening or withdrawing the gate.
//
// Nothing here bypasses the academic rules:
//   - activation is explicit and backfills PRACTICAL_PENDING holds for learners
//     who already passed the quiz, so a new practical requirement cannot be
//     skipped by learners who finished earlier;
//   - grading uses the rubric snapshot frozen at submit, never the current
//     draft rubric, so editing the rubric cannot re-grade history;
//   - the score is computed from the criteria server-side; a reviewer never
//     supplies a percentage;
//   - a failed practical requires actionable feedback;
//   - only workflow-owned holds are cleared; manual academic holds stay open.

import { createAdminClient } from '@/lib/supabase/server';
import { TopicAdminError } from './admin';
import {
  PRACTICAL_MIN_FAILURE_FEEDBACK,
  PRACTICAL_PASS_PERCENT,
  applyPracticalGradeToHolds,
  normalizePracticalAssessmentInput,
  normalizePracticalGradeInput,
  practicalAssessmentView,
  practicalSubmissionView,
  restoreMasteryIfClear,
  scorePracticalSubmission,
  type PracticalAssessmentView,
  type PracticalRubricCriterion,
  type PracticalRubricScore,
  type PracticalSubmissionView,
} from './practical';

type Db = ReturnType<typeof createAdminClient>;

interface AssessmentRow {
  id: string;
  topic_id: string;
  title: string;
  brief_markdown: string;
  submission_instructions: string;
  rubric: PracticalRubricCriterion[];
  pass_percent: number;
  max_attempts: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

interface SubmissionRow {
  id: string;
  assessment_id: string;
  enrollment_id: string;
  user_id: string;
  topic_id: string;
  attempt_number: number;
  status: string;
  submission_text: string;
  media_url: string;
  media_note: string;
  rubric_snapshot: PracticalRubricCriterion[];
  pass_threshold: number;
  submitted_at: string | null;
  graded_at: string | null;
  graded_by: string | null;
  earned_points: number | null;
  possible_points: number | null;
  percentage: number | string | null;
  passed: boolean | null;
  rubric_scores: PracticalRubricScore[];
  feedback: string;
  created_at: string;
}

export interface PracticalAssessmentCounts {
  draft: number;
  submitted: number;
  graded: number;
  passed: number;
}

export interface PracticalAssessmentAdminRow extends PracticalAssessmentView {
  topicTitle: string;
  topicPublished: boolean;
  updatedAt: string | null;
  counts: PracticalAssessmentCounts;
}

export interface PracticalAssessmentContext {
  topic: { topicId: string; title: string; published: boolean; prerequisites: string[] };
  assessment: PracticalAssessmentAdminRow | null;
}

export interface PracticalAssessmentMutationResult {
  ok: true;
  created: boolean;
  assessment: PracticalAssessmentAdminRow;
  gateChanged: 'activated' | 'deactivated' | 'unchanged';
  holdsOpened: number;
  holdsCleared: number;
}

export interface PracticalQueueFilter {
  status?: string;
  topicId?: string;
  page: number;
  pageSize: number;
}

export interface PracticalQueueRow {
  id: string;
  submissionId: string;
  topicId: string;
  topicTitle: string;
  enrollmentId: string;
  learnerName: string;
  learnerEmail: string;
  assessmentId: string;
  assessmentTitle: string;
  attemptNumber: number;
  status: string;
  submittedAt: string | null;
  gradedAt: string | null;
  percentage: number | null;
  passed: boolean | null;
  hasText: boolean;
  hasMediaUrl: boolean;
}

export interface PracticalQueueResult {
  rows: PracticalQueueRow[];
  total: number;
  pending: number;
}

export interface PracticalSubmissionAdminView extends PracticalSubmissionView {
  topicId: string;
  topicTitle: string;
  enrollmentId: string;
  learnerName: string;
  learnerEmail: string;
  assessmentId: string;
  assessmentTitle: string;
  assessmentActive: boolean;
  rubricSnapshot: PracticalRubricCriterion[];
  passThreshold: number;
  gradedBy: string | null;
}

export interface PracticalGradeResult {
  ok: true;
  reconciled: boolean;
  submission: PracticalSubmissionAdminView;
  masteryState: string | null;
  holdEffect: 'applied' | 'skipped_inactive';
}

const QUEUE_STATUSES = new Set(['draft', 'submitted', 'graded']);

function numeric(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function emptyCounts(): PracticalAssessmentCounts {
  return { draft: 0, submitted: 0, graded: 0, passed: 0 };
}

async function loadTopic(
  db: Db,
  topicId: string,
): Promise<{ topic_id: string; title: string; published: boolean; prerequisites: string[] }> {
  const { data, error } = await db
    .from('film_topics')
    .select('topic_id, title, published, prerequisites')
    .eq('topic_id', topicId)
    .maybeSingle();
  if (error) {
    console.error('[film/practical-admin] topic lookup failed', error);
    throw new TopicAdminError(500, 'PRACTICAL_LOAD_FAILED', 'Could not load the topic.');
  }
  if (!data) throw new TopicAdminError(404, 'TOPIC_NOT_FOUND', 'Topic not found.');
  return data as { topic_id: string; title: string; published: boolean; prerequisites: string[] };
}

async function loadAssessment(db: Db, topicId: string): Promise<AssessmentRow | null> {
  const { data, error } = await db
    .from('film_practical_assessments')
    .select('*')
    .eq('topic_id', topicId)
    .maybeSingle();
  if (error) {
    console.error('[film/practical-admin] assessment lookup failed', error);
    throw new TopicAdminError(500, 'PRACTICAL_LOAD_FAILED', 'Could not load the practical assessment.');
  }
  return (data as AssessmentRow | null) ?? null;
}

async function countsByAssessment(
  db: Db,
  assessmentIds: string[],
): Promise<Map<string, PracticalAssessmentCounts>> {
  const counts = new Map<string, PracticalAssessmentCounts>();
  if (assessmentIds.length === 0) return counts;
  const { data, error } = await db
    .from('film_practical_submissions')
    .select('assessment_id, status, passed')
    .in('assessment_id', assessmentIds);
  if (error) {
    console.error('[film/practical-admin] submission counts failed', error);
    throw new TopicAdminError(500, 'PRACTICAL_LOAD_FAILED', 'Could not count practical submissions.');
  }
  for (const row of (data ?? []) as Array<{ assessment_id: string; status: string; passed: boolean | null }>) {
    const bucket = counts.get(row.assessment_id) ?? emptyCounts();
    if (row.status === 'draft') bucket.draft += 1;
    if (row.status === 'submitted') bucket.submitted += 1;
    if (row.status === 'graded') {
      bucket.graded += 1;
      if (row.passed === true) bucket.passed += 1;
    }
    counts.set(row.assessment_id, bucket);
  }
  return counts;
}

function adminAssessmentView(
  row: AssessmentRow,
  topic: { title: string; published: boolean },
  counts: PracticalAssessmentCounts,
): PracticalAssessmentAdminRow {
  return {
    ...practicalAssessmentView(row),
    topicTitle: topic.title,
    topicPublished: topic.published,
    updatedAt: row.updated_at ?? null,
    counts,
  };
}

export async function listPracticalAssessments(
  db: Db,
): Promise<{ assessments: PracticalAssessmentAdminRow[]; totals: PracticalAssessmentCounts }> {
  const { data, error } = await db
    .from('film_practical_assessments')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) {
    console.error('[film/practical-admin] assessment list failed', error);
    throw new TopicAdminError(500, 'PRACTICAL_LOAD_FAILED', 'Could not load practical assessments.');
  }
  const rows = (data ?? []) as AssessmentRow[];
  const topicIds = Array.from(new Set(rows.map((row) => row.topic_id)));
  const [topicRes, counts] = await Promise.all([
    topicIds.length > 0
      ? db.from('film_topics').select('topic_id, title, published').in('topic_id', topicIds)
      : Promise.resolve({ data: [] as Array<{ topic_id: string; title: string; published: boolean }> }),
    countsByAssessment(db, rows.map((row) => row.id)),
  ]);
  const topics = new Map(
    ((topicRes.data ?? []) as Array<{ topic_id: string; title: string; published: boolean }>).map((row) => [
      row.topic_id,
      row,
    ]),
  );

  const totals = emptyCounts();
  const assessments = rows.map((row) => {
    const topic = topics.get(row.topic_id) ?? { title: row.topic_id, published: false };
    const countsForRow = counts.get(row.id) ?? emptyCounts();
    totals.draft += countsForRow.draft;
    totals.submitted += countsForRow.submitted;
    totals.graded += countsForRow.graded;
    totals.passed += countsForRow.passed;
    return adminAssessmentView(row, topic, countsForRow);
  });

  return { assessments, totals };
}

export async function getPracticalAssessmentForAdmin(
  db: Db,
  topicId: string,
): Promise<PracticalAssessmentContext> {
  const topic = await loadTopic(db, topicId);
  const assessment = await loadAssessment(db, topicId);
  const counts = assessment ? await countsByAssessment(db, [assessment.id]) : new Map();
  return {
    topic: {
      topicId: topic.topic_id,
      title: topic.title,
      published: topic.published,
      prerequisites: topic.prerequisites ?? [],
    },
    assessment: assessment
      ? adminAssessmentView(assessment, topic, counts.get(assessment.id) ?? emptyCounts())
      : null,
  };
}

/**
 * Opening the gate must reach learners who already passed the quiz. They get a
 * workflow hold (and lose MASTERED, never PASSED) until they pass the practical.
 * Only holds created by this workflow are counted; manual holds are untouched.
 */
async function openPracticalGate(
  db: Db,
  actorId: string | null,
  topicId: string,
  assessment: { id: string; title: string },
): Promise<number> {
  const { data: masteryData, error: masteryError } = await db
    .from('film_topic_mastery')
    .select('enrollment_id, user_id, state, passed_at')
    .eq('topic_id', topicId)
    .not('passed_at', 'is', null);
  if (masteryError) {
    console.error('[film/practical-admin] gate backfill lookup failed', masteryError);
    throw new TopicAdminError(500, 'PRACTICAL_GATE_FAILED', 'The assessment was saved, but existing learners could not be evaluated.');
  }
  const masteryRows = (masteryData ?? []) as Array<{
    enrollment_id: string;
    user_id: string;
    state: string;
    passed_at: string | null;
  }>;
  if (masteryRows.length === 0) return 0;

  const enrollmentIds = Array.from(new Set(masteryRows.map((row) => row.enrollment_id)));
  const [passRes, holdRes] = await Promise.all([
    db
      .from('film_practical_submissions')
      .select('enrollment_id')
      .eq('topic_id', topicId)
      .eq('status', 'graded')
      .eq('passed', true)
      .in('enrollment_id', enrollmentIds),
    db
      .from('film_mastery_holds')
      .select('enrollment_id')
      .eq('topic_id', topicId)
      .eq('status', 'open')
      .eq('source', 'practical_assessment')
      .in('enrollment_id', enrollmentIds),
  ]);
  if (passRes.error || holdRes.error) {
    console.error('[film/practical-admin] gate backfill evidence failed', passRes.error ?? holdRes.error);
    throw new TopicAdminError(500, 'PRACTICAL_GATE_FAILED', 'The assessment was saved, but existing learners could not be evaluated.');
  }
  const passed = new Set(((passRes.data ?? []) as Array<{ enrollment_id: string }>).map((row) => row.enrollment_id));
  const held = new Set(((holdRes.data ?? []) as Array<{ enrollment_id: string }>).map((row) => row.enrollment_id));
  const targets = masteryRows.filter((row) => !passed.has(row.enrollment_id) && !held.has(row.enrollment_id));
  if (targets.length === 0) return 0;

  const now = new Date().toISOString();
  const reason = `Complete the practical assessment "${assessment.title}" before this topic can be mastered.`;
  const holdRows = targets.map((row) => ({
    enrollment_id: row.enrollment_id,
    topic_id: topicId,
    hold_type: 'PRACTICAL_PENDING',
    reason,
    status: 'open',
    created_by: actorId,
    source: 'practical_assessment',
    source_ref: assessment.id,
  }));

  let opened: Array<{ id: string; enrollment_id: string }> = [];
  const { data: inserted, error: insertError } = await db
    .from('film_mastery_holds')
    .insert(holdRows)
    .select('id, enrollment_id');
  if (!insertError) {
    opened = (inserted ?? []) as Array<{ id: string; enrollment_id: string }>;
  } else if (insertError.code === '23505') {
    for (const row of holdRows) {
      const { data, error } = await db
        .from('film_mastery_holds')
        .insert(row)
        .select('id, enrollment_id')
        .maybeSingle();
      if (!error) opened.push(data as { id: string; enrollment_id: string });
      else if (error.code !== '23505') console.error('[film/practical-admin] gate hold insert failed', error);
    }
  } else {
    console.error('[film/practical-admin] gate hold batch failed', insertError);
    throw new TopicAdminError(500, 'PRACTICAL_GATE_FAILED', 'The assessment was saved, but practical holds could not be opened.');
  }

  const capIds = targets.filter((row) => row.state === 'MASTERED').map((row) => row.enrollment_id);
  if (capIds.length > 0) {
    const { error: capError } = await db
      .from('film_topic_mastery')
      .update({ state: 'PASSED', updated_at: now })
      .eq('topic_id', topicId)
      .eq('state', 'MASTERED')
      .in('enrollment_id', capIds);
    if (capError) console.error('[film/practical-admin] mastery cap failed', capError);
  }

  const userByEnrollment = new Map(targets.map((row) => [row.enrollment_id, row.user_id]));
  const events = opened
    .filter((hold) => userByEnrollment.has(hold.enrollment_id))
    .map((hold) => ({
      user_id: userByEnrollment.get(hold.enrollment_id),
      enrollment_id: hold.enrollment_id,
      topic_id: topicId,
      event_type: 'TOPIC_HOLD_CREATED',
      dedupe_key: `hold:${hold.id}:created`,
      payload: {
        holdId: hold.id,
        holdType: 'PRACTICAL_PENDING',
        source: 'practical_assessment',
        assessmentId: assessment.id,
        reason,
      },
    }));
  if (events.length > 0) {
    const { error: eventError } = await db
      .from('film_mastery_events')
      .upsert(events, { onConflict: 'dedupe_key', ignoreDuplicates: true });
    if (eventError) console.error('[film/practical-admin] gate events failed', eventError);
  }

  return opened.length;
}

/** Withdrawing the gate clears only workflow holds and restores earned mastery. */
async function closePracticalGate(
  db: Db,
  actorId: string | null,
  topicId: string,
): Promise<number> {
  const { data, error } = await db
    .from('film_mastery_holds')
    .select('id, enrollment_id')
    .eq('topic_id', topicId)
    .eq('status', 'open')
    .eq('source', 'practical_assessment');
  if (error) {
    console.error('[film/practical-admin] gate close lookup failed', error);
    throw new TopicAdminError(500, 'PRACTICAL_GATE_FAILED', 'The assessment was saved, but practical holds could not be read.');
  }
  const holds = (data ?? []) as Array<{ id: string; enrollment_id: string }>;
  if (holds.length === 0) return 0;

  const now = new Date().toISOString();
  const { error: clearError } = await db
    .from('film_mastery_holds')
    .update({
      status: 'cleared',
      cleared_by: actorId,
      cleared_at: now,
      clearance_note: 'Practical assessment withdrawn by the academy.',
    })
    .in('id', holds.map((hold) => hold.id));
  if (clearError) {
    console.error('[film/practical-admin] gate close failed', clearError);
    throw new TopicAdminError(500, 'PRACTICAL_GATE_FAILED', 'The assessment was saved, but practical holds could not be cleared.');
  }

  const enrollmentIds = Array.from(new Set(holds.map((hold) => hold.enrollment_id)));
  const { data: masteryData } = await db
    .from('film_topic_mastery')
    .select('enrollment_id, user_id')
    .eq('topic_id', topicId)
    .in('enrollment_id', enrollmentIds);
  const masteryRows = (masteryData ?? []) as Array<{ enrollment_id: string; user_id: string }>;
  for (const row of masteryRows) {
    try {
      await restoreMasteryIfClear(
        db,
        { enrollmentId: row.enrollment_id, userId: row.user_id },
        topicId,
        now,
      );
    } catch (restoreError) {
      console.error('[film/practical-admin] mastery restore failed', restoreError);
    }
  }

  const userByEnrollment = new Map(masteryRows.map((row) => [row.enrollment_id, row.user_id]));
  const events = holds
    .filter((hold) => userByEnrollment.has(hold.enrollment_id))
    .map((hold) => ({
      user_id: userByEnrollment.get(hold.enrollment_id),
      enrollment_id: hold.enrollment_id,
      topic_id: topicId,
      event_type: 'TOPIC_HOLD_CLEARED',
      dedupe_key: `hold:${hold.id}:cleared`,
      payload: {
        holdId: hold.id,
        holdType: 'PRACTICAL_PENDING',
        source: 'practical_assessment',
        reason: 'Practical assessment withdrawn by the academy.',
      },
    }));
  if (events.length > 0) {
    const { error: eventError } = await db
      .from('film_mastery_events')
      .upsert(events, { onConflict: 'dedupe_key', ignoreDuplicates: true });
    if (eventError) console.error('[film/practical-admin] gate close events failed', eventError);
  }

  return holds.length;
}

/**
 * Create or update the per-topic assessment. Activation/deactivation is the
 * only action that touches learners, and it is reported back to the caller.
 */
export async function upsertPracticalAssessment(
  db: Db,
  actorId: string | null,
  topicId: string,
  value: unknown,
): Promise<PracticalAssessmentMutationResult> {
  const input = normalizePracticalAssessmentInput(value);
  const topic = await loadTopic(db, topicId);
  const existing = await loadAssessment(db, topicId);
  const now = new Date().toISOString();
  const fields = {
    title: input.title,
    brief_markdown: input.briefMarkdown,
    submission_instructions: input.submissionInstructions,
    rubric: input.rubric,
    pass_percent: input.passPercent,
    max_attempts: input.maxAttempts,
    active: input.active,
    updated_by: actorId,
    updated_at: now,
  };

  let saved: AssessmentRow;
  if (existing) {
    const { data, error } = await db
      .from('film_practical_assessments')
      .update(fields)
      .eq('id', existing.id)
      .select('*')
      .maybeSingle();
    if (error || !data) {
      console.error('[film/practical-admin] assessment update failed', error);
      throw new TopicAdminError(500, 'PRACTICAL_SAVE_FAILED', 'Could not save the practical assessment.');
    }
    saved = data as AssessmentRow;
  } else {
    const { data, error } = await db
      .from('film_practical_assessments')
      .insert({ topic_id: topicId, ...fields, created_by: actorId })
      .select('*')
      .maybeSingle();
    if (error || !data) {
      if (error?.code === '23505') {
        throw new TopicAdminError(
          409,
          'PRACTICAL_CONFLICT',
          'Another administrator saved this assessment at the same time. Reload and try again.',
        );
      }
      console.error('[film/practical-admin] assessment insert failed', error);
      throw new TopicAdminError(500, 'PRACTICAL_SAVE_FAILED', 'Could not create the practical assessment.');
    }
    saved = data as AssessmentRow;
  }

  const wasActive = existing?.active === true;
  const gateChanged: PracticalAssessmentMutationResult['gateChanged'] =
    input.active === wasActive ? 'unchanged' : input.active ? 'activated' : 'deactivated';
  let holdsOpened = 0;
  let holdsCleared = 0;
  // Reconcile on every save rather than only when the flag flips. A previous
  // save can persist the assessment and then fail while writing holds; re-saving
  // must be able to finish the job. Each helper is idempotent.
  if (input.active) {
    holdsOpened = await openPracticalGate(db, actorId, topicId, { id: saved.id, title: saved.title });
  } else {
    holdsCleared = await closePracticalGate(db, actorId, topicId);
  }

  const counts = await countsByAssessment(db, [saved.id]);
  await db
    .from('film_academic_audit')
    .insert({
      actor_id: actorId,
      actor_role: 'admin',
      action: existing ? 'FILM_PRACTICAL_ASSESSMENT_UPDATED' : 'FILM_PRACTICAL_ASSESSMENT_CREATED',
      target_type: 'film_topic',
      target_id: topicId,
      before: existing
        ? {
            active: existing.active,
            passPercent: Number(existing.pass_percent),
            maxAttempts: Number(existing.max_attempts),
            rubricCriteria: (existing.rubric ?? []).length,
          }
        : {},
      after: {
        assessmentId: saved.id,
        active: input.active,
        passPercent: input.passPercent,
        maxAttempts: input.maxAttempts,
        rubricCriteria: input.rubric.length,
        gateChanged,
        holdsOpened,
        holdsCleared,
      },
      reason: 'Practical assessment configuration saved.',
    })
    .then(({ error }) => {
      if (error) console.error('[film/practical-admin] assessment audit failed', error);
    });

  return {
    ok: true,
    created: !existing,
    assessment: adminAssessmentView(saved, topic, counts.get(saved.id) ?? emptyCounts()),
    gateChanged,
    holdsOpened,
    holdsCleared,
  };
}

interface LearnerRef {
  name: string;
  email: string;
}

async function learnerRefs(db: Db, enrollmentIds: string[]): Promise<Map<string, LearnerRef>> {
  const learners = new Map<string, LearnerRef>();
  if (enrollmentIds.length === 0) return learners;
  const { data } = await db
    .from('academy_enrollments')
    .select('id, academy_applications(full_name, email)')
    .in('id', enrollmentIds);
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const app = row.academy_applications as
      | { full_name?: string; email?: string }
      | Array<{ full_name?: string; email?: string }>
      | null;
    const application = Array.isArray(app) ? app[0] : app;
    learners.set(String(row.id), {
      name: application?.full_name ?? '',
      email: application?.email ?? '',
    });
  }
  return learners;
}

export async function listPracticalQueue(
  db: Db,
  filter: PracticalQueueFilter,
): Promise<PracticalQueueResult> {
  const status = filter.status === 'all'
    ? 'all'
    : filter.status && QUEUE_STATUSES.has(filter.status)
      ? filter.status
      : 'submitted';
  let query = db
    .from('film_practical_submissions')
    .select('*', { count: 'exact' });
  if (status !== 'all') query = query.eq('status', status);
  query = query.order(
    status === 'submitted' ? 'submitted_at' : status === 'graded' ? 'graded_at' : 'created_at',
    { ascending: status === 'submitted' },
  );
  if (filter.topicId) query = query.eq('topic_id', filter.topicId);
  const from = (filter.page - 1) * filter.pageSize;
  const { data, error, count } = await query.range(from, from + filter.pageSize - 1);
  if (error) {
    console.error('[film/practical-admin] queue failed', error);
    throw new TopicAdminError(500, 'PRACTICAL_QUEUE_FAILED', 'Could not load the practical review queue.');
  }
  const rows = (data ?? []) as SubmissionRow[];

  let pendingQuery = db
    .from('film_practical_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'submitted');
  if (filter.topicId) pendingQuery = pendingQuery.eq('topic_id', filter.topicId);
  const { count: pending } = await pendingQuery;

  const topicIds = Array.from(new Set(rows.map((row) => row.topic_id)));
  const assessmentIds = Array.from(new Set(rows.map((row) => row.assessment_id)));
  const enrollmentIds = Array.from(new Set(rows.map((row) => row.enrollment_id)));
  const [topicRes, assessmentRes, learners] = await Promise.all([
    topicIds.length > 0
      ? db.from('film_topics').select('topic_id, title').in('topic_id', topicIds)
      : Promise.resolve({ data: [] as Array<{ topic_id: string; title: string }> }),
    assessmentIds.length > 0
      ? db.from('film_practical_assessments').select('id, title').in('id', assessmentIds)
      : Promise.resolve({ data: [] as Array<{ id: string; title: string }> }),
    learnerRefs(db, enrollmentIds),
  ]);
  const topics = new Map(
    ((topicRes.data ?? []) as Array<{ topic_id: string; title: string }>).map((row) => [
      row.topic_id,
      row.title,
    ]),
  );
  const assessments = new Map(
    ((assessmentRes.data ?? []) as Array<{ id: string; title: string }>).map((row) => [row.id, row.title]),
  );

  return {
    rows: rows.map((row) => {
      const learner = learners.get(row.enrollment_id);
      return {
        id: row.id,
        submissionId: row.id,
        topicId: row.topic_id,
        topicTitle: topics.get(row.topic_id) ?? row.topic_id,
        enrollmentId: row.enrollment_id,
        learnerName: learner?.name ?? '',
        learnerEmail: learner?.email ?? '',
        assessmentId: row.assessment_id,
        assessmentTitle: assessments.get(row.assessment_id) ?? '',
        attemptNumber: Number(row.attempt_number ?? 1),
        status: row.status,
        submittedAt: row.submitted_at,
        gradedAt: row.graded_at,
        percentage: numeric(row.percentage),
        passed: row.passed,
        hasText: Boolean(row.submission_text),
        hasMediaUrl: Boolean(row.media_url),
      };
    }),
    total: count ?? rows.length,
    pending: pending ?? 0,
  };
}

async function loadSubmission(db: Db, submissionId: string): Promise<SubmissionRow> {
  const { data, error } = await db
    .from('film_practical_submissions')
    .select('*')
    .eq('id', submissionId)
    .maybeSingle();
  if (error) {
    console.error('[film/practical-admin] submission lookup failed', error);
    throw new TopicAdminError(500, 'PRACTICAL_LOAD_FAILED', 'Could not load the practical submission.');
  }
  if (!data) throw new TopicAdminError(404, 'PRACTICAL_SUBMISSION_NOT_FOUND', 'Practical submission not found.');
  return data as SubmissionRow;
}

async function adminSubmissionView(
  db: Db,
  row: SubmissionRow,
): Promise<PracticalSubmissionAdminView> {
  const [topicRes, assessmentRes, learners] = await Promise.all([
    db.from('film_topics').select('topic_id, title').eq('topic_id', row.topic_id).maybeSingle(),
    db
      .from('film_practical_assessments')
      .select('id, title, active')
      .eq('id', row.assessment_id)
      .maybeSingle(),
    learnerRefs(db, [row.enrollment_id]),
  ]);
  const topic = topicRes.data as { topic_id: string; title: string } | null;
  const assessment = assessmentRes.data as { id: string; title: string; active: boolean } | null;
  const learner = learners.get(row.enrollment_id);
  return {
    ...practicalSubmissionView(row),
    topicId: row.topic_id,
    topicTitle: topic?.title ?? row.topic_id,
    enrollmentId: row.enrollment_id,
    learnerName: learner?.name ?? '',
    learnerEmail: learner?.email ?? '',
    assessmentId: row.assessment_id,
    assessmentTitle: assessment?.title ?? '',
    assessmentActive: assessment?.active === true,
    rubricSnapshot: row.rubric_snapshot ?? [],
    passThreshold: Number(row.pass_threshold ?? PRACTICAL_PASS_PERCENT),
    gradedBy: row.graded_by ?? null,
  };
}

export async function getPracticalSubmissionForAdmin(
  db: Db,
  submissionId: string,
): Promise<PracticalSubmissionAdminView> {
  return adminSubmissionView(db, await loadSubmission(db, submissionId));
}

function sameGrade(
  row: SubmissionRow,
  scores: PracticalRubricScore[],
  feedback: string,
): boolean {
  const committedScores = row.rubric_scores ?? [];
  if (committedScores.length !== scores.length) return false;
  const committed = new Map(committedScores.map((score) => [score.criterionId, score]));
  for (const score of scores) {
    const existing = committed.get(score.criterionId);
    if (!existing) return false;
    if (Number(existing.points) !== score.points) return false;
    if ((existing.comment ?? '') !== score.comment) return false;
  }
  return (row.feedback ?? '') === feedback.trim();
}

async function readMasteryState(
  db: Db,
  enrollmentId: string,
  topicId: string,
): Promise<string | null> {
  const { data } = await db
    .from('film_topic_mastery')
    .select('state')
    .eq('enrollment_id', enrollmentId)
    .eq('topic_id', topicId)
    .maybeSingle();
  return (data as { state?: string } | null)?.state ?? null;
}

/**
 * Grade submitted work exactly once. The rubric is the submission's frozen
 * snapshot; the pass mark is the one frozen at submit. Replaying the identical
 * grade is idempotent; a conflicting second grade is rejected.
 */
export async function gradePracticalSubmission(
  db: Db,
  actorId: string | null,
  submissionId: string,
  value: unknown,
): Promise<PracticalGradeResult> {
  const submission = await loadSubmission(db, submissionId);
  if (submission.status === 'draft') {
    throw new TopicAdminError(
      409,
      'PRACTICAL_NOT_SUBMITTED',
      'This learner has not submitted the practical yet.',
    );
  }

  const assessment = await loadAssessment(db, submission.topic_id);
  const rubric =
    Array.isArray(submission.rubric_snapshot) && submission.rubric_snapshot.length > 0
      ? submission.rubric_snapshot
      : null;
  if (!rubric) {
    throw new TopicAdminError(
      409,
      'PRACTICAL_RUBRIC_SNAPSHOT_MISSING',
      'This submission has no frozen rubric and cannot be graded safely.',
    );
  }

  const input = normalizePracticalGradeInput(rubric, value);
  const passPercent = Number(submission.pass_threshold ?? PRACTICAL_PASS_PERCENT);
  const result = scorePracticalSubmission(rubric, input.scores, passPercent);
  if (!result.passed && input.feedback.length < PRACTICAL_MIN_FAILURE_FEEDBACK) {
    throw new TopicAdminError(
      400,
      'PRACTICAL_FEEDBACK_REQUIRED',
      `A failed practical needs at least ${PRACTICAL_MIN_FAILURE_FEEDBACK} characters of actionable feedback.`,
    );
  }

  if (submission.status === 'graded') {
    if (!sameGrade(submission, input.scores, input.feedback)) {
      throw new TopicAdminError(
        409,
        'PRACTICAL_ALREADY_GRADED',
        'This submission has already been graded with a different result.',
      );
    }
    return {
      ok: true,
      reconciled: true,
      submission: await adminSubmissionView(db, submission),
      masteryState: await readMasteryState(db, submission.enrollment_id, submission.topic_id),
      holdEffect: 'applied',
    };
  }

  const now = new Date().toISOString();
  const { data, error } = await db
    .from('film_practical_submissions')
    .update({
      status: 'graded',
      graded_by: actorId,
      graded_at: now,
      earned_points: result.earnedPoints,
      possible_points: result.possiblePoints,
      percentage: result.percentage,
      passed: result.passed,
      rubric_scores: input.scores,
      feedback: input.feedback,
      updated_at: now,
    })
    .eq('id', submissionId)
    .eq('status', 'submitted')
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('[film/practical-admin] grade update failed', error);
    throw new TopicAdminError(500, 'PRACTICAL_GRADE_FAILED', 'Could not save the practical grade.');
  }

  let committed: SubmissionRow;
  let reconciled = false;
  if (!data) {
    const fresh = await loadSubmission(db, submissionId);
    if (fresh.status !== 'graded' || !sameGrade(fresh, input.scores, input.feedback)) {
      throw new TopicAdminError(
        409,
        'PRACTICAL_ALREADY_GRADED',
        'This submission was graded by another reviewer.',
      );
    }
    committed = fresh;
    reconciled = true;
  } else {
    committed = data as SubmissionRow;
  }

  const holdEffect: PracticalGradeResult['holdEffect'] =
    assessment?.active === true ? 'applied' : 'skipped_inactive';
  let masteryState: string | null = null;
  if (!reconciled) {
    if (holdEffect === 'applied' && assessment) {
      masteryState = await applyPracticalGradeToHolds(
        db,
        actorId,
        { enrollmentId: committed.enrollment_id, userId: committed.user_id },
        committed.topic_id,
        { id: assessment.id, title: assessment.title },
        result.passed,
        input.feedback,
      );
    } else {
      masteryState = await readMasteryState(db, committed.enrollment_id, committed.topic_id);
    }

    await db
      .from('film_mastery_events')
      .upsert(
        {
          user_id: committed.user_id,
          enrollment_id: committed.enrollment_id,
          topic_id: committed.topic_id,
          event_type: result.passed ? 'PRACTICAL_PASSED' : 'PRACTICAL_FAILED',
          dedupe_key: `practical:${submissionId}:graded`,
          payload: {
            submissionId,
            assessmentId: committed.assessment_id,
            attemptNumber: Number(committed.attempt_number ?? 1),
            earnedPoints: result.earnedPoints,
            possiblePoints: result.possiblePoints,
            percentage: result.percentage,
            passed: result.passed,
            threshold: passPercent,
            masteryState,
            holdEffect,
          },
        },
        { onConflict: 'dedupe_key', ignoreDuplicates: true },
      )
      .then(({ error: eventError }) => {
        if (eventError) console.error('[film/practical-admin] grade event failed', eventError);
      });

    await db
      .from('film_academic_audit')
      .insert({
        actor_id: actorId,
        actor_role: 'admin',
        action: 'FILM_PRACTICAL_GRADED',
        target_type: 'film_practical_submission',
        target_id: submissionId,
        before: { status: 'submitted' },
        after: {
          status: 'graded',
          topicId: committed.topic_id,
          assessmentId: committed.assessment_id,
          attemptNumber: Number(committed.attempt_number ?? 1),
          earnedPoints: result.earnedPoints,
          possiblePoints: result.possiblePoints,
          percentage: result.percentage,
          passed: result.passed,
          threshold: passPercent,
          masteryState,
          holdEffect,
        },
        reason: result.passed
          ? 'Practical work graded as passed.'
          : 'Practical work graded as not passed; feedback recorded.',
      })
      .then(({ error: auditError }) => {
        if (auditError) console.error('[film/practical-admin] grade audit failed', auditError);
      });
  } else {
    masteryState = await readMasteryState(db, committed.enrollment_id, committed.topic_id);
  }

  return {
    ok: true,
    reconciled,
    submission: await adminSubmissionView(db, committed),
    masteryState,
    holdEffect,
  };
}
