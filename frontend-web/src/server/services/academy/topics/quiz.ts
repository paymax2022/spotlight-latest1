// Server-authoritative topic quizzes (TMFA). This is the only place a topic
// score is computed and the only writer of film_topic_mastery.
//
// Invariants:
//   - draw only APPROVED items for this exact topic, snapshot immutably;
//   - the deadline is the server clock; no save is accepted after it;
//   - pass/fail uses exact integer arithmetic (`earned * 100 >= max * 85`),
//     never a rounded percentage;
//   - finalization is guarded and at-most-once, and a retried submit reconciles
//     mastery idempotently;
//   - the learner DTO never carries the answer key, only stems, shuffled option
//     texts and the learner's own saved selections;
//   - mastery is written by the server, and an open hold downgrades a pass from
//     MASTERED to PASSED so the next topic stays locked until the hold clears.

import { createAdminClient } from '@/lib/supabase/server';
import { keysForItems } from '../assessment/bank';
import { presentQuestion, scoreAttempt, shuffle } from '../assessment/scoring';
import type { FilmQuestionOption, PresentedQuestion, SnapshotItem } from '../assessment/types';
import { loadTopicPath, type LearnerIdentity, type TopicPathItem } from './progress';
import {
  buildTopicQuizResult,
  type TopicLearnerState,
  type TopicQuizResult,
} from './types';

type Db = ReturnType<typeof createAdminClient>;

interface TopicConfigRow {
  topic_id: string;
  course_id: string;
  title: string;
  lesson_markdown: string;
  content_status: string;
  quiz_minimum_percent: number;
  quiz_draw_count: number;
  quiz_time_limit_minutes: number;
  prerequisites: string[];
  order_index: number;
  published: boolean;
}

interface TopicQuestionRow {
  id: string;
  film_objective_id: string | null;
  film_points: number | string | null;
  stem: string;
  options: FilmQuestionOption[];
}

/** The topic draw adds the objective ID to the shared immutable snapshot. */
export interface TopicSnapshotItem extends SnapshotItem {
  objectiveId: string | null;
}

export interface TopicPresentedQuestion extends PresentedQuestion {
  objectiveId: string | null;
}

export interface ObjectiveBreakdown {
  objectiveId: string;
  earnedPoints: number;
  possiblePoints: number;
  percentage: number;
}

export interface TopicAttemptRow {
  id: string;
  enrollment_id: string;
  topic_id: string;
  attempt_number: number;
  attempt_state: 'in_progress' | 'scored' | 'voided';
  pass_threshold: number;
  item_snapshot: TopicSnapshotItem[];
  started_at: string;
  server_deadline: string;
  submitted_at: string | null;
  earned_points: number | null;
  max_points: number | null;
  percentage: number | string | null;
  passed: boolean | null;
  objective_breakdown: ObjectiveBreakdown[] | null;
  idempotency_key: string;
}

export interface TopicQuizReceipt extends TopicQuizResult {
  attemptId: string;
  topicId: string;
  state: 'scored';
  answeredCount: number;
  totalCount: number;
  objectives: ObjectiveBreakdown[];
  masteryState: TopicLearnerState;
  nextTopic: {
    topicId: string;
    title: string;
    state: TopicLearnerState;
    canStartQuiz: boolean;
  } | null;
}

export interface TopicAttemptView {
  attemptId: string;
  topicId: string;
  attemptNumber: number;
  state: TopicAttemptRow['attempt_state'];
  startedAt: string;
  deadlineAt: string;
  expired: boolean;
  questions: TopicPresentedQuestion[];
  /** attemptQuestionId -> the presentation option the learner last saved. */
  answered: Record<string, string>;
  result: TopicQuizReceipt | null;
}

export class TopicQuizError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function numeric(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function usableOptions(options: unknown): options is FilmQuestionOption[] {
  if (!Array.isArray(options) || options.length < 2) return false;
  const ids = new Set<string>();
  const texts = new Set<string>();
  return options.every((o) => {
    if (!o || typeof o.id !== 'string' || typeof o.text !== 'string') return false;
    const text = o.text.trim();
    if (!o.id || !text) return false;
    if (ids.has(o.id) || texts.has(text.toLowerCase())) return false;
    ids.add(o.id);
    texts.add(text.toLowerCase());
    return true;
  });
}

function snapshotQuestions(snapshot: TopicSnapshotItem[]): TopicPresentedQuestion[] {
  return snapshot.map((s) => ({
    attemptQuestionId: s.attemptQuestionId,
    stem: s.stem,
    points: s.points,
    options: s.options,
    objectiveId: s.objectiveId ?? null,
  }));
}

function responsesByAttemptQuestion(
  snapshot: TopicSnapshotItem[],
  rows: Array<{ question_item_id: string; selected_option_id: string | null }>,
): Record<string, string | null> {
  const selectedByItem = new Map<string, string>();
  for (const row of rows) {
    if (row.selected_option_id) selectedByItem.set(row.question_item_id, row.selected_option_id);
  }
  const out: Record<string, string | null> = {};
  for (const item of snapshot) {
    out[item.attemptQuestionId] = selectedByItem.get(item.questionItemId) ?? null;
  }
  return out;
}

function objectiveBreakdown(
  snapshot: TopicSnapshotItem[],
  responses: Record<string, string | null>,
  keys: Array<{ questionItemId: string; correctOptionIds: string[] }>,
): ObjectiveBreakdown[] {
  const keyByItem = new Map(keys.map((k) => [k.questionItemId, new Set(k.correctOptionIds)]));
  const totals = new Map<string, { earned: number; possible: number }>();

  for (const item of snapshot) {
    const objectiveId = item.objectiveId || 'unmapped';
    const row = totals.get(objectiveId) ?? { earned: 0, possible: 0 };
    row.possible += item.points;
    const selected = responses[item.attemptQuestionId];
    if (selected) {
      const bankId = item.optionMap[selected];
      if (bankId && keyByItem.get(item.questionItemId)?.has(bankId)) row.earned += item.points;
    }
    totals.set(objectiveId, row);
  }

  return Array.from(totals.entries()).map(([objectiveId, row]) => ({
    objectiveId,
    earnedPoints: row.earned,
    possiblePoints: row.possible,
    percentage: row.possible > 0 ? Math.round((row.earned * 10000) / row.possible) / 100 : 0,
  }));
}

async function loadTopicConfig(db: Db, topicId: string): Promise<TopicConfigRow | null> {
  const { data, error } = await db
    .from('film_topics')
    .select(
      'topic_id, course_id, title, lesson_markdown, content_status, quiz_minimum_percent, quiz_draw_count, quiz_time_limit_minutes, prerequisites, order_index, published',
    )
    .eq('topic_id', topicId)
    .maybeSingle();
  if (error) throw new TopicQuizError(500, 'TOPIC_LOAD_FAILED', 'Could not load the topic.');
  return (data as unknown as TopicConfigRow | null) ?? null;
}

async function loadOwnedAttempt(
  db: Db,
  attemptId: string,
  enrollmentId: string,
): Promise<TopicAttemptRow> {
  const { data, error } = await db
    .from('film_topic_attempts')
    .select(
      'id, enrollment_id, topic_id, attempt_number, attempt_state, pass_threshold, item_snapshot, started_at, server_deadline, submitted_at, earned_points, max_points, percentage, passed, objective_breakdown, idempotency_key',
    )
    .eq('id', attemptId)
    .maybeSingle();
  if (error) throw new TopicQuizError(500, 'ATTEMPT_LOAD_FAILED', 'Could not load the attempt.');
  if (!data) throw new TopicQuizError(404, 'ATTEMPT_NOT_FOUND', 'Attempt not found.');
  const row = data as unknown as TopicAttemptRow;
  // Object-level access: an attempt is addressable only by its owning enrolment.
  if (row.enrollment_id !== enrollmentId) {
    throw new TopicQuizError(404, 'ATTEMPT_NOT_FOUND', 'Attempt not found.');
  }
  return row;
}

async function loadOpenAttempt(
  db: Db,
  learner: LearnerIdentity,
  topicId: string,
): Promise<TopicAttemptRow | null> {
  const { data, error } = await db
    .from('film_topic_attempts')
    .select(
      'id, enrollment_id, topic_id, attempt_number, attempt_state, pass_threshold, item_snapshot, started_at, server_deadline, submitted_at, earned_points, max_points, percentage, passed, objective_breakdown, idempotency_key',
    )
    .eq('enrollment_id', learner.enrollmentId)
    .eq('topic_id', topicId)
    .eq('attempt_state', 'in_progress')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new TopicQuizError(500, 'ATTEMPT_LOAD_FAILED', 'Could not check for an open attempt.');
  return (data as unknown as TopicAttemptRow | null) ?? null;
}

async function loadAttemptByKey(
  db: Db,
  learner: LearnerIdentity,
  topicId: string,
  idempotencyKey: string,
): Promise<TopicAttemptRow | null> {
  const { data } = await db
    .from('film_topic_attempts')
    .select(
      'id, enrollment_id, topic_id, attempt_number, attempt_state, pass_threshold, item_snapshot, started_at, server_deadline, submitted_at, earned_points, max_points, percentage, passed, objective_breakdown, idempotency_key',
    )
    .eq('enrollment_id', learner.enrollmentId)
    .eq('topic_id', topicId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  return (data as unknown as TopicAttemptRow | null) ?? null;
}

async function attemptCount(db: Db, learner: LearnerIdentity, topicId: string): Promise<number> {
  const { count } = await db
    .from('film_topic_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('enrollment_id', learner.enrollmentId)
    .eq('topic_id', topicId);
  return count ?? 0;
}

function pathItem(path: Awaited<ReturnType<typeof loadTopicPath>>, topicId: string): TopicPathItem | null {
  return path.courses.flatMap((c) => c.topics).find((t) => t.topicId === topicId) ?? null;
}

function nextTopicInCourse(
  path: Awaited<ReturnType<typeof loadTopicPath>>,
  topicId: string,
): TopicPathItem | null {
  const course = path.courses.find((c) => c.topics.some((t) => t.topicId === topicId));
  if (!course) return null;
  const index = course.topics.findIndex((t) => t.topicId === topicId);
  return index >= 0 ? course.topics[index + 1] ?? null : null;
}

async function buildReceipt(
  db: Db,
  learner: LearnerIdentity,
  attempt: TopicAttemptRow,
): Promise<TopicQuizReceipt> {
  const snapshot = attempt.item_snapshot ?? [];
  const [path, masteryRes, answeredRes] = await Promise.all([
    loadTopicPath(db, learner),
    db
      .from('film_topic_mastery')
      .select('state')
      .eq('enrollment_id', learner.enrollmentId)
      .eq('topic_id', attempt.topic_id)
      .maybeSingle(),
    db
      .from('film_topic_attempt_responses')
      .select('id', { count: 'exact', head: true })
      .eq('attempt_id', attempt.id)
      .not('selected_option_id', 'is', null),
  ]);

  const item = pathItem(path, attempt.topic_id);
  const next = nextTopicInCourse(path, attempt.topic_id);
  const masteryState = (item?.state ??
    (masteryRes.data as { state?: TopicLearnerState } | null)?.state ??
    (attempt.passed ? 'PASSED' : 'REMEDIATION_REQUIRED')) as TopicLearnerState;

  return {
    attemptId: attempt.id,
    topicId: attempt.topic_id,
    state: 'scored',
    earnedPoints: Number(attempt.earned_points ?? 0),
    possiblePoints: Number(attempt.max_points ?? 0),
    percentage: numeric(attempt.percentage),
    passed: attempt.passed === true,
    threshold: Number(attempt.pass_threshold ?? 85),
    answeredCount: answeredRes.count ?? 0,
    totalCount: snapshot.length,
    objectives: Array.isArray(attempt.objective_breakdown) ? attempt.objective_breakdown : [],
    masteryState,
    nextTopic: next
      ? {
          topicId: next.topicId,
          title: next.title,
          state: next.state,
          canStartQuiz: next.canStartQuiz,
        }
      : null,
  };
}

/**
 * Fold one scored attempt into the mastery ledger. Idempotent per attempt:
 * retrying a submit reconciles the same row instead of double-counting attempts
 * or moving a passed learner backwards.
 */
async function reconcileMastery(
  db: Db,
  learner: LearnerIdentity,
  attempt: TopicAttemptRow,
): Promise<void> {
  if (attempt.attempt_state !== 'scored') return;

  const { data: existingData } = await db
    .from('film_topic_mastery')
    .select(
      'state, best_score, best_attempt_id, last_attempt_id, attempts_count, passed_at, mastered_at, last_attempt_at',
    )
    .eq('enrollment_id', learner.enrollmentId)
    .eq('topic_id', attempt.topic_id)
    .maybeSingle();

  const existing = existingData as
    | {
        state: string;
        best_score: number | string | null;
        best_attempt_id: string | null;
        last_attempt_id: string | null;
        attempts_count: number;
        passed_at: string | null;
        mastered_at: string | null;
        last_attempt_at: string | null;
      }
    | null;

  const { count: openHoldCount } = await db
    .from('film_mastery_holds')
    .select('id', { count: 'exact', head: true })
    .eq('enrollment_id', learner.enrollmentId)
    .eq('topic_id', attempt.topic_id)
    .eq('status', 'open');
  const hasOpenHold = (openHoldCount ?? 0) > 0;

  const passed = attempt.passed === true;
  const alreadyPassed =
    existing?.passed_at != null || existing?.state === 'PASSED' || existing?.state === 'MASTERED';
  const state: TopicLearnerState = passed || alreadyPassed
    ? hasOpenHold
      ? 'PASSED'
      : 'MASTERED'
    : 'REMEDIATION_REQUIRED';

  const attemptPercentage = numeric(attempt.percentage);
  const previousBest = existing?.best_score != null ? numeric(existing.best_score) : null;
  const bestScore = previousBest == null ? attemptPercentage : Math.max(previousBest, attemptPercentage);
  const bestAttemptId =
    previousBest == null || attemptPercentage > previousBest
      ? attempt.id
      : existing?.best_attempt_id ?? attempt.id;

  const isNewAttempt = existing?.last_attempt_id !== attempt.id;
  const submittedAt = attempt.submitted_at ?? new Date().toISOString();

  const payload = {
    enrollment_id: learner.enrollmentId,
    user_id: learner.userId,
    topic_id: attempt.topic_id,
    state,
    best_score: bestScore,
    best_attempt_id: bestAttemptId,
    last_attempt_id: attempt.id,
    attempts_count: Number(existing?.attempts_count ?? 0) + (isNewAttempt ? 1 : 0),
    passed_at: existing?.passed_at ?? (passed || alreadyPassed ? submittedAt : null),
    mastered_at:
      existing?.mastered_at ?? (state === 'MASTERED' ? submittedAt : null),
    last_attempt_at: isNewAttempt ? submittedAt : existing?.last_attempt_at ?? submittedAt,
    updated_at: new Date().toISOString(),
  };

  const { error } = await db
    .from('film_topic_mastery')
    .upsert(payload, { onConflict: 'enrollment_id,topic_id' });
  if (error) {
    console.error('[film/topics] mastery upsert failed', error);
    throw new TopicQuizError(
      500,
      'MASTERY_WRITE_FAILED',
      'Your score was saved, but progression could not be updated. Please submit again.',
    );
  }

  await db.from('film_mastery_events').upsert(
    {
      user_id: learner.userId,
      enrollment_id: learner.enrollmentId,
      topic_id: attempt.topic_id,
      event_type: passed ? 'TOPIC_QUIZ_PASSED' : 'TOPIC_QUIZ_FAILED',
      dedupe_key: `topic-quiz:${attempt.id}:scored`,
      payload: {
        attemptId: attempt.id,
        earnedPoints: Number(attempt.earned_points ?? 0),
        possiblePoints: Number(attempt.max_points ?? 0),
        percentage: attemptPercentage,
        passed,
        threshold: Number(attempt.pass_threshold ?? 85),
        masteryState: state,
        bestScore,
      },
    },
    { onConflict: 'dedupe_key', ignoreDuplicates: true },
  );
}

/**
 * Start or resume a topic attempt. Resume precedence:
 *   1. the same idempotency key (network retry) returns the exact same attempt;
 *   2. an already-open attempt is returned rather than drawing a second form;
 *   3. otherwise the server checks publication, prerequisites, holds and pool,
 *      draws the form, snapshots it and starts the clock.
 */
export async function startTopicAttempt(
  db: Db,
  learner: LearnerIdentity,
  topicId: string,
  idempotencyKey: string,
): Promise<TopicAttemptView> {
  const topic = await loadTopicConfig(db, topicId);
  if (!topic) throw new TopicQuizError(404, 'TOPIC_NOT_FOUND', 'Topic not found.');
  if (!topic.published) {
    throw new TopicQuizError(
      403,
      'TOPIC_NOT_PUBLISHED',
      'This topic has not completed academic publication review.',
    );
  }

  const path = await loadTopicPath(db, learner);
  const gate = pathItem(path, topicId);
  if (!gate) throw new TopicQuizError(404, 'TOPIC_NOT_FOUND', 'Topic not found.');
  if (gate.state === 'MASTERED' || gate.state === 'PASSED') {
    throw new TopicQuizError(
      409,
      'TOPIC_ALREADY_PASSED',
      'You have already passed this topic quiz; the next topic is governed by the sequential path.',
    );
  }
  if (!gate.canStartQuiz) {
    throw new TopicQuizError(
      403,
      gate.blockerCode ?? 'QUIZ_NOT_AVAILABLE',
      gate.blockerMessage ?? 'This topic quiz is not available yet.',
    );
  }

  const prior = await loadAttemptByKey(db, learner, topicId, idempotencyKey);
  if (prior) return readAttemptRow(db, learner, prior);

  const open = await loadOpenAttempt(db, learner, topicId);
  if (open) return readAttemptRow(db, learner, open);

  const { data: questionData, error: questionError } = await db
    .from('academy_question_items')
    .select('id, film_objective_id, film_points, stem, options')
    .eq('academy_scope', 'film')
    .eq('film_topic_id', topicId)
    .eq('status', 'approved');
  if (questionError) {
    console.error('[film/topics] question draw failed', questionError);
    throw new TopicQuizError(500, 'DRAW_FAILED', 'Could not prepare the quiz. Please try again.');
  }

  const rows = (questionData ?? []) as unknown as TopicQuestionRow[];
  const drawCount = Math.max(1, Number(topic.quiz_draw_count ?? 10));
  const usable = rows.filter((row) => usableOptions(row.options));
  if (usable.length < drawCount) {
    throw new TopicQuizError(
      422,
      'QUIZ_POOL_INSUFFICIENT',
      'This topic quiz cannot run until reviewed questions are available.',
    );
  }

  const draw = shuffle(usable, Math.random).slice(0, drawCount);

  const snapshot: TopicSnapshotItem[] = [];
  for (let i = 0; i < draw.length; i += 1) {
    const row = draw[i];
    const points = Math.max(1, Math.round(Number(row.film_points ?? 1)));
    const attemptQuestionId = `${row.id}_q${i + 1}`;
    const { snapshot: item } = presentQuestion(
      row.id,
      row.stem,
      points,
      row.options,
      attemptQuestionId,
      Math.random,
    );
    snapshot.push({ ...item, objectiveId: row.film_objective_id });
  }

  const now = new Date();
  const deadline = new Date(now.getTime() + Math.max(1, Number(topic.quiz_time_limit_minutes ?? 20)) * 60_000);
  const threshold = Math.max(85, Number(topic.quiz_minimum_percent ?? 85));
  const used = await attemptCount(db, learner, topicId);

  const { data: created, error: insertError } = await db
    .from('film_topic_attempts')
    .insert({
      enrollment_id: learner.enrollmentId,
      user_id: learner.userId,
      topic_id: topicId,
      attempt_number: used + 1,
      attempt_state: 'in_progress',
      pass_threshold: threshold,
      item_snapshot: snapshot,
      started_at: now.toISOString(),
      server_deadline: deadline.toISOString(),
      idempotency_key: idempotencyKey,
    })
    .select(
      'id, enrollment_id, topic_id, attempt_number, attempt_state, pass_threshold, item_snapshot, started_at, server_deadline, submitted_at, earned_points, max_points, percentage, passed, objective_breakdown, idempotency_key',
    )
    .single();

  if (insertError || !created) {
    // A racing start lost the scoped UNIQUE key race — read its row back.
    const raced = await loadAttemptByKey(db, learner, topicId, idempotencyKey);
    if (raced) return readAttemptRow(db, learner, raced);
    console.error('[film/topics] attempt insert failed', insertError);
    throw new TopicQuizError(500, 'ATTEMPT_START_FAILED', 'Could not start the quiz. Please try again.');
  }

  await db.from('film_mastery_events').upsert(
    {
      user_id: learner.userId,
      enrollment_id: learner.enrollmentId,
      topic_id: topicId,
      event_type: 'TOPIC_QUIZ_STARTED',
      dedupe_key: `topic-quiz:${(created as { id: string }).id}:started`,
      payload: { attemptId: (created as { id: string }).id, questionCount: snapshot.length, threshold },
    },
    { onConflict: 'dedupe_key', ignoreDuplicates: true },
  );

  return readAttemptRow(db, learner, created as unknown as TopicAttemptRow);
}

/** Autosave one answer. The server, not the client, owns the deadline. */
export async function saveTopicAnswer(
  db: Db,
  learner: LearnerIdentity,
  attemptId: string,
  attemptQuestionId: string,
  presentationOptionId: string,
): Promise<{ saved: boolean; revision: number; savedAt: string }> {
  const attempt = await loadOwnedAttempt(db, attemptId, learner.enrollmentId);
  if (attempt.attempt_state !== 'in_progress') {
    throw new TopicQuizError(409, 'ATTEMPT_NOT_EDITABLE', 'This attempt is already finalized.');
  }
  if (new Date(attempt.server_deadline).getTime() <= Date.now()) {
    throw new TopicQuizError(
      409,
      'ATTEMPT_EXPIRED',
      'Time for this attempt has run out; your saved answers stand.',
    );
  }

  const item = (attempt.item_snapshot ?? []).find(
    (entry) => entry.attemptQuestionId === attemptQuestionId,
  );
  if (!item) {
    throw new TopicQuizError(404, 'QUESTION_NOT_IN_ATTEMPT', 'That question is not part of this attempt.');
  }
  if (!(presentationOptionId in item.optionMap)) {
    throw new TopicQuizError(422, 'INVALID_OPTION', 'That option is not valid for this question.');
  }

  const { data: existing } = await db
    .from('film_topic_attempt_responses')
    .select('id, save_revision')
    .eq('attempt_id', attemptId)
    .eq('question_item_id', item.questionItemId)
    .maybeSingle();

  const savedAt = new Date().toISOString();
  if (existing) {
    const revision = Number((existing as { save_revision: number }).save_revision) + 1;
    const { error } = await db
      .from('film_topic_attempt_responses')
      .update({ selected_option_id: presentationOptionId, save_revision: revision, saved_at: savedAt })
      .eq('id', (existing as { id: string }).id);
    if (error) throw new TopicQuizError(500, 'SAVE_FAILED', 'Could not save your answer.');
    return { saved: true, revision, savedAt };
  }

  const { error } = await db.from('film_topic_attempt_responses').insert({
    attempt_id: attemptId,
    question_item_id: item.questionItemId,
    selected_option_id: presentationOptionId,
    save_revision: 1,
  });
  if (error) throw new TopicQuizError(500, 'SAVE_FAILED', 'Could not save your answer.');
  return { saved: true, revision: 1, savedAt };
}

/**
 * Submit + finalize. The score is computed from the immutable snapshot and the
 * server-held answer keys; the learner's client never supplies correctness.
 */
export async function submitTopicAttempt(
  db: Db,
  learner: LearnerIdentity,
  attemptId: string,
): Promise<TopicQuizReceipt> {
  const attempt = await loadOwnedAttempt(db, attemptId, learner.enrollmentId);

  if (attempt.attempt_state === 'scored') {
    await reconcileMastery(db, learner, attempt);
    return buildReceipt(db, learner, attempt);
  }
  if (attempt.attempt_state !== 'in_progress') {
    throw new TopicQuizError(409, 'ATTEMPT_NOT_EDITABLE', 'This attempt can no longer be submitted.');
  }

  const snapshot = attempt.item_snapshot ?? [];
  const { data: responseRows, error: responseError } = await db
    .from('film_topic_attempt_responses')
    .select('question_item_id, selected_option_id')
    .eq('attempt_id', attemptId);
  if (responseError) {
    throw new TopicQuizError(500, 'SUBMIT_FAILED', 'Could not read your saved answers.');
  }

  const responses = responsesByAttemptQuestion(
    snapshot,
    (responseRows ?? []) as Array<{ question_item_id: string; selected_option_id: string | null }>,
  );
  const keys = await keysForItems(db, snapshot.map((s) => s.questionItemId));
  const score = scoreAttempt(snapshot, responses, keys, attempt.pass_threshold);
  const breakdown = objectiveBreakdown(snapshot, responses, keys);
  const submittedAt = new Date().toISOString();

  // State-guarded finalization: only the first submit writes the grade. A
  // concurrent duplicate gets 0 updated rows and reconciles the committed score.
  const { error: updateError, data: updatedRows } = await db
    .from('film_topic_attempts')
    .update({
      attempt_state: 'scored',
      submitted_at: submittedAt,
      earned_points: score.earnedPoints,
      max_points: score.maxPoints,
      percentage: score.percentage,
      passed: score.passed,
      objective_breakdown: breakdown,
    })
    .eq('id', attemptId)
    .eq('attempt_state', 'in_progress')
    .select('id');

  if (updateError) {
    console.error('[film/topics] finalize update failed', updateError);
    throw new TopicQuizError(500, 'SUBMIT_FAILED', 'Could not submit the quiz. Please try again.');
  }

  if (!updatedRows || updatedRows.length === 0) {
    const fresh = await loadOwnedAttempt(db, attemptId, learner.enrollmentId);
    await reconcileMastery(db, learner, fresh);
    return buildReceipt(db, learner, fresh);
  }

  const scored: TopicAttemptRow = {
    ...attempt,
    attempt_state: 'scored',
    submitted_at: submittedAt,
    earned_points: score.earnedPoints,
    max_points: score.maxPoints,
    percentage: score.percentage,
    passed: score.passed,
    objective_breakdown: breakdown,
  };

  await reconcileMastery(db, learner, scored);

  await db
    .from('film_academic_audit')
    .insert({
      actor_id: learner.userId,
      actor_role: 'learner',
      action: 'TOPIC_QUIZ_SUBMITTED',
      target_type: 'film_topic_attempt',
      target_id: attemptId,
      before: { state: 'in_progress' },
      after: {
        state: 'scored',
        topicId: attempt.topic_id,
        earnedPoints: score.earnedPoints,
        possiblePoints: score.maxPoints,
        percentage: score.percentage,
        passed: score.passed,
        threshold: attempt.pass_threshold,
      },
      reason: 'Learner submitted a topic quiz; score computed server-side.',
    })
    .then(({ error }) => {
      if (error) console.error('[film/topics] audit insert failed', error);
    });

  return buildReceipt(db, learner, scored);
}

async function readAttemptRow(
  db: Db,
  learner: LearnerIdentity,
  attempt: TopicAttemptRow,
): Promise<TopicAttemptView> {
  const snapshot = attempt.item_snapshot ?? [];
  const { data: responseRows } = await db
    .from('film_topic_attempt_responses')
    .select('question_item_id, selected_option_id')
    .eq('attempt_id', attempt.id);

  const selectedByItem = new Map<string, string>();
  for (const row of (responseRows ?? []) as Array<{
    question_item_id: string;
    selected_option_id: string | null;
  }>) {
    if (row.selected_option_id) selectedByItem.set(row.question_item_id, row.selected_option_id);
  }
  const answered: Record<string, string> = {};
  for (const item of snapshot) {
    const selected = selectedByItem.get(item.questionItemId);
    if (selected) answered[item.attemptQuestionId] = selected;
  }

  const scored = attempt.attempt_state === 'scored';
  return {
    attemptId: attempt.id,
    topicId: attempt.topic_id,
    attemptNumber: Number(attempt.attempt_number ?? 1),
    state: attempt.attempt_state,
    startedAt: attempt.started_at,
    deadlineAt: attempt.server_deadline,
    expired: !scored && new Date(attempt.server_deadline).getTime() <= Date.now(),
    questions: snapshotQuestions(snapshot),
    answered,
    result: scored ? await buildReceipt(db, learner, attempt) : null,
  };
}

/** Resumable learner view of one attempt. Never opens the answer key. */
export async function readTopicAttempt(
  db: Db,
  learner: LearnerIdentity,
  attemptId: string,
): Promise<TopicAttemptView> {
  const attempt = await loadOwnedAttempt(db, attemptId, learner.enrollmentId);
  return readAttemptRow(db, learner, attempt);
}

/** Strict result reader used by the mobile result screen after submission. */
export async function readTopicResult(
  db: Db,
  learner: LearnerIdentity,
  attemptId: string,
): Promise<TopicQuizReceipt> {
  const attempt = await loadOwnedAttempt(db, attemptId, learner.enrollmentId);
  if (attempt.attempt_state !== 'scored') {
    throw new TopicQuizError(409, 'ATTEMPT_NOT_SCORED', 'This attempt has not been submitted yet.');
  }
  await reconcileMastery(db, learner, attempt);
  return buildReceipt(db, learner, attempt);
}

/**
 * Build a display-only result from an explicit list of points. Exposed so tests
 * and admin previews can verify the exact 85% rule without a database.
 */
export function previewTopicResult(earnedPoints: number, possiblePoints: number, threshold = 85) {
  return buildTopicQuizResult(earnedPoints, possiblePoints, threshold);
}
