/**
 * Judges & Scores admin data — the second console served over PATH A
 * (ADMIN CONSOLIDATION, slice 4; see docs/adr/ADR-047-admin-console-consolidation-path-a.md).
 *
 * Its data has no Go module: scoring lives in frontend-web's in-memory
 * scoring store, layered on top of its registration store. Unlike contests
 * (slice 3), the frontend-web routes this calls already did their own
 * Bearer-JWT auth via assertAdminPermission(request, 'scores:manage') before
 * this console existed — nothing changed on the frontend-web side to make
 * this work, only a client + service on this side reaching it through
 * /api/web-proxy exactly as contestsAdminService.ts does.
 */
import { webProxyBase } from '@/config/env';

export type Recommendation = 'pending' | 'shortlist' | 'approve' | 'reject';

export interface RubricCriterion {
  key: string;
  label: string;
  description: string;
  maxScore: number;
}

export interface JudgeScoreCard {
  id: string;
  applicationId: string;
  judgeId: string;
  judgeName: string;
  contestSlug: string;
  scores: Record<string, number>;
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

export interface ScoredApplication {
  id: string;
  reference: string;
  contestSlug: string;
  status: string;
  isScored: boolean;
  fullName: string;
  email: string;
  primarySkill: string;
  state: string;
  scoreSummary: ScoreSummary | null;
  rubric: RubricCriterion[];
  createdAt: string;
  updatedAt: string;
}

export interface ScoreDetail {
  scorecards: JudgeScoreCard[];
  summary: ScoreSummary | null;
  rubric: RubricCriterion[];
}

function webBase(): string {
  return webProxyBase();
}

function authHeaders(json = false): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  const headers: Record<string, string> = {};
  if (json) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function readJsonOrThrow(res: Response, label: string): Promise<Record<string, unknown>> {
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401) throw new Error(`${label} failed: 401 — sign in again.`);
  if (res.status === 403) throw new Error(`${label} failed: 403 — this account cannot manage scores.`);
  if (!res.ok) throw new Error(`${label} failed: ${(json.error as string) || res.status}`);
  return json;
}

export interface ScoringListFilters {
  contestSlug?: string;
  status?: string;
  query?: string;
}

export interface ScoringListResult {
  applications: ScoredApplication[];
  stats: { total: number; scored: number; pending: number };
}

export async function listScoreableApplications(filters: ScoringListFilters = {}): Promise<ScoringListResult> {
  const params = new URLSearchParams();
  if (filters.contestSlug) params.set('contestSlug', filters.contestSlug);
  if (filters.status) params.set('status', filters.status);
  if (filters.query) params.set('query', filters.query);

  const qs = params.toString();
  const res = await fetch(`${webBase()}/api/admin/judges-scores${qs ? `?${qs}` : ''}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  const json = await readJsonOrThrow(res, 'Loading applications');
  return {
    applications: (json.applications as ScoredApplication[]) ?? [],
    stats: (json.stats as ScoringListResult['stats']) ?? { total: 0, scored: 0, pending: 0 },
  };
}

export async function getScoreDetail(applicationId: string): Promise<ScoreDetail> {
  const res = await fetch(`${webBase()}/api/admin/judges-scores/applications/${applicationId}/score`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  const json = await readJsonOrThrow(res, 'Loading scorecards');
  return {
    scorecards: (json.scorecards as JudgeScoreCard[]) ?? [],
    summary: (json.summary as ScoreSummary | null) ?? null,
    rubric: (json.rubric as RubricCriterion[]) ?? [],
  };
}

export async function submitScorecard(
  applicationId: string,
  payload: { scores: Record<string, number>; recommendation: Recommendation; notes: string },
): Promise<{ scorecard: JudgeScoreCard; summary: ScoreSummary | null }> {
  const res = await fetch(`${webBase()}/api/admin/judges-scores/applications/${applicationId}/score`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(payload),
  });
  const json = await readJsonOrThrow(res, 'Saving score');
  return {
    scorecard: json.scorecard as JudgeScoreCard,
    summary: (json.summary as ScoreSummary | null) ?? null,
  };
}
