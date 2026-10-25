// Film Academy topic learning — single import surface for routes and tests.
//
//   types.ts    — the exact 85% rule, publication gate and shared domain types.
//   import.ts   — pure planning + idempotent writes for the bundled TMFA pack.
//   progress.ts — derived learner path/detail; the only lock-state authority.
//   quiz.ts     — server-authoritative attempt lifecycle and mastery writes.
//   certificates.ts — earned, verifiable programme credentials.

export * from './types';
export {
  buildImportPlan,
  buildBundledImportPlan,
  applyImportPlan,
  importBundledCurriculumPack,
  mediaStateFromManifest,
  bundledPack,
  type TmfaCurriculumPack,
  type TmfaMediaSource,
  type TmfaQuestionSource,
  type ImportPlan,
  type ImportResult,
  type ImportPlanProblem,
  type PlannedCourse,
  type PlannedTopic,
  type PlannedMedia,
  type PlannedQuestion,
} from './import';
export {
  deriveTopicState,
  loadTopicPath,
  loadTopicForLearner,
  listMasteryEvents,
  type LearnerIdentity,
  type TopicStateDecision,
  type TopicPath,
  type TopicPathCourse,
  type TopicPathItem,
  type TopicDetail,
  type TopicMediaView,
  type TopicResultSummary,
  type MasteryEvent,
} from './progress';
export {
  startTopicAttempt,
  saveTopicAnswer,
  submitTopicAttempt,
  readTopicAttempt,
  readTopicResult,
  previewTopicResult,
  TopicQuizError,
  type TopicAttemptView,
  type TopicQuizReceipt,
  type TopicSnapshotItem,
  type TopicPresentedQuestion,
  type ObjectiveBreakdown,
} from './quiz';
export {
  listAdminTopics,
  getAdminTopic,
  mutateAdminTopic,
  listAdminMedia,
  updateAdminMedia,
  listAdminHolds,
  createAdminHold,
  clearAdminHold,
  listCandidateMastery,
  asActorId,
  TopicAdminError,
  PRODUCTION_STATES,
  RIGHTS_STATUSES,
  ACCESSIBILITY_STATUSES,
  HOLD_TYPES,
  type AdminTopicRow,
  type AdminTopicList,
  type AdminTopicListFilter,
  type AdminTopicDetail,
  type TopicAdminAction,
  type TopicAdminInput,
  type TopicAdminMutationResult,
  type AdminMediaRow,
  type MediaListFilter,
  type MediaUpdateInput,
  type AdminHoldRow,
  type HoldListFilter,
  type CandidateMasteryRow,
} from './admin';
export {
  evaluateCertificateEligibility,
  loadCertificateReadiness,
  readLearnerCertificate,
  issueCertificate,
  revokeCertificate,
  verifyCertificate,
  CertificateError,
  type CertificateBlocker,
  type CertificateReadiness,
  type CertificateView,
  type CertificateVerification,
} from './certificates';
