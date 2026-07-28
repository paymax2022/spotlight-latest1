// ── Doctor (Telemedicine, provider-side) — Batch 5 API client ────────────────
// Batch 5 = spec sections S · T · U · V (VETERINARY). Phase A style: every
// function resolves demo data so screens render without a live API; `DEMO_*`
// exports double as `placeholderData` in useQuery. ADDITIVE to the Phase 1 /
// Phase 2 / Section B / Phase 3 / Batch 1-4 api files — nothing earlier changes.
//
// CONSOLIDATED + heavy REUSE of Phase 3 vet/pet work and the Batch 2 rich
// chat/call/clinical-note demo data. Pure helpers `computePetDosage` and
// `checkPetRxWarnings` are exported for UI import. Money is always an integer in
// kobo.
//
// TODO(Phase C): replace each body with the live endpoint and pass the
//   Idempotency-Key header on every mutation below.

import { Colors } from '@/constants/colors';
import {
  DEMO_PET_PROFILE,
  DEMO_PET_PRESCRIPTION,
  DEMO_PET_LAB_RESULTS,
  DEMO_PET_PRODUCTS,
} from '@/api/doctor.phase3.api';
import {
  DEMO_THREAD_STATE,
  DEMO_RICH_MESSAGES,
  DEMO_CALL_SESSION_RICH,
  DEMO_CLINICAL_NOTE,
} from '@/api/doctor.batch2.api';
import type {
  VetAppointment,
  PetOwnerRequest,
  VetChatThread,
  VetCallSession,
  VetClinicalNote,
  PetEmergencyWarning,
  VetReferral,
  VetSpecialist,
  VetConsultSummary,
  VetConsultHistoryItem,
  PetRxWarning,
  PetDrug,
  PetDosageCalculation,
  PetPharmacy,
  IssuedPetPrescription,
  PetRefillRequest,
  PetLabCatalogueEntry,
  PetLabResultInboxItem,
  PetLabInterpretation,
  PetVaccinationRecommendation,
  PetVaccinationReminder,
  PetHealthRecord,
  PetGrowthHistory,
  PetChronicMonitoringEntry,
  PetProductDetail,
  PetProductFulfilment,
  PetSpecies,
  RespondToPetRequestInput,
  RespondToPetRequestResult,
  SaveVetSoapNoteInput,
  SaveVetSoapNoteResult,
  CreateVetReferralInput,
  CreateVetReferralResult,
  IssuePetPrescriptionInput,
  IssuePetPrescriptionResult,
  SendPetRxToPharmacyInput,
  SendPetRxToPharmacyResult,
  RequestPetRefillInput,
  RequestPetRefillResult,
  ReviewPetRefillInput,
  ReviewPetRefillResult,
  AddPetLabInterpretationInput,
  AddPetLabInterpretationResult,
  SetPetVaccinationReminderInput,
  SetPetVaccinationReminderResult,
  RecordPetGrowthInput,
  RecordPetGrowthResult,
  SavePetChronicMonitoringInput,
  SavePetChronicMonitoringResult,
  ShareProductWithOwnerInput,
  ShareProductWithOwnerResult,
} from '@/types/doctor.batch5';

// Re-export the shared money formatter so Batch 5 screens can import it here too.
export { formatKobo } from '@/api/doctor.api';
import { DOCTOR_USE_MOCK, doctorGet, doctorPost } from '@/api/doctor.client';

// Simulate network latency so loading states are exercised in the UI.
const wait = <T>(value: T, ms = 350): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

const iso = (daysAgo: number): string => new Date(Date.now() - daysAgo * 86400000).toISOString();
const isoDate = (daysFromNow: number): string =>
  new Date(Date.now() + daysFromNow * 86400000).toISOString().slice(0, 10);

// ═══════════════════════════════════════════════════════════════════════════
// PURE HELPERS (no I/O — safe for UI import)
// ═══════════════════════════════════════════════════════════════════════════

// Dose-by-weight: dosePerKgMg * weightKg, computed for the drug's low/high
// bounds with the suggested midpoint rounded. Pure — returns a display-only
// PetDosageCalculation (mirrors the Phase 3 shape exactly).
export function computePetDosage(drug: PetDrug, weightKg: number): PetDosageCalculation {
  const safeWeight = weightKg > 0 ? weightKg : 0;
  const doseLowMg = Math.round(drug.dosePerKgMgLow * safeWeight * 100) / 100;
  const doseHighMg = Math.round(drug.dosePerKgMgHigh * safeWeight * 100) / 100;
  const suggestedMg = Math.round((doseLowMg + doseHighMg) / 2);
  return {
    drugName:    drug.name,
    weightKg:    safeWeight,
    doseLowMg,
    doseHighMg,
    suggestedMg,
    frequency:   drug.defaultFrequency,
  };
}

// Returns every applicable warning for prescribing `drug` to a pet of `species`
// with the given `allergies`. Pure — three KINDS (medicine / species
// contraindication / allergy) over the Phase 3 PetWarningSeverity scale.
export function checkPetRxWarnings(drug: PetDrug, species: PetSpecies, allergies: string[]): PetRxWarning[] {
  const warnings: PetRxWarning[] = [];

  // 1. species contraindication (danger) — drug must NOT be given to this species
  if (drug.contraindicatedSpecies.includes(species)) {
    warnings.push({
      kind:     'species_contraindication',
      severity: 'danger',
      drugName: drug.name,
      message:  `${drug.name} is contraindicated in ${species}s — do not prescribe.`,
    });
  }

  // 2. allergy match (danger) — pet has the drug on its allergy list
  const allergyHit = allergies.find(
    (a) => a.toLowerCase() === drug.name.toLowerCase() || drug.name.toLowerCase().includes(a.toLowerCase()),
  );
  if (allergyHit) {
    warnings.push({
      kind:     'allergy',
      severity: 'danger',
      drugName: drug.name,
      message:  `Allergy on file: ${allergyHit}. Choose an alternative.`,
    });
  }

  // 3. generic medicine warnings (caution) — the drug's own safety notes
  for (const note of drug.warnings) {
    warnings.push({ kind: 'medicine', severity: 'caution', drugName: drug.name, message: note });
  }

  return warnings;
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION S — VETERINARY CONSULTATION
// ═══════════════════════════════════════════════════════════════════════════

// ─── Demo: vet appointments / queue ──────────────────────────────────────────
export const DEMO_VET_APPOINTMENTS: VetAppointment[] = [
  {
    id: 'va-1', ref: 'VET-9F2A41', consultType: 'video', status: 'scheduled', slotDate: isoDate(0), createdAt: iso(1), isHmo: false,
    summary: { id: 'vc-1', ref: 'VET-9F2A41', petName: 'Bingo', petSpecies: 'dog', breed: 'Boerboel', ownerName: 'Tunde Akinwale', reason: 'Limping on hind leg for 2 days', slotTime: '09:00 AM', feeKobo: 300000, isUrgent: false },
  },
  {
    id: 'va-2', ref: 'VET-7C1B88', consultType: 'chat', status: 'requested', slotDate: isoDate(0), createdAt: iso(0), isHmo: false,
    summary: { id: 'vc-2', ref: 'VET-7C1B88', petName: 'Whiskers', petSpecies: 'cat', breed: 'Domestic Shorthair', ownerName: 'Fatima Bello', reason: 'Not eating, lethargic', slotTime: '10:30 AM', feeKobo: 300000, isUrgent: true },
  },
  {
    id: 'va-3', ref: 'VET-5A8E07', consultType: 'audio', status: 'completed', slotDate: isoDate(-1), createdAt: iso(2), isHmo: false,
    summary: { id: 'vc-3', ref: 'VET-5A8E07', petName: 'Coco', petSpecies: 'bird', breed: 'African Grey', ownerName: 'Chidi Okeke', reason: 'Feather plucking', slotTime: '12:00 PM', feeKobo: 250000, isUrgent: false },
  },
];

// ─── Demo: pet owner requests ────────────────────────────────────────────────
export const DEMO_PET_OWNER_REQUESTS: PetOwnerRequest[] = [
  {
    id: 'req-1', ref: 'REQ-7C1B88',
    owner: { id: 'own-2', name: 'Fatima Bello', initials: 'FB', avatarColor: Colors.secondary, phone: '+234 802 555 0011', email: 'fatima@example.com' },
    petName: 'Whiskers', petSpecies: 'cat', breed: 'Domestic Shorthair',
    reason: 'Not eating for 2 days, very lethargic', symptoms: ['Inappetence', 'Lethargy', 'Hiding'],
    isUrgent: true, preferredType: 'video', status: 'pending', requestedAt: iso(0),
  },
  {
    id: 'req-2', ref: 'REQ-3D0F90',
    owner: { id: 'own-3', name: 'Chidi Okeke', initials: 'CO', avatarColor: Colors.teal, phone: '+234 803 222 7788' },
    petName: 'Coco', petSpecies: 'bird', breed: 'African Grey',
    reason: 'Feather plucking, seems stressed', symptoms: ['Feather plucking', 'Reduced vocalisation'],
    isUrgent: false, preferredType: 'chat', status: 'pending', requestedAt: iso(1),
  },
];

// ─── Demo: vet chat / call (REUSE Batch 2 rich demo data) ────────────────────
export const DEMO_VET_CHAT_THREAD: VetChatThread = {
  thread: DEMO_THREAD_STATE,
  messages: DEMO_RICH_MESSAGES,
  petId: 'pet-1', petName: 'Bingo', ownerName: 'Tunde Akinwale',
};

export const DEMO_VET_CALL_SESSION: VetCallSession = {
  session: DEMO_CALL_SESSION_RICH,
  petId: 'pet-1', petName: 'Bingo', ownerName: 'Tunde Akinwale',
};

// ─── Demo: vet SOAP note (REUSE Batch 2 ClinicalNote) ────────────────────────
export const DEMO_VET_CLINICAL_NOTE: VetClinicalNote = {
  note: DEMO_CLINICAL_NOTE,
  petId: 'pet-1', petName: 'Bingo', petSpecies: 'dog', weightKg: 58,
  diagnosis: ['Soft-tissue strain, right hind limb', 'Hip dysplasia (chronic)'],
  treatmentPlan: 'Rest and lead-only exercise for 7 days. Carprofen 100mg PO BID with food. Recheck in 1 week.',
};

// ─── Demo: pet emergency warnings (REUSE RedFlagWarning) ──────────────────────
export const DEMO_PET_EMERGENCY_WARNINGS: PetEmergencyWarning[] = [
  { id: 'pew-1', severity: 'critical', label: 'Suspected GDV (bloat)', action: 'Refer to emergency vet immediately', petId: 'pet-1', petSpecies: 'dog', detectedAt: iso(0) },
  { id: 'pew-2', severity: 'warning', label: 'Persistent inappetence > 48h', action: 'Recommend in-person review', petId: 'pet-2', petSpecies: 'cat', detectedAt: iso(0) },
];

// ─── Demo: vet referral ──────────────────────────────────────────────────────
export const DEMO_VET_SPECIALISTS: VetSpecialist[] = [
  { id: 'vs-1', name: 'Dr. Ngozi Eze', initials: 'NE', avatarColor: Colors.primary, specialty: 'Veterinary Orthopaedics', clinic: 'Lagos Animal Referral Hospital' },
  { id: 'vs-2', name: 'Dr. Sola Adeyemi', initials: 'SA', avatarColor: Colors.teal, specialty: 'Veterinary Dermatology', clinic: 'Pawscare Specialist Centre' },
];

export const DEMO_VET_REFERRALS: VetReferral[] = [
  {
    id: 'vref-1', ref: 'VREF-5A8E07', petId: 'pet-1', petName: 'Bingo', petSpecies: 'dog', ownerName: 'Tunde Akinwale',
    specialist: DEMO_VET_SPECIALISTS[0], reason: 'Persistent hind-limb lameness; possible joint pathology.',
    urgency: 'routine', status: 'sent', createdAt: iso(1),
  },
];

// ─── Demo: vet consult summary + history ─────────────────────────────────────
export const DEMO_VET_CONSULT_SUMMARY: VetConsultSummary = {
  id: 'vcs-1', ref: 'VET-9F2A41', petId: 'pet-1', petName: 'Bingo', petSpecies: 'dog', ownerName: 'Tunde Akinwale',
  vetName: 'Dr. Amaka Obi', consultType: 'video',
  diagnosis: ['Soft-tissue strain, right hind limb'],
  treatmentPlan: 'Rest, NSAID for 7 days, recheck in 1 week.',
  prescriptionRef: 'PRX-4F2A41', labOrderRef: 'PLAB-8C1B22', followUpRecommended: true,
  feeKobo: 300000, durationMins: 18, endedAt: iso(0),
};

export const DEMO_VET_CONSULT_HISTORY: VetConsultHistoryItem[] = [
  { id: 'vch-1', ref: 'VET-9F2A41', petName: 'Bingo', petSpecies: 'dog', ownerName: 'Tunde Akinwale', consultType: 'video', summary: 'Hind-limb strain — NSAID started, recheck booked.', feeKobo: 300000, date: isoDate(0) },
  { id: 'vch-2', ref: 'VET-5A8E07', petName: 'Coco', petSpecies: 'bird', ownerName: 'Chidi Okeke', consultType: 'audio', summary: 'Feather plucking — environmental enrichment advised.', feeKobo: 250000, date: isoDate(-1) },
  { id: 'vch-3', ref: 'VET-1B0C44', petName: 'Whiskers', petSpecies: 'cat', ownerName: 'Fatima Bello', consultType: 'chat', summary: 'Mild GI upset — bland diet, monitor.', feeKobo: 300000, date: isoDate(-6) },
];

// ═══════════════════════════════════════════════════════════════════════════
// SECTION T — PET E-PRESCRIPTION
// ═══════════════════════════════════════════════════════════════════════════

export const DEMO_PET_PHARMACIES: PetPharmacy[] = [
  { id: 'pph-1', name: 'VetMeds Pharmacy, Lekki', address: '14 Admiralty Way, Lekki Phase 1', acceptsEPrescription: true },
  { id: 'pph-2', name: 'AnimalCare Dispensary, Ikeja', address: '3 Allen Avenue, Ikeja', acceptsEPrescription: true },
  { id: 'pph-3', name: 'PetPlus Chemist, VI', address: '21 Adeola Odeku St, Victoria Island', acceptsEPrescription: false },
];

// Issued prescription COMPOSES the Phase 3 PetPrescription demo + audit trail.
export const DEMO_ISSUED_PET_PRESCRIPTION: IssuedPetPrescription = {
  prescription: DEMO_PET_PRESCRIPTION,
  pharmacy: DEMO_PET_PHARMACIES[0],
  sendStatus: 'sent',
  audit: [
    { action: 'created',          actor: 'Dr. Amaka Obi',         at: iso(0), note: 'Draft created from consult VET-9F2A41' },
    { action: 'issued',           actor: 'Dr. Amaka Obi',         at: iso(0) },
    { action: 'sent_to_pharmacy', actor: 'Dr. Amaka Obi',         at: iso(0), note: 'Sent to VetMeds Pharmacy, Lekki' },
  ],
};

export const DEMO_PET_REFILL_REQUESTS: PetRefillRequest[] = [
  { id: 'rfl-1', ref: 'RFL-3D0F90', prescriptionId: 'prx-1', prescriptionRef: 'PRX-4F2A41', petName: 'Bingo', petSpecies: 'dog', ownerName: 'Tunde Akinwale', drugSummary: 'Carprofen 100mg BID', status: 'requested', requestedAt: iso(0) },
  { id: 'rfl-2', ref: 'RFL-8C1B22', prescriptionId: 'prx-2', prescriptionRef: 'PRX-7C1B88', petName: 'Whiskers', petSpecies: 'cat', ownerName: 'Fatima Bello', drugSummary: 'Doxycycline 50mg OD', status: 'approved', requestedAt: iso(3), decidedAt: iso(2) },
];

// ═══════════════════════════════════════════════════════════════════════════
// SECTION U — VET LAB & PET HEALTH
// ═══════════════════════════════════════════════════════════════════════════

export const DEMO_PET_LAB_CATALOGUE: PetLabCatalogueEntry[] = [
  { test: { id: 'plt-cbc',   name: 'Complete Blood Count', code: 'CBC',  category: 'blood' },   priceKobo: 450000, turnaroundHours: 24, sampleType: 'Whole blood (EDTA)', forSpecies: ['dog', 'cat', 'rabbit', 'rodent'] },
  { test: { id: 'plt-chem',  name: 'Biochemistry Panel',   code: 'CHEM', category: 'blood' },   priceKobo: 650000, turnaroundHours: 24, sampleType: 'Serum',             forSpecies: ['dog', 'cat'] },
  { test: { id: 'plt-stool', name: 'Faecal Float (Ova & Parasites)', code: 'FEC', category: 'stool' }, priceKobo: 250000, turnaroundHours: 12, sampleType: 'Faeces', forSpecies: ['dog', 'cat', 'livestock'] },
  { test: { id: 'plt-xray',  name: 'Radiograph',           code: 'XR',   category: 'imaging' }, priceKobo: 800000, turnaroundHours: 4,  sampleType: 'Imaging',           forSpecies: ['dog', 'cat'] },
  { test: { id: 'plt-skin',  name: 'Skin Scrape (Cytology)', code: 'SKN', category: 'skin' },   priceKobo: 300000, turnaroundHours: 24, sampleType: 'Skin scrape',       forSpecies: ['dog', 'cat'] },
];

// Lab result inbox derives from the Phase 3 PetLabResult demo.
export const DEMO_PET_LAB_INBOX: PetLabResultInboxItem[] = DEMO_PET_LAB_RESULTS.map((result) => ({
  result,
  hasAbnormal: result.values.some((v) => v.flag !== 'normal'),
  interpreted: false,
}));

export const DEMO_PET_VACCINATION_RECOMMENDATIONS: PetVaccinationRecommendation[] = [
  { id: 'pvr-1', petId: 'pet-1', vaccineName: 'DHPP',          forSpecies: ['dog'], urgency: 'due_soon', dueDate: isoDate(25),  rationale: 'Annual booster due within the month.' },
  { id: 'pvr-2', petId: 'pet-1', vaccineName: 'Leptospirosis', forSpecies: ['dog'], urgency: 'overdue',  dueDate: isoDate(-55), rationale: 'Overdue by ~2 months — high local exposure risk.' },
  { id: 'pvr-3', petId: 'pet-1', vaccineName: 'Rabies',        forSpecies: ['dog', 'cat'], urgency: 'routine', dueDate: isoDate(65), rationale: 'On schedule; reminder recommended.' },
];

export const DEMO_PET_VACCINATION_REMINDERS: PetVaccinationReminder[] = [
  { id: 'pvm-1', petId: 'pet-1', vaccineName: 'DHPP', remindAt: iso(-20), channel: 'sms', enabled: true },
];

// Pet health record aggregates the Phase 3 pet profile + history.
export const DEMO_PET_HEALTH_RECORD: PetHealthRecord = {
  pet: DEMO_PET_PROFILE,
  vaccinations: DEMO_PET_PROFILE.vaccinations,
  labResults: DEMO_PET_LAB_RESULTS,
  consults: [
    { id: 'vch-1', ref: 'VET-9F2A41', petName: 'Bingo', petSpecies: 'dog', ownerName: 'Tunde Akinwale', consultType: 'video', summary: 'Hind-limb strain — NSAID started.', feeKobo: 300000, date: isoDate(0) },
  ],
  chronicConditions: DEMO_PET_PROFILE.chronicConditions,
  lastVisitAt: iso(0),
};

export const DEMO_PET_GROWTH_HISTORY: PetGrowthHistory = {
  petId: 'pet-1', petName: 'Bingo', species: 'dog',
  points: [
    { date: isoDate(-365), weightKg: 41, ageMonths: 30 },
    { date: isoDate(-270), weightKg: 47, ageMonths: 33 },
    { date: isoDate(-180), weightKg: 52, ageMonths: 36 },
    { date: isoDate(-90),  weightKg: 56, ageMonths: 39, note: 'Diet adjusted for joint support' },
    { date: isoDate(0),    weightKg: 58, ageMonths: 42 },
  ],
};

export const DEMO_PET_CHRONIC_MONITORING: PetChronicMonitoringEntry[] = [
  { id: 'pcm-1', petId: 'pet-1', condition: 'Hip dysplasia', metricLabel: 'Lameness score', value: '2/5', trend: 'improving', recordedAt: iso(0),  note: 'Better after NSAID + rest' },
  { id: 'pcm-2', petId: 'pet-1', condition: 'Hip dysplasia', metricLabel: 'Lameness score', value: '3/5', trend: 'stable',    recordedAt: iso(30) },
];

// ═══════════════════════════════════════════════════════════════════════════
// SECTION V — PET STORE / VET-RECOMMENDED PRODUCTS
// ═══════════════════════════════════════════════════════════════════════════

export const DEMO_PET_PRODUCT_DETAIL: PetProductDetail = {
  product: DEMO_PET_PRODUCTS[0],
  ingredients: ['Chicken meal', 'Rice', 'Glucosamine', 'Chondroitin', 'Omega-3 fatty acids'],
  dosageGuidance: 'Feed per body-weight chart on the pack; transition over 7 days.',
  inStock: true, ratingAvg: 4.6, reviewCount: 84,
  relatedProductIds: ['pp-2', 'pp-5'],
};

export const DEMO_PET_PRODUCT_FULFILMENTS: PetProductFulfilment[] = [
  {
    id: 'pfl-1', ref: 'PFL-8C1B22', recommendationId: 'rec-1', recommendationRef: 'REC-5A8E07',
    petName: 'Bingo', ownerName: 'Tunde Akinwale',
    products: [DEMO_PET_PRODUCTS[0], DEMO_PET_PRODUCTS[1]],
    totalKobo: DEMO_PET_PRODUCTS[0].priceKobo + DEMO_PET_PRODUCTS[1].priceKobo,
    status: 'out_for_delivery', createdAt: iso(2),
    delivery: {
      trackingRef: 'TRK-5A8E07', courier: 'GIG Logistics', etaAt: iso(0),
      address: '12 Adeola Odeku St, Victoria Island', status: 'out_for_delivery',
      timeline: [
        { status: 'ordered',          label: 'Order placed',     at: iso(2) },
        { status: 'packed',           label: 'Order packed',     at: iso(2) },
        { status: 'shipped',          label: 'Handed to courier', at: iso(1) },
        { status: 'out_for_delivery', label: 'Out for delivery', at: iso(0) },
      ],
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// READ ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// ── Section S ──
export async function getVetAppointments(): Promise<VetAppointment[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_VET_APPOINTMENTS);
  return doctorGet<VetAppointment[]>('/vet/appointments');
}

export async function getPetOwnerRequests(): Promise<PetOwnerRequest[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PET_OWNER_REQUESTS);
  return doctorGet<PetOwnerRequest[]>('/vet/owner-requests');
}

export async function getVetChatThread(petId: string): Promise<VetChatThread> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_VET_CHAT_THREAD);
  return doctorGet<VetChatThread>(`/vet/pets/${petId}/chat`);
}

export async function getVetCallSession(petId: string): Promise<VetCallSession> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_VET_CALL_SESSION);
  return doctorGet<VetCallSession>(`/vet/pets/${petId}/call`);
}

export async function getVetSoapNote(petId: string): Promise<VetClinicalNote> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_VET_CLINICAL_NOTE);
  return doctorGet<VetClinicalNote>(`/vet/pets/${petId}/soap-note`);
}

export async function getPetEmergencyWarnings(petId: string): Promise<PetEmergencyWarning[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PET_EMERGENCY_WARNINGS);
  return doctorGet<PetEmergencyWarning[]>(`/vet/pets/${petId}/emergency-warnings`);
}

export async function getVetSpecialists(): Promise<VetSpecialist[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_VET_SPECIALISTS);
  return doctorGet<VetSpecialist[]>('/vet/specialists');
}

export async function getVetReferrals(petId: string): Promise<VetReferral[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_VET_REFERRALS);
  return doctorGet<VetReferral[]>(`/vet/pets/${petId}/referrals`);
}

export async function getVetConsultSummary(consultId: string): Promise<VetConsultSummary> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_VET_CONSULT_SUMMARY);
  return doctorGet<VetConsultSummary>(`/vet/consults/${consultId}/summary`);
}

export async function getVetConsultHistory(): Promise<VetConsultHistoryItem[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_VET_CONSULT_HISTORY);
  return doctorGet<VetConsultHistoryItem[]>('/vet/consults/history');
}

// ── Section T ──
export async function getPetPharmacies(): Promise<PetPharmacy[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PET_PHARMACIES);
  return doctorGet<PetPharmacy[]>('/vet/pharmacies');
}

export async function getIssuedPetPrescription(prescriptionId: string): Promise<IssuedPetPrescription> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_ISSUED_PET_PRESCRIPTION);
  return doctorGet<IssuedPetPrescription>(`/vet/prescriptions/${prescriptionId}/issued`);
}

export async function getPetRefillRequests(): Promise<PetRefillRequest[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PET_REFILL_REQUESTS);
  return doctorGet<PetRefillRequest[]>('/vet/refills');
}

// ── Section U ──
export async function getPetLabCatalogue(species?: PetSpecies): Promise<PetLabCatalogueEntry[]> {
  if (DOCTOR_USE_MOCK) {
    const list = species ? DEMO_PET_LAB_CATALOGUE.filter((e) => e.forSpecies.includes(species)) : DEMO_PET_LAB_CATALOGUE;
    return wait(list);
  }
  return doctorGet<PetLabCatalogueEntry[]>('/vet/lab-catalogue', { species });
}

export async function getPetLabInbox(): Promise<PetLabResultInboxItem[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PET_LAB_INBOX);
  return doctorGet<PetLabResultInboxItem[]>('/vet/lab-results/inbox');
}

export async function getPetVaccinationRecommendations(petId: string): Promise<PetVaccinationRecommendation[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PET_VACCINATION_RECOMMENDATIONS);
  return doctorGet<PetVaccinationRecommendation[]>(`/vet/pets/${petId}/vaccination-recommendations`);
}

export async function getPetVaccinationReminders(petId: string): Promise<PetVaccinationReminder[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PET_VACCINATION_REMINDERS);
  return doctorGet<PetVaccinationReminder[]>(`/vet/pets/${petId}/vaccination-reminders`);
}

export async function getPetHealthRecord(petId: string): Promise<PetHealthRecord> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PET_HEALTH_RECORD);
  return doctorGet<PetHealthRecord>(`/vet/pets/${petId}/health-record`);
}

export async function getPetGrowthHistory(petId: string): Promise<PetGrowthHistory> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PET_GROWTH_HISTORY);
  return doctorGet<PetGrowthHistory>(`/vet/pets/${petId}/growth`);
}

export async function getPetChronicMonitoring(petId: string): Promise<PetChronicMonitoringEntry[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PET_CHRONIC_MONITORING);
  return doctorGet<PetChronicMonitoringEntry[]>(`/vet/pets/${petId}/chronic-monitoring`);
}

// ── Section V ──
export async function getPetProductDetail(productId: string): Promise<PetProductDetail> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PET_PRODUCT_DETAIL);
  return doctorGet<PetProductDetail>(`/vet/products/${productId}`);
}

export async function getPetProductFulfilments(): Promise<PetProductFulfilment[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PET_PRODUCT_FULFILMENTS);
  return doctorGet<PetProductFulfilment[]>('/vet/product-fulfilments');
}

export async function getPetProductFulfilment(id: string): Promise<PetProductFulfilment | undefined> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PET_PRODUCT_FULFILMENTS.find((f) => f.id === id));
  return doctorGet<PetProductFulfilment | undefined>(`/vet/product-fulfilments/${id}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

// ── Section S ──
export async function respondToPetRequest(input: RespondToPetRequestInput): Promise<RespondToPetRequestResult> {
  if (DOCTOR_USE_MOCK) return wait({ requestId: input.requestId, status: input.accept ? 'accepted' : 'declined' }, 500);
  return doctorPost<RespondToPetRequestResult>(`/vet/requests/${input.requestId}/respond`, input, input.idempotencyKey);
}

export async function saveVetSoapNote(input: SaveVetSoapNoteInput): Promise<SaveVetSoapNoteResult> {
  if (DOCTOR_USE_MOCK) {
    void input.note;
    return wait({ noteId: `vsoap-${Date.now()}`, status: input.note.note.status }, 600);
  }
  return doctorPost<SaveVetSoapNoteResult>('/vet/soap-notes', input, input.idempotencyKey);
}

export async function createVetReferral(input: CreateVetReferralInput): Promise<CreateVetReferralResult> {
  if (DOCTOR_USE_MOCK) {
    const ref = `VREF-${input.idempotencyKey.slice(-6).toUpperCase()}`;
    return wait({ referralId: `vref-${Date.now()}`, ref, status: 'sent' as VetReferral['status'] }, 600);
  }
  return doctorPost<CreateVetReferralResult>('/vet/referrals', input, input.idempotencyKey);
}

// ── Section T ──
export async function issuePetPrescription(input: IssuePetPrescriptionInput): Promise<IssuePetPrescriptionResult> {
  if (DOCTOR_USE_MOCK) {
    const ref = `PRX-${input.idempotencyKey.slice(-6).toUpperCase()}`;
    return wait({ prescriptionId: input.prescriptionId, ref, status: 'issued' as IssuedPetPrescription['prescription']['status'] }, 600);
  }
  return doctorPost<IssuePetPrescriptionResult>(`/vet/prescriptions/${input.prescriptionId}/issue`, input, input.idempotencyKey);
}

export async function sendPetRxToPharmacy(input: SendPetRxToPharmacyInput): Promise<SendPetRxToPharmacyResult> {
  if (DOCTOR_USE_MOCK) {
    void input.pharmacyId;
    return wait({ prescriptionId: input.prescriptionId, sendStatus: 'sent' as SendPetRxToPharmacyResult['sendStatus'] }, 600);
  }
  return doctorPost<SendPetRxToPharmacyResult>(`/vet/prescriptions/${input.prescriptionId}/send`, input, input.idempotencyKey);
}

export async function requestPetRefill(input: RequestPetRefillInput): Promise<RequestPetRefillResult> {
  if (DOCTOR_USE_MOCK) {
    const ref = `RFL-${input.idempotencyKey.slice(-6).toUpperCase()}`;
    return wait({ refillId: `rfl-${Date.now()}`, ref, status: 'requested' as PetRefillRequest['status'] }, 600);
  }
  return doctorPost<RequestPetRefillResult>('/vet/refills', input, input.idempotencyKey);
}

export async function reviewPetRefill(input: ReviewPetRefillInput): Promise<ReviewPetRefillResult> {
  if (DOCTOR_USE_MOCK) return wait({ refillId: input.refillId, status: input.approve ? 'approved' : 'rejected' }, 500);
  return doctorPost<ReviewPetRefillResult>(`/vet/refills/${input.refillId}/review`, input, input.idempotencyKey);
}

// ── Section U ──
export async function addPetLabInterpretation(input: AddPetLabInterpretationInput): Promise<AddPetLabInterpretationResult> {
  if (DOCTOR_USE_MOCK) {
    void input.interpretation;
    return wait({ resultId: input.resultId, interpreted: true }, 500);
  }
  return doctorPost<AddPetLabInterpretationResult>(`/vet/lab-results/${input.resultId}/interpretation`, input, input.idempotencyKey);
}

export async function setPetVaccinationReminder(input: SetPetVaccinationReminderInput): Promise<SetPetVaccinationReminderResult> {
  if (DOCTOR_USE_MOCK) return wait({ reminderId: `pvm-${Date.now()}`, enabled: input.enabled }, 500);
  return doctorPost<SetPetVaccinationReminderResult>('/vet/vaccination-reminders', input, input.idempotencyKey);
}

export async function recordPetGrowth(input: RecordPetGrowthInput): Promise<RecordPetGrowthResult> {
  if (DOCTOR_USE_MOCK) {
    void input.weightKg;
    return wait({ petId: input.petId, pointDate: isoDate(0) }, 500);
  }
  return doctorPost<RecordPetGrowthResult>(`/vet/pets/${input.petId}/growth`, input, input.idempotencyKey);
}

export async function savePetChronicMonitoring(input: SavePetChronicMonitoringInput): Promise<SavePetChronicMonitoringResult> {
  if (DOCTOR_USE_MOCK) {
    void input.value;
    return wait({ entryId: `pcm-${Date.now()}`, petId: input.petId }, 500);
  }
  return doctorPost<SavePetChronicMonitoringResult>(`/vet/pets/${input.petId}/chronic-monitoring`, input, input.idempotencyKey);
}

// ── Section V ──
export async function shareProductWithOwner(input: ShareProductWithOwnerInput): Promise<ShareProductWithOwnerResult> {
  if (DOCTOR_USE_MOCK) {
    void input.note;
    return wait({ recommendationId: input.recommendationId, sharedWithOwner: true }, 500);
  }
  return doctorPost<ShareProductWithOwnerResult>(`/vet/recommendations/${input.recommendationId}/share`, input, input.idempotencyKey);
}
