// ── Doctor (Telemedicine, provider-side) — Batch 6 API client ────────────────
// Batch 6 = spec sections W · X · Y · Z (Medical Records · Notifications ·
// Earnings/Wallet/Payout · Ratings/Reputation). Phase A style: every function
// resolves demo data so screens render without a live API; `DEMO_*` exports
// double as `placeholderData` in useQuery. ADDITIVE to the Phase 1 / Phase 2 /
// Section B / Phase 3 / Batch 1-5 api files — nothing earlier changes.
//
// CONSOLIDATED + heavy REUSE of the Phase 1 notification/earnings demo data, the
// Phase 2 reputation/payout-report/record-hub demo data and the Phase 3 quality
// analytics. Money is always an integer in kobo.
//
// TODO(Phase C): replace each body with the live endpoint and pass the
//   Idempotency-Key header on every mutation below.

import { Colors } from '@/constants/colors';
import { DEMO_NOTIFICATIONS } from '@/api/doctor.api';
import { DEMO_REPUTATION } from '@/api/doctor.phase2.api';
import type {
  DoctorRecordsDashboard,
  PatientRecordIndex,
  RecordRestriction,
  RestrictedRecordWarning,
  RecordShare,
  RecordCategory,
  RichNotification,
  NotificationGroup,
  NotificationPreference,
  NotificationCategory,
  EarningsBreakdown,
  WalletBalance,
  PayoutDetail,
  Invoice,
  CommissionBreakdown,
  TaxVatReport,
  SettlementDispute,
  BankAccount,
  ConsultationFeedback,
  QualityScore,
  RankingInsight,
  ImprovementRecommendation,
  ReviewDispute,
  DownloadPatientRecordInput,
  DownloadPatientRecordResult,
  SharePatientRecordInput,
  SharePatientRecordResult,
  RequestRecordAccessInput,
  RequestRecordAccessResult,
  MarkNotificationReadInput,
  MarkNotificationReadResult,
  MarkAllNotificationsReadInput,
  MarkAllNotificationsReadResult,
  UpdateNotificationPrefsInput,
  UpdateNotificationPrefsResult,
  WithdrawEarningsInput,
  WithdrawEarningsResult,
  UpdatePayoutBankAccountInput,
  UpdatePayoutBankAccountResult,
  RaiseSettlementDisputeInput,
  RaiseSettlementDisputeResult,
  DisputeReviewInput,
  DisputeReviewResult,
  RequestReviewRemovalInput,
  RequestReviewRemovalResult,
} from '@/types/doctor.batch6';

// Re-export the shared money formatter so Batch 6 screens can import it here too.
export { formatKobo } from '@/api/doctor.api';
import { DOCTOR_USE_MOCK, doctorGet, doctorPost, doctorPut } from '@/api/doctor.client';

// Simulate network latency so loading states are exercised in the UI.
const wait = <T>(value: T, ms = 350): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

const iso = (daysAgo: number): string => new Date(Date.now() - daysAgo * 86400000).toISOString();
const isoDate = (daysFromNow: number): string =>
  new Date(Date.now() + daysFromNow * 86400000).toISOString().slice(0, 10);

// Shared demo patient summaries (mirror the Phase 2 demo set).
const PATIENT_TUNDE  = { id: 'pat-1', name: 'Tunde Akinwale', initials: 'TA', avatarColor: Colors.secondary, age: 34, gender: 'male' as const };
const PATIENT_FATIMA = { id: 'pat-2', name: 'Fatima Bello',   initials: 'FB', avatarColor: '#EC4899',        age: 28, gender: 'female' as const };
const PATIENT_CHIDI  = { id: 'pat-3', name: 'Chidi Okeke',    initials: 'CO', avatarColor: '#F59E0B',        age: 45, gender: 'male' as const };
const PATIENT_NGOZI  = { id: 'pat-4', name: 'Ngozi Adeyemi',  initials: 'NA', avatarColor: Colors.teal,      age: 52, gender: 'female' as const };

// Shared demo bank account (mirrors the Section B BankAccount shape).
const DEMO_BANK_ACCOUNT: BankAccount = {
  bankName: 'GTBank', bankCode: '058', accountNumber: '0123456789', accountName: 'Dr. Amaka Obi', isVerified: true,
};

// ═══════════════════════════════════════════════════════════════════════════
// SECTION W — MEDICAL RECORDS
// ═══════════════════════════════════════════════════════════════════════════

export const DEMO_RECORDS_DASHBOARD: DoctorRecordsDashboard = {
  totalPatients: 128,
  recentPatients: [
    { patient: PATIENT_TUNDE,  lastVisitAt: iso(0), recordCount: 14, hasRestricted: false },
    { patient: PATIENT_FATIMA, lastVisitAt: iso(1), recordCount: 9,  hasRestricted: true },
    { patient: PATIENT_CHIDI,  lastVisitAt: iso(3), recordCount: 21, hasRestricted: false },
    { patient: PATIENT_NGOZI,  lastVisitAt: iso(6), recordCount: 17, hasRestricted: true },
  ],
  categoryCounts: [
    { category: 'consultations', count: 412, lastUpdated: iso(0) },
    { category: 'prescriptions', count: 286, lastUpdated: iso(0) },
    { category: 'lab_results',   count: 154, lastUpdated: iso(1) },
    { category: 'documents',     count: 98,  lastUpdated: iso(2) },
    { category: 'imaging',       count: 41,  lastUpdated: iso(4) },
    { category: 'referrals',     count: 33,  lastUpdated: iso(5) },
    { category: 'hmo',           count: 67,  lastUpdated: iso(1) },
    { category: 'pets',          count: 24,  lastUpdated: iso(3) },
  ],
  pendingShares: 2,
};

export const DEMO_PATIENT_RECORD_INDEX: PatientRecordIndex = {
  patient: PATIENT_TUNDE,
  updatedAt: iso(0),
  entries: [
    { category: 'consultations', count: 6, lastUpdated: iso(0),  restricted: false },
    { category: 'prescriptions', count: 4, lastUpdated: iso(0),  restricted: false },
    { category: 'lab_results',   count: 3, lastUpdated: iso(2),  restricted: false },
    { category: 'documents',     count: 2, lastUpdated: iso(9),  restricted: false },
    { category: 'imaging',       count: 1, lastUpdated: iso(14), restricted: false },
    { category: 'allergies',     count: 2, lastUpdated: iso(40), restricted: false },
    { category: 'medications',   count: 3, lastUpdated: iso(0),  restricted: false },
    { category: 'diagnoses',     count: 2, lastUpdated: iso(0),  restricted: false },
    { category: 'care_plans',    count: 1, lastUpdated: iso(0),  restricted: false },
    { category: 'referrals',     count: 1, lastUpdated: iso(3),  restricted: false },
    { category: 'hmo',           count: 1, lastUpdated: iso(2),  restricted: true  },
    { category: 'dependents',    count: 2, lastUpdated: iso(20), restricted: false },
  ],
};

export const DEMO_RECORD_RESTRICTIONS: RecordRestriction[] = [
  { category: 'hmo',         level: 'consent_required', reason: 'HMO records require active patient consent.', canRequestAccess: true },
  { category: 'diagnoses',   level: 'restricted',       reason: 'Mental-health diagnoses are access-controlled.', canRequestAccess: true },
  { category: 'documents',   level: 'blocked',          reason: 'Sealed by patient request.', canRequestAccess: false },
];

export const DEMO_RESTRICTED_WARNINGS: RestrictedRecordWarning[] = [
  { patientId: 'pat-2', category: 'diagnoses', level: 'restricted', message: 'Access to mental-health notes is logged and requires consent.', detectedAt: iso(0) },
];

export const DEMO_RECORD_SHARES: RecordShare[] = [
  {
    id: 'shr-1', ref: 'SHR-7C1B88', patientId: 'pat-1', patientName: 'Tunde Akinwale',
    specialistId: 'sp-1', specialistName: 'Dr. Ngozi Eze',
    categories: ['consultations', 'lab_results', 'imaging'], status: 'viewed',
    sharedAt: iso(2), expiresAt: isoDate(28) + 'T00:00:00.000Z', note: 'For orthopaedic review.',
  },
  {
    id: 'shr-2', ref: 'SHR-3D0F90', patientId: 'pat-2', patientName: 'Fatima Bello',
    specialistId: 'sp-2', specialistName: 'Dr. Sola Adeyemi',
    categories: ['lab_results'], status: 'pending', sharedAt: iso(0),
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// SECTION X — NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════
// Rich notifications COMPOSE the Phase 1 DoctorNotification set, adding kind /
// category / severity / cta. The first few derive from DEMO_NOTIFICATIONS so the
// existing centre and the rich centre stay consistent.

export const DEMO_RICH_NOTIFICATIONS: RichNotification[] = [
  {
    id: 'rn-1', type: 'appointment', title: 'New appointment', body: 'Tunde Akinwale booked a video consult for 09:00 AM.',
    createdAt: iso(0), read: false, kind: 'new_appointment', category: 'appointments', severity: 'info',
    cta: { label: 'View appointment', route: '/(doctor)/(tabs)/appointments' },
  },
  {
    id: 'rn-2', type: 'appointment', title: 'Appointment cancelled', body: 'Chidi Okeke cancelled the 11:30 AM consult.',
    createdAt: iso(0), read: false, kind: 'appointment_cancelled', category: 'appointments', severity: 'warning',
  },
  {
    id: 'rn-3', type: 'appointment', title: 'Patient waiting', body: 'Fatima Bello is in the waiting room.',
    createdAt: iso(0), read: false, kind: 'patient_waiting', category: 'appointments', severity: 'info',
    cta: { label: 'Open queue', route: '/(doctor)/(tabs)/queue' },
  },
  {
    id: 'rn-4', type: 'message', title: 'New message', body: 'Tunde Akinwale sent you a message.',
    createdAt: iso(0), read: true, kind: 'new_chat_message', category: 'messages', severity: 'info',
    cta: { label: 'Reply', route: '/(doctor)/chat/thread-1' }, groupKey: 'thread-1',
  },
  {
    id: 'rn-5', type: 'message', title: 'Refill request', body: 'Ngozi Adeyemi requested a refill for Amlodipine 5mg.',
    createdAt: iso(1), read: false, kind: 'prescription_refill_request', category: 'clinical', severity: 'info',
  },
  {
    id: 'rn-6', type: 'lab_result', title: 'Lab result ready', body: 'FBC results for Tunde Akinwale are available.',
    createdAt: iso(1), read: true, kind: 'lab_result_ready', category: 'clinical', severity: 'success',
  },
  {
    id: 'rn-7', type: 'lab_result', title: 'Critical lab result', body: 'Potassium 6.4 mmol/L for Chidi Okeke — review urgently.',
    createdAt: iso(1), read: false, kind: 'critical_lab_result', category: 'clinical', severity: 'critical',
    cta: { label: 'Review result', route: '/(doctor)/lab-results' },
  },
  {
    id: 'rn-8', type: 'message', title: 'Substitution request', body: 'VetMeds Pharmacy proposed a substitute for Carprofen.',
    createdAt: iso(2), read: false, kind: 'pharmacy_substitution_request', category: 'pharmacy', severity: 'warning',
  },
  {
    id: 'rn-9', type: 'message', title: 'Delivery update', body: 'Drug delivery DLV-3D0F12 is out for delivery.',
    createdAt: iso(2), read: true, kind: 'drug_delivery_update', category: 'pharmacy', severity: 'info',
  },
  {
    id: 'rn-10', type: 'system', title: 'HMO claim approved', body: 'Hygeia HMO approved claim CLM-9F2A41 (₦42,000).',
    createdAt: iso(2), read: true, kind: 'hmo_approval', category: 'hmo', severity: 'success',
  },
  {
    id: 'rn-11', type: 'system', title: 'HMO claim rejected', body: 'Reliance HMO rejected claim CLM-7C1B88.',
    createdAt: iso(3), read: false, kind: 'hmo_rejection', category: 'hmo', severity: 'warning',
  },
  {
    id: 'rn-12', type: 'payout', title: 'Payout sent', body: 'Payout PO-2026-014 (₦21,000) was paid to GTBank ****6789.',
    createdAt: iso(3), read: true, kind: 'payout', category: 'earnings', severity: 'success',
    cta: { label: 'View payout', route: '/(doctor)/earnings/report' },
  },
  {
    id: 'rn-13', type: 'verification', title: 'Compliance notice', body: 'Annual data-protection policy v3.1 needs acknowledgement.',
    createdAt: iso(4), read: false, kind: 'compliance', category: 'compliance', severity: 'warning',
  },
  {
    id: 'rn-14', type: 'verification', title: 'Licence renewal due', body: 'Your MDCN licence expires in 45 days.',
    createdAt: iso(4), read: false, kind: 'licence_renewal', category: 'compliance', severity: 'warning',
  },
  {
    id: 'rn-15', type: 'system', title: 'New review', body: 'Ngozi Adeyemi left you a 4-star review.',
    createdAt: iso(5), read: true, kind: 'rating_review', category: 'reputation', severity: 'info',
    cta: { label: 'View reviews', route: '/(doctor)/reviews' },
  },
  {
    id: 'rn-16', type: 'system', title: 'Support replied', body: 'Support responded to ticket TKT-1042.',
    createdAt: iso(6), read: true, kind: 'support_response', category: 'support', severity: 'info',
  },
];

const NOTIFICATION_GROUP_LABELS: Record<NotificationCategory, string> = {
  appointments: 'Appointments',
  messages:     'Messages',
  clinical:     'Clinical',
  pharmacy:     'Pharmacy',
  hmo:          'HMO',
  earnings:     'Earnings',
  compliance:   'Compliance',
  reputation:   'Reputation',
  support:      'Support',
};

export const DEMO_NOTIFICATION_PREFERENCES: NotificationPreference[] = [
  { category: 'appointments', label: 'Appointments', push: true,  email: true,  sms: true  },
  { category: 'messages',     label: 'Messages',     push: true,  email: false, sms: false },
  { category: 'clinical',     label: 'Clinical',     push: true,  email: true,  sms: false },
  { category: 'pharmacy',     label: 'Pharmacy',     push: true,  email: false, sms: false },
  { category: 'hmo',          label: 'HMO',          push: true,  email: true,  sms: false },
  { category: 'earnings',     label: 'Earnings',     push: true,  email: true,  sms: false },
  { category: 'compliance',   label: 'Compliance',   push: true,  email: true,  sms: true  },
  { category: 'reputation',   label: 'Reputation',   push: false, email: true,  sms: false },
  { category: 'support',      label: 'Support',      push: true,  email: true,  sms: false },
];

// Group rich notifications by category for the grouped centre view.
function groupNotifications(list: RichNotification[]): NotificationGroup[] {
  const order: NotificationCategory[] = [
    'appointments', 'messages', 'clinical', 'pharmacy', 'hmo', 'earnings', 'compliance', 'reputation', 'support',
  ];
  return order
    .map((cat) => {
      const notifications = list.filter((n) => n.category === cat);
      return {
        key:         cat,
        label:       NOTIFICATION_GROUP_LABELS[cat],
        unreadCount: notifications.filter((n) => !n.read).length,
        notifications,
      };
    })
    .filter((g) => g.notifications.length > 0);
}

export const DEMO_NOTIFICATION_GROUPS: NotificationGroup[] = groupNotifications(DEMO_RICH_NOTIFICATIONS);

// ═══════════════════════════════════════════════════════════════════════════
// SECTION Y — EARNINGS, WALLET & PAYOUT
// ═══════════════════════════════════════════════════════════════════════════

export const DEMO_EARNINGS_BREAKDOWN: EarningsBreakdown = {
  todayKobo: 600000, weekKobo: 3150000, monthKobo: 12400000, lifetimeKobo: 28500000,
  periods: [
    {
      period: 'today', grossKobo: 600000,
      bySource: [
        { source: 'consult', amountKobo: 450000, consultCount: 2 },
        { source: 'hmo',     amountKobo: 100000, consultCount: 1 },
        { source: 'vet',     amountKobo: 50000,  consultCount: 0 },
        { source: 'bonus',   amountKobo: 0,      consultCount: 0 },
      ],
    },
    {
      period: 'week', grossKobo: 3150000,
      bySource: [
        { source: 'consult', amountKobo: 2100000, consultCount: 9 },
        { source: 'hmo',     amountKobo: 600000,  consultCount: 4 },
        { source: 'vet',     amountKobo: 350000,  consultCount: 2 },
        { source: 'bonus',   amountKobo: 100000,  consultCount: 0 },
      ],
    },
    {
      period: 'month', grossKobo: 12400000,
      bySource: [
        { source: 'consult', amountKobo: 8400000, consultCount: 32 },
        { source: 'hmo',     amountKobo: 2400000, consultCount: 14 },
        { source: 'vet',     amountKobo: 1300000, consultCount: 6  },
        { source: 'bonus',   amountKobo: 300000,  consultCount: 0  },
      ],
    },
  ],
};

export const DEMO_WALLET_BALANCE: WalletBalance = {
  availableKobo: 1240000, pendingKobo: 600000, ledgerKobo: 1840000,
  ledger: [
    { id: 'wl-1', label: 'Consult fee — TM-9F2A41', amountKobo: 250000,  balanceKobo: 1840000, at: iso(0) },
    { id: 'wl-2', label: 'HMO settlement — CLM-9F2A41', amountKobo: 100000, balanceKobo: 1590000, at: iso(1) },
    { id: 'wl-3', label: 'Vet consult — VET-9F2A41', amountKobo: 300000,  balanceKobo: 1490000, at: iso(1) },
    { id: 'wl-4', label: 'Payout — PO-2026-014',     amountKobo: -2100000, balanceKobo: 1190000, at: iso(18) },
  ],
};

export const DEMO_PAYOUT_DETAILS: PayoutDetail[] = [
  {
    id: 'po-1', ref: 'PO-2026-014', amountKobo: 2100000, feeKobo: 10000, netKobo: 2090000, status: 'paid',
    consultCount: 6, periodLabel: '16–31 May 2026', bankAccount: DEMO_BANK_ACCOUNT,
    requestedAt: iso(19), paidAt: iso(18), sessionId: 'stl_9F2A41',
  },
  {
    id: 'po-3', ref: 'PO-2026-015', amountKobo: 1240000, feeKobo: 10000, netKobo: 1230000, status: 'pending',
    consultCount: 4, periodLabel: '01–15 Jun 2026', bankAccount: DEMO_BANK_ACCOUNT, requestedAt: iso(1),
  },
  {
    id: 'po-4', ref: 'PO-2026-016', amountKobo: 980000, feeKobo: 10000, netKobo: 970000, status: 'failed',
    consultCount: 3, periodLabel: '01–15 Jun 2026', bankAccount: DEMO_BANK_ACCOUNT,
    requestedAt: iso(4), failureReason: 'Bank rejected: account name mismatch.',
  },
];

export const DEMO_INVOICES: Invoice[] = [
  {
    id: 'inv-1', ref: 'INV-2026-018', issuedAt: isoDate(-12), periodLabel: 'May 2026',
    lineItems: [
      { description: 'Teleconsultations (video/audio/chat)', quantity: 16, unitKobo: 350000, amountKobo: 5600000 },
      { description: 'HMO consultations',                     quantity: 4,  unitKobo: 250000, amountKobo: 1000000 },
    ],
    subtotalKobo: 6600000, vatKobo: 495000, totalKobo: 7095000, status: 'paid',
  },
  {
    id: 'inv-2', ref: 'INV-2026-019', issuedAt: isoDate(-2), periodLabel: 'Jun 2026',
    lineItems: [
      { description: 'Teleconsultations (video/audio/chat)', quantity: 9, unitKobo: 350000, amountKobo: 3150000 },
    ],
    subtotalKobo: 3150000, vatKobo: 236250, totalKobo: 3386250, status: 'issued',
  },
];

export const DEMO_COMMISSION_BREAKDOWN: CommissionBreakdown = {
  rangeLabel: 'Jun 2026', grossKobo: 12400000, commissionKobo: 1860000, netKobo: 10540000,
  tiers: [
    { source: 'consult', grossKobo: 8400000, commissionRatePct: 15, commissionKobo: 1260000, netKobo: 7140000 },
    { source: 'hmo',     grossKobo: 2400000, commissionRatePct: 15, commissionKobo: 360000,  netKobo: 2040000 },
    { source: 'vet',     grossKobo: 1300000, commissionRatePct: 15, commissionKobo: 195000,  netKobo: 1105000 },
    { source: 'bonus',   grossKobo: 300000,  commissionRatePct: 15, commissionKobo: 45000,   netKobo: 255000  },
  ],
};

export const DEMO_TAX_VAT_REPORT: TaxVatReport = {
  rangeLabel: 'Jan – Jun 2026 (FY2026)', grossKobo: 28500000, vatableKobo: 28500000,
  vatKobo: 2137500, vatRatePct: 7.5, whtKobo: 1425000, whtRatePct: 5,
  tin: '12345678-0001', vatNumber: 'NG-VAT-998877',
};

export const DEMO_SETTLEMENT_DISPUTES: SettlementDispute[] = [
  {
    id: 'dsp-1', ref: 'DSP-2026-004', payoutId: 'po-4', payoutRef: 'PO-2026-016', amountKobo: 980000,
    reason: 'Payout marked failed but account details are correct.', status: 'under_review', raisedAt: iso(3),
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// SECTION Z — RATINGS, REVIEWS & REPUTATION
// ═══════════════════════════════════════════════════════════════════════════

export const DEMO_CONSULT_FEEDBACK: ConsultationFeedback[] = [
  {
    id: 'cf-1', consultRef: 'TM-9F2A41', patient: PATIENT_TUNDE, channel: 'human', rating: 5,
    comment: 'Very thorough and patient.', tags: ['Clear explanation', 'Punctual'], createdAt: iso(3),
  },
  {
    id: 'cf-2', consultRef: 'TM-7C1B88', patient: PATIENT_FATIMA, channel: 'human', rating: 5,
    comment: 'Quick to respond and reassuring.', tags: ['Fast response', 'Empathetic'], createdAt: iso(6),
  },
  {
    id: 'cf-3', consultRef: 'VET-9F2A41', patient: PATIENT_CHIDI, channel: 'vet', rating: 4,
    comment: 'Helpful advice for my parrot.', tags: ['Knowledgeable'], createdAt: iso(9),
  },
];

export const DEMO_QUALITY_SCORE: QualityScore = {
  scorePct: 92, grade: 'excellent', updatedAt: iso(0),
  factors: [
    { key: 'rating',        label: 'Patient rating',     scorePct: 98, weightPct: 40 },
    { key: 'response_time', label: 'Response time',      scorePct: 88, weightPct: 25 },
    { key: 'completion',    label: 'Completion rate',    scorePct: 98, weightPct: 20 },
    { key: 'satisfaction',  label: 'Satisfaction',       scorePct: 96, weightPct: 15 },
  ],
};

export const DEMO_RANKING_INSIGHT: RankingInsight = {
  specialty: 'General Practice', percentile: 95, rankLabel: 'Top 5% of GPs on Spotlight',
  movement: 'up', movementPlaces: 3,
  peerStats: [
    { label: 'Avg rating',    yourValue: 4.9, peerMedian: 4.5, unit: '★',   betterIsHigh: true },
    { label: 'Response time', yourValue: 6,   peerMedian: 12,  unit: 'min', betterIsHigh: false },
    { label: 'Completion',    yourValue: 98,  peerMedian: 90,  unit: '%',   betterIsHigh: true },
  ],
};

export const DEMO_IMPROVEMENT_RECOMMENDATIONS: ImprovementRecommendation[] = [
  { id: 'ir-1', title: 'Reduce first-response time', detail: 'Aim to reply to new chats within 5 minutes to lift your response-time score.', priority: 'medium', metricKey: 'response_time', potentialUpliftPct: 4 },
  { id: 'ir-2', title: 'Add discharge summaries', detail: 'Attach a short summary to completed consults to improve completeness.', priority: 'low', metricKey: 'completion', potentialUpliftPct: 2 },
];

export const DEMO_REVIEW_DISPUTES: ReviewDispute[] = [
  {
    id: 'rvd-1', ref: 'RVD-2026-007', reviewId: 'rev-3', reason: 'factually_incorrect',
    detail: 'The call did not drop — connection logs show a stable 18-minute session.',
    status: 'under_review', raisedAt: iso(8),
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// READ ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// ── Section W ──
export async function getRecordsDashboard(): Promise<DoctorRecordsDashboard> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_RECORDS_DASHBOARD);
  return doctorGet<DoctorRecordsDashboard>('/records/dashboard');
}

export async function getPatientRecordIndex(patientId: string): Promise<PatientRecordIndex> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PATIENT_RECORD_INDEX);
  return doctorGet<PatientRecordIndex>(`/records/${patientId}/index`);
}

export async function getRecordRestrictions(patientId: string): Promise<RecordRestriction[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_RECORD_RESTRICTIONS);
  return doctorGet<RecordRestriction[]>(`/records/${patientId}/restrictions`);
}

export async function getRestrictedRecordWarnings(patientId: string): Promise<RestrictedRecordWarning[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_RESTRICTED_WARNINGS);
  return doctorGet<RestrictedRecordWarning[]>(`/records/${patientId}/restricted-warnings`);
}

export async function getRecordShares(): Promise<RecordShare[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_RECORD_SHARES);
  return doctorGet<RecordShare[]>('/records/shares');
}

// ── Section X ──
export async function getRichNotifications(): Promise<RichNotification[]> {
  if (DOCTOR_USE_MOCK) {
    void DEMO_NOTIFICATIONS;
    return wait(DEMO_RICH_NOTIFICATIONS);
  }
  return doctorGet<RichNotification[]>('/notifications');
}

export async function getNotificationGroups(): Promise<NotificationGroup[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_NOTIFICATION_GROUPS);
  return doctorGet<NotificationGroup[]>('/notifications/groups');
}

export async function getNotificationPreferences(): Promise<NotificationPreference[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_NOTIFICATION_PREFERENCES);
  return doctorGet<NotificationPreference[]>('/notifications/preferences');
}

// ── Section Y ──
export async function getEarningsBreakdown(): Promise<EarningsBreakdown> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_EARNINGS_BREAKDOWN);
  return doctorGet<EarningsBreakdown>('/earnings/breakdown');
}

export async function getWalletBalance(): Promise<WalletBalance> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_WALLET_BALANCE);
  return doctorGet<WalletBalance>('/wallet/balance');
}

export async function getPayoutDetails(): Promise<PayoutDetail[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PAYOUT_DETAILS);
  return doctorGet<PayoutDetail[]>('/payouts');
}

export async function getPayoutDetail(id: string): Promise<PayoutDetail | undefined> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_PAYOUT_DETAILS.find((p) => p.id === id));
  return doctorGet<PayoutDetail | undefined>(`/payouts/${id}`);
}

export async function getInvoices(): Promise<Invoice[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_INVOICES);
  return doctorGet<Invoice[]>('/invoices');
}

export async function getCommissionBreakdown(rangeLabel?: string): Promise<CommissionBreakdown> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_COMMISSION_BREAKDOWN);
  return doctorGet<CommissionBreakdown>('/earnings/commission', { rangeLabel });
}

export async function getTaxVatReport(rangeLabel?: string): Promise<TaxVatReport> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_TAX_VAT_REPORT);
  return doctorGet<TaxVatReport>('/earnings/tax-vat', { rangeLabel });
}

export async function getSettlementDisputes(): Promise<SettlementDispute[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_SETTLEMENT_DISPUTES);
  return doctorGet<SettlementDispute[]>('/payouts/disputes');
}

// ── Section Z ──
export async function getConsultationFeedback(): Promise<ConsultationFeedback[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_CONSULT_FEEDBACK);
  return doctorGet<ConsultationFeedback[]>('/feedback');
}

export async function getQualityScore(): Promise<QualityScore> {
  if (DOCTOR_USE_MOCK) {
    void DEMO_REPUTATION;
    return wait(DEMO_QUALITY_SCORE);
  }
  return doctorGet<QualityScore>('/quality/score');
}

export async function getRankingInsight(): Promise<RankingInsight> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_RANKING_INSIGHT);
  return doctorGet<RankingInsight>('/quality/ranking');
}

export async function getImprovementRecommendations(): Promise<ImprovementRecommendation[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_IMPROVEMENT_RECOMMENDATIONS);
  return doctorGet<ImprovementRecommendation[]>('/quality/recommendations');
}

export async function getReviewDisputes(): Promise<ReviewDispute[]> {
  if (DOCTOR_USE_MOCK) return wait(DEMO_REVIEW_DISPUTES);
  return doctorGet<ReviewDispute[]>('/reviews/disputes');
}

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

// ── Section W ──
export async function downloadPatientRecord(input: DownloadPatientRecordInput): Promise<DownloadPatientRecordResult> {
  if (!DOCTOR_USE_MOCK) return doctorPost<DownloadPatientRecordResult>(`/records/${input.patientId}/export`, input, input.idempotencyKey);
  return wait({
    descriptor: {
      patientId:   input.patientId,
      categories:  input.categories,
      format:      input.format,
      fileName:    `record-${input.patientId}-${Date.now()}.${input.format === 'fhir_json' ? 'json' : input.format}`,
      generatedAt: iso(0),
    },
  }, 700);
}

export async function sharePatientRecordWithSpecialist(input: SharePatientRecordInput): Promise<SharePatientRecordResult> {
  if (DOCTOR_USE_MOCK) {
    void input.categories;
    const ref = `SHR-${input.idempotencyKey.slice(-6).toUpperCase()}`;
    return wait({ shareId: `shr-${Date.now()}`, ref, status: 'sent' as RecordShare['status'] }, 600);
  }
  return doctorPost<SharePatientRecordResult>(`/records/${input.patientId}/share`, input, input.idempotencyKey);
}

export async function requestRecordAccess(input: RequestRecordAccessInput): Promise<RequestRecordAccessResult> {
  if (DOCTOR_USE_MOCK) {
    void input.reason;
    return wait({ patientId: input.patientId, category: input.category, requested: true }, 500);
  }
  return doctorPost<RequestRecordAccessResult>(`/records/${input.patientId}/access-request`, input, input.idempotencyKey);
}

// ── Section X ──
export async function markNotificationRead(input: MarkNotificationReadInput): Promise<MarkNotificationReadResult> {
  if (DOCTOR_USE_MOCK) return wait({ notificationId: input.notificationId, read: true }, 350);
  return doctorPost<MarkNotificationReadResult>(`/notifications/${input.notificationId}/read`, input, input.idempotencyKey);
}

export async function markAllNotificationsRead(input: MarkAllNotificationsReadInput): Promise<MarkAllNotificationsReadResult> {
  if (DOCTOR_USE_MOCK) {
    const count = input.category
      ? DEMO_RICH_NOTIFICATIONS.filter((n) => n.category === input.category && !n.read).length
      : DEMO_RICH_NOTIFICATIONS.filter((n) => !n.read).length;
    return wait({ markedCount: count }, 400);
  }
  return doctorPost<MarkAllNotificationsReadResult>('/notifications/read-all', input, input.idempotencyKey);
}

export async function updateNotificationPrefs(input: UpdateNotificationPrefsInput): Promise<UpdateNotificationPrefsResult> {
  if (DOCTOR_USE_MOCK) return wait({ preferences: input.preferences }, 500);
  return doctorPut<UpdateNotificationPrefsResult>('/notifications/preferences', input, input.idempotencyKey);
}

// ── Section Y ──
export async function withdrawEarnings(input: WithdrawEarningsInput): Promise<WithdrawEarningsResult> {
  if (DOCTOR_USE_MOCK) {
    void input.bankAccount;
    void input.amountKobo;
    const ref = `PO-${input.idempotencyKey.slice(-6).toUpperCase()}`;
    return wait({ payoutId: `po-${Date.now()}`, ref, status: 'pending' as PayoutDetail['status'] }, 700);
  }
  return doctorPost<WithdrawEarningsResult>('/payouts', input, input.idempotencyKey);
}

export async function updatePayoutBankAccount(input: UpdatePayoutBankAccountInput): Promise<UpdatePayoutBankAccountResult> {
  if (!DOCTOR_USE_MOCK) return doctorPut<UpdatePayoutBankAccountResult>('/payout-account', input, input.idempotencyKey);
  return wait({
    account: {
      bankName:      input.bankName,
      bankCode:      input.bankCode,
      accountNumber: input.accountNumber,
      accountName:   'Dr. Amaka Obi',
      isVerified:    true,
    },
  }, 700);
}

export async function raiseSettlementDispute(input: RaiseSettlementDisputeInput): Promise<RaiseSettlementDisputeResult> {
  if (DOCTOR_USE_MOCK) {
    void input.reason;
    void input.amountKobo;
    const ref = `DSP-${input.idempotencyKey.slice(-6).toUpperCase()}`;
    return wait({ disputeId: `dsp-${Date.now()}`, ref, status: 'open' as SettlementDispute['status'] }, 600);
  }
  return doctorPost<RaiseSettlementDisputeResult>(`/payouts/${input.payoutId}/dispute`, input, input.idempotencyKey);
}

// ── Section Z ──
export async function disputeReview(input: DisputeReviewInput): Promise<DisputeReviewResult> {
  if (DOCTOR_USE_MOCK) {
    void input.detail;
    const ref = `RVD-${input.idempotencyKey.slice(-6).toUpperCase()}`;
    return wait({ disputeId: `rvd-${Date.now()}`, ref, status: 'open' as ReviewDispute['status'] }, 600);
  }
  return doctorPost<DisputeReviewResult>(`/reviews/${input.reviewId}/dispute`, input, input.idempotencyKey);
}

export async function requestReviewRemoval(input: RequestReviewRemovalInput): Promise<RequestReviewRemovalResult> {
  if (DOCTOR_USE_MOCK) {
    void input.reason;
    return wait({ reviewId: input.reviewId, requested: true }, 500);
  }
  return doctorPost<RequestReviewRemovalResult>(`/reviews/${input.reviewId}/removal-request`, input, input.idempotencyKey);
}
