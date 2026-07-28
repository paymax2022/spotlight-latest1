// ── Paymax Health — Laboratory types (Phase 2) ───────────────────────────────
// Self-contained domain types for the Lab vertical. Mirrors the pharmacy feature
// lib structure and reuses shared health primitives where it makes sense.
//
// IRON RULES (HEALTH-BUILD):
//   · kobo only — every monetary amount is an integer in minor units.
//   · HL-2 credential-gated — labs/scientists discoverable only when verified (MLSCN).
//   · HL-6 chain-of-custody — every sample is tracked collection → accession, immutably.
//   · HL-7 critical-result escalation — abnormal/critical values trigger a human escalation;
//     never silent.
//   · HL-8 NDPA — results are sensitive: consent-gated, access-logged, signed-URL docs.
//   · HL-9 held payment — checkout carries an Idempotency-Key; money held, released on release.

import type { ProviderCredential } from '../types';

// ── Catalog: tests & packages ────────────────────────────────────────────────
export type SampleType = 'blood' | 'urine' | 'stool' | 'swab' | 'saliva';
export type TestCategory =
  | 'haematology'
  | 'chemistry'
  | 'endocrine'
  | 'infectious'
  | 'cardiac'
  | 'wellness';

export interface LabTest {
  id: string;
  name: string;
  /** Short clinical code (e.g. "FBC", "HbA1c"). */
  code: string;
  category: TestCategory;
  priceKobo: number;
  description: string;
  sampleType: SampleType;
  /** Preparation instructions surfaced on the detail screen. */
  prep: string;
  fastingRequired: boolean;
  /** Turnaround time label e.g. "Same day", "24-48 hrs". */
  tat: string;
  homeCollection: boolean;
  imageColor: string;
}

export interface TestPackage {
  id: string;
  name: string;
  description: string;
  priceKobo: number;
  /** Pre-bundle price for showing savings. */
  listPriceKobo: number;
  testIds: string[];
  testCount: number;
  tat: string;
  prep: string;
  fastingRequired: boolean;
  popular?: boolean;
  imageColor: string;
}

export interface CatalogQuery {
  q?: string;
  category?: TestCategory;
}

// ── Labs & phlebotomists (HL-2 credential-gated) ─────────────────────────────
export interface Lab {
  id: string;
  name: string;
  headline: string;
  credential: ProviderCredential;
  rating: number;
  reviewCount: number;
  address: string;
  distanceLabel: string;
  lat: number;
  lng: number;
  supportsHomeCollection: boolean;
  supportsWalkIn: boolean;
  homeCollectionFeeKobo: number;
  resultEtaLabel: string;
  active: boolean;
}

export interface Phlebotomist {
  id: string;
  name: string;
  credential: ProviderCredential;
  rating: number;
  reviewCount: number;
  lat: number;
  lng: number;
  phone: string;
  vehicle: string;
}

// ── Lab order state machine ──────────────────────────────────────────────────
// CREATED → SCHEDULED → SAMPLE_COLLECTED → IN_TRANSIT → ACCESSIONED →
// RESULT_READY → (critical) ESCALATED → RELEASED.  (CANCELLED is terminal.)
export type LabOrderStatus =
  | 'CREATED'
  | 'SCHEDULED'
  | 'SAMPLE_COLLECTED'
  | 'IN_TRANSIT'
  | 'ACCESSIONED'
  | 'RESULT_READY'
  | 'ESCALATED'
  | 'RELEASED'
  | 'CANCELLED';

export type CollectionMode = 'home' | 'walk_in';

export interface LabOrderLine {
  refId: string;
  kind: 'test' | 'package';
  name: string;
  priceKobo: number;
}

export interface ChainOfCustodyEvent {
  id: string;
  step: 'collected' | 'sealed' | 'in_transit' | 'received' | 'accessioned' | 'breached';
  label: string;
  at: string;
  actor: string;
  note?: string;
  /** True if this event marks an integrity breach → recollect (HL-6). */
  breach?: boolean;
}

export interface LabOrder {
  id: string;
  status: LabOrderStatus;
  labId: string;
  labName: string;
  collectionMode: CollectionMode;
  lines: LabOrderLine[];
  subtotalKobo: number;
  collectionFeeKobo: number;
  totalKobo: number;
  /** HL-9: payment held at checkout, released on result release. */
  paymentHeld: boolean;
  createdAt: string;
  scheduledFor?: string;
  location: string;
  sampleBarcode?: string;
  phlebotomistId?: string;
  phlebotomistName?: string;
  resultId?: string;
  /** True when any analyte is critical and escalation is in progress (HL-7). */
  hasCritical?: boolean;
  custody: ChainOfCustodyEvent[];
}

// ── Results (HL-7 critical flag · HL-8 consent-gated) ─────────────────────────
export type AnalyteFlag = 'normal' | 'low' | 'high' | 'critical';

export interface ResultAnalyte {
  id: string;
  name: string;
  value: string;
  unit: string;
  referenceRange: string;
  flag: AnalyteFlag;
}

export type ResultStatus = 'RESULT_READY' | 'ESCALATED' | 'RELEASED';

export interface CriticalEscalation {
  /** HL-7: never silent — who was notified and the current escalation status. */
  status: 'pending' | 'acknowledged' | 'patient_notified' | 'resolved';
  raisedAt: string;
  analyteName: string;
  steps: { label: string; at?: string; done: boolean }[];
  notifiedClinician?: string;
}

export interface LabResult {
  id: string;
  orderId: string;
  testName: string;
  labName: string;
  status: ResultStatus;
  /** Validated & released by (scientist sign-off, HL-7). */
  releasedBy?: string;
  releasedAt?: string;
  collectedAt: string;
  analytes: ResultAnalyte[];
  hasAbnormal: boolean;
  hasCritical: boolean;
  escalation?: CriticalEscalation;
  interpretation?: string;
  /** Signed-URL PDF fetched on demand (HL-8). */
  docId?: string;
}

export interface ResultConsent {
  resultId: string;
  acknowledged: boolean;
  acknowledgedAt?: string;
}

// ── Reviews ──────────────────────────────────────────────────────────────────
export interface LabReview {
  id: string;
  author: string;
  rating: number;
  body: string;
  at: string;
}

export interface SubmitReviewInput {
  orderId: string;
  labId: string;
  rating: number;
  body: string;
}

// ── Inputs ───────────────────────────────────────────────────────────────────
export interface CreateOrderInput {
  labId: string;
  collectionMode: CollectionMode;
  lines: LabOrderLine[];
  scheduledFor?: string;
  location: string;
  idempotencyKey: string;
}

export interface ShareResultInput {
  resultId: string;
  granteeName: string;
  scopeNote?: string;
}

// ── Provider / lab-side ──────────────────────────────────────────────────────
export type ProviderOnboardingStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'needs_info'
  | 'approved';

export interface ProviderOnboardingState {
  status: ProviderOnboardingStatus;
  businessName: string;
  /** MLSCN facility licence number. */
  mlscnLicenseNo: string;
  contactName: string;
}

export interface SubmitOnboardingInput {
  businessName: string;
  mlscnLicenseNo: string;
  contactName: string;
}

export interface CatalogPriceItem {
  testId: string;
  name: string;
  code: string;
  priceKobo: number;
  active: boolean;
  tat: string;
}

export interface ProviderOrderRow {
  orderId: string;
  patientName: string;
  status: LabOrderStatus;
  testSummary: string;
  collectionMode: CollectionMode;
  sampleBarcode?: string;
  createdAt: string;
  hasCritical?: boolean;
}

export interface AccessionInput {
  orderId: string;
  barcode: string;
  conditionOk: boolean;
  note?: string;
}

export interface ResultEntryAnalyte {
  id: string;
  name: string;
  value: string;
  unit: string;
  referenceRange: string;
  flag: AnalyteFlag;
}

export interface ResultEntryInput {
  orderId: string;
  analytes: ResultEntryAnalyte[];
  interpretation?: string;
}

export interface ResultReleaseInput {
  orderId: string;
  resultId: string;
  /** Scientist sign-off name (HL-7). */
  signedBy: string;
  criticalAcknowledged?: boolean;
}

export interface ProviderEarnings {
  availableKobo: number;
  pendingKobo: number;
  heldKobo: number;
  payouts: { id: string; amountKobo: number; at: string; status: 'paid' | 'processing' }[];
}

// ── Phlebotomist-side ────────────────────────────────────────────────────────
export interface CollectionAssignment {
  orderId: string;
  patientName: string;
  address: string;
  lat: number;
  lng: number;
  scheduledFor: string;
  testSummary: string;
  sampleType: SampleType;
  status: 'assigned' | 'en_route' | 'arrived' | 'collected' | 'dropped_off';
  distanceLabel: string;
}

export interface CollectionChecklistItem {
  id: string;
  label: string;
  done: boolean;
  required: boolean;
}

export interface ChainOfCustodyInput {
  orderId: string;
  barcode: string;
  conditionOk: boolean;
  note?: string;
}

export interface DropOffInput {
  orderId: string;
  labId: string;
  barcode: string;
  note?: string;
}
