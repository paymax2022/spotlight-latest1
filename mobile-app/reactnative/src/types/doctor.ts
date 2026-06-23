// ── Doctor (Telemedicine, provider-side) — Domain Types ──────────────────────
// Phase A (mobile UI/UX). Money amounts are integers in minor units (kobo).
// Mirrors the patient-side shapes in `@/types/telemedicine`; reuse those where
// they already fit instead of duplicating.

import type { ConsultType, ConsultStatus } from '@/types/telemedicine';

// Re-export patient-side primitives so doctor screens can import everything
// telemedicine-related from one place.
export type { ConsultType, ConsultStatus } from '@/types/telemedicine';

// ─── Doctor profile & verification ───────────────────────────────────────────

export type VerificationStatus =
  | 'unsubmitted'  // doctor has not yet submitted documents
  | 'pending'      // submitted, awaiting review
  | 'approved'     // verified, can practise
  | 'rejected';    // rejected, must resubmit

export interface DoctorProfile {
  id:              string;
  name:            string;
  title:           string;            // e.g. "MBBS, FWACP"
  specialtyId:     string;
  specialties:     string[];          // display labels
  subSpecialties:  string[];          // display labels
  bio:             string;
  initials:        string;
  avatarColor:     string;            // hex used for avatar circle
  email:           string;
  phone:           string;
  mdcnNumber:      string;            // MDCN registration number
  feeKobo:         number;            // default consultation fee in kobo
  rating:          number;            // 0–5
  reviewCount:     number;
  yearsExperience: number;
  languages:       string[];
  isOnline:        boolean;
  verification:    VerificationStatus;
  hospital?:       string;            // primary affiliation
  state?:          string;            // Nigerian state of practice
}

export type VerificationDocType =
  | 'mdcn_certificate'
  | 'medical_license'
  | 'degree_certificate'
  | 'government_id'
  | 'passport_photo'
  | 'cv';

export interface VerificationDocument {
  type:       VerificationDocType;
  label:      string;
  fileName:   string;
  uploadedAt: string;            // ISO datetime
}

export interface VerificationSubmission {
  id:           string;
  status:       VerificationStatus;
  submittedAt?: string;          // ISO datetime
  reviewedAt?:  string;          // ISO datetime
  documents:    VerificationDocument[];
  rejectionReason?: string;
  notes?:       string;          // reviewer note
}

// ─── Appointments (doctor's queue) ───────────────────────────────────────────

export interface PatientSummary {
  id:          string;
  name:        string;
  initials:    string;
  avatarColor: string;           // hex used for avatar circle
  age:         number;
  gender:      'male' | 'female' | 'other';
}

export interface DoctorAppointment {
  id:          string;
  ref:         string;            // human reference, e.g. "TM-9F2A41"
  patient:     PatientSummary;
  consultType: ConsultType;
  status:      ConsultStatus;
  slotDate:    string;            // ISO date
  slotTime:    string;            // "09:00 AM"
  feeKobo:     number;
  createdAt:   string;            // ISO datetime
  reason?:     string;            // patient's described reason
  isHmo:       boolean;           // covered by an HMO plan
  hmoProvider?: string;           // display label when isHmo
}

// ─── Patient medical profile (read access during a consult) ───────────────────

export interface PatientVital {
  label: string;   // "Blood Pressure"
  value: string;   // "120/80 mmHg"
}

export interface PatientHistoryItem {
  id:         string;
  date:       string;   // ISO date
  summary:    string;
  doctorName: string;
}

export interface PatientMedicalProfile {
  patient:            PatientSummary;
  bloodGroup:         string;        // "O+"
  genotype:           string;        // "AA"
  allergies:          string[];
  chronicConditions:  string[];
  currentMedications: string[];
  vitals:             PatientVital[];
  history:            PatientHistoryItem[];
}

// ─── Chat consultation ───────────────────────────────────────────────────────

export type ChatAuthor = 'doctor' | 'patient';

export interface ChatMessage {
  id:              string;
  threadId:        string;
  author:          ChatAuthor;
  body:            string;
  createdAt:       string;            // ISO datetime
  attachmentUrl?:  string;            // image / document
  attachmentName?: string;
}

export interface ChatThread {
  id:            string;
  appointmentId: string;
  patient:       PatientSummary;
  lastMessage:   string;
  lastMessageAt: string;            // ISO datetime
  unreadCount:   number;
  consultType:   ConsultType;
  status:        ConsultStatus;
}

// ─── Audio / video call session ──────────────────────────────────────────────

export type CallStatus = 'connecting' | 'ringing' | 'live' | 'ended' | 'failed';

export interface CallSession {
  id:            string;
  appointmentId: string;
  patient:       PatientSummary;
  mode:          'audio' | 'video';
  status:        CallStatus;
  startedAt?:    string;            // ISO datetime
  durationSecs:  number;            // elapsed seconds
  roomToken?:    string;            // Phase C: provider room/access token
}

// ─── Consultation (SOAP) notes ───────────────────────────────────────────────

export interface SoapNote {
  id:            string;
  appointmentId: string;
  patientId:     string;
  subjective:    string;            // patient-reported symptoms / history
  objective:     string;            // examination findings, vitals
  assessment:    string;            // clinical impression
  plan:          string;            // treatment plan / next steps
  diagnosis:     string[];          // ICD-lite labels
  createdAt:     string;            // ISO datetime
  updatedAt:     string;            // ISO datetime
}

// ─── Prescriptions (doctor authored) ─────────────────────────────────────────

export interface PrescriptionDrugItem {
  name:      string;
  dosage:    string;   // "500mg"
  route:     string;   // "Oral"
  frequency: string;   // "Twice daily"
  duration:  string;   // "5 days"
  notes?:    string;   // "Take after meals"
}

export interface DoctorPrescription {
  id:            string;
  ref:           string;            // e.g. "RX-4F2A41"
  appointmentId: string;
  patient:       PatientSummary;
  doctorName:    string;
  diagnosis:     string;
  items:         PrescriptionDrugItem[];
  issuedAt:      string;            // ISO datetime
  status:        'draft' | 'issued' | 'dispensed';
}

// ─── Lab orders & results ────────────────────────────────────────────────────

export interface LabTest {
  id:       string;
  name:     string;   // "Full Blood Count"
  code:     string;   // "FBC"
  category: string;   // "Haematology"
}

export type LabOrderStatus = 'ordered' | 'collected' | 'resulted' | 'reviewed';

export interface LabOrder {
  id:            string;
  ref:           string;            // e.g. "LAB-8C1B22"
  appointmentId: string;
  patient:       PatientSummary;
  tests:         LabTest[];
  clinicalNote:  string;
  status:        LabOrderStatus;
  orderedAt:     string;            // ISO datetime
  priority:      'routine' | 'urgent';
}

export interface LabResultValue {
  testName: string;
  value:    string;   // "13.4"
  unit:     string;   // "g/dL"
  refRange: string;   // "13.0–17.0"
  flag:     'normal' | 'low' | 'high';
}

export interface LabResult {
  id:         string;
  orderId:    string;
  ref:        string;
  patient:    PatientSummary;
  values:     LabResultValue[];
  reportedAt: string;            // ISO datetime
  labName:    string;
  reviewed:   boolean;
}

// ─── HMO coverage / eligibility ──────────────────────────────────────────────

export type EligibilityStatus = 'eligible' | 'ineligible' | 'pending';

export interface HmoCoverage {
  provider:        string;           // "Hygeia HMO"
  planName:        string;           // "Gold"
  memberId:        string;
  validUntil:      string;           // ISO date
  coveredServices: string[];
}

export interface HmoEligibility {
  appointmentId: string;
  patient:       PatientSummary;
  status:        EligibilityStatus;
  coverage?:     HmoCoverage;
  copayKobo:     number;            // patient out-of-pocket portion in kobo
  authCode?:     string;            // pre-authorisation code when eligible
  checkedAt:     string;            // ISO datetime
}

// ─── Availability schedule ───────────────────────────────────────────────────

export type Weekday =
  | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface WorkingDay {
  day:       Weekday;
  enabled:   boolean;
  startTime: string;   // "09:00"
  endTime:   string;   // "17:00"
}

export interface ScheduleBreak {
  id:        string;
  day:       Weekday;
  startTime: string;   // "13:00"
  endTime:   string;   // "14:00"
  label:     string;   // "Lunch"
}

export interface AvailabilitySchedule {
  doctorId:            string;
  workingDays:         WorkingDay[];
  breaks:              ScheduleBreak[];
  consultDurationMins: number;       // slot length
  bufferMins:          number;       // gap between consults
  acceptsInstant:      boolean;      // accept on-demand consults
}

// ─── Earnings & payouts ──────────────────────────────────────────────────────

export interface PayoutItem {
  id:           string;
  ref:          string;            // e.g. "PO-2026-014"
  amountKobo:   number;
  status:       'pending' | 'paid' | 'processing';
  consultCount: number;            // consults included in this payout
  periodLabel:  string;            // "01–15 Jun 2026"
  paidAt?:      string;            // ISO datetime
}

export interface EarningsSummary {
  availableKobo:     number;        // withdrawable balance
  pendingKobo:       number;        // not yet cleared
  lifetimeKobo:      number;        // gross lifetime earnings
  thisMonthKobo:     number;
  consultsThisMonth: number;
  payouts:           PayoutItem[];
}

// ─── Notifications ───────────────────────────────────────────────────────────

export type DoctorNotificationType =
  | 'appointment'
  | 'message'
  | 'lab_result'
  | 'payout'
  | 'verification'
  | 'system';

export interface DoctorNotification {
  id:        string;
  type:      DoctorNotificationType;
  title:     string;
  body:      string;
  createdAt: string;            // ISO datetime
  read:      boolean;
}

// ─── Support ─────────────────────────────────────────────────────────────────

export type SupportTicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

export interface SupportTicket {
  id:         string;
  ref:        string;            // e.g. "TKT-1042"
  subject:    string;
  category:   string;            // "Payments", "Technical", "Account"
  status:     SupportTicketStatus;
  createdAt:  string;            // ISO datetime
  updatedAt:  string;            // ISO datetime
  lastReply?: string;
}

// ─── Settings ────────────────────────────────────────────────────────────────

export interface DoctorSettings {
  doctorId:             string;
  notifyAppointments:   boolean;
  notifyMessages:       boolean;
  notifyPayouts:        boolean;
  pushEnabled:          boolean;
  emailEnabled:         boolean;
  smsEnabled:           boolean;
  showOnlineStatus:     boolean;
  autoAcceptInstant:    boolean;
  payoutBankName?:      string;
  payoutAccountMasked?: string;     // "****1234"
  preferredCurrency:    string;     // "NGN"
}

// ─── Mutation inputs ─────────────────────────────────────────────────────────
// `idempotencyKey` is required on money / state-changing mutations.

export interface SubmitVerificationInput {
  mdcnNumber:     string;
  documents:      VerificationDocType[];
  idempotencyKey: string;
}

export interface SubmitVerificationResult {
  submissionId: string;
  status:       VerificationStatus;
}

export interface UpdateAvailabilityInput {
  schedule:       AvailabilitySchedule;
  idempotencyKey: string;
}

export interface SaveSoapNoteInput {
  appointmentId:  string;
  patientId:      string;
  subjective:     string;
  objective:      string;
  assessment:     string;
  plan:           string;
  diagnosis:      string[];
  idempotencyKey: string;
}

export interface PrescriptionDraft {
  appointmentId: string;
  patientId:     string;
  diagnosis:     string;
  items:         PrescriptionDrugItem[];
}

export interface CreatePrescriptionInput extends PrescriptionDraft {
  idempotencyKey: string;
}

export interface CreatePrescriptionResult {
  prescriptionId: string;
  ref:            string;
  status:         DoctorPrescription['status'];
}

export interface CreateLabOrderInput {
  appointmentId:  string;
  patientId:      string;
  testIds:        string[];
  clinicalNote:   string;
  priority:       LabOrder['priority'];
  idempotencyKey: string;
}

export interface CreateLabOrderResult {
  orderId: string;
  ref:     string;
  status:  LabOrderStatus;
}

export interface SendChatMessageInput {
  threadId:        string;
  body:            string;
  attachmentUrl?:  string;
  attachmentName?: string;
  idempotencyKey:  string;
}

export interface UpdateAppointmentStatusInput {
  appointmentId:  string;
  status:         ConsultStatus;
  idempotencyKey: string;
}

export interface RequestPayoutInput {
  amountKobo:     number;
  idempotencyKey: string;
}

export interface RequestPayoutResult {
  payoutId: string;
  ref:      string;
  status:   PayoutItem['status'];
}

export interface MarkLabResultReviewedInput {
  resultId:       string;
  idempotencyKey: string;
}

export interface CreateSupportTicketInput {
  subject:        string;
  category:       string;
  body:           string;
  idempotencyKey: string;
}

export interface CreateSupportTicketResult {
  ticketId: string;
  ref:      string;
  status:   SupportTicketStatus;
}

export interface UpdateDoctorSettingsInput {
  settings:       Partial<DoctorSettings>;
  idempotencyKey: string;
}
