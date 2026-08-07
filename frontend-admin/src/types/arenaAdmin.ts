// Arena (Naija Driver contest) admin console — domain types.
// snake_case mirrors the Go backend / openapi.yaml. Admin routes are mounted at
// /api/arena/admin with per-route RBAC (arena.admin.*, arena.reviewer.screen,
// arena.proctor.attest, arena.judge.score, arena.auditor.read). Backend RBAC is
// authoritative — the UI gates are UX-only.
//
// LOCKED invariants surfaced by these types (ARENA-PRD §3 / §8):
//   - Merit is the ONLY rail that may feed the crown (NDC-1). The
//     crown←Merit binding is non-editable in A1.
//   - Advancement transitions read Merit only — never money/engagement.
//   - MeritLedger is append-only + signed + hash-chained (A6 trust surface).

export type CompetitionStatus =
  | 'DRAFT'
  | 'CONFIGURED'
  | 'PUBLISHED'
  | 'LIVE'
  | 'FINALE'
  | 'COMPLETED'
  | 'ARCHIVED';

export interface Competition {
  id: string;
  slug: string;
  name: string;
  status: CompetitionStatus;
  config_version?: number | null;
  published_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

// ── Contestant lifecycle (ARENA-PRD §8, LOCKED) ──────────────────────────────
export type ContestantState =
  | 'APPLIED'
  | 'SCREENED'
  | 'REJECTED'
  | 'TRAINED'
  | 'THEORY_ASSIGNED'
  | 'THEORY_TAKEN'
  | 'QUALIFIED'
  | 'FINALIST'
  | 'CROWNED'
  | 'ELIMINATED'
  | 'WITHDRAWN';

export interface Contestant {
  id: string;
  user_id: string;
  state: ContestantState;
  home_state: string; // Nigerian state / FCT (State Pride rail)
  theory_batch?: 'B1' | 'B2' | 'B3' | null;
  full_name?: string | null;
  merit_total?: number | null; // derived normalized_score sum (read-only)
  created_at?: string | null;
  updated_at?: string | null;
}

// ── Merit ledger (ARENA-PRD §4, append-only + signed + chained) ──────────────
export type MeritSourceType = 'THEORY_EXAM' | 'PRACTICAL' | 'FIRST_AID' | 'TELEMATICS';

export type MeritStage =
  | 'SCREENING'
  | 'THEORY_B1'
  | 'THEORY_B2'
  | 'THEORY_B3'
  | 'FINALE_PRACTICAL'
  | 'FINALE_FIRSTAID';

export interface MeritEntry {
  id: string;
  competition_id?: string;
  contestant_id: string;
  stage: MeritStage;
  source_type: MeritSourceType;
  source_adapter_id?: string | null;
  rubric_version?: string | null;
  raw_score?: number | null;
  normalized_score: number;
  signature: string; // adapter signature over canonical payload (NDC-2)
  entry_hash: string; // chain hash (hash of prior entry per contestant)
  prev_hash?: string | null;
  signed_at: string;
  recorded_at?: string | null;
}

// Result of a client/server integrity verification pass over a contestant chain.
export interface MeritVerifyResult {
  contestant_id?: string | null;
  stage?: MeritStage | null;
  entries_checked: number;
  signatures_valid: boolean;
  chain_valid: boolean;
  broken_at?: string | null; // entry id where the chain/sig first failed
  verified_at: string;
}

// ── Screening (A2) ───────────────────────────────────────────────────────────
export type ScreeningDecision = 'APPROVE' | 'REQUEST_INFO' | 'REJECT';

export interface ScreeningItem {
  contestant_id: string;
  user_id: string;
  full_name?: string | null;
  home_state: string;
  state: ContestantState;
  batch?: string | null;
  flags?: string[];
  submitted_at?: string | null;
  rubric_version?: string | null;
  document_refs?: { id: string; kind: string; label?: string }[];
}

// ── Pot & disbursement (A7, ARENA-PRD §6, NDC-4) ─────────────────────────────
export type DisbursementStatus =
  | 'NONE'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'EXECUTING'
  | 'DISBURSED'
  | 'FAILED';

export interface PotContribution {
  id: string;
  source: string; // e.g. 'Back-a-Driver', 'State Pride'
  contestant_id?: string | null;
  amount_kobo: number;
  ledger_entry_id?: string | null;
  created_at?: string | null;
}

export interface PotSplit {
  label: string; // e.g. 'NAIJA_DRIVER_CROWN prize', 'PEOPLES_CHAMPION', 'scholarships'
  beneficiary?: string | null; // user_id / pool id
  amount_kobo: number;
}

export interface PotApproval {
  approver_id: string;
  approver_email?: string | null;
  approved_at: string;
}

export interface PotView {
  competition_id?: string;
  total_kobo: number;
  split_formula: string; // published formula reference (immutable at publish)
  disbursement_status: DisbursementStatus;
  contributions?: PotContribution[];
  splits?: PotSplit[];
  approvals?: PotApproval[];
  approvals_required?: number; // multi-approve threshold (default 2)
}

// ── Credentials (A9, ARENA-PRD §14) ──────────────────────────────────────────
export type CredentialType = 'NAIJA_DRIVER' | 'CERTIFIED_SAFE_DRIVER';
export type CredentialStatus = 'ISSUED' | 'REVOKED';

export interface Credential {
  id: string;
  user_id: string;
  contestant_id?: string | null;
  type: CredentialType;
  status: CredentialStatus;
  verifiable_hash: string;
  issued_at: string;
  revoked_at?: string | null;
  revoke_reason?: string | null;
}

export interface CredentialVerifyLog {
  id: string;
  credential_id: string;
  verifier?: string | null; // consumer vertical (transport, insurance…) or 'public'
  result: 'valid' | 'revoked' | 'not_found';
  verified_at: string;
}

// ── A1 config rails / awards ─────────────────────────────────────────────────
export type RailKind = 'MERIT' | 'SUPPORT' | 'PLAY_ALONG' | 'SPONSOR';

export type AwardCode =
  | 'NAIJA_DRIVER_CROWN'
  | 'PEOPLES_CHAMPION'
  | 'STATE_PRIDE_WINNER'
  | 'CERTIFIED_SAFE_DRIVER';

export interface AwardBinding {
  award: AwardCode;
  rail: RailKind;
  locked: boolean; // crown←Merit is LOCKED (NDC-1) — non-editable
}

export interface RailConfig {
  kind: RailKind;
  enabled: boolean;
  // free-form params surfaced per rail (merit sources, support amounts,
  // play-along thresholds, sponsor slots).
  params: Record<string, string | number | boolean>;
}

export interface CompetitionConfig {
  competition_id: string;
  rails: RailConfig[];
  award_bindings: AwardBinding[];
  screening_schema_version: string;
  rubric_version: string;
  exam_schema_version: string;
  published: boolean;
  config_version?: number | null;
}

// ── Quiz bank (Arena — Naija Driver quiz management) ─────────────────────────
// Full ADMIN view of the 90-question bank (3 stages × 30, 120s each). Unlike the
// contestant view, admin rows carry the answers (correctIndex/correctAnswer) and
// explanation for teaching/QA. camelCase mirrors the backend admin contract:
//   GET  /competitions/:id/questions?stage=&category=
//   GET  /competitions/:id/questions/stats
//   POST /competitions/:id/questions/import
export type QuizStage = 1 | 2 | 3;

export interface QuizQuestion {
  id: string;
  externalId: string; // seed id, e.g. 'ND-S1-Q01'
  stage: QuizStage;
  category: string; // e.g. 'road_signs', 'hazard_perception'
  prompt: string;
  imageUrl?: string; // optional illustration shown with the question
  options: string[]; // exactly 4
  correctIndex: number; // 0..3
  correctAnswer: string;
  explanation: string;
  timeLimitSeconds: number;
  passMarkPercent: number;
}

export interface QuizStageCount {
  stage: QuizStage;
  count: number;
}

export interface QuizCounts {
  total: number;
  perStage: QuizStageCount[];
  perCategory?: { category: string; count: number }[];
}

export interface QuizListResult {
  questions: QuizQuestion[];
  counts: QuizCounts;
}

export interface QuizStatPerStage {
  stage: QuizStage;
  questionCount: number;
  attemptCount: number;
  passRate: number; // 0..1
}

export interface QuizStats {
  perStage: QuizStatPerStage[];
  totalQuestions: number;
}

export interface QuizImportResult {
  imported: number;
  stages: { stage: QuizStage; count: number }[];
}

export const QUIZ_STAGE_LABELS: Record<QuizStage, string> = {
  1: 'Stage 1 · Foundation (Road Rules, Signs & Docs)',
  2: 'Stage 2 · Intermediate (Safe Driving & FRSC)',
  3: 'Stage 3 · Advanced (Hazard Perception & Emergency)',
};

// ── Scaffold rails (A3 proctor, A4 judge) — thin request shapes ──────────────
export interface ProctorAttestInput {
  contestant_id: string;
  batch: string;
  stage: MeritStage;
  attestation: 'PASS' | 'FLAG' | 'PAUSE' | 'RESUME';
  note?: string;
}

export interface JudgeScoreInput {
  contestant_id: string;
  stage: 'FINALE_PRACTICAL' | 'FINALE_FIRSTAID';
  rubric_version: string;
  raw_score: number;
  note?: string;
}

// ── Sponsor / Featured Placement (A8 scaffold) ───────────────────────────────
export interface SponsorSlot {
  id: string;
  sponsor: string;
  placement: 'home' | 'driver_profile' | 'finale_overlay' | string;
  starts_at?: string | null;
  ends_at?: string | null;
  impressions?: number | null;
  status: 'scheduled' | 'live' | 'ended' | string;
}

// ── Labels ───────────────────────────────────────────────────────────────────
export const RAIL_LABELS: Record<RailKind, string> = {
  MERIT: 'Merit (non-purchasable judging)',
  SUPPORT: 'Support (real-Naira backing → pot)',
  PLAY_ALONG: 'Play-Along (free engagement)',
  SPONSOR: 'Sponsor (branded, weighted)',
};

export const AWARD_LABELS: Record<AwardCode, string> = {
  NAIJA_DRIVER_CROWN: 'Naija Driver Crown',
  PEOPLES_CHAMPION: "People's Champion",
  STATE_PRIDE_WINNER: 'State Pride Winner',
  CERTIFIED_SAFE_DRIVER: 'Certified Safe Driver',
};

export const MERIT_STAGE_LABELS: Record<MeritStage, string> = {
  SCREENING: 'Screening',
  THEORY_B1: 'Theory · Batch 1',
  THEORY_B2: 'Theory · Batch 2',
  THEORY_B3: 'Theory · Batch 3',
  FINALE_PRACTICAL: 'Finale · Practical',
  FINALE_FIRSTAID: 'Finale · First-Aid',
};

// Legal transitions per ARENA-PRD §8 (LOCKED). Only these are offered in A5;
// the backend rejects anything not listed (NDC-5). WITHDRAWN reachable from any
// non-terminal state (reversible admin path).
export const LEGAL_TRANSITIONS: Record<ContestantState, ContestantState[]> = {
  APPLIED: ['SCREENED', 'REJECTED', 'WITHDRAWN'],
  SCREENED: ['TRAINED', 'WITHDRAWN'],
  TRAINED: ['THEORY_ASSIGNED', 'WITHDRAWN'],
  THEORY_ASSIGNED: ['THEORY_TAKEN', 'WITHDRAWN'],
  THEORY_TAKEN: ['QUALIFIED', 'ELIMINATED', 'WITHDRAWN'],
  QUALIFIED: ['FINALIST', 'ELIMINATED', 'WITHDRAWN'],
  FINALIST: ['CROWNED', 'ELIMINATED', 'WITHDRAWN'],
  // terminal states — no onward transitions
  REJECTED: [],
  CROWNED: [],
  ELIMINATED: [],
  WITHDRAWN: [],
};

// Transitions that are computed purely from the Merit leaderboard (NDC-1).
export const MERIT_DERIVED_TRANSITIONS: ContestantState[] = ['QUALIFIED', 'FINALIST', 'CROWNED'];
