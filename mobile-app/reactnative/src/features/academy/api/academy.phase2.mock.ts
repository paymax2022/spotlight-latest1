// ── Spotlight Academy — Phase 2 mock dataset ─────────────────────────────────
// Self-contained fixtures for progression, parent/guardian, EduPay, and the new
// learner surfaces (downloads, bookmarks, notes, search, daily goal). Backs the
// Phase-2 screens while USE_MOCK is true. Money in kobo; reward points are plain
// integers. Reuses Phase-1 subject/objective IDs from academy.mock for coherence.

import type {
  LearningPath,
  Recommendation,
  ChildSummary,
  ChildDashboard,
  ChildSubjectDetail,
  UsageControls,
  ProgressReport,
  PurchaseApproval,
  School,
  FeeSchedule,
  EduPayProfile,
  SavingsPot,
  Scholarship,
  Subscription,
  Invoice,
  DownloadedBundle,
  StorageInfo,
  Bookmark,
  LessonNote,
  SearchResult,
  DailyGoal,
  StreakDay,
} from '../types';

const now = Date.now();
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();
const daysAhead = (d: number) => new Date(now + d * 86_400_000).toISOString();
const dateOnly = (d: number) => new Date(now - d * 86_400_000).toISOString().slice(0, 10);

// ── Progression ──────────────────────────────────────────────────────────────
export const MOCK_PATHS: Record<string, LearningPath> = {
  sub_math: {
    id: 'path_math', subjectId: 'sub_math', subjectName: 'Mathematics', progressPct: 48, generatedAt: daysAgo(0),
    steps: [
      { objectiveId: 'obj_simul_1', topicId: 'top_math_simul', subjectId: 'sub_math', title: 'Simultaneous equations by substitution', rationale: 'Reinforce a near-mastered skill before moving on.', status: 'mastered', masteryPct: 78, estMinutes: 8 },
      { objectiveId: 'obj_trig_1', topicId: 'top_math_trig', subjectId: 'sub_math', title: 'Sine & cosine ratios', rationale: 'You are mid-way — finish for a quick mastery win.', status: 'in_progress', masteryPct: 55, estMinutes: 12 },
      { objectiveId: 'obj_trig_3', topicId: 'top_math_trig', subjectId: 'sub_math', title: 'Angles of elevation & depression', rationale: 'Weak objective flagged by your last practice set.', status: 'available', masteryPct: 40, estMinutes: 15 },
      { objectiveId: 'obj_trig_2', topicId: 'top_math_trig', subjectId: 'sub_math', title: 'Sine & cosine rules', rationale: 'Unlocks after the previous step.', status: 'locked', masteryPct: 10, estMinutes: 18 },
    ],
  },
  sub_phy: {
    id: 'path_phy', subjectId: 'sub_phy', subjectName: 'Physics', progressPct: 30, generatedAt: daysAgo(0),
    steps: [
      { objectiveId: 'obj_motion_1', topicId: 'top_phy_motion', subjectId: 'sub_phy', title: 'Equations of uniformly accelerated motion', rationale: 'Strong base — confirm mastery.', status: 'in_progress', masteryPct: 72, estMinutes: 10 },
      { objectiveId: 'obj_force_1', topicId: 'top_phy_force', subjectId: 'sub_phy', title: "Newton's second law applications", rationale: 'Next in the Physics sequence.', status: 'available', masteryPct: 25, estMinutes: 16 },
    ],
  },
};

export const MOCK_RECOMMENDATIONS: Recommendation[] = [
  { id: 'rec_1', kind: 'adaptive', title: 'Sharpen your weak spots', reason: '3 objectives below 50% mastery', href: '/learn/academy/practice/adaptive', icon: 'Target' },
  { id: 'rec_2', kind: 'lesson', title: 'Angles of elevation & depression', reason: 'Next in your Maths path', href: '/learn/academy/lesson/les_trig_2', subjectId: 'sub_math', objectiveId: 'obj_trig_3', icon: 'PlayCircle' },
  { id: 'rec_3', kind: 'mock', title: 'Take a UTME timed mock', reason: 'Readiness up 3% if you pass', href: '/learn/academy/exam/arena_utme', icon: 'GraduationCap' },
  { id: 'rec_4', kind: 'review', title: 'Review missed Physics questions', reason: 'From your last practice set', href: '/learn/academy/practice/obj_motion_1', subjectId: 'sub_phy', icon: 'RotateCcw' },
];

// ── Parent / Guardian ────────────────────────────────────────────────────────
export const MOCK_CHILDREN: ChildSummary[] = [
  { minorId: 'usr_self', displayName: 'Chidera A.', classCode: 'SSS2', avatarColorKey: 'iconBgPurple', linked: true, guardianConsent: 'granted', streakDays: 12, minutesToday: 35, dailyCapMinutes: 90, readinessPct: 64, alertCount: 2 },
  { minorId: 'min_emeka', displayName: 'Emeka A.', classCode: 'JSS2', avatarColorKey: 'iconBgTeal', linked: true, guardianConsent: 'granted', streakDays: 4, minutesToday: 80, dailyCapMinutes: 60, readinessPct: 41, alertCount: 1 },
  { minorId: 'min_ada', displayName: 'Ada A.', classCode: 'Primary 5', avatarColorKey: 'iconBgGold', linked: false, guardianConsent: 'pending', streakDays: 0, minutesToday: 0, dailyCapMinutes: 45, readinessPct: 0, alertCount: 0 },
];

export const MOCK_CHILD_DASHBOARDS: Record<string, ChildDashboard> = {
  usr_self: {
    minorId: 'usr_self', displayName: 'Chidera A.', classCode: 'SSS2', streakDays: 12,
    weeklyMinutes: 280, weeklyGoalMinutes: 420, masteredObjectives: 14, totalObjectives: 32, readinessPct: 64,
    subjects: [
      { subjectId: 'sub_math', name: 'Mathematics', progressPct: 42, masteredTopics: 5, topicCount: 12 },
      { subjectId: 'sub_eng', name: 'English Language', progressPct: 60, masteredTopics: 6, topicCount: 10 },
      { subjectId: 'sub_phy', name: 'Physics', progressPct: 22, masteredTopics: 2, topicCount: 9 },
    ],
    alerts: [
      { id: 'al_1', kind: 'achievement', message: 'Chidera mastered "Quadratic Equations"', ts: daysAgo(1), read: false },
      { id: 'al_2', kind: 'low_mastery', message: 'Physics readiness dropped below 30%', ts: daysAgo(2), read: false },
    ],
  },
  min_emeka: {
    minorId: 'min_emeka', displayName: 'Emeka A.', classCode: 'JSS2', streakDays: 4,
    weeklyMinutes: 510, weeklyGoalMinutes: 300, masteredObjectives: 6, totalObjectives: 28, readinessPct: 41,
    subjects: [
      { subjectId: 'sub_math', name: 'Mathematics', progressPct: 30, masteredTopics: 2, topicCount: 10 },
      { subjectId: 'sub_eng', name: 'English Language', progressPct: 48, masteredTopics: 3, topicCount: 9 },
    ],
    alerts: [
      { id: 'al_3', kind: 'screen_time', message: 'Emeka exceeded the daily 60-min cap today', ts: daysAgo(0), read: false },
    ],
  },
};

export const MOCK_CHILD_SUBJECT_DETAIL: Record<string, ChildSubjectDetail> = {
  'usr_self:sub_math': {
    minorId: 'usr_self', subjectId: 'sub_math', subjectName: 'Mathematics', progressPct: 42,
    topics: [
      { topicId: 'top_math_quad', name: 'Quadratic Equations', mastery: 'mastered', masteryPct: 92 },
      { topicId: 'top_math_simul', name: 'Simultaneous Equations', mastery: 'proficient', masteryPct: 78 },
      { topicId: 'top_math_trig', name: 'Trigonometry', mastery: 'learning', masteryPct: 48 },
      { topicId: 'top_math_calc', name: 'Intro to Calculus', mastery: 'not_started', masteryPct: 0 },
    ],
    recent: [
      { id: 'r1', ts: daysAgo(0), label: 'Practice: Trigonometry', scorePct: 60 },
      { id: 'r2', ts: daysAgo(2), label: 'Lesson: SOHCAHTOA story' },
      { id: 'r3', ts: daysAgo(3), label: 'Mastery check: Simultaneous Equations', scorePct: 80 },
    ],
  },
};

export const MOCK_CONTROLS: Record<string, UsageControls> = {
  usr_self: { dailyCapMinutes: 90, allowedFrom: '06:00', allowedTo: '21:00', contentFilter: 'teen', requirePurchaseApproval: true, paused: false },
  min_emeka: { dailyCapMinutes: 60, allowedFrom: '07:00', allowedTo: '20:00', contentFilter: 'teen', requirePurchaseApproval: true, paused: false },
  min_ada: { dailyCapMinutes: 45, allowedFrom: '08:00', allowedTo: '18:00', contentFilter: 'all_ages', requirePurchaseApproval: true, paused: false },
};

export const MOCK_REPORTS: ProgressReport[] = [
  {
    id: 'rep_1', minorId: 'usr_self', childName: 'Chidera A.', period: 'weekly', periodLabel: 'Week of 23 Jun', generatedAt: daysAgo(0),
    minutesStudied: 280, lessonsCompleted: 9, masteryGained: 3, readinessPct: 64,
    highlights: ['Mastered Quadratic Equations', '12-day streak maintained', 'Physics needs attention (22%)'],
    shareUrl: 'mock://reports/rep_1.pdf',
  },
  {
    id: 'rep_2', minorId: 'usr_self', childName: 'Chidera A.', period: 'termly', periodLabel: 'First Term 2024/25', generatedAt: daysAgo(7),
    minutesStudied: 1840, lessonsCompleted: 62, masteryGained: 14, readinessPct: 61,
    highlights: ['14 objectives mastered this term', 'Top 18 on the national leaderboard', 'Completed 4 CBT mocks'],
    shareUrl: 'mock://reports/rep_2.pdf',
  },
  {
    id: 'rep_3', minorId: 'min_emeka', childName: 'Emeka A.', period: 'weekly', periodLabel: 'Week of 23 Jun', generatedAt: daysAgo(0),
    minutesStudied: 510, lessonsCompleted: 14, masteryGained: 2, readinessPct: 41,
    highlights: ['Strong engagement (510 min)', 'Exceeded screen-time cap twice', 'English improving steadily'],
    shareUrl: 'mock://reports/rep_3.pdf',
  },
];

export const MOCK_APPROVALS: PurchaseApproval[] = [
  { id: 'apr_1', minorId: 'usr_self', childName: 'Chidera A.', itemLabel: 'UTME Pro Pack', kind: 'bundle', amountKobo: 350000, requestedAt: daysAgo(0), status: 'pending' },
  { id: 'apr_2', minorId: 'min_emeka', childName: 'Emeka A.', itemLabel: 'Redeem 200MB Data', kind: 'reward_redeem', pointsCost: 800, requestedAt: daysAgo(1), status: 'pending' },
  { id: 'apr_3', minorId: 'usr_self', childName: 'Chidera A.', itemLabel: 'Scholar plan (monthly)', kind: 'plan', amountKobo: 250000, requestedAt: daysAgo(3), status: 'approved' },
];

// ── EduPay ───────────────────────────────────────────────────────────────────
export const MOCK_SCHOOLS: School[] = [
  { id: 'sch_brightstars', name: 'Bright Stars College', lga: 'Ikeja', state: 'Lagos', logoColorKey: 'iconBgPurple', linked: true, verified: true },
  { id: 'sch_unity', name: 'Unity Secondary School', lga: 'Garki', state: 'FCT Abuja', logoColorKey: 'iconBgBlue', linked: true, verified: true },
  { id: 'sch_grace', name: 'Grace Academy', lga: 'Enugu North', state: 'Enugu', logoColorKey: 'iconBgTeal', linked: false, verified: true },
  { id: 'sch_corona', name: 'Corona International', lga: 'Eti-Osa', state: 'Lagos', logoColorKey: 'iconBgGold', linked: false, verified: false },
];

export const MOCK_FEE_SCHEDULES: FeeSchedule[] = [
  {
    id: 'fee_bs_sss2', schoolId: 'sch_brightstars', schoolName: 'Bright Stars College', term: 'First Term 2025/26', classCode: 'SSS2',
    items: [
      { id: 'fi_1', label: 'Tuition', amountKobo: 9000000 },
      { id: 'fi_2', label: 'Development levy', amountKobo: 1500000 },
      { id: 'fi_3', label: 'Exam & WAEC reg.', amountKobo: 800000 },
      { id: 'fi_4', label: 'Books & uniform', amountKobo: 1200000 },
    ],
    totalKobo: 12500000, dueDate: daysAhead(21), bnplEligible: true, linked: true,
  },
  {
    id: 'fee_unity_jss2', schoolId: 'sch_unity', schoolName: 'Unity Secondary School', term: 'First Term 2025/26', classCode: 'JSS2',
    items: [
      { id: 'fu_1', label: 'Tuition', amountKobo: 6000000 },
      { id: 'fu_2', label: 'PTA levy', amountKobo: 500000 },
      { id: 'fu_3', label: 'Lab & ICT', amountKobo: 700000 },
    ],
    totalKobo: 7200000, dueDate: daysAhead(35), bnplEligible: true, linked: true,
  },
  {
    id: 'fee_grace_p5', schoolId: 'sch_grace', schoolName: 'Grace Academy', term: 'First Term 2025/26', classCode: 'Primary 5',
    items: [
      { id: 'fg_1', label: 'Tuition', amountKobo: 4500000 },
      { id: 'fg_2', label: 'Feeding', amountKobo: 1800000 },
    ],
    totalKobo: 6300000, dueDate: daysAhead(40), bnplEligible: false, linked: false,
  },
];

export const MOCK_EDUPAY_PROFILE: EduPayProfile = {
  linkedSchoolIds: ['sch_brightstars', 'sch_unity'],
  linkedFeeScheduleIds: ['fee_bs_sss2', 'fee_unity_jss2'],
  payments: [
    { id: 'pay_1', feeScheduleId: 'fee_bs_sss2', schoolName: 'Bright Stars College', term: 'Third Term 2024/25', amountKobo: 12000000, status: 'paid', method: 'wallet', paidAt: daysAgo(95), receiptUrl: 'mock://receipts/pay_1.pdf' },
    { id: 'pay_2', feeScheduleId: 'fee_unity_jss2', schoolName: 'Unity Secondary School', term: 'Third Term 2024/25', amountKobo: 7000000, status: 'bnpl', method: 'bnpl', bnplInstalments: 3, paidAt: daysAgo(90), receiptUrl: 'mock://receipts/pay_2.pdf' },
  ],
};

export const MOCK_POTS: SavingsPot[] = [
  { id: 'pot_1', name: "Chidera's SSS3 fees", targetKobo: 13000000, savedKobo: 4500000, feeScheduleId: 'fee_bs_sss2', schoolName: 'Bright Stars College', createdAt: daysAgo(40), cadence: 'monthly' },
  { id: 'pot_2', name: 'Emeka books & uniform', targetKobo: 2000000, savedKobo: 1500000, createdAt: daysAgo(20), cadence: 'weekly' },
];

export const MOCK_SCHOLARSHIPS: Scholarship[] = [
  { id: 'sco_1', title: 'MTN Science Scholars', sponsor: 'MTN Foundation', amountKobo: 25000000, coverage: 'full', eligibility: 'SSS students, science stream, 70%+ readiness', deadline: daysAhead(28), applied: false, icon: 'Award' },
  { id: 'sco_2', title: 'Dangote Girl-Child Fund', sponsor: 'Dangote Foundation', amountKobo: 10000000, coverage: 'partial', eligibility: 'Female learners, JSS–SSS, financial need', deadline: daysAhead(14), applied: false, icon: 'HeartHandshake' },
  { id: 'sco_3', title: 'Spotlight Streak Bursary', sponsor: 'Spotlight Academy', amountKobo: 5000000, coverage: 'partial', eligibility: '30-day streak + 1 mock completed', deadline: daysAhead(45), applied: true, icon: 'Flame' },
];

// ── Billing & subscriptions ──────────────────────────────────────────────────
export const MOCK_SUBSCRIPTIONS: Subscription[] = [
  { id: 'sub_1', planName: 'Scholar', status: 'active', priceKobo: 250000, period: 'monthly', renewsAt: daysAhead(12), childNames: ['Chidera A.'] },
  { id: 'sub_2', planName: 'Starter', status: 'active', priceKobo: 0, period: 'monthly', renewsAt: daysAhead(20), childNames: ['Emeka A.'] },
];

export const MOCK_INVOICES: Invoice[] = [
  { id: 'inv_1', label: 'Scholar plan — June', amountKobo: 250000, status: 'paid', ts: daysAgo(18), receiptUrl: 'mock://invoices/inv_1.pdf' },
  { id: 'inv_2', label: 'UTME Pro Pack', amountKobo: 350000, status: 'paid', ts: daysAgo(40), receiptUrl: 'mock://invoices/inv_2.pdf' },
  { id: 'inv_3', label: 'Scholar plan — July', amountKobo: 250000, status: 'due', ts: daysAhead(12), receiptUrl: 'mock://invoices/inv_3.pdf' },
];

// ── Parent notifications (P13) ───────────────────────────────────────────────
export interface ParentNotification {
  id: string;
  kind: 'report' | 'approval' | 'alert' | 'billing' | 'edupay';
  title: string;
  body: string;
  ts: string;
  read: boolean;
}
export const MOCK_PARENT_NOTIFICATIONS: ParentNotification[] = [
  { id: 'pn_1', kind: 'approval', title: 'Purchase approval needed', body: 'Chidera wants to buy the UTME Pro Pack (₦3,500).', ts: daysAgo(0), read: false },
  { id: 'pn_2', kind: 'report', title: 'Weekly report ready', body: "Chidera's week-of-23-Jun report is available.", ts: daysAgo(0), read: false },
  { id: 'pn_3', kind: 'alert', title: 'Screen-time exceeded', body: 'Emeka studied 80 min today (cap 60).', ts: daysAgo(0), read: false },
  { id: 'pn_4', kind: 'edupay', title: 'School fees due soon', body: 'Bright Stars College fees due in 21 days.', ts: daysAgo(1), read: true },
  { id: 'pn_5', kind: 'billing', title: 'Scholar plan renews soon', body: 'Renews in 12 days for ₦2,500.', ts: daysAgo(2), read: true },
];

// ── Learner — downloads (L17) ────────────────────────────────────────────────
export const MOCK_DOWNLOADS: DownloadedBundle[] = [
  { id: 'bun_utme_pro', name: 'UTME Pro Pack', examSlug: 'utme', itemCount: 64, sizeMb: 240, status: 'downloaded', progressPct: 100, syncState: 'synced', downloadedAt: daysAgo(6) },
  { id: 'bun_bece_starter', name: 'BECE Starter Pack', examSlug: 'bece', itemCount: 38, sizeMb: 150, status: 'downloaded', progressPct: 100, syncState: 'update_available', downloadedAt: daysAgo(14) },
  { id: 'bun_wassce_lit', name: 'WASSCE Literature Set', examSlug: 'wassce', itemCount: 22, sizeMb: 90, status: 'not_downloaded', progressPct: 0, syncState: 'synced' },
];

export const MOCK_STORAGE: StorageInfo = { usedMb: 390, budgetMb: 2048, bundleCount: 2 };

// ── Learner — bookmarks & notes (L15/L16) ────────────────────────────────────
export const MOCK_BOOKMARKS: Bookmark[] = [
  { id: 'bm_1', kind: 'lesson', title: 'SOHCAHTOA story', subjectName: 'Mathematics', href: '/learn/academy/lesson/les_trig_1', ts: daysAgo(1) },
  { id: 'bm_2', kind: 'topic', title: 'Motion & Kinematics', subjectName: 'Physics', href: '/learn/academy/topic/top_phy_motion', ts: daysAgo(3) },
  { id: 'bm_3', kind: 'past_question', title: 'UTME 2019 — Trigonometry', subjectName: 'Mathematics', href: '/learn/academy/practice/obj_trig_1', ts: daysAgo(5) },
];

export const MOCK_NOTES: LessonNote[] = [
  { id: 'nt_1', lessonId: 'les_trig_1', lessonTitle: 'SOHCAHTOA story', subjectName: 'Mathematics', body: 'SOH-CAH-TOA. sin = opp/hyp. Remember: sin 30 = 0.5, cos 60 = 0.5.', ts: daysAgo(1) },
  { id: 'nt_2', lessonId: 'les_motion_1', lessonTitle: 'Equations of motion', subjectName: 'Physics', body: 'v = u + at. s = ut + ½at². v² = u² + 2as. u is initial velocity.', ts: daysAgo(2) },
];

// ── Learner — search (L14) ───────────────────────────────────────────────────
export const MOCK_SEARCH_INDEX: SearchResult[] = [
  { id: 's_les_trig_1', kind: 'lesson', title: 'SOHCAHTOA story', subtitle: 'Mathematics · Trigonometry', href: '/learn/academy/lesson/les_trig_1', icon: 'PlayCircle' },
  { id: 's_les_trig_2', kind: 'lesson', title: 'Angles of elevation & depression', subtitle: 'Mathematics · Trigonometry', href: '/learn/academy/lesson/les_trig_2', icon: 'PlayCircle' },
  { id: 's_les_motion_1', kind: 'lesson', title: 'Equations of motion made simple', subtitle: 'Physics · Motion', href: '/learn/academy/lesson/les_motion_1', icon: 'PlayCircle' },
  { id: 's_top_trig', kind: 'topic', title: 'Trigonometry', subtitle: 'Mathematics · 5 objectives', href: '/learn/academy/topic/top_math_trig', icon: 'BookOpen' },
  { id: 's_top_motion', kind: 'topic', title: 'Motion & Kinematics', subtitle: 'Physics · 4 objectives', href: '/learn/academy/topic/top_phy_motion', icon: 'BookOpen' },
  { id: 's_sub_math', kind: 'subject', title: 'Mathematics', subtitle: '12 topics · SSS2', href: '/learn/academy/subject/sub_math', icon: 'Calculator' },
  { id: 's_sub_phy', kind: 'subject', title: 'Physics', subtitle: '9 topics · SSS2', href: '/learn/academy/subject/sub_phy', icon: 'Atom' },
  { id: 's_pq_trig', kind: 'past_question', title: 'UTME 2019 — Trigonometry', subtitle: 'Past question · Mathematics', href: '/learn/academy/practice/obj_trig_1', icon: 'FileText' },
  { id: 's_pq_motion', kind: 'past_question', title: 'WASSCE 2019 — Vectors', subtitle: 'Past question · Physics', href: '/learn/academy/practice/obj_motion_1', icon: 'FileText' },
];

// ── Learner — daily goal & streak (L2) ───────────────────────────────────────
function buildCalendar(): StreakDay[] {
  const cells: StreakDay[] = [];
  // 35 cells (5 weeks); last cell is today.
  for (let i = 34; i >= 0; i--) {
    let state: StreakDay['state'];
    if (i === 0) state = 'today';
    else if (i <= 12 && i % 9 === 3) state = 'frozen';      // sprinkle freeze days within the streak
    else if (i <= 12) state = 'studied';                    // 12-day active streak
    else if (i % 5 === 0) state = 'missed';
    else state = 'studied';
    cells.push({ date: dateOnly(i), state });
  }
  return cells;
}

export const MOCK_DAILY_GOAL: DailyGoal = {
  goalMinutes: 30, doneMinutes: 18, streakDays: 12, freezeTokens: 2, calendar: buildCalendar(),
};
