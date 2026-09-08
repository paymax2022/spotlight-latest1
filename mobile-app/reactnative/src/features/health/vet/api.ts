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
  VetService,
  AppointmentType,
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

// ════════════════════════════════════════════════════════════════════════════
// Live-mode adapters — backend/internal/health/vet/handler.go wraps every
// response as {"success": true, "<key>": <payload>} (never a bare array/object,
// and the key is per-resource — "pets", "vets", "appointment", etc. — not a
// uniform "data"). getPets() et al used to do `const { data } = await
// api.get(...); return data` and hand that whole envelope back typed as if it
// were the payload — every live call was therefore returning the WRONG SHAPE
// even on success, which is what turned a 404 on one endpoint into a `.map is
// not a function` crash on a completely different one (VetHubScreen, pets).
//
// The Go models here (model.go) are also considerably thinner than these TS
// types — no display names on an Appointment (just ids), no vet bio/rating/
// fees on VetResult, no microchip/neutered on Pet. Fields the backend does not
// track get a documented neutral default instead of invented data. And most of
// this file's functions call routes that do not exist anywhere in
// backend/internal/health/vet at all (see notOnBackend() call sites below) —
// only 14 member routes are registered (health_vet_routes.go): pets
// create/list, vet discovery, one service upsert, book/accept/confirm/cancel/
// dispatch, consult start/complete, vaccination schedule, and SOS. Everything
// else — appointment listing, the whole provider/vet-facing dashboard, VCN
// verification, reviews, availability slots, e-prescription/medication reads,
// home-visit tracking — has no backend counterpart yet.
// ════════════════════════════════════════════════════════════════════════════

/** A call with no backend route anywhere in backend/internal/health/vet. Thrown
 * instead of letting it 404 silently or (worse) crash on a shape mismatch. */
function notOnBackend(what: string): never {
  throw new Error(`${what} is unavailable: no backend endpoint exists for this yet.`);
}

interface GoPet { id: string; owner_user_id: string; name: string; species: string; breed: string; sex: string; birth_date?: string | null; weight_kg?: number | null; notes: string; created_at: string }
const PET_COLORS = [Colors.iconBgBlue, Colors.iconBgPurple, Colors.iconBgTeal, Colors.iconBgGold];
function ageLabelFromDob(dob?: string): string {
  if (!dob) return 'Unknown age';
  const years = (Date.now() - new Date(dob).getTime()) / (365 * 86_400_000);
  if (years < 1) return `${Math.max(1, Math.round(years * 12))} mos`;
  return `${Math.floor(years)} yr${Math.floor(years) === 1 ? '' : 's'}`;
}
function petFromGo(g: GoPet, index = 0): Pet {
  const species = (g.species || '').toLowerCase();
  const sex = (g.sex || '').toLowerCase();
  return {
    id: g.id,
    name: g.name ?? '',
    species: (['dog', 'cat', 'bird', 'rabbit', 'reptile', 'other'] as const).includes(species as never) ? (species as Pet['species']) : 'other',
    breed: g.breed ?? '',
    sex: (['male', 'female', 'unknown'] as const).includes(sex as never) ? (sex as Pet['sex']) : 'unknown',
    dob: g.birth_date ?? undefined,
    ageLabel: ageLabelFromDob(g.birth_date ?? undefined),
    weightKg: g.weight_kg ?? undefined,
    microchipId: undefined, // stays_room_type-style gap: not a column on the Go Pet model
    neutered: undefined, // not tracked
    avatarColor: PET_COLORS[index % PET_COLORS.length],
    notes: g.notes ?? '',
  };
}
function petToGoBody(input: PetInput) {
  // microchipId / neutered have no backend column — they are accepted here for
  // form parity but silently not persisted server-side until one exists.
  return {
    name: input.name,
    species: (input.species || '').toUpperCase(),
    breed: input.breed,
    sex: (input.sex || '').toUpperCase(),
    birth_date: input.dob,
    weight_kg: input.weightKg,
    notes: input.notes ?? '',
  };
}

interface GoVetResult { provider_id: string; display_name: string; owner_user_id: string; lat?: number | null; lng?: number | null; distance_m?: number | null }
function vetFromGo(g: GoVetResult): Vet {
  return {
    id: g.provider_id,
    name: g.display_name || 'Vet',
    headline: '', // not returned by DiscoverVets
    bio: '',
    // DiscoverVets only surfaces APPROVED + VCN-verified providers (HL-2), so
    // "verified" is a safe inference even though the credential itself isn't returned.
    credential: { authority: 'VCN', licenseNo: '', status: 'verified' },
    rating: 0, // not tracked here — see getReviews()/getProviderReviews() gaps
    reviewCount: 0,
    clinicName: '',
    address: '',
    distanceLabel: g.distance_m != null ? `${(g.distance_m / 1000).toFixed(1)} km` : '',
    lat: g.lat ?? 0,
    lng: g.lng ?? 0,
    consultFeeKobo: 0, // fees live on VetService rows, not returned by discovery
    homeVisitFeeKobo: 0,
    types: [], // discovery doesn't return which visit types/species a provider offers
    species: [],
    specialties: [],
    availableNow: false, // not tracked
    active: true, // implied by DiscoverVets' own APPROVED filter
  };
}

interface GoVetService { id: string; provider_id: string; code: string; name: string; visit_type: string; price_kobo: number; active: boolean; created_at: string }
function vetServiceFromGo(g: GoVetService): VetService {
  return {
    id: g.id,
    providerId: g.provider_id,
    code: g.code ?? '',
    name: g.name ?? '',
    visitType: (g.visit_type || '').toLowerCase() as AppointmentType,
    priceKobo: g.price_kobo ?? 0,
    active: g.active,
  };
}

interface GoAppointment { id: string; provider_id: string; owner_id: string; pet_id: string; service_id: string; visit_type: string; state: string; pay_state: string; total_kobo: number; escrow_id?: string | null; consult_id?: string | null; delivery_ref?: string | null; slot_start: string; slot_end: string; created_at: string }
async function appointmentFromGo(g: GoAppointment): Promise<Appointment> {
  // Go tracks ids only (no joined display names) — a best-effort lookup against
  // the owner's own pet list / the vet discovery list fills these in with real
  // data where it can be found; neither call is guaranteed to have the row
  // (e.g. a vet who is no longer APPROVED drops out of getVets()).
  const [pets, vets] = await Promise.all([getPets().catch(() => []), getVets().catch(() => [])]);
  return {
    id: g.id,
    petId: g.pet_id,
    petName: pets.find((p) => p.id === g.pet_id)?.name ?? '',
    vetId: g.provider_id,
    vetName: vets.find((v) => v.id === g.provider_id)?.name ?? '',
    type: (g.visit_type || '').toLowerCase() as AppointmentType,
    status: g.state as Appointment['status'], // Go's ApptState values are identical strings to AppointmentStatus
    scheduledFor: g.slot_start,
    reason: '', // not a column on health_appointments' vet projection
    feeKobo: g.total_kobo, // Go tracks one total, not a fee/home-visit-fee split
    homeVisitFeeKobo: 0,
    totalKobo: g.total_kobo,
    paymentHeld: g.pay_state === 'HELD',
    createdAt: g.created_at,
    location: undefined, // home-visit address lives on the transport delivery, not returned here
    consultId: g.consult_id ?? undefined,
    summaryId: undefined, // SOAP notes are only ever returned inline from completeConsult(), never addressable afterward
    prescriptionId: undefined, // same — only inline on the CompleteConsult response
  };
}

// ══ PETS ════════════════════════════════════════════════════════════════════
export async function getPets(): Promise<Pet[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_PETS;
  }
  const { data } = await api.get<{ pets: GoPet[] }>(`${VET_API}/pets`);
  return (data.pets ?? []).map(petFromGo);
}

export async function getPet(id: string): Promise<Pet> {
  if (USE_MOCK) {
    await delay();
    const p = MOCK_PETS.find((x) => x.id === id);
    if (!p) throw new Error('Pet not found');
    return p;
  }
  // No GET /pets/:id route exists — composed from the (small, owner-scoped) list.
  const p = (await getPets()).find((x) => x.id === id);
  if (!p) throw new Error('Pet not found');
  return p;
}

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
  const { data } = await api.post<{ pet: GoPet }>(`${VET_API}/pets`, petToGoBody(input));
  return petFromGo(data.pet);
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
  // Only POST /pets (create) and GET /pets (list) exist — there is no PUT /pets/:id.
  return notOnBackend('Editing a pet profile');
}

export async function getPetRecords(petId: string): Promise<PetRecordEntry[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_PET_RECORDS.filter((r) => r.petId === petId).sort((a, b) => +new Date(b.at) - +new Date(a.at));
  }
  return notOnBackend('Pet health records');
}

export async function getVaccinations(petId?: string): Promise<VaccinationEntry[]> {
  if (USE_MOCK) {
    await delay();
    return petId ? MOCK_VACCINATIONS.filter((v) => v.petId === petId) : MOCK_VACCINATIONS;
  }
  // POST /pets/:id/vaccinations (schedule) exists; there is no matching GET/list.
  return notOnBackend('Vaccination history');
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
  // The real endpoint is POST /pets/:petId/vaccinations {vaccine, due_at} — it
  // CREATES a new schedule for a pet+vaccine pair, it does not reschedule an
  // existing vaccination by its own id. This function's signature
  // (vaccinationId, dueAt) can't address that endpoint at all: it has neither a
  // petId nor a vaccine name, because there's also no GET to have discovered
  // an existing vaccinationId from in the first place (see getVaccinations()).
  return notOnBackend('Rescheduling a vaccination');
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
  // DiscoverVets only accepts lat/lng/radius_m (geo). `type`/`species` can't be
  // honored even client-side — VetResult carries neither field — so only the
  // free-text name match (`q`) is applied here; passing type/species is a no-op.
  const { data } = await api.get<{ vets: GoVetResult[] }>(`${VET_API}/vets`);
  let rows = (data.vets ?? []).map(vetFromGo);
  if (query?.q) {
    const q = query.q.toLowerCase();
    rows = rows.filter((v) => v.name.toLowerCase().includes(q));
  }
  return rows;
}

export async function getVet(id: string): Promise<Vet> {
  if (USE_MOCK) {
    await delay();
    const v = MOCK_VETS.find((x) => x.id === id);
    if (!v) throw new Error('Vet not found');
    return v;
  }
  // No GET /vets/:id route — composed from the discovery list.
  const v = (await getVets()).find((x) => x.id === id);
  if (!v) throw new Error('Vet not found');
  // Fees aren't part of vet discovery (see vetFromGo) — the services menu is the
  // only place they live, so a representative consult/home-visit price is
  // filled in here from it for the vet profile / booking-preview screens.
  const services = await getVetServices(id).catch(() => [] as VetService[]);
  const cheapestOfType = (t: AppointmentType) =>
    services.filter((s) => s.active && s.visitType === t).sort((a, b) => a.priceKobo - b.priceKobo)[0];
  const consult = cheapestOfType('tele') ?? cheapestOfType('clinic');
  const home = cheapestOfType('home');
  return {
    ...v,
    consultFeeKobo: consult?.priceKobo ?? v.consultFeeKobo,
    homeVisitFeeKobo: home?.priceKobo ?? v.homeVisitFeeKobo,
  };
}

/** GET /vets/:providerId/services — the priced menu a pet owner picks from before booking. */
export async function getVetServices(providerId: string): Promise<VetService[]> {
  if (USE_MOCK) {
    await delay();
    const vet = MOCK_VETS.find((v) => v.id === providerId);
    if (!vet) return [];
    const MOCK_SERVICE_NAME: Record<AppointmentType, string> = { tele: 'Tele-consult', home: 'Home visit', clinic: 'Clinic visit' };
    return vet.types.map((t) => ({
      id: `svc_${providerId}_${t}`,
      providerId,
      code: t.toUpperCase(),
      name: MOCK_SERVICE_NAME[t],
      visitType: t,
      priceKobo: t === 'home' ? vet.consultFeeKobo + vet.homeVisitFeeKobo : vet.consultFeeKobo,
      active: true,
    }));
  }
  const { data } = await api.get<{ services: GoVetService[] }>(`${VET_API}/vets/${providerId}/services`);
  return (data.services ?? []).map(vetServiceFromGo);
}

export async function getAvailability(vetId: string): Promise<AvailabilityDay[]> {
  if (USE_MOCK) {
    await delay();
    return buildAvailability(vetId);
  }
  return notOnBackend('Vet availability slots');
}

export async function getReviews(vetId: string): Promise<VetReview[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_REVIEWS;
  }
  return notOnBackend('Vet reviews');
}

export async function submitReview(input: SubmitReviewInput): Promise<VetReview> {
  if (USE_MOCK) {
    await delay(350);
    return { id: `rev_${Date.now()}`, author: 'You', rating: input.rating, body: input.body, at: new Date().toISOString() };
  }
  return notOnBackend('Submitting a review');
}

// ══ APPOINTMENTS (HL-9 held payment) ════════════════════════════════════════
export async function getAppointments(): Promise<Appointment[]> {
  if (USE_MOCK) {
    await delay();
    return [...MOCK_APPOINTMENTS].sort((a, b) => +new Date(b.scheduledFor) - +new Date(a.scheduledFor));
  }
  // This is the call that 404'd (and, upstream of that, the pets envelope bug
  // crashed the same screen): GET /appointments/:id (single, object-scoped)
  // is the only member-facing read — there is no list-all route. The one that
  // DOES list appointments (GET /admin/appointments) is RBAC-gated to
  // health.vet.appointments and scoped platform-wide, not to "my appointments".
  return notOnBackend('Listing your appointments');
}

export async function getAppointment(id: string): Promise<Appointment> {
  if (USE_MOCK) {
    await delay();
    const a = MOCK_APPOINTMENTS.find((x) => x.id === id) ?? MOCK_APPOINTMENTS[0];
    return a;
  }
  const { data } = await api.get<{ appointment: GoAppointment }>(`${VET_API}/appointments/${id}`);
  return appointmentFromGo(data.appointment);
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
  // POST /appointments (Book) prices the appointment server-side from the
  // pinned service (input.serviceId) — feeKobo/homeVisitFeeKobo above are
  // display-only. Book also requires an explicit slot_end (a time range, not
  // just a start); there is no slot-duration model in AvailabilitySlot yet, so
  // a fixed per-type duration is used as the best available approximation.
  const durationMin = input.type === 'home' ? 45 : 30;
  const start = new Date(input.scheduledFor);
  const end = new Date(start.getTime() + durationMin * 60_000);
  const { data } = await api.post<{ appointment: GoAppointment }>(
    `${VET_API}/appointments`,
    {
      provider_id: input.vetId,
      pet_id: input.petId,
      service_id: input.serviceId,
      visit_type: input.type.toUpperCase(),
      slot_start: start.toISOString(),
      slot_end: end.toISOString(),
      idempotency_key: input.idempotencyKey,
    },
    { headers: { 'Idempotency-Key': input.idempotencyKey } },
  );
  return appointmentFromGo(data.appointment);
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
  // No reschedule route — only accept/confirm/cancel/dispatch state transitions exist.
  return notOnBackend('Rescheduling an appointment');
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
  const { data } = await api.post<{ appointment: GoAppointment }>(`${VET_API}/appointments/${id}/cancel`, {});
  return appointmentFromGo(data.appointment);
}

// ══ CONSULT ═════════════════════════════════════════════════════════════════
export async function getConsult(id: string): Promise<VetConsult> {
  if (USE_MOCK) {
    await delay();
    const c = MOCK_CONSULTS.find((x) => x.id === id) ?? MOCK_CONSULTS[0];
    return c;
  }
  return notOnBackend('Reading a consult');
}

export async function startConsult(id: string): Promise<VetConsult> {
  if (USE_MOCK) {
    await delay(300);
    const c = MOCK_CONSULTS.find((x) => x.id === id) ?? MOCK_CONSULTS[0];
    c.status = 'in_progress';
    return { ...c };
  }
  // POST /consults/:id/start (:id is the APPOINTMENT id) is a real, meaningful
  // state transition (IN_PROGRESS) — it's called for real here. But it returns
  // the updated Appointment, not a consult/messaging object: there is no
  // VetConsult model, no chat persistence, and no vet/pet display-name lookup
  // on this response, so most of the object below is a documented placeholder,
  // not data this endpoint actually has.
  const { data } = await api.post<{ appointment: GoAppointment }>(`${VET_API}/consults/${id}/start`, {});
  const a = await appointmentFromGo(data.appointment);
  return {
    id: a.consultId ?? a.id,
    appointmentId: a.id,
    vetId: a.vetId,
    vetName: a.vetName,
    petId: a.petId,
    petName: a.petName,
    mode: 'video',
    status: 'in_progress',
    scheduledAt: a.scheduledFor,
    providerReady: true,
    messages: [], // no messaging persistence exists — see sendConsultMessage()
  };
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
  return notOnBackend('Sending a consult message');
}

export async function completeConsult(id: string): Promise<{ ok: true; summaryId: string }> {
  if (USE_MOCK) {
    await delay(300);
    const c = MOCK_CONSULTS.find((x) => x.id === id);
    if (c) c.status = 'completed';
    return { ok: true, summaryId: 'sum_003' };
  }
  // POST /consults/:id/complete requires the SOAP note (subjective/objective/
  // assessment/plan) plus optional rx/lab fields in the SAME request — this
  // function's (id)-only signature has no way to collect or send any of that,
  // so it cannot call the real endpoint correctly as written.
  return notOnBackend('Completing a consult');
}

// ══ CONSULT SUMMARY ═════════════════════════════════════════════════════════
export async function getConsultSummary(id: string): Promise<ConsultSummary> {
  if (USE_MOCK) {
    await delay();
    const s = MOCK_SUMMARIES.find((x) => x.id === id) ?? MOCK_SUMMARIES[0];
    return s;
  }
  // The SOAP note is only ever returned inline from completeConsult()'s
  // response (CompleteResult.clinical_note) — there is no GET to fetch it back afterward.
  return notOnBackend('Reading a consult summary');
}

// ══ E-PRESCRIPTION (HL-3 / HL-8) ════════════════════════════════════════════
export async function getPrescription(id: string): Promise<EPrescription> {
  if (USE_MOCK) {
    await delay();
    const p = MOCK_PRESCRIPTIONS.find((x) => x.id === id) ?? MOCK_PRESCRIPTIONS[0];
    return p;
  }
  return notOnBackend('Reading a prescription');
}

export async function getPrescriptions(petId?: string): Promise<EPrescription[]> {
  if (USE_MOCK) {
    await delay();
    return petId ? MOCK_PRESCRIPTIONS.filter((p) => p.petId === petId) : MOCK_PRESCRIPTIONS;
  }
  return notOnBackend('Listing prescriptions');
}

/** HL-8: explicit consent before a sensitive record/e-Rx body is unlocked. */
export async function acknowledgeRecordConsent(recordId: string): Promise<{ acknowledged: boolean }> {
  if (USE_MOCK) {
    await delay(250);
    return { acknowledged: true };
  }
  return notOnBackend('Recording consent to view a record');
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
  // This handoff already happens automatically inside completeConsult() when
  // pharmacy_provider_id is set — there is no separate endpoint to trigger it afterward.
  return notOnBackend('Sending a prescription to pharmacy');
}

// ══ PET MEDS & REFILLS ══════════════════════════════════════════════════════
export async function getMedications(petId?: string): Promise<PetMedication[]> {
  if (USE_MOCK) {
    await delay();
    return petId ? MOCK_MEDS.filter((m) => m.petId === petId) : MOCK_MEDS;
  }
  return notOnBackend('Listing pet medications');
}

export async function requestRefill(medId: string): Promise<{ ok: true }> {
  if (USE_MOCK) {
    await delay(350);
    return { ok: true };
  }
  return notOnBackend('Requesting a medication refill');
}

// ══ HOME VISIT TRACKING ═════════════════════════════════════════════════════
export async function getHomeVisitTracking(appointmentId: string): Promise<HomeVisitTracking> {
  if (USE_MOCK) {
    await delay();
    return { ...MOCK_HOME_VISIT, appointmentId };
  }
  // Dispatch (POST /appointments/:id/dispatch) only books the transport
  // delivery — the resulting location/ETA lives on the transport module, and
  // there is no vet-vertical endpoint that reads it back.
  return notOnBackend('Home-visit tracking');
}

// ══ EMERGENCY (HL-11) ═══════════════════════════════════════════════════════
export async function getEmergencyVets(): Promise<EmergencyVetOption[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_EMERGENCY;
  }
  // POST /sos exists but is a single action (route to the nearest in-person
  // vet + disclaimer), not a browsable list — and it needs {lat, lng} this
  // function's zero-argument signature doesn't collect.
  return notOnBackend('Listing emergency vets');
}

// ══ PROVIDER ════════════════════════════════════════════════════════════════
// None of the vet-facing provider dashboard has a backend counterpart: no
// profile read/write, no availability, no appointment queue/decision, no pet
// chart, no SOAP/rx/lab/referral authoring endpoints, no earnings/payouts, no
// reviews, no nav. UpsertService (POST /services) is the only provider-side
// write that exists at all, and nothing here calls it. This whole surface
// needs new backend work before it can go live — it is not a URL fix.
export async function getProviderProfile(): Promise<ProviderProfile> {
  if (USE_MOCK) {
    await delay();
    return MOCK_PROFILE;
  }
  return notOnBackend('Provider profile');
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
  return notOnBackend('Submitting provider onboarding');
}

// ── Mode B (assisted) VCN verification (HL-2) ───────────────────────────────────
// Member submits credentials + documents + consent; ops confirms out-of-band.
// The member only ever receives a coarse stage — no register/match detail.
// No /verification/* routes exist in backend/internal/health/vet at all.
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
  return notOnBackend('Submitting VCN verification');
}

export async function getVcnStatus(applicationId: string): Promise<VcnStatus> {
  if (USE_MOCK) {
    await delay();
    return { ...MOCK_VCN_STATUS, applicationId };
  }
  return notOnBackend('Reading VCN verification status');
}

export async function getVcnDocUrl(docId: string): Promise<{ url: string }> {
  if (USE_MOCK) {
    await delay();
    return { url: `https://mock.r2/vet/verification/${docId}` };
  }
  return notOnBackend('Reading a VCN verification document URL');
}

export async function updateProviderProfile(input: UpdateProfileInput): Promise<ProviderProfile> {
  if (USE_MOCK) {
    await delay(350);
    MOCK_PROFILE = { ...MOCK_PROFILE, ...input };
    return MOCK_PROFILE;
  }
  return notOnBackend('Updating provider profile');
}

export async function getProviderAvailability(): Promise<ProviderAvailabilityBlock[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_AVAIL_BLOCKS;
  }
  return notOnBackend('Provider availability');
}

export async function setProviderAvailability(blocks: ProviderAvailabilityBlock[]): Promise<ProviderAvailabilityBlock[]> {
  if (USE_MOCK) {
    await delay(300);
    MOCK_AVAIL_BLOCKS = blocks;
    return blocks;
  }
  return notOnBackend('Updating provider availability');
}

export async function getProviderAppointments(): Promise<ProviderAppointmentRow[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_PROVIDER_APPTS;
  }
  return notOnBackend('Provider appointment queue');
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
  // accept/confirm/cancel DO exist (POST /appointments/:id/{accept,confirm,cancel})
  // as three separate routes, but there is no combined "decision" endpoint and
  // no "reschedule" transition at all — this function's single-call shape
  // doesn't map onto them without a UI-level rework of how a vet acts on a request.
  return notOnBackend('Deciding on an appointment request');
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
  return notOnBackend('Provider pet chart');
}

export async function saveSoapNote(input: SaveSoapInput): Promise<{ ok: true; summaryId: string }> {
  if (USE_MOCK) {
    await delay(400);
    return { ok: true, summaryId: `sum_${Date.now()}` };
  }
  // SOAP notes are only ever written as part of completeConsult() — there is
  // no standalone "save SOAP" endpoint to call ahead of completion.
  return notOnBackend('Saving a SOAP note');
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
  // Same as saveSoapNote: an e-Rx is only ever issued inline via completeConsult().
  return notOnBackend('Issuing a prescription');
}

export async function orderLabForPet(input: OrderLabInput): Promise<{ ok: true; labOrderId: string }> {
  if (USE_MOCK) {
    await delay(350);
    return { ok: true, labOrderId: `lord_${Date.now()}` };
  }
  return notOnBackend('Ordering a lab test');
}

export async function createReferral(input: ReferralInput): Promise<{ ok: true }> {
  if (USE_MOCK) {
    await delay(350);
    return { ok: true };
  }
  return notOnBackend('Creating a referral');
}

export async function getProviderEarnings(): Promise<ProviderEarnings> {
  if (USE_MOCK) {
    await delay();
    return MOCK_EARNINGS;
  }
  return notOnBackend('Provider earnings');
}

export async function requestPayout(amountKobo: number, idempotencyKey: string): Promise<{ ok: true }> {
  if (USE_MOCK) {
    await delay(350);
    return { ok: true };
  }
  return notOnBackend('Requesting a payout');
}

export async function getProviderReviews(): Promise<VetReview[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_REVIEWS;
  }
  return notOnBackend('Provider reviews');
}

export async function getProviderHomeNav(appointmentId: string): Promise<ProviderHomeNav> {
  if (USE_MOCK) {
    await delay();
    return { ...MOCK_PROVIDER_HOME_NAV, appointmentId };
  }
  return notOnBackend('Provider home-visit navigation');
}

export { newIdempotencyKey } from './constants';
