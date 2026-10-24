// Pre-booking intake (launched from a doctor profile before any appointment
// exists). The id is the synthetic `pre-<doctorId>`; the server routes are
// behind FEATURE_HEALTH_INTAKE_ENABLED and reject non-UUID appointment ids
// even when mounted, so this whole leg runs client-side: the schema ships with
// the app, answers live in the draft store, and consent gets its own
// SecureStore entry. At payment the draft is transferred to the REAL
// appointment (see book/confirm), so the doctor still receives a server-side
// intake.

import { getSecureItem, setSecureItem } from '@/lib/secureStorage';
import {
  PRECONSULT_SCHEMA,
  CONSENT_VERSION,
  CONSENT_BODY,
  mockEvaluateRedFlag,
} from './api/preconsult.mock';
import { getIntakeDraft, setIntakeDraft } from './intakeDraftStore';
import type {
  ApptIntakeBundle,
  IntakeResponseValues,
  PreConsultIntake,
  SubmitIntakeResult,
} from './types';

export function isPrebookingId(id?: string): id is string {
  return typeof id === 'string' && id.startsWith('pre-');
}

const sanitize = (id: string) => id.replace(/[^A-Za-z0-9._-]/g, '');
const consentKey = (appointmentId: string) => `intake_consent_${sanitize(appointmentId)}`;

async function getAcceptedConsent(appointmentId: string): Promise<string | undefined> {
  const v = await getSecureItem(consentKey(appointmentId));
  return v ?? undefined;
}

async function localIntake(appointmentId: string): Promise<PreConsultIntake> {
  const answers = (await getIntakeDraft(appointmentId)) ?? {};
  const accepted = await getAcceptedConsent(appointmentId);
  return {
    appointmentId,
    schemaId: PRECONSULT_SCHEMA.id,
    schemaVersion: PRECONSULT_SCHEMA.version,
    status: 'DRAFT',
    answers,
    consentVersion: accepted,
  };
}

export async function getLocalIntakeBundle(appointmentId: string): Promise<ApptIntakeBundle> {
  const intake = await localIntake(appointmentId);
  return {
    intake,
    schema: PRECONSULT_SCHEMA,
    prefill: {},
    consent: {
      version: CONSENT_VERSION,
      body: CONSENT_BODY,
      acceptedVersion: intake.consentVersion,
    },
  };
}

export async function saveLocalIntakeDraft(
  appointmentId: string,
  answers: IntakeResponseValues,
  consentVersion?: string,
): Promise<PreConsultIntake> {
  await setIntakeDraft(appointmentId, answers);
  if (consentVersion) await setSecureItem(consentKey(appointmentId), consentVersion);
  return localIntake(appointmentId);
}

export async function submitLocalIntake(
  appointmentId: string,
  answers: IntakeResponseValues,
  consentVersion: string,
): Promise<SubmitIntakeResult> {
  await setIntakeDraft(appointmentId, answers);
  await setSecureItem(consentKey(appointmentId), consentVersion);
  const intake = await localIntake(appointmentId);
  return {
    status: 'SUBMITTED',
    // The same client-side triage the mock uses keeps the red-flag interstitial
    // honest during pre-booking. The authoritative server triage runs again
    // when the answers are transferred to the real appointment at payment.
    red_flag: mockEvaluateRedFlag(answers),
    intake: { ...intake, status: 'SUBMITTED', consentVersion },
  };
}
