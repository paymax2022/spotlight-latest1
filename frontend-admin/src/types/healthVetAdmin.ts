// ── Types — Paymax Health admin · Veterinary vertical (HEALTH-BUILD Phase 3 ADM) ──
// Parallel to healthAdmin.ts (Pharmacy P1) and healthLabAdmin.ts (Lab P2) — do NOT
// edit those files; this owns the Vet vertical.
// Money is BIGINT kobo (minor units) throughout — formatNaira() converts kobo → ₦.
// Surfaces the HEALTH invariants the Vet vertical enforces (HEALTH-BUILD §4 / §7C):
//  HL-1 marketplace, not provider (VCN-licensed vets deliver all clinical care) ·
//  HL-2 credential-gated supply (VCN vet licences; auto-suspend on expiry; VCN surfaced) ·
//  HL-3 prescription discipline (e-Rx issued by a licensed vet; dispense-once; POM gating) ·
//  HL-8 health data = sensitive NDPA (consent, masking, access-logged) ·
//  HL-9 money held→released→refunded (escrow released on consult completion) ·
//  HL-10 payout KYC + AML gate · HL-11 emergency safety (tele ≠ emergency; SOS → in-person) ·
//  HL-12 immutable audit on every state transition / config change.
//
// Appointment state machine (HEALTH-BUILD §5 / HEALTH-RECONCILE §4):
//  REQUESTED→ACCEPTED→CONFIRMED→IN_PROGRESS→COMPLETED ; (any)→CANCELLED|NO_SHOW ;
//  CONFIRMED→RESCHEDULED→CONFIRMED. Consult: SCHEDULED→IN_PROGRESS→COMPLETED.
// Prescription: ISSUED→SENT_TO_PHARMACY→VERIFYING→VERIFIED→DISPENSED→FULFILLED ;
//  VERIFYING→REJECTED ; DISPENSED is terminal-once (no re-dispense — HL-3).
// ProviderApplication (VCN): DRAFT→SUBMITTED→UNDER_REVIEW(↔NEEDS_INFO)→APPROVED(↔SUSPENDED)|REJECTED.

// ── A · Dashboard ─────────────────────────────────────────────────────────────
export type VetActivity = {
  id: string;
  kind: string; // vcn_approved | appointment_completed | eprescription_issued | payout_held | content_moderated | sos_routed ...
  label: string;
  ref?: string | null;
  created_at: string;
};

export type VetDashboard = {
  generated_at: string;
  // Appointments / consults
  appointments_today: number;
  appointments_30d: number;
  consults_completed_30d: number;
  appointment_completion_rate: number; // completed ÷ booked
  no_show_rate: number;
  // Money (HL-9)
  gmv_today_kobo: number;
  gmv_30d_kobo: number;
  net_revenue_30d_kobo: number;
  take_rate: number;
  avg_appointment_value_kobo: number;
  held_balance_kobo: number; // HL-9 escrow held until consult completion
  released_30d_kobo: number;
  refunded_30d_kobo: number;
  // HL-2 credential gating (VCN surfaced)
  vcn_pending_review: number;
  vets_active: number;
  vets_suspended: number;
  vcn_expiring_30d: number; // licences expiring soon → auto-suspend risk
  // HL-3 e-prescription discipline
  eprescriptions_30d: number;
  eprescriptions_pom_30d: number; // prescription-only-medicine items
  eprescription_flags_open: number; // audit anomalies awaiting review
  // governance / moderation
  services_pending_governance: number;
  moderation_open: number;
  // HL-10 payouts
  payouts_kyc_hold: number;
  // HL-11 emergency safety
  sos_routed_30d: number; // emergency requests routed to in-person care
  // Appointment mix
  appointment_mix: { label: string; appointments: number; gmv_kobo: number; share_pct: number }[]; // tele / home / clinic
  appointments_trend: { date: string; appointments: number }[];
  activity: VetActivity[];
};

// ── B · VCN credential audit queue (HL-2) ──────────────────────────────────────
export type VcnApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'needs_info'
  | 'approved'
  | 'suspended'
  | 'rejected';

export type VcnCredentialDoc = {
  kind: string; // VCN_licence | vet_degree (DVM) | CAC | clinic_premises_photo | indemnity_cover
  reference: string;
  expires_at?: string | null;
  verified: boolean;
};

export type VcnApplication = {
  id: string;
  vet_name_masked: string; // registered veterinary surgeon (NDPA — masked)
  clinic_name: string;
  vcn_licence_no: string; // VCN (Veterinary Council of Nigeria) practising licence number — surfaced
  vcn_register_year: number; // year first registered with VCN
  cac_rc_no: string;
  specialties: string[]; // small-animal | large-animal | avian | exotics | surgery | dermatology ...
  state: string;
  lga: string;
  status: VcnApplicationStatus;
  vcn_verified: boolean; // VCN licence check passed (HL-2)
  licence_expires_at: string | null; // drives auto-suspend (HL-2)
  docs: VcnCredentialDoc[];
  submitted_at: string | null;
  created_at: string;
};

export type VcnDecision = 'approve' | 'reject' | 'need_info' | 'suspend' | 'reinstate';

export type VcnDecisionResult = {
  id: string;
  status: VcnApplicationStatus;
  capability_granted: boolean; // on approve: idempotent provider (vet) capability grant
  audit_id: string;
  message: string;
};

// ── C · Service / fee governance ───────────────────────────────────────────────
export type VetServiceStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export type VetServiceMode = 'tele' | 'home' | 'clinic';

export type VetService = {
  id: string;
  service_name: string; // Tele-consult (general) | Home vaccination | Clinic surgery consult ...
  mode: VetServiceMode;
  category: string; // consult | vaccination | surgery | diagnostics | dental | grooming-health ...
  vet_masked: string;
  clinic_masked: string;
  duration_minutes: number;
  fee_kobo: number;
  platform_fee_pct: number; // take rate applied to this service
  status: VetServiceStatus;
  flagged_reason: string | null;
  created_at: string;
};

export type VetServiceGovernanceAction = 'approve' | 'reject' | 'suspend';

export type VetServiceGovernanceResult = {
  id: string;
  status: VetServiceStatus;
  audit_id: string;
  message: string;
};

// ── D · Appointment oversight ──────────────────────────────────────────────────
export type AppointmentStatus =
  | 'requested'
  | 'accepted'
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'rescheduled'
  | 'cancelled'
  | 'no_show';

export type PaymentState = 'held' | 'released' | 'refunded' | 'pending';

export type VetAppointment = {
  id: string;
  pet_name: string; // pet name (not PII)
  pet_species: string; // dog | cat | bird | rabbit | reptile ...
  owner_masked: string; // NDPA masked owner (HL-8)
  vet_masked: string;
  clinic_masked: string;
  mode: VetServiceMode; // tele | home | clinic
  service_summary: string;
  status: AppointmentStatus;
  payment_state: PaymentState; // HL-9 held→released→refunded
  fee_kobo: number;
  is_emergency: boolean; // HL-11 — SOS/emergency flag
  scheduled_at: string;
  created_at: string;
  updated_at: string;
};

export type VetAppointmentDetail = VetAppointment & {
  triage_summary: string | null; // schema-driven intake snapshot
  consult_note_present: boolean; // SOAP note persisted on completion
  eprescription_ref: string | null; // e-Rx emitted from this consult (HL-3)
  lab_order_ref: string | null;
  consent_on_file: boolean; // NDPA (HL-8)
  timeline: { step: string; label: string; actor_masked: string; audit_id: string; at: string }[];
};

// ── E · E-prescription audit (HL-3) ────────────────────────────────────────────
export type EprescriptionStatus =
  | 'issued'
  | 'sent_to_pharmacy'
  | 'verifying'
  | 'verified'
  | 'dispensed'
  | 'fulfilled'
  | 'rejected';

export type EprescriptionAuditItem = {
  id: string;
  appointment_ref: string;
  pet_name: string;
  pet_species: string;
  owner_masked: string; // NDPA masked (HL-8)
  vet_masked: string;
  vcn_licence_no: string; // prescriber VCN licence — surfaced (HL-2/HL-3)
  drug_summary: string; // e.g. "Amoxicillin 250mg ×14 (POM)"
  is_pom: boolean; // prescription-only medicine — POM gating (HL-3)
  is_controlled: boolean; // controlled substance — extra controls (HL-4; excluded at MVP)
  status: EprescriptionStatus;
  dispense_once_ok: boolean; // true ⇒ single dispense enforced server-side (HL-3)
  flagged: boolean; // audit anomaly (e.g. expired licence at issue, duplicate dispense attempt)
  flag_reason: string | null;
  issued_at: string;
  dispensed_at: string | null;
};

// ── F · Payouts (KYC-gated — HL-10) ────────────────────────────────────────────
export type VetPayoutStatus = 'pending' | 'approved' | 'paid' | 'kyc_hold' | 'rejected';

export type VetPayoutRecord = {
  id: string;
  vet_masked: string;
  clinic_masked: string;
  kyc_tier: string; // tier0..tier3
  kyc_verified: boolean;
  released_kobo: number; // released-to-provider gross over period (HL-9)
  fees_kobo: number;
  net_payable_kobo: number;
  payout_status: VetPayoutStatus;
  aml_flag: boolean; // AML check on settlement (HL-10)
  created_at: string;
};

export type VetPayoutDecision = 'approve' | 'reject';

export type VetPayoutDecisionResult = {
  id: string;
  payout_status: VetPayoutStatus;
  audit_id: string;
  message: string;
};

// ── G · Content / credential moderation ────────────────────────────────────────
export type ModerationStatus = 'open' | 'investigating' | 'resolved' | 'ignored';
export type ModerationSeverity = 'low' | 'medium' | 'high';

export type ModerationItem = {
  id: string;
  kind: string; // profile_claim | review_abuse | credential_mismatch | unlicensed_advice | image_violation
  subject_masked: string; // vet / clinic / reviewer under review (masked)
  summary: string;
  severity: ModerationSeverity;
  status: ModerationStatus;
  vcn_licence_no: string | null; // surfaced where a credential claim is in question
  reporter_masked: string | null;
  created_at: string;
};

export type ModerationAction = 'investigate' | 'resolve' | 'ignore' | 'suspend_provider';

export type ModerationResult = {
  id: string;
  status: ModerationStatus;
  audit_id: string;
  message: string;
};

// ── H · Reporting ──────────────────────────────────────────────────────────────
export type VetReportingData = {
  generated_at: string;
  period_label: string;
  gmv_kobo: number;
  net_revenue_kobo: number;
  appointments: number;
  tele_appointments: number;
  home_appointments: number;
  clinic_appointments: number;
  completion_rate: number;
  no_show_rate: number;
  refund_rate: number;
  eprescriptions: number; // HL-3
  pom_share: number; // share of e-Rx that are POM
  sos_routed: number; // HL-11 emergency routed in-person
  payouts_kyc_hold: number; // HL-10
  by_state: { state: string; appointments: number; gmv_kobo: number; share_pct: number }[];
  monthly: { month: string; gmv_kobo: number; net_kobo: number; appointments: number }[];
};
