// ── Doctor (Telemedicine, provider-side) — Batch 2 API client ────────────────
// Batch 2 = spec sections G, H, I, J. Phase A style: every function resolves
// demo data so screens render without a live API. `DEMO_*` exports double as
// `placeholderData` in useQuery. ADDITIVE to `@/api/doctor.api`,
// `@/api/doctor.phase2.api`, `@/api/doctor.profile.api`, `@/api/doctor.phase3.api`
// and `@/api/doctor.batch1.api` — earlier fns/exports are untouched.
//
// Sections: G patient profile review (PatientFullProfile), H chat consultation
// (ChatMessageRich + presence + transcript), I audio/video call (CallSessionRich
// + device check + feedback + dispute), J clinical notes & diagnosis
// (ClinicalNote + DiagnosisCode catalogue).
//
// TODO(Phase C): replace each body with the live endpoint, e.g.
//   const res = await api.get('/api/v1/doctor/patients/:id/full'); return res.data.data;
// uploads → presigned R2 PUT; mutations pass the Idempotency-Key header below.

import { Colors } from '@/constants/colors';
import {
  DEMO_PATIENT_PROFILE,
  DEMO_CHAT_MESSAGES,
} from '@/api/doctor.api';
import { ICD_CODES } from '@/features/doctor/constants/batch2';
import type {
  PatientFullProfile,
  ChatMessageRich,
  ChatParticipantPresence,
  ChatThreadState,
  ChatTranscript,
  CallSessionRich,
  PreCallCheck,
  CallDurationSummary,
  CallQualityFeedback,
  CallDispute,
  ClinicalNote,
  DiagnosisCode,
  SendVoiceNoteInput,
  SendVoiceNoteResult,
  SendAttachmentInput,
  SendAttachmentResult,
  AnnotateImageInput,
  AnnotateImageResult,
  ShareInChatInput,
  ShareInChatResult,
  EscalateToCallInput,
  EscalateToCallResult,
  ReportMessageInput,
  ReportMessageResult,
  EndChatInput,
  EndChatResult,
  RunDeviceCheckInput,
  RunDeviceCheckResult,
  JoinCallInput,
  JoinCallResult,
  LeaveCallInput,
  LeaveCallResult,
  SwitchProviderInput,
  SwitchProviderResult,
  SubmitCallFeedbackInput,
  SubmitCallFeedbackResult,
  RaiseCallDisputeInput,
  RaiseCallDisputeResult,
  ReportTechnicalIssueInput,
  ReportTechnicalIssueResult,
  SaveDraftNoteInput,
  SaveDraftNoteResult,
  FinalizeNoteInput,
  FinalizeNoteResult,
  ShareSummaryInput,
  ShareSummaryResult,
} from '@/types/doctor.batch2';

// Re-export the shared money formatter so Batch 2 screens can import it here.
export { formatKobo } from '@/api/doctor.api';
import { DOCTOR_USE_MOCK, doctorGet, doctorPost, doctorPut } from '@/api/doctor.client';

// Simulate network latency so loading states are exercised in the UI.
const wait = <T>(value: T, ms = 350): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

const iso = (offsetMs = 0): string => new Date(Date.now() + offsetMs).toISOString();

// ═══════════════════════════════════════════════════════════════════════════
// SECTION G — PATIENT PROFILE REVIEW
// ═══════════════════════════════════════════════════════════════════════════

// The full profile COMPOSES the Phase 1 `DEMO_PATIENT_PROFILE` (reused as
// `base`) and adds the richer Section G review data on top.
export const DEMO_PATIENT_FULL_PROFILE: PatientFullProfile = {
  base: DEMO_PATIENT_PROFILE,
  demographics: {
    dateOfBirth: '1992-03-14',
    patientType: 'adult',
    hasCaregiver: false,
    occupation: 'Software Engineer',
    maritalStatus: 'Married',
    state: 'Lagos',
    city: 'Lekki',
    bloodGroup: 'O+',
    genotype: 'AA',
    language: 'English',
  },
  chiefComplaint: 'Persistent headache and fatigue for the past 3 days.',
  submittedSymptoms: [
    { id: 'sym-1', label: 'Headache',  severity: 'moderate', duration: '3 days', note: 'Worse in the mornings' },
    { id: 'sym-2', label: 'Fatigue',   severity: 'moderate', duration: '5 days' },
    { id: 'sym-3', label: 'Dizziness', severity: 'mild',     duration: '2 days' },
  ],
  allergyHistory: [
    { id: 'alg-1', allergen: 'Penicillin', reaction: 'Skin rash and swelling', severity: 'severe',   type: 'drug' },
    { id: 'alg-2', allergen: 'Peanuts',    reaction: 'Hives',                   severity: 'moderate', type: 'food' },
  ],
  pastSurgeries: [
    { id: 'surg-1', procedure: 'Appendectomy', year: 2015, hospital: 'Lagoon Medical Centre' },
  ],
  familyHistory: [
    { id: 'fam-1', relation: 'Father', condition: 'Hypertension' },
    { id: 'fam-2', relation: 'Mother', condition: 'Type 2 Diabetes Mellitus' },
  ],
  vitalsHistory: [
    {
      recordedAt: iso(-40 * 86400000),
      vitals: [
        { label: 'Blood Pressure', value: '142/92 mmHg' },
        { label: 'Heart Rate',     value: '80 bpm' },
        { label: 'Weight',         value: '83 kg' },
      ],
    },
    {
      recordedAt: iso(-7 * 86400000),
      vitals: [
        { label: 'Blood Pressure', value: '138/88 mmHg' },
        { label: 'Heart Rate',     value: '76 bpm' },
        { label: 'Weight',         value: '82 kg' },
      ],
    },
    {
      recordedAt: iso(),
      vitals: [
        { label: 'Blood Pressure', value: '136/86 mmHg' },
        { label: 'Heart Rate',     value: '74 bpm' },
        { label: 'Temperature',    value: '36.8 °C' },
        { label: 'Weight',         value: '82 kg' },
      ],
    },
  ],
  documents: [
    { id: 'pdoc-1', kind: 'lab_report',        title: 'FBC Report',          fileName: 'fbc-report.pdf',     uri: 'file:///demo/fbc.pdf',    uploadedAt: iso(-10 * 86400000), source: 'Synlab Nigeria' },
    { id: 'pdoc-2', kind: 'discharge_summary', title: 'Discharge Summary',   fileName: 'discharge.pdf',      uri: 'file:///demo/disch.pdf',  uploadedAt: iso(-60 * 86400000), source: 'Lagoon Medical Centre' },
  ],
  images: [
    { id: 'pimg-1', uri: 'file:///demo/rash.jpg', caption: 'Rash on left forearm', takenAt: iso(-2 * 86400000) },
  ],
  previousConsults: [
    { id: 'pc-1', date: '2026-05-10', doctorName: 'Dr. Amaka Obi',  consultType: 'video', summary: 'Routine BP review, medication adjusted.', diagnosis: ['Essential Hypertension'] },
    { id: 'pc-2', date: '2026-02-18', doctorName: 'Dr. Tunde Bello', consultType: 'chat',  summary: 'Diagnosed stage 1 hypertension.',        diagnosis: ['Essential Hypertension'] },
  ],
  // Reuse Phase 1 prescription / lab-result shapes (kept inline so this file is
  // self-contained; Phase C resolves these from the patient's record).
  previousPrescriptions: [
    {
      id: 'rx-prev-1', ref: 'RX-2B0C19', appointmentId: 'apt-prev-1',
      patient: DEMO_PATIENT_PROFILE.patient, doctorName: 'Dr. Amaka Obi',
      diagnosis: 'Essential Hypertension', issuedAt: iso(-40 * 86400000), status: 'dispensed',
      items: [
        { name: 'Amlodipine', dosage: '5mg', route: 'Oral', frequency: 'Once daily', duration: '30 days' },
        { name: 'Lisinopril', dosage: '10mg', route: 'Oral', frequency: 'Once daily', duration: '30 days' },
      ],
    },
  ],
  previousLabResults: [
    {
      id: 'res-prev-1', orderId: 'lab-prev-1', ref: 'LAB-1A2B33', patient: DEMO_PATIENT_PROFILE.patient,
      values: [
        { testName: 'Haemoglobin', value: '14.2', unit: 'g/dL', refRange: '13.0–17.0', flag: 'normal' },
        { testName: 'WBC',         value: '6.4',  unit: '×10⁹/L', refRange: '4.0–11.0', flag: 'normal' },
      ],
      reportedAt: iso(-9 * 86400000), labName: 'Synlab Nigeria', reviewed: true,
    },
  ],
  hmoCoverage: {
    provider: 'Hygeia HMO', planName: 'Gold', memberId: 'HYG-2284910',
    validUntil: new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10),
    coveredServices: ['Teleconsultation', 'Prescriptions', 'Basic Lab Tests'],
  },
  emergencyContact: { name: 'Bisi Akinwale', relation: 'Spouse', phone: '+234 802 555 1212' },
  dependents: [
    { id: 'dep-1', name: 'Demi Akinwale', initials: 'DA', avatarColor: Colors.teal, relation: 'Daughter', patientType: 'child', ageMonths: 54 },
  ],
  alerts: {
    riskWarnings: [
      { id: 'risk-1', severity: 'warning', title: 'Elevated cardiovascular risk', detail: 'Stage 1 hypertension with family history of CVD.', riskType: 'cardiac' },
    ],
    drugAllergyAlerts: [
      { id: 'daa-1', severity: 'critical', allergen: 'Penicillin', drug: 'Amoxicillin', reaction: 'Skin rash and swelling', detail: 'Do not prescribe penicillin-class antibiotics.' },
    ],
    contraindications: [
      { id: 'cta-1', severity: 'warning', subject: 'Ibuprofen', conflictsWith: 'Lisinopril', detail: 'NSAIDs may reduce the efficacy of ACE inhibitors and impair renal function.' },
    ],
  },
};

export async function getPatientFullProfile(patientId: string): Promise<PatientFullProfile> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PATIENT_FULL_PROFILE);
  return doctorGet<PatientFullProfile>(`/patients/${patientId}/full-profile`);
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION H — CHAT CONSULTATION
// ═══════════════════════════════════════════════════════════════════════════

// Rich messages COMPOSE the Phase 1 `DEMO_CHAT_MESSAGES` (reused as `base`) and
// add kind/delivery metadata. Extra Batch 2 message kinds (voice, image, shared)
// are appended.
const DEMO_THREAD_ID = 'thr-1';

export const DEMO_RICH_MESSAGES: ChatMessageRich[] = [
  ...DEMO_CHAT_MESSAGES.filter((m) => m.threadId === DEMO_THREAD_ID).map((m) => ({
    base: m,
    kind: 'text' as const,
    deliveryStatus: 'read' as const,
  })),
  {
    base: { id: 'msg-vn-1', threadId: DEMO_THREAD_ID, author: 'patient', body: 'Voice note', createdAt: iso(-4 * 60000) },
    kind: 'voice', deliveryStatus: 'delivered', voiceDurationSecs: 18,
    attachment: { url: 'file:///demo/voice-1.m4a', name: 'voice-1.m4a', mimeType: 'audio/m4a' },
  },
  {
    base: { id: 'msg-img-1', threadId: DEMO_THREAD_ID, author: 'patient', body: 'Photo of the rash', createdAt: iso(-3 * 60000), attachmentUrl: 'file:///demo/rash.jpg', attachmentName: 'rash.jpg' },
    kind: 'image', deliveryStatus: 'read',
    attachment: { url: 'file:///demo/rash.jpg', name: 'rash.jpg', mimeType: 'image/jpeg' },
    annotations: [{ id: 'ann-1', x: 0.42, y: 0.55, note: 'Localised erythema here' }],
  },
  {
    base: { id: 'msg-rx-1', threadId: DEMO_THREAD_ID, author: 'doctor', body: 'Shared prescription RX-4F2A41', createdAt: iso(-2 * 60000) },
    kind: 'shared_prescription', deliveryStatus: 'read',
    shared: { kind: 'prescription', id: 'rx-1', ref: 'RX-4F2A41', label: 'Prescription · 2 items' },
  },
];

export const DEMO_THREAD_STATE: ChatThreadState = {
  threadId: DEMO_THREAD_ID,
  lifecycle: 'active',
  secureNotice: 'Messages are end-to-end encrypted. Do not share login credentials or OTPs in chat.',
  patientPresence: { threadId: DEMO_THREAD_ID, author: 'patient', status: 'online' },
  doctorPresence:  { threadId: DEMO_THREAD_ID, author: 'doctor',  status: 'online' },
};

export const DEMO_TRANSCRIPT: ChatTranscript = {
  threadId: DEMO_THREAD_ID,
  appointmentId: 'apt-3',
  patient: DEMO_PATIENT_PROFILE.patient,
  messages: DEMO_RICH_MESSAGES,
  startedAt: iso(-30 * 60000),
};

export async function getRichMessages(threadId: string): Promise<ChatMessageRich[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_RICH_MESSAGES.filter((m) => m.base.threadId === threadId));
  return doctorGet<ChatMessageRich[]>(`/chat/${threadId}/rich-messages`);
}

export async function getThreadState(threadId: string): Promise<ChatThreadState> {
  if (DOCTOR_USE_MOCK) return wait({ ...DEMO_THREAD_STATE, threadId });
  return doctorGet<ChatThreadState>(`/chat/${threadId}/state`);
}

export async function getChatPresence(threadId: string): Promise<ChatParticipantPresence[]> {
  if (DOCTOR_USE_MOCK) {
    return wait([
      { threadId, author: 'patient', status: 'online' },
      { threadId, author: 'doctor',  status: 'online' },
    ]);
  }
  return doctorGet<ChatParticipantPresence[]>(`/chat/${threadId}/presence`);
}

export async function getTranscript(threadId: string): Promise<ChatTranscript> {
  if (DOCTOR_USE_MOCK) return wait({ ...DEMO_TRANSCRIPT, threadId });
  return doctorGet<ChatTranscript>(`/chat/${threadId}/transcript`);
}

function buildRichMessage(threadId: string, kind: ChatMessageRich['kind'], body: string, extra: Partial<ChatMessageRich> = {}): ChatMessageRich {
  return {
    base: { id: `msg-${Date.now()}`, threadId, author: 'doctor', body, createdAt: new Date().toISOString() },
    kind,
    deliveryStatus: 'sent',
    ...extra,
  };
}

export async function sendVoiceNote(input: SendVoiceNoteInput): Promise<SendVoiceNoteResult> {
  if (DOCTOR_USE_MOCK) {
    const message = buildRichMessage(input.threadId, 'voice', 'Voice note', {
      voiceDurationSecs: input.durationSecs,
      attachment: { url: input.uri, name: `voice-${Date.now()}.m4a`, mimeType: 'audio/m4a' },
    });
    return wait({ message }, 500);
  }
  return doctorPost<SendVoiceNoteResult>(`/chat/${input.threadId}/voice`, input, input.idempotencyKey);
}

export async function sendAttachment(input: SendAttachmentInput): Promise<SendAttachmentResult> {
  if (DOCTOR_USE_MOCK) {
    const message = buildRichMessage(input.threadId, input.kind, input.caption ?? input.fileName, {
      attachment: { url: input.uri, name: input.fileName, mimeType: input.mimeType },
    });
    return wait({ message }, 600);
  }
  // Live: backend presigns R2 + records the metadata. See DOCTOR_GO_LIVE.md.
  return doctorPost<SendAttachmentResult>(`/chat/${input.threadId}/attachments`, input, input.idempotencyKey);
}

export async function annotateImage(input: AnnotateImageInput): Promise<AnnotateImageResult> {
  if (DOCTOR_USE_MOCK) return wait({ messageId: input.messageId, annotations: input.annotations }, 400);
  return doctorPut<AnnotateImageResult>(`/chat/messages/${input.messageId}/annotations`, input, input.idempotencyKey);
}

export async function shareInChat(input: ShareInChatInput): Promise<ShareInChatResult> {
  if (!DOCTOR_USE_MOCK) return doctorPost<ShareInChatResult>(`/chat/${input.threadId}/share`, input, input.idempotencyKey);
  const kindMap = {
    prescription: 'shared_prescription',
    lab:          'shared_lab',
    summary:      'shared_summary',
  } as const;
  const refMap = { prescription: 'RX', lab: 'LAB', summary: 'SUM' } as const;
  const ref = `${refMap[input.kind]}-${input.idempotencyKey.slice(-6).toUpperCase()}`;
  const message = buildRichMessage(input.threadId, kindMap[input.kind], `Shared ${input.kind} ${ref}`, {
    shared: { kind: input.kind, id: input.entityId, ref, label: `${input.kind} · ${ref}` },
  });
  return wait({ message }, 500);
}

export async function escalateToCall(input: EscalateToCallInput): Promise<EscalateToCallResult> {
  if (DOCTOR_USE_MOCK) return wait({ appointmentId: 'apt-3', mode: input.mode, callId: `call-${Date.now()}` }, 500);
  return doctorPost<EscalateToCallResult>(`/chat/${input.threadId}/escalate`, input, input.idempotencyKey);
}

export async function reportMessage(input: ReportMessageInput): Promise<ReportMessageResult> {
  if (DOCTOR_USE_MOCK) {
    void input.reason;
    return wait({ messageId: input.messageId, reported: true }, 400);
  }
  return doctorPost<ReportMessageResult>(`/chat/messages/${input.messageId}/report`, input, input.idempotencyKey);
}

export async function endChat(input: EndChatInput): Promise<EndChatResult> {
  if (DOCTOR_USE_MOCK) return wait({ threadId: input.threadId, lifecycle: 'ended' as const, endedAt: new Date().toISOString() }, 500);
  return doctorPost<EndChatResult>(`/chat/${input.threadId}/end`, input, input.idempotencyKey);
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION I — AUDIO & VIDEO CONSULTATION
// ═══════════════════════════════════════════════════════════════════════════

const DEMO_DEVICE_CHECK = {
  cameraOk: true, micOk: true, networkOk: true,
  networkQuality: 'good' as const, checkedAt: iso(),
};

// The rich call session COMPOSES the Phase 1 call session as `base`.
export const DEMO_CALL_SESSION_RICH: CallSessionRich = {
  base: {
    id: 'call-1', appointmentId: 'apt-1', patient: DEMO_PATIENT_PROFILE.patient,
    mode: 'video', status: 'live', startedAt: iso(-4 * 60000), durationSecs: 248,
    roomToken: 'demo-room-token',
  },
  phase: 'live',
  provider: 'agora',
  providerFailed: false,
  networkQuality: 'good',
  device: DEMO_DEVICE_CHECK,
  controls: { muted: false, cameraOn: true, speakerOn: true, frontCamera: true, minimized: false },
  patientState: { author: 'patient', connected: true },
  doctorState:  { author: 'doctor',  connected: true },
};

export const DEMO_PRECALL_CHECK: PreCallCheck = {
  appointmentId: 'apt-1',
  mode: 'video',
  device: DEMO_DEVICE_CHECK,
  ready: true,
  warnings: [],
};

export const DEMO_CALL_DISPUTES: CallDispute[] = [
  {
    id: 'cdp-1', ref: 'CDP-7C1B88', appointmentId: 'apt-2',
    reason: 'Call dropped repeatedly and could not reconnect.',
    status: 'under_review', raisedAt: iso(-2 * 86400000),
  },
];

export async function getCallSessionRich(appointmentId: string): Promise<CallSessionRich> {
  if (DOCTOR_USE_MOCK) return wait({ ...DEMO_CALL_SESSION_RICH, base: { ...DEMO_CALL_SESSION_RICH.base, appointmentId } });
  return doctorGet<CallSessionRich>(`/calls/${appointmentId}/rich`);
}

export async function getPreCallCheck(appointmentId: string): Promise<PreCallCheck> {
  if (DOCTOR_USE_MOCK) return wait({ ...DEMO_PRECALL_CHECK, appointmentId });
  return doctorGet<PreCallCheck>(`/calls/${appointmentId}/pre-check`);
}

export async function getCallDisputes(): Promise<CallDispute[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_CALL_DISPUTES);
  return doctorGet<CallDispute[]>('/calls/disputes');
}

export async function runDeviceCheck(input: RunDeviceCheckInput): Promise<RunDeviceCheckResult> {
  // TODO(Phase C): client-side WebRTC device/network probe; no server call.
  const check: PreCallCheck = {
    appointmentId: input.appointmentId,
    mode: input.mode,
    device: { ...DEMO_DEVICE_CHECK, checkedAt: new Date().toISOString() },
    ready: true,
    warnings: [],
  };
  return wait({ check }, 700);
}

export async function joinCall(input: JoinCallInput): Promise<JoinCallResult> {
  if (DOCTOR_USE_MOCK) {
    return wait({
      callId: `call-${Date.now()}`, provider: 'agora' as const, phase: 'live' as const,
      roomToken: `room-${input.idempotencyKey.slice(-8)}`,
    }, 600);
  }
  return doctorPost<JoinCallResult>(`/calls/${input.appointmentId}/join`, input, input.idempotencyKey);
}

export async function leaveCall(input: LeaveCallInput): Promise<LeaveCallResult> {
  if (DOCTOR_USE_MOCK) {
    const endedAt = new Date().toISOString();
    const summary: CallDurationSummary = {
      appointmentId: input.appointmentId,
      patient: DEMO_PATIENT_PROFILE.patient,
      provider: 'agora', mode: 'video', durationSecs: 1320,
      startedAt: iso(-1320 * 1000), endedAt, endedReason: 'completed',
    };
    return wait({ appointmentId: input.appointmentId, phase: 'ended' as const, summary }, 500);
  }
  return doctorPost<LeaveCallResult>(`/calls/${input.appointmentId}/leave`, input, input.idempotencyKey);
}

export async function switchProvider(input: SwitchProviderInput): Promise<SwitchProviderResult> {
  if (DOCTOR_USE_MOCK) {
    // Models the Agora → VideoSDK fallback. Phase transitions reconnecting → live.
    return wait({ appointmentId: input.appointmentId, provider: input.to, phase: 'live' as const }, 700);
  }
  return doctorPost<SwitchProviderResult>(`/calls/${input.appointmentId}/switch-provider`, input, input.idempotencyKey);
}

export async function submitCallFeedback(input: SubmitCallFeedbackInput): Promise<SubmitCallFeedbackResult> {
  if (DOCTOR_USE_MOCK) {
    void (input.rating, input.audioOk, input.videoOk, input.comment);
    return wait({ appointmentId: input.appointmentId, submitted: true }, 500);
  }
  return doctorPost<SubmitCallFeedbackResult>(`/calls/${input.appointmentId}/feedback`, input, input.idempotencyKey);
}

export async function raiseCallDispute(input: RaiseCallDisputeInput): Promise<RaiseCallDisputeResult> {
  if (DOCTOR_USE_MOCK) {
    const ref = `CDP-${input.idempotencyKey.slice(-6).toUpperCase()}`;
    return wait({ disputeId: `cdp-${Date.now()}`, ref, status: 'open' as const }, 600);
  }
  return doctorPost<RaiseCallDisputeResult>(`/calls/${input.appointmentId}/dispute`, input, input.idempotencyKey);
}

export async function reportTechnicalIssue(input: ReportTechnicalIssueInput): Promise<ReportTechnicalIssueResult> {
  if (DOCTOR_USE_MOCK) {
    void (input.category, input.detail);
    return wait({ ticketId: `tkt-${Date.now()}`, ref: `TKT-${Math.floor(1000 + Math.random() * 9000)}` }, 500);
  }
  return doctorPost<ReportTechnicalIssueResult>('/support/technical', input, input.idempotencyKey);
}

// Demo feedback (read example for the feedback screen prefill).
export const DEMO_CALL_FEEDBACK: CallQualityFeedback = {
  appointmentId: 'apt-4', rating: 5, audioOk: true, videoOk: true,
  comment: 'Clear audio and video throughout.', submittedAt: iso(-2 * 86400000),
};

// ═══════════════════════════════════════════════════════════════════════════
// SECTION J — CONSULTATION NOTES & DIAGNOSIS
// ═══════════════════════════════════════════════════════════════════════════

// The ICD-lite catalogue lives in constants/batch2 (`ICD_CODES`); the diagnosis
// search is a pure client-side filter so the UI can search without a round-trip.
export function searchDiagnosisCodes(query: string): DiagnosisCode[] {
  const q = query.trim().toLowerCase();
  if (!q) return ICD_CODES;
  return ICD_CODES.filter(
    (c) => c.code.toLowerCase().includes(q) || c.label.toLowerCase().includes(q) || c.category.toLowerCase().includes(q),
  );
}

// A clinical note COMPOSES the Phase 1 SoapNote shape as `base`.
export const DEMO_CLINICAL_NOTE: ClinicalNote = {
  base: {
    id: 'soap-1', appointmentId: 'apt-3', patientId: 'pat-1',
    subjective: 'Patient reports persistent morning headaches and fatigue over the past 3 days. No visual disturbance, no chest pain.',
    objective: 'BP 136/86 mmHg, HR 74 bpm, T 36.8 °C. Alert and oriented. No focal neurological deficit.',
    assessment: 'Likely tension-type headache on a background of stage 1 hypertension.',
    plan: 'Continue Amlodipine 5mg daily. Advise hydration and sleep hygiene. Review in 2 weeks.',
    diagnosis: ['Headache', 'Essential Hypertension'],
    createdAt: iso(-20 * 60000), updatedAt: iso(-5 * 60000),
  },
  icdCodes: [
    { code: 'R51', label: 'Headache', category: 'Symptoms' },
    { code: 'I10', label: 'Essential Hypertension', category: 'Cardiovascular' },
  ],
  clinicalImpression: 'Tension headache, hypertension reasonably controlled.',
  treatmentPlan: 'Maintain current antihypertensive. Lifestyle measures. Analgesia PRN.',
  lifestyleRecommendations: [
    { id: 'lr-1', category: 'Diet',     text: 'Reduce salt intake to < 5g/day.' },
    { id: 'lr-2', category: 'Exercise', text: '30 minutes brisk walking, 5 days/week.' },
  ],
  redFlags: [
    { id: 'rf-1', severity: 'warning', label: 'Sudden severe headache', action: 'Advise immediate review if onset is thunderclap.' },
  ],
  referral: { recommended: false },
  followUp: { recommended: true, dueInDays: 14, reason: 'BP and headache review' },
  privateNotes: 'Patient anxious about hypertension diagnosis — reassure at follow-up.',
  status: 'draft',
  version: 2,
  sharedWithPatient: false,
  updatedAt: iso(-5 * 60000),
};

export async function getClinicalNote(appointmentId: string): Promise<ClinicalNote | undefined> {
  if (DOCTOR_USE_MOCK) return wait({ ...DEMO_CLINICAL_NOTE, base: { ...DEMO_CLINICAL_NOTE.base, appointmentId } });
  return doctorGet<ClinicalNote | undefined>(`/appointments/${appointmentId}/clinical-note`);
}

export async function saveDraftNote(input: SaveDraftNoteInput): Promise<SaveDraftNoteResult> {
  if (DOCTOR_USE_MOCK) {
    return wait({
      noteId: `cnote-${Date.now()}`, status: 'draft' as const, version: 1,
      updatedAt: new Date().toISOString(),
    }, 500);
  }
  return doctorPut<SaveDraftNoteResult>(`/appointments/${input.note.appointmentId}/clinical-note`, input, input.idempotencyKey);
}

export async function finalizeNote(input: FinalizeNoteInput): Promise<FinalizeNoteResult> {
  if (DOCTOR_USE_MOCK) {
    return wait({
      noteId: input.noteId, status: 'locked' as const, locked: true, lockedAt: new Date().toISOString(),
    }, 600);
  }
  return doctorPost<FinalizeNoteResult>(`/clinical-notes/${input.noteId}/finalize`, input, input.idempotencyKey);
}

export async function shareSummary(input: ShareSummaryInput): Promise<ShareSummaryResult> {
  if (DOCTOR_USE_MOCK) return wait({ noteId: input.noteId, sharedWithPatient: true, sharedAt: new Date().toISOString() }, 500);
  return doctorPost<ShareSummaryResult>(`/clinical-notes/${input.noteId}/share`, input, input.idempotencyKey);
}
