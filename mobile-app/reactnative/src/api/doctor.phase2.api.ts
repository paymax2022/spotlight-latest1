// ── Doctor (Telemedicine, provider-side) — Phase 2 API client ────────────────
// Phase A style: every function resolves demo data so screens render without a
// live API. `DEMO_*` exports double as `placeholderData` in useQuery. ADDITIVE
// to `@/api/doctor.api` — Phase 1 fns/exports are untouched.
//
// TODO(Phase C): replace each body with the live endpoint, e.g.
//   const res = await api.get('/api/v1/doctor/pharmacy/fulfilments'); return res.data.data;
// and pass the Idempotency-Key header on every mutation below.

import { Colors } from '@/constants/colors';
import type {
  PharmacyFulfilment,
  DrugDelivery,
  RefillRequest,
  Specialist,
  SpecialistReferral,
  PatientRecordHub,
  HmoClaim,
  FollowUpPlan,
  ReputationSummary,
  PayoutReport,
  ComplianceDashboard,
  RefillStatus,
  ReferralStatus,
  ClaimStatus,
  FollowUpStatus,
  PharmacyFulfilmentStatus,
  ReviewSubstituteInput,
  ReviewSubstituteResult,
  ReviewRefillInput,
  ReviewRefillResult,
  CreateReferralInput,
  CreateReferralResult,
  SubmitClaimInput,
  SubmitClaimResult,
  DisputeClaimInput,
  DisputeClaimResult,
  CreateFollowUpInput,
  CreateFollowUpResult,
  ReviewFollowUpRequestInput,
  ReviewFollowUpRequestResult,
  ReportReviewInput,
  ReportReviewResult,
  AcknowledgePolicyInput,
  AcknowledgePolicyResult,
} from '@/types/doctor.phase2';

// Re-export the shared money formatter (re-exported by Phase 1 from telemedicine)
// so Phase 2 screens can import it from this module too.
export { formatKobo } from '@/api/doctor.api';
import { DOCTOR_USE_MOCK, doctorGet, doctorPost } from '@/api/doctor.client';

// Simulate network latency so loading states are exercised in the UI.
const wait = <T>(value: T, ms = 350): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

const iso = (daysAgo: number): string => new Date(Date.now() - daysAgo * 86400000).toISOString();
const isoDate = (daysFromNow: number): string =>
  new Date(Date.now() + daysFromNow * 86400000).toISOString().slice(0, 10);

// Demo patients — mirror the Phase 1 set so records cross-reference cleanly.
const PATIENT_TUNDE  = { id: 'pat-1', name: 'Tunde Akinwale', initials: 'TA', avatarColor: Colors.secondary, age: 34, gender: 'male' as const };
const PATIENT_FATIMA = { id: 'pat-2', name: 'Fatima Bello',   initials: 'FB', avatarColor: '#EC4899',        age: 28, gender: 'female' as const };
const PATIENT_CHIDI  = { id: 'pat-3', name: 'Chidi Okeke',    initials: 'CO', avatarColor: '#F59E0B',        age: 45, gender: 'male' as const };
const PATIENT_NGOZI  = { id: 'pat-4', name: 'Ngozi Adeyemi',  initials: 'NA', avatarColor: Colors.teal,      age: 52, gender: 'female' as const };

// ─── Demo data: 1. Pharmacy fulfilment / substitution ────────────────────────

export const DEMO_PHARMACY_FULFILMENTS: PharmacyFulfilment[] = [
  {
    id: 'pf-1', ref: 'PF-7C1B88', prescriptionId: 'rx-2', prescriptionRef: 'RX-7C1B88',
    patient: PATIENT_CHIDI, pharmacyName: 'HealthPlus Pharmacy, Lekki', status: 'substitute_requested',
    requestedAt: iso(0),
    substitute: {
      originalName: 'Lisinopril 10mg', substituteName: 'Enalapril 10mg', dosage: '10mg',
      reason: 'Lisinopril out of stock', priceDeltaKobo: -15000,
      pharmacistNote: 'Equivalent ACE inhibitor, in stock and slightly cheaper.',
    },
  },
  {
    id: 'pf-2', ref: 'PF-4F2A41', prescriptionId: 'rx-1', prescriptionRef: 'RX-4F2A41',
    patient: PATIENT_NGOZI, pharmacyName: 'MedPlus Pharmacy, Ikeja', status: 'preparing',
    requestedAt: iso(2),
  },
];

// ─── Demo data: 2. Drug delivery tracking ────────────────────────────────────

export const DEMO_DRUG_DELIVERIES: DrugDelivery[] = [
  {
    id: 'dlv-1', ref: 'DLV-3D0F12', fulfilmentId: 'pf-2', prescriptionRef: 'RX-4F2A41',
    patient: PATIENT_NGOZI, currentStage: 'out_for_delivery', courier: 'Gokada',
    trackingCode: 'GK-99183', addressMasked: '12 Adeola Odeku St, Victoria Island …',
    etaLabel: 'Today, 4–6 PM', feeKobo: 120000,
    timeline: [
      { stage: 'confirmed',        label: 'Order confirmed',     at: iso(2), completed: true,  note: 'Prescription accepted by MedPlus' },
      { stage: 'dispensed',        label: 'Medication dispensed', at: iso(1), completed: true },
      { stage: 'picked_up',        label: 'Picked up by courier', at: iso(1), completed: true,  note: 'Courier assigned: Gokada' },
      { stage: 'in_transit',       label: 'In transit',          at: iso(0), completed: true },
      { stage: 'out_for_delivery', label: 'Out for delivery',    at: iso(0), completed: true },
      { stage: 'delivered',        label: 'Delivered',           at: '',     completed: false },
    ],
  },
];

// ─── Demo data: 3. Refill requests ───────────────────────────────────────────

export const DEMO_REFILL_REQUESTS: RefillRequest[] = [
  {
    id: 'rf-1', ref: 'RF-8C1B22', prescriptionId: 'rx-1', prescriptionRef: 'RX-4F2A41',
    patient: PATIENT_NGOZI, drugSummary: 'Metformin 500mg, Amlodipine 5mg',
    items: [
      { name: 'Metformin', dosage: '500mg', route: 'Oral', frequency: 'Twice daily', duration: '30 days', notes: 'Take after meals' },
      { name: 'Amlodipine', dosage: '5mg', route: 'Oral', frequency: 'Once daily', duration: '30 days' },
    ],
    reason: 'Ran out of monthly supply, condition stable.', requestedAt: iso(0),
    status: 'pending', lastDispensedAt: isoDate(-30),
  },
  {
    id: 'rf-2', ref: 'RF-3D0F90', prescriptionId: 'rx-2', prescriptionRef: 'RX-7C1B88',
    patient: PATIENT_CHIDI, drugSummary: 'Lisinopril 10mg',
    items: [{ name: 'Lisinopril', dosage: '10mg', route: 'Oral', frequency: 'Once daily', duration: '28 days' }],
    reason: 'Continuing BP management.', requestedAt: iso(3),
    status: 'approved', lastDispensedAt: isoDate(-28), reviewedAt: iso(2),
  },
];

// ─── Demo data: 4. Specialists & referrals ───────────────────────────────────

export const DEMO_SPECIALISTS: Specialist[] = [
  { id: 'sp-1', name: 'Dr. Emeka Nwosu',  initials: 'EN', avatarColor: '#6366F1', specialty: 'Cardiology',  hospital: 'Lagoon Medical Centre',  state: 'Lagos' },
  { id: 'sp-2', name: 'Dr. Aisha Sani',   initials: 'AS', avatarColor: '#EC4899', specialty: 'Endocrinology', hospital: 'Reddington Hospital',  state: 'Lagos' },
  { id: 'sp-3', name: 'Dr. Bola Adey... ', initials: 'BA', avatarColor: '#10B981', specialty: 'Nephrology',  hospital: 'St Nicholas Hospital',   state: 'Lagos' },
  { id: 'sp-4', name: 'Dr. Kunle Ojo',    initials: 'KO', avatarColor: '#F59E0B', specialty: 'Neurology',    hospital: 'First Cardiology Consultants', state: 'Lagos' },
];

export const DEMO_REFERRALS: SpecialistReferral[] = [
  {
    id: 'ref-1', ref: 'REF-5A8E07', patient: PATIENT_NGOZI, specialist: DEMO_SPECIALISTS[1],
    reason: 'Poorly controlled type 2 diabetes despite metformin; consider insulin titration.',
    urgency: 'routine', status: 'sent',
    attachments: [
      { kind: 'lab',  id: 'res-1', label: 'HbA1c & Lipid Profile (LAB-8C1B22)' },
      { kind: 'note', id: 'soap-1', label: 'Consult note 16 Jun 2026' },
    ],
    createdAt: iso(2),
  },
  {
    id: 'ref-2', ref: 'REF-9F2A41', patient: PATIENT_TUNDE, specialist: DEMO_SPECIALISTS[3],
    reason: 'Persistent headache with fatigue, neurology review requested.',
    urgency: 'urgent', status: 'accepted',
    attachments: [{ kind: 'note', id: 'soap-2', label: 'Initial assessment note' }],
    createdAt: iso(1), scheduledAt: new Date(Date.now() + 3 * 86400000).toISOString(),
  },
];

// ─── Demo data: 5. Patient record hub ────────────────────────────────────────

export const DEMO_PATIENT_RECORD_HUB: PatientRecordHub = {
  patient: PATIENT_NGOZI,
  consults: [
    {
      id: 'soap-1', appointmentId: 'apt-4', patientId: 'pat-4',
      subjective: 'Good adherence to medication. Occasional morning dizziness.',
      objective: 'BP 132/84 mmHg, HR 74 bpm. RBG 7.2 mmol/L.',
      assessment: 'Type 2 DM, reasonably controlled. Hypertension stable.',
      plan: 'Continue Metformin 500mg BD. Reduce Amlodipine to 5mg. HbA1c in 3 months.',
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
  labOrders: [
    {
      id: 'lab-1', ref: 'LAB-8C1B22', appointmentId: 'apt-4', patient: PATIENT_NGOZI,
      tests: [
        { id: 'lt-hba1c', name: 'Glycated Haemoglobin', code: 'HbA1c', category: 'Chemistry' },
        { id: 'lt-lipid', name: 'Lipid Profile', code: 'LIPID', category: 'Chemistry' },
      ],
      clinicalNote: 'Diabetes monitoring.', status: 'resulted', orderedAt: iso(2), priority: 'routine',
    },
  ],
  labResults: [
    {
      id: 'res-1', orderId: 'lab-1', ref: 'LAB-8C1B22', patient: PATIENT_NGOZI,
      values: [
        { testName: 'HbA1c',             value: '7.1', unit: '%',      refRange: '4.0–5.6', flag: 'high' },
        { testName: 'Total Cholesterol', value: '4.8', unit: 'mmol/L', refRange: '< 5.2',   flag: 'normal' },
        { testName: 'LDL',               value: '3.4', unit: 'mmol/L', refRange: '< 3.0',   flag: 'high' },
      ],
      reportedAt: iso(1), labName: 'Synlab Nigeria', reviewed: true,
    },
  ],
  documents: [
    { id: 'rd-1', kind: 'discharge_summary', title: 'Discharge summary — 2024 admission', fileName: 'discharge-2024.pdf', uploadedAt: iso(200), source: 'Lagoon Medical Centre' },
    { id: 'rd-2', kind: 'imaging',           title: 'Chest X-ray report',                 fileName: 'cxr-report.pdf',     uploadedAt: iso(45),  source: 'Synlab Nigeria' },
    { id: 'rd-3', kind: 'referral_letter',   title: 'Endocrinology referral letter',      fileName: 'ref-endo.pdf',       uploadedAt: iso(2),   source: 'Dr. Amaka Obi' },
  ],
  diagnoses: [
    { id: 'dx-1', code: 'E11', label: 'Type 2 Diabetes Mellitus', diagnosedAt: isoDate(-365), doctorName: 'Dr. Amaka Obi', status: 'chronic' },
    { id: 'dx-2', code: 'I10', label: 'Essential Hypertension',   diagnosedAt: isoDate(-540), doctorName: 'Dr. Tunde Bello', status: 'chronic' },
  ],
  referrals: [
    {
      id: 'ref-1', ref: 'REF-5A8E07', patient: PATIENT_NGOZI, specialist: DEMO_SPECIALISTS[1],
      reason: 'Poorly controlled type 2 diabetes; consider insulin titration.', urgency: 'routine', status: 'sent',
      attachments: [{ kind: 'lab', id: 'res-1', label: 'HbA1c & Lipid Profile' }], createdAt: iso(2),
    },
  ],
  accessLog: [
    { id: 'al-1', actor: 'Dr. Amaka Obi', role: 'Attending Physician', action: 'viewed',   section: 'Lab results',    at: iso(1) },
    { id: 'al-2', actor: 'Dr. Amaka Obi', role: 'Attending Physician', action: 'updated',   section: 'Diagnoses',      at: iso(2) },
    { id: 'al-3', actor: 'Dr. Aisha Sani', role: 'Referred Specialist', action: 'viewed',   section: 'Consult notes',  at: iso(2) },
    { id: 'al-4', actor: 'Dr. Amaka Obi', role: 'Attending Physician', action: 'exported',  section: 'Full record',    at: iso(3) },
  ],
};

// ─── Demo data: 6. HMO claims ────────────────────────────────────────────────

export const DEMO_HMO_CLAIMS: HmoClaim[] = [
  {
    id: 'clm-1', ref: 'CLM-9F2A41', appointmentId: 'apt-2', patient: PATIENT_FATIMA,
    provider: 'Hygeia HMO', authCode: 'AUTH-91X4', status: 'under_review',
    claimedKobo: 400000, approvedKobo: 0, submittedAt: iso(1),
    lineItems: [
      { description: 'Teleconsultation (audio)', amountKobo: 350000, covered: true },
      { description: 'Pre-authorisation fee',    amountKobo: 50000,  covered: true },
    ],
    timeline: [
      { status: 'submitted',    label: 'Claim submitted',  at: iso(1) },
      { status: 'under_review', label: 'Under review',      at: iso(0), note: 'Awaiting HMO adjudication' },
    ],
  },
  {
    id: 'clm-2', ref: 'CLM-5A8E07', appointmentId: 'apt-4', patient: PATIENT_NGOZI,
    provider: 'Avon HMO', authCode: 'AUTH-77K2', status: 'approved',
    claimedKobo: 500000, approvedKobo: 450000, submittedAt: iso(5), decidedAt: iso(2),
    lineItems: [
      { description: 'Teleconsultation (video)', amountKobo: 350000, covered: true },
      { description: 'HbA1c test',               amountKobo: 100000, covered: true },
      { description: 'Lipid profile',            amountKobo: 50000,  covered: false },
    ],
    timeline: [
      { status: 'submitted',    label: 'Claim submitted', at: iso(5) },
      { status: 'under_review', label: 'Under review',     at: iso(4) },
      { status: 'approved',     label: 'Approved',         at: iso(2), note: 'Lipid profile not covered under plan' },
    ],
  },
  {
    id: 'clm-3', ref: 'CLM-7C1B88', appointmentId: 'apt-3', patient: PATIENT_CHIDI,
    provider: 'Hygeia HMO', status: 'rejected',
    claimedKobo: 350000, approvedKobo: 0, submittedAt: iso(8), decidedAt: iso(6),
    lineItems: [{ description: 'Teleconsultation (chat)', amountKobo: 350000, covered: false }],
    timeline: [
      { status: 'submitted', label: 'Claim submitted', at: iso(8) },
      { status: 'rejected',  label: 'Rejected',        at: iso(6), note: 'No valid pre-authorisation code' },
    ],
    rejectionReason: 'Missing pre-authorisation code at point of service.',
  },
];

// ─── Demo data: 7. Follow-up plans ───────────────────────────────────────────

export const DEMO_FOLLOW_UPS: FollowUpPlan[] = [
  {
    id: 'fu-1', ref: 'FU-4F2A41', patient: PATIENT_NGOZI, appointmentId: 'apt-4',
    reason: 'Review HbA1c results and adjust medication.', dueDate: isoDate(14),
    kind: 'paid', feeKobo: 200000, status: 'scheduled', createdAt: iso(2), isPatientRequest: false,
  },
  {
    id: 'fu-2', ref: 'FU-7C1B88', patient: PATIENT_CHIDI, appointmentId: 'apt-3',
    reason: 'BP recheck after dose increase.', dueDate: isoDate(7),
    kind: 'free', feeKobo: 0, status: 'scheduled', createdAt: iso(1), isPatientRequest: false,
  },
  {
    id: 'fu-3', ref: 'FU-9F2A41', patient: PATIENT_TUNDE,
    reason: 'Patient requests follow-up — headache not improving.', dueDate: isoDate(3),
    kind: 'paid', feeKobo: 350000, status: 'requested', createdAt: iso(0), isPatientRequest: true,
  },
];

// ─── Demo data: 8. Ratings & reviews ─────────────────────────────────────────

export const DEMO_REPUTATION: ReputationSummary = {
  averageRating: 4.9, totalReviews: 312,
  breakdown: [
    { stars: 5, count: 268 },
    { stars: 4, count: 33 },
    { stars: 3, count: 7 },
    { stars: 2, count: 3 },
    { stars: 1, count: 1 },
  ],
  metrics: { avgResponseMins: 6, completionRate: 98, satisfactionScore: 96, rebookRate: 64 },
  reviews: [
    { id: 'rev-1', patient: PATIENT_TUNDE,  rating: 5, comment: 'Very thorough and patient. Explained everything clearly.', createdAt: iso(3),  consultType: 'video', reported: false },
    { id: 'rev-2', patient: PATIENT_FATIMA, rating: 5, comment: 'Quick to respond and reassuring.', createdAt: iso(6),  consultType: 'audio', reported: false, doctorReply: 'Thank you, Fatima — take care!' },
    { id: 'rev-3', patient: PATIENT_CHIDI,  rating: 2, comment: 'Call dropped twice, felt rushed.', createdAt: iso(9),  consultType: 'chat',  reported: true },
    { id: 'rev-4', patient: PATIENT_NGOZI,  rating: 4, comment: 'Good advice, slight wait before the consult.', createdAt: iso(12), consultType: 'video', reported: false },
  ],
};

// ─── Demo data: 9. Payout report ─────────────────────────────────────────────

export const DEMO_PAYOUT_REPORT: PayoutReport = {
  rangeLabel: 'Jan – Jun 2026',
  grossKobo: 28500000, commissionKobo: 4275000, vatKobo: 320625, netKobo: 23904375,
  commissionRatePct: 15, vatRatePct: 7.5, consultCount: 81,
  periods: [
    { periodLabel: 'Jun 2026', consultCount: 12, grossKobo: 4200000, commissionKobo: 630000, vatKobo: 47250, netKobo: 3522750 },
    { periodLabel: 'May 2026', consultCount: 16, grossKobo: 5600000, commissionKobo: 840000, vatKobo: 63000, netKobo: 4697000 },
    { periodLabel: 'Apr 2026', consultCount: 14, grossKobo: 4900000, commissionKobo: 735000, vatKobo: 55125, netKobo: 4109875 },
    { periodLabel: 'Mar 2026', consultCount: 13, grossKobo: 4550000, commissionKobo: 682500, vatKobo: 51187, netKobo: 3816313 },
    { periodLabel: 'Feb 2026', consultCount: 12, grossKobo: 4200000, commissionKobo: 630000, vatKobo: 47250, netKobo: 3522750 },
    { periodLabel: 'Jan 2026', consultCount: 14, grossKobo: 5050000, commissionKobo: 757500, vatKobo: 56813, netKobo: 4235687 },
  ],
  payouts: [
    { id: 'po-1', ref: 'PO-2026-014', amountKobo: 2100000, status: 'paid', consultCount: 6, periodLabel: '16–31 May 2026', paidAt: iso(18) },
    { id: 'po-2', ref: 'PO-2026-013', amountKobo: 1750000, status: 'paid', consultCount: 5, periodLabel: '01–15 May 2026', paidAt: iso(33) },
    { id: 'po-3', ref: 'PO-2026-015', amountKobo: 1240000, status: 'pending', consultCount: 4, periodLabel: '01–15 Jun 2026' },
  ],
};

// ─── Demo data: 10. Compliance dashboard ─────────────────────────────────────

export const DEMO_COMPLIANCE: ComplianceDashboard = {
  licence: {
    mdcnNumber: 'MDCN/R/45821', status: 'expiring_soon',
    issuedAt: isoDate(-700), expiresAt: isoDate(45), daysToExpiry: 45,
  },
  consents: [
    { id: 'cs-1', patient: PATIENT_TUNDE,  scope: 'Telemedicine consultation', grantedAt: iso(3), active: true },
    { id: 'cs-2', patient: PATIENT_NGOZI,  scope: 'Data sharing with specialist', grantedAt: iso(2), expiresAt: new Date(Date.now() + 90 * 86400000).toISOString(), active: true },
    { id: 'cs-3', patient: PATIENT_CHIDI,  scope: 'Telemedicine consultation', grantedAt: iso(20), expiresAt: iso(1), active: false },
  ],
  auditEntries: [
    { id: 'ae-1', action: 'login',                detail: 'Signed in from Lagos, NG (iOS)', actor: 'Dr. Amaka Obi', at: iso(0) },
    { id: 'ae-2', action: 'record_access',        detail: 'Viewed Ngozi Adeyemi medical record', actor: 'Dr. Amaka Obi', at: iso(0) },
    { id: 'ae-3', action: 'prescription_issued',  detail: 'Issued RX-4F2A41', actor: 'Dr. Amaka Obi', at: iso(2) },
    { id: 'ae-4', action: 'data_export',          detail: 'Exported patient record (PDF)', actor: 'Dr. Amaka Obi', at: iso(3) },
    { id: 'ae-5', action: 'settings_changed',     detail: 'Updated payout bank account', actor: 'Dr. Amaka Obi', at: iso(10) },
  ],
  alerts: [
    { id: 'ca-1', severity: 'warning',  title: 'Licence expiring soon', body: 'Your MDCN licence expires in 45 days. Renew to avoid suspension.', createdAt: iso(1), resolved: false },
    { id: 'ca-2', severity: 'info',     title: 'New data-protection policy', body: 'Policy v3.1 requires acknowledgement.', createdAt: iso(2), resolved: false },
    { id: 'ca-3', severity: 'critical', title: 'Consent expired', body: 'Consent for Chidi Okeke has lapsed; renew before next consult.', createdAt: iso(1), resolved: false },
  ],
  acknowledgements: [
    { id: 'pa-1', policyKey: 'data_protection_2026', title: 'Data Protection Policy', version: 'v3.1', required: true,  acknowledged: false },
    { id: 'pa-2', policyKey: 'teleconsult_code',     title: 'Teleconsultation Code of Conduct', version: 'v2.0', required: true,  acknowledged: true, acknowledgedAt: iso(40) },
    { id: 'pa-3', policyKey: 'prescribing_guideline', title: 'E-Prescribing Guidelines', version: 'v1.4', required: false, acknowledged: true, acknowledgedAt: iso(60) },
  ],
};

// ─── Read endpoints ──────────────────────────────────────────────────────────

export async function getPharmacyFulfilments(): Promise<PharmacyFulfilment[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PHARMACY_FULFILMENTS);
  return doctorGet<PharmacyFulfilment[]>('/pharmacy/fulfilments');
}

export async function getPharmacyFulfilment(id: string): Promise<PharmacyFulfilment | undefined> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PHARMACY_FULFILMENTS.find((f) => f.id === id));
  return doctorGet<PharmacyFulfilment | undefined>(`/pharmacy/fulfilments/${id}`);
}

export async function getDrugDeliveries(): Promise<DrugDelivery[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_DRUG_DELIVERIES);
  return doctorGet<DrugDelivery[]>('/drug-deliveries');
}

export async function getDrugDelivery(fulfilmentId: string): Promise<DrugDelivery | undefined> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_DRUG_DELIVERIES.find((d) => d.fulfilmentId === fulfilmentId));
  return doctorGet<DrugDelivery | undefined>(`/pharmacy/fulfilments/${fulfilmentId}/delivery`);
}

export async function getRefillRequests(status?: RefillStatus): Promise<RefillRequest[]> {
  if (DOCTOR_USE_MOCK) {
    const list = status ? DEMO_REFILL_REQUESTS.filter((r) => r.status === status) : DEMO_REFILL_REQUESTS;
    return wait(list);
  }
  return doctorGet<RefillRequest[]>('/refills', { status });
}

export async function getRefillRequest(id: string): Promise<RefillRequest | undefined> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_REFILL_REQUESTS.find((r) => r.id === id));
  return doctorGet<RefillRequest | undefined>(`/refills/${id}`);
}

export async function getSpecialists(specialty?: string): Promise<Specialist[]> {
  if (DOCTOR_USE_MOCK) {
    const list = specialty ? DEMO_SPECIALISTS.filter((s) => s.specialty === specialty) : DEMO_SPECIALISTS;
    return wait(list);
  }
  return doctorGet<Specialist[]>('/specialists', { specialty });
}

export async function getReferrals(status?: ReferralStatus): Promise<SpecialistReferral[]> {
  if (DOCTOR_USE_MOCK) {
    const list = status ? DEMO_REFERRALS.filter((r) => r.status === status) : DEMO_REFERRALS;
    return wait(list);
  }
  return doctorGet<SpecialistReferral[]>('/referrals', { status });
}

export async function getReferral(id: string): Promise<SpecialistReferral | undefined> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_REFERRALS.find((r) => r.id === id));
  return doctorGet<SpecialistReferral | undefined>(`/referrals/${id}`);
}

export async function getPatientRecordHub(patientId: string): Promise<PatientRecordHub> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PATIENT_RECORD_HUB);
  return doctorGet<PatientRecordHub>(`/patients/${patientId}/record-hub`);
}

export async function getHmoClaims(status?: ClaimStatus): Promise<HmoClaim[]> {
  if (DOCTOR_USE_MOCK) {
    const list = status ? DEMO_HMO_CLAIMS.filter((c) => c.status === status) : DEMO_HMO_CLAIMS;
    return wait(list);
  }
  return doctorGet<HmoClaim[]>('/hmo/claims', { status });
}

export async function getHmoClaim(id: string): Promise<HmoClaim | undefined> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_HMO_CLAIMS.find((c) => c.id === id));
  return doctorGet<HmoClaim | undefined>(`/hmo/claims/${id}`);
}

export async function getFollowUps(status?: FollowUpStatus): Promise<FollowUpPlan[]> {
  if (DOCTOR_USE_MOCK) {
    const list = status ? DEMO_FOLLOW_UPS.filter((f) => f.status === status) : DEMO_FOLLOW_UPS;
    return wait(list);
  }
  return doctorGet<FollowUpPlan[]>('/follow-ups', { status });
}

export async function getFollowUp(id: string): Promise<FollowUpPlan | undefined> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_FOLLOW_UPS.find((f) => f.id === id));
  return doctorGet<FollowUpPlan | undefined>(`/follow-ups/${id}`);
}

export async function getReputation(): Promise<ReputationSummary> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_REPUTATION);
  return doctorGet<ReputationSummary>('/reputation');
}

export async function getPayoutReport(rangeLabel?: string): Promise<PayoutReport> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PAYOUT_REPORT);
  return doctorGet<PayoutReport>('/payout-report', { rangeLabel });
}

export async function getComplianceDashboard(): Promise<ComplianceDashboard> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_COMPLIANCE);
  return doctorGet<ComplianceDashboard>('/compliance');
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export async function reviewSubstitute(input: ReviewSubstituteInput): Promise<ReviewSubstituteResult> {
  if (DOCTOR_USE_MOCK) {
    const status: PharmacyFulfilmentStatus = input.decision === 'approve' ? 'preparing' : 'cancelled';
    return wait({ fulfilmentId: input.fulfilmentId, status }, 500);
  }
  return doctorPost<ReviewSubstituteResult>(`/pharmacy/fulfilments/${input.fulfilmentId}/substitute`, input, input.idempotencyKey);
}

export async function reviewRefill(input: ReviewRefillInput): Promise<ReviewRefillResult> {
  if (DOCTOR_USE_MOCK) {
    const status: RefillStatus = input.decision === 'approve' ? 'approved' : 'rejected';
    return wait({ refillId: input.refillId, status }, 500);
  }
  return doctorPost<ReviewRefillResult>(`/refills/${input.refillId}/review`, input, input.idempotencyKey);
}

export async function createReferral(input: CreateReferralInput): Promise<CreateReferralResult> {
  if (DOCTOR_USE_MOCK) {
    const ref = `REF-${input.idempotencyKey.slice(-6).toUpperCase()}`;
    return wait({ referralId: `ref-${Date.now()}`, ref, status: 'sent' as ReferralStatus }, 600);
  }
  return doctorPost<CreateReferralResult>('/referrals', input, input.idempotencyKey);
}

export async function submitClaim(input: SubmitClaimInput): Promise<SubmitClaimResult> {
  if (DOCTOR_USE_MOCK) {
    void input.lineItems;
    const ref = `CLM-${input.idempotencyKey.slice(-6).toUpperCase()}`;
    return wait({ claimId: `clm-${Date.now()}`, ref, status: 'submitted' as ClaimStatus }, 600);
  }
  return doctorPost<SubmitClaimResult>('/hmo/claims', input, input.idempotencyKey);
}

export async function disputeClaim(input: DisputeClaimInput): Promise<DisputeClaimResult> {
  if (DOCTOR_USE_MOCK) {
    void input.reason;
    return wait({ claimId: input.claimId, status: 'disputed' as ClaimStatus }, 500);
  }
  return doctorPost<DisputeClaimResult>(`/hmo/claims/${input.claimId}/dispute`, input, input.idempotencyKey);
}

export async function createFollowUp(input: CreateFollowUpInput): Promise<CreateFollowUpResult> {
  if (DOCTOR_USE_MOCK) {
    void input.feeKobo;
    const ref = `FU-${input.idempotencyKey.slice(-6).toUpperCase()}`;
    return wait({ followUpId: `fu-${Date.now()}`, ref, status: 'scheduled' as FollowUpStatus }, 600);
  }
  return doctorPost<CreateFollowUpResult>('/follow-ups', input, input.idempotencyKey);
}

export async function reviewFollowUpRequest(input: ReviewFollowUpRequestInput): Promise<ReviewFollowUpRequestResult> {
  if (DOCTOR_USE_MOCK) {
    const status: FollowUpStatus = input.decision === 'approve' ? 'approved' : 'rejected';
    return wait({ followUpId: input.followUpId, status }, 500);
  }
  return doctorPost<ReviewFollowUpRequestResult>(`/follow-ups/${input.followUpId}/review`, input, input.idempotencyKey);
}

export async function reportReview(input: ReportReviewInput): Promise<ReportReviewResult> {
  if (DOCTOR_USE_MOCK) {
    void input.reason;
    return wait({ reviewId: input.reviewId, reported: true }, 500);
  }
  return doctorPost<ReportReviewResult>(`/reviews/${input.reviewId}/report`, input, input.idempotencyKey);
}

export async function acknowledgePolicy(input: AcknowledgePolicyInput): Promise<AcknowledgePolicyResult> {
  if (DOCTOR_USE_MOCK) {
    void input.version;
    return wait({ policyKey: input.policyKey, acknowledged: true }, 500);
  }
  return doctorPost<AcknowledgePolicyResult>(`/compliance/policies/${input.policyKey}/ack`, input, input.idempotencyKey);
}
