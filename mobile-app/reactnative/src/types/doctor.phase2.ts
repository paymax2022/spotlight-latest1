// ── Doctor (Telemedicine, provider-side) — Phase 2 Domain Types ──────────────
// Phase 2 (advanced provider-side flows). ADDITIVE to `@/types/doctor` — Phase 1
// shapes are imported/reused, never duplicated. Money amounts are integers in
// minor units (kobo). Use `import type` for type-only imports.
//
// Domains: pharmacy substitution & delivery, refills, specialist referrals,
// advanced medical records, HMO claims, patient follow-up plans, ratings/reviews,
// payout reports, compliance dashboard.

import type {
  PatientSummary,
  DoctorPrescription,
  PrescriptionDrugItem,
  LabOrder,
  LabResult,
  SoapNote,
  DoctorAppointment,
  PayoutItem,
} from '@/types/doctor';

// Re-export the Phase 1 primitives Phase 2 screens lean on, so a screen can pull
// everything it needs from one import site.
export type {
  PatientSummary,
  DoctorPrescription,
  PrescriptionDrugItem,
  LabOrder,
  LabResult,
  SoapNote,
  DoctorAppointment,
  PayoutItem,
} from '@/types/doctor';

// ─── 1. Pharmacy substitution approval ───────────────────────────────────────

export type PharmacyFulfilmentStatus =
  | 'received'             // pharmacy received the prescription
  | 'substitute_requested' // pharmacy proposed a substitute, awaiting doctor
  | 'preparing'           // doctor approved / no substitution needed, dispensing
  | 'ready'               // ready for pickup / dispatch
  | 'dispensed'           // handed to courier / patient
  | 'cancelled';          // cancelled (e.g. substitute rejected, no stock)

export interface SubstituteDrug {
  originalName:    string;          // drug originally prescribed
  substituteName:  string;          // drug the pharmacy proposes instead
  dosage:          string;          // "500mg"
  reason:          string;          // "Original out of stock"
  priceDeltaKobo:  number;          // +/- difference vs original, in kobo
  pharmacistNote?: string;
}

export interface PharmacyFulfilment {
  id:              string;
  ref:             string;          // e.g. "PF-7C1B88"
  prescriptionId:  string;          // links to DoctorPrescription
  prescriptionRef: string;          // human ref, e.g. "RX-4F2A41"
  patient:         PatientSummary;
  pharmacyName:    string;
  status:          PharmacyFulfilmentStatus;
  requestedAt:     string;          // ISO datetime
  substitute?:     SubstituteDrug;  // present when status is substitute_requested
}

// ─── 2. Drug delivery tracking ───────────────────────────────────────────────

export type DeliveryStage =
  | 'confirmed'
  | 'dispensed'
  | 'picked_up'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'failed';

export interface DeliveryEvent {
  stage:     DeliveryStage;
  label:     string;            // human label, e.g. "Out for delivery"
  at:        string;            // ISO datetime
  note?:     string;            // "Courier assigned: Gokada"
  completed: boolean;           // true for reached stages, false for upcoming
}

export interface DrugDelivery {
  id:              string;
  ref:             string;          // e.g. "DLV-3D0F12"
  fulfilmentId:    string;          // links to PharmacyFulfilment
  prescriptionRef: string;
  patient:         PatientSummary;
  currentStage:    DeliveryStage;
  courier?:        string;          // "Gokada"
  trackingCode?:   string;          // courier tracking number
  addressMasked:   string;          // "12 Adeola Rd, Lekki …"
  etaLabel?:       string;          // "Today, 4–6 PM"
  feeKobo:         number;          // delivery fee in kobo
  timeline:        DeliveryEvent[];
}

// ─── 3. Refill approval ──────────────────────────────────────────────────────

export type RefillStatus = 'pending' | 'approved' | 'rejected';

export interface RefillRequest {
  id:               string;
  ref:              string;         // e.g. "RF-8C1B22"
  prescriptionId:   string;         // original prescription being refilled
  prescriptionRef:  string;
  patient:          PatientSummary;
  drugSummary:      string;         // "Amlodipine 5mg, Lisinopril 10mg"
  items:            PrescriptionDrugItem[];
  reason:           string;         // patient's stated reason
  requestedAt:      string;         // ISO datetime
  status:           RefillStatus;
  lastDispensedAt?: string;         // ISO date of previous dispense
  reviewedAt?:      string;         // ISO datetime
  rejectionReason?: string;
}

// ─── 4. Specialist referral ──────────────────────────────────────────────────

export type ReferralStatus =
  | 'draft'
  | 'sent'           // referral dispatched to specialist
  | 'accepted'       // specialist accepted
  | 'scheduled'      // appointment booked with specialist
  | 'completed'
  | 'declined';

export interface Specialist {
  id:          string;
  name:        string;
  initials:    string;
  avatarColor: string;
  specialty:   string;           // "Cardiology"
  hospital:    string;
  state?:      string;
}

export type ReferralAttachmentKind = 'note' | 'lab' | 'prescription';

export interface ReferralAttachment {
  kind:  ReferralAttachmentKind;
  id:    string;                 // id of the SoapNote / LabResult / Prescription
  label: string;                 // display label
}

export interface SpecialistReferral {
  id:           string;
  ref:          string;          // e.g. "REF-5A8E07"
  patient:      PatientSummary;
  specialist:   Specialist;
  reason:       string;
  urgency:      'routine' | 'urgent';
  status:       ReferralStatus;
  attachments:  ReferralAttachment[];
  createdAt:    string;          // ISO datetime
  scheduledAt?: string;          // ISO datetime when specialist visit booked
}

// ─── 5. Advanced medical records (aggregated hub) ────────────────────────────

export interface RecordDiagnosisEntry {
  id:          string;
  code:        string;           // ICD-lite code, "I10"
  label:       string;           // "Essential Hypertension"
  diagnosedAt: string;           // ISO date
  doctorName:  string;
  status:      'active' | 'resolved' | 'chronic';
}

export type RecordDocumentKind =
  | 'discharge_summary'
  | 'imaging'
  | 'referral_letter'
  | 'consent_form'
  | 'external_report';

export interface RecordDocument {
  id:         string;
  kind:       RecordDocumentKind;
  title:      string;
  fileName:   string;
  uploadedAt: string;            // ISO datetime
  source:     string;            // "Lagoon Medical Centre"
}

export type RecordAccessAction = 'viewed' | 'exported' | 'shared' | 'updated';

export interface RecordAccessEntry {
  id:      string;
  actor:   string;               // "Dr. Amaka Obi"
  role:    string;               // "Attending Physician"
  action:  RecordAccessAction;
  section: string;               // "Lab results"
  at:      string;               // ISO datetime
}

export interface PatientRecordHub {
  patient:       PatientSummary;
  consults:      SoapNote[];
  prescriptions: DoctorPrescription[];
  labOrders:     LabOrder[];
  labResults:    LabResult[];
  documents:     RecordDocument[];
  diagnoses:     RecordDiagnosisEntry[];
  referrals:     SpecialistReferral[];
  accessLog:     RecordAccessEntry[];
}

// ─── 6. HMO claim tracking ───────────────────────────────────────────────────

export type ClaimStatus =
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'disputed'
  | 'paid';

export interface ClaimLineItem {
  description: string;           // "Teleconsultation", "FBC"
  amountKobo:  number;
  covered:     boolean;
}

export interface ClaimEvent {
  status: ClaimStatus;
  label:  string;
  at:     string;                // ISO datetime
  note?:  string;
}

export interface HmoClaim {
  id:               string;
  ref:              string;      // e.g. "CLM-9F2A41"
  appointmentId:    string;
  patient:          PatientSummary;
  provider:         string;      // "Hygeia HMO"
  authCode?:        string;
  status:           ClaimStatus;
  claimedKobo:      number;      // total claimed
  approvedKobo:     number;      // amount approved (0 until decided)
  submittedAt:      string;      // ISO datetime
  decidedAt?:       string;      // ISO datetime
  lineItems:        ClaimLineItem[];
  timeline:         ClaimEvent[];
  rejectionReason?: string;
}

// ─── 7. Patient follow-up plans ──────────────────────────────────────────────

export type FollowUpKind = 'free' | 'paid';

export type FollowUpStatus =
  | 'scheduled'      // doctor-created plan, upcoming
  | 'requested'      // patient asked for a follow-up, awaiting doctor decision
  | 'approved'       // patient request approved
  | 'rejected'       // patient request rejected
  | 'completed'
  | 'cancelled';

export interface FollowUpPlan {
  id:               string;
  ref:              string;      // e.g. "FU-7C1B88"
  patient:          PatientSummary;
  appointmentId?:   string;      // originating consult, when applicable
  reason:           string;
  dueDate:          string;      // ISO date
  kind:             FollowUpKind;
  feeKobo:          number;      // 0 when free
  status:           FollowUpStatus;
  createdAt:        string;      // ISO datetime
  isPatientRequest: boolean;     // true when raised by the patient
  rejectionReason?: string;
}

// ─── 8. Doctor ratings & reviews ─────────────────────────────────────────────

export interface RatingBreakdown {
  stars: 1 | 2 | 3 | 4 | 5;
  count: number;
}

export interface DoctorReview {
  id:           string;
  patient:      PatientSummary;
  rating:       1 | 2 | 3 | 4 | 5;
  comment:      string;
  createdAt:    string;          // ISO datetime
  consultType:  string;          // "video" | "audio" | "chat" (display label)
  reported:     boolean;         // doctor flagged it as unfair
  doctorReply?: string;
}

export interface ReputationMetrics {
  avgResponseMins:   number;     // average first-response time
  completionRate:    number;     // 0–100 (% consults completed)
  satisfactionScore: number;     // 0–100
  rebookRate:        number;     // 0–100 (% patients who rebook)
}

export interface ReputationSummary {
  averageRating: number;         // 0–5
  totalReviews:  number;
  breakdown:     RatingBreakdown[]; // 5→1 stars
  metrics:       ReputationMetrics;
  reviews:       DoctorReview[];
}

// ─── 9. Payout reports (extends Phase 1 earnings) ────────────────────────────

export interface PayoutPeriodBreakdown {
  periodLabel:    string;        // "May 2026"
  consultCount:   number;
  grossKobo:      number;        // gross earnings before deductions
  commissionKobo: number;        // platform commission
  vatKobo:        number;        // VAT / tax withheld
  netKobo:        number;        // payable to doctor
}

export interface PayoutReport {
  rangeLabel:        string;     // "Jan – Jun 2026"
  grossKobo:         number;
  commissionKobo:    number;     // total platform commission
  vatKobo:           number;     // total VAT / tax
  netKobo:           number;     // total net payable
  commissionRatePct: number;     // e.g. 15
  vatRatePct:        number;     // e.g. 7.5
  consultCount:      number;
  periods:           PayoutPeriodBreakdown[];
  payouts:           PayoutItem[]; // reuse Phase 1 payout rows
}

// ─── 10. Compliance dashboard ────────────────────────────────────────────────

export type LicenceStatus = 'valid' | 'expiring_soon' | 'expired' | 'suspended';

export interface LicenceInfo {
  mdcnNumber:   string;
  status:       LicenceStatus;
  issuedAt:     string;          // ISO date
  expiresAt:    string;          // ISO date
  daysToExpiry: number;
}

export interface ConsentRecord {
  id:         string;
  patient:    PatientSummary;
  scope:      string;            // "Telemedicine consultation", "Data sharing"
  grantedAt:  string;            // ISO datetime
  expiresAt?: string;            // ISO datetime
  active:     boolean;
}

export type ComplianceAuditAction =
  | 'login'
  | 'record_access'
  | 'prescription_issued'
  | 'data_export'
  | 'settings_changed';

export interface ComplianceAuditEntry {
  id:     string;
  action: ComplianceAuditAction;
  detail: string;
  actor:  string;
  at:     string;                // ISO datetime
}

export type ComplianceAlertSeverity = 'info' | 'warning' | 'critical';

export interface ComplianceAlert {
  id:        string;
  severity:  ComplianceAlertSeverity;
  title:     string;
  body:      string;
  createdAt: string;             // ISO datetime
  resolved:  boolean;
}

export interface PolicyAcknowledgement {
  id:              string;
  policyKey:       string;       // "data_protection_2026"
  title:           string;
  version:         string;       // "v3.1"
  required:        boolean;
  acknowledged:    boolean;
  acknowledgedAt?: string;       // ISO datetime
}

export interface ComplianceDashboard {
  licence:          LicenceInfo;
  consents:         ConsentRecord[];
  auditEntries:     ComplianceAuditEntry[];
  alerts:           ComplianceAlert[];
  acknowledgements: PolicyAcknowledgement[];
}

// ─── Mutation inputs / results ───────────────────────────────────────────────
// `idempotencyKey` is required on every state-changing / money mutation. Hooks
// generate it; callers pass `Omit<Input, 'idempotencyKey'>`.

// 1. Pharmacy substitution
export interface ReviewSubstituteInput {
  fulfilmentId:   string;
  decision:       'approve' | 'reject';
  note?:          string;
  idempotencyKey: string;
}

export interface ReviewSubstituteResult {
  fulfilmentId: string;
  status:       PharmacyFulfilmentStatus;
}

// 3. Refill approval
export interface ReviewRefillInput {
  refillId:         string;
  decision:         'approve' | 'reject';
  rejectionReason?: string;
  idempotencyKey:   string;
}

export interface ReviewRefillResult {
  refillId: string;
  status:   RefillStatus;
}

// 4. Specialist referral
export interface CreateReferralInput {
  patientId:      string;
  specialistId:   string;
  reason:         string;
  urgency:        SpecialistReferral['urgency'];
  attachments:    ReferralAttachment[];
  idempotencyKey: string;
}

export interface CreateReferralResult {
  referralId: string;
  ref:        string;
  status:     ReferralStatus;
}

// 6. HMO claim
export interface SubmitClaimInput {
  appointmentId:  string;
  provider:       string;
  authCode?:      string;
  lineItems:      ClaimLineItem[];
  idempotencyKey: string;
}

export interface SubmitClaimResult {
  claimId: string;
  ref:     string;
  status:  ClaimStatus;
}

export interface DisputeClaimInput {
  claimId:        string;
  reason:         string;
  idempotencyKey: string;
}

export interface DisputeClaimResult {
  claimId: string;
  status:  ClaimStatus;
}

// 7. Patient follow-up plans
export interface CreateFollowUpInput {
  patientId:      string;
  appointmentId?: string;
  reason:         string;
  dueDate:        string;        // ISO date
  kind:           FollowUpKind;
  feeKobo:        number;        // 0 when free
  idempotencyKey: string;
}

export interface CreateFollowUpResult {
  followUpId: string;
  ref:        string;
  status:     FollowUpStatus;
}

export interface ReviewFollowUpRequestInput {
  followUpId:       string;
  decision:         'approve' | 'reject';
  rejectionReason?: string;
  idempotencyKey:   string;
}

export interface ReviewFollowUpRequestResult {
  followUpId: string;
  status:     FollowUpStatus;
}

// 8. Ratings / reviews
export interface ReportReviewInput {
  reviewId:       string;
  reason:         string;
  idempotencyKey: string;
}

export interface ReportReviewResult {
  reviewId: string;
  reported: boolean;
}

// 10. Compliance
export interface AcknowledgePolicyInput {
  policyKey:      string;
  version:        string;
  idempotencyKey: string;
}

export interface AcknowledgePolicyResult {
  policyKey:    string;
  acknowledged: boolean;
}
