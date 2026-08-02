// ── Practice / quiz live-response adapters (Go assessment API → mobile) ───────
// The Go assessment engine serves approved question items and grades submissions
// SERVER-SIDE (GET /api/finance/academy/practice, POST …/practice/submit). The
// read strips the answer key; the submit result carries the per-question review.
// These pure adapters bridge the snake_case Go shapes to the camelCase mobile
// Question / PracticeResult / PracticeSubmission so the live branch (USE_MOCK=
// false) matches the mock shape exactly, keeping the practice screen unchanged.

import type { Question, QuestionType, PracticeResult, MasteryState } from './types';

// ── Go wire shapes ───────────────────────────────────────────────────────────

export interface GoQuestionItem {
  id: string;
  type: string;
  stem: string;
  options: unknown; // jsonb array; approved items seed [{id,text}]
  objective_id?: string | null;
  subject_id?: string | null;
  // answer is stripped on the /practice read; never trusted client-side.
}

export interface GoPracticeReview {
  question_item_id: string;
  stem: string;
  correct: boolean;
  correct_answer: unknown; // canonical answer, e.g. ["b"] (revealed post-submit)
  explanation?: string;
}

export interface GoPracticeResult {
  objective_id: string;
  scored: number;
  correct: number;
  score: number; // 0..1
  from_state: string;
  to_state: string;
  upgraded: boolean;
  breakdown?: GoPracticeReview[];
}

/** One answer the learner submitted (mobile PracticeSubmission.answers item). */
export interface MobileAnswer {
  questionId: string;
  selected: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const QUESTION_TYPES: QuestionType[] = ['mcq', 'multi', 'true_false'];
function mapType(t?: string): QuestionType {
  return QUESTION_TYPES.includes(t as QuestionType) ? (t as QuestionType) : 'mcq';
}

/** Coerce a jsonb options array into the mobile {id,text}[] shape, dropping malformed entries. */
function adaptOptions(raw: unknown): { id: string; text: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((o) => {
      const opt = o as { id?: unknown; text?: unknown };
      return { id: String(opt?.id ?? ''), text: String(opt?.text ?? '') };
    })
    .filter((o) => o.id !== '');
}

/** Normalise a canonical answer (scalar or array) into a string[] of option ids. */
function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (v === null || v === undefined) return [];
  return [String(v)];
}

/**
 * Map a Go MasteryState → the mobile MasteryState. The backend ladder is
 * not_started → in_progress → practiced → mastered → exam_ready; the mobile UI
 * has a coarser scale (learning/proficient), so in_progress→learning,
 * practiced→proficient and exam_ready collapses into mastered.
 */
export function mapMasteryState(s?: string): MasteryState {
  switch (s) {
    case 'in_progress':
      return 'learning';
    case 'practiced':
      return 'proficient';
    case 'mastered':
    case 'exam_ready':
      return 'mastered';
    default:
      return 'not_started';
  }
}

// ── Adapters ─────────────────────────────────────────────────────────────────

/** Go approved question item → mobile Question. correct/explanation stay empty:
 *  grading is server-authoritative and the answer key is revealed only in the
 *  post-submission result, never on this read. */
export function adaptPracticeItem(go: GoQuestionItem): Question {
  return {
    id: go.id,
    objectiveId: go.objective_id ?? undefined,
    subjectId: go.subject_id ?? undefined,
    type: mapType(go.type),
    stem: go.stem,
    options: adaptOptions(go.options),
    correct: [],
    explanation: '',
  };
}

export function adaptPracticeItems(rows: GoQuestionItem[] | undefined): Question[] {
  return (rows ?? []).map(adaptPracticeItem);
}

/** Build the Go submit body from the objective + the learner's selections.
 *  selected.value is the array of chosen option ids, matching the seeded answer
 *  key shape (["b"]) so assessment.isCorrect grades it correctly. */
export function toPracticeSubmit(objectiveId: string | undefined, answers: MobileAnswer[]) {
  return {
    objective_id: objectiveId ?? '',
    answers: answers.map((a) => ({
      question_item_id: a.questionId,
      selected: { value: a.selected },
    })),
  };
}

/**
 * Go practice result → mobile PracticeResult. Points are a client-side display
 * (server tracks mastery, not points): mirror the mock's 10-per-correct + 20
 * mastery bonus so live and offline award identically. The breakdown joins the
 * server review (correctness + canonical answer + explanation) with the learner's
 * own selection for the worked-explanations screen.
 */
export function adaptPracticeResult(go: GoPracticeResult, submitted: MobileAnswer[]): PracticeResult {
  const selectedById = new Map(submitted.map((a) => [a.questionId, a.selected]));
  const masteryGained = !!go.upgraded;
  const pointsEarned = go.correct * 10 + (masteryGained ? 20 : 0);
  return {
    total: go.scored,
    correct: go.correct,
    scorePct: Math.round((go.score ?? 0) * 100),
    masteryGained,
    newMastery: mapMasteryState(go.to_state),
    breakdown: (go.breakdown ?? []).map((b) => ({
      questionId: b.question_item_id,
      stem: b.stem,
      correct: b.correct,
      selected: selectedById.get(b.question_item_id) ?? [],
      correctAnswers: toStringArray(b.correct_answer),
      explanation: b.explanation ?? '',
    })),
    pointsEarned,
  };
}
