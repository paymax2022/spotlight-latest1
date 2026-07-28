// ── Doctor (Telemedicine, provider-side) — Phase 3 Domain Types ──────────────
// Phase 3 (advanced provider-side flows): veterinary mode + AI assistance +
// practice management. ADDITIVE to `@/types/doctor`, `@/types/doctor.phase2`
// and `@/types/doctor.profile` — those shapes are imported/reused, never
// duplicated. Money amounts are integers in minor units (kobo). Use
// `import type` for type-only imports.
//
// Domains:
//   Vet:      veterinary mode entry, pet profile, pet prescription, pet lab.
//   AI:       consultation-note summary, prescription safety checker, lab-result
//             explanation — all wrapped in a shared AI-result envelope.
//   Practice: doctor quality analytics, multi-clinic / provider management.

import type {
  PatientSummary,
  PrescriptionDrugItem,
  LabTest,
  LabOrderStatus,
  SoapNote,
  DoctorPrescription,
  LabResult,
  LabResultValue,
} from '@/types/doctor';
import type { ClinicAffiliation } from '@/types/doctor.profile';

// Re-export the primitives Phase 3 screens lean on, so a screen can pull
// everything it needs from one import site.
export type {
  PatientSummary,
  PrescriptionDrugItem,
  LabTest,
  LabOrderStatus,
  SoapNote,
  DoctorPrescription,
  LabResult,
  LabResultValue,
} from '@/types/doctor';
export type { ClinicAffiliation } from '@/types/doctor.profile';

// ═══════════════════════════════════════════════════════════════════════════
// VETERINARY
// ═══════════════════════════════════════════════════════════════════════════

// ─── 1. Veterinary doctor mode ───────────────────────────────────────────────

export type PetSpecies =
  | 'dog'
  | 'cat'
  | 'bird'
  | 'rabbit'
  | 'reptile'
  | 'rodent'
  | 'livestock'
  | 'other';

export interface VetProfileSummary {
  doctorId:        string;
  name:            string;          // display name, e.g. "Dr. Amaka Obi"
  initials:        string;
  avatarColor:     string;          // hex used for avatar circle
  licenceNumber:   string;          // veterinary council registration number
  clinicName:      string;          // primary vet clinic
  speciesTreated:  PetSpecies[];    // species the vet handles
  yearsExperience: number;
  rating:          number;          // 0–5
  reviewCount:     number;
  vetModeEnabled:  boolean;         // whether vet mode is currently active
}

// A pet consult queued for the vet (mirrors DoctorAppointment for animals).
export interface PetConsultSummary {
  id:          string;
  ref:         string;             // e.g. "VET-9F2A41"
  petName:     string;
  petSpecies:  PetSpecies;
  breed:       string;
  ownerName:   string;
  reason:      string;             // owner's described reason
  slotTime:    string;             // "09:00 AM"
  feeKobo:     number;             // consult fee in kobo
  isUrgent:    boolean;
}

export interface VetDashboard {
  vet:           VetProfileSummary;
  todaysConsults: PetConsultSummary[];
  petsSeenToday: number;
  pendingLabs:   number;
  earningsTodayKobo: number;
}

// ─── 2. Pet profile (review during a consult) ────────────────────────────────

export interface PetOwner {
  id:          string;
  name:        string;
  initials:    string;
  avatarColor: string;             // hex used for avatar circle
  phone:       string;
  email?:      string;
  address?:    string;
}

export interface PetVaccination {
  id:         string;
  name:       string;              // "Rabies", "DHPP"
  givenAt:    string;              // ISO date
  dueAt?:     string;              // ISO date of next dose
  status:     'up_to_date' | 'due' | 'overdue';
  vetName?:   string;
}

export interface PetHistoryItem {
  id:         string;
  date:       string;              // ISO date
  summary:    string;
  vetName:    string;
}

export interface PetImage {
  id:        string;
  uri:       string;              // local URI now; remote URL after Phase C
  caption?:  string;
  takenAt:   string;              // ISO datetime
}

export interface PetProfile {
  id:                string;
  name:              string;
  species:           PetSpecies;
  breed:             string;
  sex:               'male' | 'female' | 'unknown';
  neutered:          boolean;
  ageMonths:         number;       // age in months
  weightKg:          number;       // current weight in kilograms
  microchipId?:      string;
  owner:             PetOwner;
  allergies:         string[];
  chronicConditions: string[];
  currentMedications: string[];
  symptoms:          string[];     // owner-reported presenting symptoms
  vaccinations:      PetVaccination[];
  history:           PetHistoryItem[];
  images:            PetImage[];
}

// ─── 3. Pet prescription (create) ────────────────────────────────────────────

export type PetDrugCategory =
  | 'antibiotic'
  | 'antiparasitic'
  | 'nsaid'
  | 'analgesic'
  | 'vaccine'
  | 'supplement'
  | 'dermatological'
  | 'other';

export interface PetDrug {
  id:               string;
  name:             string;        // "Amoxicillin (vet)"
  category:         PetDrugCategory;
  dosePerKgMgLow:   number;        // mg per kg (lower bound) for the calculator
  dosePerKgMgHigh:  number;        // mg per kg (upper bound)
  defaultFrequency: string;        // "Twice daily"
  contraindicatedSpecies: PetSpecies[]; // species that must NOT receive this drug
  warnings:         string[];      // generic safety notes
}

// A computed dosing suggestion from the weight-based calculator (display only).
export interface PetDosageCalculation {
  drugName:     string;
  weightKg:     number;
  doseLowMg:    number;            // weightKg * dosePerKgMgLow
  doseHighMg:   number;            // weightKg * dosePerKgMgHigh
  suggestedMg:  number;            // midpoint, rounded
  frequency:    string;
}

export type PetWarningSeverity = 'info' | 'caution' | 'danger';

export interface PetPrescriptionWarning {
  severity: PetWarningSeverity;
  drugName: string;
  message:  string;                // "Contraindicated in cats", "Allergy on file"
}

// Reuses the human `PrescriptionDrugItem` shape for the line items.
export interface PetPrescriptionItem extends PrescriptionDrugItem {
  category:    PetDrugCategory;
  dosageMg?:   number;             // computed dose in mg, when calculated
}

export interface PetPrescription {
  id:          string;
  ref:         string;             // e.g. "PRX-4F2A41"
  petId:       string;
  petName:     string;
  petSpecies:  PetSpecies;
  ownerName:   string;
  vetName:     string;
  diagnosis:   string;
  items:       PetPrescriptionItem[];
  warnings:    PetPrescriptionWarning[];
  issuedAt:    string;             // ISO datetime
  status:      'draft' | 'issued' | 'dispensed';
}

// ─── 4. Pet lab orders & results ─────────────────────────────────────────────

export type PetLabCategory = 'blood' | 'stool' | 'urine' | 'imaging' | 'skin' | 'other';

export interface PetLabTest {
  id:       string;
  name:     string;                // "Complete Blood Count (Canine)"
  code:     string;                // "CBC"
  category: PetLabCategory;
}

export interface PetLabOrder {
  id:           string;
  ref:          string;            // e.g. "PLAB-8C1B22"
  petId:        string;
  petName:      string;
  petSpecies:   PetSpecies;
  ownerName:    string;
  tests:        PetLabTest[];
  clinicalNote: string;
  status:       LabOrderStatus;    // reuse Phase 1 LabOrderStatus
  orderedAt:    string;            // ISO datetime
  priority:     'routine' | 'urgent';
}

export interface PetLabResultValue {
  testName: string;
  value:    string;                // "13.4"
  unit:     string;                // "g/dL"
  refRange: string;                // "12.0–18.0"
  flag:     'normal' | 'low' | 'high';
}

export interface PetLabResult {
  id:         string;
  orderId:    string;
  ref:        string;
  petName:    string;
  petSpecies: PetSpecies;
  category:   PetLabCategory;
  values:     PetLabResultValue[];
  reportedAt: string;              // ISO datetime
  labName:    string;
  reviewed:   boolean;
}

// ─── 5. Pet store recommendation ─────────────────────────────────────────────

export type PetProductCategory = 'food' | 'supplement' | 'grooming' | 'medicine' | 'accessory';

export interface PetStoreProduct {
  id:          string;
  name:        string;             // "Royal Canin Veterinary Diet"
  category:    PetProductCategory;
  brand:       string;
  priceKobo:   number;             // unit price in kobo
  vetApproved: boolean;            // vet-approved flag
  forSpecies:  PetSpecies[];       // suitable species
  description: string;
  imageColor:  string;            // hex placeholder swatch for the product tile
}

export interface PetProductRecommendation {
  id:          string;
  ref:         string;             // e.g. "REC-5A8E07"
  petId:       string;
  petName:     string;
  ownerName:   string;
  products:    PetStoreProduct[];
  note:        string;             // vet's note to the owner
  createdAt:   string;             // ISO datetime
  sharedWithOwner: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// AI ASSISTANCE
// ═══════════════════════════════════════════════════════════════════════════

// ─── Shared AI-result envelope ───────────────────────────────────────────────
// Every AI screen wraps its structured output in `AiEnvelope<T>` so the UI can
// drive a consistent generating → ready → error lifecycle, surface the model
// label / disclaimer, and track whether the doctor has accepted/edited it.

export type AiStatus = 'idle' | 'generating' | 'ready' | 'error';

export interface AiEnvelope<T> {
  status:      AiStatus;
  model:       string;             // display label, e.g. "Spotlight Care AI v1"
  generatedAt?: string;           // ISO datetime (present once ready)
  confidence?: number;            // 0–100 (present once ready)
  disclaimer:  string;            // safety / not-medical-advice copy
  output?:     T;                  // structured result (present once ready)
  accepted:    boolean;           // doctor accepted the draft as-is
  edited:      boolean;           // doctor edited the draft before accepting
  errorMessage?: string;          // present when status === 'error'
}

// ─── 6. AI consultation note summary ─────────────────────────────────────────
// Produces a SOAP-shaped draft from a consult. Reuses Phase 1 `SoapNote` field
// names via a structural subset (no id/timestamps — those are server-assigned).

export interface AiNoteSummaryOutput {
  subjective: string;
  objective:  string;
  assessment: string;
  plan:       string;
  diagnosis:  string[];            // ICD-lite labels
  keyPoints:  string[];            // bullet highlights the UI can chip
}

export type AiNoteSummary = AiEnvelope<AiNoteSummaryOutput>;

// ─── 7. AI prescription safety checker ───────────────────────────────────────

export type AiSeverity = 'low' | 'moderate' | 'high' | 'critical';

export type AiFindingKind =
  | 'interaction'        // drug-drug interaction
  | 'contraindication'   // condition / allergy contraindication
  | 'dosage'             // dose out of range
  | 'duplication'        // therapeutic duplication
  | 'allergy';           // patient allergy match

export interface AiSafetyFinding {
  id:          string;
  kind:        AiFindingKind;
  severity:    AiSeverity;
  title:       string;             // "Potential interaction: Warfarin + Ibuprofen"
  detail:      string;             // plain-language explanation
  drugs:       string[];           // implicated drugs
  recommendation: string;          // suggested action
}

export interface AiSafetyOutput {
  overallSeverity: AiSeverity;     // worst finding severity
  findings:        AiSafetyFinding[];
  safeToIssue:     boolean;        // false when a critical finding exists
  summary:         string;         // one-line headline
}

export type AiSafetyReport = AiEnvelope<AiSafetyOutput>;

// ─── 8. AI lab result explanation ────────────────────────────────────────────

export interface AiLabFlagExplanation {
  testName:    string;
  flag:        'normal' | 'low' | 'high';
  meaning:     string;             // plain-language interpretation
  possibleCauses: string[];        // candidate explanations
}

export interface AiLabExplanationOutput {
  headline:    string;             // "Mostly normal with a mild raised cholesterol"
  plainSummary: string;            // patient-friendly paragraph
  flags:       AiLabFlagExplanation[]; // per abnormal value
  followUps:   string[];           // suggested next steps
}

export type AiLabExplanation = AiEnvelope<AiLabExplanationOutput>;

// ═══════════════════════════════════════════════════════════════════════════
// PRACTICE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

// ─── 9. Doctor quality analytics ─────────────────────────────────────────────

export type AnalyticsPeriod = '7d' | '30d' | '90d' | '12m';

// A single point on a time series. `value` is generic; `label` is the x-axis tick.
export interface AnalyticsPoint {
  label: string;                   // "Mon", "Wk 1", "Jan"
  value: number;
}

export interface AnalyticsMetric {
  key:        string;              // "rating", "response_time", ...
  label:      string;              // "Average rating"
  value:      number;              // current value
  unit:       string;              // "★", "min", "%", "" (consults)
  deltaPct:   number;              // % change vs previous period (+/-)
  trend:      'up' | 'down' | 'flat';
  isGood:     boolean;             // whether the current direction is positive
}

export interface QualityAnalytics {
  period:           AnalyticsPeriod;
  metrics:          AnalyticsMetric[];      // headline metric tiles
  ratingTrend:      AnalyticsPoint[];       // ratings over time
  responseTimeTrend: AnalyticsPoint[];      // avg response (mins) over time
  consultVolume:    AnalyticsPoint[];       // consults per bucket
  earningsTrend:    AnalyticsPoint[];       // earnings (kobo) per bucket
  completionRate:   number;                 // 0–100
  rankingPercentile: number;                // 0–100 (top X% of doctors)
  rankingLabel:     string;                 // "Top 5% of GPs on Spotlight"
}

// ─── 10. Multi-clinic / provider management ──────────────────────────────────

export type ClinicRole = 'owner' | 'lead' | 'consultant' | 'locum' | 'volunteer';

export interface ClinicSchedule {
  days:      string[];             // ["Mon", "Tue", "Thu"]
  startTime: string;               // "09:00"
  endTime:   string;               // "17:00"
}

// Extends the Section B `ClinicAffiliation` with provider-management fields.
export interface ClinicMembership extends ClinicAffiliation {
  role:          ClinicRole;
  schedule:      ClinicSchedule;
  isActive:      boolean;          // the clinic the doctor is currently practising at
  patientsSeen:  number;           // lifetime patients at this clinic
  joinedAt:      string;           // ISO date
  feeShareePct:  number;           // % of consult fee retained by the doctor
}

export interface ClinicPortfolio {
  activeClinicId: string;          // currently-selected clinic
  memberships:    ClinicMembership[];
}

// ═══════════════════════════════════════════════════════════════════════════
// MUTATION INPUTS / RESULTS
// ═══════════════════════════════════════════════════════════════════════════
// `idempotencyKey` is required on every state-changing mutation. Hooks generate
// it; callers pass `Omit<Input, 'idempotencyKey'>`.

// 1. Vet mode toggle
export interface ToggleVetModeInput {
  enabled:        boolean;
  idempotencyKey: string;
}

export interface ToggleVetModeResult {
  doctorId:       string;
  vetModeEnabled: boolean;
}

// 3. Pet prescription
export interface CreatePetPrescriptionInput {
  petId:          string;
  diagnosis:      string;
  items:          PetPrescriptionItem[];
  idempotencyKey: string;
}

export interface CreatePetPrescriptionResult {
  prescriptionId: string;
  ref:            string;
  status:         PetPrescription['status'];
}

// 4. Pet lab order
export interface CreatePetLabOrderInput {
  petId:          string;
  testIds:        string[];
  clinicalNote:   string;
  priority:       PetLabOrder['priority'];
  idempotencyKey: string;
}

export interface CreatePetLabOrderResult {
  orderId: string;
  ref:     string;
  status:  LabOrderStatus;
}

export interface MarkPetLabResultReviewedInput {
  resultId:       string;
  idempotencyKey: string;
}

// 5. Pet product recommendation
export interface RecommendProductsInput {
  petId:          string;
  productIds:     string[];
  note:           string;
  idempotencyKey: string;
}

export interface RecommendProductsResult {
  recommendationId: string;
  ref:              string;
  sharedWithOwner:  boolean;
}

// 6. AI note summary — generate + accept
export interface GenerateAiNoteSummaryInput {
  appointmentId:  string;
  idempotencyKey: string;
}

export interface AcceptAiNoteSummaryInput {
  appointmentId:  string;
  output:         AiNoteSummaryOutput; // possibly edited by the doctor
  edited:         boolean;
  idempotencyKey: string;
}

export interface AcceptAiNoteSummaryResult {
  noteId:   string;                // server-assigned SoapNote id
  accepted: boolean;
}

// 7. AI prescription safety check (read-style generate; no persistence)
export interface CheckPrescriptionSafetyInput {
  petId?:         string;          // present for pet prescriptions
  patientId?:     string;          // present for human prescriptions
  items:          PrescriptionDrugItem[];
  idempotencyKey: string;
}

// 8. AI lab explanation (read-style generate; no persistence)
export interface ExplainLabResultInput {
  resultId:       string;
  idempotencyKey: string;
}

// 10. Active clinic switch
export interface SetActiveClinicInput {
  clinicId:       string;
  idempotencyKey: string;
}

export interface SetActiveClinicResult {
  activeClinicId: string;
}

export interface UpdateClinicScheduleInput {
  clinicId:       string;
  schedule:       ClinicSchedule;
  idempotencyKey: string;
}

export interface UpdateClinicScheduleResult {
  clinicId: string;
  schedule: ClinicSchedule;
}
