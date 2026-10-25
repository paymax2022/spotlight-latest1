// The server-authoritative exam attempt lifecycle (§7.5).
//
// Invariants enforced here (not in the client):
//   - eligibility = an enrolled learner + a published exam for THEIR programme
//     + within the attempt limit;
//   - the DRAW is from APPROVED bank items only, snapshotted immutably at start;
//   - the DEADLINE is the server clock; a save after expiry is refused;
//   - submission finalizes AT MOST ONCE (guarded state transition + idempotency),
//     and a duplicate submit returns the same committed receipt;
//   - the learner DTO never carries the answer key.

import { createAdminClient } from '@/lib/supabase/server';
import { presentQuestion, scoreAttempt } from './scoring';
import { drawApproved, keysForItems, type DrawnItem } from './bank';
import type { PresentedQuestion, SnapshotItem } from './types';

type Db = ReturnType<typeof createAdminClient>;

export interface ExamRow {
  id: string;
  program_id: string;
  title: string;
  description: string | null;
  kind: string;
  pass_mark: number;
  time_limit_minutes: number;
  max_attempts: number;
  is_published: boolean;
  /** The exam is reachable from opens_at (inclusive) to closes_at (exclusive). NULL = unbounded on that side. */
  opens_at: string | null;
  closes_at: string | null;
  draw_stage: string | null;
  draw_module_codes: string[] | null;
  draw_count: number | null;
}

export interface LearnerRef {
  enrollmentId: string;
  programId: string | null;
  batchId: string | null;
}

export type ExamBlocker =
  | { ok: true }
  | { ok: false; code: string; message: string };

export interface StartedAttempt {
  attemptId: string;
  state: 'in_progress';
  startedAt: string;
  deadlineAt: string;
  questionCount: number;
  questions: PresentedQuestion[];
}

export class ExamError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** An exam outside its start/end window is not reachable, whatever else is true. */
export function examWindowBlocker(exam: Pick<ExamRow, 'opens_at' | 'closes_at'>, now: Date = new Date()): ExamBlocker {
  const t = now.getTime();
  if (exam.opens_at && t < new Date(exam.opens_at).getTime()) {
    return { ok: false, code: 'EXAM_NOT_OPEN_YET', message: `This exam opens on ${new Date(exam.opens_at).toUTCString()}.` };
  }
  if (exam.closes_at && t >= new Date(exam.closes_at).getTime()) {
    return { ok: false, code: 'EXAM_CLOSED', message: 'This exam has closed.' };
  }
  return { ok: true };
}

/** Why a learner cannot take this exam right now — specific and human-readable. */
export async function examEligibility(
  db: Db,
  exam: ExamRow,
  learner: LearnerRef,
): Promise<ExamBlocker> {
  if (!exam.is_published) return { ok: false, code: 'EXAM_UNPUBLISHED', message: 'This exam is not open yet.' };
  const inWindow = examWindowBlocker(exam);
  if (!inWindow.ok) return inWindow;
  if (!learner.programId || exam.program_id !== learner.programId) {
    return { ok: false, code: 'NOT_FOR_YOUR_PROGRAMME', message: 'This exam is not part of your programme.' };
  }
  if (!exam.draw_stage) {
    return { ok: false, code: 'EXAM_MISCONFIGURED', message: 'This exam has no content stage set. Contact your instructor.' };
  }
  const used = await attemptCount(db, exam.id, learner.enrollmentId);
  if (used >= exam.max_attempts) {
    return { ok: false, code: 'ATTEMPT_LIMIT_REACHED', message: `You have used all ${exam.max_attempts} attempts for this exam.` };
  }
  return { ok: true };
}

async function attemptCount(db: Db, examId: string, enrollmentId: string): Promise<number> {
  const { count } = await db
    .from('academy_exam_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('exam_id', examId)
    .eq('enrollment_id', enrollmentId);
  return count ?? 0;
}

/** A learner's exam list — published exams for THEIR programme, each with how
 * many attempts remain and whether it can be started. No draw config, no keys;
 * the eligibility code mirrors examEligibility so the list never offers a button
 * that the start endpoint would refuse. */
export interface LearnerExamSummary {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  passMark: number;
  timeLimitMinutes: number;
  maxAttempts: number;
  attemptsUsed: number;
  /** ISO timestamps bounding when the exam can be started; null = unbounded. */
  opensAt: string | null;
  closesAt: string | null;
  canStart: boolean;
  blockerCode: string | null;
  blockerMessage: string | null;
}

export async function listLearnerExams(db: Db, learner: LearnerRef): Promise<LearnerExamSummary[]> {
  if (!learner.programId) return [];
  const { data, error } = await db
    .from('academy_exams')
    .select('id, program_id, title, description, kind, pass_mark, time_limit_minutes, max_attempts, is_published, opens_at, closes_at, draw_stage, draw_module_codes, draw_count')
    .eq('program_id', learner.programId)
    .eq('is_published', true)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('[film/assessment] exam list failed', error);
    throw new Error('Could not load your exams');
  }

  const exams = (data ?? []) as unknown as ExamRow[];
  const out: LearnerExamSummary[] = [];
  for (const exam of exams) {
    const used = await attemptCount(db, exam.id, learner.enrollmentId);
    const gate = await examEligibilityFromCount(db, exam, learner, used);
    out.push({
      id: exam.id,
      title: exam.title,
      description: exam.description,
      kind: exam.kind,
      passMark: exam.pass_mark,
      timeLimitMinutes: exam.time_limit_minutes,
      maxAttempts: exam.max_attempts,
      attemptsUsed: used,
      opensAt: exam.opens_at,
      closesAt: exam.closes_at,
      canStart: gate.ok,
      blockerCode: gate.ok ? null : gate.code,
      blockerMessage: gate.ok ? null : gate.message,
    });
  }
  return out;
}

/** The eligibility rules minus the attempt-count query the list already ran. */
async function examEligibilityFromCount(
  db: Db,
  exam: ExamRow,
  learner: LearnerRef,
  used: number,
): Promise<ExamBlocker> {
  const inWindow = examWindowBlocker(exam);
  if (!inWindow.ok) return inWindow;
  if (!learner.programId || exam.program_id !== learner.programId) {
    return { ok: false, code: 'NOT_FOR_YOUR_PROGRAMME', message: 'This exam is not part of your programme.' };
  }
  if (!exam.draw_stage) {
    return { ok: false, code: 'EXAM_MISCONFIGURED', message: 'This exam has no content stage set. Contact your instructor.' };
  }
  if (used >= exam.max_attempts) {
    return { ok: false, code: 'ATTEMPT_LIMIT_REACHED', message: `You have used all ${exam.max_attempts} attempts for this exam.` };
  }
  return { ok: true };
}

/**
 * Start an authoritative attempt. Idempotent on the key: a retry (double tap,
 * network resend) returns the SAME attempt rather than drawing a fresh one.
 */
export async function startAttempt(
  db: Db,
  exam: ExamRow,
  learner: LearnerRef,
  userId: string,
  idempotencyKey: string,
): Promise<StartedAttempt> {
  const { data: prior } = await db
    .from('academy_exam_attempts')
    .select('id, item_snapshot, started_at, server_deadline')
    .eq('enrollment_id', learner.enrollmentId)
    .eq('exam_id', exam.id)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (prior) {
    const row = prior as { id: string; item_snapshot: SnapshotItem[]; started_at: string; server_deadline: string };
    return {
      attemptId: row.id,
      state: 'in_progress',
      startedAt: row.started_at,
      deadlineAt: row.server_deadline,
      questionCount: (row.item_snapshot ?? []).length,
      questions: snapshotToQuestions(row.item_snapshot ?? []),
    };
  }

  const items = await drawApproved(db, {
    stage: exam.draw_stage as string,
    moduleCodes: exam.draw_module_codes ?? [],
    count: exam.draw_count ?? 10,
  });
  if (items.length === 0) {
    throw new ExamError(422, 'EXAM_POOL_INSUFFICIENT',
      'This exam cannot be taken until more reviewed questions are available.');
  }

  const snapshot: SnapshotItem[] = [];
  const questions: PresentedQuestion[] = [];
  items.forEach((it, i) => {
    const attemptQuestionId = `${it.id}_q${i + 1}`;
    const points = Math.max(1, Math.round(Number(it.film_points ?? 1)));
    const { presentedOptions, snapshot: snap } = presentQuestion(
      it.id, it.stem, points, it.options, attemptQuestionId, Math.random,
    );
    snapshot.push(snap);
    questions.push({ attemptQuestionId, stem: it.stem, points, options: presentedOptions });
  });

  const now = new Date();
  const deadline = new Date(now.getTime() + exam.time_limit_minutes * 60_000);
  const used = await attemptCount(db, exam.id, learner.enrollmentId);

  const { data: created, error } = await db
    .from('academy_exam_attempts')
    .insert({
      exam_id: exam.id,
      enrollment_id: learner.enrollmentId,
      user_id: userId,
      attempt_number: used + 1,
      attempt_state: 'in_progress',
      status: 'submitted', // legacy enum: an in-progress attempt is 'submitted', not yet 'graded'
      started_at: now.toISOString(),
      submitted_at: now.toISOString(), // non-null column; overwritten at finalization
      server_deadline: deadline.toISOString(),
      item_snapshot: snapshot,
      idempotency_key: idempotencyKey,
    })
    .select('id')
    .single();

  // A racing start lost the UNIQUE(idempotency_key) race — read its row back.
  if (error) {
    const { data: raced } = await db
      .from('academy_exam_attempts')
      .select('id, item_snapshot, started_at, server_deadline')
      .eq('enrollment_id', learner.enrollmentId)
      .eq('exam_id', exam.id)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (raced) {
      const row = raced as { id: string; item_snapshot: SnapshotItem[]; started_at: string; server_deadline: string };
      return {
        attemptId: row.id, state: 'in_progress', startedAt: row.started_at,
        deadlineAt: row.server_deadline, questionCount: (row.item_snapshot ?? []).length,
        questions: snapshotToQuestions(row.item_snapshot ?? []),
      };
    }
    console.error('[film/assessment] attempt insert failed', error);
    throw new ExamError(500, 'ATTEMPT_START_FAILED', 'Could not start the exam. Please try again.');
  }

  return {
    attemptId: (created as { id: string }).id,
    state: 'in_progress',
    startedAt: now.toISOString(),
    deadlineAt: deadline.toISOString(),
    questionCount: questions.length,
    questions,
  };
}

/** Idempotent autosave. Refuses to change an answer after the server deadline. */
export async function saveResponse(
  db: Db,
  attemptId: string,
  learner: LearnerRef,
  attemptQuestionId: string,
  presentationOptionId: string,
): Promise<{ saved: boolean; revision: number; savedAt: string }> {
  const attempt = await loadOwnedAttempt(db, attemptId, learner.enrollmentId);
  if (attempt.attempt_state !== 'in_progress') {
    throw new ExamError(409, 'ATTEMPT_NOT_EDITABLE', 'This attempt is already finalized.');
  }
  if (new Date(attempt.server_deadline).getTime() < Date.now()) {
    throw new ExamError(409, 'ATTEMPT_EXPIRED', "Time for this attempt has run out; your saved answers stand.");
  }

  const snapshot = (attempt.item_snapshot ?? []) as SnapshotItem[];
  const item = snapshot.find((s) => s.attemptQuestionId === attemptQuestionId);
  if (!item) throw new ExamError(404, 'QUESTION_NOT_IN_ATTEMPT', 'That question is not part of this attempt.');
  if (!(presentationOptionId in item.optionMap)) {
    throw new ExamError(422, 'INVALID_OPTION', 'That option is not valid for this question.');
  }

  const { data: existing } = await db
    .from('academy_exam_attempt_responses')
    .select('id, save_revision')
    .eq('attempt_id', attemptId)
    .eq('question_item_id', item.questionItemId)
    .maybeSingle();

  const savedAt = new Date().toISOString();
  if (existing) {
    const revision = Number((existing as { save_revision: number }).save_revision) + 1;
    const { error } = await db
      .from('academy_exam_attempt_responses')
      .update({ selected_option_id: presentationOptionId, save_revision: revision, saved_at: savedAt })
      .eq('id', (existing as { id: string }).id);
    if (error) throw new ExamError(500, 'SAVE_FAILED', 'Could not save your answer.');
    return { saved: true, revision, savedAt };
  }

  const { error } = await db
    .from('academy_exam_attempt_responses')
    .insert({
      attempt_id: attemptId,
      question_item_id: item.questionItemId,
      selected_option_id: presentationOptionId,
      save_revision: 1,
    });
  if (error) throw new ExamError(500, 'SAVE_FAILED', 'Could not save your answer.');
  return { saved: true, revision: 1, savedAt };
}

export interface SubmitReceipt {
  attemptId: string;
  state: 'scored';
  scorePercent: number;
  earnedPoints: number;
  maxPoints: number;
  passed: boolean;
  answeredCount: number;
  totalCount: number;
}

/**
 * Finalize + score. At-most-once: the score is written by a state-guarded update,
 * so a concurrent duplicate submit either loses the race and re-reads the committed
 * result, or returns the already-scored attempt unchanged (QA-05).
 */
export async function submitAttempt(
  db: Db,
  attemptId: string,
  learner: LearnerRef,
): Promise<SubmitReceipt> {
  const attempt = await loadOwnedAttempt(db, attemptId, learner.enrollmentId);

  if (attempt.attempt_state === 'scored') {
    return receiptFromRow(attempt);
  }

  const snapshot = (attempt.item_snapshot ?? []) as SnapshotItem[];
  const { data: respRows } = await db
    .from('academy_exam_attempt_responses')
    .select('question_item_id, selected_option_id')
    .eq('attempt_id', attemptId);

  const selectedByItem = new Map<string, string>();
  for (const r of (respRows ?? []) as Array<{ question_item_id: string; selected_option_id: string | null }>) {
    if (r.selected_option_id) selectedByItem.set(r.question_item_id, r.selected_option_id);
  }
  const responsesByAqId: Record<string, string | null> = {};
  for (const item of snapshot) {
    responsesByAqId[item.attemptQuestionId] = selectedByItem.get(item.questionItemId) ?? null;
  }

  const keys = await keysForItems(db, snapshot.map((s) => s.questionItemId));
  const score = scoreAttempt(snapshot, responsesByAqId, keys, attempt.passMark);

  const submittedAt = new Date().toISOString();
  // Guard the transition so only the first finalizer writes the grade. The update
  // returns the rows it actually changed: one row means we won the race, zero means
  // a concurrent submit already scored this attempt.
  const { error: updErr, data: updatedRows } = await db
    .from('academy_exam_attempts')
    .update({
      attempt_state: 'scored',
      status: 'graded',
      score: score.earnedPoints,
      total_points: score.maxPoints,
      percentage: score.percentage,
      passed: score.passed,
      submitted_at: submittedAt,
      answers: answersToJson(selectedByItem),
    })
    .eq('id', attemptId)
    .eq('attempt_state', 'in_progress')
    .select('id');

  if (updErr) {
    console.error('[film/assessment] finalize update failed', updErr);
    throw new ExamError(500, 'SUBMIT_FAILED', 'Could not submit your exam. Please try again.');
  }
  // 0 rows means a racing submit already scored it — return the committed receipt.
  if (!updatedRows || updatedRows.length === 0) {
    const fresh = await loadOwnedAttempt(db, attemptId, learner.enrollmentId);
    return receiptFromRow(fresh);
  }

  await applyExamStage(db, learner.enrollmentId, score.passed);

  return {
    attemptId,
    state: 'scored',
    scorePercent: score.percentage,
    earnedPoints: score.earnedPoints,
    maxPoints: score.maxPoints,
    passed: score.passed,
    answeredCount: score.answeredCount,
    totalCount: score.totalCount,
  };
}

interface AttemptRow {
  id: string;
  enrollment_id: string;
  attempt_state: string;
  started_at: string;
  server_deadline: string;
  item_snapshot: SnapshotItem[];
  percentage: number;
  score: number;
  total_points: number;
  passed: boolean;
  passMark: number;
}

async function loadOwnedAttempt(db: Db, attemptId: string, enrollmentId: string): Promise<AttemptRow> {
  const { data } = await db
    .from('academy_exam_attempts')
    .select('id, enrollment_id, attempt_state, started_at, server_deadline, item_snapshot, percentage, score, total_points, passed, exams:academy_exams(pass_mark)')
    .eq('id', attemptId)
    .maybeSingle();
  if (!data) throw new ExamError(404, 'NOT_FOUND', 'Attempt not found.');
  const row = data as unknown as AttemptRow & { exams?: { pass_mark?: number } | null };
  // Object-level access: an attempt is addressable only by its owning enrolment.
  if (row.enrollment_id !== enrollmentId) {
    throw new ExamError(404, 'NOT_FOUND', 'Attempt not found.');
  }
  return { ...row, passMark: Number(row.exams?.pass_mark ?? 70) };
}

function receiptFromRow(row: AttemptRow): SubmitReceipt {
  const total = (row.item_snapshot ?? []).length;
  return {
    attemptId: row.id,
    state: 'scored',
    scorePercent: Number(row.percentage),
    earnedPoints: Number(row.score),
    maxPoints: Number(row.total_points),
    passed: row.passed === true,
    // A committed receipt does not re-read the response rows; the totals the
    // server wrote at scoring time are the authoritative counts.
    answeredCount: total,
    totalCount: total,
  };
}

/** Reflect the outcome on the enrolment stage — but ONLY for a learner the academy
 * has already placed on the exam track (exam_eligible / exam_taken). The .in() guard
 * means an 'enrolled' learner who simply took a practice/checkpoint is never regressed
 * to 'exam_failed'; their result lives on the attempt row, not the linear stage. */
async function applyExamStage(db: Db, enrollmentId: string, passed: boolean): Promise<void> {
  const now = new Date().toISOString();
  await db
    .from('academy_enrollments')
    .update({
      current_stage: passed ? 'exam_passed' : 'exam_failed',
      exam_passed_at: passed ? now : null,
    })
    .eq('id', enrollmentId)
    .in('current_stage', ['exam_eligible', 'exam_taken', 'exam_passed', 'exam_failed', 'online_completed']);
}

function answersToJson(selectedByItem: Map<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [itemId, option] of selectedByItem) out[itemId] = option;
  return out;
}

/** Rebuild the learner-facing questions from the immutable snapshot (no key). */
function snapshotToQuestions(snapshot: SnapshotItem[]): PresentedQuestion[] {
  return snapshot.map((s) => ({
    attemptQuestionId: s.attemptQuestionId,
    stem: s.stem,
    points: s.points,
    options: s.options,
  }));
}

export async function loadPublishedExam(db: Db, examId: string): Promise<ExamRow | null> {
  const { data } = await db
    .from('academy_exams')
    .select('id, program_id, title, description, kind, pass_mark, time_limit_minutes, max_attempts, is_published, opens_at, closes_at, draw_stage, draw_module_codes, draw_count')
    .eq('id', examId)
    .maybeSingle();
  return (data as unknown as ExamRow | null) ?? null;
}

/** The learner's own view of one attempt: replayable questions + what is already
 * answered, or the committed result once scored. Never exposes the answer key or
 * which presentation option was correct — only the learner's own selection id. */
export interface AttemptView {
  attemptId: string;
  state: string;
  startedAt: string | null;
  deadlineAt: string | null;
  expired: boolean;
  questions: PresentedQuestion[];
  /** attemptQuestionId -> the presentationOptionId the learner last saved. */
  answered: Record<string, string>;
  result: SubmitReceipt | null;
}

export async function readAttempt(
  db: Db,
  attemptId: string,
  learner: LearnerRef,
): Promise<AttemptView> {
  const attempt = await loadOwnedAttempt(db, attemptId, learner.enrollmentId);
  const snapshot = attempt.item_snapshot ?? [];

  const { data: respRows } = await db
    .from('academy_exam_attempt_responses')
    .select('question_item_id, selected_option_id')
    .eq('attempt_id', attemptId);

  // Map bank item id -> presentation id, then surface the learner's own selection.
  const aqByItem = new Map(snapshot.map((s) => [s.questionItemId, s.attemptQuestionId]));
  const answered: Record<string, string> = {};
  for (const r of (respRows ?? []) as Array<{ question_item_id: string; selected_option_id: string | null }>) {
    const aq = aqByItem.get(r.question_item_id);
    if (aq && r.selected_option_id) answered[aq] = r.selected_option_id;
  }

  const scored = attempt.attempt_state === 'scored';
  return {
    attemptId: attempt.id,
    state: attempt.attempt_state,
    startedAt: attempt.started_at,
    deadlineAt: attempt.server_deadline,
    expired: !scored && new Date(attempt.server_deadline).getTime() < Date.now(),
    // The learner always sees their OWN picked option and the stems — never which
    // option was correct. Per-item correctness is not part of this slice's result.
    questions: snapshotToQuestions(snapshot),
    answered,
    result: scored ? receiptFromRow(attempt) : null,
  };
}
