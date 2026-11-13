// Pure wire↔domain mapping for the doctor module. No components, no I/O — only
// features/providerPortal/portals.ts style logic, so node:test can run it. The
// avatar rule below reaches features/telemedicine/mapping, which pulls
// react-native through constants/tokens, so run this file under
// `--import ./tests/unit/register-ts-paths.mjs` (npm run test:doctor-mapping).

import { avatarColorFor, initialsFromName, mapConsultType, mapStatus, referenceFor } from '@/features/telemedicine/mapping';
import type {
  QueuePriority, AppointmentBilling, AppointmentRequest, AppointmentRequestStatus, PlatformAnnouncement,
} from '@/types/doctor.batch1';
import type { DoctorAppointment, PatientSummary } from '@/types/doctor';
import type { UpdateDoctorSettingsInput } from '@/types/doctor';

/** The body GET /api/v1/doctor/announcements/latest writes (handler_tail2.go GetLatestAnnouncement). */
export interface AnnouncementWire {
  announcement?: PlatformAnnouncement | null;
}

/**
 * The latest platform announcement, or null when there is none.
 *
 * null, never undefined, is the contract: react-query rejects `undefined` query
 * data outright, and the backend answers `{"announcement": null}` for every
 * doctor because no announcement table is wired yet (service_tail2.go
 * GetLatestAnnouncement is a derived empty projection).
 */
export function mapAnnouncementWire(wire: AnnouncementWire): PlatformAnnouncement | null {
  return wire.announcement ?? null;
}

/**
 * A read's "no row" answer, in the one shape react-query accepts.
 *
 * `Array.prototype.find` misses with undefined and a 200-with-null body misses
 * with null; query-core rejects the first and stores the second. Detail reads
 * go through here so a miss is always null.
 */
export function orNull<T>(found: T | null | undefined): T | null {
  return found ?? null;
}

/**
 * The PUT /settings request body: the patch lifted one level, no wrapper.
 *
 * Go binds a flat `UpdateSettingsRequest` (model.go) and `UpsertSettings`
 * (repository.go) COALESCEs per top-level column, so posting the client's
 * `{ settings: …, idempotencyKey }` input binds nothing and the write silently
 * returns 200 without changing a column. The key belongs in the Idempotency-Key
 * header, which `doctorPut` sets from its third argument.
 */
export function mapSettingsUpdateBody(input: UpdateDoctorSettingsInput): UpdateDoctorSettingsInput['settings'] {
  return { ...input.settings };
}

/**
 * The header photo's `uri`, or undefined when there is nothing renderable.
 *
 * `doctor_profiles.avatar_url` holds an R2 object key and the bucket is private,
 * so GET /doctor/profile signs it into a short-lived URL (internal/doctor
 * handler.go resolveMedia) — but it fails open to the key when R2 is not
 * configured. A key passed to `<Image source={{uri}}>` resolves against the app
 * origin and 404s with no fallback, so only an absolute URL is a source here;
 * anything else leaves the avatar to its initials.
 */
export function mapAvatarUri(avatarUrl?: string | null): string | undefined {
  if (!avatarUrl) return undefined;
  return avatarUrl.includes('://') ? avatarUrl : undefined;
}

/**
 * The three props a provider header avatar takes, from whatever the row gives.
 *
 * `initials` and `avatarColor` are declared on DoctorProfile but have no column
 * in model.go Profile, so GET /doctor/profile answers neither — read straight
 * off the wire, the header renders an empty circle beside the doctor's name.
 * They are optional here on purpose: the demo fixture supplies them, the server
 * does not, and either way the screen gets a real value. Deriving the same two
 * from name and id is what mapLiveDoctor does for the patient-facing cards, so
 * one doctor keeps one face across both.
 */
export function mapHeaderAvatar(profile: {
  id:           string;
  name:         string;
  initials?:    string;
  avatarColor?: string;
  avatarUrl?:   string | null;
}): { uri: string | undefined; initials: string; color: string } {
  return {
    uri: mapAvatarUri(profile.avatarUrl),
    initials: profile.initials || initialsFromName(profile.name),
    color: profile.avatarColor || avatarColorFor(profile.id),
  };
}

// ── The appointment plane ────────────────────────────────────────────────────
// backend/internal/doctor answers these from public.appointments — the table a
// patient's booking actually writes — as model.go Appointment. That is real
// data with no presentation in it: no initials, no avatar colour, a `ref` the
// booking table leaves NULL, and a `consultType` the inbox indexes straight into
// `Record<ConsultType, LucideIcon>`. So the server stays free of brand hexes
// (they are RN theme tokens) and the client finishes the row here, with the same
// helpers the patient-facing cards use, so one patient keeps one face in both
// planes. `@/features/doctor/api` passes every appointment through this.

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** model.go Appointment's `patient` jsonb, as the Go read builds it. */
export interface AppointmentPatientWire {
  id?:     string | null;
  name?:   string | null;
  age?:    number  | null;
  gender?: string | null;
}

export interface AppointmentWire {
  id:          string;
  ref?:        string | null;
  patient?:    AppointmentPatientWire | null;
  consultType?: string | null;
  status?:     string | null;
  slotDate?:   string | null;
  slotTime?:   string | null;
  feeKobo?:    number | null;
  reason?:     string | null;
  isHmo?:      boolean | null;
  hmoProvider?: string | null;
  createdAt?:  string | null;
}

export interface AppointmentRequestWire {
  id:              string;
  appointmentId?:  string | null;
  status?:         string | null;
  priority?:       string | null;
  billing?:        string | null;
  requestedAt?:    string | null;
  patientNote?:    string | null;
  rejectionReason?: string | null;
  proposedSlotDate?: string | null;
  proposedSlotTime?: string | null;
  appointment?:    AppointmentWire | null;
}

function genderFrom(raw: unknown): PatientSummary['gender'] {
  const g = str(raw).toLowerCase();
  if (g === 'male' || g === 'female') return g;
  return 'other';
}

/**
 * A live appointment row, finished for the card and the detail screen.
 *
 * `slotDate`/`slotTime` are copied, never recomputed: Go formats them in the
 * DOCTOR'S timezone (doctor_availability.timezone), and rebuilding either from a
 * device Date would shift the day for a doctor whose phone is on another offset.
 */
export function mapAppointmentWire(wire: AppointmentWire): DoctorAppointment {
  const patient = wire.patient ?? {};
  const name = str(patient.name);
  const id = str(patient.id);
  return {
    id:          wire.id,
    ref:         str(wire.ref) || referenceFor(wire.id),
    patient: {
      id,
      name,
      initials:    initialsFromName(name),
      avatarColor: avatarColorFor(id),
      age:    num(patient.age),
      gender: genderFrom(patient.gender),
    },
    consultType: mapConsultType(wire.consultType),
    status:      mapStatus(wire.status),
    slotDate:    str(wire.slotDate),
    slotTime:    str(wire.slotTime),
    feeKobo:     num(wire.feeKobo),
    createdAt:   str(wire.createdAt),
    reason:      str(wire.reason) || undefined,
    isHmo:       wire.isHmo === true,
    hmoProvider: str(wire.hmoProvider) || undefined,
  };
}

function priorityFrom(raw: unknown): QueuePriority {
  const p = str(raw);
  if (p === 'emergency' || p === 'high' || p === 'normal' || p === 'low') return p;
  // appointments has no triage column, so anything unanswered is the untriaged
  // value — QUEUE_PRIORITY_LABELS[r.priority] would otherwise render nothing.
  return 'normal';
}

function billingFrom(raw: unknown): AppointmentBilling {
  const b = str(raw);
  if (b === 'hmo' || b === 'paid' || b === 'free_follow_up') return b;
  return 'paid';
}

function requestStatusFrom(raw: unknown): AppointmentRequestStatus {
  const s = str(raw);
  if (s === 'accepted' || s === 'rejected' || s === 'reschedule_requested') return s;
  return 'pending';
}

/**
 * A pending decision, with its appointment mapped the same way — the inbox
 * renders `r.appointment.patient` and `r.appointment.consultType` off the nest,
 * so leaving it raw is the crash the old flat row would have caused.
 */
export function mapRequestWire(wire: AppointmentRequestWire): AppointmentRequest {
  return {
    id:           wire.id,
    appointment:  mapAppointmentWire(wire.appointment ?? { id: str(wire.appointmentId) }),
    status:       requestStatusFrom(wire.status),
    requestedAt:  str(wire.requestedAt),
    billing:      billingFrom(wire.billing),
    priority:     priorityFrom(wire.priority),
    patientNote:  str(wire.patientNote) || undefined,
    rejectionReason: str(wire.rejectionReason) || undefined,
    proposedSlotDate: str(wire.proposedSlotDate) || undefined,
    proposedSlotTime: str(wire.proposedSlotTime) || undefined,
  };
}
