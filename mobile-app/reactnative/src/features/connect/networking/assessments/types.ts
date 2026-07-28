// Paymax Connect — Skill Assessments types (Phase 6 §6.7, SA-01..04).
//
// Self-contained slice alongside ../types.ts. Reuses USE_MOCK / CONNECT_API_BASE
// from ../../constants/connect.constants and the arena quiz runner's question
// shape so SA-02 can drive the EXISTING QuizRunner with no remapping.
//
// SAFETY / INVARIANTS upheld here (Phase 6 §2):
//  PN-5  Assessed skills are structurally + visually distinct from self-reported
//        skills. A badge exists ONLY as the product of a passed, timestamped
//        attempt tied to a specific schema version — see AssessmentBadge.source.
//  PN-12 Assessment content is versioned. Every attempt AND every issued badge
//        permanently records `assessmentVersion` (the question-bank version).

import type { PlayAlongQuestion } from '@/features/arena/types';

// The assessment runner consumes the arena runner's contestant-safe question
// shape verbatim (no correctOptionId / explanation leaked on the feed).
export type AssessmentQuestion = PlayAlongQuestion;

// A catalogue entry (SA-01). Parameterises the reused quiz engine.
export interface SkillAssessment {
  id: string;
  domain: string;                 // "Engineering", "Product", "Design"…
  title: string;                  // "Backend Engineering — Go & APIs"
  skill: string;                  // the skill a passed attempt certifies
  description?: string;
  passThreshold: number;          // percent (0–100) needed to pass
  questionCount: number;
  perQuestionSecs: number;        // per-question limit fed to the runner
  assessmentVersion: string;      // question-bank version, e.g. "v3" (PN-12)
  // Viewer-relative state so the catalogue can gate a locked / cooling entry.
  earned?: boolean;               // viewer already holds this badge
  cooldownUntil?: string | null;  // ISO — set when the last attempt FAILED (SA-04)
}

// Attempt lifecycle (Phase 6 §domain state machine):
//   STARTED → IN_PROGRESS → SUBMITTED → GRADED → PASSED | FAILED (cooldown)
export type AssessmentAttemptState =
  | 'STARTED'
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'GRADED'
  | 'PASSED'
  | 'FAILED';

// Result of POST …/attempts — starts an attempt, returns contestant-safe
// questions (never the answer key) plus the version being attempted.
export interface AssessmentAttempt {
  attemptId: string;
  assessmentId: string;
  assessmentVersion: string;      // recorded on the attempt (PN-12)
  passThreshold: number;
  perQuestionSecs: number;
  questions: AssessmentQuestion[];
  state: AssessmentAttemptState;  // -> 'STARTED'
}

// A badge earned by passing an assessment (SA-03 → profile). ALWAYS carries the
// version of the bank that was passed (PN-12) and is flagged `source: 'assessed'`
// so the UI can render it distinctly from self-reported skills (PN-5).
export interface AssessmentBadge {
  id: string;
  assessmentId: string;
  domain: string;
  title: string;
  skill: string;
  score: number;                  // percent achieved
  assessmentVersion: string;      // frozen at issuance (PN-12)
  issuedAt: string;               // ISO
  source: 'assessed';             // never 'self-reported' — structural marker (PN-5)
}

// Result of PATCH …/attempts/:attemptId/submit. A FAILED attempt returns a
// cooldownUntil the runner routes into SA-04.
export interface AssessmentSubmitResult {
  attemptId: string;
  assessmentId: string;
  assessmentVersion: string;
  state: Extract<AssessmentAttemptState, 'PASSED' | 'FAILED'>;
  passed: boolean;
  score: number;                  // percent
  correctCount: number;
  total: number;
  passThreshold: number;
  badgeIssued: boolean;
  badge?: AssessmentBadge | null; // present iff badgeIssued
  cooldownUntil?: string | null;  // ISO — present iff failed (SA-04)
}
