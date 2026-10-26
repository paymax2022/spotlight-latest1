// Mirrors the payloads of /api/academy/* in frontend-web, which reads Supabase.
// renamed here so a payload can be compared against the server without a
// mental mapping step.

export interface FilmAcademyBatch {
  id: string;
  batch_name: string;
  start_date: string | null;
  training_schedule: string | null;
  duration_weeks: number | null;
  status: string | null;
  /** Naira, NOT kobo — this table predates the kobo convention. */
  training_fee_ngn: number | null;
  one_off_discount_pct: number | null;
  installments_count: number | null;
  fee_frequency: string | null;
  description: string | null;
}

export interface FilmAcademySettings {
  /** 'paid' means an application fee is charged before an application is accepted. */
  registration_type?: string;
  /** Naira. Charged at APPLICATION time, separate from tuition. */
  application_fee?: number;
  /** Naira. Programme-wide reference figure only — never billed; tuition comes from each training's fee. */
  tuition_fee?: number;
  [key: string]: unknown;
}

/**
 * One composite tuition item: a training format priced for one area (NAIRA).
 * Every area carries the same five formats — weekend with/without boarding,
 * weekdays with/without boarding, and full-time 30 days with boarding.
 */
export interface FilmAcademyPricingOption {
  key: string;
  label: string;
  note: string | null;
  price_ngn: number;
  sort_order: number;
}

/** An area of interest. `pricing_options` is what tuition is priced on now. */
export interface FilmAcademyInterestArea {
  /** Written to academy_applications.areas_of_interest; stable once in use. */
  slug: string;
  label: string;
  description: string | null;
  /** @deprecated Legacy single fee — the composite format table prices tuition now. */
  fee_ngn: number;
  pricing_options?: FilmAcademyPricingOption[];
}

/**
 * The applicant's details as the ACCOUNT already holds them. The apply form
 * shows these read-only rather than asking for them again; a field that is an
 * empty string is genuinely missing from the profile and still has to be asked
 * for. `null` for the whole object means signed out.
 */
export interface FilmAcademyApplicant {
  full_name: string;
  email: string;
  phone: string;
}

export interface FilmAcademyOverview {
  batches: FilmAcademyBatch[];
  /** Batch ids this user has already applied to; drives the Applied state. */
  appliedBatchIds: string[];
  settings: FilmAcademySettings;
  /** Active areas with their fees, in admin display order. */
  interestAreas: FilmAcademyInterestArea[];
  /**
   * Slugs each batch offers, keyed by batch id. A batch ABSENT from this map —
   * or present with an empty list — offers every active area.
   */
  batchAreas: Record<string, string[]>;
  /**
   * How many priced areas one application may carry. Served by the API so the
   * cap is not duplicated as a client-side constant that can drift from the
   * rule the server actually enforces.
   */
  maxInterestAreas: number;
  /** Signed-in applicant's known details, or null when signed out. */
  applicant: FilmAcademyApplicant | null;
  /**
   * The five training formats (identity only — prices live on each area's
   * pricing_options). Empty on an older server, which priced on fee_ngn.
   */
  pricingStructure: Array<{ key: string; label: string; note: string | null; sort_order: number }>;
  /** What the tuition buys, and what it does not cover — server-owned copy. */
  deliverables: string[];
  feeExclusions: string[];
}

export interface FilmAcademyApplicationInput {
  batch_id: string;
  /**
   * Identity fields. OPTIONAL because the server takes them from the signed-in
   * account first — the form only sends one when the profile has no value for
   * it. `email` is always ignored in favour of the session's own address.
   */
  full_name?: string;
  email?: string;
  phone?: string;
  areas_of_interest: string[];
  /**
   * Accordion selection: each chosen area WITH the format (sub) the applicant
   * tapped. When present the server prices tuition per area from these pairs.
   */
  area_selections?: Array<{ slug: string; key: string }>;
  motivation: string;
  experience?: string;
  payment_preference: 'one_off' | 'installment';
  /**
   * Which training format the tuition is priced in — one of the
   * pricingStructure keys. Omitted on an older server, which then falls back
   * to the cheapest format rather than the retired per-area fee.
   */
  pricing_option_key?: string;
  /**
   * Paystack transaction reference for the APPLICATION fee, required when
   * settings.registration_type is 'paid'. The server re-verifies it with
   * Paystack (status success, NGN, amount >= application_fee) — the client is
   * never trusted for the amount, so a client-initialised transaction is fine.
   */
  application_fee_reference?: string;
}

/** One entry in the applicant-visible progress timeline. */
export interface FilmAcademyTimelineEntry {
  id: string;
  old_status: string | null;
  new_status: string | null;
  change_reason: string | null;
  created_at: string | null;
}

/** Something the applicant has to do next. Derived server-side, never guessed here. */
export interface FilmAcademyAction {
  key: string;
  label: string;
  detail: string;
  amountNgn?: number;
  dueDate?: string | null;
}

/** One tuition instalment. `amount_ngn` is NAIRA. */
export interface FilmAcademyInstalment {
  id: string;
  installment_number: number;
  amount_ngn: number;
  due_date: string | null;
  paid_at: string | null;
  status: string | null;
}

/** One interest area the applicant chose, with the priced option they picked. NAIRA. */
export interface FilmAcademyAppliedArea {
  slug: string;
  label: string;
  optionKey: string | null;
  optionLabel: string | null;
  priceNgn: number;
}

export interface FilmAcademyApplicationStatus {
  application: {
    id: string;
    status: string | null;
    payment_status: string | null;
    /** NUMERIC — the naira amount collected, not a boolean flag. */
    application_fee_paid: number | null;
    /** Naira. The sum of the priced areas chosen at application time. */
    tuition_total_ngn: number | null;
    full_name: string | null;
    email: string | null;
    batch_id: string | null;
    created_at: string | null;
    academy_batches?: { batch_name?: string | null; start_date?: string | null } | null;
  } | null;
  timeline: FilmAcademyTimelineEntry[];
  /**
   * True once the learner holds an enrolment — which the server grants on the
   * FIRST settled instalment, not on full settlement. Someone on a three-month
   * plan starts learning immediately after their first payment.
   */
  enrolled: boolean;
  plan: { id: string; total_amount_ngn: number; discounted_amount_ngn: number | null; installments_count: number } | null;
  payments: FilmAcademyInstalment[];
  actions: FilmAcademyAction[];
  /** Interest areas applied for. Empty on an older server. */
  areas: FilmAcademyAppliedArea[];
  /** Naira. Sum of the priced areas; 0 when unknown. */
  tuitionTotalNgn: number;
}

// ── Topic mastery path (TMFA curriculum pack) ───────────────────────────────
// These mirror /api/academy/topics, /api/academy/topics/:id,
// /api/academy/topics/:id/quiz, /api/academy/topic-attempts/:id* and
// /api/academy/progress/events in frontend-web.
//
// The server owns progression. `state`, `canStartQuiz` and `blockerMessage`
// come from deriveTopicState against persisted mastery/holds/publication — the
// app never decides that a topic is unlocked. The exact pass rule is integer
// arithmetic (earned * 100 >= possible * 85); `percentage` is display only.

export type TopicLearnerState =
  | 'LOCKED'
  | 'AVAILABLE'
  | 'IN_PROGRESS'
  | 'REMEDIATION_REQUIRED'
  | 'PASSED'
  | 'MASTERED'
  | 'UNDER_REVIEW';

export interface TopicOutcome {
  objective_id: string;
  description: string;
}

export interface TopicResultSummary {
  attemptId: string;
  percentage: number;
  earnedPoints: number;
  possiblePoints: number;
  passed: boolean;
  threshold: number;
  submittedAt: string | null;
}

export interface TopicMediaCounts {
  total: number;
  required: number;
  published: number;
  pending: number;
}

/** One topic on the learner's path. Locked topics carry a title but no article. */
export interface FilmTopicPathItem {
  topicId: string;
  courseId: string;
  courseTitle: string;
  stage: string;
  stageLabel: string;
  title: string;
  outcomes: TopicOutcome[];
  orderIndex: number;
  prerequisites: string[];
  state: TopicLearnerState;
  published: boolean;
  /** Open only because an administrator recorded a pilot exception. */
  pilot: boolean;
  contentStatus: string;
  quizMinimumPercent: number;
  drawCount: number;
  approvedQuestionCount: number;
  poolReady: boolean;
  canStartQuiz: boolean;
  blockerCode: string | null;
  blockerMessage: string | null;
  bestScore: number | null;
  attemptsCount: number;
  passedAt: string | null;
  masteredAt: string | null;
  lastResult: TopicResultSummary | null;
  openHolds: Array<{ type: string; reason: string }>;
  media: TopicMediaCounts;
}

export interface FilmTopicPathCourse {
  courseId: string;
  title: string;
  kind: 'acting' | 'craft';
  stageLabel: string;
  topics: FilmTopicPathItem[];
}

export interface FilmTopicPath {
  courses: FilmTopicPathCourse[];
  summary: {
    totalTopics: number;
    publishedTopics: number;
    masteredTopics: number;
    inProgressTopics: number;
    remediationTopics: number;
    percentMastered: number;
  };
  eventsCursor: number;
}

/** One teaching asset attached to a topic. URLs are empty unless published. */
export interface FilmTopicMediaAsset {
  assetId: string;
  mediaType: string;
  required: boolean;
  language: string;
  productionState: string;
  rightsStatus: string;
  accessibilityStatus: string;
  published: boolean;
  instructions: string;
  url: string;
  thumbnailUrl: string;
  captionsUrl: string;
  transcript: string;
  altText: string;
}

/** A topic opened in detail — the path item plus article, media and blockers. */
export interface FilmTopicDetail extends FilmTopicPathItem {
  article: string | null;
  articleLocked: boolean;
  mediaAssets: FilmTopicMediaAsset[];
  publicationBlockers: Array<{ code: string; message: string }>;
  holds: Array<{ type: string; reason: string }>;
  attempts: TopicResultSummary[];
  nextTopicId: string | null;
  previousTopicId: string | null;
}

/** One rubric line on a practical assessment, authored by the academy. */
export interface FilmPracticalRubricCriterion {
  id: string;
  label: string;
  description: string;
  maxPoints: number;
}

/** A reviewer's score for one rubric line of one submission. */
export interface FilmPracticalRubricScore {
  criterionId: string;
  points: number;
  comment: string;
}

/**
 * A per-topic practical brief. `active` is false while the academy is still
 * drafting it; an inactive assessment accepts nothing and gates nothing.
 */
export interface FilmPracticalAssessment {
  id: string;
  topicId: string;
  title: string;
  briefMarkdown: string;
  submissionInstructions: string;
  rubric: FilmPracticalRubricCriterion[];
  passPercent: number;
  maxAttempts: number;
  active: boolean;
}

/** One attempt at the practical. `passed` is null until a reviewer grades it. */
export interface FilmPracticalSubmission {
  id: string;
  attemptNumber: number;
  status: 'draft' | 'submitted' | 'graded';
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
  rubricScores: FilmPracticalRubricScore[];
  rubricSnapshot: FilmPracticalRubricCriterion[];
}

/** Why the learner can or cannot submit right now, decided by the server. */
export interface FilmPracticalEligibility {
  canSubmit: boolean;
  reason: string | null;
  attemptsUsed: number;
  maxAttempts: number;
  passed: boolean;
  inReview: boolean;
  draftSubmissionId: string | null;
}

/** GET /topics/:id/practical. History survives deactivation. */
export interface FilmPracticalView {
  topicId: string;
  topicTitle: string;
  assessment: FilmPracticalAssessment | null;
  submissions: FilmPracticalSubmission[];
  eligibility: FilmPracticalEligibility;
}

/** One presented option in a topic quiz — an opaque id, never a bank id. */
export interface TopicPresentedOption {
  presentationOptionId: string;
  text: string;
}

export interface TopicPresentedQuestion {
  attemptQuestionId: string;
  stem: string;
  points: number;
  options: TopicPresentedOption[];
  objectiveId: string | null;
}

/** The score arithmetic the server applied. `percentage` never decides the gate. */
export interface TopicQuizResult {
  earnedPoints: number;
  possiblePoints: number;
  percentage: number;
  passed: boolean;
  threshold: number;
}

export interface TopicObjectiveBreakdown {
  objectiveId: string;
  earnedPoints: number;
  possiblePoints: number;
  percentage: number;
}

/** The committed topic receipt: score + what it unlocked. */
export interface FilmTopicQuizReceipt extends TopicQuizResult {
  attemptId: string;
  topicId: string;
  state: 'scored';
  answeredCount: number;
  totalCount: number;
  objectives: TopicObjectiveBreakdown[];
  masteryState: TopicLearnerState;
  nextTopic: {
    topicId: string;
    title: string;
    state: TopicLearnerState;
    canStartQuiz: boolean;
  } | null;
}

/** What POST /topics/:id/quiz returns: the same resumable view as GET. */
export interface FilmTopicAttemptView {
  attemptId: string;
  topicId: string;
  attemptNumber: number;
  state: string;
  startedAt: string;
  deadlineAt: string;
  expired: boolean;
  questions: TopicPresentedQuestion[];
  /** attemptQuestionId -> the learner's own last saved presentationOptionId. */
  answered: Record<string, string>;
  result: FilmTopicQuizReceipt | null;
}

/** One cursor entry from the append-only mastery event stream. */
export interface FilmMasteryEvent {
  id: number;
  topicId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface FilmMasteryEventPage {
  events: FilmMasteryEvent[];
  cursor: number;
}

/** Why a credential cannot be issued yet — mirror of the server's own blockers. */
export interface FilmCertificateBlocker {
  code: string;
  message: string;
}

/**
 * Server-derived eligibility. `topicsPublished` matters as much as mastery: a
 * credential is never issued while the curriculum is incomplete or withdrawn.
 */
export interface FilmCertificateReadiness {
  topicsRequired: number;
  topicsPublished: number;
  topicsMastered: number;
  openHolds: number;
  eligible: boolean;
  blockers: FilmCertificateBlocker[];
}

/** The credential exactly as the server holds it. */
export interface FilmCertificate {
  id: string;
  certificateNumber: string;
  studentName: string;
  programName: string;
  batchName: string;
  completionDate: string | null;
  grade: string | null;
  status: string;
  verificationCode: string;
  issuedAt: string | null;
  revokedAt: string | null;
  revocationReason: string;
  curriculumLabel: string;
  topicsRequired: number | null;
  topicsMastered: number | null;
}

export interface FilmCertificateView {
  readiness: FilmCertificateReadiness;
  certificate: FilmCertificate | null;
}

export interface FilmCertificateIssueResult extends FilmCertificateView {
  created: boolean;
}
