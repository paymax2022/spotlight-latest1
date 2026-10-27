// Film Academy assessment slice — the single import surface for the routes.
//
// Layering, kept honest so the answer key never reaches a learner DTO:
//   types.ts    — domain shapes (the SnapshotItem is the ONLY place a drawn
//                 question is described, and it carries stem/options but NEVER
//                 the answer key).
//   csv.ts      — pure import parsing + row validation (no DB).
//   scoring.ts  — pure presentation shuffle + deterministic marking (no DB).
//   bank.ts     — Supabase over the shared academy_question_items bank (film-scoped):
//                 idempotent draft import, SME review, approved-only draws, keys.
//   attempts.ts — server-authoritative attempt lifecycle on academy_exam_attempts:
//                 start (draw+snapshot), autosave, at-most-once submit+score.

export * from './types';
export {
  parseCsv,
  checkHeaders,
  parseAndValidate,
  detectFormat,
  draftContentHash,
  type HeaderCheck,
  type ImportFormat,
} from './csv';
export {
  shuffle,
  presentQuestion,
  scoreAttempt,
  examGateReason,
  defaultRng,
  type Rng,
  type AnswerKeyEntry,
  type ExamGateReason,
} from './scoring';
export {
  FILM_SCOPE,
  createImportBatch,
  commitDrafts,
  reviewQuestion,
  poolCount,
  drawApproved,
  keysForItems,
  listQuestions,
  getQuestion,
  editQuestion,
  reviewHistory,
  type CommitResult,
  type ReviewDecision,
  type DrawnItem,
  type QuestionListFilter,
  type AdminQuestionRow,
  type QuestionEdit,
} from './bank';
export {
  listAllExams,
  createExam,
  updateExam,
  publishExam,
  unpublishExam,
  type ExamInput,
  type PublishPreflight,
} from './exams';
export {
  ExamError,
  examEligibility,
  listLearnerExams,
  startAttempt,
  saveResponse,
  submitAttempt,
  loadPublishedExam,
  readAttempt,
  type ExamRow,
  type LearnerRef,
  type ExamBlocker,
  type LearnerExamSummary,
  type StartedAttempt,
  type SubmitReceipt,
  type AttemptView,
} from './attempts';
