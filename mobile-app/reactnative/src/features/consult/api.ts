// HTTP for the shared consult engine plus the one module call each vertical
// owns: opening the session pinned to its appointment. The engine returns
// `{success, session}`; telemedicine wraps its open response in `{data}`; the
// vet returns `{success, session}`. `sessionOf` accepts all three envelopes.

import { api } from '@/api/client';
import type {
  ConsultExtension,
  ConsultJoin,
  ConsultMessage,
  ConsultPackageWire,
  ConsultRtc,
  ConsultSession,
  ConsultVertical,
  PublishConsultPackageInput,
} from './types';

const CONSULT_BASE = '/api/v1/consult';
const TELEMEDICINE_BASE = '/api/v1/telemedicine';
const VET_BASE = '/api/finance/health/vet';

function unwrapData(body: unknown): unknown {
  if (body && typeof body === 'object' && 'data' in body) {
    return (body as { data: unknown }).data;
  }
  return body;
}

function sessionOf(body: unknown): ConsultSession {
  const value = unwrapData(body) as { session?: ConsultSession } | ConsultSession | null;
  const session = value && 'session' in value ? value.session : (value as ConsultSession | null);
  if (!session?.id) throw new Error('The consult response carried no session.');
  return session;
}

export async function getConsultSession(sessionId: string): Promise<ConsultSession> {
  const { data } = await api.get(`${CONSULT_BASE}/sessions/${sessionId}`);
  return sessionOf(data);
}

export async function joinConsultSession(sessionId: string): Promise<ConsultJoin> {
  const { data } = await api.post<{
    success?: boolean;
    token?: string;
    rtc?: ConsultRtc;
    session?: ConsultSession;
  }>(`${CONSULT_BASE}/sessions/${sessionId}/join`, {});
  if (!data?.token || !data.rtc || !data.session) {
    throw new Error('The consult join response was incomplete.');
  }
  return { token: data.token, rtc: data.rtc, session: data.session };
}

export async function completeConsultSession(sessionId: string): Promise<void> {
  await api.post(`${CONSULT_BASE}/sessions/${sessionId}/complete`, {});
}

export async function listConsultExtensions(sessionId: string): Promise<ConsultExtension[]> {
  const { data } = await api.get<{ success?: boolean; extensions?: ConsultExtension[] }>(
    `${CONSULT_BASE}/sessions/${sessionId}/extensions`,
  );
  return data?.extensions ?? [];
}

export async function requestConsultExtension(sessionId: string, addedMinutes: number): Promise<ConsultExtension> {
  const { data } = await api.post<{ extension?: ConsultExtension; error?: string }>(
    `${CONSULT_BASE}/sessions/${sessionId}/extensions`,
    { added_minutes: addedMinutes },
  );
  if (!data?.extension) throw new Error(data?.error ?? 'The extension request was not accepted.');
  return data.extension;
}

export async function decideConsultExtension(
  sessionId: string,
  extensionId: string,
  approve: boolean,
  reason?: string,
): Promise<ConsultExtension> {
  const { data } = await api.post<{ extension?: ConsultExtension; error?: string }>(
    `${CONSULT_BASE}/sessions/${sessionId}/extensions/${extensionId}/decide`,
    { approve, reason: reason ?? '' },
  );
  if (!data?.extension) throw new Error(data?.error ?? 'The extension decision was not accepted.');
  return data.extension;
}

export async function payConsultExtension(
  sessionId: string,
  extensionId: string,
): Promise<{ extension: ConsultExtension; session: ConsultSession }> {
  const { data } = await api.post<{
    extension?: ConsultExtension;
    session?: ConsultSession;
    error?: string;
  }>(`${CONSULT_BASE}/sessions/${sessionId}/extensions/${extensionId}/pay`, {});
  if (!data?.extension || !data.session) {
    throw new Error(data?.error ?? 'The extension payment was not accepted.');
  }
  return { extension: data.extension, session: data.session };
}

export async function listConsultMessages(sessionId: string, after?: string): Promise<ConsultMessage[]> {
  const { data } = await api.get<{ success?: boolean; messages?: ConsultMessage[] }>(
    `${CONSULT_BASE}/sessions/${sessionId}/messages`,
    { params: after ? { after } : undefined },
  );
  return data?.messages ?? [];
}

export async function postConsultMessage(sessionId: string, body: string): Promise<ConsultMessage> {
  const { data } = await api.post<{ message?: ConsultMessage; error?: string }>(
    `${CONSULT_BASE}/sessions/${sessionId}/messages`,
    { body },
  );
  if (!data?.message) throw new Error(data?.error ?? 'Your message could not be sent.');
  return data.message;
}

/**
 * Open (or re-open) the one session pinned to this telemedicine appointment.
 * Idempotent server-side: a retry returns the same session.
 */
export async function openTelemedicineConsultSession(appointmentId: string): Promise<ConsultSession> {
  const { data } = await api.post(
    `${TELEMEDICINE_BASE}/appointments/${appointmentId}/consult-session`,
    {},
  );
  return sessionOf(data);
}

/**
 * Open the vet appointment's session as the pet owner (`asProvider=false`) or
 * as the vet (`asProvider=true`). Both hit the same engine and return the row.
 */
export async function openVetConsultSession(appointmentId: string, asProvider = false): Promise<ConsultSession> {
  const path = asProvider
    ? `${VET_BASE}/provider/appointments/${appointmentId}/consult-session`
    : `${VET_BASE}/appointments/${appointmentId}/consult-session`;
  const { data } = await api.post(path, {});
  return sessionOf(data);
}

export async function listConsultPackages(input: {
  vertical: ConsultVertical;
  ownerKind: 'doctor' | 'health_provider';
  ownerId: string;
}): Promise<ConsultPackageWire[]> {
  const { data } = await api.get<{ success?: boolean; packages?: ConsultPackageWire[] }>(
    `${CONSULT_BASE}/packages`,
    {
      params: {
        vertical: input.vertical,
        owner_kind: input.ownerKind,
        owner_id: input.ownerId,
      },
    },
  );
  return data?.packages ?? [];
}

export async function publishConsultPackage(
  input: PublishConsultPackageInput,
): Promise<ConsultPackageWire> {
  const { data } = await api.post<{ package?: ConsultPackageWire; error?: string }>(
    `${CONSULT_BASE}/packages`,
    {
      owner_kind: input.ownerKind,
      owner_id: input.ownerId,
      vertical: input.vertical,
      mode: input.mode,
      duration_minutes: input.durationMinutes,
      price_kobo: input.priceKobo,
    },
  );
  if (!data?.package) throw new Error(data?.error ?? 'The package could not be saved.');
  return data.package;
}
