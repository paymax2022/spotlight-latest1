// ── Spotlight Academy — Shared API layer (Phase 0 + Phase 1) ─────────────────
// Typed mock-first data layer the screens code against. With USE_MOCK=true the
// whole app runs with no backend. Flip the flag to hit the live member routes on
// the frontend-web proxy → Go /api/finance/academy/*.
//
// IRON RULES honoured here:
//  • Money amounts are integers in minor units (kobo). Reward points are plain ints.
//  • Reward earns/redeems and exam attempts are designed to queue offline and
//    reconcile on reconnect (see offlineQueue). Scoring/timing/money are treated
//    as server-authoritative — the mock simulates the eventual server response.
//  • Minor-without-consent is gated in commerce/redeem (fail-closed).

import { api } from '@/api/client';
import { USE_MOCK, ACADEMY_API_BASE } from './constants';
import { track } from './analytics';
import { enqueue } from './offlineQueue';
import { creditPoints, type PointsLedgerState } from './pointsLedger';
import { assertCanSpend, type SpendConsentState } from './consent';
import { upsertBookmark } from './bookmarks';
import { adaptClasses, adaptVersions, adaptSubjects, adaptTopics, adaptObjectives, adaptLessons, adaptLesson, type GoClass, type GoVersion, type GoSubject, type GoTopic, type GoObjective, type GoLesson } from './curriculumAdapters';
import { adaptPracticeItems, toPracticeSubmit, adaptPracticeResult, type GoQuestionItem, type GoPracticeResult } from './practiceAdapters';
import { adaptStartedAttempt, toExamSubmit, adaptExamResult, adaptArena, adaptArenas, adaptBlueprints, type GoExamAttempt, type GoScoredAttempt, type GoExamResultProjection, type GoArena, type GoBlueprint } from './examAdapters';
import { adaptGamificationProfile, adaptChallenges, adaptBadges, adaptClassLeaderboard, type GoGamificationProfile, type GoChallenge, type GoBadgeView, type GoClassLeaderboard } from './gamificationAdapters';
import type {
  AcademyProfile,
  GuardianConsentState,
  CurriculumVersion,
  AcademyClass,
  Subject,
  Topic,
  Objective,
  Lesson,
  Question,
  PracticeSubmission,
  PracticeResult,
  MasterySnapshot,
  ExamArena,
  ExamBlueprint,
  ExamAttempt,
  ExamResult,
  UtmeCombination,
  GamificationProfile,
  Badge,
  Challenge,
  LeaderboardEntry,
  ClassLeaderboard,
  RewardBalance,
  RewardLedgerEntry,
  RewardCatalogItem,
  Plan,
  Bundle,
  BundleManifestItem,
  Order,
  AccessCardResult,
  AcademyWallet,
} from './types';
import type {
  LearningPath,
  AdaptiveSet,
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
  EduPayPayment,
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
} from './types';
import type {
  TradeTrack,
  TradeModule,
  TradeHub,
  TradeProject,
  SkillAssessment,
  AssessmentResult,
  Credential,
  CredentialVerification,
  EarningOpportunity,
  EarningApplication,
  Mentor,
  LiveSession,
  LiveJoinToken,
  StudyGroup,
  Discussion,
  ModerationReport,
  ReportReason,
  AcademyNotification,
  Announcement,
  RubricCriterion,
  TradeSlug,
} from './types';
import type {
  TutorProfile,
  TutorListing,
  TutorOnboardInput,
  Cohort,
  Assignment,
  CreateAssignmentInput,
  Submission,
  GradeInput,
  TutorEarnings,
  TutorLedgerEntry,
  PayoutRequest,
  PayoutMethod,
  ManagedSchool,
  SchoolOverview,
  EcceHome,
} from './types';
import * as M from './api/academy.mock';
import * as P2 from './api/academy.phase2.mock';
import * as P3 from './api/academy.phase3.mock';
import * as P4 from './api/academy.phase4.mock';

const B = ACADEMY_API_BASE;
const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));

// In-memory mutable copies so mock mutations persist for the session.
let profile: AcademyProfile = { ...M.MOCK_PROFILE };
let rewardBalance: RewardBalance = { ...M.MOCK_REWARD_BALANCE };
let rewardHistory: RewardLedgerEntry[] = [...M.MOCK_REWARD_HISTORY];
let wallet: AcademyWallet = { ...M.MOCK_WALLET, recent: [...M.MOCK_WALLET.recent] };
const attempts = new Map<string, ExamAttempt>();
const examResults = new Map<string, ExamResult>();

// Phase-2 mutable session state (mock persistence).
let children: ChildSummary[] = P2.MOCK_CHILDREN.map((c) => ({ ...c }));
const controls = new Map<string, UsageControls>(Object.entries(P2.MOCK_CONTROLS).map(([k, v]) => [k, { ...v }]));
let reports: ProgressReport[] = [...P2.MOCK_REPORTS];
let approvals: PurchaseApproval[] = P2.MOCK_APPROVALS.map((a) => ({ ...a }));
let edupay: EduPayProfile = { ...P2.MOCK_EDUPAY_PROFILE, payments: [...P2.MOCK_EDUPAY_PROFILE.payments] };
let feeSchedules: FeeSchedule[] = P2.MOCK_FEE_SCHEDULES.map((f) => ({ ...f }));
let schools: School[] = P2.MOCK_SCHOOLS.map((s) => ({ ...s }));
let pots: SavingsPot[] = P2.MOCK_POTS.map((p) => ({ ...p }));
let scholarships: Scholarship[] = P2.MOCK_SCHOLARSHIPS.map((s) => ({ ...s }));
let bookmarks: Bookmark[] = [...P2.MOCK_BOOKMARKS];
let notes: LessonNote[] = [...P2.MOCK_NOTES];
let downloads: DownloadedBundle[] = P2.MOCK_DOWNLOADS.map((d) => ({ ...d }));

// Phase-3 mutable session state (mock persistence).
let tradeTracks: TradeTrack[] = P3.MOCK_TRADE_TRACKS.map((t) => ({ ...t }));
const tradeModules = new Map<string, TradeModule[]>(Object.entries(P3.MOCK_TRADE_MODULES).map(([k, v]) => [k, v.map((m) => ({ ...m }))]));
const tradeProjects = new Map<string, TradeProject>(Object.entries(P3.MOCK_TRADE_PROJECTS).map(([k, v]) => [k, { ...v, rubric: v.rubric.map((r) => ({ ...r })), attachments: [...v.attachments] }]));
const assessments3 = new Map<string, SkillAssessment>(Object.entries(P3.MOCK_ASSESSMENTS).map(([k, v]) => [k, { ...v }]));
let credentials: Credential[] = P3.MOCK_CREDENTIALS.map((c) => ({ ...c }));
let opportunities: EarningOpportunity[] = P3.MOCK_OPPORTUNITIES.map((o) => ({ ...o }));
let mentors: Mentor[] = P3.MOCK_MENTORS.map((m) => ({ ...m }));
let liveSessions: LiveSession[] = P3.MOCK_LIVE_SESSIONS.map((s) => ({ ...s }));
let studyGroups: StudyGroup[] = P3.MOCK_STUDY_GROUPS.map((g) => ({ ...g }));
let discussions: Discussion[] = P3.MOCK_DISCUSSIONS.map((d) => ({ ...d }));
let notifications3: AcademyNotification[] = P3.MOCK_NOTIFICATIONS.map((n) => ({ ...n }));

// Phase-4 mutable session state (mock persistence).
let tutorProfile: TutorProfile = { ...P4.MOCK_TUTOR_PROFILE, payoutMethods: P4.MOCK_TUTOR_PROFILE.payoutMethods.map((m) => ({ ...m })) };
let cohorts: Cohort[] = P4.MOCK_COHORTS.map((c) => ({ ...c, students: c.students.map((s) => ({ ...s })) }));
let assignments: Assignment[] = P4.MOCK_ASSIGNMENTS.map((a) => ({ ...a }));
let submissions: Submission[] = P4.MOCK_SUBMISSIONS.map((s) => ({ ...s }));
let tutorEarnings: TutorEarnings = { ...P4.MOCK_TUTOR_EARNINGS, ledger: P4.MOCK_TUTOR_EARNINGS.ledger.map((l) => ({ ...l })) };
const managedSchools: ManagedSchool[] = P4.MOCK_MANAGED_SCHOOLS.map((s) => ({ ...s }));
const ecceHome: EcceHome = { ...P4.MOCK_ECCE_HOME, activities: P4.MOCK_ECCE_HOME.activities.map((a) => ({ ...a, rounds: a.rounds.map((r) => ({ ...r, options: r.options.map((o) => ({ ...o })) })) })) };

// ── Identity ──────────────────────────────────────────────────────────────────
export async function getMe(): Promise<AcademyProfile> {
  if (USE_MOCK) { await delay(); return profile; }
  const { data } = await api.get<AcademyProfile>(`${B}/me`);
  return data;
}

export async function setRole(role: AcademyProfile['role']): Promise<AcademyProfile> {
  if (USE_MOCK) {
    await delay();
    profile = { ...profile, role };
    return profile;
  }
  const { data } = await api.post<AcademyProfile>(`${B}/roles`, { role });
  return data;
}

export interface ProfileUpdate {
  displayName?: string;
  dob?: string;
  classCode?: string;
  curriculumVersion?: string;
  stream?: AcademyProfile['stream'];
  onboardingComplete?: boolean;
}

export async function updateProfile(input: ProfileUpdate): Promise<AcademyProfile> {
  if (USE_MOCK) {
    await delay();
    const next: AcademyProfile = { ...profile, ...input };
    // DOB → minor classification + consent requirement (child-safety).
    if (input.dob) {
      const age = Math.floor((Date.now() - new Date(input.dob).getTime()) / (365.25 * 86_400_000));
      next.isMinor = age < 18;
      next.guardianConsent = next.isMinor
        ? (profile.guardianConsent === 'granted' ? 'granted' : 'pending')
        : 'not_required';
    }
    profile = next;
    if (input.onboardingComplete) track('onboarding_completed', { class: profile.classCode });
    return profile;
  }
  const { data } = await api.put<AcademyProfile>(`${B}/profile`, input);
  return data;
}

export async function linkGuardian(guardianPhone: string): Promise<AcademyProfile> {
  if (USE_MOCK) {
    await delay(380);
    profile = { ...profile, guardianId: `grd_${guardianPhone.slice(-4)}`, guardianConsent: 'pending' };
    return profile;
  }
  const { data } = await api.post<AcademyProfile>(`${B}/guardians/link`, { guardianPhone });
  return data;
}

/** Record guardian consent for a minor (audit-logged server-side). */
export async function recordConsent(minorId: string, granted: boolean): Promise<AcademyProfile> {
  if (USE_MOCK) {
    await delay(380);
    const state: GuardianConsentState = granted ? 'granted' : 'pending';
    profile = { ...profile, guardianConsent: state };
    return profile;
  }
  const { data } = await api.post<AcademyProfile>(`${B}/guardians/${minorId}/consent`, { granted });
  return data;
}

// ── Curriculum ────────────────────────────────────────────────────────────────
export async function getCurriculumVersions(): Promise<CurriculumVersion[]> {
  if (USE_MOCK) { await delay(); return M.MOCK_CURRICULUM_VERSIONS; }
  // Live: Go returns { versions: [{id,code,name,status,effective_date?}] } → adapt.
  const { data } = await api.get<{ versions?: GoVersion[] }>(`${B}/curriculum/versions`);
  return adaptVersions(data);
}

export async function getClasses(): Promise<AcademyClass[]> {
  if (USE_MOCK) { await delay(); return M.MOCK_CLASSES; }
  // Live: Go returns { classes: [{id,version_id,phase,code,name,ordinal}] } → adapt.
  const { data } = await api.get<{ classes?: GoClass[] }>(`${B}/curriculum/classes`);
  return adaptClasses(data);
}

export async function getSubjects(classCode?: string): Promise<Subject[]> {
  if (USE_MOCK) {
    await delay();
    const code = classCode ?? profile.classCode;
    return M.MOCK_SUBJECTS.filter((s) => !code || s.classCode === code);
  }
  // Live: the subjects route is keyed by the class UUID, but callers hold the
  // class CODE. Class codes repeat across curriculum versions (legacy + NERDC),
  // so resolve the code WITHIN the active (newest, non-legacy) version — the
  // legacy classes carry no subjects.
  const code = classCode ?? profile.classCode;
  const [classes, versions] = await Promise.all([getClasses(), getCurriculumVersions()]);
  const activeVersion =
    versions.filter((v) => !v.isLegacy).sort((a, b) => b.effectiveYear - a.effectiveYear)[0] ?? versions[0];
  const cls =
    (code && classes.find((c) => c.code === code && c.curriculumVersionId === activeVersion?.id)) ||
    (code && classes.find((c) => c.code === code)) ||
    classes[0];
  if (!cls) return [];
  const { data } = await api.get<{ subjects?: GoSubject[] }>(`${B}/curriculum/classes/${cls.id}/subjects`);
  return adaptSubjects(data, cls.code);
}

export async function getSubject(id: string): Promise<Subject> {
  if (USE_MOCK) {
    await delay();
    const s = M.MOCK_SUBJECTS.find((x) => x.id === id);
    if (!s) throw new Error('Subject not found');
    return s;
  }
  const { data } = await api.get<Subject>(`${B}/curriculum/subjects/${id}`);
  return data;
}

export async function getTopics(subjectId: string): Promise<Topic[]> {
  if (USE_MOCK) {
    await delay();
    return M.MOCK_TOPICS.filter((t) => t.subjectId === subjectId).sort((a, b) => a.order - b.order);
  }
  // Live: subjectId is already the Go subject UUID (from the live subjects call),
  // and the route is keyed by it — fetch + adapt directly.
  const { data } = await api.get<{ topics?: GoTopic[] }>(`${B}/curriculum/subjects/${subjectId}/topics`);
  return adaptTopics(data);
}

export async function getTopic(id: string): Promise<Topic> {
  if (USE_MOCK) {
    await delay();
    const t = M.MOCK_TOPICS.find((x) => x.id === id);
    if (!t) throw new Error('Topic not found');
    return t;
  }
  const { data } = await api.get<Topic>(`${B}/curriculum/topics/${id}`);
  return data;
}

export async function getObjectives(topicId: string): Promise<Objective[]> {
  if (USE_MOCK) {
    await delay();
    return M.MOCK_OBJECTIVES.filter((o) => o.topicId === topicId);
  }
  // Live: topicId is already the Go topic UUID (from the live topics call) and the
  // route is keyed by it — fetch + adapt directly.
  const { data } = await api.get<{ objectives?: GoObjective[] }>(`${B}/curriculum/topics/${topicId}/objectives`);
  return adaptObjectives(data);
}

export async function getLessons(topicId: string): Promise<Lesson[]> {
  if (USE_MOCK) {
    await delay();
    return M.MOCK_LESSONS.filter((l) => l.topicId === topicId);
  }
  // Live: topicId is the Go topic UUID (from the live topics call). The bridge
  // returns lessons via topic→objectives→academy_edu_lessons; inject topicId
  // (Go rows carry objective_id, not topic_id).
  const { data } = await api.get<{ lessons?: GoLesson[] }>(`${B}/curriculum/topics/${topicId}/lessons`);
  return adaptLessons(data, topicId);
}

export async function getLesson(id: string): Promise<Lesson> {
  if (USE_MOCK) {
    await delay();
    const l = M.MOCK_LESSONS.find((x) => x.id === id);
    if (!l) throw new Error('Lesson not found');
    return l;
  }
  // Live: the single-lesson route carries objective_id, not topic_id — the player
  // doesn't rely on topicId here, so adapt with an empty topicId.
  const { data } = await api.get<GoLesson>(`${B}/curriculum/lessons/${id}`);
  return adaptLesson(data, '');
}

// ── Assessment ────────────────────────────────────────────────────────────────
export async function getPractice(objectiveId?: string): Promise<Question[]> {
  if (USE_MOCK) {
    await delay();
    const pool = objectiveId
      ? M.MOCK_QUESTIONS.filter((q) => q.objectiveId === objectiveId)
      : M.MOCK_QUESTIONS;
    // Fall back to a small mixed set if the objective has no dedicated items.
    return pool.length ? pool : M.MOCK_QUESTIONS.slice(0, 3);
  }
  // Live: Go returns { data: [question items] } with the answer key stripped →
  // adapt to mobile Question (grading stays server-authoritative).
  const { data } = await api.get<{ data?: GoQuestionItem[] }>(`${B}/practice`, { params: { objective: objectiveId } });
  return adaptPracticeItems(data.data);
}

export async function submitPractice(sub: PracticeSubmission): Promise<PracticeResult> {
  const grade = (): PracticeResult => {
    const breakdown = sub.answers.map((a) => {
      const q = M.MOCK_QUESTIONS.find((x) => x.id === a.questionId)!;
      const correct = q && setsEqual(a.selected, q.correct);
      return {
        questionId: a.questionId,
        stem: q?.stem ?? '',
        correct,
        selected: a.selected,
        correctAnswers: q?.correct ?? [],
        explanation: q?.explanation ?? '',
      };
    });
    const correct = breakdown.filter((b) => b.correct).length;
    const total = breakdown.length || 1;
    const scorePct = Math.round((correct / total) * 100);
    const masteryGained = scorePct >= 70;
    const pointsEarned = correct * 10 + (masteryGained ? 20 : 0);
    return {
      total: breakdown.length,
      correct,
      scorePct,
      masteryGained,
      newMastery: masteryGained ? 'proficient' : 'learning',
      breakdown,
      pointsEarned,
    };
  };

  if (USE_MOCK) {
    await delay(450);
    const result = grade();
    // Reward points queue offline + reconcile (server-authoritative on sync).
    creditPointsLocal(result.pointsEarned, 'Practice set completed');
    track('practice_completed', { score: result.scorePct, objective: sub.objectiveId });
    if (result.masteryGained) track('mastery_gained', { objective: sub.objectiveId });
    return result;
  }
  // Live: send the learner's selections in the grader's shape and let the server
  // score against the canonical key + advance mastery; adapt the result back.
  const { data } = await api.post<{ data: GoPracticeResult }>(
    `${B}/practice/submit`,
    toPracticeSubmit(sub.objectiveId, sub.answers),
  );
  const result = adaptPracticeResult(data.data, sub.answers);
  // Mirror the offline reward + telemetry so live and mock behave identically.
  creditPointsLocal(result.pointsEarned, 'Practice set completed');
  track('practice_completed', { score: result.scorePct, objective: sub.objectiveId });
  if (result.masteryGained) track('mastery_gained', { objective: sub.objectiveId });
  return result;
}

export async function getMastery(): Promise<MasterySnapshot[]> {
  if (USE_MOCK) {
    await delay();
    return M.MOCK_OBJECTIVES.map((o) => {
      const topic = M.MOCK_TOPICS.find((t) => t.id === o.topicId);
      return {
        objectiveId: o.id,
        topicId: o.topicId,
        subjectId: topic?.subjectId ?? '',
        statement: o.statement,
        state: o.mastery,
        pct: o.masteryPct,
      };
    });
  }
  const { data } = await api.get<MasterySnapshot[]>(`${B}/mastery`);
  return data;
}

// ── Exam (the Crown) ─────────────────────────────────────────────────────────
export async function getArenas(): Promise<ExamArena[]> {
  if (USE_MOCK) { await delay(); return M.MOCK_ARENAS; }
  // Live: Go returns { data: [snake_case arena rows] } → unwrap + adapt.
  const { data } = await api.get<{ data?: GoArena[] }>(`${B}/exam/arenas`);
  return adaptArenas(data.data);
}

export async function getArena(id: string): Promise<ExamArena> {
  if (USE_MOCK) {
    await delay();
    const a = M.MOCK_ARENAS.find((x) => x.id === id);
    if (!a) throw new Error('Arena not found');
    return a;
  }
  const { data } = await api.get<{ data: GoArena }>(`${B}/exam/arenas/${id}`);
  return adaptArena(data.data);
}

export async function getBlueprints(arenaId: string): Promise<ExamBlueprint[]> {
  if (USE_MOCK) {
    await delay();
    return M.MOCK_BLUEPRINTS.filter((b) => b.arenaId === arenaId);
  }
  const { data } = await api.get<{ data?: GoBlueprint[] }>(`${B}/exam/arenas/${arenaId}/blueprints`);
  return adaptBlueprints(data.data);
}

export async function getUtmeCombinations(course?: string): Promise<UtmeCombination[]> {
  if (USE_MOCK) {
    await delay();
    const q = course?.trim().toLowerCase();
    return q ? M.MOCK_UTME_COMBINATIONS.filter((c) => c.course.toLowerCase().includes(q)) : M.MOCK_UTME_COMBINATIONS;
  }
  const { data } = await api.get<UtmeCombination[]>(`${B}/exam/utme/combinations`, { params: { course } });
  return data;
}

/**
 * Start an attempt. Offline-capable: the question set comes from the locally
 * bundled mock items so the CBT simulator works with no network. The client
 * countdown is advisory; on submit the server confirms time + score.
 */
export async function startAttempt(blueprintId: string): Promise<ExamAttempt> {
  if (USE_MOCK) {
    await delay(420);
    const bp = M.MOCK_BLUEPRINTS.find((b) => b.id === blueprintId);
    if (!bp) throw new Error('Blueprint not found');
    // Compose the question set from bundled items per subject (offline source).
    const questions: Question[] = [];
    bp.subjects.forEach((s) => {
      const pool = M.MOCK_QUESTIONS.filter((q) => q.subjectId === s.subjectId);
      for (let i = 0; i < s.questionCount; i++) {
        questions.push(pool[i % pool.length]);
      }
    });
    const attempt: ExamAttempt = {
      id: `att_${Date.now()}`,
      arenaId: bp.arenaId,
      blueprintId,
      status: 'in_progress',
      startedAt: new Date().toISOString(),
      durationSec: bp.durationMin * 60,
      remainingSec: bp.durationMin * 60,
      questions,
      answers: {},
      flagged: [],
      calculatorAllowed: bp.calculatorAllowed,
      offlineOrigin: true,
    };
    attempts.set(attempt.id, attempt);
    return attempt;
  }
  // Live: create the server attempt, then fetch its served question set (answer
  // key stripped) and compose the client working copy. Stored locally so the CBT
  // screen, patchAttemptLocal and submit all read from it (questions live only
  // client-side; grading is server-authoritative on submit).
  const { data: started } = await api.post<{ data: GoExamAttempt }>(`${B}/exam/attempts`, { blueprint_id: blueprintId });
  const go = started.data;
  const { data: qwrap } = await api.get<{ data?: GoQuestionItem[] }>(`${B}/exam/attempts/${go.id}/questions`);
  const attempt = adaptStartedAttempt(go, adaptPracticeItems(qwrap.data));
  attempts.set(attempt.id, attempt);
  return attempt;
}

export async function getAttempt(id: string): Promise<ExamAttempt> {
  if (USE_MOCK) {
    await delay(120);
    const a = attempts.get(id);
    if (!a) throw new Error('Attempt not found');
    return a;
  }
  // Live: the working copy (with its served questions) lives client-side — prefer
  // it. On a cold read (e.g. app relaunch) rebuild it from the server attempt +
  // freshly-served questions so the CBT screen still has a set to render.
  const local = attempts.get(id);
  if (local) return local;
  const { data: awrap } = await api.get<{ data: GoExamAttempt }>(`${B}/exam/attempts/${id}`);
  const { data: qwrap } = await api.get<{ data?: GoQuestionItem[] }>(`${B}/exam/attempts/${id}/questions`);
  const rebuilt = adaptStartedAttempt(awrap.data, adaptPracticeItems(qwrap.data));
  attempts.set(id, rebuilt);
  return rebuilt;
}

/** Persist answers/flags/remaining locally (the offline working copy). */
export function patchAttemptLocal(id: string, patch: Partial<Pick<ExamAttempt, 'answers' | 'flagged' | 'remainingSec'>>): ExamAttempt | undefined {
  const a = attempts.get(id);
  if (!a) return undefined;
  const next = { ...a, ...patch };
  attempts.set(id, next);
  return next;
}

export async function pauseAttempt(id: string): Promise<ExamAttempt> {
  if (USE_MOCK) {
    await delay(150);
    const a = attempts.get(id)!;
    a.status = 'paused';
    return a;
  }
  const { data } = await api.post<ExamAttempt>(`${B}/exam/attempts/${id}/pause`, {});
  return data;
}

export async function resumeAttempt(id: string): Promise<ExamAttempt> {
  if (USE_MOCK) {
    await delay(150);
    const a = attempts.get(id)!;
    a.status = 'in_progress';
    return a;
  }
  const { data } = await api.post<ExamAttempt>(`${B}/exam/attempts/${id}/resume`, {});
  return data;
}

/** Submit for grading. Server-authoritative; the mock simulates the result. */
export async function submitAttempt(id: string): Promise<ExamResult> {
  const compute = (): ExamResult => {
    const a = attempts.get(id)!;
    const perSubject = new Map<string, { name: string; correct: number; total: number }>();
    let correct = 0;
    let answered = 0;
    a.questions.forEach((q) => {
      const sel = a.answers[q.id] ?? [];
      if (sel.length) answered++;
      const isCorrect = sel.length > 0 && setsEqual(sel, q.correct);
      if (isCorrect) correct++;
      const key = q.subjectId ?? 'misc';
      const subjName = M.MOCK_SUBJECTS.find((s) => s.id === key)?.name ?? 'General';
      const cur = perSubject.get(key) ?? { name: subjName, correct: 0, total: 0 };
      cur.total++;
      if (isCorrect) cur.correct++;
      perSubject.set(key, cur);
    });
    const total = a.questions.length || 1;
    const scorePct = Math.round((correct / total) * 100);
    return {
      attemptId: id,
      scorePct,
      totalQuestions: a.questions.length,
      correct,
      unanswered: a.questions.length - answered,
      timeSpentSec: a.durationSec - a.remainingSec,
      subjects: [...perSubject.entries()].map(([subjectId, v]) => ({
        subjectId, subjectName: v.name, correct: v.correct, total: v.total,
        scorePct: Math.round((v.correct / (v.total || 1)) * 100),
      })),
      readinessDelta: scorePct >= 50 ? 3 : 1,
      pointsEarned: 300,
    };
  };

  if (USE_MOCK) {
    await delay(600);
    const a = attempts.get(id)!;
    a.status = 'submitted';
    const result = compute();
    examResults.set(id, result);
    // Idempotent on the attempt id: re-submitting / revisiting the same attempt
    // must not re-award the 300 pts (previously farmable).
    creditPointsLocal(result.pointsEarned, 'Mock exam completed', `exam:${id}`);
    track('mock_completed', { score: result.scorePct, offlineOrigin: a.offlineOrigin });
    track('readiness_updated', { delta: result.readinessDelta });
    return result;
  }
  // Live: send the collected selections (grader shape) and let the server score
  // against the canonical key; adapt the scored attempt to the results screen.
  const local = attempts.get(id);
  if (!local) throw new Error('Attempt not found');
  const { data } = await api.post<{ data: GoScoredAttempt }>(`${B}/exam/attempts/${id}/submit`, toExamSubmit(local));
  const scored = data.data;
  const result = adaptExamResult(id, scored.score ?? { overall: 0 }, scored.readiness, local);
  attempts.set(id, { ...local, status: 'submitted' });
  examResults.set(id, result);
  // Idempotent on the attempt id so revisiting a submitted attempt never re-awards.
  creditPointsLocal(result.pointsEarned, 'Exam completed', `exam:${id}`);
  track('exam_completed', { score: result.scorePct, offlineOrigin: local.offlineOrigin });
  track('readiness_updated', { delta: result.readinessDelta });
  return result;
}

/** Read back a previously computed exam result (X9). */
export async function getExamResult(id: string): Promise<ExamResult> {
  if (USE_MOCK) {
    await delay(120);
    const r = examResults.get(id);
    if (!r) throw new Error('Result not ready');
    return r;
  }
  // Live: the just-computed result is cached from submit — prefer it (it carries
  // the client timing/answered counts). Otherwise read the server projection and
  // adapt against whatever local working copy we still hold.
  const cached = examResults.get(id);
  if (cached) return cached;
  const { data } = await api.get<{ data: GoExamResultProjection }>(`${B}/exam/attempts/${id}/result`);
  const proj = data.data;
  const local = attempts.get(id) ?? { questions: [], answers: {}, durationSec: 0, remainingSec: 0 };
  return adaptExamResult(id, proj, proj.readiness, local);
}

// ── Gamification ─────────────────────────────────────────────────────────────
export async function getGamificationProfile(): Promise<GamificationProfile> {
  if (USE_MOCK) { await delay(); return M.MOCK_GAMIFICATION; }
  // Live: Go returns the raw profile ({xp, level, streak_days, freezes}); adapt to
  // the mobile shape (xpToNext computed from the level curve). XP/streak are
  // awarded server-side on practice/exam completion.
  const { data } = await api.get<GoGamificationProfile>(`${B}/gamification/profile`);
  return adaptGamificationProfile(data);
}

export async function getBadges(): Promise<Badge[]> {
  if (USE_MOCK) { await delay(); return M.MOCK_BADGES; }
  // Live: Go returns { badges: [catalogue rows + earned status] } → unwrap + adapt.
  const { data } = await api.get<{ badges?: GoBadgeView[] }>(`${B}/gamification/badges`);
  return adaptBadges(data.badges);
}

export async function getChallenges(): Promise<Challenge[]> {
  if (USE_MOCK) { await delay(); return M.MOCK_CHALLENGES; }
  // Live: Go returns { challenges: [snake_case rows] } → unwrap + adapt (kind →
  // cadence; target/reward from criteria). Per-user progress isn't tracked yet.
  const { data } = await api.get<{ challenges?: GoChallenge[] }>(`${B}/gamification/challenges`);
  return adaptChallenges(data.challenges);
}

export async function getLeaderboard(id = 'national'): Promise<LeaderboardEntry[]> {
  if (USE_MOCK) { await delay(); return M.MOCK_LEADERBOARD; }
  const { data } = await api.get<LeaderboardEntry[]>(`${B}/gamification/leaderboards/${id}`);
  return data;
}

/**
 * The learner's class XP ranking (classmates only, first names, 'you' flagged).
 * XP is earned on the practice/exam earn-path; child-safe by construction (the
 * server scopes to the caller's class and never returns full names or user ids).
 */
export async function getClassLeaderboard(): Promise<ClassLeaderboard> {
  if (USE_MOCK) {
    await delay();
    return { classCode: '', periodKey: 'all-time', myRank: 0, entries: M.MOCK_LEADERBOARD };
  }
  const { data } = await api.get<GoClassLeaderboard>(`${B}/gamification/leaderboard/class`);
  return adaptClassLeaderboard(data);
}

// ── Rewards ──────────────────────────────────────────────────────────────────
export async function getRewardBalance(): Promise<RewardBalance> {
  if (USE_MOCK) { await delay(); return rewardBalance; }
  // Live: Go returns { data: { balance_minor } } — the confirmed reward-points
  // ledger sum (non-monetary, distinct from the wallet). pendingPoints is a local
  // offline concept the server doesn't track, so it reads 0 here. The server does
  // not expose a separate lifetime figure, so lifetimeEarned mirrors the confirmed
  // balance as a best-effort until a dedicated endpoint lands.
  const { data } = await api.get<{ data?: { balance_minor?: number } }>(`${B}/rewards/balance`);
  const balance = data.data?.balance_minor ?? 0;
  return { points: balance, pendingPoints: 0, lifetimeEarned: balance };
}

export async function getRewardHistory(): Promise<RewardLedgerEntry[]> {
  if (USE_MOCK) { await delay(); return rewardHistory; }
  const { data } = await api.get<RewardLedgerEntry[]>(`${B}/rewards/history`);
  return data;
}

export async function getRewardCatalog(): Promise<RewardCatalogItem[]> {
  if (USE_MOCK) { await delay(); return M.MOCK_REWARD_CATALOG; }
  const { data } = await api.get<RewardCatalogItem[]>(`${B}/rewards/catalog`);
  return data;
}

export async function redeemReward(itemId: string): Promise<RewardLedgerEntry> {
  // Child-safety: minor-without-consent cannot redeem (fail-closed).
  assertConsentForSpend();
  const item = M.MOCK_REWARD_CATALOG.find((i) => i.id === itemId);
  if (!item) throw new Error('Reward not found');
  if (USE_MOCK) {
    await delay(450);
    if (rewardBalance.points < item.pointsCost) throw new Error('Not enough points');
    const entry: RewardLedgerEntry = {
      id: `rl_${Date.now()}`, ts: new Date().toISOString(), kind: 'redeem',
      reason: `Redeemed ${item.name}`, points: -item.pointsCost, synced: false,
    };
    rewardBalance = { ...rewardBalance, points: rewardBalance.points - item.pointsCost };
    rewardHistory = [entry, ...rewardHistory];
    if (item.walletValueKobo) {
      wallet = { ...wallet, spendableKobo: wallet.spendableKobo + item.walletValueKobo };
    }
    track('reward_redeemed', { item: itemId, points: item.pointsCost });
    return entry;
  }
  const { data } = await api.post<RewardLedgerEntry>(`${B}/rewards/redeem`, { itemId });
  return data;
}

// ── Commerce ─────────────────────────────────────────────────────────────────
export async function getPlans(): Promise<Plan[]> {
  if (USE_MOCK) { await delay(); return M.MOCK_PLANS; }
  const { data } = await api.get<Plan[]>(`${B}/commerce/plans`);
  return data;
}

export async function getBundles(examSlug?: Bundle['examSlug']): Promise<Bundle[]> {
  if (USE_MOCK) {
    await delay();
    return examSlug ? M.MOCK_BUNDLES.filter((b) => b.examSlug === examSlug) : M.MOCK_BUNDLES;
  }
  const { data } = await api.get<Bundle[]>(`${B}/commerce/bundles`, { params: { exam: examSlug } });
  return data;
}

export async function getBundle(id: string): Promise<Bundle> {
  if (USE_MOCK) {
    await delay();
    const b = M.MOCK_BUNDLES.find((x) => x.id === id);
    if (!b) throw new Error('Bundle not found');
    return b;
  }
  const { data } = await api.get<Bundle>(`${B}/commerce/bundles/${id}`);
  return data;
}

export async function getBundleManifest(id: string): Promise<BundleManifestItem[]> {
  if (USE_MOCK) { await delay(); return M.MOCK_BUNDLE_MANIFEST[id] ?? []; }
  const { data } = await api.get<BundleManifestItem[]>(`${B}/commerce/bundles/${id}/manifest`);
  return data;
}

export interface CreateOrderInput { bundleId?: string; planId?: string; }

export async function createOrder(input: CreateOrderInput): Promise<Order> {
  assertConsentForSpend();
  if (USE_MOCK) {
    await delay(380);
    const bundle = input.bundleId ? M.MOCK_BUNDLES.find((b) => b.id === input.bundleId) : undefined;
    const plan = input.planId ? M.MOCK_PLANS.find((p) => p.id === input.planId) : undefined;
    const order: Order = {
      id: `ord_${Date.now()}`,
      bundleId: input.bundleId,
      planId: input.planId,
      amountKobo: bundle?.priceKobo ?? plan?.priceKobo ?? 0,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    track('checkout_started', { bundle: input.bundleId, plan: input.planId, amountKobo: order.amountKobo });
    return order;
  }
  const { data } = await api.post<Order>(`${B}/commerce/orders`, input);
  return data;
}

export async function payOrder(orderId: string, amountKobo: number, bundleId?: string): Promise<Order> {
  assertConsentForSpend();
  if (USE_MOCK) {
    await delay(550);
    if (wallet.spendableKobo < amountKobo) throw new Error('Insufficient wallet balance');
    wallet = {
      ...wallet,
      spendableKobo: wallet.spendableKobo - amountKobo,
      recent: [{ id: `w_${Date.now()}`, ts: new Date().toISOString(), label: 'Bundle purchase', amountKobo, kind: 'debit' }, ...wallet.recent],
    };
    track('bundle_purchased', { order: orderId, amountKobo, bundle: bundleId });
    return { id: orderId, bundleId, amountKobo, status: 'fulfilled', createdAt: new Date().toISOString() };
  }
  const { data } = await api.post<Order>(`${B}/commerce/orders/${orderId}/pay`, {});
  return data;
}

export async function bnplOrder(orderId: string, amountKobo: number, instalments: number, bundleId?: string): Promise<Order> {
  assertConsentForSpend();
  if (USE_MOCK) {
    await delay(550);
    track('bnpl_started', { order: orderId, amountKobo, instalments });
    return { id: orderId, bundleId, amountKobo, status: 'bnpl', createdAt: new Date().toISOString(), bnplInstalments: instalments };
  }
  const { data } = await api.post<Order>(`${B}/commerce/orders/${orderId}/bnpl`, { instalments });
  return data;
}

/** Agent-sold prepaid card → unlock bundle/plan/data (W7). */
export async function activateAccessCard(cardCode: string): Promise<AccessCardResult> {
  if (USE_MOCK) {
    await delay(600);
    const code = cardCode.trim().toUpperCase();
    if (code.length < 8) throw new Error('Invalid card code');
    const result: AccessCardResult = {
      cardCode: code,
      unlocked: [
        { kind: 'bundle', label: 'UTME Pro Pack' },
        { kind: 'data', label: '500MB study data' },
      ],
      valueKobo: 350000,
    };
    wallet = {
      ...wallet,
      recent: [{ id: `w_${Date.now()}`, ts: new Date().toISOString(), label: `Access card ${code}`, amountKobo: result.valueKobo, kind: 'credit' }, ...wallet.recent],
    };
    track('bundle_purchased', { via: 'access_card', amountKobo: result.valueKobo });
    return result;
  }
  const { data } = await api.post<AccessCardResult>(`${B}/commerce/access-cards/activate`, { cardCode });
  return data;
}

// ── Wallet ───────────────────────────────────────────────────────────────────
export async function getWallet(): Promise<AcademyWallet> {
  if (USE_MOCK) { await delay(); return wallet; }
  const { data } = await api.get<AcademyWallet>(`${B}/wallet`);
  return data;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2 — Progression
// ═══════════════════════════════════════════════════════════════════════════════
export async function getPath(subjectId: string): Promise<LearningPath> {
  if (USE_MOCK) {
    await delay();
    const p = P2.MOCK_PATHS[subjectId];
    if (!p) throw new Error('No path for this subject yet');
    return p;
  }
  const { data } = await api.get<LearningPath>(`${B}/progression/paths/${subjectId}`);
  return data;
}

/** Generate/refresh a path for a subject (idempotent in mock — returns the fixture). */
export async function createPath(subjectId: string): Promise<LearningPath> {
  if (USE_MOCK) {
    await delay(420);
    const p = P2.MOCK_PATHS[subjectId];
    if (!p) {
      // Synthesise a minimal path from the subject's objectives.
      const subj = M.MOCK_SUBJECTS.find((s) => s.id === subjectId);
      return {
        id: `path_${subjectId}`, subjectId, subjectName: subj?.name ?? 'Subject', progressPct: 0,
        generatedAt: new Date().toISOString(), steps: [],
      };
    }
    return { ...p, generatedAt: new Date().toISOString() };
  }
  const { data } = await api.post<LearningPath>(`${B}/progression/paths`, { subjectId });
  return data;
}

/** Advance a path step (e.g. after completing the linked lesson/practice). */
export async function advanceStep(objectiveId: string): Promise<LearningPath> {
  if (USE_MOCK) {
    await delay(380);
    // Find which path holds this objective and bump its status locally.
    const entry = Object.values(P2.MOCK_PATHS).find((p) => p.steps.some((s) => s.objectiveId === objectiveId));
    if (!entry) throw new Error('Objective not on any path');
    const next: LearningPath = {
      ...entry,
      steps: entry.steps.map((s, i, arr) => {
        if (s.objectiveId === objectiveId) return { ...s, status: 'mastered', masteryPct: 100 };
        // Unlock the immediately following locked step.
        const prev = arr[i - 1];
        if (prev?.objectiveId === objectiveId && s.status === 'locked') return { ...s, status: 'available' };
        return s;
      }),
    };
    next.progressPct = Math.round((next.steps.filter((s) => s.status === 'mastered').length / (next.steps.length || 1)) * 100);
    P2.MOCK_PATHS[entry.subjectId] = next;
    track('mastery_gained', { objective: objectiveId, via: 'progression' });
    return next;
  }
  const { data } = await api.post<LearningPath>(`${B}/progression/steps/${objectiveId}/advance`, {});
  return data;
}

/**
 * L11 — Adaptive practice. Builds a personalised set targeting the learner's
 * weakest objectives. In mock, weak = mastery < 60%; questions are drawn from the
 * Phase-1 bank for those objectives.
 */
export async function getAdaptiveSet(subjectId?: string): Promise<AdaptiveSet> {
  if (USE_MOCK) {
    await delay(450);
    const weak = M.MOCK_OBJECTIVES
      .filter((o) => o.masteryPct < 60)
      .filter((o) => {
        if (!subjectId) return true;
        const t = M.MOCK_TOPICS.find((x) => x.id === o.topicId);
        return t?.subjectId === subjectId;
      });
    const targetIds = weak.map((o) => o.id);
    const questions = M.MOCK_QUESTIONS.filter((q) => q.objectiveId && targetIds.includes(q.objectiveId));
    const set: AdaptiveSet = {
      id: `adp_${Date.now()}`,
      targetObjectiveIds: targetIds,
      reason: weak.length
        ? `${weak.length} objective${weak.length > 1 ? 's' : ''} below 60% mastery`
        : 'Mixed review across your subjects',
      questions: questions.length ? questions : M.MOCK_QUESTIONS.slice(0, 4),
    };
    track('practice_completed', { kind: 'adaptive_generated', targets: targetIds.length });
    return set;
  }
  const { data } = await api.post<AdaptiveSet>(`${B}/progression/practice/adaptive`, { subjectId });
  return data;
}

export async function getRecommendations(): Promise<Recommendation[]> {
  if (USE_MOCK) { await delay(); return P2.MOCK_RECOMMENDATIONS; }
  const { data } = await api.get<Recommendation[]>(`${B}/progression/recommendations`);
  return data;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2 — Parent / Guardian (child-safety: linked-child gating, fail-closed)
// ═══════════════════════════════════════════════════════════════════════════════
export async function getChildren(): Promise<ChildSummary[]> {
  if (USE_MOCK) { await delay(); return children; }
  const { data } = await api.get<ChildSummary[]>(`${B}/parent/children`);
  return data;
}

export async function getChildDashboard(minorId: string): Promise<ChildDashboard> {
  if (USE_MOCK) {
    await delay();
    assertLinkedChild(minorId);
    const d = P2.MOCK_CHILD_DASHBOARDS[minorId];
    if (!d) throw new Error('No dashboard for this child yet');
    return d;
  }
  const { data } = await api.get<ChildDashboard>(`${B}/parent/children/${minorId}/dashboard`);
  return data;
}

export async function getChildSubject(minorId: string, subjectId: string): Promise<ChildSubjectDetail> {
  if (USE_MOCK) {
    await delay();
    assertLinkedChild(minorId);
    const detail = P2.MOCK_CHILD_SUBJECT_DETAIL[`${minorId}:${subjectId}`];
    if (detail) return detail;
    // Synthesise a light detail if no dedicated fixture.
    const subj = M.MOCK_SUBJECTS.find((s) => s.id === subjectId);
    return {
      minorId, subjectId, subjectName: subj?.name ?? 'Subject', progressPct: subj?.progressPct ?? 0,
      topics: M.MOCK_TOPICS.filter((t) => t.subjectId === subjectId).map((t) => ({ topicId: t.id, name: t.name, mastery: t.mastery, masteryPct: t.mastery === 'mastered' ? 95 : t.mastery === 'proficient' ? 75 : t.mastery === 'learning' ? 45 : 0 })),
      recent: [],
    };
  }
  const { data } = await api.get<ChildSubjectDetail>(`${B}/parent/children/${minorId}/subjects/${subjectId}`);
  return data;
}

export async function getControls(minorId: string): Promise<UsageControls> {
  if (USE_MOCK) {
    await delay();
    assertLinkedChild(minorId);
    return controls.get(minorId) ?? P2.MOCK_CONTROLS.usr_self;
  }
  const { data } = await api.get<UsageControls>(`${B}/parent/children/${minorId}/controls`);
  return data;
}

export async function updateControls(minorId: string, input: Partial<UsageControls>): Promise<UsageControls> {
  if (USE_MOCK) {
    await delay(380);
    assertLinkedChild(minorId);
    const next = { ...(controls.get(minorId) ?? P2.MOCK_CONTROLS.usr_self), ...input };
    controls.set(minorId, next);
    return next;
  }
  const { data } = await api.put<UsageControls>(`${B}/parent/children/${minorId}/controls`, input);
  return data;
}

export async function getReports(minorId?: string): Promise<ProgressReport[]> {
  if (USE_MOCK) {
    await delay();
    return minorId ? reports.filter((r) => r.minorId === minorId) : reports;
  }
  const { data } = await api.get<ProgressReport[]>(`${B}/parent/children/${minorId}/reports`);
  return data;
}

export async function generateReport(minorId: string, period: 'weekly' | 'termly'): Promise<ProgressReport> {
  if (USE_MOCK) {
    await delay(520);
    assertLinkedChild(minorId);
    const child = children.find((c) => c.minorId === minorId);
    const rep: ProgressReport = {
      id: `rep_${Date.now()}`, minorId, childName: child?.displayName ?? 'Child', period,
      periodLabel: period === 'weekly' ? 'This week' : 'Current term', generatedAt: new Date().toISOString(),
      minutesStudied: period === 'weekly' ? 280 : 1840, lessonsCompleted: period === 'weekly' ? 9 : 62,
      masteryGained: period === 'weekly' ? 3 : 14, readinessPct: child?.readinessPct ?? 0,
      highlights: ['Generated on demand', 'Engagement steady', 'Keep the streak going'],
      shareUrl: `mock://reports/rep_${Date.now()}.pdf`,
    };
    reports = [rep, ...reports];
    return rep;
  }
  const { data } = await api.post<ProgressReport>(`${B}/parent/reports/generate`, { minorId, period });
  return data;
}

export async function getApprovals(): Promise<PurchaseApproval[]> {
  if (USE_MOCK) { await delay(); return approvals; }
  const { data } = await api.get<PurchaseApproval[]>(`${B}/parent/approvals`);
  return data;
}

export async function decideApproval(id: string, approve: boolean): Promise<PurchaseApproval> {
  if (USE_MOCK) {
    await delay(380);
    const idx = approvals.findIndex((a) => a.id === id);
    if (idx < 0) throw new Error('Approval not found');
    const updated: PurchaseApproval = { ...approvals[idx], status: approve ? 'approved' : 'rejected' };
    approvals = approvals.map((a) => (a.id === id ? updated : a));
    track(approve ? 'bundle_purchased' : 'checkout_started', { via: 'parent_approval', approved: approve, approval: id });
    return updated;
  }
  const { data } = await api.post<PurchaseApproval>(`${B}/parent/approvals/${id}/decide`, { approve });
  return data;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2 — EduPay (school fees + save-for-school pots). Money in kobo.
// ═══════════════════════════════════════════════════════════════════════════════
export async function getSchools(query?: string): Promise<School[]> {
  if (USE_MOCK) {
    await delay();
    const q = query?.trim().toLowerCase();
    return q ? schools.filter((s) => s.name.toLowerCase().includes(q) || s.state.toLowerCase().includes(q)) : schools;
  }
  const { data } = await api.get<School[]>(`${B}/edupay/schools`, { params: { q: query } });
  return data;
}

export async function getFeeSchedules(): Promise<FeeSchedule[]> {
  if (USE_MOCK) { await delay(); return feeSchedules; }
  const { data } = await api.get<FeeSchedule[]>(`${B}/edupay/fee-schedules`);
  return data;
}

export async function linkSchool(schoolId: string, feeScheduleId?: string): Promise<EduPayProfile> {
  if (USE_MOCK) {
    await delay(420);
    schools = schools.map((s) => (s.id === schoolId ? { ...s, linked: true } : s));
    if (feeScheduleId) feeSchedules = feeSchedules.map((f) => (f.id === feeScheduleId ? { ...f, linked: true } : f));
    edupay = {
      ...edupay,
      linkedSchoolIds: [...new Set([...edupay.linkedSchoolIds, schoolId])],
      linkedFeeScheduleIds: feeScheduleId ? [...new Set([...edupay.linkedFeeScheduleIds, feeScheduleId])] : edupay.linkedFeeScheduleIds,
    };
    return edupay;
  }
  const { data } = await api.post<EduPayProfile>(`${B}/edupay/link`, { schoolId, feeScheduleId });
  return data;
}

export async function getEduPayProfile(): Promise<EduPayProfile> {
  if (USE_MOCK) { await delay(); return edupay; }
  const { data } = await api.get<EduPayProfile>(`${B}/edupay/me`);
  return data;
}

/**
 * P9 — Pay school fees from the wallet (full or BNPL). Money debits the academy
 * wallet (kobo); server is authoritative in the live impl. Mirrors the Phase-1
 * checkout rail (createOrder→payOrder) on the EduPay path.
 */
export async function payFees(feeScheduleId: string, amountKobo: number, method: 'wallet' | 'bnpl', instalments?: number): Promise<EduPayPayment> {
  if (USE_MOCK) {
    await delay(600);
    const fee = feeSchedules.find((f) => f.id === feeScheduleId);
    if (!fee) throw new Error('Fee schedule not found');
    if (method === 'wallet') {
      if (wallet.spendableKobo < amountKobo) throw new Error('Insufficient wallet balance');
      wallet = {
        ...wallet,
        spendableKobo: wallet.spendableKobo - amountKobo,
        recent: [{ id: `w_${Date.now()}`, ts: new Date().toISOString(), label: `School fees · ${fee.schoolName}`, amountKobo, kind: 'debit' }, ...wallet.recent],
      };
    }
    const payment: EduPayPayment = {
      id: `pay_${Date.now()}`, feeScheduleId, schoolName: fee.schoolName, term: fee.term, amountKobo,
      status: method === 'bnpl' ? 'bnpl' : 'paid', method, bnplInstalments: method === 'bnpl' ? (instalments ?? 3) : undefined,
      paidAt: new Date().toISOString(), receiptUrl: `mock://receipts/pay_${Date.now()}.pdf`,
    };
    edupay = { ...edupay, payments: [payment, ...edupay.payments] };
    track('edupay_paid', { feeSchedule: feeScheduleId, amountKobo, method, instalments });
    return payment;
  }
  const { data } = await api.post<EduPayPayment>(`${B}/edupay/pay`, { feeScheduleId, amountKobo, method, instalments });
  return data;
}

export async function getPots(): Promise<SavingsPot[]> {
  if (USE_MOCK) { await delay(); return pots; }
  const { data } = await api.get<SavingsPot[]>(`${B}/edupay/pots`);
  return data;
}

export interface CreatePotInput { name: string; targetKobo: number; feeScheduleId?: string; cadence: SavingsPot['cadence']; }

export async function createPot(input: CreatePotInput): Promise<SavingsPot> {
  if (USE_MOCK) {
    await delay(420);
    const fee = input.feeScheduleId ? feeSchedules.find((f) => f.id === input.feeScheduleId) : undefined;
    const pot: SavingsPot = {
      id: `pot_${Date.now()}`, name: input.name, targetKobo: input.targetKobo, savedKobo: 0,
      feeScheduleId: input.feeScheduleId, schoolName: fee?.schoolName, createdAt: new Date().toISOString(), cadence: input.cadence,
    };
    pots = [pot, ...pots];
    track('edupay_paid', { kind: 'pot_created', pot: pot.id });
    return pot;
  }
  const { data } = await api.post<SavingsPot>(`${B}/edupay/pots`, input);
  return data;
}

/** Fund a pot from the wallet (kobo). */
export async function fundPot(potId: string, amountKobo: number): Promise<SavingsPot> {
  if (USE_MOCK) {
    await delay(520);
    const pot = pots.find((p) => p.id === potId);
    if (!pot) throw new Error('Pot not found');
    if (wallet.spendableKobo < amountKobo) throw new Error('Insufficient wallet balance');
    wallet = {
      ...wallet,
      spendableKobo: wallet.spendableKobo - amountKobo,
      recent: [{ id: `w_${Date.now()}`, ts: new Date().toISOString(), label: `Saved to ${pot.name}`, amountKobo, kind: 'debit' }, ...wallet.recent],
    };
    const updated: SavingsPot = { ...pot, savedKobo: Math.min(pot.targetKobo, pot.savedKobo + amountKobo) };
    pots = pots.map((p) => (p.id === potId ? updated : p));
    track('edupay_paid', { kind: 'pot_funded', pot: potId, amountKobo });
    return updated;
  }
  const { data } = await api.post<SavingsPot>(`${B}/edupay/pots/${potId}/fund`, { amountKobo });
  return data;
}

/** Pay a fee schedule directly out of a savings pot (P10). */
export async function payFromPot(potId: string, feeScheduleId: string): Promise<EduPayPayment> {
  if (USE_MOCK) {
    await delay(600);
    const pot = pots.find((p) => p.id === potId);
    const fee = feeSchedules.find((f) => f.id === feeScheduleId);
    if (!pot) throw new Error('Pot not found');
    if (!fee) throw new Error('Fee schedule not found');
    if (pot.savedKobo < fee.totalKobo) throw new Error('Pot has not reached the fee total yet');
    pots = pots.map((p) => (p.id === potId ? { ...p, savedKobo: p.savedKobo - fee.totalKobo } : p));
    const payment: EduPayPayment = {
      id: `pay_${Date.now()}`, feeScheduleId, schoolName: fee.schoolName, term: fee.term, amountKobo: fee.totalKobo,
      status: 'paid', method: 'wallet', paidAt: new Date().toISOString(), receiptUrl: `mock://receipts/pay_${Date.now()}.pdf`,
    };
    edupay = { ...edupay, payments: [payment, ...edupay.payments] };
    track('edupay_paid', { kind: 'pot_payout', pot: potId, feeSchedule: feeScheduleId, amountKobo: fee.totalKobo });
    return payment;
  }
  const { data } = await api.post<EduPayPayment>(`${B}/edupay/pots/${potId}/pay`, { feeScheduleId });
  return data;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2 — Scholarships, billing, parent notifications
// ═══════════════════════════════════════════════════════════════════════════════
export async function getScholarships(): Promise<Scholarship[]> {
  if (USE_MOCK) { await delay(); return scholarships; }
  const { data } = await api.get<Scholarship[]>(`${B}/edupay/scholarships`);
  return data;
}

export async function applyScholarship(id: string): Promise<Scholarship> {
  if (USE_MOCK) {
    await delay(420);
    const updated = scholarships.find((s) => s.id === id);
    if (!updated) throw new Error('Scholarship not found');
    const next = { ...updated, applied: true };
    scholarships = scholarships.map((s) => (s.id === id ? next : s));
    track('opportunity_applied', { scholarship: id });
    return next;
  }
  const { data } = await api.post<Scholarship>(`${B}/edupay/scholarships/${id}/apply`, {});
  return data;
}

export async function getSubscriptions(): Promise<Subscription[]> {
  if (USE_MOCK) { await delay(); return P2.MOCK_SUBSCRIPTIONS; }
  const { data } = await api.get<Subscription[]>(`${B}/parent/billing/subscriptions`);
  return data;
}

export async function getInvoices(): Promise<Invoice[]> {
  if (USE_MOCK) { await delay(); return P2.MOCK_INVOICES; }
  const { data } = await api.get<Invoice[]>(`${B}/parent/billing/invoices`);
  return data;
}

export async function getParentNotifications(): Promise<P2.ParentNotification[]> {
  if (USE_MOCK) { await delay(); return P2.MOCK_PARENT_NOTIFICATIONS; }
  const { data } = await api.get<P2.ParentNotification[]>(`${B}/parent/notifications`);
  return data;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2 — Learner: daily goal, search, bookmarks, notes, downloads
// ═══════════════════════════════════════════════════════════════════════════════
export async function getDailyGoal(): Promise<DailyGoal> {
  if (USE_MOCK) { await delay(); return P2.MOCK_DAILY_GOAL; }
  const { data } = await api.get<DailyGoal>(`${B}/learner/daily-goal`);
  return data;
}

export async function searchAcademy(query: string): Promise<SearchResult[]> {
  if (USE_MOCK) {
    await delay(200);
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return P2.MOCK_SEARCH_INDEX.filter((r) => r.title.toLowerCase().includes(q) || r.subtitle.toLowerCase().includes(q));
  }
  const { data } = await api.get<SearchResult[]>(`${B}/learner/search`, { params: { q: query } });
  return data;
}

export async function getBookmarks(): Promise<Bookmark[]> {
  if (USE_MOCK) { await delay(); return bookmarks; }
  const { data } = await api.get<Bookmark[]>(`${B}/learner/bookmarks`);
  return data;
}

export async function removeBookmark(id: string): Promise<void> {
  if (USE_MOCK) { await delay(200); bookmarks = bookmarks.filter((b) => b.id !== id); return; }
  await api.delete(`${B}/learner/bookmarks/${id}`);
}

/**
 * Create a bookmark (was missing — learners could only view/remove seeded ones).
 * Deduped by canonical href so re-bookmarking the same lesson can't duplicate.
 */
export async function addBookmark(input: Omit<Bookmark, 'id' | 'ts'>): Promise<Bookmark> {
  const bm: Bookmark = { ...input, id: `bm_${Date.now()}`, ts: new Date().toISOString() };
  if (USE_MOCK) { await delay(200); bookmarks = upsertBookmark(bookmarks, bm); return bm; }
  const { data } = await api.post<Bookmark>(`${B}/learner/bookmarks`, input);
  return data;
}

export async function getNotes(): Promise<LessonNote[]> {
  if (USE_MOCK) { await delay(); return notes; }
  const { data } = await api.get<LessonNote[]>(`${B}/learner/notes`);
  return data;
}

export async function saveNote(lessonId: string, lessonTitle: string, subjectName: string, body: string): Promise<LessonNote> {
  if (USE_MOCK) {
    await delay(300);
    const note: LessonNote = { id: `nt_${Date.now()}`, lessonId, lessonTitle, subjectName, body, ts: new Date().toISOString() };
    notes = [note, ...notes];
    enqueue({ type: 'progress', payload: { kind: 'note', lessonId } });
    return note;
  }
  // Send the title + subject too so the persisted note round-trips them (the
  // backend stores what it's given; it can't resolve them from lessonId alone).
  const { data } = await api.post<LessonNote>(`${B}/learner/notes`, { lessonId, lessonTitle, subjectName, body });
  return data;
}

export async function deleteNote(id: string): Promise<void> {
  if (USE_MOCK) { await delay(200); notes = notes.filter((n) => n.id !== id); return; }
  await api.delete(`${B}/learner/notes/${id}`);
}

export async function getDownloads(): Promise<DownloadedBundle[]> {
  if (USE_MOCK) { await delay(); return downloads; }
  const { data } = await api.get<DownloadedBundle[]>(`${B}/learner/downloads`);
  return data;
}

export async function getStorageInfo(): Promise<StorageInfo> {
  if (USE_MOCK) {
    await delay();
    const usedMb = downloads.filter((d) => d.status === 'downloaded').reduce((sum, d) => sum + d.sizeMb, 0);
    const bundleCount = downloads.filter((d) => d.status === 'downloaded').length;
    return { usedMb, budgetMb: P2.MOCK_STORAGE.budgetMb, bundleCount };
  }
  const { data } = await api.get<StorageInfo>(`${B}/learner/storage`);
  return data;
}

/** Toggle a bundle's offline download (mock simulates instant complete). */
export async function setDownload(bundleId: string, download: boolean): Promise<DownloadedBundle[]> {
  if (USE_MOCK) {
    await delay(450);
    downloads = downloads.map((d) =>
      d.id === bundleId
        ? { ...d, status: download ? 'downloaded' : 'not_downloaded', progressPct: download ? 100 : 0, syncState: 'synced', downloadedAt: download ? new Date().toISOString() : undefined }
        : d,
    );
    return downloads;
  }
  const { data } = await api.post<DownloadedBundle[]>(`${B}/learner/downloads/${bundleId}`, { download });
  return data;
}

/** Sync an out-of-date downloaded bundle (L17 sync status). */
export async function syncDownload(bundleId: string): Promise<DownloadedBundle[]> {
  if (USE_MOCK) {
    await delay(500);
    downloads = downloads.map((d) => (d.id === bundleId ? { ...d, syncState: 'synced', downloadedAt: new Date().toISOString() } : d));
    return downloads;
  }
  const { data } = await api.post<DownloadedBundle[]>(`${B}/learner/downloads/${bundleId}/sync`, {});
  return data;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 3 — Trade & Skills (the Moat)
// ═══════════════════════════════════════════════════════════════════════════════

/** S1 — Trade track hub: the chosen track + its modules + project portfolio. */
export async function getTradeHub(): Promise<TradeHub> {
  if (USE_MOCK) {
    await delay();
    const track = tradeTracks.find((t) => t.chosen) ?? tradeTracks[0];
    const modules = (tradeModules.get(track.id) ?? []).slice().sort((a, b) => a.order - b.order);
    const projects = modules
      .map((m) => (m.projectId ? tradeProjects.get(m.projectId) : undefined))
      .filter((p): p is TradeProject => !!p);
    const credentialEarned = credentials.some((c) => c.kind === 'trade' && c.trackSlug === track.slug);
    return { track, modules, projects, credentialEarned };
  }
  const { data } = await api.get<TradeHub>(`${B}/trade/hub`);
  return data;
}

/** List all trade tracks (for choosing a trade, A11/S1). */
export async function getTradeTracks(): Promise<TradeTrack[]> {
  if (USE_MOCK) { await delay(); return tradeTracks; }
  const { data } = await api.get<TradeTrack[]>(`${B}/trade/tracks`);
  return data;
}

/** S2 — Trade module/lesson detail (practical/project-based). */
export async function getTradeModule(id: string): Promise<TradeModule> {
  if (USE_MOCK) {
    await delay();
    for (const list of tradeModules.values()) {
      const m = list.find((x) => x.id === id);
      if (m) return m;
    }
    throw new Error('Trade module not found');
  }
  const { data } = await api.get<TradeModule>(`${B}/trade/modules/${id}`);
  return data;
}

export async function getTradeProject(id: string): Promise<TradeProject> {
  if (USE_MOCK) {
    await delay();
    const p = tradeProjects.get(id);
    if (!p) throw new Error('Project not found');
    return p;
  }
  const { data } = await api.get<TradeProject>(`${B}/trade/projects/${id}`);
  return data;
}

export interface SubmitProjectInput {
  attachments: { id: string; name: string; kind: 'photo' | 'video' | 'doc' }[];
}

/**
 * S3 — Submit a project for rubric grading. Server-authoritative in live impl;
 * the mock simulates an immediate graded result against the rubric.
 */
export async function submitProject(projectId: string, input: SubmitProjectInput): Promise<TradeProject> {
  if (USE_MOCK) {
    await delay(550);
    const project = tradeProjects.get(projectId);
    if (!project) throw new Error('Project not found');
    if (!input.attachments.length) throw new Error('Attach at least one photo or video of your work.');
    // Simulate the rubric grade (server-authoritative on the real path).
    const gradedRubric: RubricCriterion[] = project.rubric.map((r) => ({
      ...r, awardedPoints: Math.round(r.maxPoints * 0.85), note: 'Meets the standard.',
    }));
    const totalMax = gradedRubric.reduce((s, r) => s + r.maxPoints, 0) || 1;
    const totalAwarded = gradedRubric.reduce((s, r) => s + (r.awardedPoints ?? 0), 0);
    const scorePct = Math.round((totalAwarded / totalMax) * 100);
    const updated: TradeProject = {
      ...project,
      status: 'graded',
      attachments: input.attachments,
      submittedAt: new Date().toISOString(),
      rubric: gradedRubric,
      scorePct,
      feedback: 'Solid submission. Tidy up cable runs next time for full marks.',
    };
    tradeProjects.set(projectId, updated);
    // Idempotent per project: resubmitting a revision must not re-award.
    creditPointsLocal(120, 'Trade project submitted', `trade:${projectId}`);
    track('practice_completed', { kind: 'trade_project', project: projectId, score: scorePct });
    return updated;
  }
  const { data } = await api.post<TradeProject>(`${B}/trade/projects/${projectId}/submit`, input);
  return data;
}

export async function getAssessment(id: string): Promise<SkillAssessment> {
  if (USE_MOCK) {
    await delay();
    const a = assessments3.get(id);
    if (!a) throw new Error('Assessment not found');
    return a;
  }
  const { data } = await api.get<SkillAssessment>(`${B}/trade/assessments/${id}`);
  return data;
}

export interface TakeAssessmentInput {
  answers: { questionId: string; selected: string[] }[];
}

/**
 * S4 — Take a practical skill assessment. On pass, a verifiable trade credential
 * is minted (S5) and the matching Paymax earning roles flip to eligible (S6).
 * Server-authoritative on the live path; the mock simulates scoring + issuance.
 */
export async function takeAssessment(assessmentId: string, input: TakeAssessmentInput): Promise<AssessmentResult> {
  if (USE_MOCK) {
    await delay(600);
    const asm = assessments3.get(assessmentId);
    if (!asm) throw new Error('Assessment not found');
    let correct = 0;
    asm.questions.forEach((q) => {
      const sel = input.answers.find((a) => a.questionId === q.id)?.selected ?? [];
      if (sel.length && setsEqual(sel, q.correct)) correct++;
    });
    const total = asm.questions.length || 1;
    const scorePct = Math.round((correct / total) * 100);
    const passed = scorePct >= asm.passMark;
    let credentialId: string | undefined;
    if (passed) {
      assessments3.set(assessmentId, { ...asm, passed: true });
      const trackObj = tradeTracks.find((t) => t.id === asm.trackId);
      const cred = issueCredentialLocal(trackObj?.slug, asm.trackId, scorePct);
      credentialId = cred.id;
      // Earning bridge: flip opportunities that require this trade to eligible.
      if (trackObj) {
        opportunities = opportunities.map((o) =>
          o.requiredCredentialKinds.includes(trackObj.slug) && o.eligibility === 'needs_credential'
            ? { ...o, eligibility: 'eligible' }
            : o,
        );
      }
    }
    creditPointsLocal(passed ? 200 : 40, passed ? 'Skill assessment passed' : 'Skill assessment attempt');
    track('practice_completed', { kind: 'skill_assessment', assessment: assessmentId, score: scorePct, passed });
    return { assessmentId, scorePct, passed, passMark: asm.passMark, credentialId, pointsEarned: passed ? 200 : 40 };
  }
  const { data } = await api.post<AssessmentResult>(`${B}/trade/assessments/${assessmentId}/take`, input);
  return data;
}

/** S8 — Mentor connect (group/cohort matching; no 1:1 DMs for minors). */
export async function getMentors(trade?: string): Promise<Mentor[]> {
  if (USE_MOCK) {
    await delay();
    return trade ? mentors.filter((m) => m.trade === trade) : mentors;
  }
  const { data } = await api.get<Mentor[]>(`${B}/trade/mentors`, { params: { trade } });
  return data;
}

export async function requestMentor(mentorId: string): Promise<Mentor> {
  if (USE_MOCK) {
    await delay(420);
    const m = mentors.find((x) => x.id === mentorId);
    if (!m) throw new Error('Mentor not found');
    // Child-safety: mentorship is group/cohort only — surface that in the state.
    const updated: Mentor = { ...m, requestState: 'requested', groupOnly: true };
    mentors = mentors.map((x) => (x.id === mentorId ? updated : x));
    track('opportunity_viewed', { kind: 'mentor_request', mentor: mentorId });
    return updated;
  }
  const { data } = await api.post<Mentor>(`${B}/trade/mentors/${mentorId}/request`, {});
  return data;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 3 — Credentials & earning bridge (G10/G11 + S6/S7)
// ═══════════════════════════════════════════════════════════════════════════════

/** G10 — My credentials (academic + trade). */
export async function getCredentials(): Promise<Credential[]> {
  if (USE_MOCK) { await delay(); return credentials; }
  const { data } = await api.get<Credential[]>(`${B}/credentials`);
  return data;
}

export async function getCredential(id: string): Promise<Credential> {
  if (USE_MOCK) {
    await delay();
    const c = credentials.find((x) => x.id === id);
    if (!c) throw new Error('Credential not found');
    return c;
  }
  const { data } = await api.get<Credential>(`${B}/credentials/${id}`);
  return data;
}

/**
 * G11 — Public verification by verificationId. This is what a QR scan resolves
 * to: a tamper-evident "valid/invalid + issuer + name + date" payload, no PII
 * beyond the displayed recipient name. Server-authoritative on the live path.
 */
export async function verifyCredential(verificationId: string): Promise<CredentialVerification> {
  if (USE_MOCK) {
    await delay(380);
    const c = credentials.find((x) => x.verificationId === verificationId);
    if (!c) {
      return {
        verificationId, valid: false, title: '—', issuer: '—', recipientName: '—',
        issuedAt: '', kind: 'trade', verifiedAt: new Date().toISOString(),
      };
    }
    return {
      verificationId, valid: true, title: c.title, issuer: c.issuer, recipientName: c.recipientName,
      issuedAt: c.issuedAt, kind: c.kind, scorePct: c.scorePct, verifiedAt: new Date().toISOString(),
    };
  }
  const { data } = await api.get<CredentialVerification>(`${B}/credentials/verify/${verificationId}`);
  return data;
}

/** S6 — Earning opportunities feed (Paymax roles unlocked by credentials). */
export async function getOpportunities(): Promise<EarningOpportunity[]> {
  if (USE_MOCK) { await delay(); return opportunities; }
  const { data } = await api.get<EarningOpportunity[]>(`${B}/earning/opportunities`);
  return data;
}

export async function getOpportunity(id: string): Promise<EarningOpportunity> {
  if (USE_MOCK) {
    await delay();
    const o = opportunities.find((x) => x.id === id);
    if (!o) throw new Error('Opportunity not found');
    track('opportunity_viewed', { opportunity: id, role: o.role });
    return o;
  }
  const { data } = await api.get<EarningOpportunity>(`${B}/earning/opportunities/${id}`);
  return data;
}

/**
 * S7 — Apply to an earning opportunity. This does NOT rebuild onboarding: it is a
 * bridge that hands off into the EXISTING Paymax role-upgrade / KYC flow via a
 * deep link. The mock returns the handoff payload the screen uses to route out.
 */
export async function applyOpportunity(opportunityId: string): Promise<EarningApplication> {
  if (USE_MOCK) {
    await delay(500);
    const opp = opportunities.find((o) => o.id === opportunityId);
    if (!opp) throw new Error('Opportunity not found');
    opportunities = opportunities.map((o) => (o.id === opportunityId ? { ...o, applied: true } : o));
    const needsKyc = opp.eligibility === 'needs_kyc';
    const application: EarningApplication = {
      id: `eapp_${Date.now()}`,
      opportunityId,
      role: opp.role,
      status: 'handoff',
      // Deep-link concept into the existing Paymax onboarding (not rebuilt here).
      onboardingDeepLink: `paymax://onboarding/role-upgrade?role=${opp.role}&source=academy&opportunity=${opportunityId}`,
      nextStep: needsKyc
        ? 'Continue in Paymax to complete KYC and activate this role.'
        : 'Continue in Paymax to confirm and activate this role.',
    };
    track('opportunity_applied', { opportunity: opportunityId, role: opp.role });
    return application;
  }
  const { data } = await api.post<EarningApplication>(`${B}/earning/apply`, { opportunityId });
  return data;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 3 — Live, Community & Notifications (C1–C7)
// Child-safety: community is group/Q&A only — no 1:1 DMs for minors.
// ═══════════════════════════════════════════════════════════════════════════════

/** C1 — Live classes schedule (upcoming/live/replay). */
export async function getLiveSessions(): Promise<LiveSession[]> {
  if (USE_MOCK) { await delay(); return liveSessions; }
  const { data } = await api.get<LiveSession[]>(`${B}/live/sessions`);
  return data;
}

export async function getLiveSession(id: string): Promise<LiveSession> {
  if (USE_MOCK) {
    await delay();
    const s = liveSessions.find((x) => x.id === id);
    if (!s) throw new Error('Session not found');
    return s;
  }
  const { data } = await api.get<LiveSession>(`${B}/live/sessions/${id}`);
  return data;
}

/**
 * C2 — Join a live class. Returns a LiveKit room token (placeholder in mock).
 * Rooms are moderated: chat is filtered and minors cannot DM — raise-hand only.
 */
export async function joinLiveSession(id: string): Promise<LiveJoinToken> {
  if (USE_MOCK) {
    await delay(450);
    const s = liveSessions.find((x) => x.id === id);
    if (!s) throw new Error('Session not found');
    if (s.status === 'upcoming') throw new Error('This class has not started yet.');
    track('lesson_started', { kind: 'live_join', session: id });
    return {
      sessionId: id,
      roomName: `academy-${id}`,
      token: `mock-livekit-token-${id}-${Date.now()}`,
      canPublish: false,        // learners watch + raise hand; host publishes.
      moderated: true,
    };
  }
  const { data } = await api.post<LiveJoinToken>(`${B}/live/sessions/${id}/join`, {});
  return data;
}

/** C4 — Study groups / cohorts. */
export async function getGroups(): Promise<StudyGroup[]> {
  if (USE_MOCK) { await delay(); return studyGroups; }
  const { data } = await api.get<StudyGroup[]>(`${B}/community/groups`);
  return data;
}

export interface CreateGroupInput { name: string; subjectOrTrade: string; goal: string; }

export async function createGroup(input: CreateGroupInput): Promise<StudyGroup> {
  if (USE_MOCK) {
    await delay(420);
    const group: StudyGroup = {
      id: `grp_${Date.now()}`, name: input.name, subjectOrTrade: input.subjectOrTrade,
      members: 1, goal: input.goal, goalProgressPct: 0, joined: true, cohort: true,
    };
    studyGroups = [group, ...studyGroups];
    return group;
  }
  const { data } = await api.post<StudyGroup>(`${B}/community/groups`, input);
  return data;
}

export async function joinGroup(id: string): Promise<StudyGroup> {
  if (USE_MOCK) {
    await delay(380);
    const g = studyGroups.find((x) => x.id === id);
    if (!g) throw new Error('Group not found');
    const updated: StudyGroup = { ...g, joined: !g.joined, members: g.joined ? g.members - 1 : g.members + 1 };
    studyGroups = studyGroups.map((x) => (x.id === id ? updated : x));
    return updated;
  }
  const { data } = await api.post<StudyGroup>(`${B}/community/groups/${id}/join`, {});
  return data;
}

/** C5 — Discussion / Q&A (moderated). */
export async function getDiscussions(scope?: string): Promise<Discussion[]> {
  if (USE_MOCK) {
    await delay();
    return scope ? discussions.filter((d) => d.scope === scope) : discussions;
  }
  const { data } = await api.get<Discussion[]>(`${B}/community/discussions`, { params: { scope } });
  return data;
}

export interface CreateDiscussionInput { scope: string; title: string; body: string; }

export async function createDiscussion(input: CreateDiscussionInput): Promise<Discussion> {
  if (USE_MOCK) {
    await delay(420);
    const d: Discussion = {
      id: `dsc_${Date.now()}`, scope: input.scope, authorName: profile.displayName, authorRole: 'peer',
      title: input.title, body: input.body, ts: new Date().toISOString(), replyCount: 0,
      moderation: 'pending_review',     // new posts pass moderation before going public.
      reported: false,
    };
    discussions = [d, ...discussions];
    return d;
  }
  const { data } = await api.post<Discussion>(`${B}/community/discussions`, input);
  return data;
}

/** Report a discussion/message/profile for moderation (child-safety). */
export async function reportContent(targetKind: ModerationReport['targetKind'], targetId: string, reason: ReportReason): Promise<ModerationReport> {
  if (USE_MOCK) {
    await delay(380);
    if (targetKind === 'discussion') {
      discussions = discussions.map((d) => (d.id === targetId ? { ...d, reported: true } : d));
    }
    return { id: `rpt_${Date.now()}`, targetKind, targetId, reason, status: 'received', ts: new Date().toISOString() };
  }
  const { data } = await api.post<ModerationReport>(`${B}/moderation/report`, { targetKind, targetId, reason });
  return data;
}

/** C6 — Notifications center. */
export async function getNotifications(): Promise<AcademyNotification[]> {
  if (USE_MOCK) { await delay(); return notifications3; }
  const { data } = await api.get<AcademyNotification[]>(`${B}/notifications`);
  return data;
}

export async function markNotificationRead(id: string): Promise<AcademyNotification[]> {
  if (USE_MOCK) {
    await delay(150);
    notifications3 = notifications3.map((n) => (n.id === id ? { ...n, read: true } : n));
    return notifications3;
  }
  const { data } = await api.post<AcademyNotification[]>(`${B}/notifications/${id}/read`, {});
  return data;
}

export async function markAllNotificationsRead(): Promise<AcademyNotification[]> {
  if (USE_MOCK) {
    await delay(200);
    notifications3 = notifications3.map((n) => ({ ...n, read: true }));
    return notifications3;
  }
  const { data } = await api.post<AcademyNotification[]>(`${B}/notifications/read-all`, {});
  return data;
}

/** C7 — Announcements (program/sponsor). */
export async function getAnnouncements(): Promise<Announcement[]> {
  if (USE_MOCK) { await delay(); return P3.MOCK_ANNOUNCEMENTS; }
  const { data } = await api.get<Announcement[]>(`${B}/announcements`);
  return data;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 4 — Tutor & School (T1–T8) + ECCE (E1–E3)
// Mock-first like every earlier phase. Tutor verify reuses the KYC affordance;
// tutor payouts reuse the payout-rail concept (settle T+1). Money in kobo.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Tutor identity (T1, T2) ────────────────────────────────────────────────────
export async function getTutorMe(): Promise<TutorProfile> {
  if (USE_MOCK) { await delay(); return tutorProfile; }
  const { data } = await api.get<TutorProfile>(`${B}/tutor/me`);
  return data;
}

/**
 * T1 — Tutor onboarding. Reuses the KYC affordance: submitting onboarding moves
 * verifyState unverified → pending (KYC review), captures subjects + an initial
 * payout destination, and marks onboarding complete.
 */
export async function onboardTutor(input: TutorOnboardInput): Promise<TutorProfile> {
  if (USE_MOCK) {
    await delay(550);
    const methods: PayoutMethod[] = [...tutorProfile.payoutMethods];
    if (input.payout) {
      const last4 = input.payout.accountNumber?.slice(-4);
      methods.unshift({
        id: `po_${Date.now()}`,
        kind: input.payout.kind,
        label: input.payout.kind === 'wallet' ? 'Paymax wallet' : `${input.payout.bankName ?? 'Bank'} •••• ${last4 ?? '0000'}`,
        bankName: input.payout.bankName,
        accountLast4: last4,
        isDefault: true,
      });
      methods.forEach((m, i) => { m.isDefault = i === 0; });
    }
    tutorProfile = {
      ...tutorProfile,
      displayName: input.displayName,
      bio: input.bio,
      subjects: input.subjects,
      trades: input.trades ?? [],
      hourlyRateKobo: input.hourlyRateKobo,
      availability: input.availability,
      payoutMethods: methods,
      // KYC-gated: verification is requested, not granted by the client.
      verifyState: 'pending',
      onboardingComplete: true,
    };
    // Surface a tutor role on the learner profile so the role switcher reflects it.
    profile = { ...profile, role: 'tutor' };
    track('onboarding_completed', { kind: 'tutor', subjects: input.subjects.length });
    return tutorProfile;
  }
  const { data } = await api.post<TutorProfile>(`${B}/tutor/onboard`, input);
  return data;
}

/** Marketplace listing (GET /tutors?subject=). */
export async function getTutors(subject?: string): Promise<TutorListing[]> {
  if (USE_MOCK) {
    await delay();
    if (!subject) return P4.MOCK_TUTOR_LISTINGS;
    const q = subject.toLowerCase();
    return P4.MOCK_TUTOR_LISTINGS.filter((t) => t.subjects.some((s) => s.toLowerCase().includes(q)));
  }
  const { data } = await api.get<TutorListing[]>(`${B}/tutors`, { params: { subject } });
  return data;
}

// ── Cohorts & roster (T3) ──────────────────────────────────────────────────────
export async function getCohorts(): Promise<Cohort[]> {
  if (USE_MOCK) { await delay(); return cohorts; }
  const { data } = await api.get<Cohort[]>(`${B}/tutor/cohorts`);
  return data;
}

// ── Assignments (T4) ───────────────────────────────────────────────────────────
export async function getAssignments(cohortId?: string): Promise<Assignment[]> {
  if (USE_MOCK) {
    await delay();
    return cohortId ? assignments.filter((a) => a.cohortId === cohortId) : assignments;
  }
  const { data } = await api.get<Assignment[]>(`${B}/tutor/assignments`, { params: { cohortId } });
  return data;
}

export async function createAssignment(input: CreateAssignmentInput): Promise<Assignment> {
  if (USE_MOCK) {
    await delay(450);
    const cohort = cohorts.find((c) => c.id === input.cohortId);
    const a: Assignment = {
      id: `asg_${Date.now()}`,
      cohortId: input.cohortId,
      cohortName: cohort?.name ?? 'Cohort',
      kind: input.kind,
      title: input.title,
      refId: input.refId,
      dueDate: input.dueDate,
      assignedAt: new Date().toISOString(),
      assignedCount: cohort?.studentCount ?? 0,
      submittedCount: 0,
      gradedCount: 0,
    };
    assignments = [a, ...assignments];
    track('lesson_started', { kind: 'assignment_pushed', cohort: input.cohortId });
    return a;
  }
  const { data } = await api.post<Assignment>(`${B}/tutor/assignments`, input);
  return data;
}

// ── Review & grade (T5) ────────────────────────────────────────────────────────
export async function getSubmissions(assignmentId?: string): Promise<Submission[]> {
  if (USE_MOCK) {
    await delay();
    return assignmentId ? submissions.filter((s) => s.assignmentId === assignmentId) : submissions;
  }
  const { data } = await api.get<Submission[]>(`${B}/tutor/submissions`, { params: { assignmentId } });
  return data;
}

export async function gradeSubmission(input: GradeInput): Promise<Submission> {
  if (USE_MOCK) {
    await delay(450);
    const idx = submissions.findIndex((s) => s.id === input.submissionId);
    if (idx < 0) throw new Error('Submission not found');
    const graded: Submission = { ...submissions[idx], status: 'graded', scorePct: input.scorePct, feedback: input.feedback };
    submissions = submissions.map((s) => (s.id === input.submissionId ? graded : s));
    // Roll up grade counts onto the assignment.
    assignments = assignments.map((a) =>
      a.id === graded.assignmentId ? { ...a, gradedCount: Math.min(a.assignedCount, a.gradedCount + 1) } : a,
    );
    // A small grading bonus credits the tutor's pending earnings (settles later).
    const bonus = 25_000; // ₦250 per graded piece
    tutorEarnings = {
      ...tutorEarnings,
      pendingKobo: tutorEarnings.pendingKobo + bonus,
      lifetimeKobo: tutorEarnings.lifetimeKobo + bonus,
      ledger: [{ id: `tl_${Date.now()}`, ts: new Date().toISOString(), kind: 'assignment_bonus', label: `Graded ${graded.studentName}`, amountKobo: bonus, settled: false }, ...tutorEarnings.ledger],
    };
    track('challenge_completed', { kind: 'grade', submission: input.submissionId, score: input.scorePct });
    return graded;
  }
  const { data } = await api.post<Submission>(`${B}/tutor/grades`, input);
  return data;
}

// ── Earnings & payouts (T7) ────────────────────────────────────────────────────
export async function getTutorEarnings(): Promise<TutorEarnings> {
  if (USE_MOCK) { await delay(); return tutorEarnings; }
  const { data } = await api.get<TutorEarnings>(`${B}/tutor/earnings`);
  return data;
}

/**
 * T7 — Request a payout on the payout rail. Fail-closed: must be verified, above
 * the minimum, and within the available balance. Debits available, posts a ledger
 * row, settles T+1 (mock copy). Mirrors the Paymax withdrawal concept.
 */
export async function requestPayout(amountKobo: number, methodId?: string): Promise<PayoutRequest> {
  if (USE_MOCK) {
    await delay(600);
    if (tutorProfile.verifyState !== 'verified') {
      throw new Error('Finish verification (KYC) before you can withdraw earnings.');
    }
    if (amountKobo < tutorEarnings.minPayoutKobo) {
      throw new Error(`Minimum payout is ${(tutorEarnings.minPayoutKobo / 100).toLocaleString('en-NG')} naira.`);
    }
    if (amountKobo > tutorEarnings.availableKobo) {
      throw new Error('Amount exceeds your available balance.');
    }
    const method = tutorProfile.payoutMethods.find((m) => m.id === methodId)
      ?? tutorProfile.payoutMethods.find((m) => m.isDefault)
      ?? tutorProfile.payoutMethods[0];
    const entry: TutorLedgerEntry = {
      id: `tl_${Date.now()}`, ts: new Date().toISOString(), kind: 'payout',
      label: `Withdrawal to ${method?.label ?? 'Paymax wallet'}`, amountKobo: -amountKobo, settled: false,
    };
    tutorEarnings = {
      ...tutorEarnings,
      availableKobo: tutorEarnings.availableKobo - amountKobo,
      ledger: [entry, ...tutorEarnings.ledger],
    };
    track('edupay_paid', { kind: 'tutor_payout', amountKobo });
    return {
      id: `pay_${Date.now()}`,
      amountKobo,
      method: method ?? { id: 'po_wallet', kind: 'wallet', label: 'Paymax wallet', isDefault: true },
      status: 'processing',
      requestedAt: new Date().toISOString(),
      expectedSettlement: 'Settles to your account by the next business day (T+1).',
    };
  }
  const { data } = await api.post<PayoutRequest>(`${B}/tutor/payouts`, { amountKobo, methodId });
  return data;
}

// ── School admin (lite) (T8) ───────────────────────────────────────────────────
export async function getMySchools(): Promise<ManagedSchool[]> {
  if (USE_MOCK) { await delay(); return managedSchools; }
  const { data } = await api.get<ManagedSchool[]>(`${B}/schools/mine`);
  return data;
}

export async function getSchoolOverview(schoolId: string): Promise<SchoolOverview> {
  if (USE_MOCK) {
    await delay();
    const ov = P4.MOCK_SCHOOL_OVERVIEWS[schoolId];
    if (!ov) throw new Error('School overview not found');
    return ov;
  }
  const { data } = await api.get<SchoolOverview>(`${B}/schools/${schoolId}/overview`);
  return data;
}

// ── ECCE / Little Learners (E1, E2) ────────────────────────────────────────────
/** ECCE home is mock-only (no backend endpoint required for the play surface). */
export async function getEcceHome(): Promise<EcceHome> {
  await delay();
  return ecceHome;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function setsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const bs = new Set(b);
  return a.every((x) => bs.has(x));
}

/**
 * Credit reward points locally and queue the earn for server reconciliation.
 * Mirrors the offline-first contract: events queue and sync deterministically;
 * the server is authoritative for the final balance.
 */
// Idempotency keys already credited this session (e.g. `exam:<attemptId>`), so a
// replayed submit / challenge cannot re-award. Mirrors the server ledger's unique
// constraint on the reconcile key.
let awardedPointKeys: ReadonlySet<string> = new Set<string>();

/**
 * Credit reward points through the pure idempotent ledger. Pass a stable `key`
 * (e.g. `exam:<attemptId>`) for one-time awards so re-submits don't double-count;
 * omit it for genuinely-repeatable earns. The idempotency key is forwarded on the
 * offline-sync payload so the server dedups on reconnect too.
 */
function creditPointsLocal(points: number, reason: string, key?: string) {
  const before: PointsLedgerState = { balance: rewardBalance, history: rewardHistory, awarded: awardedPointKeys };
  const { state, applied } = creditPoints(before, {
    points, reason, key, id: `rl_${Date.now()}`, ts: new Date().toISOString(),
  });
  if (!applied) return; // non-positive amount or duplicate idempotency key → no-op
  rewardBalance = state.balance;
  rewardHistory = state.history;
  awardedPointKeys = state.awarded;
  enqueue({ type: 'reward_earn', payload: { points, reason, key } });
  track('reward_earned', { points, reason });
}

/**
 * Mint a verifiable trade credential locally (S5). Emits credential_issued per
 * the nfr taxonomy. Server is authoritative for issuance/signing on the live path.
 */
function issueCredentialLocal(trackSlug: TradeSlug | undefined, trackId: string, scorePct: number): Credential {
  const trackObj = tradeTracks.find((t) => t.id === trackId);
  const slug = trackSlug ?? trackObj?.slug ?? 'solar';
  const code = `VC-TR-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const cred: Credential = {
    id: `cred_${Date.now()}`,
    kind: 'trade',
    title: `${trackObj?.name ?? 'Trade skill'} — Level 1`,
    issuer: 'Spotlight Academy · Paymax Skills',
    recipientName: profile.displayName,
    issuedAt: new Date().toISOString(),
    verificationId: code,
    verifyUrl: `https://verify.spotlight.academy/c/${code}`,
    unlocksRoles: trackObj?.unlocksRoles ?? [],
    scorePct,
    trackSlug: slug,
  };
  credentials = [cred, ...credentials];
  track('credential_issued', { credential: cred.id, track: trackId, score: scorePct });
  return cred;
}

/** Fail-closed gate: minors must have guardian consent before spending/redeeming. */
function assertConsentForSpend() {
  // Fail-closed on BOTH the mock AND live paths (previously gated on USE_MOCK, so
  // the live path was fail-OPEN). Client defence in depth; the server is also
  // authoritative. NDPR / SF-7: a minor may not spend without guardian consent.
  assertCanSpend(spendConsentState());
}

/**
 * The current learner's spend-consent state. Exported so the competition-rewards
 * module (which has no minor/consent of its own) can enforce the same fail-closed
 * gate against the single shared academy profile.
 */
export function spendConsentState(): SpendConsentState {
  return { isMinor: profile.isMinor, guardianConsent: profile.guardianConsent };
}

/**
 * Child-safety gate for parent actions: the guardian must hold an active link to
 * the child before any dashboard/controls/report/approval action (fail-closed).
 * In mock, the active guardian link lives on the ChildSummary.linked flag.
 */
function assertLinkedChild(minorId: string) {
  if (USE_MOCK) {
    const child = children.find((c) => c.minorId === minorId);
    if (!child || !child.linked) {
      throw new Error('No active guardian link for this child. Link and obtain consent first.');
    }
  }
}

/** Test/dev helper to reset mock profile consent (used by onboarding flows). */
export function _mockProfile(): AcademyProfile { return profile; }
