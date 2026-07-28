// ── Paymax Health — Veterinary types (Phase 3) ───────────────────────────────
// Self-contained domain types for the Vet vertical. Mirrors the pharmacy/lab
// feature-lib structure and reuses shared health primitives where it makes sense.
//
// IRON RULES (HEALTH-BUILD §7C):
//   · kobo only — every monetary amount is an integer in minor units.
//   · HL-2 credential-gated — vets discoverable only when VCN-verified.
//   · HL-3 prescription discipline — e-Rx is issued by the vet, dispense-once.
//   · HL-8 NDPA — pet records & e-Rx are sensitive: consent-gated, access-logged.
//   · HL-9 held payment — booking/checkout carries an Idempotency-Key; money held,
//     released on completion, refunded on cancel.
//   · HL-11 emergency safety — tele-consult is not emergency care; SOS routes to
//     the nearest in-person option with a clear disclaimer.

import type { ProviderCredential } from '../types';

// ── Pets ─────────────────────────────────────────────────────────────────────
export type PetSpecies = 'dog' | 'cat' | 'bird' | 'rabbit' | 'reptile' | 'other';
export type PetSex = 'male' | 'female' | 'unknown';

export interface Pet {
  id: string;
  name: string;
  species: PetSpecies;
  breed: string;
  sex: PetSex;
  dob?: string;
  ageLabel: string;
  weightKg?: number;
  microchipId?: string;
  neutered?: boolean;
  avatarColor: string;
  notes?: string;
}

export interface PetInput {
  name: string;
  species: PetSpecies;
  breed: string;
  sex: PetSex;
  dob?: string;
  weightKg?: number;
  microchipId?: string;
  neutered?: boolean;
  notes?: string;
}

// ── Pet health record (reuses the shared vault concept, scoped to a pet) ──────
export type PetRecordKind =
  | 'consult_note'
  | 'prescription'
  | 'vaccination'
  | 'lab_result'
  | 'weight'
  | 'document';

export interface PetRecordEntry {
  id: string;
  petId: string;
  kind: PetRecordKind;
  title: string;
  summary: string;
  at: string;
  providerName?: string;
  sensitive?: boolean;
  flagged?: boolean;
}

// ── Vaccinations ─────────────────────────────────────────────────────────────
export type VaccinationStatus = 'up_to_date' | 'due_soon' | 'overdue' | 'scheduled';

export interface VaccinationEntry {
  id: string;
  petId: string;
  vaccine: string;
  status: VaccinationStatus;
  lastGivenAt?: string;
  dueAt: string;
  notes?: string;
}

// ── Vets (HL-2 credential-gated discovery + geo) ─────────────────────────────
export type AppointmentType = 'tele' | 'home' | 'clinic';

export interface Vet {
  id: string;
  name: string;
  headline: string;
  bio: string;
  credential: ProviderCredential;
  rating: number;
  reviewCount: number;
  clinicName: string;
  address: string;
  distanceLabel: string;
  lat: number;
  lng: number;
  consultFeeKobo: number;
  homeVisitFeeKobo: number;
  types: AppointmentType[];
  species: PetSpecies[];
  specialties: string[];
  availableNow: boolean;
  active: boolean;
}

export interface VetQuery {
  q?: string;
  type?: AppointmentType;
  species?: PetSpecies;
}

// ── Availability / slots ─────────────────────────────────────────────────────
export interface AvailabilitySlot {
  id: string;
  start: string;
  label: string;
  type: AppointmentType;
  available: boolean;
}

export interface AvailabilityDay {
  date: string;
  label: string;
  slots: AvailabilitySlot[];
}

// ── Appointment state machine ────────────────────────────────────────────────
// REQUESTED → ACCEPTED → CONFIRMED → IN_PROGRESS → COMPLETED
// (any) → CANCELLED | NO_SHOW ; CONFIRMED → RESCHEDULED → CONFIRMED
export type AppointmentStatus =
  | 'REQUESTED'
  | 'ACCEPTED'
  | 'CONFIRMED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'RESCHEDULED'
  | 'CANCELLED'
  | 'NO_SHOW';

export interface Appointment {
  id: string;
  petId: string;
  petName: string;
  vetId: string;
  vetName: string;
  type: AppointmentType;
  status: AppointmentStatus;
  scheduledFor: string;
  reason: string;
  feeKobo: number;
  homeVisitFeeKobo: number;
  totalKobo: number;
  paymentHeld: boolean;
  createdAt: string;
  location?: string;
  consultId?: string;
  summaryId?: string;
  prescriptionId?: string;
}

export interface CreateAppointmentInput {
  petId: string;
  vetId: string;
  type: AppointmentType;
  scheduledFor: string;
  reason: string;
  feeKobo: number;
  homeVisitFeeKobo: number;
  location?: string;
  intakeResponseId?: string;
  idempotencyKey: string;
}

export interface RescheduleInput {
  appointmentId: string;
  scheduledFor: string;
}

// ── Tele-consult room state ──────────────────────────────────────────────────
export type VetConsultMode = 'video' | 'voice' | 'chat';

export interface VetConsultMessage {
  id: string;
  authorName: string;
  fromProvider: boolean;
  body: string;
  sentAt: string;
}

export interface VetConsult {
  id: string;
  appointmentId: string;
  vetId: string;
  vetName: string;
  petId: string;
  petName: string;
  mode: VetConsultMode;
  status: 'scheduled' | 'in_progress' | 'completed';
  scheduledAt: string;
  providerReady: boolean;
  messages: VetConsultMessage[];
}

// ── SOAP consult summary ─────────────────────────────────────────────────────
export interface SoapNote {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

export interface ConsultSummary {
  id: string;
  appointmentId: string;
  petId: string;
  petName: string;
  vetId: string;
  vetName: string;
  completedAt: string;
  soap: SoapNote;
  diagnosis: string;
  followUpRecommended: boolean;
  followUpNote?: string;
  prescriptionId?: string;
  labOrderId?: string;
}

// ── e-Prescription (HL-3 dispense-once · HL-8 consent-gated) ──────────────────
export type RxStatus = 'ISSUED' | 'SENT_TO_PHARMACY' | 'DISPENSED' | 'EXPIRED';

export interface RxItem {
  id: string;
  drugName: string;
  form: string;
  dosage: string;
  frequency: string;
  durationDays: number;
  quantity: number;
  pom: boolean;
  instructions?: string;
}

export interface EPrescription {
  id: string;
  appointmentId?: string;
  petId: string;
  petName: string;
  vetId: string;
  vetName: string;
  vetCredential: ProviderCredential;
  status: RxStatus;
  issuedAt: string;
  expiresAt: string;
  items: RxItem[];
  notes?: string;
  sensitive: boolean;
}

// ── Pet meds & refills ───────────────────────────────────────────────────────
export interface PetMedication {
  id: string;
  petId: string;
  petName: string;
  drugName: string;
  dosage: string;
  frequency: string;
  nextRefillAt: string;
  refillsRemaining: number;
  prescriptionId?: string;
  active: boolean;
}

// ── Home-visit tracking ──────────────────────────────────────────────────────
export type HomeVisitStage = 'assigned' | 'en_route' | 'arrived' | 'in_progress' | 'completed';

export interface HomeVisitTracking {
  appointmentId: string;
  vetName: string;
  vetPhone: string;
  vehicle: string;
  stage: HomeVisitStage;
  etaLabel: string;
  vetLat: number;
  vetLng: number;
  destLat: number;
  destLng: number;
  address: string;
}

// ── Reviews ──────────────────────────────────────────────────────────────────
export interface VetReview {
  id: string;
  author: string;
  rating: number;
  body: string;
  at: string;
}

export interface SubmitReviewInput {
  appointmentId: string;
  vetId: string;
  rating: number;
  body: string;
}

// ── Emergency SOS ────────────────────────────────────────────────────────────
export interface EmergencyVetOption {
  id: string;
  name: string;
  address: string;
  distanceLabel: string;
  phone: string;
  open24h: boolean;
  lat: number;
  lng: number;
}

// ── Provider side ────────────────────────────────────────────────────────────
export type ProviderOnboardingStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'needs_info'
  | 'approved';

export interface ProviderProfile {
  status: ProviderOnboardingStatus;
  // Mode B (assisted) VCN verification carries the application id the member's
  // verification submission + coarse status are scoped to. Optional — only set
  // once the provider profile exists.
  applicationId?: string;
  displayName: string;
  vcnLicenseNo: string;
  clinicName: string;
  bio: string;
  consultFeeKobo: number;
  homeVisitFeeKobo: number;
  types: AppointmentType[];
  species: PetSpecies[];
  credential: ProviderCredential;
}

// ── Mode B (assisted) VCN verification ───────────────────────────────────────
// HL-2 assisted path: the vet is verified WITHOUT ever seeing the VCN portal.
// The member submits credentials + documents + consent; ops confirms out-of-band
// and records a decision; the member only ever sees a coarse stage — never the
// VCN/register data, matched-field detail, reviewer identity, or notes.
export type VcnStage = 'pending_review' | 'more_info_needed' | 'verified' | 'not_verified';

export type VcnDocType = 'VCN_CERT' | 'ANNUAL_LICENCE' | 'GOV_ID';

export interface VcnSubmitDoc {
  type: VcnDocType;
  storageKey: string;
}

export interface SubmitVcnInput {
  applicationId: string;
  regNumber: string;
  fullName: string;
  dob: string; // YYYY-MM-DD
  consent: boolean;
  docs: VcnSubmitDoc[];
}

export interface VcnStatus {
  applicationId: string;
  capability: string;
  stage: VcnStage;
}

export interface SubmitOnboardingInput {
  displayName: string;
  vcnLicenseNo: string;
  clinicName: string;
}

export interface UpdateProfileInput {
  bio?: string;
  consultFeeKobo?: number;
  homeVisitFeeKobo?: number;
  types?: AppointmentType[];
}

export interface ProviderAvailabilityBlock {
  id: string;
  day: string;
  start: string;
  end: string;
  type: AppointmentType;
  enabled: boolean;
}

export interface ProviderAppointmentRow {
  appointmentId: string;
  ownerName: string;
  petName: string;
  species: PetSpecies;
  type: AppointmentType;
  status: AppointmentStatus;
  scheduledFor: string;
  reason: string;
}

export interface DecisionInput {
  appointmentId: string;
  decision: 'accept' | 'reschedule' | 'decline';
  scheduledFor?: string;
}

export interface PetChart {
  pet: Pet;
  ownerName: string;
  vaccinations: VaccinationEntry[];
  records: PetRecordEntry[];
  weightSeries: { at: string; kg: number }[];
}

export interface SaveSoapInput {
  appointmentId: string;
  petId: string;
  soap: SoapNote;
  diagnosis: string;
  followUpRecommended: boolean;
  followUpNote?: string;
}

export interface IssueRxInput {
  appointmentId: string;
  petId: string;
  items: Omit<RxItem, 'id'>[];
  notes?: string;
}

export interface OrderLabInput {
  appointmentId: string;
  petId: string;
  testNames: string[];
  note?: string;
}

export interface ReferralInput {
  appointmentId: string;
  petId: string;
  specialty: string;
  toVetName: string;
  reason: string;
}

export interface ProviderEarnings {
  availableKobo: number;
  pendingKobo: number;
  heldKobo: number;
  payouts: { id: string; amountKobo: number; at: string; status: 'paid' | 'processing' }[];
}

export interface ProviderHomeNav {
  appointmentId: string;
  ownerName: string;
  petName: string;
  address: string;
  destLat: number;
  destLng: number;
  vetLat: number;
  vetLng: number;
  etaLabel: string;
  distanceLabel: string;
  phone: string;
}
