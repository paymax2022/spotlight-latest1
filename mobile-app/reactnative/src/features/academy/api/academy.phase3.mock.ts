// ── Spotlight Academy — Phase 3 mock dataset ─────────────────────────────────
// Self-contained fixtures for the Trade & Skills moat (S1–S8), credentials &
// earning bridge (G10/G11 + S6/S7), and live/community/notifications (C1–C7).
// Backs the Phase-3 screens while USE_MOCK is true. Money in kobo; reward points
// are plain integers. Child-safety: community is group/Q&A only — no 1:1 DMs.
// Reuses Phase-1 subject IDs from academy.mock where coherent.

import type {
  TradeTrack,
  TradeModule,
  TradeProject,
  SkillAssessment,
  Credential,
  EarningOpportunity,
  Mentor,
  LiveSession,
  StudyGroup,
  Discussion,
  AcademyNotification,
  Announcement,
  Question,
} from '../types';

const now = Date.now();
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();
const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();
const hoursAhead = (h: number) => new Date(now + h * 3_600_000).toISOString();
const daysAhead = (d: number) => new Date(now + d * 86_400_000).toISOString();

// ── Trade tracks (A11 / S1) ──────────────────────────────────────────────────
// The first track is the learner's chosen trade; the rest are pickable.
export const MOCK_TRADE_TRACKS: TradeTrack[] = [
  {
    id: 'trk_solar', slug: 'solar', name: 'Solar installation', tagline: 'Install & maintain solar + inverter systems',
    icon: 'Sun', colorKey: 'iconBgGold', progressPct: 42, moduleCount: 6, completedModules: 2, chosen: true,
    unlocksRoles: ['service', 'agent'],
  },
  {
    id: 'trk_fashion', slug: 'fashion', name: 'Fashion & tailoring', tagline: 'Pattern, cut and finish garments',
    icon: 'Scissors', colorKey: 'iconBgPurple', progressPct: 0, moduleCount: 5, completedModules: 0, chosen: false,
    unlocksRoles: ['merchant', 'creator'],
  },
  {
    id: 'trk_gsm', slug: 'gsm', name: 'Phone & GSM repair', tagline: 'Diagnose and fix mobile devices',
    icon: 'Smartphone', colorKey: 'iconBgBlue', progressPct: 0, moduleCount: 5, completedModules: 0, chosen: false,
    unlocksRoles: ['service', 'merchant'],
  },
  {
    id: 'trk_agric', slug: 'agric', name: 'Agribusiness', tagline: 'Grow, process and sell produce',
    icon: 'Sprout', colorKey: 'iconBgGreen', progressPct: 0, moduleCount: 6, completedModules: 0, chosen: false,
    unlocksRoles: ['merchant', 'agent'],
  },
  {
    id: 'trk_beauty', slug: 'beauty', name: 'Beauty & cosmetology', tagline: 'Hair, skincare and salon services',
    icon: 'Sparkles', colorKey: 'iconBgRed', progressPct: 0, moduleCount: 5, completedModules: 0, chosen: false,
    unlocksRoles: ['service', 'creator'],
  },
];

// ── Trade modules for the chosen track (S1/S2) ───────────────────────────────
export const MOCK_TRADE_MODULES: Record<string, TradeModule[]> = {
  trk_solar: [
    { id: 'tm_solar_1', trackId: 'trk_solar', title: 'Solar basics & safety', kind: 'theory', order: 1, estMinutes: 25, status: 'completed', outcome: 'Explain PV, batteries, inverters and site safety.' },
    { id: 'tm_solar_2', trackId: 'trk_solar', title: 'Sizing a home system', kind: 'practical', order: 2, estMinutes: 35, status: 'completed', outcome: 'Calculate panel, battery and inverter sizing for a load.' },
    { id: 'tm_solar_3', trackId: 'trk_solar', title: 'Wiring & mounting (practical)', kind: 'practical', order: 3, estMinutes: 45, status: 'in_progress', outcome: 'Mount panels and wire a charge controller safely.' },
    { id: 'tm_solar_4', trackId: 'trk_solar', title: 'Project: install a 1kVA kit', kind: 'project', order: 4, estMinutes: 90, status: 'available', outcome: 'Submit a working install with photos/video.', projectId: 'prj_solar_1' },
    { id: 'tm_solar_5', trackId: 'trk_solar', title: 'Fault-finding & maintenance', kind: 'theory', order: 5, estMinutes: 30, status: 'locked', outcome: 'Diagnose common inverter and battery faults.' },
    { id: 'tm_solar_6', trackId: 'trk_solar', title: 'Skill assessment', kind: 'assessment', order: 6, estMinutes: 40, status: 'locked', outcome: 'Pass to earn a verifiable Solar Level 1 credential.', assessmentId: 'asm_solar_1' },
  ],
};

// ── Projects / portfolio (S3) ────────────────────────────────────────────────
export const MOCK_TRADE_PROJECTS: Record<string, TradeProject> = {
  prj_solar_1: {
    id: 'prj_solar_1', moduleId: 'tm_solar_4', trackId: 'trk_solar',
    title: 'Install a 1kVA solar kit', status: 'not_started',
    brief: 'Install a 1kVA solar + inverter kit for a small load (lights + phone charging). Upload 3 photos and a short video of the working setup.',
    rubric: [
      { id: 'rc_1', label: 'Wiring safety & polarity', maxPoints: 30 },
      { id: 'rc_2', label: 'Correct sizing for load', maxPoints: 25 },
      { id: 'rc_3', label: 'Neat mounting & cable management', maxPoints: 25 },
      { id: 'rc_4', label: 'Working demonstration', maxPoints: 20 },
    ],
    attachments: [],
  },
};

// ── Skill assessment (S4) ────────────────────────────────────────────────────
const SOLAR_QUESTIONS: Question[] = [
  {
    id: 'asq_solar_1', subjectId: 'trk_solar', type: 'mcq',
    stem: 'A 12V battery bank powers a 100W load. Roughly what current is drawn?',
    options: [{ id: 'a', text: '~0.8A' }, { id: 'b', text: '~8.3A' }, { id: 'c', text: '~83A' }, { id: 'd', text: '~1.2A' }],
    correct: ['b'], explanation: 'I = P / V = 100 / 12 ≈ 8.3A.',
  },
  {
    id: 'asq_solar_2', subjectId: 'trk_solar', type: 'mcq',
    stem: 'Which component prevents the battery from over-charging?',
    options: [{ id: 'a', text: 'Inverter' }, { id: 'b', text: 'Charge controller' }, { id: 'c', text: 'Busbar' }, { id: 'd', text: 'Fuse' }],
    correct: ['b'], explanation: 'The charge controller regulates charging to protect the battery.',
  },
  {
    id: 'asq_solar_3', subjectId: 'trk_solar', type: 'true_false',
    stem: 'You should connect panels with reversed polarity to test them.',
    options: [{ id: 't', text: 'True' }, { id: 'f', text: 'False' }],
    correct: ['f'], explanation: 'Reversed polarity can damage equipment and is unsafe.',
  },
];

export const MOCK_ASSESSMENTS: Record<string, SkillAssessment> = {
  asm_solar_1: {
    id: 'asm_solar_1', trackId: 'trk_solar', title: 'Solar Level 1 — Skill assessment',
    questions: SOLAR_QUESTIONS, passMark: 70, durationMin: 20, passed: false,
  },
};

// ── Credentials (G10 / S5) ───────────────────────────────────────────────────
const VERIFY_BASE = 'https://verify.spotlight.academy/c';
export const MOCK_CREDENTIALS: Credential[] = [
  {
    id: 'cred_wassce', kind: 'academic', title: 'WASSCE Readiness — Mock Distinction',
    issuer: 'Spotlight Academy', recipientName: 'Ada Obi', issuedAt: daysAgo(40),
    verificationId: 'VC-AC-2X9K7', verifyUrl: `${VERIFY_BASE}/VC-AC-2X9K7`,
    unlocksRoles: [], scorePct: 88,
  },
  {
    id: 'cred_solar_demo', kind: 'trade', title: 'Solar Installation — Level 1',
    issuer: 'Spotlight Academy · Paymax Skills', recipientName: 'Ada Obi', issuedAt: daysAgo(8),
    verificationId: 'VC-TR-7H3M2', verifyUrl: `${VERIFY_BASE}/VC-TR-7H3M2`,
    unlocksRoles: ['service', 'agent'], scorePct: 82, trackSlug: 'solar',
  },
];

// ── Earning opportunities (S6/S7 — Paymax bridge) ─────────────────────────────
export const MOCK_OPPORTUNITIES: EarningOpportunity[] = [
  {
    id: 'opp_solar_service', role: 'service', title: 'Solar service technician',
    partner: 'Paymax Energy', summary: 'Install and service home solar kits for Paymax customers in your area.',
    icon: 'Sun', earningsLabel: '₦60k–₦180k / month', requiredCredentialKinds: ['solar'],
    eligibility: 'eligible', requirements: ['Solar Installation — Level 1 credential', 'Tier-1 KYC (BVN/NIN)'], applied: false,
  },
  {
    id: 'opp_agent', role: 'agent', title: 'Paymax community agent',
    partner: 'Paymax Agency', summary: 'Help neighbours open accounts, cash in/out and buy study bundles. Earn commission.',
    icon: 'Store', earningsLabel: '₦40k–₦120k / month', requiredCredentialKinds: [],
    eligibility: 'needs_kyc', requirements: ['Tier-1 KYC (BVN/NIN)', 'Smartphone'], applied: false,
  },
  {
    id: 'opp_driver', role: 'driver', title: 'Spotlight delivery rider',
    partner: 'Paymax Mobility', summary: 'Deliver restaurant and parcel orders on the Paymax network.',
    icon: 'Bike', earningsLabel: '₦50k–₦150k / month', requiredCredentialKinds: [],
    eligibility: 'needs_kyc', requirements: ['Valid riders permit', 'Tier-1 KYC'], applied: false,
  },
  {
    id: 'opp_creator', role: 'creator', title: 'Academy content creator',
    partner: 'Spotlight Studios', summary: 'Make short skill clips for the academy and earn per approved lesson.',
    icon: 'Video', earningsLabel: '₦20k–₦90k / month', requiredCredentialKinds: ['fashion'],
    eligibility: 'needs_credential', requirements: ['Any trade credential', 'Sample clip'], applied: false,
  },
  {
    id: 'opp_merchant', role: 'merchant', title: 'Paymax merchant storefront',
    partner: 'Paymax Commerce', summary: 'Sell your trade products with a Paymax storefront and POS.',
    icon: 'ShoppingBag', earningsLabel: 'Varies', requiredCredentialKinds: [],
    eligibility: 'needs_kyc', requirements: ['Tier-2 KYC', 'Business name (optional)'], applied: false,
  },
];

// ── Mentors (S8) — group/cohort matching only (child-safety) ──────────────────
export const MOCK_MENTORS: Mentor[] = [
  { id: 'mnt_1', name: 'Engr. Tunde A.', trade: 'solar', headline: '12 yrs · Solar & inverters', rating: 4.8, groupOnly: true, avatarColorKey: 'iconBgGold', requestState: 'none', bio: 'Runs a solar firm in Ibadan; mentors weekend cohorts on safe installs.' },
  { id: 'mnt_2', name: 'Mrs. Chioma E.', trade: 'fashion', headline: '9 yrs · Fashion design', rating: 4.9, groupOnly: true, avatarColorKey: 'iconBgPurple', requestState: 'none', bio: 'Bridal and ready-to-wear; teaches pattern drafting in small groups.' },
  { id: 'mnt_3', name: 'Mr. Bayo K.', trade: 'gsm', headline: '7 yrs · GSM & board repair', rating: 4.6, groupOnly: true, avatarColorKey: 'iconBgBlue', requestState: 'none', bio: 'Micro-soldering specialist; hosts cohort clinics.' },
];

// ── Live sessions (C1–C3) ────────────────────────────────────────────────────
export const MOCK_LIVE_SESSIONS: LiveSession[] = [
  { id: 'live_1', title: 'Solar wiring clinic', subjectOrTrade: 'Solar', host: 'Engr. Tunde A.', status: 'live', startsAt: hoursAgo(0.3), durationMin: 60, viewers: 214, moderated: true },
  { id: 'live_2', title: 'WASSCE Maths: surds & indices', subjectOrTrade: 'Mathematics', host: 'Mr. Femi O.', status: 'upcoming', startsAt: hoursAhead(20), durationMin: 75, moderated: true },
  { id: 'live_3', title: 'Exam clinic: UTME English', subjectOrTrade: 'English', host: 'Mrs. Grace U.', status: 'upcoming', startsAt: daysAhead(3), durationMin: 60, moderated: true },
  { id: 'live_4', title: 'Fashion: drafting a bodice', subjectOrTrade: 'Fashion', host: 'Mrs. Chioma E.', status: 'replay', startsAt: daysAgo(2), durationMin: 80, watchedPct: 35, moderated: true },
  { id: 'live_5', title: 'Phone repair: no-power faults', subjectOrTrade: 'GSM repair', host: 'Mr. Bayo K.', status: 'replay', startsAt: daysAgo(6), durationMin: 55, watchedPct: 0, moderated: true },
];

// ── Study groups / cohorts (C4) ──────────────────────────────────────────────
export const MOCK_STUDY_GROUPS: StudyGroup[] = [
  { id: 'grp_solar_cohort', name: 'Solar Cohort — June', subjectOrTrade: 'Solar', members: 38, goal: 'Everyone passes Level 1 assessment by month-end', goalProgressPct: 55, joined: true, cohort: true },
  { id: 'grp_wassce_maths', name: 'WASSCE Maths warriors', subjectOrTrade: 'Mathematics', members: 126, goal: 'Cover 5 past papers this week', goalProgressPct: 40, joined: false, cohort: true },
  { id: 'grp_fashion', name: 'Fashion makers circle', subjectOrTrade: 'Fashion', members: 52, goal: 'Each member submits one finished piece', goalProgressPct: 20, joined: false, cohort: true },
];

// ── Discussions / Q&A (C5) — moderated, group context only ────────────────────
export const MOCK_DISCUSSIONS: Discussion[] = [
  { id: 'dsc_1', scope: 'Solar', authorName: 'Engr. Tunde A.', authorRole: 'mentor', title: 'How to size a battery bank safely', body: 'Always factor depth-of-discharge. For lead-acid, keep DoD under 50% to extend life…', ts: hoursAgo(3), replyCount: 12, moderation: 'clean', reported: false },
  { id: 'dsc_2', scope: 'Mathematics', authorName: 'Ada Obi', authorRole: 'peer', title: 'Quick way to remember the quadratic formula?', body: 'I keep forgetting the ±. Any tips?', ts: hoursAgo(8), replyCount: 5, moderation: 'clean', reported: false },
  { id: 'dsc_3', scope: 'General', authorName: 'Mrs. Grace U.', authorRole: 'tutor', title: 'Exam timetable reminder', body: 'UTME mock window opens Monday. Download your bundle for offline practice.', ts: daysAgo(1), replyCount: 2, moderation: 'clean', reported: false },
];

// ── Notifications (C6) ───────────────────────────────────────────────────────
export const MOCK_NOTIFICATIONS: AcademyNotification[] = [
  { id: 'ntf_1', kind: 'live', title: 'Live now: Solar wiring clinic', body: 'Engr. Tunde is live. Join with raise-hand enabled.', ts: hoursAgo(0.2), read: false, href: '/learn/academy/live' },
  { id: 'ntf_2', kind: 'credential', title: 'Credential issued', body: 'Your Solar Installation — Level 1 certificate is ready.', ts: daysAgo(8), read: false, href: '/learn/academy/certificates' },
  { id: 'ntf_3', kind: 'opportunity', title: 'New earning role unlocked', body: 'You can now apply to be a Solar service technician on Paymax.', ts: daysAgo(8), read: true, href: '/learn/academy/earn' },
  { id: 'ntf_4', kind: 'exam_reminder', title: 'WASSCE mock window opens Monday', body: 'Download your bundle to practise offline.', ts: daysAgo(1), read: true },
  { id: 'ntf_5', kind: 'reward', title: 'You earned 120 reward points', body: 'Nice work finishing the wiring practical.', ts: daysAgo(2), read: true, href: '/learn/academy/rewards' },
];

// ── Announcements (C7) ───────────────────────────────────────────────────────
export const MOCK_ANNOUNCEMENTS: Announcement[] = [
  { id: 'ann_1', title: 'Trade & Earn is live', body: 'Pick a trade, build a portfolio, earn a verifiable credential and unlock Paymax earning roles.', kind: 'program', ts: daysAgo(3), pinned: true },
  { id: 'ann_2', title: 'Sponsor: MTN data for learners', body: 'Complete 3 lessons this week to qualify for 500MB study data, courtesy MTN.', kind: 'sponsor', sponsor: 'MTN', ts: daysAgo(5), pinned: false },
  { id: 'ann_3', title: 'New live exam clinics every Saturday', body: 'Join moderated Q&A clinics for UTME, WASSCE and NECO.', kind: 'program', ts: daysAgo(9), pinned: false },
];
