// ── Spotlight Academy — EdTech School-Fees module · API layer ────────────────
// Typed, mock-first data layer the PA-/SA- screens code against. With USE_MOCK
// (EXPO_PUBLIC_ACADEMY_FEES_USE_MOCK, default true) the whole surface runs with
// NO backend. Flip the flag to hit the live member routes on the frontend-web
// proxy → Go /api/finance/academy/{fees,competition}/*.
//
// IRON RULES honoured here:
//  • Money amounts are integers in minor units (kobo).
//  • SF-2 — invoice balance is DERIVED from settled payment events, never a
//    free-standing column: paidKobo accumulates; status recomputes from it.
//  • SF-6 — an installment plan's first payment is blocked until the disclosure
//    is acknowledged (acceptInstallmentDisclosure sets disclosureAcceptedAt).
//  • SF-7 — the competition serializer strips PII by default; only entries with
//    consentGiven expose a full name/avatar. The mock mirrors that server rule.
//  • SF-4 — competition reads share no service with fees; nothing here consults
//    payment status to gate academic/competition access.

import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { USE_MOCK, ACADEMY_FEES_API_BASE } from './constants';
import type {
  FeesChild,
  Invoice,
  InstallmentPlan,
  PaymentResult,
  PayMethod,
  Receipt,
  FeesVault,
  AutoSaveRule,
  HardshipRequest,
  SponsorshipOpportunity,
  SponsorshipPledge,
  DirectorySchool,
  CompetitionLeaderboard,
  CompetitionLeaderboardEntry,
  LeaderboardScope,
  Tournament,
  CompetitionChallenge,
  ChallengeResult,
  CompetitionBadge,
  CompetitionReward,
  CompetitionProfile,
} from './types';

const B = ACADEMY_FEES_API_BASE;
const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));

// Unwrap the backend envelope { data: … } while tolerating a bare payload.
function unwrap<T>(res: { data?: { data?: T } & T }): T {
  return (res.data?.data ?? res.data) as T;
}

// ── SF-2 helper: recompute invoice status from its derived balance ───────────
function statusFromBalance(inv: Invoice): Invoice['status'] {
  if (inv.status === 'waived' || inv.status === 'cancelled' || inv.status === 'draft') return inv.status;
  if (inv.paidKobo >= inv.totalKobo) return 'paid';
  if (inv.paidKobo > 0) {
    return new Date(inv.dueDate).getTime() < Date.now() ? 'overdue' : 'part_paid';
  }
  return new Date(inv.dueDate).getTime() < Date.now() ? 'overdue' : 'issued';
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK FIXTURES — rich enough that every screen is fully populated.
// ═══════════════════════════════════════════════════════════════════════════════

const MOCK_CHILDREN: FeesChild[] = [
  {
    id: 'chd_ada', firstName: 'Adaeze', lastName: 'Okafor', schoolId: 'sch_brightstars',
    schoolName: 'Bright Stars Academy', classLabel: 'JSS 2', admissionNumber: 'BSA/2023/041',
    avatarColorKey: 'iconBgPurple', isMinor: true, linked: true, outstandingKobo: 8_500_000,
    nextDueDate: '2026-08-01',
  },
  {
    id: 'chd_emeka', firstName: 'Emeka', lastName: 'Okafor', schoolId: 'sch_grace',
    schoolName: 'Grace Comprehensive', classLabel: 'SS 3', admissionNumber: 'GCS/2021/118',
    avatarColorKey: 'iconBgTeal', isMinor: true, linked: true, outstandingKobo: 0,
    nextDueDate: undefined,
  },
  {
    id: 'chd_zara', firstName: 'Zara', lastName: 'Okafor', schoolId: 'sch_brightstars',
    schoolName: 'Bright Stars Academy', classLabel: 'Primary 4', admissionNumber: 'BSA/2024/207',
    avatarColorKey: 'iconBgGold', isMinor: true, linked: false, outstandingKobo: 0,
  },
];

const MOCK_INVOICES: Invoice[] = [
  {
    id: 'inv_ada_t1', childId: 'chd_ada', childName: 'Adaeze Okafor', schoolId: 'sch_brightstars',
    schoolName: 'Bright Stars Academy', term: 'First Term 2025/26', classLabel: 'JSS 2',
    reference: 'FEES-BSA-ADA-T1', totalKobo: 12_500_000, paidKobo: 4_000_000, status: 'part_paid',
    issuedAt: '2026-06-15', dueDate: '2026-08-01', hasInstallmentPlan: true, installmentEligible: true,
    items: [
      { id: 'li1', label: 'Tuition', amountKobo: 9_000_000 },
      { id: 'li2', label: 'PTA levy', amountKobo: 1_500_000 },
      { id: 'li3', label: 'Exam & records', amountKobo: 1_200_000 },
      { id: 'li4', label: 'Excursion (optional)', amountKobo: 800_000, optional: true },
    ],
  },
  {
    id: 'inv_emeka_t1', childId: 'chd_emeka', childName: 'Emeka Okafor', schoolId: 'sch_grace',
    schoolName: 'Grace Comprehensive', term: 'First Term 2025/26', classLabel: 'SS 3',
    reference: 'FEES-GCS-EME-T1', totalKobo: 15_800_000, paidKobo: 15_800_000, status: 'paid',
    issuedAt: '2026-06-10', dueDate: '2026-07-20', hasInstallmentPlan: false, installmentEligible: true,
    items: [
      { id: 'li1', label: 'Tuition', amountKobo: 11_000_000 },
      { id: 'li2', label: 'WAEC/NECO registration', amountKobo: 3_300_000 },
      { id: 'li3', label: 'Practical & lab', amountKobo: 1_500_000 },
    ],
  },
  {
    id: 'inv_ada_uniform', childId: 'chd_ada', childName: 'Adaeze Okafor', schoolId: 'sch_brightstars',
    schoolName: 'Bright Stars Academy', term: 'First Term 2025/26', classLabel: 'JSS 2',
    reference: 'FEES-BSA-ADA-UNI', totalKobo: 2_200_000, paidKobo: 0, status: 'issued',
    issuedAt: '2026-06-15', dueDate: '2026-09-15', hasInstallmentPlan: false, installmentEligible: false,
    items: [
      { id: 'li1', label: 'Uniform set (2)', amountKobo: 1_400_000 },
      { id: 'li2', label: 'Sportswear', amountKobo: 800_000 },
    ],
  },
];

const MOCK_INSTALLMENT_PLANS: Record<string, InstallmentPlan> = {
  inv_ada_t1: {
    id: 'plan_ada_t1', invoiceId: 'inv_ada_t1', count: 3, totalKobo: 12_500_000,
    disclosureAcceptedAt: '2026-06-16', createdAt: '2026-06-16',
    installments: [
      { id: 'ins1', seq: 1, amountKobo: 4_000_000, dueDate: '2026-06-20', status: 'paid', paidAt: '2026-06-18' },
      { id: 'ins2', seq: 2, amountKobo: 4_500_000, dueDate: '2026-08-01', status: 'due' },
      { id: 'ins3', seq: 3, amountKobo: 4_000_000, dueDate: '2026-09-15', status: 'scheduled' },
    ],
  },
};

const MOCK_RECEIPTS: Receipt[] = [
  {
    id: 'rcp_1', invoiceId: 'inv_emeka_t1', childName: 'Emeka Okafor', schoolName: 'Grace Comprehensive',
    term: 'First Term 2025/26', amountKobo: 15_800_000, method: 'wallet', paidAt: '2026-06-28',
    reference: 'FEES-GCS-EME-T1', receiptUrl: 'mock://receipts/rcp_1.pdf',
  },
  {
    id: 'rcp_2', invoiceId: 'inv_ada_t1', childName: 'Adaeze Okafor', schoolName: 'Bright Stars Academy',
    term: 'First Term 2025/26', amountKobo: 4_000_000, method: 'card', paidAt: '2026-06-18',
    reference: 'FEES-BSA-ADA-T1', receiptUrl: 'mock://receipts/rcp_2.pdf',
  },
];

const MOCK_VAULTS: FeesVault[] = [
  {
    id: 'vlt_ada', name: "Adaeze — next term", childId: 'chd_ada', childName: 'Adaeze Okafor',
    targetKobo: 13_000_000, savedKobo: 5_200_000, invoiceId: undefined, schoolName: 'Bright Stars Academy',
    createdAt: '2026-05-01', cadence: 'monthly', autoSaveKobo: 1_500_000,
  },
  {
    id: 'vlt_emeka', name: 'Emeka — WAEC year', childId: 'chd_emeka', childName: 'Emeka Okafor',
    targetKobo: 16_000_000, savedKobo: 16_000_000, schoolName: 'Grace Comprehensive',
    createdAt: '2026-03-01', cadence: 'weekly', autoSaveKobo: 500_000,
  },
];

const MOCK_HARDSHIP: HardshipRequest[] = [
  {
    id: 'hs_1', invoiceId: 'inv_ada_t1', childName: 'Adaeze Okafor', schoolName: 'Bright Stars Academy',
    reason: 'Reduced income this quarter', requestedRelief: 'installments',
    note: 'Requesting to split the balance into two payments due to a delayed salary.',
    status: 'approved', submittedAt: '2026-06-14', responseNote: 'Approved for a 2-part plan through the fees office.',
  },
];

const MOCK_SPONSORSHIPS: SponsorshipOpportunity[] = [
  {
    id: 'spn_1', studentFirstName: 'Musa', schoolName: 'Al-Noor Primary', classLabel: 'Primary 5',
    story: 'Top of his class but at risk of dropping out after his father lost work.',
    targetKobo: 4_500_000, raisedKobo: 2_100_000, sponsorCount: 12, sponsored: false, icon: 'GraduationCap',
  },
  {
    id: 'spn_2', studentFirstName: 'Ngozi', schoolName: 'Hope Comprehensive', classLabel: 'SS 1',
    story: 'A promising science student who needs support to complete senior secondary.',
    targetKobo: 7_800_000, raisedKobo: 6_400_000, sponsorCount: 31, sponsored: false, icon: 'FlaskConical',
  },
  {
    id: 'spn_3', studentFirstName: 'Tunde', schoolName: 'Unity Academy', classLabel: 'JSS 3',
    story: 'Wants to sit BECE this year; family covering younger siblings first.',
    targetKobo: 3_200_000, raisedKobo: 900_000, sponsorCount: 5, sponsored: false, icon: 'BookOpen',
  },
];

const MOCK_DIRECTORY: DirectorySchool[] = [
  { id: 'sch_brightstars', name: 'Bright Stars Academy', lga: 'Ikeja', state: 'Lagos', logoColorKey: 'iconBgPurple', verified: true, trustScore: 88, studentCount: 640, linked: true },
  { id: 'sch_grace', name: 'Grace Comprehensive', lga: 'Enugu North', state: 'Enugu', logoColorKey: 'iconBgTeal', verified: true, trustScore: 82, studentCount: 410, linked: true },
  { id: 'sch_unity', name: 'Unity Academy', lga: 'Bwari', state: 'FCT', logoColorKey: 'iconBgBlue', verified: true, trustScore: 71, studentCount: 300, linked: false },
  { id: 'sch_hope', name: 'Hope Comprehensive', lga: 'Oredo', state: 'Edo', logoColorKey: 'iconBgGold', verified: false, trustScore: 46, studentCount: 180, linked: false },
  { id: 'sch_alnoor', name: 'Al-Noor Primary', lga: 'Nassarawa', state: 'Kano', logoColorKey: 'iconBgGreen', verified: false, trustScore: 38, studentCount: 220, linked: false },
];

// ── Competition fixtures (SF-7 minor-safe; SF-4 fee-independent) ─────────────
const MOCK_COMP_PROFILE: CompetitionProfile = {
  studentFirstName: 'Adaeze', schoolName: 'Bright Stars Academy', classLabel: 'JSS 2',
  totalPoints: 4820, nationalRank: 214, badgesEarned: 7, tournamentsJoined: 3, consentGiven: false,
};

// Raw entries carry both the safe + full identity; the serializer chooses which
// to expose based on consentGiven (SF-7). This mirrors the server serializer.
const RAW_LEADERBOARD: (CompetitionLeaderboardEntry & { fullName: string })[] = [
  { rank: 1, displayName: 'Chidi', fullName: 'Chidi Nwosu', schoolName: 'Kings College', score: 9820, consentGiven: true,  avatarColorKey: 'iconBgBlue',  isMe: false, delta: 2 },
  { rank: 2, displayName: 'Fatima', fullName: 'Fatima Bello', schoolName: 'Queen Amina', score: 9540, consentGiven: false, isMe: false, delta: -1 },
  { rank: 3, displayName: 'Tobi', fullName: 'Tobi Adeyemi', schoolName: 'Loyola Jesuit', score: 9310, consentGiven: true,  avatarColorKey: 'iconBgTeal',  isMe: false, delta: 1 },
  { rank: 4, displayName: 'Aisha', fullName: 'Aisha Sani', schoolName: 'Federal Girls', score: 9020, consentGiven: false, isMe: false, delta: 0 },
  { rank: 5, displayName: 'Ben', fullName: 'Benjamin Eze', schoolName: 'Command Sec.', score: 8770, consentGiven: false, isMe: false, delta: 3 },
  { rank: 6, displayName: 'Adaeze', fullName: 'Adaeze Okafor', schoolName: 'Bright Stars Academy', score: 8510, consentGiven: false, avatarColorKey: 'iconBgPurple', isMe: true, delta: 4 },
  { rank: 7, displayName: 'Kunle', fullName: 'Kunle Balogun', schoolName: 'Air Force Sec.', score: 8340, consentGiven: false, isMe: false, delta: -2 },
  { rank: 8, displayName: 'Rita', fullName: 'Rita Ojo', schoolName: 'Corona Sec.', score: 8110, consentGiven: true, avatarColorKey: 'iconBgGold', isMe: false, delta: 0 },
];

const SCOPE_LABELS: Record<LeaderboardScope, string> = {
  class: 'JSS 2 · Bright Stars', school: 'Bright Stars Academy', city: 'Ikeja', state: 'Lagos State', national: 'Nationwide',
};

const MOCK_TOURNAMENTS: Tournament[] = [
  {
    id: 'trn_1', title: 'Schools Cup — Maths', subject: 'Mathematics', scope: 'national', scopeLabel: 'Nationwide',
    status: 'live', startsAt: '2026-07-06', endsAt: '2026-07-13', participantCount: 18240, schoolCount: 612,
    rewardPoints: 2000, sponsor: 'Paymax', joined: true, icon: 'Trophy',
  },
  {
    id: 'trn_2', title: 'State Science Sprint', subject: 'Basic Science', scope: 'state', scopeLabel: 'Lagos State',
    status: 'upcoming', startsAt: '2026-07-15', endsAt: '2026-07-22', participantCount: 3120, schoolCount: 88,
    rewardPoints: 1200, joined: false, icon: 'FlaskConical',
  },
  {
    id: 'trn_3', title: 'English Word Blitz', subject: 'English Studies', scope: 'city', scopeLabel: 'Ikeja',
    status: 'ended', startsAt: '2026-06-20', endsAt: '2026-06-27', participantCount: 840, schoolCount: 22,
    rewardPoints: 600, joined: true, icon: 'BookOpen',
  },
];

const MOCK_CHALLENGES: CompetitionChallenge[] = [
  { id: 'chl_blitz', mode: 'blitz', title: 'Maths Blitz', subject: 'Mathematics', questionCount: 10, durationSec: 300, rewardPoints: 80, status: 'available' },
  { id: 'chl_duel', mode: 'duel', title: 'Science Duel', subject: 'Basic Science', questionCount: 8, durationSec: 240, rewardPoints: 120, opponent: 'Tobi', status: 'available' },
  { id: 'chl_daily', mode: 'daily', title: 'Daily Five', subject: 'Mixed', questionCount: 5, durationSec: 180, rewardPoints: 50, status: 'completed' },
];

const MOCK_BADGES: CompetitionBadge[] = [
  { id: 'bdg_1', name: 'First Win', description: 'Win your first challenge', icon: 'Award', tier: 'bronze', earned: true, earnedAt: '2026-05-02', progressPct: 100 },
  { id: 'bdg_2', name: 'Streak Star', description: 'Play 7 days in a row', icon: 'Flame', tier: 'silver', earned: true, earnedAt: '2026-06-11', progressPct: 100 },
  { id: 'bdg_3', name: 'Top 100', description: 'Reach national top 100', icon: 'Medal', tier: 'gold', earned: false, progressPct: 62 },
  { id: 'bdg_4', name: 'Duel Master', description: 'Win 25 duels', icon: 'Swords', tier: 'silver', earned: false, progressPct: 44 },
  { id: 'bdg_5', name: 'Perfect Round', description: 'Score 100% in a blitz', icon: 'Target', tier: 'gold', earned: true, earnedAt: '2026-06-30', progressPct: 100 },
];

const MOCK_COMP_REWARDS: CompetitionReward[] = [
  { id: 'crw_1', name: '₦500 airtime', description: 'MTN / Airtel / Glo / 9mobile', icon: 'Phone', pointsCost: 1500, category: 'airtime', redeemed: false },
  { id: 'crw_2', name: '1GB study data', description: 'Redeem to any line', icon: 'Wifi', pointsCost: 1200, category: 'data', redeemed: false },
  { id: 'crw_3', name: 'Schools Cup tee', description: 'Limited competition merch', icon: 'Shirt', pointsCost: 5000, category: 'merch', redeemed: false },
  { id: 'crw_4', name: 'Bookshop voucher', description: '₦2,000 off learning materials', icon: 'BookMarked', pointsCost: 4000, category: 'voucher', redeemed: false },
];

// In-memory mutable copies so mock mutations persist for the session.
let children = MOCK_CHILDREN.map((c) => ({ ...c }));
let invoices = MOCK_INVOICES.map((i) => ({ ...i, items: i.items.map((x) => ({ ...x })) }));
const plans = new Map<string, InstallmentPlan>(Object.entries(MOCK_INSTALLMENT_PLANS).map(([k, v]) => [k, { ...v, installments: v.installments.map((x) => ({ ...x })) }]));
let receipts = MOCK_RECEIPTS.map((r) => ({ ...r }));
let vaults = MOCK_VAULTS.map((v) => ({ ...v }));
let hardship = MOCK_HARDSHIP.map((h) => ({ ...h }));
let sponsorships = MOCK_SPONSORSHIPS.map((s) => ({ ...s }));
const directory = MOCK_DIRECTORY.map((d) => ({ ...d }));
let compProfile: CompetitionProfile = { ...MOCK_COMP_PROFILE };
let tournaments = MOCK_TOURNAMENTS.map((t) => ({ ...t }));
let challenges = MOCK_CHALLENGES.map((c) => ({ ...c }));
const badges = MOCK_BADGES.map((b) => ({ ...b }));
let compRewards = MOCK_COMP_REWARDS.map((r) => ({ ...r }));

// ═══════════════════════════════════════════════════════════════════════════════
// PARENT — reads
// ═══════════════════════════════════════════════════════════════════════════════
export async function getChildren(): Promise<FeesChild[]> {
  if (USE_MOCK) { await delay(); return children; }
  // TODO(no backend route): the fees backend has no guardian "children" list endpoint.
  // Student rows are school-scoped member routes (GET /schools/:schoolId/students), not a
  // guardian-facing child roster. Left pointing at the mock path until one is added.
  const res = await api.get(`${B}/fees/children`);
  return unwrap<FeesChild[]>(res);
}

export async function getInvoices(childId?: string): Promise<Invoice[]> {
  if (USE_MOCK) {
    await delay();
    return childId ? invoices.filter((i) => i.childId === childId) : invoices;
  }
  // TODO(no backend route): invoices are exposed per-id (GET /invoices/:id) or per-student
  // (GET /students/:studentId/invoices) — there is no list-by-child / list-all invoice route.
  const res = await api.get(`${B}/fees/invoices`, { params: { childId } });
  return unwrap<Invoice[]>(res);
}

export async function getInvoice(id: string): Promise<Invoice> {
  if (USE_MOCK) {
    await delay();
    const inv = invoices.find((i) => i.id === id);
    if (!inv) throw new Error('Invoice not found');
    return inv;
  }
  // feesinvoice member: GET /invoices/:id (derived balance SF-2). Envelope {data}.
  const res = await api.get(`${B}/invoices/${id}`);
  return unwrap<Invoice>(res);
}

export async function getInstallmentPlan(invoiceId: string): Promise<InstallmentPlan | null> {
  if (USE_MOCK) { await delay(); return plans.get(invoiceId) ?? null; }
  // TODO(no backend route): there is no installment-plan read endpoint. The backend models
  // installments only as payment intents (POST /payments/installment), not a fetchable plan.
  const res = await api.get(`${B}/fees/invoices/${invoiceId}/installment-plan`);
  return unwrap<InstallmentPlan | null>(res);
}

// ── PA-01 — link a child by admission number + school ────────────────────────
export interface LinkChildInput { schoolId: string; admissionNumber: string; firstName: string; }
export async function linkChild(input: LinkChildInput): Promise<FeesChild> {
  if (USE_MOCK) {
    await delay(480);
    const existing = children.find((c) => c.admissionNumber.toLowerCase() === input.admissionNumber.toLowerCase());
    if (existing) {
      children = children.map((c) => (c.id === existing.id ? { ...c, linked: true } : c));
      return { ...existing, linked: true };
    }
    const sch = directory.find((d) => d.id === input.schoolId);
    const child: FeesChild = {
      id: `chd_${Date.now()}`, firstName: input.firstName, lastName: 'Okafor', schoolId: input.schoolId,
      schoolName: sch?.name ?? 'School', classLabel: 'JSS 1', admissionNumber: input.admissionNumber,
      avatarColorKey: 'iconBgBlue', isMinor: true, linked: true, outstandingKobo: 0,
    };
    children = [...children, child];
    return child;
  }
  // TODO(no backend route): guardian linking is a school-scoped member action
  // (POST /schools/:schoolId/students/:studentId/guardians {guardianUserId}), not a
  // by-admission-number "link child" endpoint. Shapes differ; left mocked.
  const res = await api.post(`${B}/fees/children/link`, input);
  return unwrap<FeesChild>(res);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARENT — payments (SF-2 derived balance; every money mutation is idempotent)
// ═══════════════════════════════════════════════════════════════════════════════
function applyPayment(inv: Invoice, amountKobo: number, method: PayMethod): PaymentResult {
  const paidKobo = Math.min(inv.totalKobo, inv.paidKobo + amountKobo);
  const updated: Invoice = { ...inv, paidKobo };
  updated.status = statusFromBalance(updated);
  invoices = invoices.map((i) => (i.id === inv.id ? updated : i));
  // Reflect outstanding on the child summary (derived, SF-2).
  children = children.map((c) => {
    if (c.id !== inv.childId) return c;
    const outstanding = invoices.filter((i) => i.childId === c.id).reduce((s, i) => s + (i.totalKobo - i.paidKobo), 0);
    return { ...c, outstandingKobo: outstanding };
  });
  const receipt: Receipt = {
    id: `rcp_${Date.now()}`, invoiceId: inv.id, childName: inv.childName, schoolName: inv.schoolName,
    term: inv.term, amountKobo, method, paidAt: new Date().toISOString(), reference: inv.reference,
    receiptUrl: `mock://receipts/rcp_${Date.now()}.pdf`,
  };
  receipts = [receipt, ...receipts];
  return {
    id: receipt.id, invoiceId: inv.id, amountKobo, method,
    status: method === 'wallet' ? 'paid' : 'pending', paidAt: receipt.paidAt,
    receiptUrl: receipt.receiptUrl, newBalanceKobo: updated.totalKobo - updated.paidKobo,
    authorizationUrl: method === 'wallet' ? undefined : `mock://checkout/${receipt.id}`,
  };
}

// PA-05 — pay an invoice (full or partial). Idempotency-Key is mandatory on the
// live money path; the mock ignores it but the header is always sent.
export async function payInvoice(invoiceId: string, amountKobo: number, method: PayMethod, idempotencyKey?: string): Promise<PaymentResult> {
  if (USE_MOCK) {
    await delay(600);
    const inv = invoices.find((i) => i.id === invoiceId);
    if (!inv) throw new Error('Invoice not found');
    if (amountKobo <= 0) throw new Error('Enter an amount to pay');
    if (amountKobo > inv.totalKobo - inv.paidKobo) throw new Error('Amount exceeds the outstanding balance');
    return applyPayment(inv, amountKobo, method);
  }
  // feesinvoice member: POST /invoices/:id/payments (record payment, Idempotency-Key required).
  // Envelope {data}. The backend RecordPaymentRequest expects `amountMinor` (kobo is a minor
  // unit, so amountKobo maps 1:1 to amountMinor). `method` is not a backend field and is
  // dropped from the wire body (payment routing is derived server-side / by gatewayRef).
  const res = await api.post(
    `${B}/invoices/${invoiceId}/payments`,
    { amountMinor: amountKobo },
    { headers: { 'Idempotency-Key': idempotencyKey ?? generateIdempotencyKey() } },
  );
  return unwrap<PaymentResult>(res);
}

// PA-06 — create the installment plan (terms locked at creation, SF-6). The plan
// is NOT payable until the disclosure is acknowledged.
export async function createInstallmentPlan(invoiceId: string, count: number): Promise<InstallmentPlan> {
  if (USE_MOCK) {
    await delay(520);
    const inv = invoices.find((i) => i.id === invoiceId);
    if (!inv) throw new Error('Invoice not found');
    if (!inv.installmentEligible) throw new Error('This invoice is not eligible for installments');
    const outstanding = inv.totalKobo - inv.paidKobo;
    const base = Math.floor(outstanding / count / 100) * 100; // whole naira
    const installments = Array.from({ length: count }).map((_, idx) => {
      const amt = idx === count - 1 ? outstanding - base * (count - 1) : base;
      const due = new Date(Date.now() + idx * 30 * 86_400_000).toISOString();
      return { id: `ins_${Date.now()}_${idx}`, seq: idx + 1, amountKobo: amt, dueDate: due, status: (idx === 0 ? 'due' : 'scheduled') as const };
    });
    const plan: InstallmentPlan = {
      id: `plan_${Date.now()}`, invoiceId, count, totalKobo: outstanding, installments,
      disclosureAcceptedAt: undefined, createdAt: new Date().toISOString(),
    };
    plans.set(invoiceId, plan);
    invoices = invoices.map((i) => (i.id === invoiceId ? { ...i, hasInstallmentPlan: true } : i));
    return plan;
  }
  // TODO(no backend route): there is no create-installment-plan endpoint. The backend expresses
  // installments only as per-payment intents (POST /payments/installment) — no persisted plan resource.
  const res = await api.post(`${B}/fees/invoices/${invoiceId}/installment-plan`, { count });
  return unwrap<InstallmentPlan>(res);
}

// SF-6 — record acknowledgement of the locked terms BEFORE the first installment.
export async function acceptInstallmentDisclosure(invoiceId: string): Promise<InstallmentPlan> {
  if (USE_MOCK) {
    await delay(300);
    const plan = plans.get(invoiceId);
    if (!plan) throw new Error('No installment plan to disclose');
    const next = { ...plan, disclosureAcceptedAt: new Date().toISOString() };
    plans.set(invoiceId, next);
    return next;
  }
  // TODO(no backend route): there is no accept-disclosure endpoint. The SF-6 disclosure gate lives
  // inside POST /payments/installment (returns disclosureRequired=true; re-submit with Acknowledged),
  // not as a standalone plan-acknowledgement call.
  const res = await api.post(`${B}/fees/invoices/${invoiceId}/installment-plan/accept-disclosure`, {});
  return unwrap<InstallmentPlan>(res);
}

// Pay a specific installment (fail-closed on missing disclosure, SF-6).
export async function payInstallment(invoiceId: string, installmentId: string, method: PayMethod, idempotencyKey?: string): Promise<InstallmentPlan> {
  if (USE_MOCK) {
    await delay(600);
    const plan = plans.get(invoiceId);
    if (!plan) throw new Error('No installment plan');
    if (!plan.disclosureAcceptedAt) throw new Error('Accept the installment terms before paying (SF-6)');
    const target = plan.installments.find((x) => x.id === installmentId);
    if (!target) throw new Error('Installment not found');
    const inv = invoices.find((i) => i.id === invoiceId);
    if (inv) applyPayment(inv, target.amountKobo, method);
    const installments = plan.installments.map((x) => (x.id === installmentId ? { ...x, status: 'paid' as const, paidAt: new Date().toISOString() } : x));
    // Promote the next scheduled installment to "due".
    const nextDue = installments.find((x) => x.status === 'scheduled');
    if (nextDue) nextDue.status = 'due';
    const next = { ...plan, installments };
    plans.set(invoiceId, next);
    return next;
  }
  // TODO(no backend route as-shaped): the backend installment path is a body-based payment intent
  // (POST /payments/installment {invoiceId, …}), not a per-installment path
  // (/invoices/:id/installments/:installmentId/pay). It also returns a payment intent, not an
  // InstallmentPlan. Path + response shape both differ; left mocked pending a types/screen change.
  const res = await api.post(
    `${B}/fees/invoices/${invoiceId}/installments/${installmentId}/pay`,
    { method },
    { headers: { 'Idempotency-Key': idempotencyKey ?? generateIdempotencyKey() } },
  );
  return unwrap<InstallmentPlan>(res);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARENT — receipts / history (PA-09)
// ═══════════════════════════════════════════════════════════════════════════════
export async function getReceipts(): Promise<Receipt[]> {
  if (USE_MOCK) { await delay(); return receipts; }
  // TODO(no backend route): there is no receipts endpoint. Payments are listed per-invoice
  // (GET /invoices/:id/payments), not as a guardian-wide receipt history.
  const res = await api.get(`${B}/fees/receipts`);
  return unwrap<Receipt[]>(res);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARENT — Fees Vault (SF-5) + auto-save (PA-07, PA-08)
// ═══════════════════════════════════════════════════════════════════════════════
export async function getVaults(): Promise<FeesVault[]> {
  if (USE_MOCK) { await delay(); return vaults; }
  // feesvault member: GET /vaults (list my vaults). Envelope {data}.
  const res = await api.get(`${B}/vaults`);
  return unwrap<FeesVault[]>(res);
}

export interface CreateVaultInput { name: string; targetKobo: number; childId?: string; cadence: FeesVault['cadence']; autoSaveKobo: number; }
export async function createVault(input: CreateVaultInput): Promise<FeesVault> {
  if (USE_MOCK) {
    await delay(460);
    const child = input.childId ? children.find((c) => c.id === input.childId) : undefined;
    const vault: FeesVault = {
      id: `vlt_${Date.now()}`, name: input.name, targetKobo: input.targetKobo, savedKobo: 0,
      childId: input.childId, childName: child ? `${child.firstName} ${child.lastName}` : undefined,
      schoolName: child?.schoolName, createdAt: new Date().toISOString(),
      cadence: input.cadence, autoSaveKobo: input.cadence === 'manual' ? 0 : input.autoSaveKobo,
    };
    vaults = [vault, ...vaults];
    return vault;
  }
  // feesvault member: POST /vaults (create vault). Envelope {data}.
  const res = await api.post(`${B}/vaults`, input);
  return unwrap<FeesVault>(res);
}

export async function fundVault(vaultId: string, amountKobo: number, idempotencyKey?: string): Promise<FeesVault> {
  if (USE_MOCK) {
    await delay(520);
    const vault = vaults.find((v) => v.id === vaultId);
    if (!vault) throw new Error('Vault not found');
    if (amountKobo <= 0) throw new Error('Enter an amount to save');
    const updated = { ...vault, savedKobo: Math.min(vault.targetKobo, vault.savedKobo + amountKobo) };
    vaults = vaults.map((v) => (v.id === vaultId ? updated : v));
    return updated;
  }
  // feesvault member: POST /vaults/:id/contribute (fund, Idempotency-Key required — SF-5).
  // Envelope {data}. The backend ContributeRequest expects `amountMinor` (kobo is a minor
  // unit, so amountKobo maps 1:1 to amountMinor).
  const res = await api.post(
    `${B}/vaults/${vaultId}/contribute`,
    { amountMinor: amountKobo },
    { headers: { 'Idempotency-Key': idempotencyKey ?? generateIdempotencyKey() } },
  );
  return unwrap<FeesVault>(res);
}

export async function updateAutoSave(vaultId: string, rule: Omit<AutoSaveRule, 'vaultId' | 'nextRunAt'>): Promise<FeesVault> {
  if (USE_MOCK) {
    await delay(360);
    const vault = vaults.find((v) => v.id === vaultId);
    if (!vault) throw new Error('Vault not found');
    const updated: FeesVault = {
      ...vault,
      cadence: rule.enabled ? rule.cadence : 'manual',
      autoSaveKobo: rule.enabled ? rule.amountKobo : 0,
    };
    vaults = vaults.map((v) => (v.id === vaultId ? updated : v));
    return updated;
  }
  // TODO(no backend route): feesvault exposes contribute/apply-to-invoice/withdraw/lock/unlock,
  // but no auto-save-rule endpoint. Auto-save is a mock-only convenience today.
  const res = await api.put(`${B}/fees/vaults/${vaultId}/auto-save`, rule);
  return unwrap<FeesVault>(res);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARENT — hardship (PA-10, SF-9 human review only)
// ═══════════════════════════════════════════════════════════════════════════════
export async function getHardshipRequests(): Promise<HardshipRequest[]> {
  if (USE_MOCK) { await delay(); return hardship; }
  // TODO(no backend route): the member hardship surface is submit (POST /hardship) + get one
  // (GET /hardship/:id). There is no guardian list-my-requests endpoint (the list is admin-only:
  // GET /hardship/admin under the admin group). Left mocked.
  const res = await api.get(`${B}/fees/hardship`);
  return unwrap<HardshipRequest[]>(res);
}

export interface HardshipInput { invoiceId: string; reason: string; requestedRelief: HardshipRequest['requestedRelief']; note: string; }
export async function submitHardship(input: HardshipInput): Promise<HardshipRequest> {
  if (USE_MOCK) {
    await delay(560);
    const inv = invoices.find((i) => i.id === input.invoiceId);
    const req: HardshipRequest = {
      id: `hs_${Date.now()}`, invoiceId: input.invoiceId, childName: inv?.childName ?? 'Child',
      schoolName: inv?.schoolName ?? 'School', reason: input.reason, requestedRelief: input.requestedRelief,
      note: input.note, status: 'submitted', submittedAt: new Date().toISOString(),
    };
    hardship = [req, ...hardship];
    return req;
  }
  // feeshardship member: POST /hardship (submit a hardship/freeze request → pending, SF-9).
  // Envelope {data}.
  const res = await api.post(`${B}/hardship`, input);
  return unwrap<HardshipRequest>(res);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARENT — sponsor-a-student (PA-14, extends academy scholarships)
// ═══════════════════════════════════════════════════════════════════════════════
export async function getSponsorships(): Promise<SponsorshipOpportunity[]> {
  if (USE_MOCK) { await delay(); return sponsorships; }
  // TODO(no backend route): feesscholarship exposes pledge CRUD (POST /scholarship/pledges,
  // /:id/fund, /:id/apply, GET /:id, /:id/awards) but no browsable "opportunities" list.
  const res = await api.get(`${B}/fees/sponsorships`);
  return unwrap<SponsorshipOpportunity[]>(res);
}

export async function pledgeSponsorship(opportunityId: string, amountKobo: number, idempotencyKey?: string): Promise<SponsorshipPledge> {
  if (USE_MOCK) {
    await delay(560);
    const opp = sponsorships.find((s) => s.id === opportunityId);
    if (!opp) throw new Error('Opportunity not found');
    if (amountKobo <= 0) throw new Error('Enter a pledge amount');
    sponsorships = sponsorships.map((s) => (s.id === opportunityId
      ? { ...s, raisedKobo: Math.min(s.targetKobo, s.raisedKobo + amountKobo), sponsorCount: s.sponsorCount + 1, sponsored: true }
      : s));
    return {
      id: `pld_${Date.now()}`, opportunityId, amountKobo, status: 'settled',
      ts: new Date().toISOString(), receiptUrl: `mock://receipts/pld_${Date.now()}.pdf`,
    };
  }
  // TODO(no backend route as-shaped): the backend is a two-step pledge (POST /scholarship/pledges
  // to create, then POST /scholarship/pledges/:id/fund to move money), not a one-shot
  // /sponsorships/:opportunityId/pledge. The request/response shapes differ; left mocked.
  const res = await api.post(
    `${B}/fees/sponsorships/${opportunityId}/pledge`,
    { amountKobo },
    { headers: { 'Idempotency-Key': idempotencyKey ?? generateIdempotencyKey() } },
  );
  return unwrap<SponsorshipPledge>(res);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARENT — school directory + trust score (PA-16)
// ═══════════════════════════════════════════════════════════════════════════════
export async function getDirectory(query?: string): Promise<DirectorySchool[]> {
  if (USE_MOCK) {
    await delay();
    const q = query?.trim().toLowerCase();
    return q ? directory.filter((d) => d.name.toLowerCase().includes(q) || d.state.toLowerCase().includes(q) || d.lga.toLowerCase().includes(q)) : directory;
  }
  // feesschool member: GET /schools (list my schools). Envelope {data}.
  // NOTE: the backend returns the caller's own schools, not a public verified directory, and
  // ignores the q filter — the closest real member route until a directory endpoint exists.
  const res = await api.get(`${B}/schools`, { params: { q: query } });
  return unwrap<DirectorySchool[]>(res);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STUDENT — cross-school competition (SA-121 … SA-126)
// SF-7 serializer: strip PII unless consentGiven. SF-4: never touches fees.
// ═══════════════════════════════════════════════════════════════════════════════
function serializeEntries(raw: (CompetitionLeaderboardEntry & { fullName: string })[], viewerConsent: boolean): CompetitionLeaderboardEntry[] {
  return raw.map((e) => {
    // Minor-safe default: first name + school. Full name only with recorded
    // consent — and the viewer's own row follows the viewer's consent state.
    const showFull = e.isMe ? viewerConsent : e.consentGiven;
    const { fullName, ...rest } = e;
    return { ...rest, displayName: showFull ? fullName : e.displayName };
  });
}

export async function getCompetitionProfile(): Promise<CompetitionProfile> {
  if (USE_MOCK) { await delay(); return compProfile; }
  // TODO(no backend route): the member competition surface is a single leaderboard read
  // (GET /competitions/:id/leaderboard); there is no per-student competition profile endpoint.
  const res = await api.get(`${B}/competition/me`);
  return unwrap<CompetitionProfile>(res);
}

export async function getLeaderboard(scope: LeaderboardScope = 'national'): Promise<CompetitionLeaderboard> {
  if (USE_MOCK) {
    await delay();
    return {
      scope, scopeLabel: SCOPE_LABELS[scope], period: 'This week',
      myRank: RAW_LEADERBOARD.find((e) => e.isMe)?.rank,
      entries: serializeEntries(RAW_LEADERBOARD, compProfile.consentGiven),
      minorSafe: true,
    };
  }
  // TODO(no backend route as-shaped): the backend leaderboard is keyed by competition id
  // (GET /competitions/:id/leaderboard?scope=…) and responds with {scope, entries} (no {data}
  // envelope, no scopeLabel/period/myRank/minorSafe). This scope-only call has no competition
  // id and expects a richer CompetitionLeaderboard shape; left mocked.
  const res = await api.get(`${B}/competition/leaderboards/${scope}`);
  return unwrap<CompetitionLeaderboard>(res);
}

export async function getTournaments(): Promise<Tournament[]> {
  if (USE_MOCK) { await delay(); return tournaments; }
  // TODO(no backend route): "tournaments" are backend Competitions, but there is no
  // list-competitions endpoint (only create/transition/register/scores + leaderboard read).
  const res = await api.get(`${B}/competition/tournaments`);
  return unwrap<Tournament[]>(res);
}

export async function joinTournament(id: string): Promise<Tournament> {
  if (USE_MOCK) {
    await delay(420);
    const t = tournaments.find((x) => x.id === id);
    if (!t) throw new Error('Tournament not found');
    const updated = { ...t, joined: true, participantCount: t.participantCount + 1 };
    tournaments = tournaments.map((x) => (x.id === id ? updated : x));
    compProfile = { ...compProfile, tournamentsJoined: compProfile.tournamentsJoined + 1 };
    return updated;
  }
  // TODO(no backend route): registration is an admin/school action (POST /competitions/:id/register,
  // RBAC-gated) — there is no member/student "join tournament" endpoint.
  const res = await api.post(`${B}/competition/tournaments/${id}/join`, {});
  return unwrap<Tournament>(res);
}

export async function getChallenges(): Promise<CompetitionChallenge[]> {
  if (USE_MOCK) { await delay(); return challenges; }
  // TODO(no backend route): the fees competition backend has no challenges surface.
  const res = await api.get(`${B}/competition/challenges`);
  return unwrap<CompetitionChallenge[]>(res);
}

// A challenge run is server-authoritative (scoring). The mock simulates a result.
export async function playChallenge(id: string): Promise<ChallengeResult> {
  if (USE_MOCK) {
    await delay(700);
    const chl = challenges.find((c) => c.id === id);
    if (!chl) throw new Error('Challenge not found');
    const correct = Math.max(1, Math.round(chl.questionCount * (0.6 + Math.random() * 0.4)));
    const scorePct = Math.round((correct / chl.questionCount) * 100);
    challenges = challenges.map((c) => (c.id === id ? { ...c, status: 'completed' } : c));
    compProfile = { ...compProfile, totalPoints: compProfile.totalPoints + chl.rewardPoints };
    return {
      challengeId: id, scorePct, correct, total: chl.questionCount,
      rank: chl.mode === 'blitz' ? Math.max(1, 100 - correct * 8) : undefined,
      pointsEarned: chl.rewardPoints, badgeUnlocked: scorePct === 100 ? 'Perfect Round' : undefined,
    };
  }
  // TODO(no backend route): no challenge-play endpoint on the fees competition backend.
  const res = await api.post(`${B}/competition/challenges/${id}/play`, {});
  return unwrap<ChallengeResult>(res);
}

export async function getBadges(): Promise<CompetitionBadge[]> {
  if (USE_MOCK) { await delay(); return badges; }
  // TODO(no backend route): no badges surface on the fees competition backend.
  const res = await api.get(`${B}/competition/badges`);
  return unwrap<CompetitionBadge[]>(res);
}

export async function getCompetitionRewards(): Promise<CompetitionReward[]> {
  if (USE_MOCK) { await delay(); return compRewards; }
  // TODO(no backend route): no competition-rewards surface on the fees competition backend.
  const res = await api.get(`${B}/competition/rewards`);
  return unwrap<CompetitionReward[]>(res);
}

export async function redeemCompetitionReward(id: string): Promise<CompetitionReward> {
  if (USE_MOCK) {
    await delay(480);
    const reward = compRewards.find((r) => r.id === id);
    if (!reward) throw new Error('Reward not found');
    if (compProfile.totalPoints < reward.pointsCost) throw new Error('Not enough points');
    compProfile = { ...compProfile, totalPoints: compProfile.totalPoints - reward.pointsCost };
    const updated = { ...reward, redeemed: true };
    compRewards = compRewards.map((r) => (r.id === id ? updated : r));
    return updated;
  }
  // TODO(no backend route): no reward-redeem endpoint on the fees competition backend.
  const res = await api.post(`${B}/competition/rewards/${id}/redeem`, {});
  return unwrap<CompetitionReward>(res);
}

// SF-7 — record guardian consent to reveal the student's full identity on public
// boards. Toggling this re-serializes leaderboard reads (viewer's own row).
export async function setCompetitionConsent(consentGiven: boolean): Promise<CompetitionProfile> {
  if (USE_MOCK) {
    await delay(360);
    compProfile = { ...compProfile, consentGiven };
    return compProfile;
  }
  // TODO(no backend route): consent is read server-side from academy_consent_records by the
  // SF-7 serializer; there is no member endpoint to set competition consent from the app.
  const res = await api.post(`${B}/competition/consent`, { consentGiven });
  return unwrap<CompetitionProfile>(res);
}
