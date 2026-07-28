// ── Doctor (Telemedicine, provider-side) — Batch 6 Domain Types ──────────────
// Batch 6 = spec sections W · X · Y · Z — Medical Records · Notifications ·
// Earnings/Wallet/Payout · Ratings/Reviews/Reputation. This is CONSOLIDATED and
// leans HEAVILY on Phase 1 / Phase 2 / Phase 3 / Section B work. Earlier shapes
// are imported and re-exported, NEVER duplicated. Money amounts are integers in
// minor units (kobo). Use `import type` for type-only imports.
//
// Sections:
//   W — Medical Records: REUSE PatientRecordHub / RecordDocument /
//       RecordAccessEntry / RecordDiagnosisEntry (Phase 2) + the dependent/pet
//       record types (Phase 3 / Batch 5). ADD a records dashboard, per-patient
//       category index, record-access restriction warnings and download/share
//       descriptors.
//   X — Notifications: REUSE DoctorNotification / DoctorNotificationType
//       (Phase 1). ADD a richer notification-kind superset, severity/cta/group,
//       category filters and notification preference rows.
//   Y — Earnings / Wallet / Payout: REUSE EarningsSummary / PayoutItem
//       (Phase 1) + PayoutReport / PayoutPeriodBreakdown (Phase 2) + the
//       Section B BankAccount. ADD an earnings breakdown by source/period, a
//       wallet balance, payout detail, invoices, commission breakdown, a
//       tax/VAT report and settlement disputes.
//   Z — Ratings / Reviews / Reputation: REUSE ReputationSummary / DoctorReview /
//       RatingBreakdown / ReputationMetrics (Phase 2) + QualityAnalytics
//       (Phase 3). ADD per-consult feedback, a composite quality score, a
//       ranking insight, improvement recommendations and review disputes.

import type {
  // ── REUSE: Phase 1 primitives ──
  PatientSummary,
  DoctorNotification,
  DoctorNotificationType,
  EarningsSummary,
  PayoutItem,
} from '@/types/doctor';
// ── REUSE: Phase 2 rich records / reputation / payout shapes ──
import type {
  PatientRecordHub,
  RecordDocument,
  RecordDocumentKind,
  RecordAccessEntry,
  RecordAccessAction,
  RecordDiagnosisEntry,
  ReputationSummary,
  DoctorReview,
  RatingBreakdown,
  ReputationMetrics,
  PayoutReport,
  PayoutPeriodBreakdown,
} from '@/types/doctor.phase2';
// ── REUSE: Phase 3 analytics ──
import type { QualityAnalytics } from '@/types/doctor.phase3';
// ── REUSE: Section B bank account (do NOT redeclare) ──
import type { BankAccount } from '@/types/doctor.profile';

// Re-export the primitives Batch 6 screens lean on, so a screen can pull
// everything it needs from one import site.
export type {
  PatientSummary,
  DoctorNotification,
  DoctorNotificationType,
  EarningsSummary,
  PayoutItem,
} from '@/types/doctor';
export type {
  PatientRecordHub,
  RecordDocument,
  RecordDocumentKind,
  RecordAccessEntry,
  RecordAccessAction,
  RecordDiagnosisEntry,
  ReputationSummary,
  DoctorReview,
  RatingBreakdown,
  ReputationMetrics,
  PayoutReport,
  PayoutPeriodBreakdown,
} from '@/types/doctor.phase2';
export type { QualityAnalytics } from '@/types/doctor.phase3';
export type { BankAccount } from '@/types/doctor.profile';

// ═══════════════════════════════════════════════════════════════════════════
// SECTION W — MEDICAL RECORDS (18)
// ═══════════════════════════════════════════════════════════════════════════
// Consolidated. The per-patient consultation / prescription / lab / document /
// imaging / allergy / medication / diagnosis / care-plan / referral / HMO /
// dependent / pet histories are all VIEWS over the Phase 2 PatientRecordHub and
// the dependent/pet record types — modelled here as a category index rather than
// 18 separate shapes. ADD: a records dashboard, a category index, restriction
// warnings, and download/share descriptors.

// ─── W.1 Record categories (the 18 record sub-screens collapse to these) ──────
export type RecordCategory =
  | 'consultations'
  | 'prescriptions'
  | 'lab_results'
  | 'documents'
  | 'imaging'
  | 'allergies'
  | 'medications'
  | 'diagnoses'
  | 'care_plans'
  | 'referrals'
  | 'hmo'
  | 'dependents'
  | 'pets';

// ─── W.2 Doctor records dashboard (recent patients + counts + quick links) ────
export interface RecordCategoryCount {
  category:    RecordCategory;
  count:       number;
  lastUpdated?: string;          // ISO datetime of the most recent entry
}

export interface RecentPatientRecord {
  patient:      PatientSummary;
  lastVisitAt:  string;          // ISO datetime
  recordCount:  number;          // total records on file
  hasRestricted: boolean;        // any access-controlled section
}

export interface DoctorRecordsDashboard {
  totalPatients:   number;
  recentPatients:  RecentPatientRecord[];
  categoryCounts:  RecordCategoryCount[]; // aggregate across patients
  pendingShares:   number;       // share-with-specialist requests in flight
}

// ─── W.3 Per-patient category index (counts + lastUpdated per category) ───────
export interface PatientRecordIndexEntry {
  category:     RecordCategory;
  count:        number;
  lastUpdated?: string;          // ISO datetime
  restricted:   boolean;         // requires elevated access
}

export interface PatientRecordIndex {
  patient:    PatientSummary;
  entries:    PatientRecordIndexEntry[];
  updatedAt:  string;            // ISO datetime
}

// ─── W.4 Record access restriction / warning ─────────────────────────────────
export type RecordRestrictionLevel = 'open' | 'consent_required' | 'restricted' | 'blocked';

export interface RecordRestriction {
  category:   RecordCategory;
  level:      RecordRestrictionLevel;
  reason:     string;            // "Mental-health notes require patient consent"
  canRequestAccess: boolean;     // doctor may raise an access request
}

export interface RestrictedRecordWarning {
  patientId:   string;
  category:    RecordCategory;
  level:       RecordRestrictionLevel;
  message:     string;
  detectedAt:  string;           // ISO datetime
}

// ─── W.5 Download / share descriptors ────────────────────────────────────────
export type RecordExportFormat = 'pdf' | 'fhir_json' | 'csv';

export interface RecordDownloadDescriptor {
  patientId:   string;
  categories:  RecordCategory[]; // empty = full record
  format:      RecordExportFormat;
  fileName:    string;
  url?:        string;           // Phase C: signed download URL
  generatedAt: string;           // ISO datetime
}

export type RecordShareStatus = 'pending' | 'sent' | 'viewed' | 'revoked' | 'expired';

export interface RecordShare {
  id:            string;
  ref:           string;         // e.g. "SHR-7C1B88"
  patientId:     string;
  patientName:   string;
  specialistId:  string;
  specialistName: string;
  categories:    RecordCategory[];
  status:        RecordShareStatus;
  sharedAt:      string;         // ISO datetime
  expiresAt?:    string;         // ISO datetime
  note?:         string;
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION X — NOTIFICATIONS (17)
// ═══════════════════════════════════════════════════════════════════════════
// REUSES DoctorNotification / DoctorNotificationType. The 17 notification
// sub-screens are KINDS of one notification, not separate shapes: a richer
// `DoctorNotificationKind` superset drives icon/severity/cta, and a
// `RichNotification` composes the Phase 1 DoctorNotification with kind/category/
// severity/cta/group.

// ─── X.1 Notification kind superset (additive to DoctorNotificationType) ──────
export type DoctorNotificationKind =
  | 'new_appointment'
  | 'appointment_cancelled'
  | 'patient_waiting'
  | 'new_chat_message'
  | 'prescription_refill_request'
  | 'lab_result_ready'
  | 'critical_lab_result'
  | 'pharmacy_substitution_request'
  | 'drug_delivery_update'
  | 'hmo_approval'
  | 'hmo_rejection'
  | 'payout'
  | 'compliance'
  | 'licence_renewal'
  | 'rating_review'
  | 'support_response';

// ─── X.2 Notification category (grouping + filters) ──────────────────────────
export type NotificationCategory =
  | 'appointments'
  | 'messages'
  | 'clinical'
  | 'pharmacy'
  | 'hmo'
  | 'earnings'
  | 'compliance'
  | 'reputation'
  | 'support';

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'critical';

export type NotificationFilter = 'all' | 'unread' | NotificationCategory;

// ─── X.3 Call-to-action descriptor (deep-link target) ────────────────────────
export interface NotificationCta {
  label:  string;                // "View appointment"
  route:  string;                // expo-router path, e.g. "/(doctor)/appointments/123"
}

// ─── X.4 Rich notification (COMPOSES Phase 1 DoctorNotification) ─────────────
export interface RichNotification extends DoctorNotification {
  kind:      DoctorNotificationKind;
  category:  NotificationCategory;
  severity:  NotificationSeverity;
  cta?:      NotificationCta;
  groupKey?: string;             // dedupe / collapse key, e.g. "thread-7C1B88"
}

// ─── X.5 Notification group (collapsed by category / day) ────────────────────
export interface NotificationGroup {
  key:           string;         // category id or "YYYY-MM-DD"
  label:         string;         // "Today", "Appointments"
  unreadCount:   number;
  notifications: RichNotification[];
}

// ─── X.6 Notification preferences (per category × channel) ───────────────────
export interface NotificationPreference {
  category:  NotificationCategory;
  label:     string;
  push:      boolean;
  email:     boolean;
  sms:       boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION Y — EARNINGS, WALLET & PAYOUT (19)
// ═══════════════════════════════════════════════════════════════════════════
// REUSES EarningsSummary / PayoutItem (Phase 1) + PayoutReport /
// PayoutPeriodBreakdown (Phase 2) + the Section B BankAccount. ADD an earnings
// breakdown by source/period, a wallet balance, payout detail, invoices,
// commission breakdown, tax/VAT report and settlement disputes. All money kobo.

// ─── Y.1 Earnings breakdown by source × period ───────────────────────────────
export type EarningsSource = 'consult' | 'hmo' | 'vet' | 'bonus';
export type EarningsPeriod = 'today' | 'week' | 'month';

export interface EarningsSourceAmount {
  source:      EarningsSource;
  amountKobo:  number;
  consultCount: number;
}

export interface EarningsPeriodTotals {
  period:      EarningsPeriod;
  grossKobo:   number;
  bySource:    EarningsSourceAmount[];
}

export interface EarningsBreakdown {
  todayKobo:    number;
  weekKobo:     number;
  monthKobo:    number;
  lifetimeKobo: number;
  periods:      EarningsPeriodTotals[]; // today / week / month
}

// ─── Y.2 Wallet balance (available / pending / ledger) ───────────────────────
export interface WalletLedgerEntry {
  id:          string;
  label:       string;           // "Consult fee — TM-9F2A41", "Payout — PO-2026-014"
  amountKobo:  number;           // +credit / -debit
  balanceKobo: number;           // running balance after this entry
  at:          string;           // ISO datetime
}

export interface WalletBalance {
  availableKobo: number;         // withdrawable
  pendingKobo:   number;         // not yet cleared
  ledgerKobo:    number;         // total ledger balance (available + pending)
  ledger:        WalletLedgerEntry[];
}

// ─── Y.3 Payout detail (extends the Phase 1 PayoutItem row) ──────────────────
export type PayoutDetailStatus = 'pending' | 'processing' | 'paid' | 'failed';

export interface PayoutDetail {
  id:            string;
  ref:           string;         // e.g. "PO-2026-014"
  amountKobo:    number;
  feeKobo:       number;         // payout processing fee
  netKobo:       number;         // amountKobo - feeKobo
  status:        PayoutDetailStatus;
  consultCount:  number;
  periodLabel:   string;
  bankAccount:   BankAccount;    // REUSE Section B BankAccount
  requestedAt:   string;         // ISO datetime
  paidAt?:       string;         // ISO datetime
  failureReason?: string;        // present when status === 'failed'
  sessionId?:    string;         // provider settlement session id (Phase C)
}

// ─── Y.4 Invoices ────────────────────────────────────────────────────────────
export interface InvoiceLineItem {
  description: string;           // "Teleconsultation — Tunde A."
  quantity:    number;
  unitKobo:    number;
  amountKobo:  number;           // quantity * unitKobo
}

export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'void';

export interface Invoice {
  id:          string;
  ref:         string;           // e.g. "INV-2026-018"
  issuedAt:    string;           // ISO date
  periodLabel: string;           // "May 2026"
  lineItems:   InvoiceLineItem[];
  subtotalKobo: number;
  vatKobo:     number;
  totalKobo:   number;
  status:      InvoiceStatus;
}

// ─── Y.5 Commission breakdown ────────────────────────────────────────────────
export interface CommissionTier {
  source:           EarningsSource;
  grossKobo:        number;
  commissionRatePct: number;     // e.g. 15
  commissionKobo:   number;
  netKobo:          number;
}

export interface CommissionBreakdown {
  rangeLabel:      string;       // "Jun 2026"
  grossKobo:       number;
  commissionKobo:  number;
  netKobo:         number;
  tiers:           CommissionTier[]; // per source
}

// ─── Y.6 Tax / VAT report ────────────────────────────────────────────────────
export interface TaxVatReport {
  rangeLabel:    string;         // "Jan – Jun 2026 (FY2026)"
  grossKobo:     number;
  vatableKobo:   number;         // portion subject to VAT
  vatKobo:       number;         // VAT withheld
  vatRatePct:    number;         // e.g. 7.5
  whtKobo:       number;         // withholding tax
  whtRatePct:    number;         // e.g. 5
  tin?:          string;         // doctor TIN
  vatNumber?:    string;
}

// ─── Y.7 Settlement dispute ──────────────────────────────────────────────────
export type SettlementDisputeStatus = 'open' | 'under_review' | 'resolved' | 'rejected';

export interface SettlementDispute {
  id:           string;
  ref:          string;          // e.g. "DSP-2026-004"
  payoutId:     string;
  payoutRef:    string;
  amountKobo:   number;          // disputed amount
  reason:       string;
  status:       SettlementDisputeStatus;
  raisedAt:     string;          // ISO datetime
  resolvedAt?:  string;          // ISO datetime
  resolutionNote?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION Z — RATINGS, REVIEWS & REPUTATION (12)
// ═══════════════════════════════════════════════════════════════════════════
// REUSES ReputationSummary / DoctorReview / RatingBreakdown / ReputationMetrics
// (Phase 2) + QualityAnalytics (Phase 3). The rating dashboard, patient reviews,
// vet client reviews and the response-time / completion-rate / satisfaction
// metric tiles are all VIEWS over those shapes. ADD per-consult feedback, a
// composite quality score, a ranking insight, improvement recommendations and
// review disputes.

// ─── Z.1 Per-consult feedback ────────────────────────────────────────────────
export type ConsultFeedbackChannel = 'human' | 'vet';

export interface ConsultationFeedback {
  id:          string;
  consultRef:  string;           // e.g. "TM-9F2A41" / "VET-9F2A41"
  patient:     PatientSummary;
  channel:     ConsultFeedbackChannel; // human vs vet client
  rating:      1 | 2 | 3 | 4 | 5;
  comment:     string;
  tags:        string[];         // "Punctual", "Clear explanation"
  createdAt:   string;           // ISO datetime
}

// ─── Z.2 Composite quality score ─────────────────────────────────────────────
export type QualityScoreGrade = 'excellent' | 'good' | 'fair' | 'needs_attention';

export interface QualityScoreFactor {
  key:        string;            // "rating", "response_time", "completion"
  label:      string;            // "Patient rating"
  scorePct:   number;            // 0–100
  weightPct:  number;            // contribution weight (0–100)
}

export interface QualityScore {
  scorePct:   number;            // 0–100 composite
  grade:      QualityScoreGrade;
  factors:    QualityScoreFactor[];
  updatedAt:  string;            // ISO datetime
}

// ─── Z.3 Ranking insight (percentile + peer compare) ─────────────────────────
export interface RankingPeerStat {
  label:       string;           // "Avg rating", "Response time"
  yourValue:   number;
  peerMedian:  number;
  unit:        string;           // "★", "min", "%"
  betterIsHigh: boolean;         // direction of "good"
}

export interface RankingInsight {
  specialty:        string;      // "General Practice"
  percentile:       number;      // 0–100 (top X%)
  rankLabel:        string;      // "Top 5% of GPs on Spotlight"
  peerStats:        RankingPeerStat[];
  movement:         'up' | 'down' | 'flat'; // vs last period
  movementPlaces:   number;      // ranks gained/lost
}

// ─── Z.4 Improvement recommendation ──────────────────────────────────────────
export type ImprovementPriority = 'high' | 'medium' | 'low';

export interface ImprovementRecommendation {
  id:        string;
  title:     string;             // "Reduce first-response time"
  detail:    string;
  priority:  ImprovementPriority;
  metricKey: string;             // ties to a QualityScoreFactor / metric
  potentialUpliftPct?: number;   // estimated score uplift
}

// ─── Z.5 Review dispute ──────────────────────────────────────────────────────
export type ReviewDisputeReason =
  | 'not_my_patient'
  | 'factually_incorrect'
  | 'abusive_language'
  | 'spam'
  | 'conflict_of_interest';

export type ReviewDisputeStatus = 'open' | 'under_review' | 'upheld' | 'rejected';

export interface ReviewDispute {
  id:          string;
  ref:         string;           // e.g. "RVD-2026-007"
  reviewId:    string;
  reason:      ReviewDisputeReason;
  detail:      string;
  status:      ReviewDisputeStatus;
  raisedAt:    string;           // ISO datetime
  decidedAt?:  string;           // ISO datetime
  decisionNote?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// MUTATION INPUTS / RESULTS
// ═══════════════════════════════════════════════════════════════════════════
// `idempotencyKey` is required on every state-changing mutation. Hooks generate
// it; callers pass `Omit<Input, 'idempotencyKey'>`.

// ─── Section W ────────────────────────────────────────────────────────────────
export interface DownloadPatientRecordInput {
  patientId:      string;
  categories:     RecordCategory[]; // empty = full record
  format:         RecordExportFormat;
  idempotencyKey: string;
}

export interface DownloadPatientRecordResult {
  descriptor: RecordDownloadDescriptor;
}

export interface SharePatientRecordInput {
  patientId:      string;
  specialistId:   string;
  categories:     RecordCategory[];
  note?:          string;
  expiresAt?:     string;        // ISO datetime
  idempotencyKey: string;
}

export interface SharePatientRecordResult {
  shareId: string;
  ref:     string;
  status:  RecordShareStatus;
}

export interface RequestRecordAccessInput {
  patientId:      string;
  category:       RecordCategory;
  reason:         string;
  idempotencyKey: string;
}

export interface RequestRecordAccessResult {
  patientId: string;
  category:  RecordCategory;
  requested: boolean;
}

// ─── Section X ────────────────────────────────────────────────────────────────
export interface MarkNotificationReadInput {
  notificationId: string;
  idempotencyKey: string;
}

export interface MarkNotificationReadResult {
  notificationId: string;
  read:           boolean;
}

export interface MarkAllNotificationsReadInput {
  category?:      NotificationCategory; // omit = all categories
  idempotencyKey: string;
}

export interface MarkAllNotificationsReadResult {
  markedCount: number;
}

export interface UpdateNotificationPrefsInput {
  preferences:    NotificationPreference[];
  idempotencyKey: string;
}

export interface UpdateNotificationPrefsResult {
  preferences: NotificationPreference[];
}

// ─── Section Y ────────────────────────────────────────────────────────────────
export interface WithdrawEarningsInput {
  amountKobo:     number;
  bankAccount?:   BankAccount;   // omit = use saved payout account
  idempotencyKey: string;
}

export interface WithdrawEarningsResult {
  payoutId: string;
  ref:      string;
  status:   PayoutDetailStatus;
}

export interface UpdatePayoutBankAccountInput {
  bankName:       string;
  bankCode?:      string;
  accountNumber:  string;
  idempotencyKey: string;
}

export interface UpdatePayoutBankAccountResult {
  account: BankAccount;          // resolved name + isVerified (REUSE Section B)
}

export interface RaiseSettlementDisputeInput {
  payoutId:       string;
  amountKobo:     number;
  reason:         string;
  idempotencyKey: string;
}

export interface RaiseSettlementDisputeResult {
  disputeId: string;
  ref:       string;
  status:    SettlementDisputeStatus;
}

// ─── Section Z ────────────────────────────────────────────────────────────────
export interface DisputeReviewInput {
  reviewId:       string;
  reason:         ReviewDisputeReason;
  detail:         string;
  idempotencyKey: string;
}

export interface DisputeReviewResult {
  disputeId: string;
  ref:       string;
  status:    ReviewDisputeStatus;
}

export interface RequestReviewRemovalInput {
  reviewId:       string;
  reason:         string;
  idempotencyKey: string;
}

export interface RequestReviewRemovalResult {
  reviewId:  string;
  requested: boolean;
}
