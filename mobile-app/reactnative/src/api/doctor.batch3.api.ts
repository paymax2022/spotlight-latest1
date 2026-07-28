// ── Doctor (Telemedicine, provider-side) — Batch 3 API client ────────────────
// Batch 3 = spec sections K, L, M, N. Phase A style: every function resolves
// demo data so screens render without a live API. `DEMO_*` exports double as
// `placeholderData` in useQuery. ADDITIVE to `@/api/doctor.api`,
// `@/api/doctor.phase2.api` and the other doctor api files — earlier
// fns/exports are untouched.
//
// Sections: K e-prescription (RxDrugLine + IssuedPrescription + warnings/audit),
// L pharmacy & drug fulfilment (Pharmacy + stock + messages; REUSES Phase 2
// pharmacy/delivery/substitute), M lab ordering (LabCatalogueEntry + packages +
// providers + options; REUSES Phase 1 lab order), N lab result review
// (LabResultRich + interpretation + compare + inbox; REUSES Phase 1 result).
//
// TODO(Phase C): replace each body with the live endpoint, e.g.
//   const res = await api.get('/api/v1/doctor/prescriptions/:id'); return res.data.data;
// uploads → presigned R2 PUT; mutations pass the Idempotency-Key header below.

import { DEMO_PATIENT_PROFILE } from '@/api/doctor.api';
import {
  DRUG_CATALOGUE_RICH,
  DRUG_ALTERNATIVES,
  LAB_PACKAGES,
  SAMPLE_TYPE_OPTIONS,
  RX_VALIDITY_DAYS,
} from '@/features/doctor/constants/batch3';
import { LAB_TEST_CATALOGUE } from '@/features/doctor/constants';
import type {
  RxDrugLine,
  RxWarning,
  IssuedPrescription,
  DrugCatalogueEntry,
  DrugAlternative,
  Pharmacy,
  DrugStock,
  PharmacyMessage,
  DeliveryAlert,
  LabCatalogueEntry,
  LabPackage,
  LabProvider,
  LabCoverageCheck,
  LabOrderRich,
  LabResultInbox,
  LabResultRich,
  LabResultValueRich,
  LabValueComparison,
  LabInterpretation,
  IssuePrescriptionInput,
  IssuePrescriptionResult,
  CancelPrescriptionInput,
  CancelPrescriptionResult,
  SharePrescriptionInput,
  SharePrescriptionResult,
  SendToPharmacyInput,
  SendToPharmacyResult,
  RequestRefillConsultationInput,
  RequestRefillConsultationResult,
  SelectPharmacyInput,
  SelectPharmacyResult,
  SendPharmacyMessageInput,
  SendPharmacyMessageResult,
  ConfirmPatientReceivedInput,
  ConfirmPatientReceivedResult,
  ReportPharmacyInput,
  ReportPharmacyResult,
  ShareLabOrderInput,
  ShareLabOrderResult,
  CancelLabOrderInput,
  CancelLabOrderResult,
  AddInterpretationInput,
  AddInterpretationResult,
  RequestRepeatTestInput,
  RequestRepeatTestResult,
  ShareResultExplanationInput,
  ShareResultExplanationResult,
  ReportSuspiciousResultInput,
  ReportSuspiciousResultResult,
} from '@/types/doctor.batch3';

// Re-export the shared money formatter so Batch 3 screens can import it here.
export { formatKobo } from '@/api/doctor.api';
import { DOCTOR_USE_MOCK, doctorGet, doctorPost, doctorPut } from '@/api/doctor.client';

// Simulate network latency so loading states are exercised in the UI.
const wait = <T>(value: T, ms = 350): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

const iso = (offsetMs = 0): string => new Date(Date.now() + offsetMs).toISOString();
const isoDate = (daysFromNow: number): string =>
  new Date(Date.now() + daysFromNow * 86400000).toISOString().slice(0, 10);

const PATIENT = DEMO_PATIENT_PROFILE.patient;

// ═══════════════════════════════════════════════════════════════════════════
// SECTION K — E-PRESCRIPTION
// ═══════════════════════════════════════════════════════════════════════════

// Drug catalogue lookups are pure client-side filters (no round-trip) so the rx
// builder can search/lookup inline. REUSES the richer DRUG_CATALOGUE_RICH.
export function searchDrugCatalogue(query: string): DrugCatalogueEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return DRUG_CATALOGUE_RICH;
  return DRUG_CATALOGUE_RICH.filter(
    (d) => d.name.toLowerCase().includes(q) || (d.classLabel?.toLowerCase().includes(q) ?? false),
  );
}

// Generic/brand alternatives lookup for a drug (alternatives sheet).
export function getDrugAlternatives(drugName: string): DrugAlternative[] {
  const n = drugName.trim().toLowerCase();
  if (!n) return [];
  return DRUG_ALTERNATIVES.filter((a) => a.forDrug.toLowerCase() === n);
}

// Pure safety-warning helper (mirrors the `checkOverbooking` pattern). Given the
// prescription lines plus the patient context, it derives the `RxWarning[]` the
// UI renders as banners. No latency — the builder calls it inline as the doctor
// edits. The patient context defaults model a typical adult, non-pregnant case.
export interface PrescriptionWarningContext {
  allergies?:      string[];      // documented allergens (e.g. "Penicillin")
  isPregnant?:     boolean;
  isBreastfeeding?: boolean;
  isPaediatric?:   boolean;
  isElderly?:      boolean;
  currentMedications?: string[];  // existing meds for interaction/duplicate checks
}

// Known unsafe-in-pregnancy drug classes/names (demo heuristic only).
const PREGNANCY_UNSAFE = ['lisinopril', 'enalapril', 'ibuprofen', 'codeine', 'diazepam'];
// Simple demo interaction pairs (drug A ↔ drug B).
const INTERACTION_PAIRS: [string, string][] = [
  ['ibuprofen', 'lisinopril'],
  ['ibuprofen', 'enalapril'],
  ['diazepam', 'codeine'],
];

export function checkPrescriptionWarnings(
  lines: RxDrugLine[],
  context: PrescriptionWarningContext = {},
): RxWarning[] {
  const warnings: RxWarning[] = [];
  const names = lines.map((l) => l.base.name.trim().toLowerCase());
  const allergens = (context.allergies ?? []).map((a) => a.toLowerCase());
  const existing = (context.currentMedications ?? []).map((m) => m.toLowerCase());
  let seq = 0;
  const next = () => `rxw-${++seq}`;

  lines.forEach((line) => {
    const drug = line.base.name;
    const lower = drug.trim().toLowerCase();
    const entry = DRUG_CATALOGUE_RICH.find((d) => d.name.toLowerCase() === lower);

    // Contraindication via documented allergy.
    if (allergens.some((a) => lower.includes(a) || a.includes(lower) || (entry?.classLabel?.toLowerCase().includes(a) ?? false))) {
      warnings.push({
        id: next(), kind: 'contraindication', severity: 'critical', drug,
        title: 'Allergy contraindication',
        detail: `${drug} may trigger a documented allergy. Confirm before prescribing.`,
      });
    }

    // Controlled substance notice.
    if (entry?.isControlled) {
      warnings.push({
        id: next(), kind: 'controlled', severity: 'warning', drug,
        title: 'Controlled substance',
        detail: `${drug} is a controlled substance — ensure prescribing rules are met.`,
      });
    }

    // Pregnancy / breastfeeding caution.
    if ((context.isPregnant || context.isBreastfeeding) && PREGNANCY_UNSAFE.includes(lower)) {
      warnings.push({
        id: next(), kind: 'pregnancy_breastfeeding', severity: 'critical', drug,
        title: 'Unsafe in pregnancy / breastfeeding',
        detail: `${drug} is not recommended in pregnancy or breastfeeding.`,
      });
    }

    // Paediatric dosing caution.
    if (context.isPaediatric) {
      warnings.push({
        id: next(), kind: 'paediatric_dose', severity: 'warning', drug,
        title: 'Paediatric dosing',
        detail: `Verify the weight-based paediatric dose for ${drug}.`,
      });
    }

    // Elderly dosing caution.
    if (context.isElderly) {
      warnings.push({
        id: next(), kind: 'elderly_dose', severity: 'info', drug,
        title: 'Elderly dosing',
        detail: `Consider a reduced starting dose of ${drug} for an elderly patient.`,
      });
    }
  });

  // Duplicate therapy (same drug twice, or already on the same medication).
  names.forEach((n, i) => {
    if (names.indexOf(n) !== i || existing.some((m) => m.includes(n))) {
      warnings.push({
        id: next(), kind: 'duplicate', severity: 'warning', drug: lines[i].base.name,
        title: 'Duplicate therapy',
        detail: `${lines[i].base.name} appears more than once or is already prescribed.`,
      });
    }
  });

  // Drug–drug interactions across the prescribed + existing meds.
  const allMeds = [...names, ...existing];
  INTERACTION_PAIRS.forEach(([a, b]) => {
    if (allMeds.includes(a) && allMeds.includes(b)) {
      warnings.push({
        id: next(), kind: 'interaction', severity: 'critical', drug: a,
        title: 'Drug interaction', relatedTo: b,
        detail: `${a} interacts with ${b} — review before issuing.`,
      });
    }
  });

  return warnings;
}

// A demo rich drug line built from a Phase 1 item (composition example).
const demoLine = (
  name: string, strength: string, form: RxDrugLine['dosageForm'], qty: number,
  frequency: string, duration: string, food: RxDrugLine['beforeAfterFood'],
  warnings: RxWarning[] = [], specialInstruction?: string,
): RxDrugLine => ({
  base: { name, dosage: strength, route: 'Oral', frequency, duration, notes: specialInstruction },
  strength, dosageForm: form, route: 'Oral', beforeAfterFood: food,
  specialInstruction, quantity: qty, warnings,
});

const DEMO_RX_LINES: RxDrugLine[] = [
  demoLine('Metformin', '500mg', 'tablet', 60, 'Twice daily', '30 days', 'after_food'),
  demoLine('Amlodipine', '5mg', 'tablet', 30, 'Once daily', '30 days', 'any', [
    { id: 'rxw-seed-1', kind: 'duplicate', severity: 'warning', drug: 'Amlodipine', title: 'Duplicate therapy', detail: 'Patient is already on Amlodipine 5mg.' },
  ]),
];

// The issued prescription COMPOSES the Phase 1 DoctorPrescription as `base`.
export const DEMO_ISSUED_PRESCRIPTION: IssuedPrescription = {
  base: {
    id: 'rx-1', ref: 'RX-4F2A41', appointmentId: 'apt-4', patient: PATIENT, doctorName: 'Dr. Amaka Obi',
    diagnosis: 'Type 2 Diabetes Mellitus', issuedAt: iso(-2 * 86400000), status: 'issued',
    items: DEMO_RX_LINES.map((l) => l.base),
  },
  lines: DEMO_RX_LINES,
  lifecycle: 'issued',
  warnings: DEMO_RX_LINES.flatMap((l) => l.warnings),
  signature: {
    signedBy: 'Dr. Amaka Obi', mdcnNumber: 'MDCN/R/45821',
    signedAt: iso(-2 * 86400000), signatureId: 'sig-7C1B88',
  },
  qrPayload: 'spotlight-rx://verify/RX-4F2A41?code=VX-4F2A41',
  verificationCode: 'VX-4F2A41',
  validUntil: isoDate(RX_VALIDITY_DAYS - 2),
  pharmacyName: 'HealthPlus Pharmacy, Lekki',
  audit: [
    { id: 'rxa-1', action: 'created',          actor: 'Dr. Amaka Obi', at: iso(-2 * 86400000 - 3600000), detail: '2 drug lines' },
    { id: 'rxa-2', action: 'signed',           actor: 'Dr. Amaka Obi', at: iso(-2 * 86400000 - 1800000) },
    { id: 'rxa-3', action: 'issued',           actor: 'Dr. Amaka Obi', at: iso(-2 * 86400000) },
    { id: 'rxa-4', action: 'sent_to_pharmacy', actor: 'Dr. Amaka Obi', at: iso(-2 * 86400000 + 600000), detail: 'HealthPlus Pharmacy, Lekki' },
  ],
};

export async function getIssuedPrescription(id: string): Promise<IssuedPrescription> {
  if (DOCTOR_USE_MOCK) return wait({ ...DEMO_ISSUED_PRESCRIPTION, base: { ...DEMO_ISSUED_PRESCRIPTION.base, id } });
  return doctorGet<IssuedPrescription>(`/prescriptions/${id}/issued`);
}

export async function issuePrescription(input: IssuePrescriptionInput): Promise<IssuePrescriptionResult> {
  if (!DOCTOR_USE_MOCK) return doctorPost<IssuePrescriptionResult>(`/prescriptions/${input.prescriptionId}/issue`, input, input.idempotencyKey);
  void input.signaturePin;
  const code = `VX-${input.idempotencyKey.slice(-6).toUpperCase()}`;
  const days = input.validDays ?? RX_VALIDITY_DAYS;
  return wait({
    prescriptionId: input.prescriptionId,
    ref: `RX-${input.idempotencyKey.slice(-6).toUpperCase()}`,
    lifecycle: 'issued' as const,
    verificationCode: code,
    qrPayload: `spotlight-rx://verify/${input.prescriptionId}?code=${code}`,
    validUntil: isoDate(days),
  }, 600);
}

export async function cancelPrescription(input: CancelPrescriptionInput): Promise<CancelPrescriptionResult> {
  if (DOCTOR_USE_MOCK) {
    void input.reason;
    return wait({ prescriptionId: input.prescriptionId, lifecycle: 'cancelled' as const }, 500);
  }
  return doctorPost<CancelPrescriptionResult>(`/prescriptions/${input.prescriptionId}/cancel`, input, input.idempotencyKey);
}

export async function sharePrescription(input: SharePrescriptionInput): Promise<SharePrescriptionResult> {
  if (DOCTOR_USE_MOCK) {
    return wait({
      prescriptionId: input.prescriptionId, shared: true,
      shareUrl: input.channel === 'link' || input.channel === 'pdf' ? `https://rx.spotlight.ng/${input.prescriptionId}` : undefined,
    }, 500);
  }
  return doctorPost<SharePrescriptionResult>(`/prescriptions/${input.prescriptionId}/share`, input, input.idempotencyKey);
}

export async function sendToPharmacy(input: SendToPharmacyInput): Promise<SendToPharmacyResult> {
  if (DOCTOR_USE_MOCK) {
    return wait({
      prescriptionId: input.prescriptionId,
      fulfilmentId: input.pharmacyId ? `pf-${Date.now()}` : undefined,
      status: 'received' as const,
    }, 600);
  }
  return doctorPost<SendToPharmacyResult>(`/prescriptions/${input.prescriptionId}/send-to-pharmacy`, input, input.idempotencyKey);
}

export async function requestRefillConsultation(
  input: RequestRefillConsultationInput,
): Promise<RequestRefillConsultationResult> {
  if (!DOCTOR_USE_MOCK) return doctorPost<RequestRefillConsultationResult>(`/prescriptions/${input.prescriptionId}/refill-consultation`, input, input.idempotencyKey);
  void (input.patientId, input.reason);
  return wait({ consultRequestId: `crq-${Date.now()}`, ref: `CRQ-${input.idempotencyKey.slice(-6).toUpperCase()}` }, 500);
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION L — PHARMACY & DRUG FULFILMENT
// ═══════════════════════════════════════════════════════════════════════════
// REUSES Phase 2 `getPharmacyFulfilments` / `getDrugDeliveries` / `reviewSubstitute`
// (not re-declared here). Adds the pharmacy directory, stock, messages, alerts.

export const DEMO_PHARMACIES: Pharmacy[] = [
  { id: 'ph-1', name: 'HealthPlus Pharmacy, Lekki', address: '14 Admiralty Way, Lekki Phase 1', verified: true,  distanceKm: 1.2, rating: 4.7, isPreferred: true,  hasStock: true,  deliversToday: true,  phone: '+234 700 000 0001' },
  { id: 'ph-2', name: 'MedPlus Pharmacy, Ikeja',    address: '5 Allen Avenue, Ikeja',            verified: true,  distanceKm: 8.4, rating: 4.5, isPreferred: false, hasStock: true,  deliversToday: true },
  { id: 'ph-3', name: 'Alpha Pharmacy, VI',         address: '22 Adeola Odeku St, VI',          verified: true,  distanceKm: 3.0, rating: 4.2, isPreferred: false, hasStock: false, deliversToday: false },
  { id: 'ph-4', name: 'CarePoint Chemist',          address: '9 Bode Thomas, Surulere',         verified: false, distanceKm: 12.1, rating: 3.9, isPreferred: false, hasStock: true,  deliversToday: false },
];

export const DEMO_DRUG_STOCK: DrugStock[] = [
  { pharmacyId: 'ph-1', drugName: 'Metformin',  strength: '500mg', level: 'in_stock',     unitPriceKobo: 1500 },
  { pharmacyId: 'ph-1', drugName: 'Amlodipine', strength: '5mg',   level: 'in_stock',     unitPriceKobo: 2000 },
  { pharmacyId: 'ph-3', drugName: 'Metformin',  strength: '500mg', level: 'out_of_stock', note: 'Restock expected in 2 days' },
  { pharmacyId: 'ph-3', drugName: 'Amlodipine', strength: '5mg',   level: 'low_stock',    unitPriceKobo: 2200 },
];

export const DEMO_PHARMACY_MESSAGES: PharmacyMessage[] = [
  { id: 'pm-1', fulfilmentId: 'pf-1', author: 'pharmacist', body: 'Lisinopril 10mg is out of stock. May we substitute Enalapril 10mg?', createdAt: iso(-40 * 60000) },
  { id: 'pm-2', fulfilmentId: 'pf-1', author: 'doctor',     body: 'Yes, Enalapril 10mg is acceptable. Please proceed.',                createdAt: iso(-35 * 60000) },
];

export const DEMO_DELIVERY_ALERTS: DeliveryAlert[] = [
  { id: 'da-1', deliveryId: 'dlv-1', kind: 'delayed', detail: 'Courier delayed by traffic — new ETA 6–7 PM.', at: iso(-20 * 60000) },
];

export async function getPharmacies(patientId?: string): Promise<Pharmacy[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PHARMACIES);
  return doctorGet<Pharmacy[]>('/pharmacies', { patientId });
}

export async function getPreferredPharmacy(patientId?: string): Promise<Pharmacy | undefined> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PHARMACIES.find((p) => p.isPreferred));
  return doctorGet<Pharmacy | undefined>('/pharmacies/preferred', { patientId });
}

export async function getDrugStock(pharmacyId: string): Promise<DrugStock[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_DRUG_STOCK.filter((s) => s.pharmacyId === pharmacyId));
  return doctorGet<DrugStock[]>(`/pharmacies/${pharmacyId}/stock`);
}

export async function getPharmacyMessages(fulfilmentId: string): Promise<PharmacyMessage[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PHARMACY_MESSAGES.filter((m) => m.fulfilmentId === fulfilmentId));
  return doctorGet<PharmacyMessage[]>(`/pharmacy/${fulfilmentId}/messages`);
}

export async function getDeliveryAlerts(): Promise<DeliveryAlert[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_DELIVERY_ALERTS);
  return doctorGet<DeliveryAlert[]>('/delivery-alerts');
}

export async function selectPharmacy(input: SelectPharmacyInput): Promise<SelectPharmacyResult> {
  if (DOCTOR_USE_MOCK) return wait({ fulfilmentId: `pf-${Date.now()}`, pharmacyId: input.pharmacyId, status: 'received' as const }, 500);
  return doctorPost<SelectPharmacyResult>(`/prescriptions/${input.prescriptionId}/pharmacy`, input, input.idempotencyKey);
}

export async function sendPharmacyMessage(input: SendPharmacyMessageInput): Promise<SendPharmacyMessageResult> {
  if (DOCTOR_USE_MOCK) {
    const message: PharmacyMessage = {
      id: `pm-${Date.now()}`, fulfilmentId: input.fulfilmentId, author: 'doctor',
      body: input.body, createdAt: new Date().toISOString(),
      attachmentUrl: input.attachmentUrl, attachmentName: input.attachmentName,
    };
    return wait({ message }, 400);
  }
  return doctorPost<SendPharmacyMessageResult>(`/pharmacy/${input.fulfilmentId}/messages`, input, input.idempotencyKey);
}

export async function confirmPatientReceived(input: ConfirmPatientReceivedInput): Promise<ConfirmPatientReceivedResult> {
  if (DOCTOR_USE_MOCK) return wait({ fulfilmentId: input.fulfilmentId, status: 'received_by_patient' as const }, 500);
  return doctorPost<ConfirmPatientReceivedResult>(`/pharmacy/${input.fulfilmentId}/received`, input, input.idempotencyKey);
}

export async function reportPharmacy(input: ReportPharmacyInput): Promise<ReportPharmacyResult> {
  if (DOCTOR_USE_MOCK) {
    void (input.reason, input.detail, input.fulfilmentId);
    return wait({ reportId: `prep-${Date.now()}`, ref: `PREP-${input.idempotencyKey.slice(-6).toUpperCase()}` }, 500);
  }
  return doctorPost<ReportPharmacyResult>(`/pharmacy/${input.pharmacyId}/report`, input, input.idempotencyKey);
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION M — LAB TEST ORDERING
// ═══════════════════════════════════════════════════════════════════════════
// REUSES Phase 1 `createLabOrder` / `getLabOrders` (not re-declared). Adds the
// richer catalogue, packages, providers, coverage check and rich order view.

const SAMPLE_TYPE_FOR: Record<string, LabCatalogueEntry['sampleType']> = {
  'lt-urin': 'urine', 'lt-hcg': 'urine',
};

const PRICE_FOR: Record<string, number> = {
  'lt-fbc': 450000, 'lt-mp': 250000, 'lt-hba1c': 600000, 'lt-fbs': 200000,
  'lt-lipid': 550000, 'lt-lft': 600000, 'lt-euc': 550000, 'lt-urin': 200000,
  'lt-hcg': 300000, 'lt-tsh': 700000,
};

const FASTING_TESTS = new Set(['lt-fbs', 'lt-lipid', 'lt-hba1c']);

// The lab catalogue COMPOSES the Phase 1 LAB_TEST_CATALOGUE (reused as `base`)
// and adds sample type / fasting / price / turnaround.
export const DEMO_LAB_CATALOGUE: LabCatalogueEntry[] = LAB_TEST_CATALOGUE.map((t) => {
  const fasting = FASTING_TESTS.has(t.id);
  const sampleType = SAMPLE_TYPE_FOR[t.id] ?? 'blood';
  return {
    base: t,
    sampleType,
    fastingRequired: fasting,
    fastingHours: fasting ? 8 : undefined,
    priceKobo: PRICE_FOR[t.id] ?? 400000,
    turnaroundHours: t.category === 'Haematology' ? 24 : 48,
    sampleInstruction: SAMPLE_TYPE_OPTIONS.find((s) => s.value === sampleType)?.instruction,
  };
});

export const DEMO_LAB_PROVIDERS: LabProvider[] = [
  { id: 'lp-1', name: 'Synlab Nigeria',  verified: true,  rating: 4.8, distanceKm: 2.1, homeCollection: true,  recommended: true,  turnaroundLabel: '24–48 hrs' },
  { id: 'lp-2', name: 'Clina-Lancet',    verified: true,  rating: 4.6, distanceKm: 5.5, homeCollection: true,  recommended: false, turnaroundLabel: '48 hrs' },
  { id: 'lp-3', name: 'Afriglobal Medicare', verified: true, rating: 4.4, distanceKm: 7.2, homeCollection: false, recommended: false, turnaroundLabel: '24–72 hrs' },
];

// The rich lab order COMPOSES the Phase 1 LabOrder as `base`.
export const DEMO_LAB_ORDER_RICH: LabOrderRich = {
  base: {
    id: 'lab-1', ref: 'LAB-8C1B22', appointmentId: 'apt-4', patient: PATIENT,
    tests: [
      LAB_TEST_CATALOGUE.find((t) => t.id === 'lt-hba1c')!,
      LAB_TEST_CATALOGUE.find((t) => t.id === 'lt-lipid')!,
    ],
    clinicalNote: 'Diabetes monitoring. Fasting sample preferred for lipid profile.',
    status: 'resulted', orderedAt: iso(-2 * 86400000), priority: 'routine',
  },
  reason: 'Routine diabetes and cardiovascular risk monitoring.',
  linkedDiagnosis: 'Type 2 Diabetes Mellitus',
  urgency: 'routine',
  collectionMode: 'home_collection',
  provider: DEMO_LAB_PROVIDERS[0],
  coverage: {
    isHmo: true, provider: 'Hygeia HMO', covered: true,
    coveredTestIds: ['lt-hba1c'], patientPayKobo: 550000,
    authCode: 'AUTH-91X4', note: 'Lipid profile not covered — patient pays.',
  },
  fastingRequired: true,
  validUntil: isoDate(14),
};

export async function getLabCatalogue(): Promise<LabCatalogueEntry[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_LAB_CATALOGUE);
  return doctorGet<LabCatalogueEntry[]>('/lab-catalogue');
}

export async function getLabPackages(): Promise<LabPackage[]> {
  if (DOCTOR_USE_MOCK) return wait(LAB_PACKAGES);
  return doctorGet<LabPackage[]>('/lab-packages');
}

export async function getLabProviders(): Promise<LabProvider[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_LAB_PROVIDERS);
  return doctorGet<LabProvider[]>('/lab-providers');
}

export async function getLabOrderRich(orderId: string): Promise<LabOrderRich> {
  if (DOCTOR_USE_MOCK) return wait({ ...DEMO_LAB_ORDER_RICH, base: { ...DEMO_LAB_ORDER_RICH.base, id: orderId } });
  return doctorGet<LabOrderRich>(`/lab-orders/${orderId}/rich`);
}

// Pure HMO-coverage check for a set of tests (patient-pay notice). No latency so
// the order builder can surface the patient-pay amount inline as tests change.
export function checkLabCoverage(
  testIds: string[],
  opts: { isHmo: boolean; provider?: string; coveredTestIds?: string[] } = { isHmo: false },
): LabCoverageCheck {
  const covered = opts.coveredTestIds ?? [];
  const coveredHere = testIds.filter((id) => covered.includes(id));
  const uncovered = testIds.filter((id) => !covered.includes(id));
  const patientPayKobo = uncovered.reduce((sum, id) => sum + (PRICE_FOR[id] ?? 400000), 0);
  const allCovered = opts.isHmo && uncovered.length === 0;
  return {
    isHmo: opts.isHmo,
    provider: opts.provider,
    covered: allCovered,
    coveredTestIds: coveredHere,
    patientPayKobo: opts.isHmo ? patientPayKobo : testIds.reduce((s, id) => s + (PRICE_FOR[id] ?? 400000), 0),
    authCode: allCovered ? 'AUTH-PENDING' : undefined,
    note: opts.isHmo && uncovered.length > 0 ? 'Some tests are not covered — patient pays the balance.' : undefined,
  };
}

export async function shareLabOrder(input: ShareLabOrderInput): Promise<ShareLabOrderResult> {
  if (DOCTOR_USE_MOCK) {
    return wait({
      orderId: input.orderId, shared: true,
      shareUrl: input.channel === 'link' || input.channel === 'pdf' ? `https://lab.spotlight.ng/${input.orderId}` : undefined,
    }, 500);
  }
  return doctorPost<ShareLabOrderResult>(`/lab-orders/${input.orderId}/share`, input, input.idempotencyKey);
}

export async function cancelLabOrder(input: CancelLabOrderInput): Promise<CancelLabOrderResult> {
  if (DOCTOR_USE_MOCK) {
    void input.reason;
    return wait({ orderId: input.orderId, status: 'ordered' as const, cancelled: true }, 500);
  }
  return doctorPost<CancelLabOrderResult>(`/lab-orders/${input.orderId}/cancel`, input, input.idempotencyKey);
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION N — LAB RESULT REVIEW
// ═══════════════════════════════════════════════════════════════════════════
// REUSES Phase 1 `getLabResult` / `markLabResultReviewed` (not re-declared).
// Adds the inbox, rich result (PDF + structured values + compare + interpretation
// + audit) and the interpretation / repeat / share / report mutations.

export const DEMO_RESULT_INBOX: LabResultInbox[] = [
  { resultId: 'res-1', orderId: 'lab-1', ref: 'LAB-8C1B22', patient: PATIENT, status: 'ready',   isNew: true,  hasCritical: true,  reportedAt: iso(-86400000), labName: 'Synlab Nigeria' },
  { resultId: 'res-2', orderId: 'lab-2', ref: 'LAB-3D0F90', patient: PATIENT, status: 'pending', isNew: false, hasCritical: false, labName: 'Clina-Lancet' },
  { resultId: 'res-3', orderId: 'lab-3', ref: 'LAB-7C1B22', patient: PATIENT, status: 'delayed', isNew: false, hasCritical: false, labName: 'Afriglobal Medicare' },
];

const DEMO_RICH_VALUES: LabResultValueRich[] = [
  { base: { testName: 'HbA1c',             value: '7.1', unit: '%',      refRange: '4.0–5.6', flag: 'high' },   abnormal: true,  critical: false, refLow: 4.0, refHigh: 5.6 },
  { base: { testName: 'Total Cholesterol', value: '4.8', unit: 'mmol/L', refRange: '< 5.2',   flag: 'normal' }, abnormal: false, critical: false, refHigh: 5.2 },
  { base: { testName: 'LDL',               value: '3.4', unit: 'mmol/L', refRange: '< 3.0',   flag: 'high' },   abnormal: true,  critical: false, refHigh: 3.0 },
  { base: { testName: 'Potassium',         value: '6.3', unit: 'mmol/L', refRange: '3.5–5.1', flag: 'high' },   abnormal: true,  critical: true,  refLow: 3.5, refHigh: 5.1 },
];

const DEMO_COMPARISONS: LabValueComparison[] = [
  {
    testName: 'HbA1c', unit: '%', refRange: '4.0–5.6',
    points: [
      { reportedAt: iso(-180 * 86400000), value: '8.2', numericValue: 8.2, flag: 'high' },
      { reportedAt: iso(-90 * 86400000),  value: '7.6', numericValue: 7.6, flag: 'high' },
      { reportedAt: iso(-86400000),       value: '7.1', numericValue: 7.1, flag: 'high' },
    ],
  },
];

// The rich result COMPOSES the Phase 1 LabResult as `base`.
export const DEMO_LAB_RESULT_RICH: LabResultRich = {
  base: {
    id: 'res-1', orderId: 'lab-1', ref: 'LAB-8C1B22', patient: PATIENT,
    values: DEMO_RICH_VALUES.map((v) => v.base),
    reportedAt: iso(-86400000), labName: 'Synlab Nigeria', reviewed: false,
  },
  status: 'ready',
  isNew: true,
  hasCritical: true,
  pdfReportUrl: 'https://lab.spotlight.ng/reports/LAB-8C1B22.pdf',
  richValues: DEMO_RICH_VALUES,
  comparisons: DEMO_COMPARISONS,
  audit: [
    { id: 'lra-1', action: 'viewed', actor: 'Dr. Amaka Obi', at: iso(-60 * 60000) },
  ],
};

export async function getResultInbox(): Promise<LabResultInbox[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_RESULT_INBOX);
  return doctorGet<LabResultInbox[]>('/lab-results/inbox');
}

export async function getLabResultRich(resultId: string): Promise<LabResultRich> {
  if (DOCTOR_USE_MOCK) return wait({ ...DEMO_LAB_RESULT_RICH, base: { ...DEMO_LAB_RESULT_RICH.base, id: resultId } });
  return doctorGet<LabResultRich>(`/lab-results/${resultId}/rich`);
}

export async function getLabValueComparisons(resultId: string): Promise<LabValueComparison[]> {
  if (DOCTOR_USE_MOCK) {
    void resultId;
    return wait(DEMO_COMPARISONS);
  }
  return doctorGet<LabValueComparison[]>(`/lab-results/${resultId}/comparisons`);
}

export async function addInterpretation(input: AddInterpretationInput): Promise<AddInterpretationResult> {
  if (DOCTOR_USE_MOCK) {
    const now = new Date().toISOString();
    const interpretation: LabInterpretation = {
      resultId: input.resultId, interpretation: input.interpretation, recommendation: input.recommendation,
      sharedWithPatient: false, createdAt: now, updatedAt: now,
    };
    return wait({ resultId: input.resultId, interpretation }, 500);
  }
  return doctorPut<AddInterpretationResult>(`/lab-results/${input.resultId}/interpretation`, input, input.idempotencyKey);
}

export async function requestRepeatTest(input: RequestRepeatTestInput): Promise<RequestRepeatTestResult> {
  if (DOCTOR_USE_MOCK) {
    void (input.patientId, input.testIds, input.reason);
    return wait({ orderId: `lab-${Date.now()}`, ref: `LAB-${input.idempotencyKey.slice(-6).toUpperCase()}`, status: 'ordered' as const }, 600);
  }
  return doctorPost<RequestRepeatTestResult>('/lab-orders', input, input.idempotencyKey);
}

export async function shareResultExplanation(input: ShareResultExplanationInput): Promise<ShareResultExplanationResult> {
  if (DOCTOR_USE_MOCK) {
    void input.explanation;
    return wait({ resultId: input.resultId, sharedWithPatient: true, sharedAt: new Date().toISOString() }, 500);
  }
  return doctorPost<ShareResultExplanationResult>(`/lab-results/${input.resultId}/share-explanation`, input, input.idempotencyKey);
}

export async function reportSuspiciousResult(input: ReportSuspiciousResultInput): Promise<ReportSuspiciousResultResult> {
  if (DOCTOR_USE_MOCK) {
    void input.reason;
    return wait({ reportId: `lsr-${Date.now()}`, ref: `LSR-${input.idempotencyKey.slice(-6).toUpperCase()}` }, 500);
  }
  return doctorPost<ReportSuspiciousResultResult>(`/lab-results/${input.resultId}/report`, input, input.idempotencyKey);
}
