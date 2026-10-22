// Pre-consult intake for a TELEMEDICINE appointment — the wizard's whole data
// layer, plus the hooks the patient screens and the doctor console read.
//
// It used to call the health platform's intake routes
// (`/api/finance/health/intake/appointments/{id}`). Those key every row on
// `health_appointments` / `health_providers`, so for a real tele-consult (an
// `appointments` row with a `doctors` row) each call answered 404: the wizard
// could not save, the payment-time transfer silently failed, and
// "Join consultation" stayed disabled forever on a paid booking. The telemedicine
// service now owns the row (telemedicine_intakes, backend/internal/telemedicine/intake.go).
//
// The questionnaire itself stays app-shipped and versioned (PRECONSULT_SCHEMA), so
// what the server holds is the opaque answer map plus the safety outcome — and the
// bundle the wizard renders is assembled here from the row + the shipped schema.
//
// Three id spaces, one surface:
//   `pre-<doctorId>`  triage started before any appointment exists → client-side
//   mock mode         demo fixtures, so loading/saving states still render
//   appointment UUID  the live server row

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { mockAllowed } from '@/config/mockPolicy';
import {
  CONSENT_BODY,
  CONSENT_VERSION,
  PRECONSULT_PREFILL,
  PRECONSULT_SCHEMA,
  mockGetIntake,
  mockSaveDraft,
  mockSubmitIntake,
} from '@/features/health/api/preconsult.mock';
import {
  getLocalIntakeBundle,
  isPrebookingId,
  saveLocalIntakeDraft,
  submitLocalIntake,
} from '@/features/health/prebookingLocal';
import { mapLiveIntake, mapLiveIntakeSubmit } from './mapping';
import type {
  ApptIntakeBundle,
  IntakeResponseValues,
  PreConsultIntake,
  SubmitIntakeResult,
} from '@/features/health/types';

// Same flag as the rest of the telemedicine client: demo fixtures only when the
// env explicitly asks for them (mockPolicy fail-closes in production builds).
const USE_MOCK = mockAllowed(process.env.EXPO_PUBLIC_TELEMEDICINE_USE_MOCK, false);

const BASE = '/api/v1/telemedicine';

// Tele-consult wizard screens read the intake under its own key; the appointment
// card and the consult gate re-read it after every write, so both are invalidated
// together.
export const INTAKE_QUERY_KEY = 'tele-intake';

function unwrap<T>(res: { data?: unknown }): T {
  const body = res.data as { data?: unknown } | undefined;
  return ((body && typeof body === 'object' && 'data' in body ? body.data : body) ?? body) as T;
}

/** The bundle shape the wizard renders, from a row the caller already fetched. */
function bundleFrom(intake: PreConsultIntake, acceptedVersion?: string): ApptIntakeBundle {
  return {
    intake,
    schema: PRECONSULT_SCHEMA,
    prefill: USE_MOCK ? PRECONSULT_PREFILL : {},
    consent: { version: CONSENT_VERSION, body: CONSENT_BODY, acceptedVersion },
  };
}

/**
 * Uploads need somewhere to put the bytes, and the telemedicine service has no
 * presign route or bucket — so the wizard says so instead of accepting a file
 * that would be referenced by a key nothing can read. The step is optional; the
 * notes the doctor reads are the path that works today.
 */
export const INTAKE_UPLOADS_AVAILABLE = false;
export const INTAKE_UPLOAD_UNAVAILABLE_COPY =
  'File uploads are not available yet. Describe anything important below — your doctor reads these answers before the consult.';

/** GET /appointments/:id/intake — the patient's bundle. */
export async function getIntakeBundle(appointmentId: string): Promise<ApptIntakeBundle> {
  if (isPrebookingId(appointmentId)) return getLocalIntakeBundle(appointmentId);
  if (USE_MOCK) {
    const intake = mockGetIntake(appointmentId);
    return bundleFrom(intake, intake.consentVersion);
  }
  const { intake } = mapLiveIntake(
    unwrap<unknown>(await api.get(`${BASE}/appointments/${appointmentId}/intake`)),
  );
  return bundleFrom(intake, intake.consentVersion);
}

/** PUT /appointments/:id/intake/draft — autosave; the patient only. */
export async function saveIntakeDraft(
  appointmentId: string,
  answers: IntakeResponseValues,
  consentVersion?: string,
): Promise<PreConsultIntake> {
  if (isPrebookingId(appointmentId)) return saveLocalIntakeDraft(appointmentId, answers, consentVersion);
  if (USE_MOCK) return mockSaveDraft(appointmentId, answers, consentVersion);
  const { intake } = mapLiveIntake(
    unwrap<unknown>(
      await api.put(`${BASE}/appointments/${appointmentId}/intake/draft`, {
        answers,
        consent_version: consentVersion,
        schema_id: PRECONSULT_SCHEMA.id,
        schema_version: PRECONSULT_SCHEMA.version,
      }),
    ),
  );
  return intake;
}

/**
 * POST /appointments/:id/intake/submit — closes the gate and answers with the
 * server's red-flag routing (decision support; the wording is the app's).
 */
export async function submitIntake(
  appointmentId: string,
  answers: IntakeResponseValues,
  consentVersion: string,
): Promise<SubmitIntakeResult> {
  if (isPrebookingId(appointmentId)) return submitLocalIntake(appointmentId, answers, consentVersion);
  if (USE_MOCK) return mockSubmitIntake(appointmentId, answers, consentVersion);
  return mapLiveIntakeSubmit(
    unwrap<unknown>(
      await api.post(`${BASE}/appointments/${appointmentId}/intake/submit`, {
        answers,
        consent_version: consentVersion,
        schema_id: PRECONSULT_SCHEMA.id,
        schema_version: PRECONSULT_SCHEMA.version,
      }),
    ),
  );
}

export function useApptIntake(appointmentId?: string) {
  return useQuery({
    queryKey: [INTAKE_QUERY_KEY, appointmentId],
    queryFn: () => getIntakeBundle(appointmentId as string),
    enabled: Boolean(appointmentId),
    staleTime: 0,
    // "Not started yet" is a 200 with an empty DRAFT, so an error here is real —
    // but retrying a 401/403 storm per appointment card helps nobody.
    retry: false,
  });
}

/**
 * The intake row as the DOCTOR CONSOLE reads it (the same GET, authorised to the
 * assigned doctor server-side and access-logged with ids only).
 */
export function useAppointmentIntakeRow(appointmentId?: string) {
  return useQuery({
    queryKey: [INTAKE_QUERY_KEY, 'row', appointmentId],
    queryFn: async () =>
      mapLiveIntake(unwrap<unknown>(await api.get(`${BASE}/appointments/${appointmentId}/intake`))),
    enabled: Boolean(appointmentId) && !USE_MOCK && !isPrebookingId(appointmentId),
    retry: false,
  });
}

export function useSaveApptDraft(appointmentId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { answers: IntakeResponseValues; consentVersion?: string }) =>
      saveIntakeDraft(appointmentId as string, args.answers, args.consentVersion),
    onSuccess: () => qc.invalidateQueries({ queryKey: [INTAKE_QUERY_KEY, appointmentId] }),
  });
}

export function useSubmitApptIntake(appointmentId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { answers: IntakeResponseValues; consentVersion: string }) =>
      submitIntake(appointmentId as string, args.answers, args.consentVersion),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [INTAKE_QUERY_KEY, appointmentId] });
      // The longitudinal profile aggregates submitted intakes (M17).
      qc.invalidateQueries({ queryKey: ['health', 'health-profile'] });
      // The gate lives on the appointment: submitting re-enables "Join consultation".
      qc.invalidateQueries({ queryKey: ['tele-appointment', appointmentId] });
      qc.invalidateQueries({ queryKey: ['tele-appointments'] });
    },
  });
}
