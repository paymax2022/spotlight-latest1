// Paymax Connect — Skill Assessments API (Phase 6 §6.7 SA-01..04).
// Mock-first (USE_MOCK): the whole flow is walkable offline. Live path hits
// `${CONNECT_API_BASE}/networking/assessments…`. Every mutating call sends an
// Idempotency-Key (money/state safety convention).
//
// PN-12: `assessmentVersion` is threaded through start → submit → badge so a
// badge permanently records the bank version it was passed against.

import { api } from '@/api/client';
import { USE_MOCK, CONNECT_API_BASE } from '../../constants/connect.constants';
import type {
  SkillAssessment,
  AssessmentAttempt,
  AssessmentSubmitResult,
  AssessmentBadge,
  AssessmentQuestion,
} from './types';

const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));

function unwrap<T>(res: { data?: { data?: T } & T }): T {
  return (res.data?.data ?? res.data) as T;
}

// Idempotency key (crypto.randomUUID when available, else RFC4122-ish fallback).
export function newIdempotencyKey(): string {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') return g.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
const idem = (key?: string) => ({ headers: { 'Idempotency-Key': key ?? newIdempotencyKey() } });

// ── Mock catalogue (SA-01) ───────────────────────────────────────────────────
const MOCK_ASSESSMENTS: SkillAssessment[] = [
  {
    id: 'sa_go',
    domain: 'Engineering',
    title: 'Backend Engineering — Go & APIs',
    skill: 'Go (Backend)',
    description: 'Concurrency, HTTP services, error handling and idempotency.',
    passThreshold: 70,
    questionCount: 5,
    perQuestionSecs: 60,
    assessmentVersion: 'v3',
  },
  {
    id: 'sa_product',
    domain: 'Product',
    title: 'Product Discovery Fundamentals',
    skill: 'Product Discovery',
    description: 'Opportunity framing, research signals and prioritisation.',
    passThreshold: 65,
    questionCount: 5,
    perQuestionSecs: 60,
    assessmentVersion: 'v2',
  },
  {
    id: 'sa_design',
    domain: 'Design',
    title: 'UX Foundations',
    skill: 'UX Design',
    description: 'Heuristics, accessibility and interaction basics.',
    passThreshold: 70,
    questionCount: 5,
    perQuestionSecs: 60,
    assessmentVersion: 'v1',
  },
  {
    id: 'sa_data',
    domain: 'Data',
    title: 'Applied Machine Learning',
    skill: 'Machine Learning',
    description: 'Model evaluation, leakage and fairness essentials.',
    passThreshold: 75,
    questionCount: 5,
    perQuestionSecs: 60,
    assessmentVersion: 'v4',
  },
];

// A tiny mock bank per assessment. `answer` is the correct option id and is NEVER
// returned in the contestant-safe attempt feed — it stays server-side (here, in
// this module) and is only consulted on submit.
interface MockItem { prompt: string; options: string[]; answer: string; }
const MOCK_BANK: Record<string, MockItem[]> = {
  sa_go: [
    { prompt: 'Which construct provides safe concurrent communication in Go?', options: ['Channels', 'Global vars', 'panic()', 'time.Sleep'], answer: '0' },
    { prompt: 'An idempotent POST should…', options: ['Charge twice on retry', 'Return the same result on retry', 'Ignore the body', 'Never be retried'], answer: '1' },
    { prompt: 'What does `defer` do?', options: ['Runs immediately', 'Runs on function return', 'Skips a line', 'Starts a goroutine'], answer: '1' },
    { prompt: 'Best status for a validation failure?', options: ['200', '301', '422', '500'], answer: '2' },
    { prompt: 'Money in this platform is stored as…', options: ['Floats', 'Strings', 'Integers (kobo)', 'Decimals'], answer: '2' },
  ],
  sa_product: [
    { prompt: 'Discovery primarily reduces…', options: ['Delivery cost', 'Value & usability risk', 'Server load', 'Headcount'], answer: '1' },
    { prompt: 'A good opportunity is framed as a…', options: ['Solution spec', 'Customer problem', 'Roadmap date', 'KPI target'], answer: '1' },
    { prompt: 'Which is a qualitative signal?', options: ['Funnel drop-off', 'User interview', 'A/B result', 'DAU count'], answer: '1' },
    { prompt: 'Prioritise by…', options: ['Loudest stakeholder', 'Impact vs effort', 'Alphabetical', 'FIFO'], answer: '1' },
    { prompt: 'Continuous discovery cadence is best when…', options: ['Once a year', 'Weekly & ongoing', 'Only at launch', 'Never'], answer: '1' },
  ],
  sa_design: [
    { prompt: 'Minimum text contrast (WCAG AA, normal text)?', options: ['2:1', '3:1', '4.5:1', '7:1'], answer: '2' },
    { prompt: 'Fitts’s Law relates target size to…', options: ['Colour', 'Acquisition time', 'Font', 'Load time'], answer: '1' },
    { prompt: 'Which improves error recovery?', options: ['Silent failure', 'Clear undo', 'Modal spam', 'Hidden state'], answer: '1' },
    { prompt: 'A consistent design system reduces…', options: ['Cognitive load', 'Accessibility', 'Contrast', 'Whitespace'], answer: '0' },
    { prompt: 'Best default for destructive actions?', options: ['No confirm', 'Confirm + undo', 'Auto-run', 'Hide it'], answer: '1' },
  ],
  sa_data: [
    { prompt: 'Data leakage most directly causes…', options: ['Underfitting', 'Optimistic offline metrics', 'Slower training', 'Fewer features'], answer: '1' },
    { prompt: 'For imbalanced classes prefer…', options: ['Accuracy', 'PR-AUC', 'MSE', 'R²'], answer: '1' },
    { prompt: 'Cross-validation mainly estimates…', options: ['Bias only', 'Generalisation', 'Latency', 'Storage'], answer: '1' },
    { prompt: 'A fairness concern is…', options: ['Disparate error rates', 'Faster inference', 'Smaller model', 'More epochs'], answer: '0' },
    { prompt: 'Regularisation helps to…', options: ['Increase variance', 'Reduce overfitting', 'Add leakage', 'Remove labels'], answer: '1' },
  ],
};

// In-memory answer keys keyed by attemptId (mock-only — mimics server-held keys).
const ATTEMPT_KEYS = new Map<string, { assessmentId: string; version: string; key: Record<string, string> }>();

function toSafeQuestions(assessmentId: string): { questions: AssessmentQuestion[]; key: Record<string, string> } {
  const bank = MOCK_BANK[assessmentId] ?? MOCK_BANK.sa_go;
  const key: Record<string, string> = {};
  const questions: AssessmentQuestion[] = bank.map((item, i) => {
    const id = `${assessmentId}_q${i}`;
    key[id] = item.answer;
    return {
      id,
      prompt: item.prompt,
      // contestant-safe: options only, NO correctOptionId / explanation leaked
      options: item.options.map((label, oi) => ({ id: String(oi), label })),
      timeLimitSecs: 60,
    };
  });
  return { questions, key };
}

// ── Catalogue (SA-01) ────────────────────────────────────────────────────────
export async function getAssessments(domain?: string): Promise<SkillAssessment[]> {
  if (USE_MOCK) {
    await delay();
    const d = (domain ?? '').trim().toLowerCase();
    const earnedIds = new Set(MOCK_BADGES.map((b) => b.assessmentId));
    return MOCK_ASSESSMENTS
      .filter((a) => !d || a.domain.toLowerCase() === d)
      .map((a) => ({ ...a, earned: earnedIds.has(a.id), cooldownUntil: COOLDOWNS.get(a.id) ?? null }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/networking/assessments`, { params: { domain } });
  return unwrap<SkillAssessment[]>(res);
}

// ── Start an attempt (SA-02) — returns contestant-safe questions ─────────────
export async function startAssessmentAttempt(assessmentId: string, idempotencyKey?: string): Promise<AssessmentAttempt> {
  if (USE_MOCK) {
    await delay(320);
    const a = MOCK_ASSESSMENTS.find((x) => x.id === assessmentId) ?? MOCK_ASSESSMENTS[0];
    const attemptId = `att_${assessmentId}_${Date.now()}`;
    const { questions, key } = toSafeQuestions(a.id);
    ATTEMPT_KEYS.set(attemptId, { assessmentId: a.id, version: a.assessmentVersion, key });
    return {
      attemptId,
      assessmentId: a.id,
      assessmentVersion: a.assessmentVersion,
      passThreshold: a.passThreshold,
      perQuestionSecs: a.perQuestionSecs,
      questions,
      state: 'STARTED',
    };
  }
  const res = await api.post(`${CONNECT_API_BASE}/networking/assessments/${assessmentId}/attempts`, {}, idem(idempotencyKey));
  return unwrap<AssessmentAttempt>(res);
}

// ── Submit an attempt (SA-03 / SA-04) ────────────────────────────────────────
export async function submitAssessmentAttempt(
  assessmentId: string,
  attemptId: string,
  answers: Record<string, string>,     // questionId -> optionId
  idempotencyKey?: string,
): Promise<AssessmentSubmitResult> {
  if (USE_MOCK) {
    await delay(420);
    const a = MOCK_ASSESSMENTS.find((x) => x.id === assessmentId) ?? MOCK_ASSESSMENTS[0];
    const stored = ATTEMPT_KEYS.get(attemptId);
    const key = stored?.key ?? {};
    const total = Object.keys(key).length || a.questionCount;
    const correctCount = Object.entries(key).reduce((n, [qid, ans]) => (answers[qid] === ans ? n + 1 : n), 0);
    const score = total ? Math.round((correctCount / total) * 100) : 0;
    const passed = score >= a.passThreshold;
    ATTEMPT_KEYS.delete(attemptId);

    if (passed) {
      COOLDOWNS.delete(a.id);
      const badge: AssessmentBadge = {
        id: `bdg_${a.id}_${Date.now()}`,
        assessmentId: a.id,
        domain: a.domain,
        title: a.title,
        skill: a.skill,
        score,
        assessmentVersion: a.assessmentVersion,   // frozen at issuance (PN-12)
        issuedAt: new Date().toISOString(),
        source: 'assessed',
      };
      if (!MOCK_BADGES.some((b) => b.assessmentId === a.id)) MOCK_BADGES.unshift(badge);
      return {
        attemptId, assessmentId: a.id, assessmentVersion: a.assessmentVersion,
        state: 'PASSED', passed: true, score, correctCount, total,
        passThreshold: a.passThreshold, badgeIssued: true, badge, cooldownUntil: null,
      };
    }

    // FAILED → cooldown before retry (SA-04). Mock: 24h from now.
    const cooldownUntil = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    COOLDOWNS.set(a.id, cooldownUntil);
    return {
      attemptId, assessmentId: a.id, assessmentVersion: a.assessmentVersion,
      state: 'FAILED', passed: false, score, correctCount, total,
      passThreshold: a.passThreshold, badgeIssued: false, badge: null, cooldownUntil,
    };
  }
  const res = await api.patch(
    `${CONNECT_API_BASE}/networking/assessments/${assessmentId}/attempts/${attemptId}/submit`,
    { answers },
    idem(idempotencyKey),
  );
  return unwrap<AssessmentSubmitResult>(res);
}

// ── My assessed badges (SA-03 → profile) ─────────────────────────────────────
export async function getAssessmentBadges(): Promise<AssessmentBadge[]> {
  if (USE_MOCK) {
    await delay(160);
    return MOCK_BADGES.map((b) => ({ ...b }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/networking/assessment-badges`);
  return unwrap<AssessmentBadge[]>(res);
}

// Mutable mock state so the flow persists within a session (badge appears in the
// catalogue + badges list after passing; a fail sets a cooldown).
const MOCK_BADGES: AssessmentBadge[] = [
  {
    id: 'bdg_seed_product',
    assessmentId: 'sa_product',
    domain: 'Product',
    title: 'Product Discovery Fundamentals',
    skill: 'Product Discovery',
    score: 82,
    assessmentVersion: 'v2',
    issuedAt: new Date(Date.now() - 12 * 86400000).toISOString(),
    source: 'assessed',
  },
];
const COOLDOWNS = new Map<string, string>();

export const ASSESSMENT_DOMAINS = ['Engineering', 'Product', 'Design', 'Data'];
