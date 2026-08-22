// ── Types — Paymax Health · AI Symptom Checker (Triage) admin console ──────────
// Companion to the Symptom Checker PRD (§9 admin console, §10 state machines,
// §11 SC-1..SC-12 safety invariants). This owns the clinical-management surface:
// triage session monitoring, escalation queue, clinical-content governance,
// red-flag-rule governance and the validation/accuracy harness.
//
// SAFETY FRAMING (PRD §11 — release blockers):
//  SC-1  Never a diagnosis — output is "possible causes / guidance"; triage +
//        navigation only (no "diagnosis" wording anywhere in this console).
//  SC-2  The deterministic RED-FLAG layer can ALWAYS override the engine toward
//        HIGHER urgency — emergency detection is rules-based, never probability-only.
//        Rules can only RAISE urgency, never lower it.
//  SC-3  Conservative triage — optimise EMERGENCY SENSITIVITY first.
//  SC-5  Human-in-the-loop for high-risk dispositions; clear clinician hand-off.
//  SC-6  Clinical content + red-flag rules require licensed-clinician review &
//        sign-off before publish; versioned & auditable.
//  SC-12 Immutable audit of every disposition, escalation and content/rule change.
//
// RBAC: review surfaces (sessions, escalations) gate on `health.triage.review`;
// governance surfaces (content, rules, validation) gate on `health.triage.admin`.

// ── 5-level disposition (PRD §6 care-loop; emergency-sensitivity-first) ─────────
export type DispositionLevel =
  | 'emergency_ambulance' // nearest ER + ambulance + first-aid (MapService)
  | 'emergency_urgent' // nearest facility + optional urgent telemedicine
  | 'consult_24h' // telemedicine / pharmacist consult within 24h
  | 'consult_routine' // book vet/doctor/pharmacist; optional lab test
  | 'self_care'; // home-care guidance + OTC → optional Pharmacy order

export type TriageChannel = 'app' | 'whatsapp' | 'ussd' | 'sms' | 'agent';
export type TriageLanguage = 'en' | 'pcm' | 'hau' | 'yor' | 'ibo';

// TriageSession state machine (PRD §10):
//  STARTED → CONSENTED → INTERVIEWING → (RED_FLAG_DETECTED → ESCALATED)
//          → ASSESSED → DISPOSITION_GIVEN → REFERRED → CLOSED | ABANDONED
export type TriageSessionState =
  | 'started'
  | 'consented'
  | 'interviewing'
  | 'red_flag_detected'
  | 'escalated'
  | 'assessed'
  | 'disposition_given'
  | 'referred'
  | 'closed'
  | 'abandoned';

export type TriageSession = {
  id: string;
  state: TriageSessionState;
  disposition_level: DispositionLevel | null;
  channel: TriageChannel;
  language: TriageLanguage;
  red_flag: boolean; // a deterministic red-flag rule fired (SC-2)
  profile_kind: 'self' | 'child' | 'dependant'; // SC-9 paediatric caution
  consent_on_file: boolean; // SC-7 NDPA explicit consent
  age_band: string; // de-identified band, never DOB (SC-7 minimise PII)
  top_condition_count: number; // # of "possible causes" surfaced (never a diagnosis)
  created_at: string;
};

export type DispositionLevelStat = {
  level: DispositionLevel;
  count: number;
  share_pct: number;
};

export type ChannelStat = { channel: TriageChannel; count: number; share_pct: number };

export type TriageSessionStats = {
  generated_at: string;
  total_sessions: number;
  sessions_today: number;
  red_flag_rate: number; // share of sessions where a red-flag rule fired (SC-2)
  emergency_share: number; // share dispositioned to either emergency level
  completion_rate: number; // reached DISPOSITION_GIVEN (not abandoned)
  open_escalations: number; // RAISED/NOTIFIED/ACKNOWLEDGED (human-in-loop, SC-5)
  by_level: DispositionLevelStat[];
  by_channel: ChannelStat[];
};

// ── Escalation queue (PRD §10 EscalationCase) ──────────────────────────────────
//  RAISED → NOTIFIED(patient + clinician) → ACKNOWLEDGED → RESOLVED
export type EscalationState = 'raised' | 'notified' | 'acknowledged' | 'resolved';

export type EscalationCase = {
  id: string;
  session_id: string;
  state: EscalationState;
  disposition_level: DispositionLevel;
  red_flag_rule_id: string | null; // the deterministic rule that fired (SC-2)
  red_flag_summary: string; // plain-language reason (never a diagnosis, SC-1)
  channel: TriageChannel;
  language: TriageLanguage;
  profile_kind: 'self' | 'child' | 'dependant';
  patient_masked: string; // de-identified handle (SC-7)
  acknowledged_by: string | null; // clinician who acknowledged (SC-5)
  handoff_note: string | null; // clinician hand-off note (SC-5)
  raised_at: string;
  notified_at: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
};

export type EscalationActionResult = {
  id: string;
  state: EscalationState;
  audit_id: string; // SC-12 immutable audit
  message: string;
};

// ── Lifecycle (PRD §10) — shared by ClinicalContentItem + RedFlagRule ──────────
//  DRAFT → CLINICAL_REVIEW → APPROVED → PUBLISHED → DEPRECATED
//  (licensed-clinician sign-off required to publish — SC-6)
export type GovernanceState =
  | 'draft'
  | 'clinical_review'
  | 'approved'
  | 'published'
  | 'deprecated';

export type GovernanceAction =
  | 'submit' // DRAFT → CLINICAL_REVIEW
  | 'approve' // CLINICAL_REVIEW → APPROVED (records clinician sign-off)
  | 'publish' // APPROVED → PUBLISHED (requires sign-off, SC-6)
  | 'deprecate'; // → DEPRECATED

export type ClinicalContentKind =
  | 'condition_library' // curated "possible cause" explainer (RAG, SC-10)
  | 'disclaimer' // medical disclaimer / "not a diagnosis" copy (SC-1/SC-8)
  | 'care_guidance' // self-care / home-care guidance
  | 'channel_notice'; // channel-specific regulatory notice

export type ClinicalContentItem = {
  id: string;
  title: string;
  kind: ClinicalContentKind;
  language: TriageLanguage;
  state: GovernanceState;
  version: number; // versioned & auditable (SC-6)
  body_preview: string;
  reviewer_id: string | null; // licensed clinician who signed off (SC-6)
  signed_off_at: string | null; // clinician sign-off timestamp (SC-6)
  author_id: string;
  updated_at: string;
};

export type ClinicalContentInput = {
  title: string;
  kind: ClinicalContentKind;
  language: TriageLanguage;
  body_preview: string;
};

// ── Red-flag rules (PRD §5 deterministic layer; SC-2) ──────────────────────────
// A rule's only permitted effect is to RAISE urgency to its escalate_to level —
// it can never lower a disposition. Condition is clinician-authored JSON logic.
export type RedFlagRule = {
  id: string;
  name: string;
  state: GovernanceState;
  version: number;
  // The disposition level this rule escalates TO when it fires. Must be at or
  // above the engine's level — rules can only RAISE urgency (SC-2).
  escalate_to: DispositionLevel;
  // Deterministic match logic (clinician-authored). Edited as a JSON object in
  // the admin (jsonb on the backend).
  condition: Record<string, unknown>;
  rationale: string; // clinical rationale (plain language)
  reviewer_id: string | null; // licensed clinician sign-off (SC-6)
  signed_off_at: string | null;
  author_id: string;
  updated_at: string;
};

export type RedFlagRuleInput = {
  name: string;
  escalate_to: DispositionLevel;
  condition: Record<string, unknown>;
  rationale: string;
};

export type GovernanceResult = {
  id: string;
  state: GovernanceState;
  version: number;
  audit_id: string; // SC-12
  message: string;
};

// ── Validation / accuracy harness (PRD §5; emergency-sensitivity-first) ─────────
export type LanguageParity = {
  emergency_sensitivity: number; // 0..1 — the headline safety metric (SC-3)
  level_accuracy: number; // 0..1 — exact disposition-level agreement
  over_triage: number; // 0..1 — safe over-referral rate
  under_triage: number; // 0..1 — unsafe under-referral rate (must be ~0)
};

export type ValidationRun = {
  run_id: string;
  ran_at: string;
  vignette_count: number;
  // Emergency sensitivity FIRST — the metric that matters most (SC-3); the share
  // of true emergencies the system correctly escalated. Target ~1.0 (~0 missed).
  emergency_sensitivity: number;
  over_triage: number; // controlled over-referral (acceptable)
  under_triage: number; // missed/under-referred (release blocker if not ~0)
  level_accuracy: number; // exact 5-level agreement with the clinician panel
  // Cross-language parity — accuracy must hold across languages (SC-3 / PRD §5).
  by_language: { en: LanguageParity; pcm: LanguageParity };
  shadow_mode: boolean; // shadow-eval vs clinicians, before any real patient
  notes: string;
};

export type Vignette = {
  id: string;
  title: string;
  language: TriageLanguage;
  // The clinician-panel gold-standard disposition for this vignette.
  expected_level: DispositionLevel;
  is_emergency: boolean; // a true emergency the system MUST catch (SC-3)
  category: string; // local epidemiology tag (malaria, maternal, sickle-cell…)
  last_eval_level: DispositionLevel | null; // most recent system output
};

export type LanguagePack = {
  code: TriageLanguage;
  label: string;
  voice_supported: boolean; // voice-first / low-literacy (PRD §3)
  coverage_pct: number; // share of content strings translated & clinician-vetted
  content_published: number; // # published content items in this language
  content_pending: number; // # awaiting clinician sign-off (SC-6)
  parity_ok: boolean; // accuracy parity vs English holds (SC-3)
};
