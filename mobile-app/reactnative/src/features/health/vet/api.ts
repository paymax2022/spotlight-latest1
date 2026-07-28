// ── Paymax Health — Veterinary API layer (Phase 3) ───────────────────────────
// Self-contained, mock-first data layer for the Vet vertical. Reuses the shared
// USE_MOCK flag + HEALTH_API_BASE; live endpoints live under /vet.
// IRON RULES: kobo only · HL-2 VCN gating · HL-3 dispense-once e-Rx · HL-8
// consent-gated pet records & e-Rx · HL-9 held payment (booking carries an
// Idempotency-Key) · HL-11 emergency safety.

import { api } from '@/api/client';
import { USE_MOCK, HEALTH_API_BASE } from '../constants/health.constants';
import { Colors } from '@/constants/colors';
import type {
  Pet,
  PetInput,
  PetRecordEntry,
  VaccinationEntry,
  Vet,
  VetQuery,
  AvailabilityDay,
  Appointment,
  CreateAppointmentInput,
  RescheduleInput,
  VetConsult,
  VetConsultMessage,
  ConsultSummary,
  EPrescription,
  PetMedication,
  HomeVisitTracking,
  VetReview,
  SubmitReviewInput,
  EmergencyVetOption,
  ProviderProfile,
  SubmitOnboardingInput,
  UpdateProfileInput,
  ProviderAvailabilityBlock,
  ProviderAppointmentRow,
  DecisionInput,
  PetChart,
  SaveSoapInput,
  IssueRxInput,
  OrderLabInput,
  ReferralInput,
  ProviderEarnings,
  ProviderHomeNav,
  SubmitVcnInput,
  VcnStatus,
} from './types';

const VET_API = `${HEALTH_API_BASE}/vet`;
const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));

const now = Date.now();
const iso = (offsetMin: number) => new Date(now + offsetMin * 60_000).toISOString();
const isoDay = (offsetDays: number) => new Date(now + offsetDays * 86_400_000).toISOString();

// ── Mock: pets ────────────────────────────────────────────────────────────────
let MOCK_PETS: Pet[] = [
  {
    id: 'pet_bella',
    name: 'Bella',
    species: 'dog',
    breed: 'Boerboel',
    sex: 'female',
    dob: isoDay(-365 * 3),
    ageLabel: '3 yrs',
    weightKg: 48,
    microchipId: 'NG-CHIP-771201',
    neutered: true,
    avatarColor: Colors.iconBgBlue,
    notes: 'Friendly. Mild seasonal skin allergy.',
  },
  {
    id: 'pet_milo',
    name: 'Milo',
    species: 'cat',
    breed: 'Domestic Shorthair',
    sex: 'male',
    dob: isoDay(-365 * 2),
    ageLabel: '2 yrs',
    weightKg: 4.6,
    microchipId: 'NG-CHIP-553090',
    neutered: true,
    avatarColor: Colors.iconBgPurple,
    notes: 'Indoor cat.',
  },
];

// ── Mock: pet records ─────────────────────────────────────────────────────────
const MOCK_PET_RECORDS: PetRecordEntry[] = [
  { id: 'prc_1', petId: 'pet_bella', kind: 'consult_note', title: 'Skin allergy review', summary: 'Mild atopic dermatitis; advised antihistamine course.', at: isoDay(-12), providerName: 'Dr. Adeyemi', sensitive: true },
  { id: 'prc_2', petId: 'pet_bella', kind: 'vaccination', title: 'Rabies booster', summary: 'Administered; next due in 12 months.', at: isoDay(-60), providerName: 'Dr. Adeyemi' },
  { id: 'prc_3', petId: 'pet_bella', kind: 'prescription', title: 'Apoquel 16mg', summary: 'For atopic dermatitis, 14-day course.', at: isoDay(-12), providerName: 'Dr. Adeyemi', sensitive: true },
  { id: 'prc_4', petId: 'pet_bella', kind: 'weight', title: 'Weight recorded', summary: '48.0 kg', at: isoDay(-12), providerName: 'Dr. Adeyemi' },
  { id: 'prc_5', petId: 'pet_milo', kind: 'vaccination', title: 'FVRCP vaccine', summary: 'Core feline vaccine; next due in 12 months.', at: isoDay(-90), providerName: 'Dr. Okoro' },
  { id: 'prc_6', petId: 'pet_milo', kind: 'lab_result', title: 'Blood panel', summary: 'All values within normal range.', at: isoDay(-90), providerName: 'Dr. Okoro', sensitive: true },
];

// ── Mock: vaccinations ──────────────────────────────────────────────────────────
const MOCK_VACCINATIONS: VaccinationEntry[] = [
  { id: 'vac_1', petId: 'pet_bella', vaccine: 'Rabies', status: 'up_to_date', lastGivenAt: isoDay(-60), dueAt: isoDay(305) },
  { id: 'vac_2', petId: 'pet_bella', vaccine: 'DHPP (Distemper/Parvo)', status: 'due_soon', lastGivenAt: isoDay(-330), dueAt: isoDay(20) },
  { id: 'vac_3', petId: 'pet_bella', vaccine: 'Leptospirosis', status: 'overdue', lastGivenAt: isoDay(-400), dueAt: isoDay(-30) },
  { id: 'vac_4', petId: 'pet_milo', vaccine: 'FVRCP', status: 'up_to_date', lastGivenAt: isoDay(-90), dueAt: isoDay(275) },
  { id: 'vac_5', petId: 'pet_milo', vaccine: 'Rabies', status: 'due_soon', lastGivenAt: isoDay(-340), dueAt: isoDay(15) },
];

// ── Mock: vets (HL-2 VCN credential + geo) ──────────────────────────────────────
const MOCK_VETS: Vet[] = [
  {
    id: 'vet_adeyemi',
    name: 'Dr. Tunde Adeyemi',
    headline: 'Veterinary Surgeon · Small animals',
    bio: 'VCN-registered veterinary surgeon with 11 years in small-animal practice. Special interest in dermatology and preventive care.',
    credential: { authority: 'VCN', licenseNo: 'VCN-2014-0912', status: 'verified' },
    rating: 4.9,
    reviewCount: 326,
    clinicName: 'PawCare Veterinary Clinic',
    address: '24 Admiralty Way, Lekki Phase 1, Lagos',
    distanceLabel: '1.4 km',
    lat: 6.4406,
    lng: 3.4719,
    consultFeeKobo: 1500000,
    homeVisitFeeKobo: 800000,
    types: ['tele', 'home', 'clinic'],
    species: ['dog', 'cat', 'rabbit'],
    specialties: ['General practice', 'Dermatology', 'Preventive care'],
    availableNow: true,
    active: true,
  },
  {
    id: 'vet_okoro',
    name: 'Dr. Ada Okoro',
    headline: 'Veterinary Surgeon · Feline & exotics',
    bio: 'Feline-focused vet and exotic-animal enthusiast. VCN-registered. Offers tele-consults and clinic visits.',
    credential: { authority: 'VCN', licenseNo: 'VCN-2017-1185', status: 'verified' },
    rating: 4.8,
    reviewCount: 198,
    clinicName: 'Furry Friends Animal Hospital',
    address: '5 Awolowo Rd, Ikoyi, Lagos',
    distanceLabel: '3.2 km',
    lat: 6.4503,
    lng: 3.4316,
    consultFeeKobo: 1300000,
    homeVisitFeeKobo: 900000,
    types: ['tele', 'clinic'],
    species: ['cat', 'bird', 'reptile', 'rabbit'],
    specialties: ['Feline medicine', 'Exotic animals', 'Dentistry'],
    availableNow: false,
    active: true,
  },
  {
    id: 'vet_bello',
    name: 'Dr. Hassan Bello',
    headline: 'Veterinary Surgeon · Surgery & emergencies',
    bio: 'Surgeon with emergency-medicine training. VCN-registered. Home visits across the mainland.',
    credential: { authority: 'VCN', licenseNo: 'VCN-2012-0431', status: 'verified' },
    rating: 4.7,
    reviewCount: 412,
    clinicName: 'Vetcare Surgical Centre',
    address: '14 Allen Ave, Ikeja, Lagos',
    distanceLabel: '6.8 km',
    lat: 6.6018,
    lng: 3.3515,
    consultFeeKobo: 1800000,
    homeVisitFeeKobo: 1200000,
    types: ['home', 'clinic'],
    species: ['dog', 'cat'],
    specialties: ['Surgery', 'Emergency care'],
    availableNow: true,
    active: true,
  },
];

// ── Mock: availability ──────────────────────────────────────────────────────────
function buildAvailability(vetId: string): AvailabilityDay[] {
  const vet = MOCK_VETS.find((v) => v.id === vetId) ?? MOCK_VETS[0];
  const days: AvailabilityDay[] = [];
  const labels = ['Today', 'Tomorrow', 'Wed', 'Thu', 'Fri'];
  const times = ['09:00 AM', '11:30 AM', '02:00 PM', '04:30 PM', '06:00 PM'];
  for (let d = 0; d < 5; d += 1) {
    const slots = times.map((t, i) => {
      const type = vet.types[i % vet.types.length];
      return {
        id: `${vetId}_d${d}_s${i}`,
        start: isoDay(d),
        label: t,
        type,
        available: !(d === 0 && i < 2), // first two slots today are gone
      };
    });
    days.push({ date: isoDay(d), label: labels[d], slots });
  }
  return days;
}

// ── Mock: appointments (state machine walk-through) ──────────────────────────────
let MOCK_APPOINTMENTS: Appointment[] = [
  {
    id: 'appt_001',
    petId: 'pet_bella',
    petName: 'Bella',
    vetId: 'vet_adeyemi',
    vetName: 'Dr. Tunde Adeyemi',
    type: 'tele',
    status: 'CONFIRMED',
    scheduledFor: iso(30),
    reason: 'Recurring skin itching and redness',
    feeKobo: 1500000,
    homeVisitFeeKobo: 0,
    totalKobo: 1500000,
    paymentHeld: true,
    createdAt: iso(-120),
    consultId: 'vcns_001',
  },
  {
    id: 'appt_002',
    petId: 'pet_bella',
    petName: 'Bella',
    vetId: 'vet_bello',
    vetName: 'Dr. Hassan Bello',
    type: 'home',
    status: 'IN_PROGRESS',
    scheduledFor: iso(-15),
    reason: 'Limping on hind leg',
    feeKobo: 1800000,
    homeVisitFeeKobo: 1200000,
    totalKobo: 3000000,
    paymentHeld: true,
    createdAt: iso(-240),
    location: '12B Ozumba Mbadiwe Ave, Victoria Island, Lagos',
  },
  {
    id: 'appt_003',
    petId: 'pet_milo',
    petName: 'Milo',
    vetId: 'vet_okoro',
    vetName: 'Dr. Ada Okoro',
    type: 'clinic',
    status: 'COMPLETED',
    scheduledFor: isoDay(-12),
    reason: 'Annual wellness check',
    feeKobo: 1300000,
    homeVisitFeeKobo: 0,
    totalKobo: 1300000,
    paymentHeld: false,
    createdAt: isoDay(-13),
    summaryId: 'sum_003',
    prescriptionId: 'erx_003',
  },
];

// ── Mock: consult ────────────────────────────────────────────────────────────────
const MOCK_CONSULTS: VetConsult[] = [
  {
    id: 'vcns_001',
    appointmentId: 'appt_001',
    vetId: 'vet_adeyemi',
    vetName: 'Dr. Tunde Adeyemi',
    petId: 'pet_bella',
    petName: 'Bella',
    mode: 'video',
    status: 'scheduled',
    scheduledAt: iso(30),
    providerReady: true,
    messages: [
      { id: 'm1', authorName: 'Dr. Tunde Adeyemi', fromProvider: true, body: 'Hi! I can see Bella’s history. Tell me when the itching started.', sentAt: iso(-2) },
    ],
  },
];

// ── Mock: consult summaries (SOAP) ──────────────────────────────────────────────
const MOCK_SUMMARIES: ConsultSummary[] = [
  {
    id: 'sum_003',
    appointmentId: 'appt_003',
    petId: 'pet_milo',
    petName: 'Milo',
    vetId: 'vet_okoro',
    vetName: 'Dr. Ada Okoro',
    completedAt: isoDay(-12),
    soap: {
      subjective: 'Owner reports normal appetite and activity. No vomiting or diarrhoea.',
      objective: 'BAR. T 38.6°C, HR 180, RR 28. BCS 5/9. Dental tartar grade 1. Heart/lungs clear.',
      assessment: 'Healthy adult cat. Mild dental tartar.',
      plan: 'Continue current diet. Dental cleaning recommended within 6 months. FVRCP up to date. Recheck in 12 months.',
    },
    diagnosis: 'Healthy — routine wellness',
    followUpRecommended: true,
    followUpNote: 'Dental cleaning within 6 months.',
    prescriptionId: 'erx_003',
  },
];

// ── Mock: e-prescriptions (HL-3) ─────────────────────────────────────────────────
const MOCK_PRESCRIPTIONS: EPrescription[] = [
  {
    id: 'erx_003',
    appointmentId: 'appt_003',
    petId: 'pet_milo',
    petName: 'Milo',
    vetId: 'vet_okoro',
    vetName: 'Dr. Ada Okoro',
    vetCredential: { authority: 'VCN', licenseNo: 'VCN-2017-1185', status: 'verified' },
    status: 'ISSUED',
    issuedAt: isoDay(-12),
    expiresAt: isoDay(18),
    sensitive: true,
    items: [
      {
        id: 'rxi_1',
        drugName: 'Metronidazole',
        form: 'tablet',
        dosage: '50mg',
        frequency: 'Twice daily',
        durationDays: 7,
        quantity: 14,
        pom: true,
        instructions: 'Give with food.',
      },
    ],
    notes: 'For mild GI support. Complete the full course.',
  },
  {
    id: 'erx_bella',
    appointmentId: 'appt_001',
    petId: 'pet_bella',
    petName: 'Bella',
    vetId: 'vet_adeyemi',
    vetName: 'Dr. Tunde Adeyemi',
    vetCredential: { authority: 'VCN', licenseNo: 'VCN-2014-0912', status: 'verified' },
    status: 'SENT_TO_PHARMACY',
    issuedAt: isoDay(-12),
    expiresAt: isoDay(18),
    sensitive: true,
    items: [
      { id: 'rxi_a', drugName: 'Apoquel', form: 'tablet', dosage: '16mg', frequency: 'Once daily', durationDays: 14, quantity: 14, pom: true, instructions: 'For atopic dermatitis.' },
      { id: 'rxi_b', drugName: 'Omega-3 supplement', form: 'capsule', dosage: '1000mg', frequency: 'Once daily', durationDays: 30, quantity: 30, pom: false },
    ],
    notes: 'Skin allergy management.',
  },
];

// ── Mock: pet meds & refills ─────────────────────────────────────────────────────
const MOCK_MEDS: PetMedication[] = [
  { id: 'med_1', petId: 'pet_bella', petName: 'Bella', drugName: 'Apoquel 16mg', dosage: '1 tablet', frequency: 'Once daily', nextRefillAt: isoDay(3), refillsRemaining: 2, prescriptionId: 'erx_bella', active: true },
  { id: 'med_2', petId: 'pet_milo', petName: 'Milo', drugName: 'Metronidazole 50mg', dosage: '1 tablet', frequency: 'Twice daily', nextRefillAt: isoDay(-1), refillsRemaining: 0, prescriptionId: 'erx_003', active: true },
];

// ── Mock: home-visit tracking ────────────────────────────────────────────────────
const MOCK_HOME_VISIT: HomeVisitTracking = {
  appointmentId: 'appt_002',
  vetName: 'Dr. Hassan Bello',
  vetPhone: '+234 803 111 2222',
  vehicle: 'Branded SUV · LAG-442-KJ',
  stage: 'en_route',
  etaLabel: '12 min away',
  vetLat: 6.4406,
  vetLng: 3.4519,
  destLat: 6.4281,
  destLng: 3.4219,
  address: '12B Ozumba Mbadiwe Ave, Victoria Island, Lagos',
};

// ── Mock: reviews ────────────────────────────────────────────────────────────────
const MOCK_REVIEWS: VetReview[] = [
  { id: 'rev1', author: 'Chioma E.', rating: 5, body: 'Dr. Adeyemi was patient and thorough. Bella’s skin cleared up fast.', at: isoDay(-5) },
  { id: 'rev2', author: 'Femi A.', rating: 4, body: 'Good tele-consult, helpful advice. Slight wait to start.', at: isoDay(-14) },
];

// ── Mock: emergency vet options (HL-11) ──────────────────────────────────────────
const MOCK_EMERGENCY: EmergencyVetOption[] = [
  { id: 'emrg_1', name: 'Lagos Animal Emergency Hospital', address: '3 Bourdillon Rd, Ikoyi', distanceLabel: '2.1 km', phone: '+234 700 911 0000', open24h: true, lat: 6.452, lng: 3.435 },
  { id: 'emrg_2', name: 'PawCare 24/7 Emergency', address: '24 Admiralty Way, Lekki', distanceLabel: '1.4 km', phone: '+234 700 922 1111', open24h: true, lat: 6.4406, lng: 3.4719 },
  { id: 'emrg_3', name: 'Vetcare Surgical Centre (After-hours)', address: '14 Allen Ave, Ikeja', distanceLabel: '6.8 km', phone: '+234 700 933 2222', open24h: false, lat: 6.6018, lng: 3.3515 },
];

// ── Mock: provider ───────────────────────────────────────────────────────────────
let MOCK_PROFILE: ProviderProfile = {
  status: 'approved',
  applicationId: 'vetapp_001',
  displayName: 'Dr. Tunde Adeyemi',
  vcnLicenseNo: 'VCN-2014-0912',
  clinicName: 'PawCare Veterinary Clinic',
  bio: 'VCN-registered veterinary surgeon with 11 years in small-animal practice.',
  consultFeeKobo: 1500000,
  homeVisitFeeKobo: 800000,
  types: ['tele', 'home', 'clinic'],
  species: ['dog', 'cat', 'rabbit'],
  credential: { authority: 'VCN', licenseNo: 'VCN-2014-0912', status: 'verified' },
};

// ── Mock: Mode B (assisted) VCN verification — coarse stage only ────────────────
// The member-facing status NEVER carries register data, matched fields, reviewer
// identity, or notes — only the coarse stage + granted capability.
let MOCK_VCN_STATUS: VcnStatus = {
  applicationId: 'vetapp_001',
  capability: 'vet.practice',
  stage: 'pending_review',
};

let MOCK_AVAIL_BLOCKS: ProviderAvailabilityBlock[] = [
  { id: 'ab_1', day: 'Mon', start: '09:00', end: '17:00', type: 'clinic', enabled: true },
  { id: 'ab_2', day: 'Tue', start: '09:00', end: '17:00', type: 'clinic', enabled: true },
  { id: 'ab_3', day: 'Wed', start: '10:00', end: '14:00', type: 'tele', enabled: true },
  { id: 'ab_4', day: 'Thu', start: '09:00', end: '17:00', type: 'home', enabled: true },
  { id: 'ab_5', day: 'Fri', start: '09:00', end: '13:00', type: 'tele', enabled: false },
];

const MOCK_PROVIDER_APPTS: ProviderAppointmentRow[] = [
  { appointmentId: 'appt_001', ownerName: 'Chioma E.', petName: 'Bella', species: 'dog', type: 'tele', status: 'REQUESTED', scheduledFor: iso(120), reason: 'Recurring skin itching' },
  { appointmentId: 'appt_010', ownerName: 'Femi A.', petName: 'Rex', species: 'dog', type: 'home', status: 'CONFIRMED', scheduledFor: iso(240), reason: 'Vaccination + check-up' },
  { appointmentId: 'appt_002', ownerName: 'Sade M.', petName: 'Whiskers', species: 'cat', type: 'clinic', status: 'IN_PROGRESS', scheduledFor: iso(-15), reason: 'Eye discharge' },
  { appointmentId: 'appt_003', ownerName: 'Bola A.', petName: 'Milo', species: 'cat', type: 'clinic', status: 'COMPLETED', scheduledFor: isoDay(-12), reason: 'Wellness check' },
];

const MOCK_EARNINGS: ProviderEarnings = {
  availableKobo: 6850000,
  pendingKobo: 1500000,
  heldKobo: 3000000,
  payouts: [
    { id: 'po1', amountKobo: 9500000, at: isoDay(-7), status: 'paid' },
    { id: 'po2', amountKobo: 1500000, at: iso(-360), status: 'processing' },
  ],
};

const MOCK_PROVIDER_HOME_NAV: ProviderHomeNav = {
  appointmentId: 'appt_010',
  ownerName: 'Femi A.',
  petName: 'Rex',
  address: '7 Bourdillon Rd, Ikoyi, Lagos',
  destLat: 6.452,
  destLng: 3.435,
  vetLat: 6.4406,
  vetLng: 3.4719,
  etaLabel: '14 min',
  distanceLabel: '5.2 km',
  phone: '+234 803 444 5555',
};

// ══ PETS ════════════════════════════════════════════════════════════════════
export async function getPets(): Promise<Pet[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_PETS;
  }
  const { data } = await api.get<Pet[]>(`${VET_API}/pets`);
  return data;
}

export async function getPet(id: string): Promise<Pet> {
  if (USE_MOCK) {
    await delay();
    const p = MOCK_PETS.find((x) => x.id === id);
    if (!p) throw new Error('Pet not found');
    return p;
  }
  const { data } = await api.get<Pet>(`${VET_API}/pets/${id}`);
  return data;
}

function ageLabelFromDob(dob?: string): string {
  if (!dob) return 'Unknown age';
  const years = (Date.now() - new Date(dob).getTime()) / (365 * 86_400_000);
  if (years < 1) return `${Math.max(1, Math.round(years * 12))} mos`;
  return `${Math.floor(years)} yr${Math.floor(years) === 1 ? '' : 's'}`;
}

const PET_COLORS = [Colors.iconBgBlue, Colors.iconBgPurple, Colors.iconBgTeal, Colors.iconBgGold];

export async function createPet(input: PetInput): Promise<Pet> {
  if (USE_MOCK) {
    await delay(420);
    const pet: Pet = {
      id: `pet_${Date.now()}`,
      ...input,
      ageLabel: ageLabelFromDob(input.dob),
      avatarColor: PET_COLORS[MOCK_PETS.length % PET_COLORS.length],
    };
    MOCK_PETS = [...MOCK_PETS, pet];
    return pet;
  }
  const { data } = await api.post<Pet>(`${VET_API}/pets`, input);
  return data;
}

export async function updatePet(id: string, input: PetInput): Promise<Pet> {
  if (USE_MOCK) {
    await delay(420);
    let updated: Pet | undefined;
    MOCK_PETS = MOCK_PETS.map((p) => {
      if (p.id !== id) return p;
      updated = { ...p, ...input, ageLabel: ageLabelFromDob(input.dob ?? p.dob) };
      return updated;
    });
    if (!updated) throw new Error('Pet not found');
    return updated;
  }
  const { data } = await api.put<Pet>(`${VET_API}/pets/${id}`, input);
  return data;
}

export async function getPetRecords(petId: string): Promise<PetRecordEntry[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_PET_RECORDS.filter((r) => r.petId === petId).sort((a, b) => +new Date(b.at) - +new Date(a.at));
  }
  const { data } = await api.get<PetRecordEntry[]>(`${VET_API}/pets/${petId}/records`);
  return data;
}

export async function getVaccinations(petId?: string): Promise<VaccinationEntry[]> {
  if (USE_MOCK) {
    await delay();
    return petId ? MOCK_VACCINATIONS.filter((v) => v.petId === petId) : MOCK_VACCINATIONS;
  }
  const { data } = await api.get<VaccinationEntry[]>(`${VET_API}/vaccinations`, { params: { petId } });
  return data;
}

export async function scheduleVaccination(vaccinationId: string, dueAt: string): Promise<VaccinationEntry> {
  if (USE_MOCK) {
    await delay(350);
    const v = MOCK_VACCINATIONS.find((x) => x.id === vaccinationId);
    if (!v) throw new Error('Vaccination not found');
    v.status = 'scheduled';
    v.dueAt = dueAt;
    return { ...v };
  }
  const { data } = await api.post<VaccinationEntry>(`${VET_API}/vaccinations/${vaccinationId}/schedule`, { dueAt });
  return data;
}

// ══ VETS (HL-2 credential-gated discovery) ══════════════════════════════════
export async function getVets(query?: VetQuery): Promise<Vet[]> {
  if (USE_MOCK) {
    await delay();
    let rows = MOCK_VETS.filter((v) => v.active && v.credential.status === 'verified');
    if (query?.type) rows = rows.filter((v) => v.types.includes(query.type!));
    if (query?.species) rows = rows.filter((v) => v.species.includes(query.species!));
    if (query?.q) {
      const q = query.q.toLowerCase();
      rows = rows.filter(
        (v) => v.name.toLowerCase().includes(q) || v.specialties.join(' ').toLowerCase().includes(q),
      );
    }
    return rows;
  }
  const { data } = await api.get<Vet[]>(`${VET_API}/vets`, { params: query });
  return data;
}

export async function getVet(id: string): Promise<Vet> {
  if (USE_MOCK) {
    await delay();
    const v = MOCK_VETS.find((x) => x.id === id);
    if (!v) throw new Error('Vet not found');
    return v;
  }
  const { data } = await api.get<Vet>(`${VET_API}/vets/${id}`);
  return data;
}

export async function getAvailability(vetId: string): Promise<AvailabilityDay[]> {
  if (USE_MOCK) {
    await delay();
    return buildAvailability(vetId);
  }
  const { data } = await api.get<AvailabilityDay[]>(`${VET_API}/vets/${vetId}/availability`);
  return data;
}

export async function getReviews(vetId: string): Promise<VetReview[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_REVIEWS;
  }
  const { data } = await api.get<VetReview[]>(`${VET_API}/vets/${vetId}/reviews`);
  return data;
}

export async function submitReview(input: SubmitReviewInput): Promise<VetReview> {
  if (USE_MOCK) {
    await delay(350);
    return { id: `rev_${Date.now()}`, author: 'You', rating: input.rating, body: input.body, at: new Date().toISOString() };
  }
  const { data } = await api.post<VetReview>(`${VET_API}/reviews`, input);
  return data;
}

// ══ APPOINTMENTS (HL-9 held payment) ════════════════════════════════════════
export async function getAppointments(): Promise<Appointment[]> {
  if (USE_MOCK) {
    await delay();
    return [...MOCK_APPOINTMENTS].sort((a, b) => +new Date(b.scheduledFor) - +new Date(a.scheduledFor));
  }
  const { data } = await api.get<Appointment[]>(`${VET_API}/appointments`);
  return data;
}

export async function getAppointment(id: string): Promise<Appointment> {
  if (USE_MOCK) {
    await delay();
    const a = MOCK_APPOINTMENTS.find((x) => x.id === id) ?? MOCK_APPOINTMENTS[0];
    return a;
  }
  const { data } = await api.get<Appointment>(`${VET_API}/appointments/${id}`);
  return data;
}

export async function createAppointment(input: CreateAppointmentInput): Promise<Appointment> {
  if (USE_MOCK) {
    await delay(500);
    const vet = MOCK_VETS.find((v) => v.id === input.vetId);
    const pet = MOCK_PETS.find((p) => p.id === input.petId);
    const homeFee = input.type === 'home' ? input.homeVisitFeeKobo : 0;
    const appt: Appointment = {
      id: `appt_${Date.now()}`,
      petId: input.petId,
      petName: pet?.name ?? 'Pet',
      vetId: input.vetId,
      vetName: vet?.name ?? 'Vet',
      type: input.type,
      status: 'REQUESTED',
      scheduledFor: input.scheduledFor,
      reason: input.reason,
      feeKobo: input.feeKobo,
      homeVisitFeeKobo: homeFee,
      totalKobo: input.feeKobo + homeFee,
      paymentHeld: true,
      createdAt: new Date().toISOString(),
      location: input.location,
    };
    MOCK_APPOINTMENTS = [appt, ...MOCK_APPOINTMENTS];
    return appt;
  }
  // HL-9: held payment captured on booking; Idempotency-Key guards the mutation.
  const { data } = await api.post<Appointment>(`${VET_API}/appointments`, input, {
    headers: { 'Idempotency-Key': input.idempotencyKey },
  });
  return data;
}

export async function rescheduleAppointment(input: RescheduleInput): Promise<Appointment> {
  if (USE_MOCK) {
    await delay(350);
    const a = MOCK_APPOINTMENTS.find((x) => x.id === input.appointmentId);
    if (!a) throw new Error('Appointment not found');
    a.status = 'RESCHEDULED';
    a.scheduledFor = input.scheduledFor;
    return { ...a };
  }
  const { data } = await api.post<Appointment>(`${VET_API}/appointments/${input.appointmentId}/reschedule`, input);
  return data;
}

export async function cancelAppointment(id: string): Promise<Appointment> {
  if (USE_MOCK) {
    await delay(350);
    const a = MOCK_APPOINTMENTS.find((x) => x.id === id);
    if (!a) throw new Error('Appointment not found');
    a.status = 'CANCELLED';
    a.paymentHeld = false;
    return { ...a };
  }
  const { data } = await api.post<Appointment>(`${VET_API}/appointments/${id}/cancel`, {});
  return data;
}

// ══ CONSULT ═════════════════════════════════════════════════════════════════
export async function getConsult(id: string): Promise<VetConsult> {
  if (USE_MOCK) {
    await delay();
    const c = MOCK_CONSULTS.find((x) => x.id === id) ?? MOCK_CONSULTS[0];
    return c;
  }
  const { data } = await api.get<VetConsult>(`${VET_API}/consults/${id}`);
  return data;
}

export async function startConsult(id: string): Promise<VetConsult> {
  if (USE_MOCK) {
    await delay(300);
    const c = MOCK_CONSULTS.find((x) => x.id === id) ?? MOCK_CONSULTS[0];
    c.status = 'in_progress';
    return { ...c };
  }
  const { data } = await api.post<VetConsult>(`${VET_API}/consults/${id}/start`, {});
  return data;
}

export async function sendConsultMessage(consultId: string, body: string): Promise<VetConsultMessage> {
  const message: VetConsultMessage = {
    id: `vmsg_${Date.now()}`,
    authorName: 'You',
    fromProvider: false,
    body,
    sentAt: new Date().toISOString(),
  };
  if (USE_MOCK) {
    await delay(120);
    const c = MOCK_CONSULTS.find((x) => x.id === consultId);
    if (c) c.messages = [...c.messages, message];
    return message;
  }
  const { data } = await api.post<VetConsultMessage>(`${VET_API}/consults/${consultId}/messages`, { body });
  return data;
}

export async function completeConsult(id: string): Promise<{ ok: true; summaryId: string }> {
  if (USE_MOCK) {
    await delay(300);
    const c = MOCK_CONSULTS.find((x) => x.id === id);
    if (c) c.status = 'completed';
    return { ok: true, summaryId: 'sum_003' };
  }
  const { data } = await api.post<{ ok: true; summaryId: string }>(`${VET_API}/consults/${id}/complete`, {});
  return data;
}

// ══ CONSULT SUMMARY ═════════════════════════════════════════════════════════
export async function getConsultSummary(id: string): Promise<ConsultSummary> {
  if (USE_MOCK) {
    await delay();
    const s = MOCK_SUMMARIES.find((x) => x.id === id) ?? MOCK_SUMMARIES[0];
    return s;
  }
  const { data } = await api.get<ConsultSummary>(`${VET_API}/summaries/${id}`);
  return data;
}

// ══ E-PRESCRIPTION (HL-3 / HL-8) ════════════════════════════════════════════
export async function getPrescription(id: string): Promise<EPrescription> {
  if (USE_MOCK) {
    await delay();
    const p = MOCK_PRESCRIPTIONS.find((x) => x.id === id) ?? MOCK_PRESCRIPTIONS[0];
    return p;
  }
  const { data } = await api.get<EPrescription>(`${VET_API}/prescriptions/${id}`);
  return data;
}

export async function getPrescriptions(petId?: string): Promise<EPrescription[]> {
  if (USE_MOCK) {
    await delay();
    return petId ? MOCK_PRESCRIPTIONS.filter((p) => p.petId === petId) : MOCK_PRESCRIPTIONS;
  }
  const { data } = await api.get<EPrescription[]>(`${VET_API}/prescriptions`, { params: { petId } });
  return data;
}

/** HL-8: explicit consent before a sensitive record/e-Rx body is unlocked. */
export async function acknowledgeRecordConsent(recordId: string): Promise<{ acknowledged: boolean }> {
  if (USE_MOCK) {
    await delay(250);
    return { acknowledged: true };
  }
  const { data } = await api.post<{ acknowledged: boolean }>(`${VET_API}/records/${recordId}/consent`, {});
  return data;
}

/** Care handoff: send an issued e-Rx to the pharmacy vertical (HL-3 verify-then-dispense). */
export async function sendRxToPharmacy(prescriptionId: string): Promise<EPrescription> {
  if (USE_MOCK) {
    await delay(350);
    const p = MOCK_PRESCRIPTIONS.find((x) => x.id === prescriptionId);
    if (!p) throw new Error('Prescription not found');
    p.status = 'SENT_TO_PHARMACY';
    return { ...p };
  }
  const { data } = await api.post<EPrescription>(`${VET_API}/prescriptions/${prescriptionId}/send-to-pharmacy`, {});
  return data;
}

// ══ PET MEDS & REFILLS ══════════════════════════════════════════════════════
export async function getMedications(petId?: string): Promise<PetMedication[]> {
  if (USE_MOCK) {
    await delay();
    return petId ? MOCK_MEDS.filter((m) => m.petId === petId) : MOCK_MEDS;
  }
  const { data } = await api.get<PetMedication[]>(`${VET_API}/medications`, { params: { petId } });
  return data;
}

export async function requestRefill(medId: string): Promise<{ ok: true }> {
  if (USE_MOCK) {
    await delay(350);
    return { ok: true };
  }
  await api.post(`${VET_API}/medications/${medId}/refill`, {});
  return { ok: true };
}

// ══ HOME VISIT TRACKING ═════════════════════════════════════════════════════
export async function getHomeVisitTracking(appointmentId: string): Promise<HomeVisitTracking> {
  if (USE_MOCK) {
    await delay();
    return { ...MOCK_HOME_VISIT, appointmentId };
  }
  const { data } = await api.get<HomeVisitTracking>(`${VET_API}/appointments/${appointmentId}/tracking`);
  return data;
}

// ══ EMERGENCY (HL-11) ═══════════════════════════════════════════════════════
export async function getEmergencyVets(): Promise<EmergencyVetOption[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_EMERGENCY;
  }
  const { data } = await api.get<EmergencyVetOption[]>(`${VET_API}/emergency`);
  return data;
}

// ══ PROVIDER ════════════════════════════════════════════════════════════════
export async function getProviderProfile(): Promise<ProviderProfile> {
  if (USE_MOCK) {
    await delay();
    return MOCK_PROFILE;
  }
  const { data } = await api.get<ProviderProfile>(`${VET_API}/provider/profile`);
  return data;
}

export async function submitProviderOnboarding(input: SubmitOnboardingInput): Promise<ProviderProfile> {
  if (USE_MOCK) {
    await delay(400);
    MOCK_PROFILE = {
      ...MOCK_PROFILE,
      ...input,
      status: 'submitted',
      credential: { authority: 'VCN', licenseNo: input.vcnLicenseNo, status: 'pending' },
    };
    return MOCK_PROFILE;
  }
  const { data } = await api.post<ProviderProfile>(`${VET_API}/provider/onboarding`, input);
  return data;
}

// ── Mode B (assisted) VCN verification (HL-2) ───────────────────────────────────
// Member submits credentials + documents + consent; ops confirms out-of-band.
// The member only ever receives a coarse stage — no register/match detail.
export async function submitVcnVerification(input: SubmitVcnInput): Promise<VcnStatus> {
  if (USE_MOCK) {
    await delay(450);
    MOCK_VCN_STATUS = {
      applicationId: input.applicationId,
      capability: 'vet.practice',
      stage: 'pending_review',
    };
    return MOCK_VCN_STATUS;
  }
  const { data } = await api.post<VcnStatus>(`${VET_API}/verification/submit`, {
    application_id: input.applicationId,
    reg_number: input.regNumber,
    full_name: input.fullName,
    dob: input.dob,
    consent: input.consent,
    docs: input.docs.map((d) => ({ type: d.type, storage_key: d.storageKey })),
  });
  return data;
}

export async function getVcnStatus(applicationId: string): Promise<VcnStatus> {
  if (USE_MOCK) {
    await delay();
    return { ...MOCK_VCN_STATUS, applicationId };
  }
  const { data } = await api.get<VcnStatus>(`${VET_API}/verification/status`, {
    params: { application_id: applicationId },
  });
  return data;
}

export async function getVcnDocUrl(docId: string): Promise<{ url: string }> {
  if (USE_MOCK) {
    await delay();
    return { url: `https://mock.r2/vet/verification/${docId}` };
  }
  const { data } = await api.get<{ url: string }>(`${VET_API}/verification/documents/${docId}/url`);
  return data;
}

export async function updateProviderProfile(input: UpdateProfileInput): Promise<ProviderProfile> {
  if (USE_MOCK) {
    await delay(350);
    MOCK_PROFILE = { ...MOCK_PROFILE, ...input };
    return MOCK_PROFILE;
  }
  const { data } = await api.put<ProviderProfile>(`${VET_API}/provider/profile`, input);
  return data;
}

export async function getProviderAvailability(): Promise<ProviderAvailabilityBlock[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_AVAIL_BLOCKS;
  }
  const { data } = await api.get<ProviderAvailabilityBlock[]>(`${VET_API}/provider/availability`);
  return data;
}

export async function setProviderAvailability(blocks: ProviderAvailabilityBlock[]): Promise<ProviderAvailabilityBlock[]> {
  if (USE_MOCK) {
    await delay(300);
    MOCK_AVAIL_BLOCKS = blocks;
    return blocks;
  }
  const { data } = await api.put<ProviderAvailabilityBlock[]>(`${VET_API}/provider/availability`, { blocks });
  return data;
}

export async function getProviderAppointments(): Promise<ProviderAppointmentRow[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_PROVIDER_APPTS;
  }
  const { data } = await api.get<ProviderAppointmentRow[]>(`${VET_API}/provider/appointments`);
  return data;
}

export async function decideAppointment(input: DecisionInput): Promise<{ ok: true; status: string }> {
  if (USE_MOCK) {
    await delay(350);
    const row = MOCK_PROVIDER_APPTS.find((r) => r.appointmentId === input.appointmentId);
    if (row) {
      if (input.decision === 'accept') row.status = 'ACCEPTED';
      else if (input.decision === 'reschedule') row.status = 'RESCHEDULED';
      else row.status = 'CANCELLED';
      if (input.scheduledFor) row.scheduledFor = input.scheduledFor;
    }
    return { ok: true, status: row?.status ?? 'ACCEPTED' };
  }
  const { data } = await api.post<{ ok: true; status: string }>(
    `${VET_API}/provider/appointments/${input.appointmentId}/decision`,
    input,
  );
  return data;
}

export async function getPetChart(petId: string): Promise<PetChart> {
  if (USE_MOCK) {
    await delay();
    const pet = MOCK_PETS.find((p) => p.id === petId) ?? MOCK_PETS[0];
    return {
      pet,
      ownerName: 'Chioma E.',
      vaccinations: MOCK_VACCINATIONS.filter((v) => v.petId === pet.id),
      records: MOCK_PET_RECORDS.filter((r) => r.petId === pet.id),
      weightSeries: [
        { at: isoDay(-180), kg: pet.weightKg ? pet.weightKg - 2 : 10 },
        { at: isoDay(-90), kg: pet.weightKg ? pet.weightKg - 1 : 11 },
        { at: isoDay(-12), kg: pet.weightKg ?? 12 },
      ],
    };
  }
  const { data } = await api.get<PetChart>(`${VET_API}/provider/pets/${petId}/chart`);
  return data;
}

export async function saveSoapNote(input: SaveSoapInput): Promise<{ ok: true; summaryId: string }> {
  if (USE_MOCK) {
    await delay(400);
    return { ok: true, summaryId: `sum_${Date.now()}` };
  }
  const { data } = await api.post<{ ok: true; summaryId: string }>(
    `${VET_API}/provider/appointments/${input.appointmentId}/soap`,
    input,
  );
  return data;
}

export async function issuePrescription(input: IssueRxInput): Promise<EPrescription> {
  if (USE_MOCK) {
    await delay(450);
    const pet = MOCK_PETS.find((p) => p.id === input.petId);
    return {
      id: `erx_${Date.now()}`,
      appointmentId: input.appointmentId,
      petId: input.petId,
      petName: pet?.name ?? 'Pet',
      vetId: MOCK_PROFILE.vcnLicenseNo,
      vetName: MOCK_PROFILE.displayName,
      vetCredential: MOCK_PROFILE.credential,
      status: 'ISSUED',
      issuedAt: new Date().toISOString(),
      expiresAt: isoDay(30),
      sensitive: true,
      items: input.items.map((it, i) => ({ ...it, id: `rxi_${Date.now()}_${i}` })),
      notes: input.notes,
    };
  }
  const { data } = await api.post<EPrescription>(`${VET_API}/provider/prescriptions`, input);
  return data;
}

export async function orderLabForPet(input: OrderLabInput): Promise<{ ok: true; labOrderId: string }> {
  if (USE_MOCK) {
    await delay(350);
    return { ok: true, labOrderId: `lord_${Date.now()}` };
  }
  const { data } = await api.post<{ ok: true; labOrderId: string }>(`${VET_API}/provider/lab-orders`, input);
  return data;
}

export async function createReferral(input: ReferralInput): Promise<{ ok: true }> {
  if (USE_MOCK) {
    await delay(350);
    return { ok: true };
  }
  await api.post(`${VET_API}/provider/referrals`, input);
  return { ok: true };
}

export async function getProviderEarnings(): Promise<ProviderEarnings> {
  if (USE_MOCK) {
    await delay();
    return MOCK_EARNINGS;
  }
  const { data } = await api.get<ProviderEarnings>(`${VET_API}/provider/earnings`);
  return data;
}

export async function requestPayout(amountKobo: number, idempotencyKey: string): Promise<{ ok: true }> {
  if (USE_MOCK) {
    await delay(350);
    return { ok: true };
  }
  await api.post(`${VET_API}/provider/payouts`, { amountKobo }, { headers: { 'Idempotency-Key': idempotencyKey } });
  return { ok: true };
}

export async function getProviderReviews(): Promise<VetReview[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_REVIEWS;
  }
  const { data } = await api.get<VetReview[]>(`${VET_API}/provider/reviews`);
  return data;
}

export async function getProviderHomeNav(appointmentId: string): Promise<ProviderHomeNav> {
  if (USE_MOCK) {
    await delay();
    return { ...MOCK_PROVIDER_HOME_NAV, appointmentId };
  }
  const { data } = await api.get<ProviderHomeNav>(`${VET_API}/provider/appointments/${appointmentId}/nav`);
  return data;
}

export { newIdempotencyKey } from './constants';
