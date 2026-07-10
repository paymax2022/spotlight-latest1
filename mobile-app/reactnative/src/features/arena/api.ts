// ── Arena (Driver Contest) — API wrapper ─────────────────────────────────────
// Talks to the Go backend at EXPO_PUBLIC_API_BASE_URL → /api/arena via the shared
// axios `api` client (bearer auth injected by the request interceptor).
//
// Iron rules honoured here:
//  - Money mutations (support) carry a fresh Idempotency-Key header so a retried
//    tap never double-charges the wallet (see ARENA-PRD NDC-4).
//  - The Play-Along attempt also carries an Idempotency-Key (a resubmit must not
//    write duplicate engagement rows).
//  - No provider secret lives in the app; the backend owns wallet debit + ledger.

import { api } from '@/api/client';
import type {
  Competition,
  MeritLeaderboardEntry,
  StateStanding,
  PotSnapshot,
  CredentialVerification,
  Contestant,
  ContestantMeResponse,
  MyMeritResponse,
  TrainingModule,
  PlayAlongStageSet,
  PlayAlongAttemptResult,
  ExamAssignment,
  ExamSubmitResult,
  SupportResult,
  PeoplesChampionTally,
  PredictionPick,
} from './types';
import {
  mockPlayAlongStage,
  mockScorePlayAlong,
  mockExamAssignment,
} from './quiz.stages.mock';
import { USE_MOCK } from './constants';
import {
  mockCompetition,
  mockCompetitions,
  mockMeritLeaderboard,
  mockStatePride,
  mockPot,
  mockDriverProfile,
} from './reads.mock';

const BASE = '/api/arena';

/** Unwrap the common { data } envelope used across the backend. */
const unwrap = <T>(res: { data: { data?: T } & T }): T => (res.data?.data ?? res.data) as T;

/**
 * Fresh Idempotency-Key per money/engagement mutation. Uses crypto.randomUUID
 * where available (RN 0.71+ / Hermes), falling back to a uuid-v4-ish string so
 * the header is always present. (Mirrors the kycverify module's helper.)
 */
export function newIdempotencyKey(): string {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') return g.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const idem = (key?: string) => ({ headers: { 'Idempotency-Key': key ?? newIdempotencyKey() } });

// ─── PUBLIC (no auth required to read) ──────────────────────────────────────

/** GET /competitions — list of competitions for the home rail. */
export async function listCompetitions(): Promise<Competition[]> {
  if (USE_MOCK) return mockCompetitions();
  try {
    const raw = unwrap<{ competitions?: Competition[] } | Competition[]>(
      await api.get(`${BASE}/competitions`),
    );
    const list = Array.isArray(raw) ? raw : raw.competitions ?? [];
    if (list.length > 0) return list;
  } catch { /* backend unavailable in dev */ }
  return mockCompetitions();
}

/** GET /competitions/{id} — a single competition. */
export async function getCompetition(id: string): Promise<Competition> {
  if (USE_MOCK) return mockCompetition(id);
  try {
    return unwrap<Competition>(await api.get(`${BASE}/competitions/${id}`));
  } catch {
    return mockCompetition(id);
  }
}

/** GET /competitions/{id}/leaderboard/merit — the REAL ranking (NDC-1). */
export async function getMeritLeaderboard(id: string): Promise<MeritLeaderboardEntry[]> {
  if (USE_MOCK) return mockMeritLeaderboard();
  try {
    const raw = unwrap<{ entries?: MeritLeaderboardEntry[] } | MeritLeaderboardEntry[]>(
      await api.get(`${BASE}/competitions/${id}/leaderboard/merit`),
    );
    const list = Array.isArray(raw) ? raw : raw.entries ?? [];
    if (list.length > 0) return list;
  } catch { /* backend unavailable in dev */ }
  return mockMeritLeaderboard();
}

/** GET /competitions/{id}/pot — derived prize-pot transparency snapshot (S9). */
export async function getPot(id: string): Promise<PotSnapshot> {
  if (USE_MOCK) return mockPot();
  try {
    return unwrap<PotSnapshot>(await api.get(`${BASE}/competitions/${id}/pot`));
  } catch {
    return mockPot();
  }
}

/** GET /credentials/{hash}/verify — public credential verification (C9 / S3 QR). */
export async function verifyCredential(hash: string): Promise<CredentialVerification> {
  return unwrap<CredentialVerification>(await api.get(`${BASE}/credentials/${hash}/verify`));
}

// ─── MEMBER (auth) ──────────────────────────────────────────────────────────

/** POST /competitions/{id}/applications — submit application → state APPLIED. */
export async function submitApplication(input: {
  competitionId: string;
  payload: Record<string, unknown>;
  homeState: string;
}): Promise<Contestant> {
  return unwrap<Contestant>(
    await api.post(
      `${BASE}/competitions/${input.competitionId}/applications`,
      { payload: input.payload, home_state: input.homeState },
      idem(), // additive-safe: application create is idempotent per attempt
    ),
  );
}

/** GET /competitions/{id}/me — the signed-in user's contestant record. */
export async function getMe(competitionId: string): Promise<ContestantMeResponse> {
  return unwrap<ContestantMeResponse>(
    await api.get(`${BASE}/competitions/${competitionId}/me`),
  );
}

/** GET /competitions/{id}/me/merit — the user's own Merit entries (C7, read-only). */
export async function getMyMerit(competitionId: string): Promise<MyMeritResponse> {
  return unwrap<MyMeritResponse>(
    await api.get(`${BASE}/competitions/${competitionId}/me/merit`),
  );
}

/**
 * POST /competitions/{id}/support — Back-a-Driver (S5). MONEY MUTATION.
 * Carries an Idempotency-Key; the backend debits the wallet, writes a balanced
 * append-only ledger entry, and attributes the amount to the pot + People's
 * Champion tally. It NEVER touches Merit (NDC-1).
 */
export async function support(input: {
  competitionId: string;
  contestantId: string;
  amountKobo: number;
  idempotencyKey?: string;
}): Promise<SupportResult> {
  if (USE_MOCK) {
    // Dev: the payment gateway (PaymentSheet) handles the actual charge; here we
    // just record the attributed support split (pot vs People's Champion).
    await new Promise((r) => setTimeout(r, 400));
    return {
      ok: true,
      potContributionKobo: Math.round(input.amountKobo * 0.85),
      peoplesChampionKobo: Math.round(input.amountKobo * 0.15),
      contestantId: input.contestantId,
    };
  }
  return unwrap<SupportResult>(
    await api.post(
      `${BASE}/competitions/${input.competitionId}/support`,
      { contestant_id: input.contestantId, amount_kobo: input.amountKobo },
      idem(input.idempotencyKey),
    ),
  );
}

/**
 * POST /competitions/{id}/playalong/attempt — "Are You a Naija Driver?" (S2).
 * Writes ENGAGEMENT only (never Merit). Idempotent per attempt so a retried
 * submit can't double-write. Returns a per-question reveal (the teaching moment)
 * and may issue a Certified Safe Driver credential.
 *
 * Contract body: { stage, answers:[{questionId, optionId}] }
 * Contract result: { score, total, passed, perQuestion:[{questionId,
 *                    correctOptionId, explanation, correct}], credentialIssued,
 *                    credentialHash, cashbackKobo }
 */
export async function submitPlayAlong(input: {
  competitionId: string;
  stage: number;
  answers: { questionId: string; optionId: string }[];
  idempotencyKey?: string;
}): Promise<PlayAlongAttemptResult> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 400));
    return mockScorePlayAlong(input.stage, input.answers);
  }
  return unwrap<PlayAlongAttemptResult>(
    await api.post(
      `${BASE}/competitions/${input.competitionId}/playalong/attempt`,
      {
        stage: input.stage,
        answers: input.answers.map((a) => ({ questionId: a.questionId, optionId: a.optionId })),
      },
      idem(input.idempotencyKey),
    ),
  );
}

/** POST /competitions/{id}/predictions — Predict-the-Champion (S7). */
export async function submitPredictions(input: {
  competitionId: string;
  picks: PredictionPick[];
  idempotencyKey?: string;
}): Promise<{ ok: true }> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 400));
    return { ok: true };
  }
  // Engagement mutation → MUST carry an Idempotency-Key so a re-lock can't write
  // duplicate prediction rows (backend rejects the request otherwise).
  await api.post(
    `${BASE}/competitions/${input.competitionId}/predictions`,
    { picks: input.picks.map((p) => ({ slot: p.slot, contestant_id: p.contestantId })) },
    idem(input.idempotencyKey),
  );
  return { ok: true };
}

// ─── Read helpers the backend may serve under a competition (best-effort) ────
// These reuse existing endpoints where the contract exposes them and degrade to
// empty data so screens still render "last updated" reads offline.

/** Training modules for the signed-in contestant (C4). Served under /me. */
export async function getTraining(competitionId: string): Promise<TrainingModule[]> {
  const raw = unwrap<{ modules?: TrainingModule[] } | TrainingModule[]>(
    await api.get(`${BASE}/competitions/${competitionId}/me/training`),
  );
  return Array.isArray(raw) ? raw : raw.modules ?? [];
}

/**
 * GET /competitions/{id}/playalong/questions?stage={1|2|3} — the contestant-safe
 * question set for a stage (S2). Returns stage metadata (name, pass mark,
 * per-question time limit) alongside the questions. Falls back to the seed-shaped
 * mock bank in dev / when the backend has no questions yet, so the quiz is always
 * walkable offline.
 */
export async function getPlayAlongStage(
  competitionId: string,
  stage: number,
): Promise<PlayAlongStageSet> {
  if (USE_MOCK) return mockPlayAlongStage(stage);
  try {
    const raw = unwrap<PlayAlongStageSet>(
      await api.get(`${BASE}/competitions/${competitionId}/playalong/questions`, {
        params: { stage },
      }),
    );
    if (raw && Array.isArray(raw.questions) && raw.questions.length > 0) return raw;
  } catch {
    /* backend unavailable in dev — use the mock bank below */
  }
  return mockPlayAlongStage(stage);
}

/** State Pride leaderboard (S6). */
export async function getStatePride(competitionId: string): Promise<StateStanding[]> {
  if (USE_MOCK) return mockStatePride();
  try {
    const raw = unwrap<{ states?: StateStanding[] } | StateStanding[]>(
      await api.get(`${BASE}/competitions/${competitionId}/leaderboard/state`),
    );
    const list = Array.isArray(raw) ? raw : raw.states ?? [];
    if (list.length > 0) return list;
  } catch { /* backend unavailable in dev */ }
  return mockStatePride();
}

/** Public driver profile — merit standing + People's Champion tally (S4). */
export async function getDriverProfile(
  competitionId: string,
  contestantId: string,
): Promise<{ merit: MeritLeaderboardEntry | null; peoplesChampion: PeoplesChampionTally | null }> {
  if (USE_MOCK) return mockDriverProfile(contestantId);
  try {
    return unwrap<{ merit: MeritLeaderboardEntry | null; peoplesChampion: PeoplesChampionTally | null }>(
      await api.get(`${BASE}/competitions/${competitionId}/drivers/${contestantId}`),
    );
  } catch {
    return mockDriverProfile(contestantId);
  }
}

/** Raised by getExam when the contestant is not in THEORY_ASSIGNED (HTTP 409). */
export class ExamNotAssignedError extends Error {
  constructor() {
    super('Exam is not assigned yet.');
    this.name = 'ExamNotAssignedError';
  }
}

/**
 * GET /competitions/{id}/me/exam — the contestant's assigned batch feed (C6).
 * ONLINE-REQUIRED and CONTESTANT-SAFE (no answers/explanations ever ship here).
 * The backend returns 409 unless the contestant is THEORY_ASSIGNED; we surface
 * that as {@link ExamNotAssignedError} so the runner can guard gracefully.
 *
 * NOTE: capture/proctor SDK is stubbed for sandbox (see the exam runner screen).
 */
export async function getExam(competitionId: string): Promise<ExamAssignment> {
  if (USE_MOCK) return mockExamAssignment();
  try {
    return unwrap<ExamAssignment>(await api.get(`${BASE}/competitions/${competitionId}/me/exam`));
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 409) throw new ExamNotAssignedError();
    throw err;
  }
}

/**
 * POST /competitions/{id}/me/exam/submit — the completed proctored exam →
 * THEORY_TAKEN (Merit pending). Idempotent: one attempt per (contestant, batch)
 * is enforced server-side. Only the selected optionIds leave the device —
 * answers are NEVER revealed in exam mode.
 *
 * Contract body: { answers:[{questionId, optionId}], responseTimeMs? }
 */
export async function submitExam(input: {
  competitionId: string;
  answers: { questionId: string; optionId: string }[];
  responseTimeMs?: number;
  idempotencyKey?: string;
}): Promise<ExamSubmitResult> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 500));
    return { ok: true, state: 'THEORY_TAKEN', submittedAt: new Date().toISOString() };
  }
  return unwrap<ExamSubmitResult>(
    await api.post(
      `${BASE}/competitions/${input.competitionId}/me/exam/submit`,
      {
        answers: input.answers.map((a) => ({ questionId: a.questionId, optionId: a.optionId })),
        ...(input.responseTimeMs != null ? { responseTimeMs: input.responseTimeMs } : {}),
      },
      idem(input.idempotencyKey),
    ),
  );
}
