// ── Paymax Health — Shared API layer (Phase 0) ───────────────────────────────
// Typed data layer screens code against. Mock-first (USE_MOCK); flip the flag to
// hit the live ${HEALTH_API_BASE}/... endpoints on the frontend-web proxy.
// IRON RULE: all monetary amounts are integers in minor units (kobo).
// HL-8: every records/consent read is consent-gated + access-logged server-side.

import { api } from '@/api/client';
import { USE_MOCK, HEALTH_API_BASE } from './constants/health.constants';
import type {
  HealthRecord,
  RecordSubject,
  ConsentGrant,
  ConsentGrantInput,
  IntakeSchema,
  IntakeResponse,
  IntakeResponseValues,
  HealthProvider,
  Consult,
  ConsultChatMessage,
  HealthHubSummary,
  ApptIntakeBundle,
  PreConsultIntake,
  SubmitIntakeResult,
  IntakeAttachment,
  HealthProfile,
} from './types';
import {
  PRECONSULT_SCHEMA,
  PRECONSULT_PREFILL,
  CONSENT_VERSION,
  CONSENT_BODY,
  mockGetIntake,
  mockSaveDraft,
  mockSubmitIntake,
  mockGetHealthProfile,
} from './api/preconsult.mock';
import {
  MOCK_SUBJECTS,
  MOCK_RECORDS,
  MOCK_CONSENTS,
  MOCK_PROVIDERS,
  MOCK_INTAKE_SCHEMAS,
  MOCK_INTAKE_RESPONSES,
  MOCK_CONSULTS,
  MOCK_ACTIVE_ORDERS,
} from './api/health.mock';

/** Simulated network latency so loading states render in mock mode. */
const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));

// In-memory mutable copies so mock mutations (grant/revoke/intake/chat) persist
// for the lifetime of the session.
let consents: ConsentGrant[] = [...MOCK_CONSENTS];
const responses: IntakeResponse[] = [...MOCK_INTAKE_RESPONSES];
const consults: Consult[] = MOCK_CONSULTS.map((c) => ({ ...c, messages: [...c.messages] }));

// ── Hub ──────────────────────────────────────────────────────────────────────
export async function getHubSummary(): Promise<HealthHubSummary> {
  if (USE_MOCK) {
    await delay();
    const recentRecords = [...MOCK_RECORDS]
      .sort((a, b) => +new Date(b.issuedAt) - +new Date(a.issuedAt))
      .slice(0, 3);
    return {
      subjects: MOCK_SUBJECTS,
      recentRecords,
      activeOrders: MOCK_ACTIVE_ORDERS,
      activeConsults: consults.filter((c) => c.status === 'scheduled' || c.status === 'in_progress'),
      pendingConsentRequests: 1,
    };
  }
  const { data } = await api.get<HealthHubSummary>(`${HEALTH_API_BASE}/hub`);
  return data;
}

// ── Subjects (patient + pets) ─────────────────────────────────────────────────
export async function getSubjects(): Promise<RecordSubject[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_SUBJECTS;
  }
  const { data } = await api.get<RecordSubject[]>(`${HEALTH_API_BASE}/subjects`);
  return data;
}

// ── Records vault (HL-8 consent-gated) ────────────────────────────────────────
export interface RecordQuery {
  subjectId?: string;
  kind?: HealthRecord['kind'];
}

export async function getRecords(query?: RecordQuery): Promise<HealthRecord[]> {
  if (USE_MOCK) {
    await delay();
    let out = [...MOCK_RECORDS];
    if (query?.subjectId) out = out.filter((r) => r.subjectId === query.subjectId);
    if (query?.kind) out = out.filter((r) => r.kind === query.kind);
    return out.sort((a, b) => +new Date(b.issuedAt) - +new Date(a.issuedAt));
  }
  const { data } = await api.get<HealthRecord[]>(`${HEALTH_API_BASE}/records`, { params: query });
  return data;
}

export async function getRecord(id: string): Promise<HealthRecord> {
  if (USE_MOCK) {
    await delay();
    const rec = MOCK_RECORDS.find((r) => r.id === id);
    if (!rec) throw new Error('Record not found');
    return rec;
  }
  const { data } = await api.get<HealthRecord>(`${HEALTH_API_BASE}/records/${id}`);
  return data;
}

/**
 * Resolve a short-lived signed URL for a record document (HL-8: signed-URL
 * delivery; the request itself is access-logged server-side).
 */
export async function getDocSignedUrl(recordId: string, docId: string): Promise<{ url: string; expiresAt: string }> {
  if (USE_MOCK) {
    await delay(450);
    return {
      url: `mock://health/records/${recordId}/docs/${docId}?signed=1`,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    };
  }
  const { data } = await api.get<{ url: string; expiresAt: string }>(
    `${HEALTH_API_BASE}/records/${recordId}/docs/${docId}/signed-url`,
  );
  return data;
}

// ── Consent & data-sharing (HL-8) ─────────────────────────────────────────────
export async function getConsents(subjectId?: string): Promise<ConsentGrant[]> {
  if (USE_MOCK) {
    await delay();
    return subjectId ? consents.filter((c) => c.subjectId === subjectId) : consents;
  }
  const { data } = await api.get<ConsentGrant[]>(`${HEALTH_API_BASE}/consent`, { params: { subjectId } });
  return data;
}

export async function grantConsent(input: ConsentGrantInput): Promise<ConsentGrant> {
  if (USE_MOCK) {
    await delay(420);
    const subject = MOCK_SUBJECTS.find((s) => s.id === input.subjectId);
    const grantee = MOCK_PROVIDERS.find((p) => p.id === input.granteeId);
    const grant: ConsentGrant = {
      id: `con_${Date.now()}`,
      subjectId: input.subjectId,
      subjectName: subject?.name ?? 'Unknown',
      granteeId: input.granteeId,
      granteeName: grantee?.name ?? 'Provider',
      granteeVertical: input.granteeVertical,
      scopes: input.scopes,
      status: 'active',
      grantedAt: new Date().toISOString(),
      expiresAt: input.expiresAt,
    };
    consents = [grant, ...consents];
    return grant;
  }
  const { data } = await api.post<ConsentGrant>(`${HEALTH_API_BASE}/consent`, input);
  return data;
}

export async function revokeConsent(id: string): Promise<ConsentGrant> {
  if (USE_MOCK) {
    await delay(300);
    consents = consents.map((c) => (c.id === id ? { ...c, status: 'revoked' as const } : c));
    const updated = consents.find((c) => c.id === id);
    if (!updated) throw new Error('Consent not found');
    return updated;
  }
  const { data } = await api.post<ConsentGrant>(`${HEALTH_API_BASE}/consent/${id}/revoke`, {});
  return data;
}

// ── Intake (schema-driven, versioned) ─────────────────────────────────────────
export async function getIntakeSchema(schemaId: string): Promise<IntakeSchema> {
  if (USE_MOCK) {
    await delay();
    const schema = MOCK_INTAKE_SCHEMAS.find((s) => s.id === schemaId);
    if (!schema) throw new Error('Intake form not found');
    return schema;
  }
  const { data } = await api.get<IntakeSchema>(`${HEALTH_API_BASE}/intake/${schemaId}`);
  return data;
}

/** Fetch an in-progress draft (if any) so the renderer can rehydrate. */
export async function getIntakeDraft(schemaId: string, subjectId?: string): Promise<IntakeResponse | null> {
  if (USE_MOCK) {
    await delay(150);
    return (
      responses.find((r) => r.schemaId === schemaId && (!subjectId || r.subjectId === subjectId) && !r.submittedAt) ??
      null
    );
  }
  const { data } = await api.get<IntakeResponse | null>(`${HEALTH_API_BASE}/intake/${schemaId}/draft`, {
    params: { subjectId },
  });
  return data;
}

export async function saveIntakeDraft(
  schemaId: string,
  schemaVersion: number,
  values: IntakeResponseValues,
  subjectId?: string,
): Promise<IntakeResponse> {
  const draft: IntakeResponse = { schemaId, schemaVersion, subjectId, values };
  if (USE_MOCK) {
    await delay(120);
    const idx = responses.findIndex((r) => r.schemaId === schemaId && r.subjectId === subjectId && !r.submittedAt);
    if (idx >= 0) responses[idx] = draft;
    else responses.push(draft);
    return draft;
  }
  const { data } = await api.put<IntakeResponse>(`${HEALTH_API_BASE}/intake/${schemaId}/draft`, draft);
  return data;
}

export async function submitIntake(
  schemaId: string,
  schemaVersion: number,
  values: IntakeResponseValues,
  subjectId?: string,
): Promise<IntakeResponse> {
  if (USE_MOCK) {
    await delay(480);
    const submitted: IntakeResponse = {
      schemaId,
      schemaVersion,
      subjectId,
      values,
      submittedAt: new Date().toISOString(),
    };
    responses.push(submitted);
    return submitted;
  }
  const { data } = await api.post<IntakeResponse>(`${HEALTH_API_BASE}/intake/${schemaId}/responses`, {
    schemaVersion,
    subjectId,
    values,
  });
  return data;
}

// ── Pre-Consult Intake (telemedicine appointment prerequisite, M1–M17) ────────
// Endpoints (Next proxy → Go /api/finance/health):
//   GET    /intake/appointments/{id}            → bundle (intake/schema/prefill/consent)
//   PUT    /intake/appointments/{id}/draft       (autosave)
//   POST   /intake/appointments/{id}/submit      → { status, red_flag? }
//   POST   /intake/appointments/{id}/attachments/presign
//   GET    /intake/health-profile               (M17)

export async function getIntake(appointmentId: string): Promise<ApptIntakeBundle> {
  if (USE_MOCK) {
    await delay();
    const intake = mockGetIntake(appointmentId);
    return {
      intake,
      schema: PRECONSULT_SCHEMA,
      prefill: PRECONSULT_PREFILL,
      consent: {
        version: CONSENT_VERSION,
        body: CONSENT_BODY,
        acceptedVersion: intake.consentVersion,
      },
    };
  }
  const { data } = await api.get<ApptIntakeBundle>(
    `${HEALTH_API_BASE}/intake/appointments/${appointmentId}`,
  );
  return data;
}

/** Autosave the in-progress draft (debounced by the wizard). */
export async function saveIntakeDraftForAppt(
  appointmentId: string,
  answers: IntakeResponseValues,
  consentVersion?: string,
): Promise<PreConsultIntake> {
  if (USE_MOCK) {
    await delay(120);
    return mockSaveDraft(appointmentId, answers, consentVersion);
  }
  const { data } = await api.put<PreConsultIntake>(
    `${HEALTH_API_BASE}/intake/appointments/${appointmentId}/draft`,
    { answers, consent_version: consentVersion },
  );
  return data;
}

/**
 * Submit the Pre-Consult intake — runs server-side red-flag triage (§5).
 * Named `submitApptIntake` to avoid colliding with the legacy schema-driven
 * `submitIntake` above (PRD calls this "submitIntake").
 */
export async function submitApptIntake(
  appointmentId: string,
  answers: IntakeResponseValues,
  consentVersion: string,
): Promise<SubmitIntakeResult> {
  if (USE_MOCK) {
    await delay(480);
    return mockSubmitIntake(appointmentId, answers, consentVersion);
  }
  const { data } = await api.post<SubmitIntakeResult>(
    `${HEALTH_API_BASE}/intake/appointments/${appointmentId}/submit`,
    { answers, consent_version: consentVersion },
  );
  return data;
}

/** Presign an attachment upload (M12), then the client PUTs the file to the URL. */
export async function presignAttachment(
  appointmentId: string,
  file: { fieldId: string; fileName: string; mimeType: string },
): Promise<{ uploadUrl: string; attachment: IntakeAttachment }> {
  if (USE_MOCK) {
    await delay(260);
    const id = `att_${Date.now()}`;
    return {
      uploadUrl: `mock://health/intake/${appointmentId}/attachments/${id}`,
      attachment: {
        id,
        fieldId: file.fieldId,
        fileName: file.fileName,
        mimeType: file.mimeType,
        storageKey: `intake/${appointmentId}/${id}/${file.fileName}`,
      },
    };
  }
  const { data } = await api.post<{ uploadUrl: string; attachment: IntakeAttachment }>(
    `${HEALTH_API_BASE}/intake/appointments/${appointmentId}/attachments/presign`,
    file,
  );
  return data;
}

/** M17 — longitudinal health profile (pre-fills future intakes). */
export async function getHealthProfile(): Promise<HealthProfile> {
  if (USE_MOCK) {
    await delay();
    return mockGetHealthProfile();
  }
  const { data } = await api.get<HealthProfile>(`${HEALTH_API_BASE}/intake/health-profile`);
  return data;
}

// ── Providers (HL-2 credential-gated discovery) ──────────────────────────────
export async function getProviders(vertical?: HealthProvider['vertical']): Promise<HealthProvider[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_PROVIDERS.filter((p) => p.active && (!vertical || p.vertical === vertical));
  }
  const { data } = await api.get<HealthProvider[]>(`${HEALTH_API_BASE}/providers`, { params: { vertical } });
  return data;
}

export async function getProvider(id: string): Promise<HealthProvider> {
  if (USE_MOCK) {
    await delay();
    const prov = MOCK_PROVIDERS.find((p) => p.id === id);
    if (!prov) throw new Error('Provider not found');
    return prov;
  }
  const { data } = await api.get<HealthProvider>(`${HEALTH_API_BASE}/providers/${id}`);
  return data;
}

// ── Consult (tele-consult lobby + room) ───────────────────────────────────────
export async function getConsult(id: string): Promise<Consult> {
  if (USE_MOCK) {
    await delay();
    const cns = consults.find((c) => c.id === id);
    if (!cns) throw new Error('Consult not found');
    return cns;
  }
  const { data } = await api.get<Consult>(`${HEALTH_API_BASE}/consults/${id}`);
  return data;
}

export async function sendConsultMessage(consultId: string, body: string): Promise<ConsultChatMessage> {
  const message: ConsultChatMessage = {
    id: `msg_${Date.now()}`,
    authorId: 'subj_self',
    authorName: 'You',
    fromProvider: false,
    body,
    sentAt: new Date().toISOString(),
  };
  if (USE_MOCK) {
    await delay(120);
    const cns = consults.find((c) => c.id === consultId);
    if (cns) cns.messages = [...cns.messages, message];
    return message;
  }
  const { data } = await api.post<ConsultChatMessage>(`${HEALTH_API_BASE}/consults/${consultId}/messages`, { body });
  return data;
}
