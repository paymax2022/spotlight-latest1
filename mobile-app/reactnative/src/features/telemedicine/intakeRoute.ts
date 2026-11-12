// Route recovery for an intake link that predates the post-payment flow.
// Deliberately free of React Native imports so node:test can run it, like
// features/telemedicine/mapping.ts.

/** Where the current flow takes a patient to create an appointment. */
export const BOOKING_SCREEN = '/services/telemedicine/doctor/[id]/book';

export interface BookingRoute {
  pathname: string;
  params:   { id: string };
}

const PRE_BOOKING_PREFIX = 'pre-';

/**
 * Intake used to be launched from the doctor profile under a synthetic
 * `pre-<doctorId>` id. The intake is appointment-keyed server-side (ADR-010:
 * health_preconsult_intake references one appointment), so that id can never
 * resolve — GET /intake/appointments/pre-<uuid> answers 400 "appointmentId must
 * be a uuid", which is the contract internal/health/preconsult/handler_uuid_test.go
 * pins. bfa61d6ff moved the wizard after payment and deleted the in-app
 * generators, but links already sent out still open this screen.
 *
 * Returns the booking route such a link must reach — booking is the only way an
 * appointment id comes into existence — or undefined when the id is a real
 * appointment id, or names no doctor to book.
 *
 * Inputs are accepted as `string | string[]` because that is what
 * useLocalSearchParams yields for a repeated query param; .trim() on an array
 * would throw and crash the very screen this rescues.
 */
export function resolveObsoletePrebookingRoute(
  appointmentId?: string | string[],
  doctorIdParam?: string | string[],
): BookingRoute | undefined {
  const first = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v) ?? '';
  const id = first(appointmentId).trim();
  if (!id.startsWith(PRE_BOOKING_PREFIX)) return undefined;

  // The path segment is what the link was opened with, so it wins over the query
  // param rather than silently booking a different doctor.
  const doctorId = id.slice(PRE_BOOKING_PREFIX.length).trim() || first(doctorIdParam).trim();
  if (!doctorId) return undefined;

  return { pathname: BOOKING_SCREEN, params: { id: doctorId } };
}
