// ── Arena (Driver Contest) — shared types ────────────────────────────────────
// Mirrors the Go backend contract at /api/arena. Enums match the backend so
// screens branch on them without remapping (see ARENA-PRD §8 lifecycle).
//
// NDC-1 (the iron rule surfaced across this module): the crown / advancement is
// derived ONLY from Merit. Support money and Play-Along engagement never affect
// judging — they feed the prize pot and the People's Champion award only.

/** Contestant lifecycle state machine (ARENA-PRD §8, LOCKED). */
export type ContestantState =
  | 'APPLIED'
  | 'SCREENED'
  | 'TRAINED'
  | 'THEORY_ASSIGNED'
  | 'THEORY_TAKEN'
  | 'QUALIFIED'
  | 'FINALIST'
  | 'CROWNED'
  | 'ELIMINATED'
  | 'REJECTED'
  | 'WITHDRAWN';

/** Exam batch a contestant is assigned to. */
export type TheoryBatch = 'B1' | 'B2' | 'B3';

/** Merit source stages (crown reads ONLY these — NDC-1). */
export type MeritStage = 'SCREENING' | 'THEORY' | 'PRACTICAL' | 'FIRST_AID';

// ─── Public competition ─────────────────────────────────────────────────────

export interface Competition {
  id: string;
  title: string;
  season?: string | null;
  status: 'DRAFT' | 'OPEN' | 'LIVE' | 'FINALE' | 'CLOSED';
  /** ISO timestamp of the next headline event (used for countdowns). */
  nextEventAt?: string | null;
  nextEventLabel?: string | null;
  /** Whether applications are currently accepted. */
  applicationsOpen: boolean;
  /** KYC tier required to apply as a contestant. */
  requiredKycTier?: 1 | 2 | 3;
  bannerUrl?: string | null;
  summary?: string | null;
}

/** A row on the real Merit leaderboard (the true ranking — NDC-1). */
export interface MeritLeaderboardEntry {
  rank: number;
  contestantId: string;
  displayName: string;
  homeState: string;
  meritPoints: number;
  state: ContestantState;
  avatarUrl?: string | null;
}

/** State Pride aggregate (S6). Ranked by fan SUPPORT (real Naira), NOT Merit —
 *  it feeds the prize pot + State Pride award and never affects the crown (NDC-1). */
export interface StateStanding {
  rank: number;
  state: string;
  supportKobo: number;   // total support raised for this state's drivers (kobo)
  contestants: number;
}

/** Prize-pot transparency snapshot (S9) — all amounts in kobo. */
export interface PotSnapshot {
  /** Derived total from the contribution ledger (never a stored balance). */
  totalKobo: number;
  contributions: number;
  /** Published split formula, fractions summing to 1. */
  split: { label: string; fraction: number; note?: string }[];
  disbursements: {
    label: string;
    amountKobo: number;
    status: 'PENDING' | 'APPROVED' | 'DISBURSED';
    reference?: string | null;
  }[];
  /** ISO — when the derived total was last computed. */
  updatedAt?: string | null;
}

/** Public credential verification result (C9 / S3 verify-QR). */
export interface CredentialVerification {
  valid: boolean;
  type?: 'CERTIFIED_SAFE_DRIVER' | 'NAIJA_DRIVER' | null;
  holderName?: string | null;
  homeState?: string | null;
  issuedAt?: string | null;
  status?: 'ACTIVE' | 'REVOKED' | 'EXPIRED' | null;
  reason?: string | null;
}

// ─── Member (auth) ──────────────────────────────────────────────────────────

/** The signed-in user's contestant record for a competition. */
export interface Contestant {
  id: string;
  competitionId: string;
  state: ContestantState;
  theoryBatch?: TheoryBatch | null;
  homeState?: string | null;
  /** ISO — batch exam window opens. */
  examWindowOpensAt?: string | null;
  examWindowClosesAt?: string | null;
  /** Screening / rejection reason surfaced verbatim-ish on C3. */
  reason?: string | null;
  displayName?: string | null;
}

export interface ContestantMeResponse {
  contestant: Contestant | null;
}

/** A single signed Merit entry for the current user (C7, read-only). */
export interface MeritEntry {
  stage: MeritStage;
  points: number;
  maxPoints?: number | null;
  recordedAt?: string | null;
  /** Attestation reference (proctor/judge signature id) — proof, not editable. */
  attestation?: string | null;
}

export interface MyMeritResponse {
  entries: MeritEntry[];
  totalPoints: number;
  /** Merit points needed to pass the current stage cutoff. */
  cutoffPoints?: number | null;
  rank?: number | null;
}

/** Training module (C4). */
export interface TrainingModule {
  id: string;
  title: string;
  durationMins?: number | null;
  completed: boolean;
  order: number;
}

// ─── Play-Along quiz (S2) — engagement, NOT merit ───────────────────────────
// Naija Driver bank: 90 questions, 3 stages × 30, 120s per question. The backend
// serves CONTESTANT-SAFE questions (no correct answer / explanation) and scores
// server-side on submit, returning a per-question breakdown for the teaching
// moment (S3). Option ids are the string indices "0".."3" (per contract).

/** Which of the three stages of the safe-driving bank. */
export type QuizStage = 1 | 2 | 3;

export interface QuizOption {
  /** "0".."3" per the backend contract. */
  id: string;
  label: string;
}

/** A single contestant-safe question (NO answer/explanation leaked). */
export interface PlayAlongQuestion {
  id: string;
  /** Question category tag (e.g. "road_signs") — informational only. */
  category?: string;
  prompt: string;
  /** Optional illustration shown above the prompt (e.g. a road-sign image). */
  imageUrl?: string | null;
  options: QuizOption[];
  /** Per-question limit (seconds). Defaults to 120 for this bank. */
  timeLimitSecs?: number | null;
  // Optional — present ONLY in mock/dev so the client can score offline and give
  // the instant gamified reveal. The real backend OMITS these on question feeds
  // (contestant-safe) and returns them in the attempt result's `perQuestion`.
  correctOptionId?: string;
  explanation?: string;
}

/** A full stage question set from GET …/playalong/questions?stage=N. */
export interface PlayAlongStageSet {
  stageNumber: QuizStage;
  stageName: string;
  passMarkPercent: number;
  timeLimitSecs: number;
  questions: PlayAlongQuestion[];
}

/** Per-question result returned by the attempt POST (the teaching moment). */
export interface PlayAlongPerQuestion {
  questionId: string;
  correctOptionId: string;
  explanation?: string | null;
  correct: boolean;
}

/** Result of POST …/playalong/attempt. Engagement — never Merit. */
export interface PlayAlongAttemptResult {
  score: number;
  total: number;
  passed: boolean;
  perQuestion: PlayAlongPerQuestion[];
  /** Issued when the pass threshold is met (Certified Safe Driver badge). */
  credentialIssued?: boolean;
  credentialHash?: string | null;
  /** Small ledgered cashback in kobo (NL5-style disclosure applies). */
  cashbackKobo?: number | null;
}

// ─── Proctored theory exam (C6) — feeds signed Merit ─────────────────────────

/** GET …/me/exam — the contestant's assigned batch feed (contestant-safe). */
export interface ExamAssignment {
  batch: TheoryBatch;
  stage: QuizStage;
  timeLimitSecs: number;
  questions: PlayAlongQuestion[];
}

/** POST …/me/exam/submit result. */
export interface ExamSubmitResult {
  ok: true;
  state: 'THEORY_TAKEN';
  submittedAt: string;
}

// ─── Support / Back-a-Driver (S5) — feeds pot + People's Champion, NOT crown ─

export interface SupportResult {
  ok: true;
  /** Attribution echoed back so the UI can confirm split (kobo). */
  potContributionKobo: number;
  peoplesChampionKobo: number;
  contestantId: string;
}

/** People's Champion tally for a driver (S4) — CLEARLY separate from Merit. */
export interface PeoplesChampionTally {
  contestantId: string;
  supportTotalKobo: number;
  backers: number;
  rank?: number | null;
}

// ─── Predictions (S7) ───────────────────────────────────────────────────────

export interface PredictionPick {
  slot: string; // e.g. "champion", "runner_up"
  contestantId: string;
}
