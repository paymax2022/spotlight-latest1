// ── CBT exam live-response adapters (Go exam API → mobile) ───────────────────
// The Go exam engine (begin → serve questions → submit → server-side grade)
// returns snake_case shapes; the CBT simulator codes against ExamAttempt /
// ExamResult. These pure adapters bridge them so the live branch matches the mock
// shape. Grading is server-authoritative — the client never sees the answer key
// and never grades locally on the live path.

import type { ExamAttempt, ExamResult, Question } from './types';

// ── Go wire shapes ───────────────────────────────────────────────────────────

export interface GoExamAttempt {
  id: string;
  arena_id?: string | null;
  blueprint_id: string;
  state: string;
  started_at?: string | null;
  server_deadline?: string | null;
  offline_origin?: boolean;
}

export interface GoExamSubjectScore {
  subject: string; // subject id
  raw: number; // correct count
  total: number;
  scaled: number; // 0..100
  grade?: string;
}

export interface GoExamScore {
  overall: number; // 0..100
  grade?: string;
  late?: boolean;
  subjects?: GoExamSubjectScore[];
}

/** The scored attempt returned by POST …/submit (score/readiness on the attempt). */
export interface GoScoredAttempt extends GoExamAttempt {
  score?: GoExamScore;
  readiness?: number | null;
}

/** The projection returned by GET …/result (flattened score fields). */
export interface GoExamResultProjection extends GoExamScore {
  readiness?: number | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Seconds between two RFC3339 timestamps; 0 when either is missing/invalid. */
function durationSeconds(start?: string | null, end?: string | null): number {
  if (!start || !end) return 0;
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (Number.isNaN(s) || Number.isNaN(e)) return 0;
  return Math.max(0, Math.round((e - s) / 1000));
}

/** Points for an exam completion — client-side display, mirrors the mock scale
 *  (100% ⇒ 300). Actual crediting is idempotent via the attempt id. */
export function examPoints(scorePct: number): number {
  return Math.round(Math.max(0, Math.min(100, scorePct)) * 3);
}

// ── Adapters ─────────────────────────────────────────────────────────────────

/**
 * Compose a client ExamAttempt from the Go attempt row + the separately-served
 * question set. Timer is derived from the server deadline (authoritative); the
 * client countdown is advisory.
 */
export function adaptStartedAttempt(
  go: GoExamAttempt,
  questions: Question[],
  opts?: { calculatorAllowed?: boolean },
): ExamAttempt {
  const duration = durationSeconds(go.started_at, go.server_deadline);
  return {
    id: go.id,
    arenaId: go.arena_id ?? '',
    blueprintId: go.blueprint_id,
    status: 'in_progress',
    startedAt: go.started_at ?? new Date(0).toISOString(),
    durationSec: duration,
    remainingSec: duration,
    questions,
    answers: {},
    flagged: [],
    calculatorAllowed: opts?.calculatorAllowed ?? true,
    offlineOrigin: !!go.offline_origin,
  };
}

/**
 * Build the Go submit body from the local working copy: one response per served
 * question (selected wrapped as {value} to match the grader), preserving flags.
 * Unanswered questions submit an empty selection so the server counts them.
 */
export function toExamSubmit(attempt: Pick<ExamAttempt, 'questions' | 'answers' | 'flagged'>) {
  const flagged = new Set(attempt.flagged ?? []);
  return {
    responses: attempt.questions.map((q) => ({
      question_item_id: q.id,
      selected: { value: attempt.answers[q.id] ?? [] },
      flagged: flagged.has(q.id),
    })),
    integrity: {},
  };
}

/**
 * Adapt a Go score projection → mobile ExamResult. `answered` + `timeSpentSec`
 * come from the local working copy (the server doesn't echo them). subjectName
 * falls back to the subject id when no name map is supplied.
 */
export function adaptExamResult(
  attemptId: string,
  score: GoExamScore,
  readiness: number | null | undefined,
  local: { questions: Question[]; answers: Record<string, string[]>; durationSec: number; remainingSec: number },
  subjectNames?: Map<string, string>,
): ExamResult {
  const subs = score.subjects ?? [];
  const correct = subs.reduce((n, s) => n + (s.raw ?? 0), 0);
  const totalFromSubjects = subs.reduce((n, s) => n + (s.total ?? 0), 0);
  const totalQuestions = totalFromSubjects || local.questions.length;
  const answered = local.questions.filter((q) => (local.answers[q.id] ?? []).length > 0).length;
  const scorePct = Math.round(score.overall ?? 0);
  return {
    attemptId,
    scorePct,
    totalQuestions,
    correct,
    unanswered: Math.max(0, totalQuestions - answered),
    timeSpentSec: Math.max(0, local.durationSec - local.remainingSec),
    subjects: subs.map((s) => ({
      subjectId: s.subject,
      subjectName: subjectNames?.get(s.subject) ?? s.subject,
      correct: s.raw ?? 0,
      total: s.total ?? 0,
      scorePct: Math.round(s.scaled ?? 0),
    })),
    readinessDelta: scorePct >= 50 ? 3 : 1,
    pointsEarned: examPoints(scorePct),
  };
}
