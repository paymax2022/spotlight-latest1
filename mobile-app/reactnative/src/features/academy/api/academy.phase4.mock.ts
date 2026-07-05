// ── Spotlight Academy — Phase 4 mock dataset ─────────────────────────────────
// Self-contained fixtures for Tutor & School (T1–T8) and ECCE / Little Learners
// (E1–E3). Backs the Phase-4 screens while USE_MOCK is true. Money in kobo;
// reward points are plain integers. Tutor verify mirrors the KYC ladder; tutor
// payouts reuse the payout-rail concept (settle T+1). ECCE is parent-gated.

import type {
  TutorProfile,
  TutorListing,
  Cohort,
  Assignment,
  Submission,
  TutorEarnings,
  ManagedSchool,
  SchoolOverview,
  EcceHome,
} from '../types';

const now = Date.now();
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();
const daysAhead = (d: number) => new Date(now + d * 86_400_000).toISOString();
const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();

// ── Tutor profile (T1, T2) ────────────────────────────────────────────────────
// Starts unverified with onboarding incomplete; T1 flips verifyState → pending
// (KYC) and sets onboardingComplete, T2 reads the populated profile.
export const MOCK_TUTOR_PROFILE: TutorProfile = {
  id: 'tut_self',
  displayName: 'Mr. Tunde Bello',
  verifyState: 'unverified',
  kycTier: 'tier1',
  bio: 'Maths & Physics teacher. 8 years in WAEC/JAMB prep. I make hard topics simple.',
  subjects: ['Mathematics', 'Physics'],
  trades: [],
  rating: 4.8,
  ratingCount: 126,
  studentCount: 34,
  availability: ['Mon 4–6pm', 'Wed 4–6pm', 'Sat 10am–1pm'],
  hourlyRateKobo: 350_000, // ₦3,500/hr
  payoutMethods: [
    { id: 'po_wallet', kind: 'wallet', label: 'Paymax wallet', isDefault: true },
    { id: 'po_gtb', kind: 'bank', label: 'GTBank •••• 4471', bankName: 'GTBank', accountLast4: '4471', isDefault: false },
  ],
  avatarColorKey: 'iconBgPurple',
  onboardingComplete: false,
};

// ── Tutor marketplace listings (GET /tutors?subject=) ─────────────────────────
export const MOCK_TUTOR_LISTINGS: TutorListing[] = [
  { id: 'tut_001', displayName: 'Mrs. Aisha Lawal', headline: 'Maths & Further Maths · 10 yrs', subjects: ['Mathematics', 'Further Mathematics'], rating: 4.9, ratingCount: 210, hourlyRateKobo: 400_000, verifyState: 'verified', avatarColorKey: 'iconBgTeal' },
  { id: 'tut_002', displayName: 'Mr. Emeka Obi', headline: 'Physics & Chemistry · 6 yrs', subjects: ['Physics', 'Chemistry'], rating: 4.7, ratingCount: 88, hourlyRateKobo: 320_000, verifyState: 'verified', avatarColorKey: 'iconBgBlue' },
  { id: 'tut_003', displayName: 'Ms. Grace Udo', headline: 'English & Literature · 9 yrs', subjects: ['English Language', 'Literature in English'], rating: 4.8, ratingCount: 143, hourlyRateKobo: 300_000, verifyState: 'verified', avatarColorKey: 'iconBgGold' },
  { id: 'tut_004', displayName: 'Mr. Tunde Bello', headline: 'Maths & Physics · 8 yrs', subjects: ['Mathematics', 'Physics'], rating: 4.8, ratingCount: 126, hourlyRateKobo: 350_000, verifyState: 'pending', avatarColorKey: 'iconBgPurple' },
  { id: 'tut_005', displayName: 'Mrs. Ngozi Eze', headline: 'Biology & Agric · 7 yrs', subjects: ['Biology', 'Agricultural Science'], rating: 4.6, ratingCount: 64, hourlyRateKobo: 280_000, verifyState: 'verified', avatarColorKey: 'iconBgGreen' },
];

// ── Cohorts & roster (T3) ─────────────────────────────────────────────────────
export const MOCK_COHORTS: Cohort[] = [
  {
    id: 'coh_sss2_maths', name: 'SSS2 Maths — Evening', subjectOrTrade: 'Mathematics', studentCount: 4,
    students: [
      { id: 'stu_1', name: 'Ada Okoro', classCode: 'SSS2', progressPct: 72, pendingCount: 1, avatarColorKey: 'iconBgTeal' },
      { id: 'stu_2', name: 'Bola Ade', classCode: 'SSS2', progressPct: 54, pendingCount: 2, avatarColorKey: 'iconBgBlue' },
      { id: 'stu_3', name: 'Chidi Nwosu', classCode: 'SSS2', progressPct: 88, pendingCount: 0, avatarColorKey: 'iconBgGold' },
      { id: 'stu_4', name: 'Dami Johnson', classCode: 'SSS2', progressPct: 31, pendingCount: 3, avatarColorKey: 'iconBgRed' },
    ],
  },
  {
    id: 'coh_jss3_phys', name: 'JSS3 Basic Science', subjectOrTrade: 'Basic Science', studentCount: 3,
    students: [
      { id: 'stu_5', name: 'Efe Idris', classCode: 'JSS3', progressPct: 60, pendingCount: 1, avatarColorKey: 'iconBgPurple' },
      { id: 'stu_6', name: 'Funke Bello', classCode: 'JSS3', progressPct: 45, pendingCount: 2, avatarColorKey: 'iconBgGreen' },
      { id: 'stu_7', name: 'Gbenga Sola', classCode: 'JSS3', progressPct: 77, pendingCount: 0, avatarColorKey: 'iconBgBlue' },
    ],
  },
];

// ── Assignments (T4) ──────────────────────────────────────────────────────────
export const MOCK_ASSIGNMENTS: Assignment[] = [
  {
    id: 'asg_1', cohortId: 'coh_sss2_maths', cohortName: 'SSS2 Maths — Evening', kind: 'homework',
    title: 'Quadratic equations — exercise 4', refId: 'obj_quad_4', dueDate: daysAhead(3), assignedAt: daysAgo(2),
    assignedCount: 4, submittedCount: 2, gradedCount: 1,
  },
  {
    id: 'asg_2', cohortId: 'coh_sss2_maths', cohortName: 'SSS2 Maths — Evening', kind: 'assessment',
    title: 'Trigonometry mini-test', refId: 'asmt_trig_1', dueDate: daysAhead(6), assignedAt: daysAgo(1),
    assignedCount: 4, submittedCount: 1, gradedCount: 0,
  },
  {
    id: 'asg_3', cohortId: 'coh_jss3_phys', cohortName: 'JSS3 Basic Science', kind: 'lesson',
    title: 'Watch: States of matter', refId: 'les_states', dueDate: daysAhead(1), assignedAt: daysAgo(3),
    assignedCount: 3, submittedCount: 3, gradedCount: 3,
  },
];

// ── Submissions awaiting / done grading (T5) ──────────────────────────────────
export const MOCK_SUBMISSIONS: Submission[] = [
  {
    id: 'sub_1', assignmentId: 'asg_1', assignmentTitle: 'Quadratic equations — exercise 4',
    studentId: 'stu_1', studentName: 'Ada Okoro', submittedAt: hoursAgo(20), status: 'submitted',
    workPreview: 'x = 2 or x = -5; completed all 8 questions with working shown.',
  },
  {
    id: 'sub_2', assignmentId: 'asg_1', assignmentTitle: 'Quadratic equations — exercise 4',
    studentId: 'stu_2', studentName: 'Bola Ade', submittedAt: hoursAgo(6), status: 'submitted',
    workPreview: 'Solved 6/8; struggled with factorising Q7 and Q8.',
  },
  {
    id: 'sub_3', assignmentId: 'asg_1', assignmentTitle: 'Quadratic equations — exercise 4',
    studentId: 'stu_3', studentName: 'Chidi Nwosu', submittedAt: daysAgo(1), status: 'graded',
    workPreview: 'All correct, neat working.', scorePct: 95, feedback: 'Excellent — watch your sign on Q5.',
  },
  {
    id: 'sub_4', assignmentId: 'asg_2', assignmentTitle: 'Trigonometry mini-test',
    studentId: 'stu_4', studentName: 'Dami Johnson', submittedAt: hoursAgo(2), status: 'submitted',
    workPreview: 'Attempted 5/6; ran out of time on the bearings question.',
  },
];

// ── Tutor earnings & payouts (T7) ─────────────────────────────────────────────
export const MOCK_TUTOR_EARNINGS: TutorEarnings = {
  availableKobo: 4_850_000,   // ₦48,500
  pendingKobo: 1_200_000,     // ₦12,000
  lifetimeKobo: 38_600_000,   // ₦386,000
  minPayoutKobo: 500_000,     // ₦5,000
  ledger: [
    { id: 'tl_1', ts: hoursAgo(4), kind: 'session', label: 'Live class · SSS2 Maths (4 learners)', amountKobo: 1_400_000, settled: false },
    { id: 'tl_2', ts: daysAgo(1), kind: 'assignment_bonus', label: 'Graded 12 submissions', amountKobo: 300_000, settled: true },
    { id: 'tl_3', ts: daysAgo(2), kind: 'session', label: 'Live class · JSS3 Basic Science', amountKobo: 900_000, settled: true },
    { id: 'tl_4', ts: daysAgo(5), kind: 'payout', label: 'Withdrawal to GTBank •••• 4471', amountKobo: -2_000_000, settled: true },
    { id: 'tl_5', ts: daysAgo(7), kind: 'session', label: 'Live class · SSS2 Maths (3 learners)', amountKobo: 1_050_000, settled: true },
    { id: 'tl_6', ts: daysAgo(9), kind: 'adjustment', label: 'Refund — cancelled session', amountKobo: -350_000, settled: true },
  ],
};

// ── School admin (lite) (T8) ──────────────────────────────────────────────────
export const MOCK_MANAGED_SCHOOLS: ManagedSchool[] = [
  {
    id: 'sch_brightfield', name: 'Brightfield Secondary', lga: 'Ikeja', state: 'Lagos',
    logoColorKey: 'iconBgPurple', role: 'admin', seatsTotal: 250, seatsUsed: 188,
    licenceStatus: 'active', licenceRenewsAt: daysAhead(95),
  },
  {
    id: 'sch_hilltop', name: 'Hilltop Academy', lga: 'Garki', state: 'FCT',
    logoColorKey: 'iconBgTeal', role: 'coordinator', seatsTotal: 120, seatsUsed: 117,
    licenceStatus: 'expiring', licenceRenewsAt: daysAhead(12),
  },
];

export const MOCK_SCHOOL_OVERVIEWS: Record<string, SchoolOverview> = {
  sch_brightfield: {
    school: MOCK_MANAGED_SCHOOLS[0],
    totalLearners: 188,
    activeLearners7d: 142,
    avgMasteryPct: 64,
    pendingInvites: 9,
    classes: [
      { id: 'cls_jss1a', name: 'JSS1 A', enrolled: 38, activePct: 82, avgMasteryPct: 58 },
      { id: 'cls_jss2b', name: 'JSS2 B', enrolled: 41, activePct: 76, avgMasteryPct: 61 },
      { id: 'cls_sss1a', name: 'SSS1 A', enrolled: 36, activePct: 70, avgMasteryPct: 67 },
      { id: 'cls_sss2a', name: 'SSS2 A', enrolled: 39, activePct: 88, avgMasteryPct: 72 },
      { id: 'cls_sss3a', name: 'SSS3 A', enrolled: 34, activePct: 91, avgMasteryPct: 69 },
    ],
  },
  sch_hilltop: {
    school: MOCK_MANAGED_SCHOOLS[1],
    totalLearners: 117,
    activeLearners7d: 80,
    avgMasteryPct: 57,
    pendingInvites: 3,
    classes: [
      { id: 'cls_p5', name: 'Primary 5', enrolled: 40, activePct: 65, avgMasteryPct: 52 },
      { id: 'cls_p6', name: 'Primary 6', enrolled: 38, activePct: 71, avgMasteryPct: 55 },
      { id: 'cls_jss1', name: 'JSS1', enrolled: 39, activePct: 68, avgMasteryPct: 63 },
    ],
  },
};

// ── ECCE / Little Learners (E1, E2) ───────────────────────────────────────────
export const MOCK_ECCE_HOME: EcceHome = {
  childName: 'Zara',
  dailyLimitReached: false,
  activities: [
    {
      id: 'ecce_phonics', kind: 'phonics', title: 'Letter sounds', emoji: '🔤', colorKey: 'iconBgPurple',
      prompt: 'Tap the letter that says “buh”.', stars: 2,
      rounds: [
        { id: 'r1', say: 'Which letter says “buh”?', options: [
          { id: 'o1', label: 'B', emoji: '🅱️', correct: true },
          { id: 'o2', label: 'S', emoji: '🇸', correct: false },
          { id: 'o3', label: 'M', emoji: 'Ⓜ️', correct: false },
        ] },
        { id: 'r2', say: 'Which letter says “sss”?', options: [
          { id: 'o1', label: 'A', emoji: '🅰️', correct: false },
          { id: 'o2', label: 'S', emoji: '🇸', correct: true },
          { id: 'o3', label: 'T', emoji: '✝️', correct: false },
        ] },
      ],
    },
    {
      id: 'ecce_numeracy', kind: 'numeracy', title: 'Count with me', emoji: '🔢', colorKey: 'iconBgTeal',
      prompt: 'Tap how many apples you see.', stars: 1,
      rounds: [
        { id: 'r1', say: 'How many apples? 🍎🍎🍎', options: [
          { id: 'o1', label: '2', emoji: '✌️', correct: false },
          { id: 'o2', label: '3', emoji: '🤟', correct: true },
          { id: 'o3', label: '5', emoji: '🖐️', correct: false },
        ] },
        { id: 'r2', say: 'How many stars? ⭐⭐', options: [
          { id: 'o1', label: '1', emoji: '☝️', correct: false },
          { id: 'o2', label: '2', emoji: '✌️', correct: true },
          { id: 'o3', label: '4', emoji: '🖖', correct: false },
        ] },
      ],
    },
    {
      id: 'ecce_shapes', kind: 'shapes', title: 'Find the shape', emoji: '🔺', colorKey: 'iconBgGold',
      prompt: 'Tap the circle.', stars: 0,
      rounds: [
        { id: 'r1', say: 'Which one is a circle?', options: [
          { id: 'o1', label: 'Circle', emoji: '⚪', correct: true },
          { id: 'o2', label: 'Square', emoji: '🟦', correct: false },
          { id: 'o3', label: 'Triangle', emoji: '🔺', correct: false },
        ] },
        { id: 'r2', say: 'Which one is a square?', options: [
          { id: 'o1', label: 'Star', emoji: '⭐', correct: false },
          { id: 'o2', label: 'Square', emoji: '🟦', correct: true },
          { id: 'o3', label: 'Heart', emoji: '❤️', correct: false },
        ] },
      ],
    },
    {
      id: 'ecce_colors', kind: 'colors', title: 'Colors', emoji: '🎨', colorKey: 'iconBgRed',
      prompt: 'Tap the red one.', stars: 3,
      rounds: [
        { id: 'r1', say: 'Which one is red?', options: [
          { id: 'o1', label: 'Red', emoji: '🔴', correct: true },
          { id: 'o2', label: 'Blue', emoji: '🔵', correct: false },
          { id: 'o3', label: 'Green', emoji: '🟢', correct: false },
        ] },
      ],
    },
  ],
};
