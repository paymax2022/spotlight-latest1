// ── Doctor (Telemedicine, provider-side) — Batch 5 Domain Types ─────────────
// Batch 5 = spec sections S · T · U · V — the VETERINARY sections. This is
// CONSOLIDATED and leans HEAVILY on the Phase 3 vet/pet work plus the human-side
// rich types from Batch 2 / Phase 2 / Batch 4. Earlier shapes are imported and
// re-exported, NEVER duplicated. Money amounts are integers in minor units
// (kobo). Use `import type` for type-only imports.
//
// Sections:
//   S — Veterinary Consultation: vet appointment/queue, pet owner request, pet
//       review, vet chat/audio/video (REUSE Batch 2 rich chat/call), vet SOAP
//       (REUSE Batch 2 ClinicalNote), pet diagnosis/treatment, pet emergency
//       warning (REUSE RedFlagWarning), follow-up (REUSE Phase 2 FollowUpPlan),
//       vet referral, consult summary + history.
//   T — Pet E-Prescription: REUSE PetDrug / PetDosageCalculation / PetPrescription;
//       ADD a richer warning union + pure helpers (computePetDosage,
//       checkPetRxWarnings), issued prescription (send-to-pharmacy + audit) and
//       pet refill request / approve / reject.
//   U — Vet Lab & Pet Health: REUSE PetLabTest / PetLabOrder / PetLabResult;
//       ADD lab catalogue entry, vaccination recommendation + reminder, pet
//       health record, growth/weight timeseries, chronic monitoring, lab inbox
//       + interpretation.
//   V — Pet Store: REUSE PetStoreProduct / PetProductRecommendation; ADD
//       fulfilment + delivery status timelines and a richer product detail.

import type {
  // ── REUSE: Phase 3 vet/pet primitives ──
  PetSpecies,
  PetProfile,
  PetOwner,
  PetConsultSummary,
  PetVaccination,
  PetDrug,
  PetDrugCategory,
  PetDosageCalculation,
  PetPrescription,
  PetPrescriptionItem,
  PetPrescriptionWarning,
  PetWarningSeverity,
  PetLabTest,
  PetLabCategory,
  PetLabOrder,
  PetLabResult,
  PetLabResultValue,
  PetStoreProduct,
  PetProductCategory,
  PetProductRecommendation,
} from '@/types/doctor.phase3';
// ── REUSE: human-side rich types (vet analogues) ──
import type { ChatMessageRich, ChatThreadState, CallSessionRich, ClinicalNote, RedFlagWarning } from '@/types/doctor.batch2';
import type { FollowUpPlan, SpecialistReferral } from '@/types/doctor.phase2';
import type { LabOrderStatus } from '@/types/doctor';

// Re-export the primitives Batch 5 screens lean on, so a screen can pull
// everything it needs from one import site.
export type {
  PetSpecies,
  PetProfile,
  PetOwner,
  PetConsultSummary,
  PetVaccination,
  PetDrug,
  PetDrugCategory,
  PetDosageCalculation,
  PetPrescription,
  PetPrescriptionItem,
  PetPrescriptionWarning,
  PetWarningSeverity,
  PetLabTest,
  PetLabCategory,
  PetLabOrder,
  PetLabResult,
  PetLabResultValue,
  PetStoreProduct,
  PetProductCategory,
  PetProductRecommendation,
} from '@/types/doctor.phase3';
export type { ChatMessageRich, ChatThreadState, CallSessionRich, ClinicalNote, RedFlagWarning } from '@/types/doctor.batch2';
export type { FollowUpPlan, SpecialistReferral } from '@/types/doctor.phase2';
export type { LabOrderStatus } from '@/types/doctor';

// ═══════════════════════════════════════════════════════════════════════════
// SECTION S — VETERINARY CONSULTATION (22)
// ═══════════════════════════════════════════════════════════════════════════
// Consolidated. Chat/audio/video REUSE the Batch 2 ChatMessageRich /
// ChatThreadState / CallSessionRich shapes via a thin vet-scoped wrapper that
// adds pet context. Vet SOAP REUSES the Batch 2 ClinicalNote. Pet emergency
// warning REUSES RedFlagWarning. Follow-up REUSES the Phase 2 FollowUpPlan.

// ─── S.1 Vet appointment / queue ─────────────────────────────────────────────
export type VetConsultType = 'chat' | 'audio' | 'video' | 'in_person';

export type VetAppointmentStatus =
  | 'requested'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export interface VetAppointment {
  id:          string;
  ref:         string;
  summary:     PetConsultSummary;
  consultType: VetConsultType;
  status:      VetAppointmentStatus;
  slotDate:    string;
  createdAt:   string;
  isHmo:       boolean;
}

// ─── S.2 Pet owner request ───────────────────────────────────────────────────
export type PetOwnerRequestStatus = 'pending' | 'accepted' | 'declined' | 'expired';

export interface PetOwnerRequest {
  id:          string;
  ref:         string;
  owner:       PetOwner;
  petName:     string;
  petSpecies:  PetSpecies;
  breed:       string;
  reason:      string;
  symptoms:    string[];
  isUrgent:    boolean;
  preferredType: VetConsultType;
  status:      PetOwnerRequestStatus;
  requestedAt: string;
  declineReason?: string;
}

// ─── S.3 Vet chat / audio / video (REUSE Batch 2 rich types) ─────────────────
export interface VetChatThread {
  thread:   ChatThreadState;
  messages: ChatMessageRich[];
  petId:    string;
  petName:  string;
  ownerName: string;
}

export interface VetCallSession {
  session:  CallSessionRich;
  petId:    string;
  petName:  string;
  ownerName: string;
}

// ─── S.4 Vet SOAP note + diagnosis + treatment plan (REUSE ClinicalNote) ─────
export interface VetClinicalNote {
  note:        ClinicalNote;
  petId:       string;
  petName:     string;
  petSpecies:  PetSpecies;
  weightKg:    number;
  diagnosis:   string[];
  treatmentPlan: string;
}

// ─── S.5 Pet emergency warning (REUSE RedFlagWarning) ────────────────────────
export interface PetEmergencyWarning extends RedFlagWarning {
  petId:      string;
  petSpecies: PetSpecies;
  detectedAt: string;
}

// ─── S.6 Vet referral (REUSES the Phase 2 SpecialistReferral concept) ────────
export type VetReferralStatus = 'draft' | 'sent' | 'accepted' | 'scheduled' | 'completed' | 'declined';

export interface VetSpecialist {
  id:          string;
  name:        string;
  initials:    string;
  avatarColor: string;
  specialty:   string;
  clinic:      string;
}

export interface VetReferral {
  id:           string;
  ref:          string;
  petId:        string;
  petName:      string;
  petSpecies:   PetSpecies;
  ownerName:    string;
  specialist:   VetSpecialist;
  reason:       string;
  urgency:      'routine' | 'urgent';
  status:       VetReferralStatus;
  createdAt:    string;
  scheduledAt?: string;
}

// ─── S.7 Vet consultation summary + history ──────────────────────────────────
export interface VetConsultSummary {
  id:          string;
  ref:         string;
  petId:       string;
  petName:     string;
  petSpecies:  PetSpecies;
  ownerName:   string;
  vetName:     string;
  consultType: VetConsultType;
  diagnosis:   string[];
  treatmentPlan: string;
  prescriptionRef?: string;
  labOrderRef?:     string;
  referralRef?:     string;
  followUpRecommended: boolean;
  feeKobo:     number;
  durationMins: number;
  endedAt:     string;
}

export interface VetConsultHistoryItem {
  id:          string;
  ref:         string;
  petName:     string;
  petSpecies:  PetSpecies;
  ownerName:   string;
  consultType: VetConsultType;
  summary:     string;
  feeKobo:     number;
  date:        string;
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION T — PET E-PRESCRIPTION (16)
// ═══════════════════════════════════════════════════════════════════════════
// REUSES PetDrug / PetDosageCalculation / PetPrescription / PetPrescriptionItem.

// ─── T.1 Pet Rx warning union (medicine / species / allergy) ─────────────────
export type PetRxWarningKind = 'medicine' | 'species_contraindication' | 'allergy';

export interface PetRxWarning {
  kind:     PetRxWarningKind;
  severity: PetWarningSeverity;
  drugName: string;
  message:  string;
}

export interface ComputePetDosageInput {
  drug:     PetDrug;
  weightKg: number;
}

export interface CheckPetRxWarningsInput {
  drug:       PetDrug;
  species:    PetSpecies;
  allergies:  string[];
}

// ─── T.2 Pet pharmacy ────────────────────────────────────────────────────────
export interface PetPharmacy {
  id:        string;
  name:      string;
  address:   string;
  acceptsEPrescription: boolean;
}

export type PetRxSendStatus = 'not_sent' | 'sending' | 'sent' | 'received' | 'dispensed' | 'failed';

// ─── T.3 Pet prescription audit trail ────────────────────────────────────────
export type PetRxAuditAction =
  | 'created'
  | 'issued'
  | 'sent_to_pharmacy'
  | 'dispensed'
  | 'refill_requested'
  | 'refill_approved'
  | 'refill_rejected';

export interface PetRxAuditEntry {
  action: PetRxAuditAction;
  actor:  string;
  at:     string;
  note?:  string;
}

// ─── T.4 Issued pet prescription (COMPOSES PetPrescription) ──────────────────
export interface IssuedPetPrescription {
  prescription: PetPrescription;
  pharmacy?:    PetPharmacy;
  sendStatus:   PetRxSendStatus;
  audit:        PetRxAuditEntry[];
}

// ─── T.5 Pet refill request / review ─────────────────────────────────────────
export type PetRefillStatus = 'requested' | 'approved' | 'rejected';

export interface PetRefillRequest {
  id:           string;
  ref:          string;
  prescriptionId: string;
  prescriptionRef: string;
  petName:      string;
  petSpecies:   PetSpecies;
  ownerName:    string;
  drugSummary:  string;
  status:       PetRefillStatus;
  requestedAt:  string;
  decidedAt?:   string;
  rejectReason?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION U — VET LAB & PET HEALTH (15)
// ═══════════════════════════════════════════════════════════════════════════
// REUSES PetLabTest / PetLabOrder / PetLabResult.

// ─── U.1 Pet lab catalogue entry ─────────────────────────────────────────────
export interface PetLabCatalogueEntry {
  test:        PetLabTest;
  priceKobo:   number;
  turnaroundHours: number;
  sampleType:  string;
  forSpecies:  PetSpecies[];
}

// ─── U.2 Pet lab result inbox + interpretation ───────────────────────────────
export interface PetLabResultInboxItem {
  result:      PetLabResult;
  hasAbnormal: boolean;
  interpreted: boolean;
}

export interface PetLabInterpretation {
  resultId:    string;
  interpretation: string;
  followUpRecommended: boolean;
  followUpNote?: string;
  interpretedBy: string;
  interpretedAt: string;
}

// ─── U.3 Pet vaccination recommendation + reminder ───────────────────────────
export type PetVaccinationUrgency = 'due_soon' | 'overdue' | 'routine';

export interface PetVaccinationRecommendation {
  id:          string;
  petId:       string;
  vaccineName: string;
  forSpecies:  PetSpecies[];
  urgency:     PetVaccinationUrgency;
  dueDate:     string;
  rationale:   string;
}

export interface PetVaccinationReminder {
  id:          string;
  petId:       string;
  vaccineName: string;
  remindAt:    string;
  channel:     'sms' | 'email' | 'push';
  enabled:     boolean;
}

// ─── U.4 Pet health record (aggregated hub) ──────────────────────────────────
export interface PetHealthRecord {
  pet:           PetProfile;
  vaccinations:  PetVaccination[];
  labResults:    PetLabResult[];
  consults:      VetConsultHistoryItem[];
  chronicConditions: string[];
  lastVisitAt?:  string;
}

// ─── U.5 Pet growth / weight history (timeseries) ────────────────────────────
export interface PetGrowthPoint {
  date:     string;
  weightKg: number;
  ageMonths: number;
  note?:    string;
}

export interface PetGrowthHistory {
  petId:    string;
  petName:  string;
  species:  PetSpecies;
  points:   PetGrowthPoint[];
}

// ─── U.6 Pet chronic condition monitoring ────────────────────────────────────
export type PetChronicTrend = 'improving' | 'stable' | 'worsening';

export interface PetChronicMonitoringEntry {
  id:         string;
  petId:      string;
  condition:  string;
  metricLabel: string;
  value:      string;
  trend:      PetChronicTrend;
  recordedAt: string;
  note?:      string;
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION V — PET STORE / VET-RECOMMENDED PRODUCTS (12)
// ═══════════════════════════════════════════════════════════════════════════
// REUSES PetStoreProduct / PetProductRecommendation / PetProductCategory.

// ─── V.1 Richer product detail (COMPOSES PetStoreProduct) ────────────────────
export interface PetProductDetail {
  product:      PetStoreProduct;
  ingredients:  string[];
  dosageGuidance?: string;
  inStock:      boolean;
  ratingAvg:    number;
  reviewCount:  number;
  relatedProductIds: string[];
}

// ─── V.2 Pet store fulfilment + delivery status ──────────────────────────────
export type PetFulfilmentStatus =
  | 'pending'
  | 'ordered'
  | 'packed'
  | 'shipped'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled';

export interface PetFulfilmentEvent {
  status: PetFulfilmentStatus;
  label:  string;
  at:     string;
  note?:  string;
}

export interface PetProductDelivery {
  trackingRef: string;
  courier?:    string;
  etaAt?:      string;
  address:     string;
  status:      PetFulfilmentStatus;
  timeline:    PetFulfilmentEvent[];
}

export interface PetProductFulfilment {
  id:             string;
  ref:            string;
  recommendationId: string;
  recommendationRef: string;
  petName:        string;
  ownerName:      string;
  products:       PetStoreProduct[];
  totalKobo:      number;
  status:         PetFulfilmentStatus;
  delivery:       PetProductDelivery;
  createdAt:      string;
}

// ═══════════════════════════════════════════════════════════════════════════
// MUTATION INPUTS / RESULTS
// ═══════════════════════════════════════════════════════════════════════════
// `idempotencyKey` is required on every state-changing mutation. Hooks generate
// it; callers pass `Omit<Input, 'idempotencyKey'>`.

// ─── Section S ────────────────────────────────────────────────────────────────
export interface RespondToPetRequestInput {
  requestId:      string;
  accept:         boolean;
  declineReason?: string;
  idempotencyKey: string;
}

export interface RespondToPetRequestResult {
  requestId: string;
  status:    PetOwnerRequestStatus;
}

export interface SaveVetSoapNoteInput {
  petId:          string;
  appointmentId:  string;
  note:           VetClinicalNote;
  idempotencyKey: string;
}

export interface SaveVetSoapNoteResult {
  noteId: string;
  status: ClinicalNote['status'];
}

export interface CreateVetReferralInput {
  petId:          string;
  specialistId:   string;
  reason:         string;
  urgency:        VetReferral['urgency'];
  idempotencyKey: string;
}

export interface CreateVetReferralResult {
  referralId: string;
  ref:        string;
  status:     VetReferralStatus;
}

// ─── Section T ────────────────────────────────────────────────────────────────
export interface IssuePetPrescriptionInput {
  prescriptionId: string;
  idempotencyKey: string;
}

export interface IssuePetPrescriptionResult {
  prescriptionId: string;
  ref:            string;
  status:         PetPrescription['status'];
}

export interface SendPetRxToPharmacyInput {
  prescriptionId: string;
  pharmacyId:     string;
  idempotencyKey: string;
}

export interface SendPetRxToPharmacyResult {
  prescriptionId: string;
  sendStatus:     PetRxSendStatus;
}

export interface RequestPetRefillInput {
  prescriptionId: string;
  note?:          string;
  idempotencyKey: string;
}

export interface RequestPetRefillResult {
  refillId: string;
  ref:      string;
  status:   PetRefillStatus;
}

export interface ReviewPetRefillInput {
  refillId:       string;
  approve:        boolean;
  rejectReason?:  string;
  idempotencyKey: string;
}

export interface ReviewPetRefillResult {
  refillId: string;
  status:   PetRefillStatus;
}

// ─── Section U ────────────────────────────────────────────────────────────────
export interface AddPetLabInterpretationInput {
  resultId:            string;
  interpretation:      string;
  followUpRecommended: boolean;
  followUpNote?:       string;
  idempotencyKey:      string;
}

export interface AddPetLabInterpretationResult {
  resultId:    string;
  interpreted: boolean;
}

export interface SetPetVaccinationReminderInput {
  petId:          string;
  vaccineName:    string;
  remindAt:       string;
  channel:        PetVaccinationReminder['channel'];
  enabled:        boolean;
  idempotencyKey: string;
}

export interface SetPetVaccinationReminderResult {
  reminderId: string;
  enabled:    boolean;
}

export interface RecordPetGrowthInput {
  petId:          string;
  weightKg:       number;
  ageMonths:      number;
  note?:          string;
  idempotencyKey: string;
}

export interface RecordPetGrowthResult {
  petId:    string;
  pointDate: string;
}

export interface SavePetChronicMonitoringInput {
  petId:          string;
  condition:      string;
  metricLabel:    string;
  value:          string;
  trend:          PetChronicTrend;
  note?:          string;
  idempotencyKey: string;
}

export interface SavePetChronicMonitoringResult {
  entryId: string;
  petId:   string;
}

// ─── Section V ────────────────────────────────────────────────────────────────
export interface ShareProductWithOwnerInput {
  recommendationId: string;
  note?:            string;
  idempotencyKey:   string;
}

export interface ShareProductWithOwnerResult {
  recommendationId: string;
  sharedWithOwner:  boolean;
}

// `LabOrderStatus` alias retained for pet-lab call-site clarity.
export type PetLabOrderStatus = LabOrderStatus;
