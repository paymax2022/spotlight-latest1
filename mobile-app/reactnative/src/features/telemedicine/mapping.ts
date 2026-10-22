// ── Telemedicine — live payload → screen-shape mapping ───────────────────────
// The Go service (backend/internal/telemedicine) answers snake_case rows whose
// fields do not line up with the app's display types: ONE `specialty` slug where
// the cards want a `specialties` label list, no initials, no avatar colour, no
// next-available, `status: "booked"` where the UI says `upcoming`. The patient
// screens were written against the demo fixtures and `mapDoctorMoney` only ever
// carried the money half, so the first live row crashed the list on
// `doctor.specialties.join` — an undefined read, not an empty one.
//
// Every value below is either read straight off the server payload or derived
// deterministically from a value in it. Nothing here invents a rating, a fee, a
// review or a date.
import { Colors } from '@/constants/tokens';
import { INTAKE_RED_FLAG_COPY } from '@/features/health/constants/health.constants';
import { mapAppointmentMoney, mapDoctorMoney } from './pricing';
import type {
  Appointment,
  BookAppointmentResult,
  ConsultStatus,
  ConsultType,
  Doctor,
  DoctorSummary,
  Prescription,
  PrescriptionItem,
  Review,
  Specialty,
  VisitSummary,
} from '@/types/telemedicine';
import type {
  IntakeResponseValues,
  PreConsultIntake,
  RedFlagResult,
  SubmitIntakeResult,
} from '@/features/health/types';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const bool = (v: unknown): boolean => v === true;

/** Titles that must not become the avatar's initials ("Dr Amaka Obi" → AO, not DA). */
const HONORIFIC = /^(dr|dr\.|prof|prof\.|mr|mrs|ms|engr|chief|asau)\.?$/i;

/** Avatar fills, cycled by id so one doctor keeps one colour across screens. */
const AVATAR_COLORS = [
  Colors.primary, '#EF4444', '#F59E0B', Colors.secondary,
  '#A855F7', '#EC4899', Colors.teal, '#16A34A',
];

/** Tile tints for the specialty grid, in the same accent/bg idiom as the tokens. */
const SPECIALTY_TINTS = [
  { accent: Colors.primary,      bg: Colors.iconBgPurple },
  { accent: '#EF4444',           bg: 'rgba(239,68,68,0.08)' },
  { accent: '#F59E0B',           bg: 'rgba(245,158,11,0.10)' },
  { accent: Colors.secondary,    bg: Colors.iconBgBlue },
  { accent: '#A855F7',           bg: 'rgba(168,85,247,0.08)' },
  { accent: '#EC4899',           bg: 'rgba(236,72,153,0.08)' },
  { accent: Colors.teal,         bg: Colors.iconBgTeal },
  { accent: '#16A34A',           bg: 'rgba(22,163,74,0.08)' },
];

/**
 * The `doctor_specialties.icon` column holds ionicons names (`person-outline`),
 * which `SpecialtyChip` cannot resolve from `lucide-react-native`. Keyed by slug,
 * because that is the stable identity the table exposes.
 */
const SPECIALTY_ICONS: Record<string, string> = {
  general:       'Stethoscope',
  paediatrics:   'Baby',
  mental_health: 'Brain',
  womens_health: 'Flower2',
  cardiology:    'HeartPulse',
  dermatology:   'Sparkles',
  nutrition:     'Apple',
  eye_care:      'Eye',
  orthopedic:    'Activity',
  dentistry:     'Smile',
  neurology:     'Activity',
  oncology:      'Shield',
  veterinary:    'PawPrint',
  pharmacy:      'Pill',
};

/** Stable 32-bit string hash, so an id maps to the same tint on every render. */
function hash(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h;
}

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter((p) => p && !HONORIFIC.test(p));
  if (parts.length === 0) return 'Dr';
  const head = parts[0].charAt(0);
  const tail = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
  return (head + tail).toUpperCase();
}

export function avatarColorFor(seed: string): string {
  return AVATAR_COLORS[hash(seed) % AVATAR_COLORS.length];
}

/** `mental_health` → `Mental Health`, for the label lines the server leaves to the client. */
export function specialtyLabel(slug: string): string {
  return slug
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * The card's "next available" line. There is no next-slot column on the doctor
 * row, so the honest live value is availability itself — the booking screen reads
 * real slots from `/doctors/:id/availability` before anyone pays.
 */
function availabilityLabel(online: boolean, available: boolean): string {
  if (online) return 'Online now';
  if (available) return 'Accepting bookings';
  return 'Not accepting bookings';
}

/** Server `booked` is the UI's `upcoming`; the other lifecycle names match. */
function mapStatus(raw: unknown): ConsultStatus {
  switch (str(raw)) {
    case 'booked':        return 'upcoming';
    case 'confirmed':     return 'confirmed';
    case 'in_progress':   return 'in_progress';
    case 'completed':     return 'completed';
    case 'cancelled':     return 'cancelled';
    default:              return 'upcoming';
  }
}

function mapConsultType(raw: unknown): ConsultType {
  const t = str(raw);
  if (t === 'audio' || t === 'chat') return t;
  return 'video';
}

/** `scheduled_at` → the local `slotDate`/`slotTime` pair the slot screens trade in. */
function slotParts(rawISO: string): { slotDate: string; slotTime: string } {
  const d = new Date(rawISO);
  if (!rawISO || Number.isNaN(d.getTime())) return { slotDate: '', slotTime: '' };
  const pad = (n: number) => String(n).padStart(2, '0');
  const hour24 = d.getHours();
  const suffix = hour24 < 12 ? 'AM' : 'PM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return {
    slotDate: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    slotTime: `${pad(hour12)}:${pad(d.getMinutes())} ${suffix}`,
  };
}

/**
 * A doctor's reference is shown on the appointment card so a patient can quote it
 * to support. The server has no reference column — this is the appointment id's
 * own prefix, never a number from thin air.
 */
export function referenceFor(id: string): string {
  return `TM-${id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

export function mapLiveSpecialty(raw: unknown): Specialty {
  const r = (raw ?? {}) as Record<string, unknown>;
  // `id` is a UUID; the list endpoint filters on `specialty_id` against
  // `doctors.specialty`, which stores the SLUG. Keying a chip by the UUID would
  // silently return an empty doctor list for every specialty.
  const slug = str(r.slug) || str(r.id);
  const tint = SPECIALTY_TINTS[hash(slug) % SPECIALTY_TINTS.length];
  return {
    id:          slug,
    name:        str(r.name) || specialtyLabel(slug),
    icon:        SPECIALTY_ICONS[slug] ?? 'Stethoscope',
    accent:      tint.accent,
    bg:          tint.bg,
    doctorCount: num(r.doctor_count),
  };
}

export function mapLiveDoctor(raw: unknown): Doctor {
  const r = (raw ?? {}) as Record<string, unknown>;
  const slug = str(r.specialty);
  const sub = str(r.sub_specialty);
  const degrees = Array.isArray(r.education)
    ? r.education.map((e) => str((e as Record<string, unknown>)?.degree)).filter(Boolean)
    : [];
  const name = str(r.name);
  return {
    ...mapDoctorMoney(r),
    id:              str(r.id),
    name,
    title:           degrees.join(', '),
    specialtyId:     slug,
    specialties:     [specialtyLabel(slug), sub].filter(Boolean),
    bio:             str(r.bio) || str(r.about),
    initials:        initialsFromName(name),
    avatarColor:     avatarColorFor(str(r.id)),
    rating:          num(r.rating),
    reviewCount:     num(r.review_count),
    yearsExperience: num(r.experience_years),
    // No languages column on `doctors` yet — an empty list renders "0", not a guess.
    languages:       [],
    isOnline:        bool(r.is_online),
    nextAvailable:   availabilityLabel(bool(r.is_online), bool(r.is_available)),
    featured:        bool(r.is_featured),
  };
}

function mapDoctorSummary(r: Record<string, unknown>): DoctorSummary {
  const name = str(r.doctor_name);
  const slug = str(r.doctor_specialty);
  const id = str(r.doctor_id);
  return {
    id,
    name,
    title:       '',
    initials:    initialsFromName(name),
    avatarColor: avatarColorFor(id),
    specialties: slug ? [specialtyLabel(slug)] : [],
  };
}

export function mapLiveAppointment(raw: unknown): Appointment {
  const r = (raw ?? {}) as Record<string, unknown>;
  const { slotDate, slotTime } = slotParts(str(r.scheduled_at));
  const created = str(r.created_at);
  return {
    ...mapAppointmentMoney(r),
    id:          str(r.id),
    ref:         referenceFor(str(r.id)),
    doctor:      mapDoctorSummary(r),
    consultType: mapConsultType(r.consultation_type),
    status:      mapStatus(r.status),
    slotDate,
    slotTime,
    createdAt:   created,
    reason:      str(r.notes),
  };
}

/** POST /appointments answers the full appointment row, not a booking result. */
export function mapLiveBookingResult(raw: unknown): BookAppointmentResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const id = str(r.id) || str(r.appointment_id);
  return { appointmentId: id, ref: referenceFor(id), status: mapStatus(r.status) };
}

export function mapLiveReview(raw: unknown): Review {
  const r = (raw ?? {} as Record<string, unknown>) as Record<string, unknown>;
  return {
    id:            str(r.id),
    appointmentId: str(r.appointment_id),
    rating:        num(r.rating),
    comment:       str(r.comment),
    createdAt:     str(r.created_at),
  };
}

/**
 * GET /appointments/:id/prescription. The server row is snake_case and its drug
 * list may arrive structured (a doctor-console prescription bridges in with
 * `items[]`) or as the legacy free-text `medications` column; either way the
 * card needs `items[]`, so the text is split line-wise rather than guessed at.
 */
export function mapLivePrescription(raw: unknown): Prescription {
  const r = (raw ?? {}) as Record<string, unknown>;
  const structured = Array.isArray(r.items) ? (r.items as Record<string, unknown>[]) : [];
  const items: PrescriptionItem[] = structured.length > 0
    ? structured.map((it) => ({
        name:      str(it.name),
        dosage:    str(it.dosage),
        frequency: str(it.frequency),
        duration:  str(it.duration),
      })).filter((it) => it.name)
    : str(r.medications)
        .split(/\n|;/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((name) => ({ name, dosage: '', frequency: '', duration: '' }));
  return {
    id:            str(r.id),
    appointmentId: str(r.appointment_id),
    doctorName:    str(r.doctor_name) || 'Your doctor',
    issuedAt:      str(r.issued_at),
    items,
  };
}

/** GET /appointments/:id/summary — snake_case row → the camelCase screen shape. */
export function mapLiveVisitSummary(raw: unknown): VisitSummary {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id:            str(r.id),
    appointmentId: str(r.appointment_id),
    diagnosis:     str(r.diagnosis),
    notes:         str(r.notes),
    followUp:      str(r.follow_up) || undefined,
  };
}

/** One line of the bridged consult chat, as the patient app renders it. */
export interface LiveChatMessage {
  id: string;
  /** 'patient' | 'doctor' — the author column, never trusted from the client. */
  author: 'patient' | 'doctor';
  body: string;
  createdAt: string;
}

export function mapLiveChatMessages(raw: unknown): LiveChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((m) => {
    const r = (m ?? {}) as Record<string, unknown>;
    return {
      id: str(r.id),
      author: str(r.author) === 'doctor' ? ('doctor' as const) : ('patient' as const),
      body: str(r.body),
      createdAt: str(r.created_at),
    };
  });
}

/**
 * The server's captured safety outcome → the interstitial's own shape. The
 * wording is the app's (single-sourced in INTAKE_RED_FLAG_COPY), never the
 * server's, so the copy stays reviewable; the server decides only WHETHER and
 * WHICH ROUTING, from the structured answers.
 */
export function mapLiveRedFlag(raw: unknown): RedFlagResult | undefined {
  const routing = str((raw as Record<string, unknown> | null)?.routing);
  if (routing !== 'EMERGENCY' && routing !== 'URGENT_CARE' && routing !== 'CRISIS') return undefined;
  return {
    severity: routing === 'URGENT_CARE' ? 'urgent' : 'emergency',
    routing,
    guidance: INTAKE_RED_FLAG_COPY[routing],
  };
}

/** GET/PUT/POST /appointments/:id/intake* answer this row. */
export interface LiveIntake {
  intake: PreConsultIntake;
  redFlag?: RedFlagResult;
  /** False on a doctor read — only the patient may write their own answers. */
  patientOwns: boolean;
}

export function mapLiveIntake(raw: unknown): LiveIntake {
  const r = (raw ?? {}) as Record<string, unknown>;
  const answers = (r.answers ?? {}) as IntakeResponseValues;
  return {
    intake: {
      appointmentId: str(r.appointment_id),
      schemaId: str(r.schema_id),
      schemaVersion: num(r.schema_version),
      status: str(r.status) === 'SUBMITTED' ? 'SUBMITTED' : 'DRAFT',
      answers: answers && typeof answers === 'object' ? answers : {},
      consentVersion: str(r.consent_version) || undefined,
      submittedAt: str(r.submitted_at) || undefined,
      updatedAt: str(r.updated_at) || undefined,
      doctorName: str(r.doctor_name) || undefined,
    },
    redFlag: mapLiveRedFlag(r.red_flag),
    patientOwns: bool(r.patient_owns),
  };
}

/** The wizard trades in { status, red_flag, intake }; the server answers one row. */
export function mapLiveIntakeSubmit(raw: unknown): SubmitIntakeResult {
  const { intake, redFlag } = mapLiveIntake(raw);
  return { status: intake.status, red_flag: redFlag, intake };
}
