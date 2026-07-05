// ── Paymax AI Symptom Checker — Triage domain types ──────────────────────────
// Scope = TRIAGE + NAVIGATION ONLY (SC-1/SC-11). This is NOT a diagnostic device.
// The output is framed as "possible causes / what to do next" — never a diagnosis.

/** Supported member languages for triage (Phase 1: EN + Pidgin). */
export type Language = 'en' | 'pcm';

/** Family profile kinds (SC-9 drives extra caution for child/maternal). */
export type ProfileKind = 'self' | 'child' | 'dependant';

export type Sex = 'male' | 'female';

export interface Profile {
  id: string;
  kind: ProfileKind;
  name: string;
  /** ISO date of birth — used to derive age + paediatric caution (SC-9). */
  dob: string;
  sex: Sex;
  /** Maternal flow flag (SC-9). */
  isPregnant?: boolean;
}

export interface CreateProfileInput {
  kind: ProfileKind;
  name: string;
  dob: string;
  sex: Sex;
  isPregnant?: boolean;
}

/**
 * TriageSession lifecycle (PRD §10):
 * STARTED → CONSENTED → INTERVIEWING → (RED_FLAG_DETECTED → ESCALATED)
 *         → ASSESSED → DISPOSITION_GIVEN → REFERRED → CLOSED | ABANDONED
 */
export type SessionState =
  | 'STARTED'
  | 'CONSENTED'
  | 'INTERVIEWING'
  | 'RED_FLAG_DETECTED'
  | 'ESCALATED'
  | 'ASSESSED'
  | 'DISPOSITION_GIVEN'
  | 'REFERRED'
  | 'CLOSED'
  | 'ABANDONED';

export interface CreateSessionInput {
  profileId?: string;
  language: Language;
  channel: 'app';
  consent: true;
}

export interface TriageSession {
  id: string;
  state: SessionState;
  /** Persistent medical disclaimer text (SC-8) returned by the engine. */
  disclaimer: string;
}

/** A tapped body region maps to coarse symptom evidence. */
export type BodyRegion =
  | 'head'
  | 'chest'
  | 'abdomen'
  | 'back'
  | 'arm'
  | 'leg'
  | 'skin'
  | 'pelvis';

export interface IntakeInput {
  rawText: string;
  /** Body-map taps (low-literacy path). */
  bodyMap?: BodyRegion[];
}

/** A single adaptive interview question. */
export interface TriageQuestion {
  code: string;
  text: string;
  type: 'single_select' | 'multi_select' | 'boolean';
  options: { value: string; label: string }[];
}

export interface AnswerInput {
  code: string;
  /** string for single/boolean, string[] for multi. */
  value: string | string[];
}

/**
 * Interview-loop response shape (shared by intake + answer):
 * either another question, or done with a disposition pointer.
 */
export interface InterviewStep {
  id: string;
  state: SessionState;
  question?: TriageQuestion;
  done?: boolean;
  /** Disposition urgency level 1 (most urgent) .. 5 (self-care), present when done. */
  disposition?: DispositionLevel;
  /** Deterministic red-flag fired mid-interview (SC-2) → emergency. */
  redFlag?: boolean;
}

/** 5-level disposition (1 = emergency … 5 = self-care). */
export type DispositionLevel = 1 | 2 | 3 | 4 | 5;

/** A possible cause — NEVER a diagnosis (SC-1). Probability is 0..1. */
export interface PossibleCause {
  label: string;
  probability: number;
}

/** Care routes the disposition can hand off to. */
export type CareRoute = 'emergency' | 'telemedicine' | 'lab' | 'pharmacy' | 'self_care';

export interface TriageResult {
  id: string;
  state: SessionState;
  dispositionLevel: DispositionLevel;
  dispositionCode: string;
  /** SC-1: framed as "possible causes", with a visible "not a diagnosis" note. */
  possibleCauses: PossibleCause[];
  /** Plain-language guidance / what to do next. */
  guidance: string;
  disclaimer: string;
  /** Deterministic red-flag override (SC-2). */
  redFlag: boolean;
  /** Recommended care route (drives the one-tap CTA). */
  recommendedRoute: CareRoute;
}

export interface EmergencyInfo {
  erName: string;
  erAddress: string;
  /** Ambulance dial string (tel:). */
  ambulance: string;
  /** First-aid steps to show while help is on the way. */
  firstAid: string[];
  /** Coarse coordinates for a static map preview (optional). */
  lat?: number;
  lng?: number;
}

export interface ReferInput {
  level: DispositionLevel;
}

export interface Referral {
  referralId: string;
  route: CareRoute;
  /** Held-payment amount for the chosen care action (kobo). */
  amountKobo: number;
  /** Present only for emergency referrals. */
  emergency?: EmergencyInfo;
}

export interface PayReferralInput {
  referralId: string;
  idempotencyKey: string;
}

export interface PayReferralResult {
  state: 'PAID';
}

export interface FeedbackInput {
  sessionId: string;
  rating: number; // 1..5
  comment?: string;
}
