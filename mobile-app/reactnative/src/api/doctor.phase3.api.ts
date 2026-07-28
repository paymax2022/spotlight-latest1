// ── Doctor (Telemedicine, provider-side) — Phase 3 API client ────────────────
// Phase A style: every function resolves demo data so screens render without a
// live API. `DEMO_*` exports double as `placeholderData` in useQuery. ADDITIVE
// to `@/api/doctor.api` and `@/api/doctor.phase2.api` — earlier fns/exports are
// untouched.
//
// Phase 3 covers veterinary mode, the three AI-assist screens (note summary,
// prescription safety, lab explanation) and practice management (quality
// analytics + multi-clinic). All AI content below is clearly DEMO and must not
// be relied on for real clinical decisions.
//
// TODO(Phase C): replace each body with the live endpoint, e.g.
//   const res = await api.get('/api/v1/doctor/vet/dashboard'); return res.data.data;
// and pass the Idempotency-Key header on every mutation below.

import { Colors } from '@/constants/colors';
import type {
  VetDashboard,
  PetConsultSummary,
  PetProfile,
  PetPrescription,
  PetLabOrder,
  PetLabResult,
  PetStoreProduct,
  PetProductRecommendation,
  AiNoteSummary,
  AiSafetyReport,
  AiLabExplanation,
  QualityAnalytics,
  ClinicPortfolio,
  AnalyticsPeriod,
  ToggleVetModeInput,
  ToggleVetModeResult,
  CreatePetPrescriptionInput,
  CreatePetPrescriptionResult,
  CreatePetLabOrderInput,
  CreatePetLabOrderResult,
  MarkPetLabResultReviewedInput,
  RecommendProductsInput,
  RecommendProductsResult,
  GenerateAiNoteSummaryInput,
  AcceptAiNoteSummaryInput,
  AcceptAiNoteSummaryResult,
  CheckPrescriptionSafetyInput,
  ExplainLabResultInput,
  SetActiveClinicInput,
  SetActiveClinicResult,
  UpdateClinicScheduleInput,
  UpdateClinicScheduleResult,
} from '@/types/doctor.phase3';

// Re-export the shared money formatter so Phase 3 screens can import it here too.
export { formatKobo } from '@/api/doctor.api';
import { DOCTOR_USE_MOCK, doctorGet, doctorPost, doctorPatch } from '@/api/doctor.client';

// Simulate network latency so loading states are exercised in the UI.
const wait = <T>(value: T, ms = 350): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

const iso = (daysAgo: number): string => new Date(Date.now() - daysAgo * 86400000).toISOString();
const isoDate = (daysFromNow: number): string =>
  new Date(Date.now() + daysFromNow * 86400000).toISOString().slice(0, 10);

const AI_DISCLAIMER =
  'AI-generated draft for clinician review only. Demo content — verify every detail before acting. Not a substitute for professional judgement.';
const AI_MODEL = 'Spotlight Care AI v1 (demo)';

// ═══════════════════════════════════════════════════════════════════════════
// VETERINARY
// ═══════════════════════════════════════════════════════════════════════════

// ─── Demo data: 1. Vet dashboard ─────────────────────────────────────────────

const DEMO_PET_CONSULTS: PetConsultSummary[] = [
  { id: 'vc-1', ref: 'VET-9F2A41', petName: 'Bingo',  petSpecies: 'dog', breed: 'Boerboel',          ownerName: 'Tunde Akinwale', reason: 'Limping on hind leg for 2 days', slotTime: '09:00 AM', feeKobo: 300000, isUrgent: false },
  { id: 'vc-2', ref: 'VET-7C1B88', petName: 'Whiskers', petSpecies: 'cat', breed: 'Domestic Shorthair', ownerName: 'Fatima Bello',  reason: 'Not eating, lethargic',          slotTime: '10:30 AM', feeKobo: 300000, isUrgent: true  },
  { id: 'vc-3', ref: 'VET-5A8E07', petName: 'Coco',   petSpecies: 'bird', breed: 'African Grey',      ownerName: 'Chidi Okeke',    reason: 'Feather plucking',               slotTime: '12:00 PM', feeKobo: 250000, isUrgent: false },
];

export const DEMO_VET_DASHBOARD: VetDashboard = {
  vet: {
    doctorId: 'doc-1', name: 'Dr. Amaka Obi', initials: 'AO', avatarColor: Colors.primary,
    licenceNumber: 'VCN/R/0184', clinicName: 'Pawscare Veterinary Clinic, Lekki',
    speciesTreated: ['dog', 'cat', 'bird', 'rabbit', 'rodent'],
    yearsExperience: 9, rating: 4.8, reviewCount: 146, vetModeEnabled: true,
  },
  todaysConsults: DEMO_PET_CONSULTS,
  petsSeenToday: 4,
  pendingLabs: 2,
  earningsTodayKobo: 1200000,
};

// ─── Demo data: 2. Pet profile ───────────────────────────────────────────────

export const DEMO_PET_PROFILE: PetProfile = {
  id: 'pet-1', name: 'Bingo', species: 'dog', breed: 'Boerboel', sex: 'male', neutered: true,
  ageMonths: 42, weightKg: 58, microchipId: 'NG-CHIP-0091823',
  owner: {
    id: 'own-1', name: 'Tunde Akinwale', initials: 'TA', avatarColor: Colors.secondary,
    phone: '+234 803 123 4567', email: 'tunde@example.com', address: '12 Adeola Odeku St, Victoria Island',
  },
  allergies: ['Penicillin'],
  chronicConditions: ['Mild hip dysplasia'],
  currentMedications: ['Glucosamine supplement'],
  symptoms: ['Limping on right hind leg', 'Reluctant to climb stairs'],
  vaccinations: [
    { id: 'vac-1', name: 'Rabies',  givenAt: isoDate(-300), dueAt: isoDate(65),  status: 'up_to_date', vetName: 'Dr. Amaka Obi' },
    { id: 'vac-2', name: 'DHPP',    givenAt: isoDate(-340), dueAt: isoDate(25),  status: 'due',        vetName: 'Dr. Amaka Obi' },
    { id: 'vac-3', name: 'Leptospirosis', givenAt: isoDate(-420), dueAt: isoDate(-55), status: 'overdue', vetName: 'Dr. Kunle Ojo' },
  ],
  history: [
    { id: 'ph-1', date: isoDate(-90),  summary: 'Routine wellness check, weight stable.', vetName: 'Dr. Amaka Obi' },
    { id: 'ph-2', date: isoDate(-210), summary: 'Treated for ear infection (otitis externa).', vetName: 'Dr. Amaka Obi' },
  ],
  images: [
    { id: 'pi-1', uri: 'https://demo.invalid/pets/bingo-1.jpg', caption: 'Right hind leg, swelling visible', takenAt: iso(0) },
    { id: 'pi-2', uri: 'https://demo.invalid/pets/bingo-2.jpg', caption: 'Gait video still', takenAt: iso(0) },
  ],
};

// ─── Demo data: 3. Pet prescription ──────────────────────────────────────────

export const DEMO_PET_PRESCRIPTION: PetPrescription = {
  id: 'prx-1', ref: 'PRX-4F2A41', petId: 'pet-1', petName: 'Bingo', petSpecies: 'dog',
  ownerName: 'Tunde Akinwale', vetName: 'Dr. Amaka Obi', diagnosis: 'Soft-tissue strain, right hind limb',
  items: [
    { name: 'Carprofen', dosage: '100mg', route: 'Oral', frequency: 'Twice daily', duration: '7 days', category: 'nsaid', dosageMg: 116, notes: 'Give with food' },
    { name: 'Glucosamine', dosage: '500mg', route: 'Oral', frequency: 'Once daily', duration: '30 days', category: 'supplement', dosageMg: 500 },
  ],
  warnings: [
    { severity: 'caution', drugName: 'Carprofen', message: 'NSAID — monitor for GI upset; avoid in dehydration.' },
  ],
  issuedAt: iso(0), status: 'issued',
};

// ─── Demo data: 4. Pet lab orders & results ──────────────────────────────────

export const DEMO_PET_LAB_ORDERS: PetLabOrder[] = [
  {
    id: 'plab-1', ref: 'PLAB-8C1B22', petId: 'pet-1', petName: 'Bingo', petSpecies: 'dog',
    ownerName: 'Tunde Akinwale',
    tests: [
      { id: 'plt-cbc', name: 'Complete Blood Count (Canine)', code: 'CBC', category: 'blood' },
      { id: 'plt-xray', name: 'Hind Limb Radiograph', code: 'XR', category: 'imaging' },
    ],
    clinicalNote: 'Rule out fracture / joint pathology.', status: 'resulted', orderedAt: iso(1), priority: 'routine',
  },
  {
    id: 'plab-2', ref: 'PLAB-3D0F90', petId: 'pet-2', petName: 'Whiskers', petSpecies: 'cat',
    ownerName: 'Fatima Bello',
    tests: [{ id: 'plt-stool', name: 'Faecal Float (Ova & Parasites)', code: 'FEC', category: 'stool' }],
    clinicalNote: 'Inappetence, suspect GI parasites.', status: 'ordered', orderedAt: iso(0), priority: 'urgent',
  },
];

export const DEMO_PET_LAB_RESULTS: PetLabResult[] = [
  {
    id: 'pres-1', orderId: 'plab-1', ref: 'PLAB-8C1B22', petName: 'Bingo', petSpecies: 'dog',
    category: 'blood',
    values: [
      { testName: 'Haemoglobin',  value: '15.2', unit: 'g/dL',     refRange: '12.0–18.0', flag: 'normal' },
      { testName: 'WBC',          value: '17.8', unit: '10³/µL',   refRange: '6.0–17.0',  flag: 'high' },
      { testName: 'Platelets',    value: '310',  unit: '10³/µL',   refRange: '200–500',   flag: 'normal' },
    ],
    reportedAt: iso(0), labName: 'VetLab Diagnostics, Lagos', reviewed: false,
  },
];

// ─── Demo data: 5. Pet store products ────────────────────────────────────────

export const DEMO_PET_PRODUCTS: PetStoreProduct[] = [
  { id: 'pp-1', name: 'Joint Mobility Diet (Large Breed)', category: 'food',       brand: 'Royal Canin', priceKobo: 1850000, vetApproved: true,  forSpecies: ['dog'],        description: 'Therapeutic kibble for joint support in large dogs.', imageColor: '#F59E0B' },
  { id: 'pp-2', name: 'Omega-3 Fish Oil Supplement',       category: 'supplement', brand: 'Nutri-Vet',   priceKobo: 650000,  vetApproved: true,  forSpecies: ['dog', 'cat'], description: 'Supports skin, coat and joint health.',               imageColor: '#10B981' },
  { id: 'pp-3', name: 'Medicated Anti-Itch Shampoo',       category: 'grooming',   brand: 'Virbac',      priceKobo: 420000,  vetApproved: true,  forSpecies: ['dog', 'cat'], description: 'Soothes irritated skin; vet-formulated.',             imageColor: '#6366F1' },
  { id: 'pp-4', name: 'Broad-Spectrum Dewormer',           category: 'medicine',   brand: 'Bayer',       priceKobo: 380000,  vetApproved: true,  forSpecies: ['dog', 'cat'], description: 'Treats common intestinal worms.',                     imageColor: '#EC4899' },
  { id: 'pp-5', name: 'Orthopaedic Pet Bed',               category: 'accessory',  brand: 'PetComfort',  priceKobo: 1200000, vetApproved: false, forSpecies: ['dog'],        description: 'Memory-foam bed for joint relief.',                   imageColor: Colors.teal },
];

export const DEMO_PET_RECOMMENDATIONS: PetProductRecommendation[] = [
  {
    id: 'rec-1', ref: 'REC-5A8E07', petId: 'pet-1', petName: 'Bingo', ownerName: 'Tunde Akinwale',
    products: [DEMO_PET_PRODUCTS[0], DEMO_PET_PRODUCTS[1]],
    note: 'Switch to the joint-support diet and add daily fish oil to ease hip strain.',
    createdAt: iso(1), sharedWithOwner: true,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// AI ASSISTANCE
// ═══════════════════════════════════════════════════════════════════════════

// ─── Demo data: 6. AI consultation note summary (ready state) ────────────────

export const DEMO_AI_NOTE_SUMMARY: AiNoteSummary = {
  status: 'ready', model: AI_MODEL, generatedAt: iso(0), confidence: 82, disclaimer: AI_DISCLAIMER,
  accepted: false, edited: false,
  output: {
    subjective: 'Owner reports the dog has been limping on the right hind leg for two days, reluctant to climb stairs. No known trauma. Appetite normal.',
    objective:  'BAR. Weight 58 kg. Pain on extension of right hip. No obvious swelling or wound. Ambulatory with mild lameness.',
    assessment: 'Likely soft-tissue strain of the right hind limb, on a background of mild hip dysplasia. Fracture less likely but not excluded.',
    plan:       'Rest and lead-only exercise for 7 days. Carprofen 100mg PO BID with food. Radiograph if no improvement in 5 days. Recheck in 1 week.',
    diagnosis:  ['Soft-tissue strain, right hind limb', 'Hip dysplasia (chronic)'],
    keyPoints:  ['2-day hind-limb lameness', 'No trauma reported', 'NSAID started', 'Recheck in 1 week'],
  },
};

// ─── Demo data: 7. AI prescription safety report (ready state) ───────────────

export const DEMO_AI_SAFETY_REPORT: AiSafetyReport = {
  status: 'ready', model: AI_MODEL, generatedAt: iso(0), confidence: 90, disclaimer: AI_DISCLAIMER,
  accepted: false, edited: false,
  output: {
    overallSeverity: 'high',
    safeToIssue: false,
    summary: '1 high-severity allergy match and 1 moderate interaction detected.',
    findings: [
      {
        id: 'fnd-1', kind: 'allergy', severity: 'high',
        title: 'Allergy on file: Penicillin',
        detail: 'The prescription includes Amoxicillin, a penicillin-class antibiotic. The patient record lists a penicillin allergy.',
        drugs: ['Amoxicillin'],
        recommendation: 'Choose a non-penicillin antibiotic (e.g. doxycycline) and confirm the allergy history.',
      },
      {
        id: 'fnd-2', kind: 'interaction', severity: 'moderate',
        title: 'Interaction: Carprofen + Glucocorticoid',
        detail: 'Concurrent NSAID and steroid use increases the risk of gastrointestinal ulceration.',
        drugs: ['Carprofen', 'Prednisolone'],
        recommendation: 'Avoid combining; if both are needed, add gastroprotection and monitor closely.',
      },
      {
        id: 'fnd-3', kind: 'dosage', severity: 'low',
        title: 'Dose near upper range',
        detail: 'Carprofen dose is at the upper end of the recommended weight-based range.',
        drugs: ['Carprofen'],
        recommendation: 'Acceptable, but consider the lower bound for long-term use.',
      },
    ],
  },
};

// ─── Demo data: 8. AI lab result explanation (ready state) ───────────────────

export const DEMO_AI_LAB_EXPLANATION: AiLabExplanation = {
  status: 'ready', model: AI_MODEL, generatedAt: iso(0), confidence: 78, disclaimer: AI_DISCLAIMER,
  accepted: false, edited: false,
  output: {
    headline: 'Mostly normal blood work with a mildly raised white-cell count',
    plainSummary:
      'Most of the values are within the normal range, which is reassuring. The white blood cell count is slightly above normal, which often points to the body responding to inflammation or a mild infection. Red cells and platelets look healthy.',
    flags: [
      {
        testName: 'WBC', flag: 'high',
        meaning: 'A raised white-cell count suggests the immune system is active, commonly due to inflammation or infection.',
        possibleCauses: ['Soft-tissue inflammation', 'Early infection', 'Stress response'],
      },
    ],
    followUps: ['Correlate with clinical signs', 'Repeat CBC in 1–2 weeks if symptoms persist', 'Consider imaging if lameness continues'],
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// PRACTICE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

// ─── Demo data: 9. Quality analytics ─────────────────────────────────────────

export const DEMO_QUALITY_ANALYTICS: QualityAnalytics = {
  period: '30d',
  metrics: [
    { key: 'rating',        label: 'Average rating',  value: 4.9, unit: '★',   deltaPct: 2.1,  trend: 'up',   isGood: true  },
    { key: 'response_time', label: 'Avg response',    value: 6,   unit: 'min', deltaPct: -12.5, trend: 'down', isGood: true  },
    { key: 'completion',    label: 'Completion rate', value: 98,  unit: '%',   deltaPct: 0.5,  trend: 'up',   isGood: true  },
    { key: 'volume',        label: 'Consults',        value: 124, unit: '',    deltaPct: 8.0,  trend: 'up',   isGood: true  },
  ],
  ratingTrend: [
    { label: 'Wk 1', value: 4.7 }, { label: 'Wk 2', value: 4.8 }, { label: 'Wk 3', value: 4.8 }, { label: 'Wk 4', value: 4.9 },
  ],
  responseTimeTrend: [
    { label: 'Wk 1', value: 9 }, { label: 'Wk 2', value: 8 }, { label: 'Wk 3', value: 7 }, { label: 'Wk 4', value: 6 },
  ],
  consultVolume: [
    { label: 'Wk 1', value: 28 }, { label: 'Wk 2', value: 31 }, { label: 'Wk 3', value: 30 }, { label: 'Wk 4', value: 35 },
  ],
  earningsTrend: [
    { label: 'Wk 1', value: 4200000 }, { label: 'Wk 2', value: 4650000 }, { label: 'Wk 3', value: 4500000 }, { label: 'Wk 4', value: 5250000 },
  ],
  completionRate: 98,
  rankingPercentile: 95,
  rankingLabel: 'Top 5% of General Practitioners on Spotlight',
};

// ─── Demo data: 10. Clinic portfolio ─────────────────────────────────────────

export const DEMO_CLINIC_PORTFOLIO: ClinicPortfolio = {
  activeClinicId: 'cl-1',
  memberships: [
    {
      id: 'cl-1', name: 'Lagoon Medical Centre', role: 'lead', state: 'Lagos', city: 'Lagos', isPrimary: true,
      schedule: { days: ['Mon', 'Tue', 'Wed'], startTime: '09:00', endTime: '17:00' },
      isActive: true, patientsSeen: 1240, joinedAt: isoDate(-900), feeShareePct: 70,
    },
    {
      id: 'cl-2', name: 'Pawscare Veterinary Clinic', role: 'consultant', state: 'Lagos', city: 'Lekki', isPrimary: false,
      schedule: { days: ['Thu', 'Fri'], startTime: '10:00', endTime: '16:00' },
      isActive: false, patientsSeen: 318, joinedAt: isoDate(-400), feeShareePct: 60,
    },
    {
      id: 'cl-3', name: 'Reddington Hospital', role: 'locum', state: 'Lagos', city: 'Victoria Island', isPrimary: false,
      schedule: { days: ['Sat'], startTime: '08:00', endTime: '14:00' },
      isActive: false, patientsSeen: 96, joinedAt: isoDate(-150), feeShareePct: 55,
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// READ ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

export async function getVetDashboard(): Promise<VetDashboard> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_VET_DASHBOARD);
  return doctorGet<VetDashboard>('/vet/dashboard');
}

export async function getPetProfile(petId: string): Promise<PetProfile> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PET_PROFILE);
  return doctorGet<PetProfile>(`/vet/pets/${petId}`);
}

export async function getPetPrescription(petId: string): Promise<PetPrescription> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PET_PRESCRIPTION);
  return doctorGet<PetPrescription>(`/vet/pets/${petId}/prescription`);
}

export async function getPetLabOrders(): Promise<PetLabOrder[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PET_LAB_ORDERS);
  return doctorGet<PetLabOrder[]>('/vet/lab-orders');
}

export async function getPetLabResult(orderId: string): Promise<PetLabResult | undefined> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PET_LAB_RESULTS.find((r) => r.orderId === orderId));
  return doctorGet<PetLabResult | undefined>(`/vet/lab-orders/${orderId}/result`);
}

export async function getPetProducts(category?: string): Promise<PetStoreProduct[]> {
  if (DOCTOR_USE_MOCK) {
    const list = category ? DEMO_PET_PRODUCTS.filter((p) => p.category === category) : DEMO_PET_PRODUCTS;
    return wait(list);
  }
  return doctorGet<PetStoreProduct[]>('/vet/products', { category });
}

export async function getPetRecommendations(petId: string): Promise<PetProductRecommendation[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PET_RECOMMENDATIONS);
  return doctorGet<PetProductRecommendation[]>(`/vet/pets/${petId}/recommendations`);
}

export async function getQualityAnalytics(period?: AnalyticsPeriod): Promise<QualityAnalytics> {
  if (DOCTOR_USE_MOCK) return wait(period ? { ...DEMO_QUALITY_ANALYTICS, period } : DEMO_QUALITY_ANALYTICS);
  return doctorGet<QualityAnalytics>('/analytics/quality', { period });
}

export async function getClinicPortfolio(): Promise<ClinicPortfolio> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_CLINIC_PORTFOLIO);
  return doctorGet<ClinicPortfolio>('/clinics');
}

// AI reads — return the "ready" demo envelope so screens render fully.
export async function getAiNoteSummary(appointmentId: string): Promise<AiNoteSummary> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_AI_NOTE_SUMMARY);
  return doctorGet<AiNoteSummary>(`/ai/note-summary/${appointmentId}`);
}

export async function getAiSafetyReport(id: string): Promise<AiSafetyReport> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_AI_SAFETY_REPORT);
  return doctorGet<AiSafetyReport>(`/ai/rx-safety/${id}`);
}

export async function getAiLabExplanation(resultId: string): Promise<AiLabExplanation> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_AI_LAB_EXPLANATION);
  return doctorGet<AiLabExplanation>(`/ai/lab-explanation/${resultId}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

export async function toggleVetMode(input: ToggleVetModeInput): Promise<ToggleVetModeResult> {
  if (DOCTOR_USE_MOCK) return wait({ doctorId: 'doc-1', vetModeEnabled: input.enabled }, 400);
  return doctorPost<ToggleVetModeResult>('/vet/mode', input, input.idempotencyKey);
}

export async function createPetPrescription(input: CreatePetPrescriptionInput): Promise<CreatePetPrescriptionResult> {
  if (DOCTOR_USE_MOCK) {
    void input.items;
    const ref = `PRX-${input.idempotencyKey.slice(-6).toUpperCase()}`;
    return wait({ prescriptionId: `prx-${Date.now()}`, ref, status: 'issued' as PetPrescription['status'] }, 600);
  }
  return doctorPost<CreatePetPrescriptionResult>('/vet/prescriptions', input, input.idempotencyKey);
}

export async function createPetLabOrder(input: CreatePetLabOrderInput): Promise<CreatePetLabOrderResult> {
  if (DOCTOR_USE_MOCK) {
    void input.testIds;
    const ref = `PLAB-${input.idempotencyKey.slice(-6).toUpperCase()}`;
    return wait({ orderId: `plab-${Date.now()}`, ref, status: 'ordered' as PetLabOrder['status'] }, 600);
  }
  return doctorPost<CreatePetLabOrderResult>('/vet/lab-orders', input, input.idempotencyKey);
}

export async function markPetLabResultReviewed(input: MarkPetLabResultReviewedInput): Promise<{ resultId: string; reviewed: boolean }> {
  if (DOCTOR_USE_MOCK) return wait({ resultId: input.resultId, reviewed: true }, 400);
  return doctorPost<{ resultId: string; reviewed: boolean }>(`/vet/lab-results/${input.resultId}/review`, input, input.idempotencyKey);
}

export async function recommendProducts(input: RecommendProductsInput): Promise<RecommendProductsResult> {
  if (DOCTOR_USE_MOCK) {
    void input.productIds;
    const ref = `REC-${input.idempotencyKey.slice(-6).toUpperCase()}`;
    return wait({ recommendationId: `rec-${Date.now()}`, ref, sharedWithOwner: true }, 600);
  }
  return doctorPost<RecommendProductsResult>('/vet/recommendations', input, input.idempotencyKey);
}

// ─── AI generate / accept mutations ──────────────────────────────────────────
// `generate*` simulate the model run (generating → ready). The "generating"
// transition is owned by the hook; these resolve directly to the ready envelope.

export async function generateAiNoteSummary(input: GenerateAiNoteSummaryInput): Promise<AiNoteSummary> {
  if (DOCTOR_USE_MOCK) {
    void input.appointmentId;
    return wait({ ...DEMO_AI_NOTE_SUMMARY, generatedAt: new Date().toISOString() }, 1200);
  }
  return doctorPost<AiNoteSummary>('/ai/note-summary', input, input.idempotencyKey);
}

export async function acceptAiNoteSummary(input: AcceptAiNoteSummaryInput): Promise<AcceptAiNoteSummaryResult> {
  if (DOCTOR_USE_MOCK) {
    void input.output;
    return wait({ noteId: `soap-${Date.now()}`, accepted: true }, 600);
  }
  return doctorPost<AcceptAiNoteSummaryResult>('/ai/note-summary/accept', input, input.idempotencyKey);
}

export async function checkPrescriptionSafety(input: CheckPrescriptionSafetyInput): Promise<AiSafetyReport> {
  if (DOCTOR_USE_MOCK) {
    void input.items;
    return wait({ ...DEMO_AI_SAFETY_REPORT, generatedAt: new Date().toISOString() }, 1200);
  }
  return doctorPost<AiSafetyReport>('/ai/rx-safety', input, input.idempotencyKey);
}

export async function explainLabResult(input: ExplainLabResultInput): Promise<AiLabExplanation> {
  if (DOCTOR_USE_MOCK) {
    void input.resultId;
    return wait({ ...DEMO_AI_LAB_EXPLANATION, generatedAt: new Date().toISOString() }, 1200);
  }
  return doctorPost<AiLabExplanation>('/ai/lab-explanation', input, input.idempotencyKey);
}

// ─── Practice management mutations ───────────────────────────────────────────

export async function setActiveClinic(input: SetActiveClinicInput): Promise<SetActiveClinicResult> {
  if (DOCTOR_USE_MOCK) return wait({ activeClinicId: input.clinicId }, 400);
  return doctorPost<SetActiveClinicResult>('/clinics/active', input, input.idempotencyKey);
}

export async function updateClinicSchedule(input: UpdateClinicScheduleInput): Promise<UpdateClinicScheduleResult> {
  if (DOCTOR_USE_MOCK) return wait({ clinicId: input.clinicId, schedule: input.schedule }, 500);
  return doctorPatch<UpdateClinicScheduleResult>(`/clinics/${input.clinicId}/schedule`, input, input.idempotencyKey);
}
