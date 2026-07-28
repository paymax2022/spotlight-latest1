// ── Spotlight Academy — Mock dataset (Phase 0 + Phase 1) ─────────────────────
// Self-contained fixtures backing the learner app while USE_MOCK is true.
// Two arenas (UTME + BECE), a full blueprint with bundled offline questions,
// subjects/topics/objectives, a reward pool, plans + bundles, wallet.
// Money in kobo. Reward points are non-monetary integers.

import type {
  AcademyProfile,
  CurriculumVersion,
  AcademyClass,
  Subject,
  Topic,
  Objective,
  Lesson,
  Question,
  ExamArena,
  ExamBlueprint,
  UtmeCombination,
  GamificationProfile,
  Badge,
  Challenge,
  LeaderboardEntry,
  RewardBalance,
  RewardLedgerEntry,
  RewardCatalogItem,
  Plan,
  Bundle,
  BundleManifestItem,
  AcademyWallet,
} from '../types';

const now = Date.now();
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();
const daysAhead = (d: number) => new Date(now + d * 86_400_000).toISOString();

// ── Identity (default: a 16-year-old learner, minor → consent pending) ────────
export const MOCK_PROFILE: AcademyProfile = {
  id: 'usr_self',
  displayName: 'Chidera A.',
  role: 'learner',
  dob: '2009-09-02',
  isMinor: true,
  kycTier: 'tier1',
  classCode: 'SSS2',
  curriculumVersion: 'cv_2024',
  stream: 'science',
  guardianConsent: 'pending',
  guardianId: undefined,
  onboardingComplete: false,
};

// ── Curriculum ────────────────────────────────────────────────────────────────
export const MOCK_CURRICULUM_VERSIONS: CurriculumVersion[] = [
  { id: 'cv_2024', label: 'NERDC 2024 (new)', effectiveYear: 2024, isLegacy: false },
  { id: 'cv_2014', label: 'NERDC 2014 (legacy)', effectiveYear: 2014, isLegacy: true },
];

export const MOCK_CLASSES: AcademyClass[] = [
  { id: 'cls_sss1', code: 'SSS1', label: 'Senior Secondary 1', band: 'sss', curriculumVersionId: 'cv_2024' },
  { id: 'cls_sss2', code: 'SSS2', label: 'Senior Secondary 2', band: 'sss', curriculumVersionId: 'cv_2024' },
  { id: 'cls_sss3', code: 'SSS3', label: 'Senior Secondary 3', band: 'sss', curriculumVersionId: 'cv_2024' },
  { id: 'cls_jss3', code: 'JSS3', label: 'Junior Secondary 3', band: 'jss', curriculumVersionId: 'cv_2024' },
];

export const MOCK_SUBJECTS: Subject[] = [
  { id: 'sub_math', classCode: 'SSS2', name: 'Mathematics', icon: 'Calculator', colorKey: 'iconBgBlue', topicCount: 12, masteredTopics: 5, progressPct: 42, examRelevance: ['utme', 'wassce', 'neco'] },
  { id: 'sub_eng', classCode: 'SSS2', name: 'English Language', icon: 'BookA', colorKey: 'iconBgPurple', topicCount: 10, masteredTopics: 6, progressPct: 60, examRelevance: ['utme', 'wassce', 'neco'] },
  { id: 'sub_phy', classCode: 'SSS2', name: 'Physics', icon: 'Atom', colorKey: 'iconBgTeal', topicCount: 9, masteredTopics: 2, progressPct: 22, examRelevance: ['utme', 'wassce'] },
  { id: 'sub_chem', classCode: 'SSS2', name: 'Chemistry', icon: 'FlaskConical', colorKey: 'iconBgGreen', topicCount: 9, masteredTopics: 3, progressPct: 33, examRelevance: ['utme', 'wassce'] },
  { id: 'sub_bio', classCode: 'SSS2', name: 'Biology', icon: 'Leaf', colorKey: 'iconBgGreen', topicCount: 11, masteredTopics: 4, progressPct: 36, examRelevance: ['utme', 'wassce', 'neco'] },
];

export const MOCK_TOPICS: Topic[] = [
  // Mathematics
  { id: 'top_math_quad', subjectId: 'sub_math', name: 'Quadratic Equations', order: 1, mastery: 'mastered', locked: false, examRelevant: true, objectiveCount: 4, lessonCount: 3 },
  { id: 'top_math_simul', subjectId: 'sub_math', name: 'Simultaneous Equations', order: 2, mastery: 'proficient', locked: false, examRelevant: true, objectiveCount: 3, lessonCount: 2 },
  { id: 'top_math_trig', subjectId: 'sub_math', name: 'Trigonometry', order: 3, mastery: 'learning', locked: false, examRelevant: true, objectiveCount: 5, lessonCount: 4 },
  { id: 'top_math_calc', subjectId: 'sub_math', name: 'Intro to Calculus', order: 4, mastery: 'not_started', locked: true, examRelevant: true, objectiveCount: 4, lessonCount: 3 },
  // Physics
  { id: 'top_phy_motion', subjectId: 'sub_phy', name: 'Motion & Kinematics', order: 1, mastery: 'proficient', locked: false, examRelevant: true, objectiveCount: 4, lessonCount: 3 },
  { id: 'top_phy_force', subjectId: 'sub_phy', name: 'Forces & Newton’s Laws', order: 2, mastery: 'learning', locked: false, examRelevant: true, objectiveCount: 3, lessonCount: 2 },
  { id: 'top_phy_energy', subjectId: 'sub_phy', name: 'Work, Energy & Power', order: 3, mastery: 'not_started', locked: true, examRelevant: true, objectiveCount: 3, lessonCount: 2 },
];

export const MOCK_OBJECTIVES: Objective[] = [
  { id: 'obj_trig_1', topicId: 'top_math_trig', statement: 'Apply sine and cosine ratios in right-angled triangles', mastery: 'learning', masteryPct: 55 },
  { id: 'obj_trig_2', topicId: 'top_math_trig', statement: 'Solve problems using the sine and cosine rules', mastery: 'not_started', masteryPct: 10 },
  { id: 'obj_trig_3', topicId: 'top_math_trig', statement: 'Find angles of elevation and depression', mastery: 'learning', masteryPct: 40 },
  { id: 'obj_simul_1', topicId: 'top_math_simul', statement: 'Solve simultaneous linear equations by substitution', mastery: 'proficient', masteryPct: 78 },
  { id: 'obj_motion_1', topicId: 'top_phy_motion', statement: 'Use equations of uniformly accelerated motion', mastery: 'proficient', masteryPct: 72 },
];

export const MOCK_LESSONS: Lesson[] = [
  {
    id: 'les_trig_1', topicId: 'top_math_trig', title: 'Sine, Cosine & Tangent — the SOHCAHTOA story', durationSec: 510,
    hasCaptions: true, hasAudioOnly: true, dataBudgetKb: 8200, downloaded: true,
    transcript: 'Welcome. In any right-angled triangle the ratio of the sides depends only on the angle. SOH: sine = opposite over hypotenuse. CAH: cosine = adjacent over hypotenuse. TOA: tangent = opposite over adjacent. Let us work an example: a ladder leans against a wall at 60 degrees...',
  },
  {
    id: 'les_trig_2', topicId: 'top_math_trig', title: 'Angles of elevation & depression', durationSec: 420,
    hasCaptions: true, hasAudioOnly: true, dataBudgetKb: 6400, downloaded: false,
    transcript: 'When you look up at the top of a mast, the angle your line of sight makes with the horizontal is the angle of elevation. Looking down gives the angle of depression. These two are equal (alternate angles)...',
  },
  {
    id: 'les_motion_1', topicId: 'top_phy_motion', title: 'Equations of motion made simple', durationSec: 600,
    hasCaptions: true, hasAudioOnly: true, dataBudgetKb: 9100, downloaded: true,
    transcript: 'There are three core equations of uniformly accelerated motion. v = u + at links velocity, acceleration and time. s = ut + half a t squared gives displacement...',
  },
];

// ── Question bank (practice + bundled into the offline mock) ──────────────────
export const MOCK_QUESTIONS: Question[] = [
  {
    id: 'q_trig_1', objectiveId: 'obj_trig_1', subjectId: 'sub_math', type: 'mcq',
    stem: 'In a right-angled triangle the side opposite the 30° angle is 5 cm. What is the length of the hypotenuse?',
    options: [{ id: 'a', text: '10 cm' }, { id: 'b', text: '5√3 cm' }, { id: 'c', text: '2.5 cm' }, { id: 'd', text: '7 cm' }],
    correct: ['a'], hint: 'sin 30° = opposite / hypotenuse, and sin 30° = 0.5.',
    explanation: 'sin 30° = 5 / h → 0.5 = 5 / h → h = 10 cm.', source: 'UTME 2019',
  },
  {
    id: 'q_trig_2', objectiveId: 'obj_trig_1', subjectId: 'sub_math', type: 'mcq',
    stem: 'cos 60° equals:',
    options: [{ id: 'a', text: '1' }, { id: 'b', text: '0.5' }, { id: 'c', text: '√3/2' }, { id: 'd', text: '0' }],
    correct: ['b'], explanation: 'cos 60° = 0.5 is a standard value.', source: 'WASSCE 2021',
  },
  {
    id: 'q_simul_1', objectiveId: 'obj_simul_1', subjectId: 'sub_math', type: 'mcq',
    stem: 'Solve: x + y = 7 and x − y = 1. Find x.',
    options: [{ id: 'a', text: '3' }, { id: 'b', text: '4' }, { id: 'c', text: '5' }, { id: 'd', text: '6' }],
    correct: ['b'], hint: 'Add the two equations to eliminate y.',
    explanation: 'Adding: 2x = 8 → x = 4.', source: 'NECO 2020',
  },
  {
    id: 'q_eng_1', subjectId: 'sub_eng', type: 'mcq',
    stem: 'Choose the option nearest in meaning to "ubiquitous".',
    options: [{ id: 'a', text: 'rare' }, { id: 'b', text: 'everywhere' }, { id: 'c', text: 'ancient' }, { id: 'd', text: 'hidden' }],
    correct: ['b'], explanation: '"Ubiquitous" means present everywhere.', source: 'UTME 2022',
  },
  {
    id: 'q_phy_1', objectiveId: 'obj_motion_1', subjectId: 'sub_phy', type: 'mcq',
    stem: 'A car accelerates from rest at 2 m/s² for 5 s. Its final velocity is:',
    options: [{ id: 'a', text: '5 m/s' }, { id: 'b', text: '7 m/s' }, { id: 'c', text: '10 m/s' }, { id: 'd', text: '20 m/s' }],
    correct: ['c'], hint: 'v = u + at, with u = 0.',
    explanation: 'v = 0 + 2×5 = 10 m/s.', source: 'UTME 2018',
  },
  {
    id: 'q_phy_2', objectiveId: 'obj_motion_1', subjectId: 'sub_phy', type: 'true_false',
    stem: 'Acceleration is a vector quantity.',
    options: [{ id: 't', text: 'True' }, { id: 'f', text: 'False' }],
    correct: ['t'], explanation: 'Acceleration has both magnitude and direction, so it is a vector.', source: 'WASSCE 2019',
  },
  {
    id: 'q_chem_1', subjectId: 'sub_chem', type: 'mcq',
    stem: 'The atomic number of an element is the number of:',
    options: [{ id: 'a', text: 'neutrons' }, { id: 'b', text: 'protons' }, { id: 'c', text: 'protons + neutrons' }, { id: 'd', text: 'electrons + neutrons' }],
    correct: ['b'], explanation: 'Atomic number = number of protons in the nucleus.', source: 'NECO 2021',
  },
  {
    id: 'q_bio_1', subjectId: 'sub_bio', type: 'mcq',
    stem: 'The powerhouse of the cell is the:',
    options: [{ id: 'a', text: 'nucleus' }, { id: 'b', text: 'ribosome' }, { id: 'c', text: 'mitochondrion' }, { id: 'd', text: 'vacuole' }],
    correct: ['c'], explanation: 'Mitochondria generate ATP, the cell’s energy currency.', source: 'UTME 2020',
  },
];

// ── Exam arenas (the Crown) ──────────────────────────────────────────────────
export const MOCK_ARENAS: ExamArena[] = [
  {
    id: 'arena_utme', slug: 'utme', name: 'JAMB UTME',
    nextSittingDate: daysAhead(38), readinessPct: 64, syllabusCoveragePct: 58,
    subjectsRequired: 4, isCbt: true,
    description: 'Computer-based test. Four subjects, 180 minutes. English is compulsory.',
  },
  {
    id: 'arena_bece', slug: 'bece', name: 'BECE',
    nextSittingDate: daysAhead(96), readinessPct: 71, syllabusCoveragePct: 66,
    subjectsRequired: 9, isCbt: false,
    description: 'Basic Education Certificate Examination for JSS3 transition to senior secondary.',
  },
];

export const MOCK_BLUEPRINTS: ExamBlueprint[] = [
  {
    id: 'bp_utme_full', arenaId: 'arena_utme', label: 'Full Mock — 4 subjects',
    subjects: [
      { subjectId: 'sub_eng', subjectName: 'English', questionCount: 2 },
      { subjectId: 'sub_math', subjectName: 'Mathematics', questionCount: 2 },
      { subjectId: 'sub_phy', subjectName: 'Physics', questionCount: 2 },
      { subjectId: 'sub_chem', subjectName: 'Chemistry', questionCount: 1 },
    ],
    durationMin: 12, totalQuestions: 7, calculatorAllowed: true, offlineItemCount: 7,
  },
  {
    id: 'bp_utme_math', arenaId: 'arena_utme', label: 'Single subject — Mathematics',
    subjects: [{ subjectId: 'sub_math', subjectName: 'Mathematics', questionCount: 3 }],
    durationMin: 6, totalQuestions: 3, calculatorAllowed: true, offlineItemCount: 3,
  },
  {
    id: 'bp_bece_full', arenaId: 'arena_bece', label: 'BECE Mock — mixed',
    subjects: [
      { subjectId: 'sub_eng', subjectName: 'English', questionCount: 1 },
      { subjectId: 'sub_math', subjectName: 'Mathematics', questionCount: 1 },
      { subjectId: 'sub_bio', subjectName: 'Basic Science', questionCount: 1 },
    ],
    durationMin: 8, totalQuestions: 3, calculatorAllowed: false, offlineItemCount: 3,
  },
];

export const MOCK_UTME_COMBINATIONS: UtmeCombination[] = [
  { course: 'Medicine & Surgery', subjects: ['English', 'Biology', 'Chemistry', 'Physics'], note: 'Required for most medical schools.' },
  { course: 'Computer Science', subjects: ['English', 'Mathematics', 'Physics', 'Chemistry'], note: 'Mathematics is compulsory; some schools accept Economics.' },
  { course: 'Law', subjects: ['English', 'Literature', 'Government', 'CRS/IRS'], note: 'Literature-in-English is compulsory.' },
  { course: 'Accounting', subjects: ['English', 'Mathematics', 'Economics', 'Commerce'], note: 'Mathematics + Economics required.' },
];

// ── Gamification ─────────────────────────────────────────────────────────────
export const MOCK_GAMIFICATION: GamificationProfile = {
  level: 7, xp: 3420, xpToNext: 580, streakDays: 12, freezeTokens: 2, rank: 18,
};

export const MOCK_BADGES: Badge[] = [
  { id: 'bdg_streak7', name: '7-Day Streak', description: 'Studied 7 days in a row', icon: 'Flame', earned: true, earnedAt: daysAgo(5) },
  { id: 'bdg_first_mock', name: 'First Mock', description: 'Completed your first CBT mock', icon: 'Trophy', earned: true, earnedAt: daysAgo(2) },
  { id: 'bdg_math_master', name: 'Algebra Ace', description: 'Mastered 5 Maths topics', icon: 'Calculator', earned: false },
  { id: 'bdg_night_owl', name: 'Night Owl', description: 'Study after 9pm five times', icon: 'Moon', earned: false },
];

export const MOCK_CHALLENGES: Challenge[] = [
  { id: 'ch_daily', title: 'Daily 3', description: 'Answer 3 practice questions today', cadence: 'daily', progress: 1, target: 3, rewardPoints: 50, completed: false },
  { id: 'ch_weekly', title: 'Weekly Marathon', description: 'Complete 1 mock exam this week', cadence: 'weekly', progress: 0, target: 1, rewardPoints: 300, completed: false },
  { id: 'ch_sponsor', title: 'MTN Data Dash', description: 'Master 2 Physics topics', cadence: 'sponsor', progress: 1, target: 2, rewardPoints: 500, sponsor: 'MTN', completed: false },
];

export const MOCK_LEADERBOARD: LeaderboardEntry[] = [
  { rank: 1, name: 'Aisha B.', xp: 8120, isMe: false },
  { rank: 2, name: 'Tunde O.', xp: 7640, isMe: false },
  { rank: 3, name: 'Ngozi E.', xp: 6990, isMe: false },
  { rank: 17, name: 'Emeka U.', xp: 3510, isMe: false },
  { rank: 18, name: 'You', xp: 3420, isMe: true },
  { rank: 19, name: 'Fatima L.', xp: 3380, isMe: false },
];

// ── Rewards (learn-to-earn) ──────────────────────────────────────────────────
export const MOCK_REWARD_BALANCE: RewardBalance = {
  points: 4250, pendingPoints: 150, lifetimeEarned: 9800,
};

export const MOCK_REWARD_HISTORY: RewardLedgerEntry[] = [
  { id: 'rl_1', ts: daysAgo(0), kind: 'earn', reason: 'Practice set completed', points: 50, synced: false },
  { id: 'rl_2', ts: daysAgo(1), kind: 'earn', reason: 'Mock exam completed', points: 300, synced: true },
  { id: 'rl_3', ts: daysAgo(3), kind: 'redeem', reason: 'Redeemed 200MB data', points: -800, synced: true },
  { id: 'rl_4', ts: daysAgo(4), kind: 'earn', reason: '7-day streak bonus', points: 200, synced: true },
];

export const MOCK_REWARD_CATALOG: RewardCatalogItem[] = [
  { id: 'rw_data200', name: '200MB Data', description: 'Airtime data bundle (any network)', icon: 'Wifi', pointsCost: 800, category: 'data' },
  { id: 'rw_airtime100', name: '₦100 Airtime', description: 'Mobile airtime top-up', icon: 'Phone', pointsCost: 600, walletValueKobo: 10000, category: 'airtime' },
  { id: 'rw_wallet500', name: '₦500 to Wallet', description: 'Credit your Spotlight wallet', icon: 'Wallet', pointsCost: 2500, walletValueKobo: 50000, category: 'wallet' },
  { id: 'rw_mockpass', name: 'Mock Exam Pass', description: 'Unlock one premium full mock', icon: 'Ticket', pointsCost: 1500, category: 'exam' },
];

// ── Commerce ─────────────────────────────────────────────────────────────────
export const MOCK_PLANS: Plan[] = [
  {
    id: 'plan_free', name: 'Starter', tagline: 'Learn the basics free', priceKobo: 0, period: 'monthly',
    features: ['Daily practice', 'Limited lessons', 'Community challenges'],
  },
  {
    id: 'plan_scholar', name: 'Scholar', tagline: 'Everything for one exam', priceKobo: 250000, period: 'monthly',
    features: ['All lessons offline', '1 exam arena', 'Unlimited mocks', 'Reward boosts'], recommended: true,
  },
  {
    id: 'plan_elite', name: 'Elite', tagline: 'All arenas + live clinics', priceKobo: 600000, period: 'monthly',
    features: ['All exam arenas', 'Live exam clinics', 'Predicted scores', 'Priority support'],
  },
];

export const MOCK_BUNDLES: Bundle[] = [
  {
    id: 'bun_utme_pro', examSlug: 'utme', name: 'UTME Pro Pack', description: '20 full mocks, 10yr past questions, all 4-subject lessons offline',
    priceKobo: 350000, bnplEligible: true, itemCount: 64, dataBudgetMb: 240, icon: 'GraduationCap',
  },
  {
    id: 'bun_bece_starter', examSlug: 'bece', name: 'BECE Starter Pack', description: '10 mocks + revision lessons for all BECE subjects',
    priceKobo: 180000, bnplEligible: true, itemCount: 38, dataBudgetMb: 150, icon: 'School',
  },
  {
    id: 'bun_wassce_lit', examSlug: 'wassce', name: 'WASSCE Literature Set', description: 'Set texts, analysis & past questions',
    priceKobo: 120000, bnplEligible: false, itemCount: 22, dataBudgetMb: 90, icon: 'BookOpen',
  },
];

export const MOCK_BUNDLE_MANIFEST: Record<string, BundleManifestItem[]> = {
  bun_utme_pro: [
    { id: 'mi_1', type: 'mock', title: 'UTME Full Mock 1', sizeKb: 1200 },
    { id: 'mi_2', type: 'mock', title: 'UTME Full Mock 2', sizeKb: 1200 },
    { id: 'mi_3', type: 'past_questions', title: 'Mathematics 2014–2023', sizeKb: 3400 },
    { id: 'mi_4', type: 'lesson', title: 'Trigonometry crash course', sizeKb: 8200 },
    { id: 'mi_5', type: 'drill', title: 'English comprehension drills', sizeKb: 900 },
  ],
  bun_bece_starter: [
    { id: 'mi_b1', type: 'mock', title: 'BECE Mock 1', sizeKb: 800 },
    { id: 'mi_b2', type: 'lesson', title: 'Basic Science revision', sizeKb: 5200 },
  ],
};

// ── Wallet ───────────────────────────────────────────────────────────────────
export const MOCK_WALLET: AcademyWallet = {
  spendableKobo: 125000,
  rewardPoints: 4250,
  recent: [
    { id: 'w_1', ts: daysAgo(0), label: 'Reward: practice set', points: 50, kind: 'reward' },
    { id: 'w_2', ts: daysAgo(2), label: 'Access card top-up', amountKobo: 100000, kind: 'credit' },
    { id: 'w_3', ts: daysAgo(6), label: 'UTME Pro Pack', amountKobo: 350000, kind: 'debit' },
  ],
};
