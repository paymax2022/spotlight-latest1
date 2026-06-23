import { randomUUID } from 'crypto';

// ── Rubric definitions per contest type ───────────────────────────────────────

export interface RubricCriterion {
  key: string;
  label: string;
  description: string;
  maxScore: number;
}

const REALITY_RUBRIC: RubricCriterion[] = [
  { key: 'entertainment',   label: 'Entertainment Value',  description: 'How engaging and entertaining is this contestant?',    maxScore: 10 },
  { key: 'stage_presence',  label: 'Stage Presence',       description: 'Confidence, energy and command of the stage/camera.', maxScore: 10 },
  { key: 'personality',     label: 'Personality & Appeal', description: 'Is their personality compelling and relatable?',       maxScore: 10 },
  { key: 'versatility',     label: 'Versatility',          description: 'Can they hold different formats and challenges?',      maxScore: 10 },
  { key: 'potential',       label: 'Growth Potential',     description: 'Long-term industry and audience growth potential.',    maxScore: 10 },
];

const GENERAL_RUBRIC: RubricCriterion[] = [
  { key: 'talent',          label: 'Talent & Skill',       description: 'Raw skill level relative to the contest category.',  maxScore: 10 },
  { key: 'creativity',      label: 'Creativity',           description: 'Original ideas, unique approach to the craft.',      maxScore: 10 },
  { key: 'stage_presence',  label: 'Stage Presence',       description: 'Confidence and command when performing.',            maxScore: 10 },
  { key: 'impression',      label: 'Overall Impression',   description: 'The "wow factor" — would audiences follow this person?', maxScore: 10 },
  { key: 'potential',       label: 'Growth Potential',     description: 'Long-term development potential in the industry.',   maxScore: 10 },
];

const STEM_RUBRIC: RubricCriterion[] = [
  { key: 'innovation',      label: 'Innovation',           description: 'How novel or disruptive is the idea?',              maxScore: 10 },
  { key: 'technical',       label: 'Technical Merit',      description: 'Depth, accuracy and quality of the solution.',      maxScore: 10 },
  { key: 'impact',          label: 'Social/Market Impact', description: 'Real-world problem being solved and scope.',        maxScore: 10 },
  { key: 'presentation',    label: 'Presentation Quality', description: 'Clarity, confidence and quality of pitch/demo.',   maxScore: 10 },
  { key: 'feasibility',     label: 'Feasibility',          description: 'Can this be realistically built or scaled?',        maxScore: 10 },
];

const OPEN_MIC_RUBRIC: RubricCriterion[] = [
  { key: 'vocals',          label: 'Vocal/Lyrical Quality', description: 'Technique, tone, delivery and lyrical content.',  maxScore: 10 },
  { key: 'stage_presence',  label: 'Stage Presence',        description: 'Energy, confidence and crowd connection.',        maxScore: 10 },
  { key: 'originality',     label: 'Originality',           description: 'How fresh and distinctive is the performance?',  maxScore: 10 },
  { key: 'crowd_energy',    label: 'Crowd Energy',          description: 'Ability to captivate and move the audience.',     maxScore: 10 },
  { key: 'potential',       label: 'Artist Potential',      description: 'Long-term potential as a recording/live artist.', maxScore: 10 },
];

const SME_RUBRIC: RubricCriterion[] = [
  { key: 'business_model',  label: 'Business Model',       description: 'Clarity and viability of the revenue model.',      maxScore: 10 },
  { key: 'market_fit',      label: 'Market Fit',           description: 'Does this product/service meet a real market need?', maxScore: 10 },
  { key: 'pitch_quality',   label: 'Pitch Quality',        description: 'Confidence, clarity and persuasiveness of pitch.', maxScore: 10 },
  { key: 'traction',        label: 'Traction / Proof',     description: 'Evidence of sales, users or validated demand.',    maxScore: 10 },
  { key: 'scalability',     label: 'Scalability',          description: 'Potential to grow and reach a wider market.',      maxScore: 10 },
];

export function getRubricForContest(contestSlug: string): RubricCriterion[] {
  if (contestSlug.includes('reality')) return REALITY_RUBRIC;
  if (contestSlug.includes('stem'))    return STEM_RUBRIC;
  if (contestSlug.includes('open-mic')) return OPEN_MIC_RUBRIC;
  if (contestSlug.includes('sme'))     return SME_RUBRIC;
  return GENERAL_RUBRIC;
}

// ── Types ────────────────────────────────────────────────────────────────────

export type Recommendation = 'pending' | 'shortlist' | 'approve' | 'reject';

export interface JudgeScoreCard {
  id: string;
  applicationId: string;
  judgeId: string;
  judgeName: string;
  contestSlug: string;
  scores: Record<string, number>;   // criterion key → 1-10
  totalScore: number;
  maxScore: number;
  percentageScore: number;
  recommendation: Recommendation;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScoreSummary {
  applicationId: string;
  scoreCount: number;
  averageTotal: number;
  averagePct: number;
  highestScore: number;
  lowestScore: number;
  recommendations: Record<Recommendation, number>;
  consensusRecommendation: Recommendation;
}

// ── Store ────────────────────────────────────────────────────────────────────

interface ScoringStore {
  scorecards: Map<string, JudgeScoreCard>;  // id → scorecard
}

function getStore(): ScoringStore {
  const key = '__spotlightScoringStore';
  const g = globalThis as unknown as Record<string, ScoringStore | undefined>;
  if (!g[key]) g[key] = { scorecards: new Map() };
  return g[key] as ScoringStore;
}

function now() { return new Date().toISOString(); }

// ── CRUD ─────────────────────────────────────────────────────────────────────

export function getScorecard(id: string): JudgeScoreCard | null {
  return getStore().scorecards.get(id) ?? null;
}

export function getScorecardForJudge(applicationId: string, judgeId: string): JudgeScoreCard | null {
  return Array.from(getStore().scorecards.values())
    .find((s) => s.applicationId === applicationId && s.judgeId === judgeId) ?? null;
}

export function listScorecardsForApplication(applicationId: string): JudgeScoreCard[] {
  return Array.from(getStore().scorecards.values())
    .filter((s) => s.applicationId === applicationId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function listAllScorecards(): JudgeScoreCard[] {
  return Array.from(getStore().scorecards.values())
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function calcTotals(scores: Record<string, number>, rubric: RubricCriterion[]) {
  const total = rubric.reduce((sum, c) => sum + Math.min(Math.max(scores[c.key] ?? 0, 0), c.maxScore), 0);
  const max   = rubric.reduce((sum, c) => sum + c.maxScore, 0);
  return { totalScore: total, maxScore: max, percentageScore: max > 0 ? Math.round((total / max) * 100) : 0 };
}

export function upsertScorecard(input: {
  applicationId: string;
  judgeId: string;
  judgeName: string;
  contestSlug: string;
  scores: Record<string, number>;
  recommendation: Recommendation;
  notes: string;
}): JudgeScoreCard {
  const store = getStore();
  const rubric = getRubricForContest(input.contestSlug);
  const { totalScore, maxScore, percentageScore } = calcTotals(input.scores, rubric);

  const existing = getScorecardForJudge(input.applicationId, input.judgeId);
  const card: JudgeScoreCard = {
    id: existing?.id ?? randomUUID(),
    applicationId: input.applicationId,
    judgeId: input.judgeId,
    judgeName: input.judgeName,
    contestSlug: input.contestSlug,
    scores: input.scores,
    totalScore,
    maxScore,
    percentageScore,
    recommendation: input.recommendation,
    notes: input.notes,
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
  };
  store.scorecards.set(card.id, card);
  return card;
}

export function getScoreSummary(applicationId: string): ScoreSummary | null {
  const cards = listScorecardsForApplication(applicationId);
  if (cards.length === 0) return null;

  const totals = cards.map((c) => c.percentageScore);
  const rec: Record<Recommendation, number> = { pending: 0, shortlist: 0, approve: 0, reject: 0 };
  for (const c of cards) rec[c.recommendation]++;

  const consensus = (['approve', 'shortlist', 'reject', 'pending'] as Recommendation[])
    .reduce((top, r) => rec[r] > rec[top] ? r : top, 'pending' as Recommendation);

  return {
    applicationId,
    scoreCount: cards.length,
    averageTotal: Math.round(totals.reduce((a, b) => a + b, 0) / totals.length),
    averagePct: Math.round(totals.reduce((a, b) => a + b, 0) / totals.length),
    highestScore: Math.max(...totals),
    lowestScore: Math.min(...totals),
    recommendations: rec,
    consensusRecommendation: consensus,
  };
}

export function getScoredApplicationIds(): Set<string> {
  return new Set(Array.from(getStore().scorecards.values()).map((s) => s.applicationId));
}
