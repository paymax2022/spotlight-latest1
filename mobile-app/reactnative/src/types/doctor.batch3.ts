// ── Doctor (Telemedicine, provider-side) — Batch 3 Domain Types ──────────────
// Batch 3 = spec sections K, L, M, N. ADDITIVE to `@/types/doctor`,
// `@/types/doctor.phase2` (and the other doctor type files) — those shapes are
// imported/reused, never duplicated. Money amounts are integers in minor units
// (kobo). Use `import type` for type-only imports.
//
// APPROACH IS CONSOLIDATED: granular variants (each warning kind, each lifecycle
// step, each status, alternatives, edit/cancel/expired, audit) are modelled as
// states/data on top of the existing entities, not as separate entities. The
// Frontend renders all variants from the same shapes.
//
// Sections:
//   K — E-Prescription                 (extends PrescriptionDrugItem → RxDrugLine; adds warnings/lifecycle/issue/audit).
//   L — Pharmacy & Drug Fulfilment     (REUSES Phase 2 pharmacy/delivery/substitute; adds Pharmacy/stock/messages).
//   M — Lab Test Ordering              (extends LabTest/LabOrder; adds catalogue/package/provider/options).
//   N — Lab Result Review             (extends LabResult/LabResultValue; adds interpretation/compare/inbox).

import type {
  PatientSummary,
  PrescriptionDrugItem,
  DoctorPrescription,
  PrescriptionDraft,
  LabTest,
  LabOrder,
  LabOrderStatus,
  LabResult,
  LabResultValue,
} from '@/types/doctor';
import type {
  PharmacyFulfilment,
  PharmacyFulfilmentStatus,
  SubstituteDrug,
  DrugDelivery,
  DeliveryStage,
  DeliveryEvent,
  RefillRequest,
  RefillStatus,
} from '@/types/doctor.phase2';

// Re-export the primitives Batch 3 screens lean on, so a screen can pull
// everything it needs from one import site.
export type {
  PatientSummary,
  PrescriptionDrugItem,
  DoctorPrescription,
  PrescriptionDraft,
  LabTest,
  LabOrder,
  LabOrderStatus,
  LabResult,
  LabResultValue,
} from '@/types/doctor';
export type {
  PharmacyFulfilment,
  PharmacyFulfilmentStatus,
  SubstituteDrug,
  DrugDelivery,
  DeliveryStage,
  DeliveryEvent,
  RefillRequest,
  RefillStatus,
} from '@/types/doctor.phase2';

// ═══════════════════════════════════════════════════════════════════════════
// SECTION K — E-PRESCRIPTION (45)
// ═══════════════════════════════════════════════════════════════════════════
// Extends Phase 1 `PrescriptionDrugItem` ADDITIVELY via a richer `RxDrugLine`
// that COMPOSES the base item (it is never modified). Safety warnings are a
// `RxWarning` union rendered as severity-toned banners — not separate entities.
// The prescription lifecycle (draft/preview/signed/issued/expired/cancelled) is
// a single `status` field; `IssuedPrescription` adds the QR/verification payload.
// Refill request/approve/reject REUSES the Phase 2 `RefillRequest` / `reviewRefill`.

// ─── Drug catalogue entry (strengths / dosage forms / alternatives) ──────────

export type DosageForm =
  | 'tablet'
  | 'capsule'
  | 'syrup'
  | 'suspension'
  | 'injection'
  | 'cream'
  | 'ointment'
  | 'drops'
  | 'inhaler'
  | 'suppository';

// Whether to take the drug before / after / with food, or no restriction.
export type FoodTiming = 'before_food' | 'after_food' | 'with_food' | 'any';

// A richer catalogue entry than the Phase 1 `DRUG_CATALOGUE` rows — carries
// strengths, dosage forms and a controlled/OTC flag for the warning engine.
export interface DrugCatalogueEntry {
  id:           string;
  name:         string;            // generic / display name, e.g. "Amoxicillin"
  strengths:    string[];          // ["250mg", "500mg"]
  forms:        DosageForm[];      // available dosage forms
  isControlled: boolean;           // controlled substance (drives controlled warning)
  isOtc:        boolean;           // over-the-counter
  classLabel?:  string;            // drug class, e.g. "Penicillin antibiotic"
}

// A generic / brand alternative for a drug (alternatives lookup).
export interface DrugAlternative {
  id:           string;
  forDrug:      string;            // the drug this is an alternative to
  name:         string;            // the alternative drug name
  kind:         'generic' | 'brand';
  strength?:    string;            // matched strength, e.g. "500mg"
  priceKobo?:   number;            // indicative unit price in kobo
  note?:        string;            // "Same active ingredient"
}

// ─── Safety warnings (consolidated union) ────────────────────────────────────

// Every safety warning kind the prescription engine surfaces. Modelled as one
// union (not separate entities) so the UI renders all variants from one shape.
export type RxWarningKind =
  | 'interaction'                 // drug–drug interaction
  | 'duplicate'                   // duplicate therapy / same class twice
  | 'contraindication'            // clashes with a condition / medication
  | 'controlled'                  // controlled substance notice
  | 'pregnancy_breastfeeding'     // unsafe in pregnancy / breastfeeding
  | 'paediatric_dose'             // paediatric dosing caution
  | 'elderly_dose';              // geriatric dosing caution

export type RxWarningSeverity = 'info' | 'warning' | 'critical';

// A single safety warning attached to a prescription (severity-toned banner).
export interface RxWarning {
  id:       string;
  kind:     RxWarningKind;
  severity: RxWarningSeverity;
  drug:     string;               // the drug the warning concerns
  title:    string;               // short banner title
  detail:   string;               // explanation / recommended action
  relatedTo?: string;             // the other drug / condition involved
}

// ─── Rich drug line (composes Phase 1 PrescriptionDrugItem) ──────────────────

// The rich prescription line — COMPOSES the Phase 1 `PrescriptionDrugItem` and
// adds the e-prescription fields ADDITIVELY. The base item (and
// `CreatePrescriptionInput`) is untouched.
export interface RxDrugLine {
  base:             PrescriptionDrugItem;  // reuse Phase 1 name/dosage/route/frequency/duration/notes
  strength:         string;                // "500mg" (explicit, may differ from base.dosage label)
  dosageForm:       DosageForm;            // tablet / syrup / …
  route:            string;                // reuse base.route value (kept explicit for the builder)
  beforeAfterFood:  FoodTiming;
  specialInstruction?: string;             // free-text patient instruction
  quantity:         number;                // dispense quantity (units)
  warnings:         RxWarning[];           // safety warnings for this line
}

// ─── Prescription lifecycle ──────────────────────────────────────────────────

// The e-prescription lifecycle status. "preview" is the pre-sign review, "signed"
// is digitally signed (but not yet sent), "issued" is sent/active, "expired" and
// "cancelled" are terminal. Phase 1's `DoctorPrescription['status']`
// (draft/issued/dispensed) is the coarse legacy view; this is the richer one.
export type RxLifecycleStatus =
  | 'draft'
  | 'preview'
  | 'signed'
  | 'issued'
  | 'expired'
  | 'cancelled';

// A digital signature applied at issue time.
export interface RxDigitalSignature {
  signedBy:    string;            // doctor name
  mdcnNumber:  string;            // MDCN registration number
  signedAt:    string;            // ISO datetime
  signatureId: string;           // opaque signature reference
}

// One entry in the prescription audit trail (created/edited/signed/issued/
// shared/sent-to-pharmacy/cancelled/expired). Consolidated as data, not entities.
export type RxAuditAction =
  | 'created'
  | 'edited'
  | 'previewed'
  | 'signed'
  | 'issued'
  | 'shared'
  | 'sent_to_pharmacy'
  | 'refill_requested'
  | 'cancelled'
  | 'expired';

export interface RxAuditEntry {
  id:     string;
  action: RxAuditAction;
  actor:  string;                 // "Dr. Amaka Obi"
  at:     string;                 // ISO datetime
  detail?: string;
}

// The issued e-prescription — COMPOSES the Phase 1 `DoctorPrescription` and adds
// the richer lines, lifecycle, signature, QR/verification payload and audit. The
// base `DoctorPrescription` (and `createPrescription`) is untouched.
export interface IssuedPrescription {
  base:             DoctorPrescription;    // reuse Phase 1 id/ref/appointmentId/patient/doctorName/diagnosis/items/issuedAt/status
  lines:            RxDrugLine[];          // richer drug lines (parallel to base.items)
  lifecycle:        RxLifecycleStatus;     // richer lifecycle status
  warnings:         RxWarning[];           // prescription-level aggregated warnings
  signature?:       RxDigitalSignature;    // present once signed/issued
  qrPayload?:       string;                // QR content encoding the verification code
  verificationCode?: string;              // human-readable code for pharmacy verification
  validUntil?:      string;                // ISO date — drives the expired state
  pharmacyName?:    string;                // pharmacy it was sent to (when applicable)
  audit:            RxAuditEntry[];        // audit trail entries
}

// ─── Pharmacy send / fulfilment option (Section K send step) ──────────────────

// How an issued prescription is fulfilled (drives the send-to-pharmacy options).
export type RxFulfilmentOption =
  | 'send_to_pharmacy'            // send to a specific partner pharmacy
  | 'patient_choice'             // let the patient pick a pharmacy
  | 'print'                      // print / download for offline use
  | 'share';                     // share the code with the patient

// ═══════════════════════════════════════════════════════════════════════════
// SECTION L — PHARMACY & DRUG FULFILMENT (21)
// ═══════════════════════════════════════════════════════════════════════════
// Mostly REUSES Phase 2 (`PharmacyFulfilment`, `DrugDelivery`, `SubstituteDrug`,
// `reviewSubstitute`). Adds the MISSING pieces: a `Pharmacy` directory entry,
// drug stock availability, a lightweight pharmacy clarification thread, an
// extended fulfilment status (partial/awaiting-payment/awaiting-HMO/awaiting-
// delivery), delivery alerts, patient-received confirmation and complaints.

// A pharmacy directory entry (nearby / preferred lookup).
export interface Pharmacy {
  id:           string;
  name:         string;
  address:      string;
  verified:     boolean;          // verified partner pharmacy
  distanceKm:   number;           // distance from the patient
  rating:       number;           // 0–5
  isPreferred:  boolean;          // patient's preferred pharmacy
  hasStock:     boolean;          // stock available for the current rx
  deliversToday: boolean;         // same-day delivery available
  phone?:       string;
}

// Per-drug stock availability at a pharmacy (drug-unavailable alert source).
export type StockLevel = 'in_stock' | 'low_stock' | 'out_of_stock';

export interface DrugStock {
  pharmacyId:   string;
  drugName:     string;
  strength:     string;
  level:        StockLevel;
  unitPriceKobo?: number;         // unit price in kobo when known
  note?:        string;           // "Restock expected in 2 days"
}

// Extended fulfilment status — ADDITIVE superset of the Phase 2
// `PharmacyFulfilmentStatus` with the partial/payment/HMO/delivery states modelled
// explicitly so the UI does not need separate entities. The Phase 2 status is
// reused for the core states; this adds the awaiting-* and partial states.
export type FulfilmentStatusExt =
  | PharmacyFulfilmentStatus      // reuse the Phase 2 union (received…cancelled)
  | 'partial'                     // partially dispensed (some items unavailable)
  | 'awaiting_payment'           // waiting on patient payment
  | 'awaiting_hmo'               // waiting on HMO authorisation
  | 'awaiting_delivery'          // dispensed, waiting on courier
  | 'received_by_patient';       // patient confirmed receipt

// A single message in the pharmacy clarification thread. Mirrors the Phase 1
// `ChatMessage` shape but is its own lightweight type (pharmacist ↔ doctor).
export type PharmacyMessageAuthor = 'doctor' | 'pharmacist';

export interface PharmacyMessage {
  id:           string;
  fulfilmentId: string;          // links to the PharmacyFulfilment
  author:       PharmacyMessageAuthor;
  body:         string;
  createdAt:    string;          // ISO datetime
  attachmentUrl?: string;
  attachmentName?: string;
}

// A delivery alert (delayed / failed) derived from the Phase 2 delivery timeline.
export type DeliveryAlertKind = 'delayed' | 'failed';

export interface DeliveryAlert {
  id:           string;
  deliveryId:   string;          // links to the Phase 2 DrugDelivery
  kind:         DeliveryAlertKind;
  detail:       string;
  at:           string;          // ISO datetime
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION M — LAB TEST ORDERING (26)
// ═══════════════════════════════════════════════════════════════════════════
// Extends Phase 1 `LabTest` / `LabOrder` ADDITIVELY. A `LabCatalogueEntry`
// COMPOSES `LabTest` and adds sample type / fasting / price / turnaround. Lab
// packages, lab providers, urgency, collection-mode and HMO-coverage are added
// ADDITIVELY. `LabOrderRich` composes the Phase 1 `LabOrder`. Reuses
// `CreateLabOrderInput` / `useCreateLabOrder` / `useLabOrders`.

// Sample type required for a test (drives sample-type instruction copy).
export type SampleType =
  | 'blood'
  | 'urine'
  | 'stool'
  | 'swab'
  | 'sputum'
  | 'saliva'
  | 'tissue';

// Collection mode — visit a lab vs home sample collection.
export type CollectionMode = 'lab_visit' | 'home_collection';

// Order urgency (routine / urgent / stat).
export type LabUrgency = 'routine' | 'urgent' | 'stat';

// A richer lab catalogue entry — COMPOSES the Phase 1 `LabTest` and adds sample
// type, fasting requirement, price (kobo) and turnaround. The base `LabTest`
// (and `LAB_TEST_CATALOGUE`) is untouched.
export interface LabCatalogueEntry {
  base:           LabTest;        // reuse Phase 1 id/name/code/category
  sampleType:     SampleType;
  fastingRequired: boolean;
  fastingHours?:  number;         // e.g. 8 (when fasting required)
  priceKobo:      number;         // patient-pay price in kobo
  turnaroundHours: number;        // expected result turnaround
  sampleInstruction?: string;     // "Mid-stream urine sample"
}

// A bundled lab package (e.g. a wellness / diabetes panel).
export interface LabPackage {
  id:           string;
  name:         string;           // "Diabetes Profile"
  description:  string;
  testIds:      string[];         // member test ids (resolve to LabCatalogueEntry)
  priceKobo:    number;           // bundle price in kobo (often < sum of members)
  fastingRequired: boolean;
}

// A verified lab provider (lab directory + recommended provider).
export interface LabProvider {
  id:           string;
  name:         string;
  verified:     boolean;
  rating:       number;           // 0–5
  distanceKm:   number;
  homeCollection: boolean;        // offers home sample collection
  recommended:  boolean;          // platform-recommended for this order
  turnaroundLabel?: string;       // "24–48 hrs"
}

// HMO coverage check for a lab order (covered vs patient-pay notice).
export interface LabCoverageCheck {
  isHmo:        boolean;
  provider?:    string;           // "Hygeia HMO"
  covered:      boolean;          // whether the order is covered
  coveredTestIds: string[];       // tests covered by the plan
  patientPayKobo: number;        // out-of-pocket amount in kobo
  authCode?:    string;          // pre-authorisation code when covered
  note?:        string;          // "Lipid profile not covered — patient pays"
}

// The rich lab order — COMPOSES the Phase 1 `LabOrder` and adds the Section M
// options (urgency, collection mode, provider, coverage, reason/diagnosis link).
// The base `LabOrder` (and `createLabOrder`) is untouched.
export interface LabOrderRich {
  base:           LabOrder;       // reuse Phase 1 id/ref/appointmentId/patient/tests/clinicalNote/status/orderedAt/priority
  reason:         string;         // clinical reason for the order
  linkedDiagnosis?: string;       // diagnosis label this order supports
  urgency:        LabUrgency;     // richer than base.priority (routine|urgent)
  collectionMode: CollectionMode;
  provider?:      LabProvider;    // selected lab provider
  coverage?:      LabCoverageCheck;
  fastingRequired: boolean;       // any member test requires fasting
  validUntil?:    string;         // ISO date — drives the expired state
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION N — LAB RESULT REVIEW (20)
// ═══════════════════════════════════════════════════════════════════════════
// Extends Phase 1 `LabResult` / `LabResultValue` ADDITIVELY. An inbox row
// (`LabResultInbox`) plus a `LabResultStatus` (pending/ready/delayed) drive the
// list + new/critical flags. `LabResultRich` composes the Phase 1 result and adds
// PDF ref, structured values with abnormal/critical flags, doctor interpretation,
// compare-with-previous timeseries and an audit trail. Reuses
// `LabResult` / `LabResultValue` / `useLabResult` / `useMarkLabResultReviewed`.

// Result availability status (pending / ready / delayed).
export type LabResultStatus = 'pending' | 'ready' | 'delayed';

// An inbox row for the lab-results list (new / critical alert flags).
export interface LabResultInbox {
  resultId:     string;
  orderId:      string;
  ref:          string;
  patient:      PatientSummary;
  status:       LabResultStatus;
  isNew:        boolean;          // unread / newly arrived
  hasCritical:  boolean;          // any critical value present
  reportedAt?:  string;          // ISO datetime (undefined while pending)
  labName:      string;
}

// A richer result value — COMPOSES the Phase 1 `LabResultValue` and adds an
// abnormal/critical flag and a numeric reference range. The base value (and its
// `flag: normal|low|high`) is reused verbatim under `base`.
export interface LabResultValueRich {
  base:          LabResultValue;  // reuse Phase 1 testName/value/unit/refRange/flag
  abnormal:      boolean;         // derived: flag !== 'normal'
  critical:      boolean;         // critically out of range
  refLow?:       number;          // numeric lower bound (for compare/plot)
  refHigh?:      number;          // numeric upper bound
}

// A single point in a value's history (compare-with-previous timeseries).
export interface LabValueTrendPoint {
  reportedAt:   string;          // ISO datetime
  value:        string;          // raw value string (matches LabResultValue.value)
  numericValue?: number;          // parsed numeric value when plottable
  flag:         LabResultValue['flag'];
}

// The compare-with-previous timeseries for one test.
export interface LabValueComparison {
  testName:     string;
  unit:         string;
  refRange:     string;
  points:       LabValueTrendPoint[]; // oldest → newest
}

// The doctor's interpretation + recommendation attached to a result.
export interface LabInterpretation {
  resultId:     string;
  interpretation: string;        // clinical interpretation narrative
  recommendation: string;        // recommended next step
  sharedWithPatient: boolean;    // explanation shared with the patient
  createdAt:    string;          // ISO datetime
  updatedAt:    string;          // ISO datetime
}

// One entry in the result audit trail (viewed/interpreted/shared/repeat/reported).
export type LabResultAuditAction =
  | 'viewed'
  | 'reviewed'
  | 'interpreted'
  | 'shared'
  | 'repeat_requested'
  | 'reported';

export interface LabResultAuditEntry {
  id:     string;
  action: LabResultAuditAction;
  actor:  string;
  at:     string;                 // ISO datetime
  detail?: string;
}

// The rich lab result — COMPOSES the Phase 1 `LabResult` and adds the Section N
// review data ADDITIVELY. The base `LabResult` (and `getLabResult` /
// `markLabResultReviewed`) is untouched.
export interface LabResultRich {
  base:           LabResult;      // reuse Phase 1 id/orderId/ref/patient/values/reportedAt/labName/reviewed
  status:         LabResultStatus;
  isNew:          boolean;
  hasCritical:    boolean;
  pdfReportUrl?:  string;         // downloadable PDF report reference
  richValues:     LabResultValueRich[]; // structured values with abnormal/critical flags
  comparisons:    LabValueComparison[]; // compare-with-previous timeseries per test
  interpretation?: LabInterpretation;   // doctor interpretation (when added)
  audit:          LabResultAuditEntry[];
}

// ═══════════════════════════════════════════════════════════════════════════
// MUTATION INPUTS / RESULTS
// ═══════════════════════════════════════════════════════════════════════════
// `idempotencyKey` is required on every state-changing mutation. Hooks generate
// it; callers pass `Omit<Input, 'idempotencyKey'>`.

// ─── Section K — e-prescription ──────────────────────────────────────────────

// Issue (digitally sign + activate) a prescription.
export interface IssuePrescriptionInput {
  prescriptionId:  string;
  signaturePin?:   string;        // doctor's signing PIN (verified server-side)
  validDays?:      number;        // validity window in days (default applied server-side)
  idempotencyKey:  string;
}

export interface IssuePrescriptionResult {
  prescriptionId:   string;
  ref:              string;
  lifecycle:        RxLifecycleStatus;  // → 'issued'
  verificationCode: string;
  qrPayload:        string;
  validUntil:       string;             // ISO date
}

// Cancel an issued prescription.
export interface CancelPrescriptionInput {
  prescriptionId:  string;
  reason:          string;
  idempotencyKey:  string;
}

export interface CancelPrescriptionResult {
  prescriptionId: string;
  lifecycle:      RxLifecycleStatus;    // → 'cancelled'
}

// Share a prescription (with the patient — code / link / PDF).
export interface SharePrescriptionInput {
  prescriptionId:  string;
  channel:         'sms' | 'email' | 'link' | 'pdf';
  idempotencyKey:  string;
}

export interface SharePrescriptionResult {
  prescriptionId: string;
  shared:         boolean;
  shareUrl?:      string;
}

// Send an issued prescription to a pharmacy.
export interface SendToPharmacyInput {
  prescriptionId:  string;
  pharmacyId?:     string;        // omitted when option is patient_choice / print / share
  option:          RxFulfilmentOption;
  idempotencyKey:  string;
}

export interface SendToPharmacyResult {
  prescriptionId: string;
  fulfilmentId?:  string;         // present when sent to a pharmacy
  status:         FulfilmentStatusExt;
}

// Request a refill consultation (when a refill needs a fresh consult).
export interface RequestRefillConsultationInput {
  prescriptionId:  string;
  patientId:       string;
  reason:          string;
  idempotencyKey:  string;
}

export interface RequestRefillConsultationResult {
  consultRequestId: string;
  ref:              string;
}

// ─── Section L — pharmacy & drug fulfilment ──────────────────────────────────

// Select a pharmacy for a fulfilment.
export interface SelectPharmacyInput {
  prescriptionId:  string;
  pharmacyId:      string;
  idempotencyKey:  string;
}

export interface SelectPharmacyResult {
  fulfilmentId:   string;
  pharmacyId:     string;
  status:         FulfilmentStatusExt;
}

// Send a message in the pharmacy clarification thread.
export interface SendPharmacyMessageInput {
  fulfilmentId:    string;
  body:            string;
  attachmentUrl?:  string;
  attachmentName?: string;
  idempotencyKey:  string;
}

export interface SendPharmacyMessageResult {
  message: PharmacyMessage;
}

// Confirm the patient received their medication.
export interface ConfirmPatientReceivedInput {
  fulfilmentId:    string;
  idempotencyKey:  string;
}

export interface ConfirmPatientReceivedResult {
  fulfilmentId:   string;
  status:         FulfilmentStatusExt;  // → 'received_by_patient'
}

// Report / complain about a pharmacy.
export interface ReportPharmacyInput {
  pharmacyId:      string;
  fulfilmentId?:   string;
  reason:          string;
  detail?:         string;
  idempotencyKey:  string;
}

export interface ReportPharmacyResult {
  reportId: string;
  ref:      string;
}

// ─── Section M — lab test ordering ───────────────────────────────────────────

// Share a lab order (with the patient / lab).
export interface ShareLabOrderInput {
  orderId:         string;
  channel:         'sms' | 'email' | 'link' | 'pdf';
  idempotencyKey:  string;
}

export interface ShareLabOrderResult {
  orderId:   string;
  shared:    boolean;
  shareUrl?: string;
}

// Cancel a lab order.
export interface CancelLabOrderInput {
  orderId:         string;
  reason:          string;
  idempotencyKey:  string;
}

export interface CancelLabOrderResult {
  orderId: string;
  status:  LabOrderStatus;        // Phase 1 status (cancellation reflected by the screen)
  cancelled: boolean;
}

// ─── Section N — lab result review ───────────────────────────────────────────

// Add / update a doctor interpretation + recommendation for a result.
export interface AddInterpretationInput {
  resultId:        string;
  interpretation:  string;
  recommendation:  string;
  idempotencyKey:  string;
}

export interface AddInterpretationResult {
  resultId:    string;
  interpretation: LabInterpretation;
}

// Request a repeat / additional test from a result.
export interface RequestRepeatTestInput {
  resultId:        string;
  patientId:       string;
  testIds:         string[];      // tests to repeat / add
  reason:          string;
  idempotencyKey:  string;
}

export interface RequestRepeatTestResult {
  orderId: string;
  ref:     string;
  status:  LabOrderStatus;        // → 'ordered'
}

// Share a plain-language result explanation with the patient.
export interface ShareResultExplanationInput {
  resultId:        string;
  explanation:     string;
  idempotencyKey:  string;
}

export interface ShareResultExplanationResult {
  resultId:          string;
  sharedWithPatient: boolean;
  sharedAt:          string;      // ISO datetime
}

// Report a suspicious / implausible result to the lab.
export interface ReportSuspiciousResultInput {
  resultId:        string;
  reason:          string;
  idempotencyKey:  string;
}

export interface ReportSuspiciousResultResult {
  reportId: string;
  ref:      string;
}
