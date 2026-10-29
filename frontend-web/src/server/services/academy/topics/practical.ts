// Practical assessment: brief, learner submission and the automatic hold that
// makes mastery require real work, not just a quiz score.
//
// Boundaries:
//   - An assessment is a per-topic definition authored by the academy. Only an
//     ACTIVE assessment accepts submissions and gates mastery; an inactive one
//     is a draft that survives for history but changes nothing.
//   - A submission snapshots the rubric and pass mark at submit time. Editing
//     the rubric later must never re-grade history.
//   - The pass gate is the same exact integer rule as the quiz:
//         earnedPoints * 100 >= possiblePoints * passPercent
//     Percentage is display-only.
//   - The learner never chooses an enrollment or another learner's submission.
//     Every read and write is scoped to the server-resolved enrolment.
//   - Practical holds are provenance-tagged (`source = 'practical_assessment'`)
//     so the workflow can clear its own hold without touching a manual one.

import { createAdminClient } from '@/lib/supabase/server';
import { displayPercent, passesTopicQuiz } from './types';
import { loadActivePilotCourseIds } from './pilot';
import type { LearnerIdentity } from './progress';

type Db = ReturnType<typeof createAdminClient>;

export const PRACTICAL_PASS_PERCENT = 85;
export const PRACTICAL_MAX_RUBRIC_CRITERIA = 10;
export const PRACTICAL_MAX_CRITERION_POINTS = 100;
export const PRACTICAL_MAX_TEXT = 20_000;
export const PRACTICAL_MAX_URL = 2_000;
export const PRACTICAL_MAX_NOTE = 2_000;
export const PRACTICAL_MAX_FEEDBACK = 5_000;
export const PRACTICAL_MIN_FAILURE_FEEDBACK = 10;

export class PracticalError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface PracticalRubricCriterion {
  id: string;
  label: string;
  description: string;
  maxPoints: number;
}

export interface PracticalRubricScore {
  criterionId: string;
  points: number;
  comment: string;
}

export interface PracticalAssessmentInput {
  title: string;
  briefMarkdown: string;
  submissionInstructions: string;
  rubric: PracticalRubricCriterion[];
  passPercent: number;
  maxAttempts: number;
  active: boolean;
}

export interface PracticalEvidenceInput {
  submissionText: string;
  mediaUrl: string;
  mediaNote: string;
}

export interface PracticalAssessmentView {
  id: string;
  topicId: string;
  title: string;
  briefMarkdown: string;
  submissionInstructions: string;
  rubric: PracticalRubricCriterion[];
  passPercent: number;
  maxAttempts: number;
  active: boolean;
}

export interface PracticalSubmissionView {
  id: string;
  attemptNumber: number;
  status: string;
  submissionText: string;
  mediaUrl: string;
  mediaNote: string;
  submittedAt: string | null;
  gradedAt: string | null;
  earnedPoints: number | null;
  possiblePoints: number | null;
  percentage: number | null;
  passed: boolean | null;
  feedback: string;
  rubricScores: PracticalRubricScore[];
  rubricSnapshot: PracticalRubricCriterion[];
}

export interface PracticalEligibility {
  canSubmit: boolean;
  reason: string | null;
  attemptsUsed: number;
  maxAttempts: number;
  passed: boolean;
  inReview: boolean;
  draftSubmissionId: string | null;
}

export interface LearnerPracticalView {
  topicId: string;
  topicTitle: string;
  assessment: PracticalAssessmentView | null;
  submissions: PracticalSubmissionView[];
  eligibility: PracticalEligibility;
}

export interface PracticalScoreResult {
  earnedPoints: number;
  possiblePoints: number;
  percentage: number;
  passed: boolean;
  threshold: number;
}

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
  created_at?: string;
  updated_at?: string;
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
  earned_points: number | null;
  possible_points: number | null;
  percentage: number | string | null;
  passed: boolean | null;
  rubric_scores: PracticalRubricScore[];
  feedback: string;
  created_at?: string;
}

function isDuplicate(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

function asText(value: unknown, max: number, field: string): string {
  const text = String(value ?? '').trim();
  if (text.length > max) {
    throw new PracticalError(400, 'PRACTICAL_INPUT_TOO_LONG', `${field} must be ${max.toLocaleString()} characters or fewer.`);
  }
  return text;
}

function asHttpUrl(value: unknown): string {
  const url = asText(value, PRACTICAL_MAX_URL, 'The media link');
  if (url && !/^https?:\/\//i.test(url)) {
    throw new PracticalError(400, 'PRACTICAL_URL_INVALID', 'A media link must start with http:// or https://.');
  }
  return url;
}

/** Validate and normalise the authoring payload. Never trusts a client total. */
export function normalizePracticalAssessmentInput(value: unknown): PracticalAssessmentInput {
  const raw = (value ?? {}) as Record<string, unknown>;
  const title = asText(raw.title, 200, 'The assessment title');
  if (title.length < 3) {
    throw new PracticalError(400, 'PRACTICAL_TITLE_REQUIRED', 'Give the assessment a title of at least 3 characters.');
  }
  const briefMarkdown = asText(raw.briefMarkdown, 20_000, 'The brief');
  if (briefMarkdown.length < 20) {
    throw new PracticalError(400, 'PRACTICAL_BRIEF_REQUIRED', 'The brief must be at least 20 characters so a learner knows what to produce.');
  }
  const submissionInstructions = asText(raw.submissionInstructions, 5_000, 'The submission instructions');
  const rubric = validatePracticalRubric(raw.rubric);
  const passPercent = Number(raw.passPercent ?? PRACTICAL_PASS_PERCENT);
  if (!Number.isInteger(passPercent) || passPercent < PRACTICAL_PASS_PERCENT || passPercent > 100) {
    throw new PracticalError(
      400,
      'PRACTICAL_PASS_THRESHOLD_BELOW_POLICY',
      `The practical pass mark must be an integer between ${PRACTICAL_PASS_PERCENT} and 100.`,
    );
  }
  const maxAttempts = Number(raw.maxAttempts ?? 3);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new PracticalError(400, 'PRACTICAL_ATTEMPTS_INVALID', 'Attempts allowed must be an integer between 1 and 10.');
  }
  const active = raw.active === true;
  return { title, briefMarkdown, submissionInstructions, rubric, passPercent, maxAttempts, active };
}

export function validatePracticalRubric(value: unknown): PracticalRubricCriterion[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new PracticalError(400, 'PRACTICAL_RUBRIC_REQUIRED', 'Add at least one rubric criterion.');
  }
  if (value.length > PRACTICAL_MAX_RUBRIC_CRITERIA) {
    throw new PracticalError(
      400,
      'PRACTICAL_RUBRIC_TOO_LARGE',
      `A rubric can have at most ${PRACTICAL_MAX_RUBRIC_CRITERIA} criteria.`,
    );
  }

  const seen = new Set<string>();
  return value.map((entry, index) => {
    const raw = (entry ?? {}) as Record<string, unknown>;
    const id = String(raw.id ?? '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) {
      throw new PracticalError(
        400,
        'PRACTICAL_RUBRIC_ID_INVALID',
        `Criterion ${index + 1} needs a stable id of lowercase letters, digits or hyphens.`,
      );
    }
    if (seen.has(id)) {
      throw new PracticalError(400, 'PRACTICAL_RUBRIC_ID_DUPLICATE', `The rubric criterion id "${id}" is repeated.`);
    }
    seen.add(id);
    const label = asText(raw.label, 160, `Criterion ${index + 1} label`);
    if (label.length < 3) {
      throw new PracticalError(400, 'PRACTICAL_RUBRIC_LABEL_REQUIRED', `Criterion ${index + 1} needs a label.`);
    }
    const description = asText(raw.description, 1_000, `Criterion ${index + 1} description`);
    const maxPoints = Number(raw.maxPoints);
    if (!Number.isInteger(maxPoints) || maxPoints < 1 || maxPoints > PRACTICAL_MAX_CRITERION_POINTS) {
      throw new PracticalError(
        400,
        'PRACTICAL_RUBRIC_POINTS_INVALID',
        `Criterion ${index + 1} must be worth a whole number of points between 1 and ${PRACTICAL_MAX_CRITERION_POINTS}.`,
      );
    }
    return { id, label, description, maxPoints };
  });
}

/** Scores must cover the snapshot exactly once, with integer points in range. */
export function normalizePracticalScores(
  rubric: PracticalRubricCriterion[],
  value: unknown,
): PracticalRubricScore[] {
  if (!Array.isArray(value)) {
    throw new PracticalError(400, 'PRACTICAL_SCORES_REQUIRED', 'Score every rubric criterion.');
  }
  const byId = new Map<string, unknown>();
  for (const entry of value) {
    const raw = (entry ?? {}) as Record<string, unknown>;
    const id = String(raw.criterionId ?? '').trim();
    if (!id) throw new PracticalError(400, 'PRACTICAL_SCORE_INVALID', 'Every score needs a criterion id.');
    if (byId.has(id)) {
      throw new PracticalError(400, 'PRACTICAL_SCORE_DUPLICATE', `Criterion "${id}" was scored twice.`);
    }
    byId.set(id, raw);
  }
  if (byId.size !== rubric.length) {
    throw new PracticalError(400, 'PRACTICAL_SCORES_INCOMPLETE', 'Score every rubric criterion exactly once.');
  }

  return rubric.map((criterion) => {
    const raw = byId.get(criterion.id) as Record<string, unknown> | undefined;
    if (!raw) {
      throw new PracticalError(400, 'PRACTICAL_SCORES_INCOMPLETE', `Criterion "${criterion.label}" was not scored.`);
    }
    const points = Number(raw.points);
    if (!Number.isInteger(points) || points < 0 || points > criterion.maxPoints) {
      throw new PracticalError(
        400,
        'PRACTICAL_SCORE_OUT_OF_RANGE',
        `"${criterion.label}" must score a whole number between 0 and ${criterion.maxPoints}.`,
      );
    }
    const comment = asText(raw.comment, 1_000, `The comment for "${criterion.label}"`);
    return { criterionId: criterion.id, points, comment };
  });
}

export interface PracticalGradeInput {
  scores: PracticalRubricScore[];
  feedback: string;
}

/** Validate a reviewer payload against the submission's frozen rubric. */
export function normalizePracticalGradeInput(
  rubric: PracticalRubricCriterion[],
  value: unknown,
): PracticalGradeInput {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    scores: normalizePracticalScores(rubric, raw.scores),
    feedback: asText(raw.feedback, PRACTICAL_MAX_FEEDBACK, 'The feedback'),
  };
}

/**
 * The only practical pass/fail authority. Malformed input fails closed through
 * passesTopicQuiz; callers cannot supply a percentage.
 */
export function scorePracticalSubmission(
  rubric: PracticalRubricCriterion[],
  scores: PracticalRubricScore[],
  passPercent: number,
): PracticalScoreResult {
  const possiblePoints = rubric.reduce((sum, criterion) => sum + criterion.maxPoints, 0);
  const earnedPoints = scores.reduce((sum, score) => sum + score.points, 0);
  const passed = passesTopicQuiz(earnedPoints, possiblePoints, passPercent);
  return {
    earnedPoints,
    possiblePoints,
    percentage: displayPercent(earnedPoints, possiblePoints),
    passed,
    threshold: passPercent,
  };
}

export function normalizePracticalEvidence(value: unknown): PracticalEvidenceInput {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    submissionText: asText(raw.submissionText, PRACTICAL_MAX_TEXT, 'The written submission'),
    mediaUrl: asHttpUrl(raw.mediaUrl),
    mediaNote: asText(raw.mediaNote, PRACTICAL_MAX_NOTE, 'The media note'),
  };
}

function assertPracticalEvidencePresent(evidence: PracticalEvidenceInput): void {
  if (!evidence.submissionText && !evidence.mediaUrl) {
    throw new PracticalError(
      400,
      'PRACTICAL_EVIDENCE_REQUIRED',
      'Add your written work or an https link to the media you produced before submitting.',
    );
  }
}

export function practicalAssessmentView(row: AssessmentRow): PracticalAssessmentView {
  return {
    id: row.id,
    topicId: row.topic_id,
    title: row.title,
    briefMarkdown: row.brief_markdown,
    submissionInstructions: row.submission_instructions,
    rubric: row.rubric ?? [],
    passPercent: Number(row.pass_percent ?? PRACTICAL_PASS_PERCENT),
    maxAttempts: Number(row.max_attempts ?? 3),
    active: row.active === true,
  };
}

function numeric(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function practicalSubmissionView(row: SubmissionRow): PracticalSubmissionView {
  return {
    id: row.id,
    attemptNumber: Number(row.attempt_number ?? 1),
    status: row.status,
    submissionText: row.submission_text ?? '',
    mediaUrl: row.media_url ?? '',
    mediaNote: row.media_note ?? '',
    submittedAt: row.submitted_at,
    gradedAt: row.graded_at,
    earnedPoints: row.earned_points === null ? null : Number(row.earned_points),
    possiblePoints: row.possible_points === null ? null : Number(row.possible_points),
    percentage: numeric(row.percentage),
    passed: row.passed,
    feedback: row.feedback ?? '',
    rubricScores: row.rubric_scores ?? [],
    rubricSnapshot: row.rubric_snapshot ?? [],
  };
}

interface PracticalTopic {
  topic_id: string;
  course_id: string;
  title: string;
  published: boolean;
  prerequisites: string[];
}

/**
 * True when the topic's course is open for audited pilot delivery. Mirrors the
 * quiz path: the exception replaces the publication precondition only, and is
 * inert in production.
 */
async function isPilotCourse(db: Db, courseId: string): Promise<boolean> {
  const pilotCourses = await loadActivePilotCourseIds(db);
  return pilotCourses.has(courseId);
}

async function loadPracticalTopic(db: Db, topicId: string): Promise<PracticalTopic | null> {
  const { data, error } = await db
    .from('film_topics')
    .select('topic_id, course_id, title, published, prerequisites')
    .eq('topic_id', topicId)
    .maybeSingle();
  if (error) {
    console.error('[film/practical] topic lookup failed', error);
    throw new PracticalError(500, 'PRACTICAL_TOPIC_LOAD_FAILED', 'Could not load the topic.');
  }
  return (data as PracticalTopic | null) ?? null;
}

/**
 * The practical is available once the topic is published and every prerequisite
 * is mastered. Unlike the quiz, an open hold on THIS topic does not block the
 * practical — that hold is usually the practical requirement itself. The quiz
 * pool requirement is irrelevant to practical work, so it is deliberately not
 * checked here; the mastery ledger still requires the quiz separately.
 */
async function assertTopicOpenForPractical(
  db: Db,
  learner: LearnerIdentity,
  topicId: string,
): Promise<PracticalTopic> {
  const topic = await loadPracticalTopic(db, topicId);
  if (!topic) throw new PracticalError(404, 'TOPIC_NOT_FOUND', 'Topic not found.');
  if (!topic.published && !(await isPilotCourse(db, topic.course_id))) {
    throw new PracticalError(409, 'TOPIC_NOT_PUBLISHED', 'This topic has not completed academic publication review.');
  }

  const prerequisites = topic.prerequisites ?? [];
  if (prerequisites.length > 0) {
    const [masteryRes, holdsRes] = await Promise.all([
      db
        .from('film_topic_mastery')
        .select('topic_id, state, passed_at')
        .eq('enrollment_id', learner.enrollmentId)
        .in('topic_id', prerequisites),
      db
        .from('film_mastery_holds')
        .select('topic_id')
        .eq('enrollment_id', learner.enrollmentId)
        .eq('status', 'open')
        .in('topic_id', prerequisites),
    ]);
    if (masteryRes.error || holdsRes.error) {
      console.error('[film/practical] prerequisite lookup failed', masteryRes.error ?? holdsRes.error);
      throw new PracticalError(500, 'PRACTICAL_PREREQ_LOAD_FAILED', 'Could not check the topic prerequisites.');
    }
    const mastered = new Map(
      ((masteryRes.data ?? []) as Array<{ topic_id: string; state: string; passed_at: string | null }>).map((row) => [
        row.topic_id,
        row,
      ]),
    );
    const openHolds = new Set(
      ((holdsRes.data ?? []) as Array<{ topic_id: string }>).map((row) => row.topic_id),
    );
    for (const prerequisite of prerequisites) {
      const row = mastered.get(prerequisite);
      const complete = (row?.state === 'MASTERED' || row?.passed_at != null) && !openHolds.has(prerequisite);
      if (!complete) {
        throw new PracticalError(
          409,
          'PREREQUISITE_INCOMPLETE',
          'Pass every required earlier topic at 85% or higher before opening this practical.',
        );
      }
    }
  }

  return topic;
}

async function loadAssessmentByTopic(db: Db, topicId: string): Promise<AssessmentRow | null> {
  const { data, error } = await db
    .from('film_practical_assessments')
    .select('*')
    .eq('topic_id', topicId)
    .maybeSingle();
  if (error) {
    console.error('[film/practical] assessment lookup failed', error);
    throw new PracticalError(500, 'PRACTICAL_LOAD_FAILED', 'Could not load the practical assessment.');
  }
  return (data as AssessmentRow | null) ?? null;
}

async function loadSubmissions(db: Db, enrollmentId: string, topicId: string): Promise<SubmissionRow[]> {
  const { data, error } = await db
    .from('film_practical_submissions')
    .select('*')
    .eq('enrollment_id', enrollmentId)
    .eq('topic_id', topicId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[film/practical] submission lookup failed', error);
    throw new PracticalError(500, 'PRACTICAL_LOAD_FAILED', 'Could not load your practical submissions.');
  }
  return (data ?? []) as SubmissionRow[];
}

function eligibilityFor(
  assessment: AssessmentRow | null,
  submissions: SubmissionRow[],
  topicOpenReason: string | null,
): PracticalEligibility {
  const graded = submissions.filter((row) => row.status === 'graded');
  const passed = graded.some((row) => row.passed === true);
  const inReview = submissions.some((row) => row.status === 'submitted');
  const draft = submissions.find((row) => row.status === 'draft') ?? null;
  const attemptsUsed = submissions.filter((row) => row.status !== 'draft').length;
  const maxAttempts = Number(assessment?.max_attempts ?? 0);

  let reason: string | null = null;
  if (!assessment) reason = 'No practical assessment is set for this topic yet.';
  else if (!assessment.active) reason = 'The practical assessment is not open yet.';
  else if (passed) reason = 'You have already passed this practical.';
  else if (inReview) reason = 'Your submission is with a reviewer. You can submit again if it is returned.';
  else if (attemptsUsed >= maxAttempts) reason = `All ${maxAttempts} practical attempts have been used. Contact the academy for review.`;
  else if (topicOpenReason) reason = topicOpenReason;

  const canSubmit =
    !!assessment &&
    assessment.active &&
    !passed &&
    !inReview &&
    (maxAttempts === 0 || attemptsUsed < maxAttempts) &&
    !topicOpenReason;

  return {
    canSubmit,
    reason,
    attemptsUsed,
    maxAttempts,
    passed,
    inReview,
    draftSubmissionId: draft?.id ?? null,
  };
}

/**
 * The learner's own practical state. History is returned even after the
 * assessment is deactivated, so a grade and feedback never disappear.
 */
export async function loadPracticalForLearner(
  db: Db,
  learner: LearnerIdentity,
  topicId: string,
): Promise<LearnerPracticalView> {
  const topic = await loadPracticalTopic(db, topicId);
  if (!topic) throw new PracticalError(404, 'TOPIC_NOT_FOUND', 'Topic not found.');

  const [assessment, submissions] = await Promise.all([
    loadAssessmentByTopic(db, topicId),
    loadSubmissions(db, learner.enrollmentId, topicId),
  ]);

  let topicOpenReason: string | null = null;
  const pilotCourse = topic.published ? false : await isPilotCourse(db, topic.course_id);
  if (!topic.published && !pilotCourse) {
    topicOpenReason = 'This topic has not completed academic publication review.';
  } else if (assessment?.active && topic.prerequisites.length > 0) {
    try {
      await assertTopicOpenForPractical(db, learner, topicId);
    } catch (error) {
      if (error instanceof PracticalError && error.code === 'PREREQUISITE_INCOMPLETE') {
        topicOpenReason = error.message;
      } else {
        throw error;
      }
    }
  }

  return {
    topicId,
    topicTitle: topic.title,
    // A draft assessment stays hidden until it is opened; once a learner has
    // history, the brief remains visible so their grade stays explainable.
    assessment:
      topic.published && assessment && (assessment.active || submissions.length > 0)
        ? practicalAssessmentView(assessment)
        : null,
    submissions: submissions.map(practicalSubmissionView),
    eligibility: eligibilityFor(topic.published ? assessment : null, submissions, topicOpenReason),
  };
}

async function activeAssessment(db: Db, topicId: string): Promise<AssessmentRow> {
  const assessment = await loadAssessmentByTopic(db, topicId);
  if (!assessment || !assessment.active) {
    throw new PracticalError(409, 'PRACTICAL_UNAVAILABLE', 'This topic has no open practical assessment.');
  }
  return assessment;
}

async function loadOwnedSubmission(
  db: Db,
  learner: LearnerIdentity,
  submissionId: string,
  topicId?: string,
): Promise<SubmissionRow> {
  let query = db
    .from('film_practical_submissions')
    .select('*')
    .eq('id', submissionId)
    .eq('enrollment_id', learner.enrollmentId);
  if (topicId) query = query.eq('topic_id', topicId);
  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error('[film/practical] submission read failed', error);
    throw new PracticalError(500, 'PRACTICAL_LOAD_FAILED', 'Could not load the submission.');
  }
  if (!data) {
    throw new PracticalError(404, 'PRACTICAL_SUBMISSION_NOT_FOUND', 'Practical submission not found.');
  }
  return data as SubmissionRow;
}

/**
 * Create or update the one editable draft. A repeat save is idempotent; a new
 * attempt starts only after a graded failure, and only while attempts remain.
 */
export async function savePracticalDraft(
  db: Db,
  learner: LearnerIdentity,
  topicId: string,
  value: unknown,
): Promise<PracticalSubmissionView> {
  await assertTopicOpenForPractical(db, learner, topicId);
  const assessment = await activeAssessment(db, topicId);
  const evidence = normalizePracticalEvidence(value);
  const evidenceColumns = {
    submission_text: evidence.submissionText,
    media_url: evidence.mediaUrl,
    media_note: evidence.mediaNote,
  };
  const submissions = await loadSubmissions(db, learner.enrollmentId, topicId);

  if (submissions.some((row) => row.status === 'graded' && row.passed === true)) {
    throw new PracticalError(409, 'PRACTICAL_ALREADY_PASSED', 'You have already passed this practical.');
  }
  if (submissions.some((row) => row.status === 'submitted')) {
    throw new PracticalError(409, 'PRACTICAL_IN_REVIEW', 'Your previous submission is still with a reviewer.');
  }
  const draft = submissions.find((row) => row.status === 'draft');
  const now = new Date().toISOString();

  if (draft) {
    const { data, error } = await db
      .from('film_practical_submissions')
      .update({ ...evidenceColumns, updated_at: now })
      .eq('id', draft.id)
      .eq('enrollment_id', learner.enrollmentId)
      .eq('status', 'draft')
      .select('*')
      .maybeSingle();
    if (error) {
      console.error('[film/practical] draft update failed', error);
      throw new PracticalError(500, 'PRACTICAL_SAVE_FAILED', 'Could not save your draft.');
    }
    if (data) return practicalSubmissionView(data as SubmissionRow);
    // A concurrent submit won the race: return the committed row instead of
    // overwriting evidence that is already under review.
    return practicalSubmissionView(await loadOwnedSubmission(db, learner, draft.id, topicId));
  }

  const attemptsUsed = submissions.filter((row) => row.status !== 'draft').length;
  const maxAttempts = Number(assessment.max_attempts ?? 3);
  if (attemptsUsed >= maxAttempts) {
    throw new PracticalError(
      409,
      'PRACTICAL_ATTEMPTS_EXHAUSTED',
      `All ${maxAttempts} practical attempts have been used. Contact the academy for review.`,
    );
  }

  const { data, error } = await db
    .from('film_practical_submissions')
    .insert({
      assessment_id: assessment.id,
      enrollment_id: learner.enrollmentId,
      user_id: learner.userId,
      topic_id: topicId,
      attempt_number: attemptsUsed + 1,
      status: 'draft',
      ...evidenceColumns,
      pass_threshold: Number(assessment.pass_percent ?? PRACTICAL_PASS_PERCENT),
      updated_at: now,
    })
    .select('*')
    .maybeSingle();

  if (error) {
    if (isDuplicate(error)) {
      const raced = (await loadSubmissions(db, learner.enrollmentId, topicId)).find(
        (row) => row.status === 'draft',
      );
      if (raced) return practicalSubmissionView(raced);
    }
    console.error('[film/practical] draft insert failed', error);
    throw new PracticalError(500, 'PRACTICAL_SAVE_FAILED', 'Could not start your practical submission.');
  }
  return practicalSubmissionView(data as SubmissionRow);
}

/**
 * Freeze the rubric snapshot and hand the work to review. A replayed submit is
 * idempotent: the same committed row is returned, never a second attempt.
 */
export async function submitPracticalSubmission(
  db: Db,
  learner: LearnerIdentity,
  topicId: string,
  submissionId: string,
): Promise<PracticalSubmissionView> {
  await assertTopicOpenForPractical(db, learner, topicId);
  const submission = await loadOwnedSubmission(db, learner, submissionId, topicId);
  if (submission.status !== 'draft') return practicalSubmissionView(submission);

  const assessment = await activeAssessment(db, topicId);
  if (submission.assessment_id !== assessment.id) {
    throw new PracticalError(409, 'PRACTICAL_ASSESSMENT_CHANGED', 'This draft belongs to an older assessment. Start a new submission.');
  }
  assertPracticalEvidencePresent(normalizePracticalEvidence({
    submissionText: submission.submission_text,
    mediaUrl: submission.media_url,
    mediaNote: submission.media_note,
  }));

  const { data: passing } = await db
    .from('film_practical_submissions')
    .select('id')
    .eq('enrollment_id', learner.enrollmentId)
    .eq('topic_id', topicId)
    .eq('status', 'graded')
    .eq('passed', true)
    .maybeSingle();
  if (passing) {
    throw new PracticalError(409, 'PRACTICAL_ALREADY_PASSED', 'You have already passed this practical.');
  }

  const now = new Date().toISOString();
  const { data, error } = await db
    .from('film_practical_submissions')
    .update({
      status: 'submitted',
      submitted_at: now,
      rubric_snapshot: assessment.rubric ?? [],
      pass_threshold: Number(assessment.pass_percent ?? PRACTICAL_PASS_PERCENT),
      updated_at: now,
    })
    .eq('id', submissionId)
    .eq('enrollment_id', learner.enrollmentId)
    .eq('status', 'draft')
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('[film/practical] submit failed', error);
    throw new PracticalError(500, 'PRACTICAL_SUBMIT_FAILED', 'Could not submit your practical. Please try again.');
  }
  const committed = data
    ? (data as SubmissionRow)
    : await loadOwnedSubmission(db, learner, submissionId, topicId);

  await db.from('film_mastery_events').upsert(
    {
      user_id: learner.userId,
      enrollment_id: learner.enrollmentId,
      topic_id: topicId,
      event_type: 'PRACTICAL_SUBMITTED',
      dedupe_key: `practical:${submissionId}:submitted`,
      payload: { submissionId, assessmentId: assessment.id, attemptNumber: committed.attempt_number },
    },
    { onConflict: 'dedupe_key', ignoreDuplicates: true },
  ).then(({ error: eventError }) => {
    if (eventError) console.error('[film/practical] submit event failed', eventError);
  });

  await db.from('film_academic_audit').insert({
    actor_id: learner.userId,
    actor_role: 'learner',
    action: 'FILM_PRACTICAL_SUBMITTED',
    target_type: 'film_practical_submission',
    target_id: submissionId,
    before: { status: 'draft' },
    after: {
      status: 'submitted',
      topicId,
      attemptNumber: committed.attempt_number,
      hasText: Boolean(committed.submission_text),
      hasMediaUrl: Boolean(committed.media_url),
      passThreshold: Number(committed.pass_threshold),
    },
    reason: 'Learner submitted practical work for review.',
  }).then(({ error: auditError }) => {
    if (auditError) console.error('[film/practical] submit audit failed', auditError);
  });

  return practicalSubmissionView(committed);
}

/**
 * Called by the quiz finalizer when a pass is being reconciled. If the topic
 * has an active practical and this learner has not passed it, ensure one open
 * PRACTICAL_PENDING hold. Returns whether a practical gate is (now) open.
 *
 * Idempotent: the partial unique index permits one open workflow hold per
 * learner/topic, and a concurrent insert is treated as success.
 */
export async function ensurePracticalPendingHold(
  db: Db,
  learner: LearnerIdentity,
  topicId: string,
): Promise<boolean> {
  const { data: assessmentData, error: assessmentError } = await db
    .from('film_practical_assessments')
    .select('id, title, active')
    .eq('topic_id', topicId)
    .eq('active', true)
    .maybeSingle();
  if (assessmentError) {
    console.error('[film/practical] practical gate lookup failed', assessmentError);
    throw new Error('Could not evaluate the practical requirement.');
  }
  const assessment = assessmentData as { id: string; title: string } | null;
  if (!assessment) return false;

  const { data: passing } = await db
    .from('film_practical_submissions')
    .select('id')
    .eq('enrollment_id', learner.enrollmentId)
    .eq('topic_id', topicId)
    .eq('status', 'graded')
    .eq('passed', true)
    .maybeSingle();
  if (passing) return false;

  const { data: openHolds, error: holdError } = await db
    .from('film_mastery_holds')
    .select('id, hold_type')
    .eq('enrollment_id', learner.enrollmentId)
    .eq('topic_id', topicId)
    .eq('status', 'open')
    .eq('source', 'practical_assessment');
  if (holdError) {
    console.error('[film/practical] practical hold lookup failed', holdError);
    throw new Error('Could not evaluate the practical hold.');
  }
  if ((openHolds ?? []).length > 0) return true;

  const { error } = await db.from('film_mastery_holds').insert({
    enrollment_id: learner.enrollmentId,
    topic_id: topicId,
    hold_type: 'PRACTICAL_PENDING',
    reason: `Complete the practical assessment "${assessment.title}" before this topic can be mastered.`,
    status: 'open',
    source: 'practical_assessment',
    source_ref: assessment.id,
  });
  if (error && !isDuplicate(error)) {
    console.error('[film/practical] practical hold insert failed', error);
    throw new Error('Could not record the practical requirement.');
  }
  return true;
}

/** Restores MASTERED only when the quiz was passed and no hold remains. */
export async function restoreMasteryIfClear(
  db: Db,
  learner: LearnerIdentity,
  topicId: string,
  now: string,
): Promise<string | null> {
  const { count: remaining } = await db
    .from('film_mastery_holds')
    .select('id', { count: 'exact', head: true })
    .eq('enrollment_id', learner.enrollmentId)
    .eq('topic_id', topicId)
    .eq('status', 'open');
  if ((remaining ?? 0) > 0) return null;

  const { data } = await db
    .from('film_topic_mastery')
    .select('state, passed_at, mastered_at')
    .eq('enrollment_id', learner.enrollmentId)
    .eq('topic_id', topicId)
    .maybeSingle();
  const row = data as { state?: string; passed_at?: string | null; mastered_at?: string | null } | null;
  if (!row?.passed_at) return row?.state ?? null;

  await db
    .from('film_topic_mastery')
    .update({ state: 'MASTERED', mastered_at: row.mastered_at ?? now, updated_at: now })
    .eq('enrollment_id', learner.enrollmentId)
    .eq('topic_id', topicId);
  return 'MASTERED';
}

/**
 * Apply a grade outcome to the hold ledger. A pass clears only workflow-owned
 * holds; a fail converts the pending hold into PRACTICAL_FAILED and caps a
 * MASTERED row at PASSED. Manual holds are never touched.
 */
export async function applyPracticalGradeToHolds(
  db: Db,
  actorId: string | null,
  learner: LearnerIdentity,
  topicId: string,
  assessment: { id: string; title: string },
  passed: boolean,
  feedback: string,
): Promise<string | null> {
  const now = new Date().toISOString();
  const { data: openHolds, error } = await db
    .from('film_mastery_holds')
    .select('id')
    .eq('enrollment_id', learner.enrollmentId)
    .eq('topic_id', topicId)
    .eq('status', 'open')
    .eq('source', 'practical_assessment');
  if (error) {
    console.error('[film/practical] grade hold lookup failed', error);
    throw new PracticalError(500, 'PRACTICAL_HOLD_FAILED', 'The grade was saved, but the hold could not be updated.');
  }
  const ids = ((openHolds ?? []) as Array<{ id: string }>).map((row) => row.id);

  if (passed) {
    if (ids.length > 0) {
      const { error: clearError } = await db
        .from('film_mastery_holds')
        .update({
          status: 'cleared',
          cleared_by: actorId,
          cleared_at: now,
          clearance_note: 'Practical assessment passed.',
        })
        .in('id', ids);
      if (clearError) {
        console.error('[film/practical] hold clear failed', clearError);
        throw new PracticalError(500, 'PRACTICAL_HOLD_FAILED', 'The grade was saved, but the hold could not be cleared.');
      }
    }
    return restoreMasteryIfClear(db, learner, topicId, now);
  }

  const reason = `Practical assessment "${assessment.title}" was not passed. ${feedback}`.trim();
  if (ids.length > 0) {
    const { error: updateError } = await db
      .from('film_mastery_holds')
      .update({ hold_type: 'PRACTICAL_FAILED', reason, created_by: actorId, source_ref: assessment.id })
      .in('id', ids);
    if (updateError) {
      console.error('[film/practical] hold update failed', updateError);
      throw new PracticalError(500, 'PRACTICAL_HOLD_FAILED', 'The grade was saved, but the hold could not be updated.');
    }
  } else {
    const { error: insertError } = await db.from('film_mastery_holds').insert({
      enrollment_id: learner.enrollmentId,
      topic_id: topicId,
      hold_type: 'PRACTICAL_FAILED',
      reason,
      status: 'open',
      created_by: actorId,
      source: 'practical_assessment',
      source_ref: assessment.id,
    });
    if (insertError && !isDuplicate(insertError)) {
      console.error('[film/practical] hold insert failed', insertError);
      throw new PracticalError(500, 'PRACTICAL_HOLD_FAILED', 'The grade was saved, but the hold could not be recorded.');
    }
  }

  const { data: mastery } = await db
    .from('film_topic_mastery')
    .select('state, passed_at')
    .eq('enrollment_id', learner.enrollmentId)
    .eq('topic_id', topicId)
    .maybeSingle();
  const row = mastery as { state?: string; passed_at?: string | null } | null;
  if (row?.state === 'MASTERED' && row.passed_at) {
    await db
      .from('film_topic_mastery')
      .update({ state: 'PASSED', updated_at: now })
      .eq('enrollment_id', learner.enrollmentId)
      .eq('topic_id', topicId);
    return 'PASSED';
  }
  return row?.state ?? null;
}
