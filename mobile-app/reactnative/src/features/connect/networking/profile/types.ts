// Paymax Connect — Networking PROFILE types (PRD §6.3 PR-*, §6.5 RC-*).
//
// Covers Experience (PR-07), Education (PR-08), About (PR-09), Profile Strength
// (PR-11) and Recommendations (RC-02/RC-03). camelCase to match {data:...}.
//
// INVARIANTS:
//  PN-1 Profile Strength is exposed ONLY as a BAND label + a checklist of missing
//       items. The raw numeric completion/verification score is NEVER returned to
//       or rendered by the client.
//  PN-4 A recommendation is only publicly visible after the SUBJECT accepts it
//       (state acceptedVisible). Inbox holds pending (sent) items awaiting the
//       subject's accept/decline; the public list returns accepted-only.

// ── Experience (PR-07) ───────────────────────────────────────────────────────
export interface Experience {
  id: string;
  title: string;
  company: string;
  employmentType?: string;      // Full-time / Contract / Internship …
  location?: string;
  startDate: string;            // 'YYYY-MM'
  endDate?: string | null;      // 'YYYY-MM' | null when current
  current: boolean;
  description?: string;
}

export interface ExperienceInput {
  title: string;
  company: string;
  employmentType?: string;
  location?: string;
  startDate: string;
  endDate?: string | null;
  current: boolean;
  description?: string;
}

// ── Education (PR-08) ────────────────────────────────────────────────────────
export interface Education {
  id: string;
  institution: string;
  degree?: string;
  fieldOfStudy?: string;
  startYear: string;            // 'YYYY'
  endYear?: string | null;      // 'YYYY' | null when in progress
  description?: string;
}

export interface EducationInput {
  institution: string;
  degree?: string;
  fieldOfStudy?: string;
  startYear: string;
  endYear?: string | null;
  description?: string;
}

// ── About (PR-09) ────────────────────────────────────────────────────────────
export interface About {
  headline?: string;
  summary: string;
}

export interface AboutInput {
  headline?: string;
  summary: string;
}

// ── Profile Strength (PR-11) — PN-1 band-only, NEVER a raw number ────────────
export type StrengthBand = 'beginner' | 'intermediate' | 'strong' | 'all_star';

export interface StrengthMissingItem {
  key: string;                  // e.g. 'about', 'experience'
  label: string;                // e.g. 'Add an About summary'
}

export interface ProfileStrength {
  band: StrengthBand;           // PN-1: qualitative label, not a score
  missing: StrengthMissingItem[]; // what still needs doing to level up
  // NOTE: intentionally no `score`/`percent` field — PN-1 forbids exposing it.
}

// ── Recommendations (RC-02 inbox / RC-03 public) ─────────────────────────────
export type RecommendationState =
  | 'drafted'
  | 'sent'                       // awaiting the subject's decision (in inbox)
  | 'acceptedVisible'            // PN-4: only this state is publicly queryable
  | 'declinedHidden';

export interface Recommendation {
  id: string;
  authorUserId: string;
  authorName: string;
  authorHeadline?: string;
  authorAvatarUrl?: string;
  subjectUserId: string;
  relationship?: string;         // "Managed you directly", "Worked together" …
  body: string;
  state: RecommendationState;
  createdAt: string;             // ISO
}
