// Live data layer for the Vet vertical: every call goes to the backend under
// HEALTH_API_BASE/vet. There is no mock/fixture path — failures surface to the screens.
// IRON RULES: kobo only · HL-2 VCN gating · HL-3 dispense-once e-Rx · HL-8
// consent-gated pet records & e-Rx · HL-9 held payment (booking carries an
// Idempotency-Key) · HL-11 emergency safety.

import { api } from '@/api/client';
import { HEALTH_API_BASE } from '../constants/health.constants';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { uploadProviderCredential, addProviderCredential } from '../api';
import { Colors } from '@/constants/tokens';
import { toWirePet } from './petForm';
import { mapListedVet, type ListedVetWire } from './vetListing';
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
  ProviderOnboardingStatus,
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
const PROVIDERS_API = `${HEALTH_API_BASE}/providers`;
const SPECIES_FROM_WIRE: Record<string, Pet['species']> = {
  DOG: 'dog', CAT: 'cat', BIRD: 'bird', RABBIT: 'rabbit', REPTILE: 'reptile',
};
const SEX_FROM_WIRE: Record<string, Pet['sex']> = { MALE: 'male', FEMALE: 'female' };

// the richer mobile Pet display shape. microchipId/neutered are not on this
// row (there is no such column server-side) so they stay undefined rather
// create/update paths already do below (PET_COLORS / ageLabelFromDob), not
// fabricated per-pet data.
function mapPet(raw: any, index: number): Pet {
  return {
    id: raw.id,
    name: raw.name ?? '',
    species: SPECIES_FROM_WIRE[String(raw.species ?? '').toUpperCase()] ?? 'other',
    breed: raw.breed ?? '',
    sex: SEX_FROM_WIRE[String(raw.sex ?? '').toUpperCase()] ?? 'unknown',
    dob: raw.birth_date ?? undefined,
    ageLabel: ageLabelFromDob(raw.birth_date ?? undefined),
    weightKg: raw.weight_kg ?? undefined,
    avatarColor: PET_COLORS[index % PET_COLORS.length],
    notes: raw.notes ?? undefined,
  };
}

export async function getPets(): Promise<Pet[]> {
  const { data } = await api.get<{ pets?: unknown[] }>(`${VET_API}/pets`);
  return (data.pets ?? []).map(mapPet);
}

export async function getPet(id: string): Promise<Pet> {
  const { data } = await api.get<{ pet: unknown }>(`${VET_API}/pets/${id}`);
  return mapPet(data.pet, 0);
}

function ageLabelFromDob(dob?: string): string {
  if (!dob) return 'Unknown age';
  const years = (Date.now() - new Date(dob).getTime()) / (365 * 86_400_000);
  if (years < 1) return `${Math.max(1, Math.round(years * 12))} mos`;
  return `${Math.floor(years)} yr${Math.floor(years) === 1 ? '' : 's'}`;
}

const PET_COLORS = [Colors.iconBgBlue, Colors.iconBgPurple, Colors.iconBgTeal, Colors.iconBgGold];

export async function createPet(input: PetInput): Promise<Pet> {
  // The server requires an Idempotency-Key on create: a retried submit must not
  // write a second pet. The screen passes a key that survives retries.
  const idem = input.idempotencyKey ?? generateIdempotencyKey();
  const { data } = await api.post<{ pet: unknown }>(`${VET_API}/pets`, toWirePet(input), {
    headers: { 'Idempotency-Key': idem },
  });
  return mapPet(data.pet, 0);
}

export async function updatePet(id: string, input: PetInput): Promise<Pet> {
  const { data } = await api.put<{ pet: unknown }>(`${VET_API}/pets/${id}`, toWirePet(input));
  return mapPet(data.pet, 0);
}

export async function getPetRecords(petId: string): Promise<PetRecordEntry[]> {
  const { data } = await api.get<PetRecordEntry[]>(`${VET_API}/pets/${petId}/records`);
  return data;
}

export async function getVaccinations(petId?: string): Promise<VaccinationEntry[]> {
  const { data } = await api.get<VaccinationEntry[]>(`${VET_API}/vaccinations`, { params: { petId } });
  return data;
}

export async function scheduleVaccination(vaccinationId: string, dueAt: string): Promise<VaccinationEntry> {
  const { data } = await api.post<VaccinationEntry>(`${VET_API}/vaccinations/${vaccinationId}/schedule`, { dueAt });
  return data;
}

export async function getVets(query?: VetQuery): Promise<Vet[]> {
  const { data } = await api.get<{ vets?: ListedVetWire[] }>(`${VET_API}/vets`, { params: query });
  return (data.vets ?? []).map(mapListedVet);
}

export async function getVet(id: string): Promise<Vet> {
  const { data } = await api.get<{ vet: ListedVetWire }>(`${VET_API}/vets/${id}`);
  return mapListedVet(data.vet);
}

export async function getAvailability(vetId: string): Promise<AvailabilityDay[]> {
  const { data } = await api.get<{ days?: AvailabilityDay[] }>(`${VET_API}/vets/${vetId}/availability`);
  return data.days ?? [];
}

export async function getReviews(vetId: string): Promise<VetReview[]> {
  const { data } = await api.get<VetReview[]>(`${VET_API}/vets/${vetId}/reviews`);
  return data;
}

export async function submitReview(input: SubmitReviewInput): Promise<VetReview> {
  const { data } = await api.post<VetReview>(`${VET_API}/reviews`, input);
  return data;
}

export async function getAppointments(): Promise<Appointment[]> {
  const { data } = await api.get<{ appointments?: Appointment[] }>(`${VET_API}/appointments`);
  return data.appointments ?? [];
}

export async function getAppointment(id: string): Promise<Appointment> {
  const { data } = await api.get<Appointment>(`${VET_API}/appointments/${id}`);
  return data;
}

export async function createAppointment(input: CreateAppointmentInput): Promise<Appointment> {
  // HL-9: held payment captured on booking; Idempotency-Key guards the mutation.
  const { data } = await api.post<Appointment>(`${VET_API}/appointments`, input, {
    headers: { 'Idempotency-Key': input.idempotencyKey },
  });
  return data;
}

export async function rescheduleAppointment(input: RescheduleInput): Promise<Appointment> {
  const { data } = await api.post<Appointment>(`${VET_API}/appointments/${input.appointmentId}/reschedule`, input);
  return data;
}

export async function cancelAppointment(id: string): Promise<Appointment> {
  const { data } = await api.post<Appointment>(`${VET_API}/appointments/${id}/cancel`, {});
  return data;
}

export async function getConsult(id: string): Promise<VetConsult> {
  const { data } = await api.get<VetConsult>(`${VET_API}/consults/${id}`);
  return data;
}

export async function startConsult(id: string): Promise<VetConsult> {
  const { data } = await api.post<VetConsult>(`${VET_API}/consults/${id}/start`, {});
  return data;
}

export async function sendConsultMessage(consultId: string, body: string): Promise<VetConsultMessage> {
  const { data } = await api.post<VetConsultMessage>(`${VET_API}/consults/${consultId}/messages`, { body });
  return data;
}

export async function getConsultSummary(id: string): Promise<ConsultSummary> {
  const { data } = await api.get<ConsultSummary>(`${VET_API}/summaries/${id}`);
  return data;
}

export async function getPrescription(id: string): Promise<EPrescription> {
  const { data } = await api.get<EPrescription>(`${VET_API}/prescriptions/${id}`);
  return data;
}

export async function getPrescriptions(petId?: string): Promise<EPrescription[]> {
  const { data } = await api.get<EPrescription[]>(`${VET_API}/prescriptions`, { params: { petId } });
  return data;
}

/** HL-8: explicit consent before a sensitive record/e-Rx body is unlocked. */
export async function acknowledgeRecordConsent(recordId: string): Promise<{ acknowledged: boolean }> {
  const { data } = await api.post<{ acknowledged: boolean }>(`${VET_API}/records/${recordId}/consent`, {});
  return data;
}

/** Care handoff: send an issued e-Rx to the pharmacy vertical (HL-3 verify-then-dispense). */
export async function sendRxToPharmacy(prescriptionId: string): Promise<EPrescription> {
  const { data } = await api.post<EPrescription>(`${VET_API}/prescriptions/${prescriptionId}/send-to-pharmacy`, {});
  return data;
}

export async function getMedications(petId?: string): Promise<PetMedication[]> {
  const { data } = await api.get<PetMedication[]>(`${VET_API}/medications`, { params: { petId } });
  return data;
}

export async function requestRefill(medId: string): Promise<{ ok: true }> {
  await api.post(`${VET_API}/medications/${medId}/refill`, {});
  return { ok: true };
}

export async function getHomeVisitTracking(appointmentId: string): Promise<HomeVisitTracking> {
  const { data } = await api.get<HomeVisitTracking>(`${VET_API}/appointments/${appointmentId}/tracking`);
  return data;
}

export async function getEmergencyVets(): Promise<EmergencyVetOption[]> {
  const { data } = await api.get<EmergencyVetOption[]>(`${VET_API}/emergency`);
  return data;
}

// `${VET_API}/provider/profile` and `${VET_API}/provider/onboarding` were
// never implemented backend side — backend/internal/app/health_vet_routes.go
// has no /provider group at all. Same bug and same fix as pharmacy/lab's
// identical onboarding 404s: the generic provider-application backend
// (backend/internal/health/providers/*, mounted at
// (service.go validType accepts 'vet') and was simply never called. This
// client type's own `applicationId?` field and the Mode B comment already
// anticipated this — the wiring was just never finished. Repointed here
// instead of building a duplicate vet-specific onboarding backend.
interface ProviderApplicationWire {
  id: string;
  domain: string;
  provider_type: string;
  display_name: string;
  state: 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'NEEDS_INFO' | 'APPROVED' | 'SUSPENDED' | 'REJECTED';
  geo_lat?: number | null;
  geo_lng?: number | null;
}

function mapApplicationState(state: ProviderApplicationWire['state']): ProviderOnboardingStatus {
  switch (state) {
    case 'DRAFT':        return 'draft';
    case 'SUBMITTED':    return 'submitted';
    case 'UNDER_REVIEW':  return 'under_review';
    case 'APPROVED':      return 'approved';
    case 'NEEDS_INFO':
    case 'SUSPENDED':
    case 'REJECTED':
    default:              return 'needs_info';
  }
}

async function findVetApplication(): Promise<ProviderApplicationWire | undefined> {
  const { data } = await api.get<{ applications: ProviderApplicationWire[] }>(`${PROVIDERS_API}/applications`);
  return data.applications?.find((a) => a.domain === 'VET');
}

// The vet's own workspace profile: bio, fees, visit types, credential and clinic
// location come from the backend, which also reports the onboarding status
// (draft when the vet has not started an application yet).
export async function getProviderProfile(): Promise<ProviderProfile> {
  const { data } = await api.get<ProviderProfile>(`${VET_API}/provider/profile`);
  return data;
}

export async function submitProviderOnboarding(input: SubmitOnboardingInput): Promise<ProviderProfile> {
  let app = await findVetApplication();
  if (!app) {
    const created = await api.post<{ application: ProviderApplicationWire }>(`${PROVIDERS_API}/applications`, {
      domain: 'VET', provider_type: 'vet', display_name: input.displayName,
    });
    app = created.data.application;
  }
  // The location is only editable while the application is a draft or needs info.
  if (app.state === 'DRAFT' || app.state === 'NEEDS_INFO') {
    const saved = await api.put<{ application: ProviderApplicationWire }>(`${PROVIDERS_API}/applications/${app.id}/location`, {
      address: input.location.address,
      city: input.location.city,
      state: input.location.state,
      lat: input.location.lat,
      lng: input.location.lng,
    });
    app = saved.data.application;
  }
  if (input.licenceFile) {
    const storageKey = await uploadProviderCredential(app.id, input.licenceFile);
    await addProviderCredential(app.id, { credType: 'VCN', referenceNo: input.vcnLicenseNo, storageKey });
  }
  if (app.state === 'DRAFT' || app.state === 'NEEDS_INFO') {
    const submitted = await api.post<{ application: ProviderApplicationWire }>(`${PROVIDERS_API}/applications/${app.id}/submit`, {});
    app = submitted.data.application;
  }
  return {
    status: mapApplicationState(app.state),
    applicationId: app.id,
    displayName: app.display_name,
    vcnLicenseNo: input.vcnLicenseNo,
    clinicName: input.clinicName,
    bio: '', consultFeeKobo: 0, homeVisitFeeKobo: 0, types: [], species: [],
    credential: { authority: 'VCN', licenseNo: input.vcnLicenseNo, status: 'pending' },
  };
}

// Member submits credentials + documents + consent; ops confirms out-of-band.
// The member only ever receives a coarse stage — no register/match detail.
// The credential endpoints reply in snake_case with a coarse stage only.
interface VcnStatusWire { application_id?: string; capability?: string; stage?: VcnStatus['stage'] }

function mapVcnStatus(w: VcnStatusWire, fallbackApplicationId: string): VcnStatus {
  return {
    applicationId: w.application_id ?? fallbackApplicationId,
    capability: w.capability ?? 'vet',
    stage: w.stage ?? 'pending_review',
  };
}

export async function submitVcnVerification(input: SubmitVcnInput): Promise<VcnStatus> {
  const { data } = await api.post<VcnStatusWire>(`${VET_API}/verification/submit`, {
    application_id: input.applicationId,
    reg_number: input.regNumber,
    full_name: input.fullName,
    dob: input.dob,
    consent: input.consent,
    docs: input.docs.map((d) => ({ type: d.type, storage_key: d.storageKey })),
  });
  return mapVcnStatus(data, input.applicationId);
}

export async function getVcnStatus(applicationId: string): Promise<VcnStatus> {
  const { data } = await api.get<VcnStatusWire>(`${VET_API}/verification/status`, {
    params: { application_id: applicationId },
  });
  return mapVcnStatus(data, applicationId);
}

export async function getVcnDocUrl(docId: string): Promise<{ url: string }> {
  const { data } = await api.get<{ url: string }>(`${VET_API}/verification/documents/${docId}/url`);
  return data;
}

export async function updateProviderProfile(input: UpdateProfileInput): Promise<ProviderProfile> {
  const { data } = await api.put<ProviderProfile>(`${VET_API}/provider/profile`, input);
  return data;
}

export async function getProviderAvailability(): Promise<ProviderAvailabilityBlock[]> {
  const { data } = await api.get<{ blocks?: ProviderAvailabilityBlock[] }>(`${VET_API}/provider/availability`);
  return data.blocks ?? [];
}

export async function setProviderAvailability(blocks: ProviderAvailabilityBlock[]): Promise<ProviderAvailabilityBlock[]> {
  const { data } = await api.put<{ blocks?: ProviderAvailabilityBlock[] }>(`${VET_API}/provider/availability`, { blocks });
  return data.blocks ?? [];
}

export async function getProviderAppointments(): Promise<ProviderAppointmentRow[]> {
  const { data } = await api.get<ProviderAppointmentRow[]>(`${VET_API}/provider/appointments`);
  return data;
}

export async function decideAppointment(input: DecisionInput): Promise<{ ok: true; status: string }> {
  const { data } = await api.post<{ ok: true; status: string }>(
    `${VET_API}/provider/appointments/${input.appointmentId}/decision`,
    input,
  );
  return data;
}

export async function getPetChart(petId: string): Promise<PetChart> {
  const { data } = await api.get<PetChart>(`${VET_API}/provider/pets/${petId}/chart`);
  return data;
}

export async function saveSoapNote(input: SaveSoapInput): Promise<{ ok: true; summaryId: string }> {
  const { data } = await api.post<{ ok: true; summaryId: string }>(
    `${VET_API}/provider/appointments/${input.appointmentId}/soap`,
    input,
  );
  return data;
}

export async function issuePrescription(input: IssueRxInput): Promise<EPrescription> {
  const { data } = await api.post<EPrescription>(`${VET_API}/provider/prescriptions`, input);
  return data;
}

export async function orderLabForPet(input: OrderLabInput): Promise<{ ok: true; labOrderId: string }> {
  const { data } = await api.post<{ ok: true; labOrderId: string }>(`${VET_API}/provider/lab-orders`, input);
  return data;
}

export async function createReferral(input: ReferralInput): Promise<{ ok: true }> {
  await api.post(`${VET_API}/provider/referrals`, input);
  return { ok: true };
}

export async function getProviderEarnings(): Promise<ProviderEarnings> {
  const { data } = await api.get<ProviderEarnings>(`${VET_API}/provider/earnings`);
  return data;
}

export async function requestPayout(amountKobo: number, idempotencyKey: string): Promise<{ ok: true }> {
  await api.post(`${VET_API}/provider/payouts`, { amountKobo }, { headers: { 'Idempotency-Key': idempotencyKey } });
  return { ok: true };
}

export async function getProviderReviews(): Promise<VetReview[]> {
  const { data } = await api.get<VetReview[]>(`${VET_API}/provider/reviews`);
  return data;
}

export async function getProviderHomeNav(appointmentId: string): Promise<ProviderHomeNav> {
  const { data } = await api.get<ProviderHomeNav>(`${VET_API}/provider/appointments/${appointmentId}/nav`);
  return data;
}

export { newIdempotencyKey } from './constants';
