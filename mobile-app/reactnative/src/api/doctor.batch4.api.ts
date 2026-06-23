// ── Doctor (Telemedicine, provider-side) — Batch 4 API client ────────────────
// Sections O (HMO/Insurance), P (Collaboration), Q (Follow-Up Care),
// R (Emergency & Escalation). Phase A style: every function resolves demo data
// so screens render without a live API. `DEMO_*` exports double as
// `placeholderData` in useQuery. ADDITIVE to `@/api/doctor.api` and
// `@/api/doctor.phase2.api` — earlier fns/exports are untouched.
//
// Emergency (Section R) content is DEMO + clearly NON-ACTIONABLE: no real
// dialing, no real dispatch. See EMERGENCY_DISCLAIMER in the constants.
//
// TODO(Phase C): replace each body with the live endpoint and pass the
//   Idempotency-Key header on every mutation below.

import { Colors } from '@/constants/colors';
import type {
  HmoPlanCoverage,
  PreAuthRequest,
  PreAuthStatus,
  CoveredService,
  HmoSupportThread,
  HmoSupportMessage,
  HmoFraudWarning,
  IncomingReferral,
  IncomingReferralStatus,
  OpinionRequest,
  OpinionStatus,
  CareTeamThread,
  CareTeamMessage,
  SharedCaseSummary,
  FollowUpEligibility,
  LongTermCarePlan,
  ChronicMonitoringEntry,
  MedicationAdherenceCheck,
  EmergencyFacility,
  RedFlagAlert,
  EmergencyEscalation,
  EscalationKind,
  EscalationStatus,
  EmergencyCaseRecord,
  RequestPreAuthInput,
  RequestPreAuthResult,
  SendHmoSupportMessageInput,
  SendHmoSupportMessageResult,
  AcknowledgeFraudWarningInput,
  AcknowledgeFraudWarningResult,
  AcceptReferralInput,
  AcceptReferralResult,
  RejectReferralInput,
  RejectReferralResult,
  RequestOpinionInput,
  RequestOpinionResult,
  SendCareTeamMessageInput,
  SendCareTeamMessageResult,
  SetFollowUpReminderInput,
  SetFollowUpReminderResult,
  CompleteFollowUpInput,
  CompleteFollowUpResult,
  RecordAdherenceCheckInput,
  RecordAdherenceCheckResult,
  SaveCarePlanInput,
  SaveCarePlanResult,
  EscalateInput,
  EscalateResult,
  NotifyEmergencyContactInput,
  NotifyEmergencyContactResult,
  DocumentEmergencyCaseInput,
  DocumentEmergencyCaseResult,
  ScheduleEmergencyFollowUpInput,
  ScheduleEmergencyFollowUpResult,
  FollowUpStatus,
} from '@/types/doctor.batch4';

// Re-export the shared money formatter so Batch 4 screens can import it here too.
export { formatKobo } from '@/api/doctor.api';
import { DOCTOR_USE_MOCK, doctorGet, doctorPost } from '@/api/doctor.client';

// Simulate network latency so loading states are exercised in the UI.
const wait = <T>(value: T, ms = 350): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

const iso = (daysAgo: number): string => new Date(Date.now() - daysAgo * 86400000).toISOString();
const isoDate = (daysFromNow: number): string =>
  new Date(Date.now() + daysFromNow * 86400000).toISOString().slice(0, 10);

// Demo patients — mirror the Phase 1 / Phase 2 set so records cross-reference.
const PATIENT_TUNDE  = { id: 'pat-1', name: 'Tunde Akinwale', initials: 'TA', avatarColor: Colors.secondary, age: 34, gender: 'male' as const };
const PATIENT_FATIMA = { id: 'pat-2', name: 'Fatima Bello',   initials: 'FB', avatarColor: '#EC4899',        age: 28, gender: 'female' as const };
const PATIENT_CHIDI  = { id: 'pat-3', name: 'Chidi Okeke',    initials: 'CO', avatarColor: '#F59E0B',        age: 45, gender: 'male' as const };
const PATIENT_NGOZI  = { id: 'pat-4', name: 'Ngozi Adeyemi',  initials: 'NA', avatarColor: Colors.teal,      age: 52, gender: 'female' as const };

// ═══════════════════════════════════════════════════════════════════════════
// Section O — HMO / Insurance demo data
// ═══════════════════════════════════════════════════════════════════════════

export const DEMO_HMO_PLAN_COVERAGE: HmoPlanCoverage = {
  planId: 'plan-1', planName: 'Hygeia HMO — Silver', provider: 'Hygeia HMO',
  memberId: 'HYG-****-2291', patient: PATIENT_FATIMA, status: 'eligible',
  coPayKobo: 50000, coPayPct: 10,
  annualLimitKobo: 50000000, annualUsedKobo: 12400000,
  validFrom: isoDate(-200), validTo: isoDate(165),
  benefits: [
    { id: 'bl-1', service: 'Teleconsultation', covered: true,  limitKobo: 10000000, usedKobo: 2800000 },
    { id: 'bl-2', service: 'Laboratory',       covered: true,  limitKobo: 8000000,  usedKobo: 1500000, note: 'Pre-auth required above ₦50,000' },
    { id: 'bl-3', service: 'Pharmacy',         covered: true,  limitKobo: 6000000,  usedKobo: 900000,  note: 'Generic drugs only' },
    { id: 'bl-4', service: 'Specialist referral', covered: true, note: 'Pre-auth required' },
    { id: 'bl-5', service: 'Cosmetic procedures', covered: false },
  ],
};

export const DEMO_PRE_AUTH_REQUESTS: PreAuthRequest[] = [
  {
    id: 'pa-1', ref: 'PA-7C1B88', appointmentId: 'apt-2', patient: PATIENT_FATIMA,
    provider: 'Hygeia HMO', planName: 'Hygeia HMO — Silver', service: 'MRI Brain',
    estimatedKobo: 8500000, status: 'pending', requestedAt: iso(0),
    note: 'Persistent headache, rule out intracranial pathology.',
  },
  {
    id: 'pa-2', ref: 'PA-4F2A41', appointmentId: 'apt-4', patient: PATIENT_NGOZI,
    provider: 'Avon HMO', planName: 'Avon HMO — Gold', service: 'Endocrinology referral',
    estimatedKobo: 4000000, status: 'approved', authCode: 'AUTH-77K2',
    requestedAt: iso(3), decidedAt: iso(2),
  },
  {
    id: 'pa-3', ref: 'PA-9F2A41', appointmentId: 'apt-3', patient: PATIENT_CHIDI,
    provider: 'Hygeia HMO', planName: 'Hygeia HMO — Bronze', service: 'CT Abdomen',
    estimatedKobo: 12000000, status: 'limit_exceeded',
    requestedAt: iso(5), decidedAt: iso(4),
    rejectionReason: 'Annual imaging limit exhausted for this enrollee.',
  },
];

export const DEMO_COVERED_SERVICES: CoveredService[] = [
  {
    id: 'cs-1', kind: 'prescription', refId: 'rx-1', refLabel: 'RX-4F2A41',
    description: 'Metformin 500mg ×30, Amlodipine 5mg ×30', status: 'partial',
    totalKobo: 450000, coveredKobo: 360000, patientKobo: 90000, note: 'Generic substitution required',
  },
  {
    id: 'cs-2', kind: 'lab', refId: 'lab-1', refLabel: 'LAB-8C1B22',
    description: 'HbA1c & Lipid Profile', status: 'pending_auth',
    totalKobo: 1500000, coveredKobo: 0, patientKobo: 0, note: 'Pre-authorisation required',
  },
  {
    id: 'cs-3', kind: 'consultation', refId: 'apt-2', refLabel: 'APT-91X4',
    description: 'Teleconsultation (audio)', status: 'covered',
    totalKobo: 350000, coveredKobo: 350000, patientKobo: 0,
  },
];

export const DEMO_HMO_SUPPORT_THREAD: HmoSupportThread = {
  threadId: 'hmoth-1', provider: 'Hygeia HMO', subject: 'Claim CLM-9F2A41 — adjudication query',
  claimId: 'clm-1',
  messages: [
    { id: 'hsm-1', threadId: 'hmoth-1', author: 'doctor', body: 'Requesting an update on claim CLM-9F2A41 submitted yesterday.', createdAt: iso(1) },
    { id: 'hsm-2', threadId: 'hmoth-1', author: 'hmo',    body: 'Thank you. The claim is under review; expect a decision within 48 hours.', createdAt: iso(0) },
  ],
};

export const DEMO_HMO_FRAUD_WARNINGS: HmoFraudWarning[] = [
  {
    id: 'fw-1', severity: 'warning', title: 'Possible duplicate claim',
    body: 'A claim with the same appointment and amount was submitted within 24 hours. Verify before resubmitting.',
    relatedRef: 'CLM-9F2A41', createdAt: iso(0), acknowledged: false,
  },
  {
    id: 'fw-2', severity: 'info', title: 'Pre-auth code reused',
    body: 'Authorisation code AUTH-77K2 has been attached to more than one claim.',
    relatedRef: 'AUTH-77K2', createdAt: iso(2), acknowledged: true,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Section P — Referral & Specialist Collaboration demo data
// ═══════════════════════════════════════════════════════════════════════════

export const DEMO_INCOMING_REFERRALS: IncomingReferral[] = [
  {
    id: 'inref-1', ref: 'REF-A11C03', patient: PATIENT_TUNDE,
    fromDoctor: 'Dr. Amaka Obi', fromHospital: 'Spotlight Telehealth',
    specialty: 'Neurology', reason: 'Persistent headache with fatigue, neurology review requested.',
    urgency: 'urgent', status: 'incoming',
    attachments: [{ kind: 'note', id: 'soap-2', label: 'Initial assessment note' }],
    receivedAt: iso(0),
  },
  {
    id: 'inref-2', ref: 'REF-B22D14', patient: PATIENT_NGOZI,
    fromDoctor: 'Dr. Tunde Bello', fromHospital: 'Lagoon Medical Centre',
    specialty: 'Endocrinology', reason: 'Poorly controlled T2DM; consider insulin titration.',
    urgency: 'routine', status: 'accepted',
    attachments: [
      { kind: 'lab',  id: 'res-1', label: 'HbA1c & Lipid Profile' },
      { kind: 'note', id: 'soap-1', label: 'Consult note 16 Jun 2026' },
    ],
    receivedAt: iso(2), decidedAt: iso(1),
  },
];

export const DEMO_OPINION_REQUESTS: OpinionRequest[] = [
  {
    id: 'opn-1', ref: 'OPN-5A8E07', patient: PATIENT_CHIDI, kind: 'second',
    specialist: { id: 'sp-1', name: 'Dr. Emeka Nwosu', initials: 'EN', avatarColor: '#6366F1', specialty: 'Cardiology', hospital: 'Lagoon Medical Centre', state: 'Lagos' },
    question: 'Second opinion on ECG changes before starting anticoagulation.',
    attachments: [{ kind: 'lab', id: 'res-1', label: 'ECG report' }],
    status: 'requested', requestedAt: iso(1),
  },
  {
    id: 'opn-2', ref: 'OPN-9F2A41', patient: PATIENT_NGOZI, kind: 'specialist',
    specialist: { id: 'sp-2', name: 'Dr. Aisha Sani', initials: 'AS', avatarColor: '#EC4899', specialty: 'Endocrinology', hospital: 'Reddington Hospital', state: 'Lagos' },
    question: 'Insulin regimen suggestion for poorly controlled T2DM.',
    attachments: [{ kind: 'note', id: 'soap-1', label: 'Consult note' }],
    status: 'responded', requestedAt: iso(4), respondedAt: iso(2),
    response: 'Start basal insulin 10 units nocte, titrate by 2 units every 3 days to fasting target 5–7 mmol/L.',
  },
];

export const DEMO_CARE_TEAM_THREAD: CareTeamThread = {
  threadId: 'ctt-1', patient: PATIENT_NGOZI, caseRef: 'REF-B22D14',
  members: [
    { id: 'doc-self', name: 'Dr. Amaka Obi',   role: 'Attending' },
    { id: 'sp-2',     name: 'Dr. Aisha Sani',  role: 'Endocrinologist' },
  ],
  messages: [
    { id: 'ctm-1', threadId: 'ctt-1', authorId: 'doc-self', authorName: 'Dr. Amaka Obi',  authorRole: 'Attending',        body: 'Sharing the latest HbA1c — 7.1%. Thoughts on escalation?', createdAt: iso(1) },
    { id: 'ctm-2', threadId: 'ctt-1', authorId: 'sp-2',     authorName: 'Dr. Aisha Sani', authorRole: 'Endocrinologist',  body: 'Agree to add basal insulin. I have left a regimen in the opinion request.', createdAt: iso(0) },
  ],
};

export const DEMO_SHARED_CASE_SUMMARY: SharedCaseSummary = {
  caseRef: 'REF-B22D14', patient: PATIENT_NGOZI,
  summary: '52F with type 2 diabetes and hypertension, suboptimal glycaemic control on metformin. Referred for endocrinology input on insulin initiation.',
  diagnoses: ['Type 2 Diabetes Mellitus', 'Essential Hypertension'],
  notes: [
    {
      id: 'soap-1', appointmentId: 'apt-4', patientId: 'pat-4',
      subjective: 'Good adherence. Occasional morning dizziness.',
      objective: 'BP 132/84 mmHg, HR 74 bpm. RBG 7.2 mmol/L.',
      assessment: 'T2DM reasonably controlled. HTN stable.',
      plan: 'Continue Metformin 500mg BD. HbA1c in 3 months.',
      diagnosis: ['Type 2 Diabetes Mellitus', 'Essential Hypertension'],
      createdAt: iso(2), updatedAt: iso(2),
    },
  ],
  prescriptions: [
    {
      id: 'rx-1', ref: 'RX-4F2A41', appointmentId: 'apt-4', patient: PATIENT_NGOZI, doctorName: 'Dr. Amaka Obi',
      diagnosis: 'Type 2 Diabetes Mellitus', issuedAt: iso(2), status: 'issued',
      items: [
        { name: 'Metformin', dosage: '500mg', route: 'Oral', frequency: 'Twice daily', duration: '30 days', notes: 'Take after meals' },
        { name: 'Amlodipine', dosage: '5mg', route: 'Oral', frequency: 'Once daily', duration: '30 days' },
      ],
    },
  ],
  labResults: [
    {
      id: 'res-1', orderId: 'lab-1', ref: 'LAB-8C1B22', patient: PATIENT_NGOZI,
      values: [
        { testName: 'HbA1c', value: '7.1', unit: '%', refRange: '4.0–5.6', flag: 'high' },
        { testName: 'LDL',   value: '3.4', unit: 'mmol/L', refRange: '< 3.0', flag: 'high' },
      ],
      reportedAt: iso(1), labName: 'Synlab Nigeria', reviewed: true,
    },
  ],
  sharedWith: ['Dr. Aisha Sani'],
  updatedAt: iso(1),
};

// ═══════════════════════════════════════════════════════════════════════════
// Section Q — Follow-Up Care demo data
// ═══════════════════════════════════════════════════════════════════════════

export const DEMO_FOLLOW_UP_ELIGIBILITY: FollowUpEligibility = {
  patientId: 'pat-4', appointmentId: 'apt-4',
  freeEligible: true, windowDays: 7, daysSinceConsult: 2,
  suggestedKind: 'free', paidFeeKobo: 200000,
  reason: 'Within the 7-day free follow-up window for the originating consult.',
};

export const DEMO_LONG_TERM_CARE_PLANS: LongTermCarePlan[] = [
  {
    id: 'ltc-1', ref: 'LTC-4F2A41', patient: PATIENT_NGOZI,
    condition: 'Type 2 Diabetes Mellitus', goal: 'HbA1c < 7%',
    startedAt: isoDate(-180), reviewEvery: '3 months', active: true,
    milestones: [
      { id: 'm-1', title: 'Baseline HbA1c & lipids',   dueDate: isoDate(-180), status: 'completed', completedAt: iso(178) },
      { id: 'm-2', title: 'Quarterly HbA1c review',     dueDate: isoDate(-90),  status: 'completed', completedAt: iso(88) },
      { id: 'm-3', title: 'Quarterly HbA1c review',     dueDate: isoDate(2),    status: 'due' },
      { id: 'm-4', title: 'Annual retinopathy screen',  dueDate: isoDate(60),   status: 'upcoming' },
    ],
  },
  {
    id: 'ltc-2', ref: 'LTC-7C1B88', patient: PATIENT_CHIDI,
    condition: 'Hypertension', goal: 'BP < 140/90 mmHg',
    startedAt: isoDate(-60), reviewEvery: '1 month', active: true,
    milestones: [
      { id: 'm-5', title: 'Monthly BP check', dueDate: isoDate(-30), status: 'completed', completedAt: iso(29) },
      { id: 'm-6', title: 'Monthly BP check', dueDate: isoDate(-2),  status: 'missed' },
      { id: 'm-7', title: 'Monthly BP check', dueDate: isoDate(28),  status: 'upcoming' },
    ],
  },
];

export const DEMO_CHRONIC_MONITORING: ChronicMonitoringEntry[] = [
  { id: 'cm-1', patient: PATIENT_NGOZI, condition: 'Type 2 Diabetes Mellitus', metric: 'HbA1c',          value: '7.1%',         recordedAt: iso(1),  trend: 'improving', withinTarget: false, note: 'Down from 7.6%' },
  { id: 'cm-2', patient: PATIENT_NGOZI, condition: 'Type 2 Diabetes Mellitus', metric: 'Fasting glucose', value: '6.4 mmol/L',   recordedAt: iso(3),  trend: 'stable',    withinTarget: true },
  { id: 'cm-3', patient: PATIENT_CHIDI, condition: 'Hypertension',             metric: 'Blood Pressure',  value: '148/92 mmHg',  recordedAt: iso(2),  trend: 'worsening', withinTarget: false, note: 'Above target despite dose increase' },
];

export const DEMO_ADHERENCE_CHECKS: MedicationAdherenceCheck[] = [
  { id: 'ad-1', patient: PATIENT_NGOZI, prescriptionRef: 'RX-4F2A41', drugSummary: 'Metformin 500mg BD', level: 'good',    missedDoses: 1, periodLabel: 'Last 30 days', recordedAt: iso(1) },
  { id: 'ad-2', patient: PATIENT_CHIDI, prescriptionRef: 'RX-7C1B88', drugSummary: 'Lisinopril 10mg OD', level: 'partial', missedDoses: 6, periodLabel: 'Last 30 days', recordedAt: iso(2), note: 'Reports forgetting weekend doses' },
];

// ═══════════════════════════════════════════════════════════════════════════
// Section R — Emergency & Escalation demo data (NON-ACTIONABLE)
// ═══════════════════════════════════════════════════════════════════════════

export const DEMO_EMERGENCY_FACILITIES: EmergencyFacility[] = [
  { id: 'ef-1', kind: 'hospital',          name: 'Lagoon Emergency Centre',        distanceKm: 3.2,  etaMins: 12, contact: 'Demo line — not dialable', address: 'Ikoyi, Lagos',          open24h: true },
  { id: 'ef-2', kind: 'hospital',          name: 'Reddington Hospital A&E',        distanceKm: 5.8,  etaMins: 18, contact: 'Demo line — not dialable', address: 'Victoria Island, Lagos', open24h: true },
  { id: 'ef-3', kind: 'ambulance',         name: 'Lagos State Ambulance Service',  distanceKm: 0,    etaMins: 22, contact: 'Demo line — not dialable', address: 'Dispatch (demo)',        open24h: true },
  { id: 'ef-4', kind: 'emergency_service', name: 'National Emergency (demo)',      distanceKm: 0,    etaMins: 0,  contact: 'Demo line — not dialable', address: 'Hotline (demo)',         open24h: true },
];

export const DEMO_RED_FLAG_ALERTS: RedFlagAlert[] = [
  { id: 'rfa-1', severity: 'critical', label: 'Chest pain with radiation to arm/jaw', action: 'Refer to emergency department immediately', detectedAt: iso(0) },
  { id: 'rfa-2', severity: 'warning',  label: 'BP > 180/120 mmHg',                    action: 'Assess for hypertensive emergency',         detectedAt: iso(0) },
];

export const DEMO_EMERGENCY_ESCALATIONS: EmergencyEscalation[] = [
  {
    id: 'esc-1', ref: 'ESC-7C1B88', patient: PATIENT_TUNDE, kind: 'hospital',
    targetName: 'Lagoon Emergency Centre', status: 'notified',
    reason: 'Suspected acute coronary syndrome — chest pain with radiation.',
    facilityId: 'ef-1', initiatedAt: iso(0), updatedAt: iso(0),
    note: 'DEMO escalation — no real dispatch performed.',
  },
];

export const DEMO_EMERGENCY_CASE_RECORDS: EmergencyCaseRecord[] = [
  {
    id: 'emr-1', ref: 'EMR-5A8E07', patient: PATIENT_TUNDE, presentedAt: iso(0),
    redFlags: DEMO_RED_FLAG_ALERTS,
    actionsTaken: 'Advised to attend nearest A&E. Provided emergency referral note. Demo escalation initiated to Lagoon Emergency Centre.',
    escalations: DEMO_EMERGENCY_ESCALATIONS,
    recommendedFacility: DEMO_EMERGENCY_FACILITIES[0],
    contactNotified: true, followUpScheduled: false, disclaimerAcknowledged: true,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Read endpoints
// ═══════════════════════════════════════════════════════════════════════════

// ── Section O ──
export async function getHmoPlanCoverage(patientId: string): Promise<HmoPlanCoverage> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_HMO_PLAN_COVERAGE);
  return doctorGet<HmoPlanCoverage>(`/hmo/coverage/${patientId}`);
}

export async function getPreAuthRequests(status?: PreAuthStatus): Promise<PreAuthRequest[]> {
  if (DOCTOR_USE_MOCK) {
    const list = status ? DEMO_PRE_AUTH_REQUESTS.filter((p) => p.status === status) : DEMO_PRE_AUTH_REQUESTS;
    return wait(list);
  }
  return doctorGet<PreAuthRequest[]>('/hmo/pre-auth', { status });
}

export async function getPreAuthRequest(id: string): Promise<PreAuthRequest | undefined> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PRE_AUTH_REQUESTS.find((p) => p.id === id));
  return doctorGet<PreAuthRequest | undefined>(`/hmo/pre-auth/${id}`);
}

export async function getCoveredServices(patientId?: string): Promise<CoveredService[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_COVERED_SERVICES);
  return doctorGet<CoveredService[]>('/hmo/covered-services', { patientId });
}

export async function getHmoSupportThread(threadId: string): Promise<HmoSupportThread> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_HMO_SUPPORT_THREAD);
  return doctorGet<HmoSupportThread>(`/hmo/support/${threadId}`);
}

export async function getHmoFraudWarnings(): Promise<HmoFraudWarning[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_HMO_FRAUD_WARNINGS);
  return doctorGet<HmoFraudWarning[]>('/hmo/fraud-warnings');
}

// ── Section P ──
export async function getIncomingReferrals(status?: IncomingReferralStatus): Promise<IncomingReferral[]> {
  if (DOCTOR_USE_MOCK) {
    const list = status ? DEMO_INCOMING_REFERRALS.filter((r) => r.status === status) : DEMO_INCOMING_REFERRALS;
    return wait(list);
  }
  return doctorGet<IncomingReferral[]>('/referrals/incoming', { status });
}

export async function getIncomingReferral(id: string): Promise<IncomingReferral | undefined> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_INCOMING_REFERRALS.find((r) => r.id === id));
  return doctorGet<IncomingReferral | undefined>(`/referrals/incoming/${id}`);
}

export async function getOpinionRequests(status?: OpinionStatus): Promise<OpinionRequest[]> {
  if (DOCTOR_USE_MOCK) {
    const list = status ? DEMO_OPINION_REQUESTS.filter((o) => o.status === status) : DEMO_OPINION_REQUESTS;
    return wait(list);
  }
  return doctorGet<OpinionRequest[]>('/opinions', { status });
}

export async function getOpinionRequest(id: string): Promise<OpinionRequest | undefined> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_OPINION_REQUESTS.find((o) => o.id === id));
  return doctorGet<OpinionRequest | undefined>(`/opinions/${id}`);
}

export async function getCareTeamThread(threadId: string): Promise<CareTeamThread> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_CARE_TEAM_THREAD);
  return doctorGet<CareTeamThread>(`/care-team/${threadId}`);
}

export async function getSharedCaseSummary(caseRef: string): Promise<SharedCaseSummary> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_SHARED_CASE_SUMMARY);
  return doctorGet<SharedCaseSummary>(`/case-summaries/${caseRef}`);
}

// ── Section Q ──
export async function getFollowUpEligibility(patientId: string, appointmentId?: string): Promise<FollowUpEligibility> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_FOLLOW_UP_ELIGIBILITY);
  return doctorGet<FollowUpEligibility>(`/patients/${patientId}/follow-up-eligibility`, { appointmentId });
}

export async function getLongTermCarePlans(patientId?: string): Promise<LongTermCarePlan[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_LONG_TERM_CARE_PLANS);
  return doctorGet<LongTermCarePlan[]>('/care-plans', { patientId });
}

export async function getLongTermCarePlan(id: string): Promise<LongTermCarePlan | undefined> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_LONG_TERM_CARE_PLANS.find((p) => p.id === id));
  return doctorGet<LongTermCarePlan | undefined>(`/care-plans/${id}`);
}

export async function getChronicMonitoring(patientId?: string): Promise<ChronicMonitoringEntry[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_CHRONIC_MONITORING);
  return doctorGet<ChronicMonitoringEntry[]>('/chronic-monitoring', { patientId });
}

export async function getAdherenceChecks(patientId?: string): Promise<MedicationAdherenceCheck[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_ADHERENCE_CHECKS);
  return doctorGet<MedicationAdherenceCheck[]>('/adherence-checks', { patientId });
}

// ── Section R ──
export async function getEmergencyFacilities(kind?: EmergencyFacility['kind']): Promise<EmergencyFacility[]> {
  if (DOCTOR_USE_MOCK) {
    const list = kind ? DEMO_EMERGENCY_FACILITIES.filter((f) => f.kind === kind) : DEMO_EMERGENCY_FACILITIES;
    return wait(list);
  }
  return doctorGet<EmergencyFacility[]>('/emergency/facilities', { kind });
}

export async function getRedFlagAlerts(patientId?: string): Promise<RedFlagAlert[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_RED_FLAG_ALERTS);
  return doctorGet<RedFlagAlert[]>('/red-flag-alerts', { patientId });
}

export async function getEmergencyEscalations(patientId?: string): Promise<EmergencyEscalation[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_EMERGENCY_ESCALATIONS);
  return doctorGet<EmergencyEscalation[]>('/emergency/escalations', { patientId });
}

export async function getEmergencyCaseRecords(patientId?: string): Promise<EmergencyCaseRecord[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_EMERGENCY_CASE_RECORDS);
  return doctorGet<EmergencyCaseRecord[]>('/emergency/cases', { patientId });
}

export async function getEmergencyCaseRecord(id: string): Promise<EmergencyCaseRecord | undefined> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_EMERGENCY_CASE_RECORDS.find((r) => r.id === id));
  return doctorGet<EmergencyCaseRecord | undefined>(`/emergency/cases/${id}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Mutations
// ═══════════════════════════════════════════════════════════════════════════

// ── Section O ──
export async function requestPreAuth(input: RequestPreAuthInput): Promise<RequestPreAuthResult> {
  if (DOCTOR_USE_MOCK) {
    void input.estimatedKobo;
    const ref = `PA-${input.idempotencyKey.slice(-6).toUpperCase()}`;
    return wait({ preAuthId: `pa-${Date.now()}`, ref, status: 'pending' as PreAuthStatus }, 600);
  }
  return doctorPost<RequestPreAuthResult>('/hmo/pre-auth', input, input.idempotencyKey);
}

export async function sendHmoSupportMessage(input: SendHmoSupportMessageInput): Promise<SendHmoSupportMessageResult> {
  if (DOCTOR_USE_MOCK) {
    const message: HmoSupportMessage = {
      id: `hsm-${Date.now()}`, threadId: input.threadId, author: 'doctor',
      body: input.body, createdAt: new Date().toISOString(),
    };
    return wait({ message }, 400);
  }
  return doctorPost<SendHmoSupportMessageResult>(`/hmo/support/${input.threadId}/messages`, input, input.idempotencyKey);
}

export async function acknowledgeFraudWarning(input: AcknowledgeFraudWarningInput): Promise<AcknowledgeFraudWarningResult> {
  if (DOCTOR_USE_MOCK) return wait({ warningId: input.warningId, acknowledged: true }, 400);
  return doctorPost<AcknowledgeFraudWarningResult>(`/hmo/fraud-warnings/${input.warningId}/ack`, input, input.idempotencyKey);
}

// ── Section P ──
export async function acceptReferral(input: AcceptReferralInput): Promise<AcceptReferralResult> {
  if (DOCTOR_USE_MOCK) {
    void input.note;
    return wait({ referralId: input.referralId, status: 'accepted' as IncomingReferralStatus }, 500);
  }
  return doctorPost<AcceptReferralResult>(`/referrals/incoming/${input.referralId}/accept`, input, input.idempotencyKey);
}

export async function rejectReferral(input: RejectReferralInput): Promise<RejectReferralResult> {
  if (DOCTOR_USE_MOCK) {
    void input.rejectionReason;
    return wait({ referralId: input.referralId, status: 'rejected' as IncomingReferralStatus }, 500);
  }
  return doctorPost<RejectReferralResult>(`/referrals/incoming/${input.referralId}/reject`, input, input.idempotencyKey);
}

export async function requestOpinion(input: RequestOpinionInput): Promise<RequestOpinionResult> {
  if (DOCTOR_USE_MOCK) {
    void input.attachments;
    const ref = `OPN-${input.idempotencyKey.slice(-6).toUpperCase()}`;
    return wait({ opinionId: `opn-${Date.now()}`, ref, status: 'requested' as OpinionStatus }, 600);
  }
  return doctorPost<RequestOpinionResult>('/opinions', input, input.idempotencyKey);
}

export async function sendCareTeamMessage(input: SendCareTeamMessageInput): Promise<SendCareTeamMessageResult> {
  if (DOCTOR_USE_MOCK) {
    const message: CareTeamMessage = {
      id: `ctm-${Date.now()}`, threadId: input.threadId, authorId: 'doc-self',
      authorName: 'Dr. Amaka Obi', authorRole: 'Attending',
      body: input.body, createdAt: new Date().toISOString(),
    };
    return wait({ message }, 400);
  }
  return doctorPost<SendCareTeamMessageResult>(`/care-team/${input.threadId}/messages`, input, input.idempotencyKey);
}

// ── Section Q ──
export async function setFollowUpReminder(input: SetFollowUpReminderInput): Promise<SetFollowUpReminderResult> {
  if (DOCTOR_USE_MOCK) return wait({ followUpId: input.followUpId, remindAt: input.remindAt }, 400);
  return doctorPost<SetFollowUpReminderResult>(`/follow-ups/${input.followUpId}/reminder`, input, input.idempotencyKey);
}

export async function completeFollowUp(input: CompleteFollowUpInput): Promise<CompleteFollowUpResult> {
  if (DOCTOR_USE_MOCK) {
    void input.outcomeNote;
    const status: 'completed' | 'missed' = input.missed ? 'missed' : 'completed';
    return wait({ followUpId: input.followUpId, status }, 500);
  }
  return doctorPost<CompleteFollowUpResult>(`/follow-ups/${input.followUpId}/complete`, input, input.idempotencyKey);
}

export async function recordAdherenceCheck(input: RecordAdherenceCheckInput): Promise<RecordAdherenceCheckResult> {
  if (DOCTOR_USE_MOCK) {
    void input.missedDoses;
    return wait({ checkId: `ad-${Date.now()}`, level: input.level }, 500);
  }
  return doctorPost<RecordAdherenceCheckResult>('/adherence-checks', input, input.idempotencyKey);
}

export async function saveCarePlan(input: SaveCarePlanInput): Promise<SaveCarePlanResult> {
  if (DOCTOR_USE_MOCK) {
    void input.milestones;
    const ref = `LTC-${input.idempotencyKey.slice(-6).toUpperCase()}`;
    return wait({ carePlanId: `ltc-${Date.now()}`, ref, active: true }, 600);
  }
  return doctorPost<SaveCarePlanResult>('/care-plans', input, input.idempotencyKey);
}

// ── Section R (DEMO — non-actionable) ──
export async function escalateToHospital(input: EscalateInput): Promise<EscalateResult> {
  if (DOCTOR_USE_MOCK) {
    // DEMO ONLY — no real dispatch.
    const ref = `ESC-${input.idempotencyKey.slice(-6).toUpperCase()}`;
    return wait({ escalationId: `esc-${Date.now()}`, ref, kind: 'hospital' as EscalationKind, status: 'initiated' as EscalationStatus }, 500);
  }
  // Live integration must route to a vetted emergency-services provider.
  return doctorPost<EscalateResult>('/emergency/escalate/hospital', input, input.idempotencyKey);
}

export async function escalateToAmbulance(input: EscalateInput): Promise<EscalateResult> {
  if (DOCTOR_USE_MOCK) {
    // DEMO ONLY — no real dispatch.
    const ref = `ESC-${input.idempotencyKey.slice(-6).toUpperCase()}`;
    return wait({ escalationId: `esc-${Date.now()}`, ref, kind: 'ambulance' as EscalationKind, status: 'initiated' as EscalationStatus }, 500);
  }
  // Live integration must route to a vetted emergency-services provider.
  return doctorPost<EscalateResult>('/emergency/escalate/ambulance', input, input.idempotencyKey);
}

export async function notifyEmergencyContact(input: NotifyEmergencyContactInput): Promise<NotifyEmergencyContactResult> {
  if (DOCTOR_USE_MOCK) {
    // DEMO ONLY — no real message sent.
    void input.message;
    return wait({ patientId: input.patientId, notified: true }, 400);
  }
  return doctorPost<NotifyEmergencyContactResult>(`/emergency/contacts/${input.patientId}/notify`, input, input.idempotencyKey);
}

export async function documentEmergencyCase(input: DocumentEmergencyCaseInput): Promise<DocumentEmergencyCaseResult> {
  if (DOCTOR_USE_MOCK) {
    void input.redFlagIds;
    const ref = `EMR-${input.idempotencyKey.slice(-6).toUpperCase()}`;
    return wait({ caseId: `emr-${Date.now()}`, ref }, 600);
  }
  return doctorPost<DocumentEmergencyCaseResult>('/emergency/cases', input, input.idempotencyKey);
}

export async function scheduleEmergencyFollowUp(input: ScheduleEmergencyFollowUpInput): Promise<ScheduleEmergencyFollowUpResult> {
  if (!DOCTOR_USE_MOCK) return doctorPost<ScheduleEmergencyFollowUpResult>('/follow-ups', input, input.idempotencyKey);
  void input.reason;
  const ref = `FU-${input.idempotencyKey.slice(-6).toUpperCase()}`;
  return wait({ followUpId: `fu-${Date.now()}`, ref, status: 'scheduled' as FollowUpStatus }, 600);
}
