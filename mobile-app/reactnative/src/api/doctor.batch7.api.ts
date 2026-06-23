// ── Doctor (Telemedicine, provider-side) — Batch 7 API client ────────────────
// Batch 7 = spec sections AA · AB · AC · AD (Support & Dispute · Compliance,
// Privacy & Audit · Settings · Empty/Error/Edge-State). Phase A style: every
// function resolves demo data so screens render without a live API; `DEMO_*`
// exports double as `placeholderData` in useQuery. ADDITIVE to the Phase 1 /
// Phase 2 / Section B / Phase 3 / Batch 1-6 api files — nothing earlier changes.
//
// CONSOLIDATED + heavy REUSE: the support ticket list / status / resolved
// screens REUSE getSupportTickets + createSupportTicket (doctor.api); the
// compliance-dashboard / licence / consent / audit screens REUSE
// getComplianceDashboard + acknowledgePolicy (doctor.phase2.api). Money is
// always an integer in kobo.
//
// TODO(Phase C): replace each body with the live endpoint and pass the
//   Idempotency-Key header on every mutation below.

// Re-export the shared money formatter so Batch 7 screens can import it here too.
export { formatKobo } from '@/api/doctor.api';
import { DOCTOR_USE_MOCK, doctorGet, doctorPost, doctorPut, doctorDelete } from '@/api/doctor.client';
// Re-export the REUSED support / compliance read+write fns so a Batch 7 screen
// can pull everything from one import site (no re-implementation).
export {
  getSupportTickets,
  createSupportTicket,
  getSettings,
  updateSettings,
  DEMO_SUPPORT_TICKETS,
  DEMO_SETTINGS,
} from '@/api/doctor.api';
export {
  getComplianceDashboard,
  acknowledgePolicy,
  DEMO_COMPLIANCE,
} from '@/api/doctor.phase2.api';

import type {
  FaqItem,
  HelpArticle,
  Dispute,
  SupportMessage,
  EvidenceAttachment,
  VetLicenceInfo,
  DataPrivacySettings,
  AuditScope,
  AuditTrail,
  MandatoryTraining,
  SafetyIssueReport,
  AccountReviewNotice,
  SecuritySettings,
  Device,
  AppPreferences,
  EdgeStateKind,
  EdgeStateDescriptor,
  AppStatus,
  AccountStatus,
  CreateDisputeInput,
  CreateDisputeResult,
  UploadDisputeEvidenceInput,
  UploadDisputeEvidenceResult,
  SendSupportMessageInput,
  SendSupportMessageResult,
  UpdatePrivacySettingsInput,
  UpdatePrivacySettingsResult,
  CompleteTrainingModuleInput,
  CompleteTrainingModuleResult,
  ReportSafetyIssueInput,
  ReportSafetyIssueResult,
  RequestDataExportInput,
  RequestDataExportResult,
  RequestAccountDeletionInput,
  RequestAccountDeletionResult,
  ChangePasswordInput,
  ChangePasswordResult,
  SetBiometricInput,
  SetBiometricResult,
  SetTwoFactorInput,
  SetTwoFactorResult,
  RevokeDeviceInput,
  RevokeDeviceResult,
  UpdateAppPreferencesInput,
  UpdateAppPreferencesResult,
  LogoutInput,
  LogoutResult,
} from '@/types/doctor.batch7';

// Simulate network latency so loading states are exercised in the UI.
const wait = <T>(value: T, ms = 350): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

const iso = (daysAgo: number): string => new Date(Date.now() - daysAgo * 86400000).toISOString();
const isoDate = (daysFromNow: number): string =>
  new Date(Date.now() + daysFromNow * 86400000).toISOString().slice(0, 10);

// ═══════════════════════════════════════════════════════════════════════════
// SECTION AA — SUPPORT & DISPUTE
// ═══════════════════════════════════════════════════════════════════════════

export const DEMO_FAQS: FaqItem[] = [
  { id: 'faq-1', category: 'getting_started', question: 'How do I start taking consultations?', answer: 'Once your account is verified, set your availability under Settings → Availability and toggle your online status on.', helpful: 42 },
  { id: 'faq-2', category: 'consultations', question: 'What happens if a patient does not join the call?', answer: 'The session shows a "patient unavailable" state after 5 minutes. You can mark it as a no-show, which records the consult and triggers the no-show policy.', helpful: 31 },
  { id: 'faq-3', category: 'prescriptions', question: 'Can I edit a prescription after issuing it?', answer: 'Issued prescriptions are immutable. Issue a corrected prescription, which links to and supersedes the original.', helpful: 18 },
  { id: 'faq-4', category: 'payments_payouts', question: 'When are payouts settled?', answer: 'Payouts are settled twice monthly to your verified bank account. Pending balances clear 24–48h after each consult completes.', helpful: 57 },
  { id: 'faq-5', category: 'verification', question: 'My licence is expiring — what should I do?', answer: 'Upload a renewed MDCN certificate under Compliance → Licence. You will keep practising while the renewal is reviewed.', helpful: 12 },
  { id: 'faq-6', category: 'technical', question: 'The video call keeps dropping.', answer: 'Check your connection, then retry. If it persists, the platform automatically falls back to a secondary provider. Report a call-failure dispute if a consult was affected.', helpful: 9 },
  { id: 'faq-7', category: 'account', question: 'How do I enable two-factor authentication?', answer: 'Go to Settings → Security → Two-factor authentication and choose an authenticator app, SMS or email.', helpful: 23 },
];

export const DEMO_HELP_ARTICLES: HelpArticle[] = [
  {
    id: 'art-1', category: 'getting_started', title: 'Your first week on Spotlight',
    summary: 'A checklist to get verified, set availability and complete your first consult.',
    body: '1. Complete verification.\n2. Set your consultation pricing.\n3. Configure availability.\n4. Turn on notifications.\n5. Accept your first consult.',
    readMins: 4, updatedAt: iso(6),
  },
  {
    id: 'art-2', category: 'payments_payouts', title: 'Understanding payouts, commission & tax',
    summary: 'How gross earnings, platform commission, VAT and WHT combine into your net payout.',
    body: 'Gross earnings are split by source. Platform commission is deducted, then VAT (7.5%) and WHT (5%) are applied per Nigerian tax rules. The remainder settles to your bank account.',
    readMins: 6, updatedAt: iso(12),
  },
  {
    id: 'art-3', category: 'consultations', title: 'Handling difficult consultations & disputes',
    summary: 'When and how to raise a dispute, and what evidence helps resolution.',
    body: 'Raise a dispute from the relevant consult, payment, pharmacy, lab, HMO or prescription record. Attach screenshots, logs or documents as evidence — disputes with evidence resolve faster.',
    readMins: 5, updatedAt: iso(3),
  },
];

export const DEMO_DISPUTES: Dispute[] = [
  {
    id: 'dpt-1', ref: 'DPT-2026-031', kind: 'payment', subject: 'Consult fee not credited',
    description: 'Completed TM-9F2A41 three days ago but the fee has not appeared in my wallet.',
    status: 'under_review', paymentRef: 'TM-9F2A41', amountKobo: 250000,
    evidence: [
      { id: 'ev-1', kind: 'screenshot', fileName: 'wallet-ledger.png', sizeBytes: 184320, uploadedAt: iso(2) },
    ],
    createdAt: iso(2), updatedAt: iso(1),
  },
  {
    id: 'dpt-2', ref: 'DPT-2026-028', kind: 'call_failure', subject: 'Video call dropped at 11 minutes',
    description: 'The Agora session dropped and the fallback did not reconnect. Patient was charged in full.',
    status: 'awaiting_response', consultRef: 'TM-7C1B88',
    evidence: [
      { id: 'ev-2', kind: 'log', fileName: 'call-session.log', sizeBytes: 20480, uploadedAt: iso(4) },
    ],
    createdAt: iso(4), updatedAt: iso(3),
  },
  {
    id: 'dpt-3', ref: 'DPT-2026-022', kind: 'hmo', subject: 'HMO claim wrongly rejected',
    description: 'Reliance HMO rejected CLM-7C1B88 citing no auth code, but a valid code was provided.',
    status: 'resolved', hmoClaimRef: 'CLM-7C1B88', amountKobo: 4200000,
    evidence: [], createdAt: iso(12), updatedAt: iso(7), resolvedAt: iso(7),
    resolutionNote: 'Claim re-adjudicated and approved; settlement scheduled in the next payout.',
  },
  {
    id: 'dpt-4', ref: 'DPT-2026-019', kind: 'patient_complaint', subject: 'Complaint about consult tone',
    description: 'Patient raised a complaint; awaiting my written response.',
    status: 'open', patientId: 'pat-3', patientName: 'Chidi Okeke',
    evidence: [], createdAt: iso(1), updatedAt: iso(1),
  },
];

export const DEMO_SUPPORT_MESSAGES: SupportMessage[] = [
  { id: 'sm-1', threadId: 'tkt-1', author: 'doctor', body: 'My payout for the last cycle is still pending.', createdAt: iso(3) },
  { id: 'sm-2', threadId: 'tkt-1', author: 'agent', body: 'Thanks for reaching out — our finance team is reviewing your payout PO-2026-015.', createdAt: iso(2) },
  { id: 'sm-3', threadId: 'tkt-1', author: 'system', body: 'Ticket status changed to In progress.', createdAt: iso(2) },
  { id: 'sm-4', threadId: 'tkt-1', author: 'doctor', body: 'Thank you, appreciate the update.', createdAt: iso(1) },
];

// ═══════════════════════════════════════════════════════════════════════════
// SECTION AB — COMPLIANCE, PRIVACY & AUDIT
// ═══════════════════════════════════════════════════════════════════════════
// REUSES getComplianceDashboard / acknowledgePolicy (re-exported above) for the
// dashboard / licence / consent / alerts / policy screens.

export const DEMO_VET_LICENCE: VetLicenceInfo = {
  mdcnNumber: 'VCN-2019-4471', status: 'valid', issuedAt: '2019-03-01', expiresAt: '2026-12-31',
  daysToExpiry: 194, councilName: 'Veterinary Council of Nigeria (VCN)', vcnNumber: 'VCN-2019-4471',
};

export const DEMO_PRIVACY_SETTINGS: DataPrivacySettings = {
  sharingPreferences: [
    { key: 'research',    label: 'Anonymised research', enabled: false },
    { key: 'analytics',   label: 'Product analytics',   enabled: true  },
    { key: 'partner_hmo', label: 'HMO partner sharing', enabled: true,  locked: true },
  ],
  exportStatus:   'none',
  deletionStatus: 'none',
};

const AUDIT_ENTRIES_BY_SCOPE: Record<AuditScope, AuditTrail> = {
  prescription: {
    scope: 'prescription', updatedAt: iso(0),
    entries: [
      { id: 'at-rx-1', scope: 'prescription', action: 'prescription_issued', detail: 'Issued RX-9F2A41 (Amoxicillin 500mg)', actor: 'You', at: iso(0), ref: 'RX-9F2A41', patientName: 'Tunde Akinwale' },
      { id: 'at-rx-2', scope: 'prescription', action: 'prescription_issued', detail: 'Issued RX-7C1B88 (Amlodipine 5mg)', actor: 'You', at: iso(2), ref: 'RX-7C1B88', patientName: 'Ngozi Adeyemi' },
    ],
  },
  consultation: {
    scope: 'consultation', updatedAt: iso(0),
    entries: [
      { id: 'at-tm-1', scope: 'consultation', action: 'record_access', detail: 'Opened consult TM-9F2A41', actor: 'You', at: iso(0), ref: 'TM-9F2A41', patientName: 'Tunde Akinwale' },
      { id: 'at-tm-2', scope: 'consultation', action: 'record_access', detail: 'Opened consult VET-9F2A41', actor: 'You', at: iso(1), ref: 'VET-9F2A41', patientName: 'Chidi Okeke' },
    ],
  },
  lab: {
    scope: 'lab', updatedAt: iso(1),
    entries: [
      { id: 'at-lab-1', scope: 'lab', action: 'record_access', detail: 'Reviewed FBC result for LAB-3D0F12', actor: 'You', at: iso(1), ref: 'LAB-3D0F12', patientName: 'Tunde Akinwale' },
    ],
  },
  hmo: {
    scope: 'hmo', updatedAt: iso(2),
    entries: [
      { id: 'at-hmo-1', scope: 'hmo', action: 'data_export', detail: 'Submitted claim CLM-9F2A41 to Hygeia HMO', actor: 'You', at: iso(2), ref: 'CLM-9F2A41', patientName: 'Fatima Bello' },
    ],
  },
};

export const DEMO_AUDIT_TRAILS: Record<AuditScope, AuditTrail> = AUDIT_ENTRIES_BY_SCOPE;

export const DEMO_MANDATORY_TRAINING: MandatoryTraining = {
  completedCount: 2, totalRequired: 3, nextDueAt: isoDate(14),
  modules: [
    { id: 'tr-1', title: 'Data Protection & Patient Privacy 2026', summary: 'NDPR essentials for clinicians handling patient data.', status: 'completed', required: true, durationMins: 25, completedAt: iso(40) },
    { id: 'tr-2', title: 'Telemedicine Code of Conduct',           summary: 'MDCN telemedicine practice standards.',           status: 'completed', required: true, durationMins: 20, completedAt: iso(30) },
    { id: 'tr-3', title: 'Safeguarding & Mandatory Reporting',     summary: 'Recognising and reporting safety issues.',         status: 'in_progress', required: true, durationMins: 30, dueAt: isoDate(14) },
    { id: 'tr-4', title: 'Antimicrobial Stewardship (optional)',   summary: 'Reducing inappropriate antibiotic prescribing.',  status: 'not_started', required: false, durationMins: 15 },
  ],
};

export const DEMO_SAFETY_ISSUES: SafetyIssueReport[] = [
  {
    id: 'saf-1', ref: 'SAF-2026-009', category: 'adverse_drug_reaction', severity: 'high',
    description: 'Patient reported severe rash after prescribed Amoxicillin; suspected allergy not flagged.',
    patientId: 'pat-2', status: 'investigating', reportedAt: iso(5),
  },
];

export const DEMO_ACCOUNT_REVIEW_NOTICE: AccountReviewNotice | null = null;

// ═══════════════════════════════════════════════════════════════════════════
// SECTION AC — SETTINGS
// ═══════════════════════════════════════════════════════════════════════════
// REUSES getSettings / updateSettings (re-exported above) for the profile /
// notification / availability toggle screens. These ADD the security / device /
// app-preference surface only.

export const DEMO_SECURITY_SETTINGS: SecuritySettings = {
  biometricEnabled: true, biometricType: 'face',
  twoFactorEnabled: false, twoFactorMethod: 'none',
  lastPasswordChange: iso(58), pinEnabled: false,
};

export const DEMO_DEVICES: Device[] = [
  { id: 'dev-1', label: 'iPhone 15 Pro',     platform: 'ios',     lastActiveAt: iso(0),  location: 'Lagos, NG',   current: true,  trusted: true  },
  { id: 'dev-2', label: 'Pixel 8',           platform: 'android', lastActiveAt: iso(4),  location: 'Abuja, NG',   current: false, trusted: true  },
  { id: 'dev-3', label: 'Chrome on macOS',   platform: 'web',     lastActiveAt: iso(11), location: 'Ibadan, NG',  current: false, trusted: false },
];

export const DEMO_APP_PREFERENCES: AppPreferences = {
  language: 'en', theme: 'system', reduceMotion: false, hapticsEnabled: true,
};

// ═══════════════════════════════════════════════════════════════════════════
// SECTION AD — EMPTY, ERROR & EDGE-STATE
// ═══════════════════════════════════════════════════════════════════════════
// Pure descriptor map. Screens read EDGE_STATES[kind] (or call getEdgeState) and
// feed it straight into the shared StateView component.

export const EDGE_STATES: Record<EdgeStateKind, EdgeStateDescriptor> = {
  // ── empty states ──
  no_appointments: { kind: 'no_appointments', variant: 'empty', tone: 'neutral', icon: 'calendar-outline',
    title: 'No appointments yet', message: 'Booked consultations will appear here.' },
  no_messages: { kind: 'no_messages', variant: 'empty', tone: 'neutral', icon: 'chatbubble-ellipses-outline',
    title: 'No messages', message: 'Patient conversations will show up here.' },
  no_prescriptions: { kind: 'no_prescriptions', variant: 'empty', tone: 'neutral', icon: 'document-text-outline',
    title: 'No prescriptions', message: 'Prescriptions you issue will be listed here.' },
  no_lab_results: { kind: 'no_lab_results', variant: 'empty', tone: 'neutral', icon: 'flask-outline',
    title: 'No lab results', message: 'Results for your lab orders will appear here once ready.' },
  no_earnings: { kind: 'no_earnings', variant: 'empty', tone: 'neutral', icon: 'cash-outline',
    title: 'No earnings yet', message: 'Completed consultations will build up your earnings here.' },
  no_reviews: { kind: 'no_reviews', variant: 'empty', tone: 'neutral', icon: 'star-outline',
    title: 'No reviews yet', message: 'Patient reviews will appear here after your consultations.' },

  // ── connectivity / server ──
  no_internet: { kind: 'no_internet', variant: 'error', tone: 'warning', icon: 'cloud-offline-outline',
    title: 'No internet connection', message: 'Check your connection and try again.',
    cta: { label: 'Retry', action: 'retry' } },
  server_error: { kind: 'server_error', variant: 'error', tone: 'error', icon: 'alert-circle-outline',
    title: 'Something went wrong', message: 'We hit a problem on our end. Please try again.',
    cta: { label: 'Try again', action: 'retry' } },
  session_expired: { kind: 'session_expired', variant: 'error', tone: 'warning', icon: 'time-outline',
    title: 'Session expired', message: 'For your security, please sign in again.',
    cta: { label: 'Sign in', action: 'login', route: '/(auth)/login' } },

  // ── permissions ──
  camera_permission_denied: { kind: 'camera_permission_denied', variant: 'error', tone: 'warning', icon: 'videocam-off-outline',
    title: 'Camera access needed', message: 'Enable camera access in settings to start a video consult.',
    cta: { label: 'Open settings', action: 'open_settings' } },
  microphone_permission_denied: { kind: 'microphone_permission_denied', variant: 'error', tone: 'warning', icon: 'mic-off-outline',
    title: 'Microphone access needed', message: 'Enable microphone access in settings to join the call.',
    cta: { label: 'Open settings', action: 'open_settings' } },
  file_upload_failed: { kind: 'file_upload_failed', variant: 'error', tone: 'error', icon: 'cloud-upload-outline',
    title: 'Upload failed', message: 'The file could not be uploaded. Check the size and try again.',
    cta: { label: 'Try again', action: 'retry' } },

  // ── consultation / call edge cases ──
  patient_unavailable: { kind: 'patient_unavailable', variant: 'empty', tone: 'info', icon: 'person-outline',
    title: 'Patient unavailable', message: 'The patient has not joined yet. You can wait or mark a no-show.' },
  patient_cancelled: { kind: 'patient_cancelled', variant: 'empty', tone: 'info', icon: 'close-circle-outline',
    title: 'Consultation cancelled', message: 'The patient cancelled this consultation.' },
  call_connection_failed: { kind: 'call_connection_failed', variant: 'error', tone: 'error', icon: 'cellular-outline',
    title: 'Call could not connect', message: 'We could not establish the call. Please retry.',
    cta: { label: 'Retry call', action: 'retry' } },
  agora_unavailable: { kind: 'agora_unavailable', variant: 'error', tone: 'warning', icon: 'sync-outline',
    title: 'Switching call provider', message: 'The primary video provider is unavailable; trying a fallback.',
    cta: { label: 'Retry', action: 'retry' } },
  videosdk_fallback_failed: { kind: 'videosdk_fallback_failed', variant: 'error', tone: 'error', icon: 'warning-outline',
    title: 'Call unavailable', message: 'Both video providers failed. Try an audio call or reschedule.',
    cta: { label: 'Try again', action: 'retry' }, secondaryCta: { label: 'Contact support', action: 'contact_support', route: '/(doctor)/support' } },

  // ── clinical edge cases ──
  prescription_blocked: { kind: 'prescription_blocked', variant: 'error', tone: 'warning', icon: 'document-lock-outline',
    title: 'Prescription cannot be issued', message: 'This prescription is blocked. Resolve the flagged issue and try again.',
    cta: { label: 'Review', action: 'go_back' } },
  drug_interaction_detected: { kind: 'drug_interaction_detected', variant: 'error', tone: 'warning', icon: 'alert-outline',
    title: 'Drug interaction detected', message: 'A potential interaction was found. Review before proceeding.',
    cta: { label: 'Review interactions', action: 'go_back' } },
  lab_order_blocked: { kind: 'lab_order_blocked', variant: 'error', tone: 'warning', icon: 'flask-outline',
    title: 'Lab order cannot be submitted', message: 'The lab order could not be submitted. Check the selected tests.',
    cta: { label: 'Review order', action: 'go_back' } },
  hmo_verification_failed: { kind: 'hmo_verification_failed', variant: 'error', tone: 'warning', icon: 'shield-outline',
    title: 'HMO verification failed', message: 'We could not verify HMO coverage. Confirm the details and retry.',
    cta: { label: 'Retry', action: 'retry' } },

  // ── account / platform ──
  account_verification_pending: { kind: 'account_verification_pending', variant: 'empty', tone: 'info', icon: 'hourglass-outline',
    title: 'Verification in progress', message: 'Your account is being reviewed. You will be notified once approved.',
    cta: { label: 'Check status', action: 'refresh' } },
  licence_expired: { kind: 'licence_expired', variant: 'error', tone: 'error', icon: 'ribbon-outline',
    title: 'Licence expired', message: 'Your practising licence has expired. Upload a renewal to continue.',
    cta: { label: 'Update licence', action: 'go_back', route: '/(doctor)/compliance' } },
  access_denied: { kind: 'access_denied', variant: 'error', tone: 'error', icon: 'lock-closed-outline',
    title: 'Access denied', message: 'You do not have permission to view this.',
    cta: { label: 'Go back', action: 'go_back' } },
  maintenance_mode: { kind: 'maintenance_mode', variant: 'error', tone: 'info', icon: 'construct-outline',
    title: 'Under maintenance', message: 'Spotlight is briefly down for maintenance. Please check back soon.',
    cta: { label: 'Retry', action: 'retry' } },
  app_update_required: { kind: 'app_update_required', variant: 'error', tone: 'warning', icon: 'arrow-up-circle-outline',
    title: 'Update required', message: 'A newer version of the app is required to continue.',
    cta: { label: 'Update now', action: 'update_app' } },
};

// Pure helper — the canonical way screens fetch an edge-state descriptor.
export function getEdgeState(kind: EdgeStateKind): EdgeStateDescriptor {
  return EDGE_STATES[kind];
}

export const DEMO_APP_STATUS: AppStatus = {
  mode: 'ok', minVersion: '2.4.0', currentVersion: '2.4.0',
};

export const DEMO_ACCOUNT_STATUS: AccountStatus = {
  state: 'approved', canPractise: true,
  title: 'Account active', message: 'Your account is verified and active.',
  updatedAt: iso(0),
};

// ═══════════════════════════════════════════════════════════════════════════
// READ ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// ── Section AA ──
export async function getFaqs(): Promise<FaqItem[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_FAQS);
  return doctorGet<FaqItem[]>('/support/faqs');
}

export async function getHelpArticles(): Promise<HelpArticle[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_HELP_ARTICLES);
  return doctorGet<HelpArticle[]>('/support/help-articles');
}

export async function getDisputes(): Promise<Dispute[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_DISPUTES);
  return doctorGet<Dispute[]>('/disputes');
}

export async function getDispute(id: string): Promise<Dispute | undefined> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_DISPUTES.find((d) => d.id === id));
  return doctorGet<Dispute | undefined>(`/disputes/${id}`);
}

export async function getSupportMessages(threadId: string): Promise<SupportMessage[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_SUPPORT_MESSAGES.filter((m) => m.threadId === threadId));
  return doctorGet<SupportMessage[]>(`/support/${threadId}/messages`);
}

// ── Section AB ──
export async function getVetLicence(): Promise<VetLicenceInfo> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_VET_LICENCE);
  return doctorGet<VetLicenceInfo>('/vet/licence');
}

export async function getPrivacySettings(): Promise<DataPrivacySettings> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PRIVACY_SETTINGS);
  return doctorGet<DataPrivacySettings>('/privacy');
}

export async function getAuditTrail(scope: AuditScope): Promise<AuditTrail> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_AUDIT_TRAILS[scope]);
  return doctorGet<AuditTrail>('/audit-trail', { scope });
}

export async function getMandatoryTraining(): Promise<MandatoryTraining> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_MANDATORY_TRAINING);
  return doctorGet<MandatoryTraining>('/training');
}

export async function getSafetyIssues(): Promise<SafetyIssueReport[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_SAFETY_ISSUES);
  return doctorGet<SafetyIssueReport[]>('/safety-issues');
}

export async function getAccountReviewNotice(): Promise<AccountReviewNotice | null> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_ACCOUNT_REVIEW_NOTICE);
  return doctorGet<AccountReviewNotice | null>('/account/review-notice');
}

// ── Section AC ──
export async function getSecuritySettings(): Promise<SecuritySettings> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_SECURITY_SETTINGS);
  return doctorGet<SecuritySettings>('/security');
}

export async function getDevices(): Promise<Device[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_DEVICES);
  return doctorGet<Device[]>('/security/devices');
}

export async function getAppPreferences(): Promise<AppPreferences> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_APP_PREFERENCES);
  return doctorGet<AppPreferences>('/preferences');
}

// ── Section AD ──
export async function getAppStatus(): Promise<AppStatus> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_APP_STATUS);
  return doctorGet<AppStatus>('/app-status');
}

export async function getAccountStatus(): Promise<AccountStatus> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_ACCOUNT_STATUS);
  return doctorGet<AccountStatus>('/account/status');
}

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

// ── Section AA ──
export async function createDispute(input: CreateDisputeInput): Promise<CreateDisputeResult> {
  if (DOCTOR_USE_MOCK) {
    void input.description;
    const ref = `DPT-${input.idempotencyKey.slice(-6).toUpperCase()}`;
    return wait({ disputeId: `dpt-${Date.now()}`, ref, status: 'open' as Dispute['status'] }, 600);
  }
  return doctorPost<CreateDisputeResult>('/disputes', input, input.idempotencyKey);
}

export async function uploadDisputeEvidence(input: UploadDisputeEvidenceInput): Promise<UploadDisputeEvidenceResult> {
  if (DOCTOR_USE_MOCK) {
    void input.disputeId;
    const attachment: EvidenceAttachment = {
      id:         `ev-${Date.now()}`,
      kind:       input.kind,
      fileName:   input.fileName,
      sizeBytes:  input.sizeBytes,
      uploadedAt: iso(0),
    };
    return wait({ attachment }, 700);
  }
  // Live: backend presigns R2 + records the metadata. See DOCTOR_GO_LIVE.md.
  return doctorPost<UploadDisputeEvidenceResult>(`/disputes/${input.disputeId}/evidence`, input, input.idempotencyKey);
}

export async function sendSupportMessage(input: SendSupportMessageInput): Promise<SendSupportMessageResult> {
  if (DOCTOR_USE_MOCK) {
    void input.attachmentId;
    const message: SupportMessage = {
      id:        `sm-${Date.now()}`,
      threadId:  input.threadId,
      author:    'doctor',
      body:      input.body,
      createdAt: iso(0),
    };
    return wait({ message }, 400);
  }
  return doctorPost<SendSupportMessageResult>(`/support/${input.threadId}/messages`, input, input.idempotencyKey);
}

// ── Section AB ──
export async function updatePrivacySettings(input: UpdatePrivacySettingsInput): Promise<UpdatePrivacySettingsResult> {
  if (DOCTOR_USE_MOCK) return wait({ settings: { ...DEMO_PRIVACY_SETTINGS, sharingPreferences: input.sharingPreferences } }, 500);
  return doctorPut<UpdatePrivacySettingsResult>('/privacy', input, input.idempotencyKey);
}

export async function completeTrainingModule(input: CompleteTrainingModuleInput): Promise<CompleteTrainingModuleResult> {
  if (DOCTOR_USE_MOCK) return wait({ moduleId: input.moduleId, status: 'completed' as MandatoryTraining['modules'][number]['status'] }, 500);
  return doctorPost<CompleteTrainingModuleResult>(`/training/${input.moduleId}/complete`, input, input.idempotencyKey);
}

export async function reportSafetyIssue(input: ReportSafetyIssueInput): Promise<ReportSafetyIssueResult> {
  if (DOCTOR_USE_MOCK) {
    void input.description;
    const ref = `SAF-${input.idempotencyKey.slice(-6).toUpperCase()}`;
    return wait({ reportId: `saf-${Date.now()}`, ref, status: 'submitted' as SafetyIssueReport['status'] }, 600);
  }
  return doctorPost<ReportSafetyIssueResult>('/safety-issues', input, input.idempotencyKey);
}

export async function requestDataExport(input: RequestDataExportInput): Promise<RequestDataExportResult> {
  if (DOCTOR_USE_MOCK) {
    void input.idempotencyKey;
    return wait({ status: 'requested' as DataPrivacySettings['exportStatus'] }, 600);
  }
  return doctorPost<RequestDataExportResult>('/privacy/export', input, input.idempotencyKey);
}

export async function requestAccountDeletion(input: RequestAccountDeletionInput): Promise<RequestAccountDeletionResult> {
  // CONSOLIDATED: this is the SINGLE account-deletion endpoint shared by the
  // AB (privacy) and AC (settings) screens — do not duplicate.
  if (DOCTOR_USE_MOCK) {
    void input.reason;
    return wait({ status: 'requested' as DataPrivacySettings['deletionStatus'] }, 600);
  }
  return doctorPost<RequestAccountDeletionResult>('/privacy/delete', input, input.idempotencyKey);
}

// ── Section AC ──
export async function changePassword(input: ChangePasswordInput): Promise<ChangePasswordResult> {
  if (DOCTOR_USE_MOCK) {
    void input.currentPassword;
    void input.newPassword;
    return wait({ changed: true, lastPasswordChange: iso(0) }, 700);
  }
  return doctorPost<ChangePasswordResult>('/security/password', input, input.idempotencyKey);
}

export async function setBiometric(input: SetBiometricInput): Promise<SetBiometricResult> {
  if (DOCTOR_USE_MOCK) return wait({ biometricEnabled: input.enabled }, 400);
  return doctorPut<SetBiometricResult>('/security/biometric', input, input.idempotencyKey);
}

export async function setTwoFactor(input: SetTwoFactorInput): Promise<SetTwoFactorResult> {
  if (!DOCTOR_USE_MOCK) return doctorPut<SetTwoFactorResult>('/security/2fa', input, input.idempotencyKey);
  void input.code;
  const setup = input.enabled && input.method === 'authenticator'
    ? {
        method:        input.method,
        secret:        'JBSWY3DPEHPK3PXP',
        otpauthUrl:    'otpauth://totp/Spotlight:dr.amaka@spotlight.ng?secret=JBSWY3DPEHPK3PXP&issuer=Spotlight',
        recoveryCodes: ['8F2A-41C7', '7C1B-88D0', '3D0F-90A2'],
      }
    : undefined;
  return wait({ twoFactorEnabled: input.enabled, twoFactorMethod: input.method, setup }, 600);
}

export async function revokeDevice(input: RevokeDeviceInput): Promise<RevokeDeviceResult> {
  if (DOCTOR_USE_MOCK) return wait({ deviceId: input.deviceId, revoked: true }, 500);
  return doctorDelete<RevokeDeviceResult>(`/security/devices/${input.deviceId}`, input.idempotencyKey);
}

export async function updateAppPreferences(input: UpdateAppPreferencesInput): Promise<UpdateAppPreferencesResult> {
  if (DOCTOR_USE_MOCK) return wait({ preferences: { ...DEMO_APP_PREFERENCES, ...input.preferences } }, 400);
  return doctorPut<UpdateAppPreferencesResult>('/preferences', input, input.idempotencyKey);
}

export async function logout(input: LogoutInput): Promise<LogoutResult> {
  if (DOCTOR_USE_MOCK) {
    void input.allDevices;
    return wait({ loggedOut: true }, 400);
  }
  return doctorPost<LogoutResult>('/auth/logout', input, input.idempotencyKey);
}
