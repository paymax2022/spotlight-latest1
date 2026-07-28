// ── Paymax Health — Laboratory API layer (Phase 2) ───────────────────────────
// Self-contained, mock-first data layer for the Lab vertical. Reuses the shared
// USE_MOCK flag + HEALTH_API_BASE; live endpoints live under /lab.
// IRON RULES: kobo only · HL-2 MLSCN gating · HL-6 chain-of-custody · HL-7 critical
// escalation (never silent) · HL-8 consent-gated results · HL-9 held payment
// (order/checkout carry an Idempotency-Key).

import { api } from '@/api/client';
import { USE_MOCK, HEALTH_API_BASE } from '../constants/health.constants';
import { Colors } from '@/constants/colors';
import type {
  LabTest,
  TestPackage,
  CatalogQuery,
  Lab,
  Phlebotomist,
  LabOrder,
  LabResult,
  LabReview,
  CreateOrderInput,
  SubmitReviewInput,
  ShareResultInput,
  ProviderOnboardingState,
  SubmitOnboardingInput,
  CatalogPriceItem,
  ProviderOrderRow,
  AccessionInput,
  ResultEntryInput,
  ResultReleaseInput,
  ProviderEarnings,
  CollectionAssignment,
  CollectionChecklistItem,
  ChainOfCustodyInput,
  DropOffInput,
} from './types';

const LAB_API = `${HEALTH_API_BASE}/lab`;
const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));

// ── Mock data ─────────────────────────────────────────────────────────────────
const MOCK_TESTS: LabTest[] = [
  {
    id: 'test_fbc',
    name: 'Full Blood Count',
    code: 'FBC',
    category: 'haematology',
    priceKobo: 650000,
    description:
      'Measures red and white cells, haemoglobin and platelets — screens for anaemia, infection and clotting issues.',
    sampleType: 'blood',
    prep: 'No special preparation needed. Stay hydrated.',
    fastingRequired: false,
    tat: 'Same day',
    homeCollection: true,
    imageColor: Colors.iconBgRed,
  },
  {
    id: 'test_hba1c',
    name: 'HbA1c (Diabetes)',
    code: 'HbA1c',
    category: 'endocrine',
    priceKobo: 850000,
    description: 'Average blood sugar over the last ~3 months. Used to diagnose and monitor diabetes.',
    sampleType: 'blood',
    prep: 'No fasting required. Avoid heavy meals just before the draw.',
    fastingRequired: false,
    tat: '24 hrs',
    homeCollection: true,
    imageColor: Colors.iconBgBlue,
  },
  {
    id: 'test_lipid',
    name: 'Lipid Profile',
    code: 'LIPID',
    category: 'cardiac',
    priceKobo: 950000,
    description: 'Total cholesterol, HDL, LDL and triglycerides — assesses cardiovascular risk.',
    sampleType: 'blood',
    prep: 'Fast for 9-12 hours. Water only.',
    fastingRequired: true,
    tat: '24 hrs',
    homeCollection: true,
    imageColor: Colors.iconBgGold,
  },
  {
    id: 'test_lft',
    name: 'Liver Function Test',
    code: 'LFT',
    category: 'chemistry',
    priceKobo: 880000,
    description: 'ALT, AST, bilirubin and proteins to assess liver health.',
    sampleType: 'blood',
    prep: 'Fast for 8 hours. Avoid alcohol for 24 hours.',
    fastingRequired: true,
    tat: '24 hrs',
    homeCollection: true,
    imageColor: Colors.iconBgPurple,
  },
  {
    id: 'test_malaria',
    name: 'Malaria Parasite',
    code: 'MP',
    category: 'infectious',
    priceKobo: 350000,
    description: 'Microscopy for malaria parasites. Recommended for fever and chills.',
    sampleType: 'blood',
    prep: 'No special preparation needed.',
    fastingRequired: false,
    tat: 'Same day',
    homeCollection: true,
    imageColor: Colors.iconBgTeal,
  },
  {
    id: 'test_tsh',
    name: 'Thyroid (TSH)',
    code: 'TSH',
    category: 'endocrine',
    priceKobo: 720000,
    description: 'Thyroid-stimulating hormone — screens for thyroid over/underactivity.',
    sampleType: 'blood',
    prep: 'No fasting required.',
    fastingRequired: false,
    tat: '48 hrs',
    homeCollection: true,
    imageColor: Colors.iconBgBlue,
  },
  {
    id: 'test_urinalysis',
    name: 'Urinalysis',
    code: 'URIN',
    category: 'chemistry',
    priceKobo: 300000,
    description: 'Screens urine for infection, kidney issues, glucose and protein.',
    sampleType: 'urine',
    prep: 'Provide a clean midstream sample. No fasting.',
    fastingRequired: false,
    tat: 'Same day',
    homeCollection: false,
    imageColor: Colors.iconBgGold,
  },
];

const MOCK_PACKAGES: TestPackage[] = [
  {
    id: 'pkg_wellness',
    name: 'Essential Wellness Check',
    description: 'A broad annual screen covering blood, sugar, cholesterol and liver health.',
    priceKobo: 2900000,
    listPriceKobo: 3330000,
    testIds: ['test_fbc', 'test_hba1c', 'test_lipid', 'test_lft'],
    testCount: 4,
    tat: '24-48 hrs',
    prep: 'Fast for 9-12 hours. Water only.',
    fastingRequired: true,
    popular: true,
    imageColor: Colors.iconBgTeal,
  },
  {
    id: 'pkg_diabetes',
    name: 'Diabetes Monitor',
    description: 'HbA1c plus kidney and lipid markers for ongoing diabetes management.',
    priceKobo: 1850000,
    listPriceKobo: 2150000,
    testIds: ['test_hba1c', 'test_lipid', 'test_urinalysis'],
    testCount: 3,
    tat: '24 hrs',
    prep: 'No fasting required for HbA1c; fast 9h if lipids included.',
    fastingRequired: true,
    imageColor: Colors.iconBgBlue,
  },
  {
    id: 'pkg_fever',
    name: 'Fever & Infection Panel',
    description: 'Malaria, full blood count and urinalysis for unexplained fever.',
    priceKobo: 1100000,
    listPriceKobo: 1300000,
    testIds: ['test_malaria', 'test_fbc', 'test_urinalysis'],
    testCount: 3,
    tat: 'Same day',
    prep: 'No special preparation needed.',
    fastingRequired: false,
    imageColor: Colors.iconBgRed,
  },
];

const MOCK_LABS: Lab[] = [
  {
    id: 'lab_synlab',
    name: 'SynLab Diagnostics',
    headline: 'ISO-accredited diagnostic laboratory',
    credential: { authority: 'MLSCN', licenseNo: 'MLSCN-LAG-2291', status: 'verified' },
    rating: 4.8,
    reviewCount: 412,
    address: '15 Adeola Odeku St, Victoria Island, Lagos',
    distanceLabel: '1.2 km',
    lat: 6.4281,
    lng: 3.4219,
    supportsHomeCollection: true,
    supportsWalkIn: true,
    homeCollectionFeeKobo: 250000,
    resultEtaLabel: 'Results in 24 hrs',
    active: true,
  },
  {
    id: 'lab_clina',
    name: 'Clina-Lancet Labs',
    headline: 'Reference laboratory · Pan-African network',
    credential: { authority: 'MLSCN', licenseNo: 'MLSCN-LAG-1187', status: 'verified' },
    rating: 4.7,
    reviewCount: 298,
    address: '5 Saka Tinubu St, Victoria Island, Lagos',
    distanceLabel: '2.8 km',
    lat: 6.4314,
    lng: 3.4256,
    supportsHomeCollection: true,
    supportsWalkIn: true,
    homeCollectionFeeKobo: 300000,
    resultEtaLabel: 'Results in 24-48 hrs',
    active: true,
  },
  {
    id: 'lab_afriglobal',
    name: 'Afriglobal Medicare',
    headline: 'Walk-in diagnostics & wellness centre',
    credential: { authority: 'MLSCN', licenseNo: 'MLSCN-LAG-3340', status: 'verified' },
    rating: 4.6,
    reviewCount: 187,
    address: '23 Awolowo Rd, Ikoyi, Lagos',
    distanceLabel: '4.1 km',
    lat: 6.4503,
    lng: 3.4316,
    supportsHomeCollection: false,
    supportsWalkIn: true,
    homeCollectionFeeKobo: 0,
    resultEtaLabel: 'Results same day',
    active: true,
  },
];

const MOCK_PHLEBOTOMIST: Phlebotomist = {
  id: 'phleb_amina',
  name: 'Amina Bello',
  credential: { authority: 'MLSCN', licenseNo: 'MLSCN-PHL-7781', status: 'verified' },
  rating: 4.9,
  reviewCount: 1203,
  lat: 6.4255,
  lng: 3.4198,
  phone: '+234 803 000 0000',
  vehicle: 'Branded scooter · LND-221-XY',
};

const now = Date.now();
const iso = (offsetMin: number) => new Date(now + offsetMin * 60_000).toISOString();

// A single in-progress order that walks the state machine, plus a released one.
const MOCK_ORDERS: LabOrder[] = [
  {
    id: 'lord_001',
    status: 'IN_TRANSIT',
    labId: 'lab_synlab',
    labName: 'SynLab Diagnostics',
    collectionMode: 'home',
    lines: [
      { refId: 'pkg_wellness', kind: 'package', name: 'Essential Wellness Check', priceKobo: 2900000 },
    ],
    subtotalKobo: 2900000,
    collectionFeeKobo: 250000,
    totalKobo: 3150000,
    paymentHeld: true,
    createdAt: iso(-180),
    scheduledFor: iso(-90),
    location: '12B Ozumba Mbadiwe Ave, Victoria Island, Lagos',
    sampleBarcode: 'BC-90KX12',
    phlebotomistId: 'phleb_amina',
    phlebotomistName: 'Amina Bello',
    custody: [
      { id: 'coc_1', step: 'collected', label: 'Sample collected', at: iso(-80), actor: 'Amina Bello (phlebotomist)', note: 'EDTA + SST tubes, patient ID verified' },
      { id: 'coc_2', step: 'sealed', label: 'Tubes sealed & labelled', at: iso(-78), actor: 'Amina Bello (phlebotomist)', note: 'Barcode BC-90KX12 affixed' },
      { id: 'coc_3', step: 'in_transit', label: 'In transit to lab', at: iso(-60), actor: 'Amina Bello (phlebotomist)', note: 'Cold chain maintained' },
    ],
  },
  {
    id: 'lord_002',
    status: 'RELEASED',
    labId: 'lab_clina',
    labName: 'Clina-Lancet Labs',
    collectionMode: 'walk_in',
    lines: [{ refId: 'test_lipid', kind: 'test', name: 'Lipid Profile', priceKobo: 950000 }],
    subtotalKobo: 950000,
    collectionFeeKobo: 0,
    totalKobo: 950000,
    paymentHeld: false,
    createdAt: iso(-60 * 72),
    scheduledFor: iso(-60 * 70),
    location: '5 Saka Tinubu St, Victoria Island, Lagos',
    sampleBarcode: 'BC-44TY09',
    resultId: 'lres_002',
    hasCritical: true,
    custody: [
      { id: 'coc_a', step: 'collected', label: 'Sample collected (walk-in)', at: iso(-60 * 70), actor: 'Front desk', note: 'Patient ID verified' },
      { id: 'coc_b', step: 'accessioned', label: 'Accessioned', at: iso(-60 * 69), actor: 'J. Okafor (scientist)', note: 'Condition OK' },
    ],
  },
];

const MOCK_RESULTS: LabResult[] = [
  {
    id: 'lres_002',
    orderId: 'lord_002',
    testName: 'Lipid Profile',
    labName: 'Clina-Lancet Labs',
    status: 'ESCALATED',
    releasedBy: 'J. Okafor, AMLSCN',
    releasedAt: iso(-60 * 68),
    collectedAt: iso(-60 * 70),
    hasAbnormal: true,
    hasCritical: true,
    analytes: [
      { id: 'a1', name: 'Total Cholesterol', value: '6.8', unit: 'mmol/L', referenceRange: '< 5.2', flag: 'high' },
      { id: 'a2', name: 'HDL Cholesterol', value: '0.8', unit: 'mmol/L', referenceRange: '> 1.0', flag: 'low' },
      { id: 'a3', name: 'LDL Cholesterol', value: '5.1', unit: 'mmol/L', referenceRange: '< 3.0', flag: 'high' },
      { id: 'a4', name: 'Triglycerides', value: '11.2', unit: 'mmol/L', referenceRange: '< 1.7', flag: 'critical' },
    ],
    escalation: {
      status: 'patient_notified',
      raisedAt: iso(-60 * 68),
      analyteName: 'Triglycerides',
      notifiedClinician: 'Dr. Eze (on-call)',
      steps: [
        { label: 'Critical value detected by analyser', at: iso(-60 * 68), done: true },
        { label: 'Scientist verified & flagged', at: iso(-60 * 67), done: true },
        { label: 'On-call clinician notified', at: iso(-60 * 66), done: true },
        { label: 'Patient contacted by care team', at: iso(-60 * 65), done: true },
        { label: 'Follow-up consult scheduled', done: false },
      ],
    },
    interpretation:
      'Markedly elevated triglycerides (critical) with high LDL and low HDL — high cardiovascular and pancreatitis risk. Urgent clinical review advised; do not delay.',
    docId: 'doc_lipid_002',
  },
];

const MOCK_REVIEWS: LabReview[] = [
  { id: 'rev1', author: 'Tunde A.', rating: 5, body: 'Phlebotomist arrived on time, painless draw. Results next morning.', at: iso(-60 * 24 * 3) },
  { id: 'rev2', author: 'Ngozi K.', rating: 4, body: 'Good service. Wished the app showed live tracking sooner.', at: iso(-60 * 24 * 9) },
];

const MOCK_ONBOARDING: ProviderOnboardingState = {
  status: 'under_review',
  businessName: '',
  mlscnLicenseNo: '',
  contactName: '',
};

const MOCK_CATALOG_PRICES: CatalogPriceItem[] = MOCK_TESTS.map((t) => ({
  testId: t.id,
  name: t.name,
  code: t.code,
  priceKobo: t.priceKobo,
  active: true,
  tat: t.tat,
}));

const MOCK_PROVIDER_ORDERS: ProviderOrderRow[] = [
  { orderId: 'lord_001', patientName: 'Chidi N.', status: 'IN_TRANSIT', testSummary: 'Essential Wellness Check', collectionMode: 'home', sampleBarcode: 'BC-90KX12', createdAt: iso(-180) },
  { orderId: 'lord_003', patientName: 'Bola A.', status: 'SAMPLE_COLLECTED', testSummary: 'FBC + Malaria', collectionMode: 'walk_in', sampleBarcode: 'BC-77QW01', createdAt: iso(-220) },
  { orderId: 'lord_002', patientName: 'Funke O.', status: 'ESCALATED', testSummary: 'Lipid Profile', collectionMode: 'walk_in', sampleBarcode: 'BC-44TY09', createdAt: iso(-60 * 72), hasCritical: true },
];

const MOCK_EARNINGS: ProviderEarnings = {
  availableKobo: 4850000,
  pendingKobo: 1200000,
  heldKobo: 3150000,
  payouts: [
    { id: 'po1', amountKobo: 7500000, at: iso(-60 * 24 * 7), status: 'paid' },
    { id: 'po2', amountKobo: 1200000, at: iso(-60 * 6), status: 'processing' },
  ],
};

const MOCK_ASSIGNMENTS: CollectionAssignment[] = [
  {
    orderId: 'lord_001',
    patientName: 'Chidi N.',
    address: '12B Ozumba Mbadiwe Ave, Victoria Island, Lagos',
    lat: 6.4281,
    lng: 3.4219,
    scheduledFor: iso(45),
    testSummary: 'Essential Wellness Check (4 tests)',
    sampleType: 'blood',
    status: 'en_route',
    distanceLabel: '2.1 km · 8 min',
  },
  {
    orderId: 'lord_004',
    patientName: 'Sade M.',
    address: '7 Bourdillon Rd, Ikoyi, Lagos',
    lat: 6.4503,
    lng: 3.4316,
    scheduledFor: iso(120),
    testSummary: 'HbA1c + Lipid',
    sampleType: 'blood',
    status: 'assigned',
    distanceLabel: '5.4 km · 18 min',
  },
];

const MOCK_CHECKLIST: CollectionChecklistItem[] = [
  { id: 'c1', label: 'Verify patient identity (name + DOB)', done: false, required: true },
  { id: 'c2', label: 'Confirm fasting / prep requirements met', done: false, required: true },
  { id: 'c3', label: 'Sanitise hands & don gloves', done: false, required: true },
  { id: 'c4', label: 'Draw correct tubes for ordered tests', done: false, required: true },
  { id: 'c5', label: 'Label tubes & affix barcode at bedside', done: false, required: true },
  { id: 'c6', label: 'Confirm patient comfort & apply dressing', done: false, required: false },
];

// ── Catalog ───────────────────────────────────────────────────────────────────
export async function getTests(query?: CatalogQuery): Promise<LabTest[]> {
  if (USE_MOCK) {
    await delay();
    let rows = MOCK_TESTS;
    if (query?.category) rows = rows.filter((t) => t.category === query.category);
    if (query?.q) {
      const q = query.q.toLowerCase();
      rows = rows.filter((t) => t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q));
    }
    return rows;
  }
  const { data } = await api.get<LabTest[]>(`${LAB_API}/tests`, { params: query });
  return data;
}

export async function getTest(id: string): Promise<LabTest> {
  if (USE_MOCK) {
    await delay();
    const t = MOCK_TESTS.find((x) => x.id === id);
    if (!t) throw new Error('Test not found');
    return t;
  }
  const { data } = await api.get<LabTest>(`${LAB_API}/tests/${id}`);
  return data;
}

export async function getPackages(): Promise<TestPackage[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_PACKAGES;
  }
  const { data } = await api.get<TestPackage[]>(`${LAB_API}/packages`);
  return data;
}

export async function getPackage(id: string): Promise<TestPackage> {
  if (USE_MOCK) {
    await delay();
    const p = MOCK_PACKAGES.find((x) => x.id === id);
    if (!p) throw new Error('Package not found');
    return p;
  }
  const { data } = await api.get<TestPackage>(`${LAB_API}/packages/${id}`);
  return data;
}

// ── Labs & phlebotomist ─────────────────────────────────────────────────────
export async function getLabs(opts?: { homeCollection?: boolean }): Promise<Lab[]> {
  if (USE_MOCK) {
    await delay();
    let rows = MOCK_LABS.filter((l) => l.active);
    if (opts?.homeCollection) rows = rows.filter((l) => l.supportsHomeCollection);
    return rows;
  }
  const { data } = await api.get<Lab[]>(`${LAB_API}/labs`, { params: opts });
  return data;
}

export async function getLab(id: string): Promise<Lab> {
  if (USE_MOCK) {
    await delay();
    const l = MOCK_LABS.find((x) => x.id === id);
    if (!l) throw new Error('Lab not found');
    return l;
  }
  const { data } = await api.get<Lab>(`${LAB_API}/labs/${id}`);
  return data;
}

export async function getPhlebotomist(orderId: string): Promise<Phlebotomist> {
  if (USE_MOCK) {
    await delay();
    return MOCK_PHLEBOTOMIST;
  }
  const { data } = await api.get<Phlebotomist>(`${LAB_API}/orders/${orderId}/phlebotomist`);
  return data;
}

// ── Orders ──────────────────────────────────────────────────────────────────
export async function getOrders(): Promise<LabOrder[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_ORDERS;
  }
  const { data } = await api.get<LabOrder[]>(`${LAB_API}/orders`);
  return data;
}

export async function getOrder(id: string): Promise<LabOrder> {
  if (USE_MOCK) {
    await delay();
    const o = MOCK_ORDERS.find((x) => x.id === id) ?? MOCK_ORDERS[0];
    return o;
  }
  const { data } = await api.get<LabOrder>(`${LAB_API}/orders/${id}`);
  return data;
}

export async function createOrder(input: CreateOrderInput): Promise<LabOrder> {
  if (USE_MOCK) {
    await delay(500);
    const subtotal = input.lines.reduce((s, l) => s + l.priceKobo, 0);
    const lab = MOCK_LABS.find((l) => l.id === input.labId);
    const collectionFee = input.collectionMode === 'home' ? lab?.homeCollectionFeeKobo ?? 0 : 0;
    return {
      id: `lord_${Date.now()}`,
      status: input.collectionMode === 'home' ? 'SCHEDULED' : 'CREATED',
      labId: input.labId,
      labName: lab?.name ?? 'Selected lab',
      collectionMode: input.collectionMode,
      lines: input.lines,
      subtotalKobo: subtotal,
      collectionFeeKobo: collectionFee,
      totalKobo: subtotal + collectionFee,
      paymentHeld: true,
      createdAt: new Date().toISOString(),
      scheduledFor: input.scheduledFor,
      location: input.location,
      custody: [],
    };
  }
  // HL-9: held payment captured on create; Idempotency-Key guards the mutation.
  const { data } = await api.post<LabOrder>(`${LAB_API}/orders`, input, {
    headers: { 'Idempotency-Key': input.idempotencyKey },
  });
  return data;
}

export async function reorder(orderId: string): Promise<LabOrderLineSeed[]> {
  if (USE_MOCK) {
    await delay();
    const o = MOCK_ORDERS.find((x) => x.id === orderId) ?? MOCK_ORDERS[0];
    return o.lines.map((l) => ({ refId: l.refId, kind: l.kind, name: l.name, priceKobo: l.priceKobo }));
  }
  const { data } = await api.post<LabOrderLineSeed[]>(`${LAB_API}/orders/${orderId}/reorder`, {});
  return data;
}
type LabOrderLineSeed = { refId: string; kind: 'test' | 'package'; name: string; priceKobo: number };

// ── Results (HL-8 consent-gated · HL-7 critical) ────────────────────────────
export async function getResult(id: string): Promise<LabResult> {
  if (USE_MOCK) {
    await delay();
    const r = MOCK_RESULTS.find((x) => x.id === id) ?? MOCK_RESULTS[0];
    return r;
  }
  const { data } = await api.get<LabResult>(`${LAB_API}/results/${id}`);
  return data;
}

export async function getResults(): Promise<LabResult[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_RESULTS;
  }
  const { data } = await api.get<LabResult[]>(`${LAB_API}/results`);
  return data;
}

/** HL-8: explicit consent before the result body is fetched/decrypted. */
export async function acknowledgeResultConsent(resultId: string): Promise<{ acknowledged: boolean }> {
  if (USE_MOCK) {
    await delay();
    return { acknowledged: true };
  }
  const { data } = await api.post<{ acknowledged: boolean }>(`${LAB_API}/results/${resultId}/consent`, {});
  return data;
}

export async function getResultSignedUrl(resultId: string): Promise<{ url: string; expiresAt: string }> {
  if (USE_MOCK) {
    await delay();
    return { url: `mock://signed/${resultId}.pdf`, expiresAt: iso(5) };
  }
  const { data } = await api.get<{ url: string; expiresAt: string }>(`${LAB_API}/results/${resultId}/signed-url`);
  return data;
}

export async function shareResult(input: ShareResultInput): Promise<{ ok: true }> {
  if (USE_MOCK) {
    await delay();
    return { ok: true };
  }
  await api.post(`${LAB_API}/results/${input.resultId}/share`, input);
  return { ok: true };
}

// ── Reviews ──────────────────────────────────────────────────────────────────
export async function getReviews(labId: string): Promise<LabReview[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_REVIEWS;
  }
  const { data } = await api.get<LabReview[]>(`${LAB_API}/labs/${labId}/reviews`);
  return data;
}

export async function submitReview(input: SubmitReviewInput): Promise<LabReview> {
  if (USE_MOCK) {
    await delay();
    return { id: `rev_${Date.now()}`, author: 'You', rating: input.rating, body: input.body, at: new Date().toISOString() };
  }
  const { data } = await api.post<LabReview>(`${LAB_API}/reviews`, input);
  return data;
}

// ── Provider (lab) ───────────────────────────────────────────────────────────
export async function getProviderOnboarding(): Promise<ProviderOnboardingState> {
  if (USE_MOCK) {
    await delay();
    return MOCK_ONBOARDING;
  }
  const { data } = await api.get<ProviderOnboardingState>(`${LAB_API}/provider/onboarding`);
  return data;
}

export async function submitProviderOnboarding(input: SubmitOnboardingInput): Promise<ProviderOnboardingState> {
  if (USE_MOCK) {
    await delay();
    return { ...MOCK_ONBOARDING, ...input, status: 'submitted' };
  }
  const { data } = await api.post<ProviderOnboardingState>(`${LAB_API}/provider/onboarding`, input);
  return data;
}

export async function getProviderCatalog(): Promise<CatalogPriceItem[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_CATALOG_PRICES;
  }
  const { data } = await api.get<CatalogPriceItem[]>(`${LAB_API}/provider/catalog`);
  return data;
}

export async function getProviderOrders(): Promise<ProviderOrderRow[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_PROVIDER_ORDERS;
  }
  const { data } = await api.get<ProviderOrderRow[]>(`${LAB_API}/provider/orders`);
  return data;
}

export async function accessionSample(input: AccessionInput): Promise<{ ok: true; status: 'ACCESSIONED' | 'breached' }> {
  if (USE_MOCK) {
    await delay();
    return { ok: true, status: input.conditionOk ? 'ACCESSIONED' : 'breached' };
  }
  const { data } = await api.post<{ ok: true; status: 'ACCESSIONED' | 'breached' }>(
    `${LAB_API}/provider/orders/${input.orderId}/accession`,
    input,
  );
  return data;
}

export async function enterResult(input: ResultEntryInput): Promise<LabResult> {
  if (USE_MOCK) {
    await delay();
    const hasCritical = input.analytes.some((a) => a.flag === 'critical');
    const hasAbnormal = input.analytes.some((a) => a.flag !== 'normal');
    return {
      id: `lres_${Date.now()}`,
      orderId: input.orderId,
      testName: 'Entered result',
      labName: 'Your lab',
      status: hasCritical ? 'ESCALATED' : 'RESULT_READY',
      collectedAt: iso(-120),
      analytes: input.analytes.map((a) => ({ ...a })),
      hasAbnormal,
      hasCritical,
      interpretation: input.interpretation,
    };
  }
  const { data } = await api.post<LabResult>(`${LAB_API}/provider/orders/${input.orderId}/result`, input);
  return data;
}

/** Scientist sign-off & release (HL-7). Releasing a critical result requires ack. */
export async function releaseResult(input: ResultReleaseInput): Promise<{ ok: true; releasedAt: string }> {
  if (USE_MOCK) {
    await delay();
    return { ok: true, releasedAt: new Date().toISOString() };
  }
  const { data } = await api.post<{ ok: true; releasedAt: string }>(
    `${LAB_API}/provider/orders/${input.orderId}/release`,
    input,
  );
  return data;
}

export async function getProviderEarnings(): Promise<ProviderEarnings> {
  if (USE_MOCK) {
    await delay();
    return MOCK_EARNINGS;
  }
  const { data } = await api.get<ProviderEarnings>(`${LAB_API}/provider/earnings`);
  return data;
}

export async function requestPayout(amountKobo: number, idempotencyKey: string): Promise<{ ok: true }> {
  if (USE_MOCK) {
    await delay();
    return { ok: true };
  }
  await api.post(`${LAB_API}/provider/payouts`, { amountKobo }, { headers: { 'Idempotency-Key': idempotencyKey } });
  return { ok: true };
}

export async function getProviderReviews(): Promise<LabReview[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_REVIEWS;
  }
  const { data } = await api.get<LabReview[]>(`${LAB_API}/provider/reviews`);
  return data;
}

// ── Phlebotomist ─────────────────────────────────────────────────────────────
export async function getAssignments(): Promise<CollectionAssignment[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_ASSIGNMENTS;
  }
  const { data } = await api.get<CollectionAssignment[]>(`${LAB_API}/phlebotomist/assignments`);
  return data;
}

export async function getChecklist(orderId: string): Promise<CollectionChecklistItem[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_CHECKLIST.map((c) => ({ ...c }));
  }
  const { data } = await api.get<CollectionChecklistItem[]>(`${LAB_API}/phlebotomist/assignments/${orderId}/checklist`);
  return data;
}

/** HL-6: log a chain-of-custody event. A failed condition → recollect. */
export async function logCustody(input: ChainOfCustodyInput): Promise<{ ok: true; breach: boolean }> {
  if (USE_MOCK) {
    await delay();
    return { ok: true, breach: !input.conditionOk };
  }
  const { data } = await api.post<{ ok: true; breach: boolean }>(
    `${LAB_API}/phlebotomist/assignments/${input.orderId}/custody`,
    input,
  );
  return data;
}

export async function dropOff(input: DropOffInput): Promise<{ ok: true }> {
  if (USE_MOCK) {
    await delay();
    return { ok: true };
  }
  await api.post(`${LAB_API}/phlebotomist/assignments/${input.orderId}/drop-off`, input);
  return { ok: true };
}

// Stable idempotency-key minter for money-path mutations (mirrors pharmacy cartStore).
export function newIdempotencyKey(prefix = 'lab'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
