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
  attachmentKindFor,
  mapDraftEnvelope,
  mapHealthProfileEnvelope,
  mapIntakeBundle,
  mapPresignEnvelope,
  mapSubmitEnvelope,
  serverConsentVersion,
  toServerAnswers,
  type ServerBundle,
} from './intakeMapping';
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

export async function getSubjects(): Promise<RecordSubject[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_SUBJECTS;
  }
  const { data } = await api.get<RecordSubject[]>(`${HEALTH_API_BASE}/subjects`);
  return data;
}

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
  // The Go handler answers {"success":true,"data":PatientView} — the axios body is
  // the envelope, not the payload, and the payload is snake_case (intakeMapping).
  const { data } = await api.get<{ success: boolean; data: ServerBundle }>(
    `${HEALTH_API_BASE}/intake/appointments/${appointmentId}`,
  );
  return mapIntakeBundle(data?.data);
}

/**
 * Autosave the in-progress draft (debounced by the wizard).
 * `allowedNames` is the active schema's own field names, which the wizard holds.
 * The LIVE branch filters answers to them because intake.validate rejects an
 * unknown key outright — a stale offline draft or the M12 attachment refs would
 * otherwise 400 the save. Mock mode keeps its own (richer) vocabulary untouched.
 */
export async function saveIntakeDraftForAppt(
  appointmentId: string,
  answers: IntakeResponseValues,
  consentVersion?: string | number,
  allowedNames?: string[],
): Promise<PreConsultIntake> {
  if (USE_MOCK) {
    await delay(120);
    return mockSaveDraft(appointmentId, answers, consentVersion as string | undefined);
  }
  // `consent_version` is omitted entirely when there is none to record: the server
  // keeps whatever it already stored, so a keystroke autosave cannot wipe the
  // agreement the patient just gave (M2).
  const version = serverConsentVersion(consentVersion);
  const { data } = await api.put<{ success: boolean; intake: unknown }>(
    `${HEALTH_API_BASE}/intake/appointments/${appointmentId}/draft`,
    {
      answers: allowedNames ? toServerAnswers(answers, allowedNames) : answers,
      ...(version === undefined ? {} : { consent_version: version }),
    },
  );
  return mapDraftEnvelope(data);
}

/**
 * Submit the Pre-Consult intake — runs server-side red-flag triage (§5).
 * Named `submitApptIntake` to avoid colliding with the legacy schema-driven
 * `submitIntake` above (PRD calls this "submitIntake").
 */
export async function submitApptIntake(
  appointmentId: string,
  answers: IntakeResponseValues,
  consentVersion: string | number,
  allowedNames?: string[],
): Promise<SubmitIntakeResult> {
  if (USE_MOCK) {
    await delay(480);
    return mockSubmitIntake(appointmentId, answers, consentVersion as string);
  }
  const { data } = await api.post<{ success: boolean; data: unknown }>(
    `${HEALTH_API_BASE}/intake/appointments/${appointmentId}/submit`,
    {
      answers: allowedNames ? toServerAnswers(answers, allowedNames) : answers,
      consent_version: serverConsentVersion(consentVersion),
    },
  );
  return mapSubmitEnvelope(data);
}

/** Presign an attachment upload (M12); the caller then PUTs the file and records it. */
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
  // Server field names differ from the wizard's: it takes contentType, not mimeType.
  const { data } = await api.post<{ success: boolean; data: unknown }>(
    `${HEALTH_API_BASE}/intake/appointments/${appointmentId}/attachments/presign`,
    { kind: attachmentKindFor(file.mimeType), fileName: file.fileName, contentType: file.mimeType },
  );
  const { uploadUrl, storageKey, contentType } = mapPresignEnvelope(data);
  if (!uploadUrl || !storageKey) throw new Error('preconsult: presign returned no upload');
  return {
    uploadUrl,
    // The storage key doubles as the id: it is unique per object and the server
    // returns it again on the next load, so a reload reconciles without a uuid.
    attachment: {
      id: storageKey,
      fieldId: file.fieldId,
      fileName: file.fileName,
      mimeType: contentType || file.mimeType,
      storageKey,
    },
  };
}

/**
 * Record an attachment the client has already PUT to the presigned URL (M12).
 * The server only accepts a key it issued for this patient + appointment, so this
 * runs strictly after a successful upload. Mock mode has no server row to write.
 */
export async function recordAttachment(
  appointmentId: string,
  attachment: IntakeAttachment,
): Promise<PreConsultIntake> {
  if (USE_MOCK) return Promise.reject(new Error('recordAttachment is a no-op in mock mode'));
  const { data } = await api.post<{ success: boolean; intake: unknown }>(
    `${HEALTH_API_BASE}/intake/appointments/${appointmentId}/attachments`,
    {
      kind: attachmentKindFor(attachment.mimeType),
      storage_key: attachment.storageKey,
      content_type: attachment.mimeType,
    },
  );
  return mapDraftEnvelope(data);
}

/** M17 — longitudinal health profile (pre-fills future intakes). */
export async function getHealthProfile(): Promise<HealthProfile> {
  if (USE_MOCK) {
    await delay();
    return mockGetHealthProfile();
  }
  const { data } = await api.get<unknown>(`${HEALTH_API_BASE}/intake/health-profile`);
  return mapHealthProfileEnvelope(data);
}

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

// Shared by pharmacy/lab/vet onboarding — one credential-vault backend
// (backend/internal/health/providers/*) serves all three domains, so one
// upload helper does too. Mirrors the doctor module's doctorUploadFile: get a
// presigned PUT URL scoped to the caller's own application, PUT the binary
// straight to R2 (never through this API), then the caller records the
// resulting object key via addProviderCredential. The returned value is the
// R2 object key, never a public URL — same convention as every other presign
// flow in this codebase (the bucket is private).
interface ProviderCredentialPresignResponse {
  presign: {
    upload_url: string;
    storage_key: string;
    content_type: string;
    bucket: string;
    expires_in: number;
    method: string;
  };
}

export async function uploadProviderCredential(
  applicationId: string,
  file: { uri: string; fileName: string; mimeType: string },
): Promise<string> {
  const { data: body } = await api.post<ProviderCredentialPresignResponse>(
    `${HEALTH_API_BASE}/providers/applications/${applicationId}/credentials/presign`,
    { file_name: file.fileName, content_type: file.mimeType },
  );
  const data = body.presign;
  const blob = await (await fetch(file.uri)).blob();
  const res = await fetch(data.upload_url, {
    method: 'PUT',
    body: blob,
    headers: { 'Content-Type': data.content_type },
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  return data.storage_key;
}

// health/providers/model.go CredentialDoc.CredType — no closed enum server
// side, kept as a plain string here to match).
export async function addProviderCredential(
  applicationId: string,
  input: { credType: string; referenceNo?: string; storageKey: string },
): Promise<void> {
  await api.post(`${HEALTH_API_BASE}/providers/applications/${applicationId}/credentials`, {
    cred_type: input.credType,
    reference_no: input.referenceNo,
    storage_key: input.storageKey,
  });
}
