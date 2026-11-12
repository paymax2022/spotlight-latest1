// Pure wire→domain mapping for the veterinary reads: the GET /vet/dashboard
// screen model and the pet / consult reads behind app/(doctor)/vet/pet/[id]/*.
// Deliberately free of React Native imports so node:test can run it, like
// features/doctor/batch6Wire.ts.

import type {
  PetDrugCategory,
  PetPrescription,
  PetPrescriptionItem,
  PetProfile,
  PetSpecies,
  PetVaccination,
  VetDashboard,
  VetProfileSummary,
} from '@/types/doctor.phase3';
import type {
  IssuedPetPrescription,
  PetGrowthHistory,
  PetGrowthPoint,
  PetHealthRecord,
  PetVaccinationRecommendation,
  PetVaccinationReminder,
  PetVaccinationUrgency,
} from '@/types/doctor.batch5';
import { PET_SPECIES_OPTIONS } from '@/features/doctor/constants/phase3';

/** The subset of profile_draft (doctor_vet_profiles.profile_draft jsonb) the wizard writes. */
export interface VetProfileDraftWire {
  personalInfo?:    { title?: string | null; firstName?: string | null; lastName?: string | null } | null;
  affiliations?:    { name?: string | null; isPrimary?: boolean }[] | null;
  speciesTreated?:  string[] | null;
  yearsExperience?: number | null;
  licence?:         { licenceNumber?: string | null } | null;
}

/** public.doctor_vet_profiles as service_vet.go VetProfile marshals it. */
export interface VetProfileWire {
  id?:             string;
  vetModeEnabled?: boolean;
  licenceNumber?:  string | null;
  profileDraft?:   VetProfileDraftWire | null;
}

/** The body GET /vet/dashboard writes: `{vet, pets}` from VetDashboard (service_vet.go:501). */
export interface VetDashboardWire {
  vet?: VetProfileWire | null;
}

// The species the dashboard type will accept; anything else the draft holds is
// dropped rather than typed as a lie.
const PET_SPECIES_VALUES = new Set<PetSpecies>(PET_SPECIES_OPTIONS.map((o) => o.value));

const clean = (value: string | null | undefined): string => (value ?? '').trim();

/** "Dr. Amaka Obi" from the personal-info step; '' when that step was never saved. */
function displayName(draft: VetProfileDraftWire): string {
  const personal = draft.personalInfo ?? {};
  return [personal.title, personal.firstName, personal.lastName].map(clean).filter(Boolean).join(' ');
}

/** Leading letters of the given and family names, which is what the avatar circle wants. */
function displayInitials(draft: VetProfileDraftWire): string {
  const personal = draft.personalInfo ?? {};
  return [personal.firstName, personal.lastName]
    .map(clean)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase())
    .join('');
}

/** The vet's own clinic label, then the first affiliation they entered. */
function clinicName(draft: VetProfileDraftWire): string {
  const affiliations = draft.affiliations ?? [];
  return clean(affiliations.find((a) => a.isPrimary)?.name ?? affiliations[0]?.name);
}

/**
 * The vet dashboard, built from the profile row and draft the backend returns.
 *
 * `GetVetDashboard` composites `doctor_vet_profiles` and `doctor_pets` and
 * swallows GetVetProfile's ErrNotFound, so a vet without a profile row — every
 * local account until they toggle vet mode — answers `{"vet":null,"pets":[]}`.
 * The old cast let that through the screen's isLoading/isError/!data guards and
 * `dashboard.vet.name` threw, so `vet` is always an object here.
 *
 * What the projection genuinely supplies is mapped: the toggle and licence
 * columns, plus the name, clinic, species and experience the profile wizard
 * patches into profile_draft in this same body. What it does not have stays
 * empty or zero — `todaysConsults`, `petsSeenToday`, `pendingLabs` and
 * `earningsTodayKobo` have no backend read at all (ListVetAppointments answers
 * `[]`, and no query sums a vet's day), so the tiles render their empty states
 * instead of the DEMO_* rows a live build must never show.
 */
export function mapVetDashboardWire(wire: VetDashboardWire): VetDashboard {
  const profile = wire.vet ?? {};
  const draft = profile.profileDraft ?? {};

  const vet: VetProfileSummary = {
    doctorId: profile.id ?? '',
    name: displayName(draft),
    initials: displayInitials(draft),
    // The wire carries no avatar colour and no screen on this path reads it.
    avatarColor: '',
    licenceNumber: clean(profile.licenceNumber) || clean(draft.licence?.licenceNumber),
    clinicName: clinicName(draft),
    speciesTreated: (draft.speciesTreated ?? []).filter((s): s is PetSpecies => PET_SPECIES_VALUES.has(s as PetSpecies)),
    yearsExperience: draft.yearsExperience ?? 0,
    // No vet reviews table backs this read, so the hero shows an unrated profile.
    rating: 0,
    reviewCount: 0,
    vetModeEnabled: profile.vetModeEnabled ?? false,
  };

  return {
    vet,
    todaysConsults: [],
    petsSeenToday: 0,
    pendingLabs: 0,
    earningsTodayKobo: 0,
  };
}

// ─── the pet / consult reads ─────────────────────────────────────────────────
//
// Same bug class one level down. `GetPet` answers the `doctor_pets` row (model
// `Pet`, service_vet.go:507) — id, userId, ownerRef, name, species, breed and
// two free-form jsonb columns — while `src/api/doctor.phase3.api.ts` casts that
// body straight into `PetProfile`, which promises a nested `owner` object and a
// dozen scalars the table does not have. The call returns 200, so every screen's
// `isLoading / isError / !data` guard passes and the first nested read throws.
//
// Two backend situations, two honest answers:
//   - a real row with different keys → map the columns Go projects; what the row
//     does not carry stays empty or zero.
//   - no backing table at all → the handler writes `json.RawMessage("{}")`
//     (GetPetChatThread, GetPetSoapNote, GetVetConsultSummary), so there is
//     nothing to map and the caller returns undefined instead of a hollow object.

/** The subset of doctor_pets.profile jsonb the pet form fills in. */
export interface PetDetailDraftWire {
  sex?:               string | null;
  neutered?:          boolean | null;
  ageMonths?:         number | null;
  weightKg?:          number | null;
  microchipId?:       string | null;
  allergies?:         string[] | null;
  chronicConditions?: string[] | null;
  currentMedications?: string[] | null;
  symptoms?:          string[] | null;
}

/** public.doctor_pets as service_vet.go Pet marshals it. */
export interface PetWire {
  id?:            string;
  ownerRef?:      string | null;
  name?:          string | null;
  species?:       string | null;
  breed?:         string | null;
  profile?:       PetDetailDraftWire | null;
  growthHistory?: unknown;
}

/** public.doctor_pet_vaccinations as service_vet.go PetVaccination marshals it. */
export interface PetVaccinationWire {
  id?:             string;
  petId?:          string;
  vaccine?:        string | null;
  dueAt?:          string | null;
  administeredAt?: string | null;
  reminderSet?:    boolean;
}

/** The body GET /vet/pets/{petId}/growth writes (service_vet.go:529 PetGrowth). */
export interface PetGrowthWire {
  petId?:         string;
  growthHistory?: unknown;
}

/** The body GET /vet/pets/{petId}/health-record writes (service_vet.go:521). */
export interface PetHealthRecordWire {
  pet?:          PetWire | null;
  vaccinations?: PetVaccinationWire[] | null;
  labOrders?:    { id?: string }[] | null;
}

/** One growth_history jsonb element — RecordPetGrowth appends the posted body verbatim. */
export interface GrowthPointWire {
  date?:      string | null;
  weightKg?:  number | null;
  ageMonths?: number | null;
  note?:      string | null;
}

/** public.doctor_pet_prescriptions as service_vet.go PetPrescription marshals it. */
export interface PetPrescriptionWire {
  id?:       string;
  petId?:    string | null;
  ref?:      string | null;
  status?:   string;
  items?:    unknown;
  issuedAt?: string | null;
}

/** One doctor_pet_prescriptions.items jsonb element. */
export interface PrescriptionItemWire {
  name?:      string | null;
  drugId?:    string | null;
  dosage?:    string | null;
  route?:     string | null;
  frequency?: string | null;
  duration?:  string | null;
  notes?:     string | null;
  category?:  string | null;
  dosageMg?:  number | null;
}

const PET_SEX_VALUES = new Set<PetProfile['sex']>(['male', 'female', 'unknown']);
const PET_RX_STATUS_VALUES = new Set<PetPrescription['status']>(['draft', 'issued', 'dispensed']);
const PET_DRUG_CATEGORIES = new Set<PetDrugCategory>([
  'antibiotic', 'antiparasitic', 'nsaid', 'analgesic', 'vaccine', 'supplement', 'dermatological', 'other',
]);

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const amount = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

const speciesOf = (value: unknown): PetSpecies => {
  const species = text(value) as PetSpecies;
  return PET_SPECIES_VALUES.has(species) ? species : 'other';
};

/** True when an ISO timestamp is in the past; an unparseable date is never overdue. */
function isPast(iso: string): boolean {
  const time = Date.parse(iso);
  return !Number.isNaN(time) && time < Date.now();
}

/**
 * Whether `{}` — the body every no-table vet read writes — means there is no data.
 *
 * Used by the soap-note, chat-thread, call-session and consult-summary reads,
 * whose handlers answer an empty object because no table backs them. Those
 * screens already guard with `!data` / optional chains, so `undefined` is the
 * answer they are written for; an empty object would sail past the guard and
 * throw on the first nested field exactly like the dashboard did.
 */
export function emptyBodyHasNoData(body: unknown): boolean {
  if (body === null || body === undefined) return true;
  if (Array.isArray(body)) return body.length === 0;
  if (typeof body === 'object') return Object.keys(body as Record<string, unknown>).length === 0;
  return false;
}

/**
 * The pet profile screen's model, from the `doctor_pets` row alone.
 *
 * `ownerRef` is a bare uuid text — GetPet joins nothing — so the owner card
 * renders the id it has and blank name and phone until a backend read joins the
 * owner. Every scalar the table keeps in the free-form profile column falls back
 * to a zero that the header's arithmetic (`ageMonths / 12`) and the
 * `PET_SPECIES_LABELS[species]` lookup can survive.
 */
export function mapPetProfileWire(wire: PetWire): PetProfile {
  const detail = wire.profile ?? {};
  const name = clean(wire.name);
  const sex = text(detail.sex) as PetProfile['sex'];

  return {
    id: wire.id ?? '',
    name,
    species: speciesOf(wire.species),
    breed: clean(wire.breed),
    sex: PET_SEX_VALUES.has(sex) ? sex : 'unknown',
    neutered: detail.neutered === true,
    ageMonths: amount(detail.ageMonths),
    weightKg: amount(detail.weightKg),
    microchipId: clean(detail.microchipId) || undefined,
    owner: {
      id: clean(wire.ownerRef),
      name: '',
      initials: '',
      avatarColor: '',
      phone: '',
    },
    allergies:         strings(detail.allergies),
    chronicConditions: strings(detail.chronicConditions),
    currentMedications: strings(detail.currentMedications),
    symptoms:          strings(detail.symptoms),
    // GetPet reads only doctor_pets; the doses live on the health-record read.
    vaccinations: [],
    history:      [],
    images:       [],
  };
}

/**
 * The growth trend, from the `growth_history` jsonb the pet row carries.
 *
 * `GetPetGrowth` projects petId plus that column and nothing else, so the header
 * line's pet name and species have no source in this body. The column is a
 * jsonb-append of whatever was posted (`AppendPetGrowth`), so anything that is
 * not a list of points is no trend rather than a crash.
 */
export function mapPetGrowthWire(wire: PetGrowthWire): PetGrowthHistory {
  const raw = wire.growthHistory;
  const points: PetGrowthPoint[] = Array.isArray(raw)
    ? raw.map((entry) => {
        const point = (entry ?? {}) as GrowthPointWire;
        const note = clean(point.note);
        return {
          date: text(point.date),
          weightKg: amount(point.weightKg),
          ageMonths: amount(point.ageMonths),
          ...(note ? { note } : {}),
        };
      })
    : [];

  return { petId: wire.petId ?? '', petName: '', species: 'other', points };
}

/** A dose, renamed from the columns `doctor_pet_vaccinations` actually has. */
export function mapPetVaccinationWire(wire: PetVaccinationWire): PetVaccination {
  const dueAt = text(wire.dueAt);
  const administeredAt = text(wire.administeredAt);
  return {
    id: wire.id ?? '',
    name: clean(wire.vaccine),
    givenAt: administeredAt,
    dueAt: dueAt || undefined,
    // No status column: a dose past its due date is overdue, one already given
    // and not yet due is up to date, and everything else is still outstanding.
    status: dueAt && isPast(dueAt) ? 'overdue' : administeredAt ? 'up_to_date' : 'due',
  };
}

/**
 * A reminder row, from the vaccination the reminders read actually returns.
 *
 * `ListPetVaccinationReminders` answers `doctor_pet_vaccinations` rows — there is
 * no reminders table — and the screen upper-cases `channel`, which no column
 * supplies, so it defaults to the one channel `SetPetVaccinationReminder` can
 * record a preference for. `remindAt` is the dose's own due date.
 */
export function mapPetVaccinationReminderWire(wire: PetVaccinationWire): PetVaccinationReminder {
  return {
    id: wire.id ?? '',
    petId: wire.petId ?? '',
    vaccineName: clean(wire.vaccine),
    remindAt: text(wire.dueAt),
    channel: 'sms',
    enabled: wire.reminderSet === true,
  };
}

/**
 * A recommended dose, from the same vaccination row.
 *
 * `ListPetVaccinationRecommendations` has no catalogue behind it — no urgency,
 * rationale or species columns — but `PetVaccinationRow` looks the urgency up in
 * `URGENCY_TONE` and hands the result to StatusBadge, which reads `TONE[tone].bg`
 * and throws on an unknown key. So urgency is derived from the due date, exactly
 * as the plan's status is, and the two fields with no source stay empty.
 */
export function mapPetVaccinationRecommendationWire(wire: PetVaccinationWire): PetVaccinationRecommendation {
  const dueAt = text(wire.dueAt);
  const administeredAt = text(wire.administeredAt);
  const urgency: PetVaccinationUrgency = !dueAt || administeredAt
    ? 'routine'
    : isPast(dueAt)
      ? 'overdue'
      : 'due_soon';

  return {
    id: wire.id ?? '',
    petId: wire.petId ?? '',
    vaccineName: clean(wire.vaccine),
    forSpecies: [],
    urgency,
    dueDate: dueAt,
    rationale: '',
  };
}

function mapPrescriptionItemWire(raw: unknown): PetPrescriptionItem {
  const item = (raw ?? {}) as PrescriptionItemWire;
  const category = text(item.category) as PetDrugCategory;
  const notes = clean(item.notes);
  const dosageMg = typeof item.dosageMg === 'number' && Number.isFinite(item.dosageMg) ? item.dosageMg : undefined;
  return {
    name: clean(item.name),
    dosage: clean(item.dosage),
    route: clean(item.route),
    frequency: clean(item.frequency),
    duration: clean(item.duration),
    ...(notes ? { notes } : {}),
    category: PET_DRUG_CATEGORIES.has(category) ? category : 'other',
    ...(dosageMg === undefined ? {} : { dosageMg }),
  };
}

/**
 * The issued-prescription screen's wrapper, from the flat row behind it.
 *
 * `GetIssuedPetPrescription` answers `repo.GetPetPrescription` — one
 * `doctor_pet_prescriptions` row, not the `{prescription, pharmacy, sendStatus,
 * audit}` the screen renders through — so `issued.prescription.ref` threw. The
 * row supplies id, ref, petId, status, the items jsonb and issuedAt; pet and
 * owner and vet names, the pharmacy, the send lifecycle and the audit trail have
 * no table behind this read and stay empty. `status` is validated because the
 * column also allows `cancelled`, which the union does not.
 */
export function mapIssuedPetPrescriptionWire(wire: PetPrescriptionWire): IssuedPetPrescription {
  const status = text(wire.status) as PetPrescription['status'];
  const prescription: PetPrescription = {
    id: wire.id ?? '',
    ref: clean(wire.ref),
    petId: clean(wire.petId),
    petName: '',
    petSpecies: 'other',
    ownerName: '',
    vetName: '',
    diagnosis: '',
    items: Array.isArray(wire.items) ? wire.items.map(mapPrescriptionItemWire) : [],
    warnings: [],
    issuedAt: text(wire.issuedAt),
    status: PET_RX_STATUS_VALUES.has(status) ? status : 'draft',
  };

  return { prescription, sendStatus: 'not_sent', audit: [] };
}

/**
 * The health record hub, from the four lists `GetPetHealthRecord` composites.
 *
 * The body is `{pet, vaccinations, prescriptions, labOrders}` — an owner-less
 * pet row plus three arrays — while the screen renders lab results, consults and
 * chronic conditions. Those are not in this projection (a result only exists
 * through GET /vet/lab-orders/{id}/result, and ListVetConsultHistory answers
 * `[]`), so they stay empty and the cards show their "on file: 0" states. The
 * `labOrders` the body does carry are deliberately not relabelled as results.
 */
export function mapPetHealthRecordWire(wire: PetHealthRecordWire): PetHealthRecord {
  const pet = mapPetProfileWire(wire.pet ?? {});
  return {
    pet,
    vaccinations: (wire.vaccinations ?? []).map(mapPetVaccinationWire),
    labResults: [],
    consults: [],
    chronicConditions: pet.chronicConditions,
  };
}
