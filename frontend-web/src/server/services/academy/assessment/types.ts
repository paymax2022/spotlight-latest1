// Domain types for the Film Academy assessment slice.
//
// The bank is the SHARED academy_question_items table. A film question is stored
// with the K-12 engine's jsonb shapes so the same grader rules apply and no second
// assessment authority is created:
//   options = [{ id: 'a', text: '…' }, … four distinct ]
//   answer  = { correct: ['a'], explanation: '…' }   ← private key; never in a learner DTO
//
// `FilmQuestionDraft` is the normalised CSV row BEFORE it becomes a DB row; it is
// what the import preview surfaces and what the validator rejects/warns on.

// Two module/stage vocabularies share the bank:
//   legacy 256 bank  — stages L0-L5, modules FM01..FM32
//   TMFA pack bank   — stages L1-L4 + 'survey', modules = the pack topic_id verbatim
//                      (A01..A24 acting topics, C01-T1..C12-T4 course topics)
// Both are stored as-is in film_stage / film_module_code; nothing is translated.
export type FilmStage = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'survey';
const FILM_STAGES: ReadonlySet<string> = new Set(['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'survey']);
const FILM_MODULE_RE = /^FM(0[1-9]|[12][0-9]|3[0-2])$/; // FM01..FM32
const TMFA_TOPIC_RE = /^(A(0[1-9]|1[0-9]|2[0-4])|C(0[1-9]|1[0-2])-T[1-4])$/; // A01..A24, C01-T1..C12-T4

export const OPTION_IDS = ['a', 'b', 'c', 'd'] as const;
export type OptionId = (typeof OPTION_IDS)[number];

export interface FilmQuestionOption {
  id: string;
  text: string;
}

export interface FilmQuestionAnswerKey {
  correct: string[];
  explanation?: string;
}

/** A validated, ready-to-insert film item. */
export interface FilmQuestionDraft {
  externalCode: string;
  stage: string;
  department: string;
  moduleCode: string;
  moduleLabel: string;
  learningOutcome: string;
  cognitive: string;
  difficulty: string;
  stem: string;
  options: FilmQuestionOption[];
  answer: FilmQuestionAnswerKey;
  points: number;
  locale: string;
  keywords: string[];
  sourceVersion: string;
  owner: string;
  reviewNotes: string;
}

export interface RowProblem {
  row: number; // 1-based row number within the data (header excluded)
  externalCode?: string;
  message: string;
}

export interface ImportReport {
  totalRows: number;
  accepted: FilmQuestionDraft[];
  rejected: RowProblem[];
  warned: RowProblem[];
}

/** A learner-facing question: stem + SHUFFLED presentation options, no key. */
export interface PresentedOption {
  presentationOptionId: string;
  text: string;
}

export interface PresentedQuestion {
  attemptQuestionId: string;
  stem: string;
  points: number;
  options: PresentedOption[];
}

/** One entry in attempt.item_snapshot — the immutable draw.
 *
 * This IS the learner-facing content for the attempt (stem + shuffled option
 * texts), so a resumed or reloaded attempt re-renders from the snapshot alone.
 * It deliberately carries NO answer key — optionMap maps the presentation id
 * back to the bank id, and only the scorer on the server reads it. */
export interface SnapshotItem {
  attemptQuestionId: string;
  questionItemId: string;
  points: number;
  stem: string;
  options: PresentedOption[];
  /** presentationOptionId -> bank option id, so the scorer can map a saved choice. */
  optionMap: Record<string, string>;
}

export interface ExamScore {
  earnedPoints: number;
  maxPoints: number;
  percentage: number;
  passed: boolean;
  answeredCount: number;
  totalCount: number;
}

export function isFilmStage(s: string): s is FilmStage {
  return FILM_STAGES.has(s);
}

/** A TMFA pack topic_id (A01..A24, C01-T1..C12-T4). */
export function isTmfaTopicCode(s: string): boolean {
  return TMFA_TOPIC_RE.test(s);
}

/** Any valid film_module_code: a legacy FM code or a TMFA topic_id. */
export function isFilmModuleCode(s: string): boolean {
  return FILM_MODULE_RE.test(s) || TMFA_TOPIC_RE.test(s);
}
