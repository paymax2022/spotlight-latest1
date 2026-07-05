// ── Estate Election API surface ──────────────────────────────────────────────
// Two paths per function:
//   • USE_MOCK === true  → in-memory mock; "live" derived from the admin window
//   • USE_MOCK === false → real HTTP against /elections via api/client
// Signatures/types/hooks are identical for both. Flip EXPO_PUBLIC_ELECTION_USE_MOCK=false to go live.

import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { getRestrictionStatus } from '@/features/visitor/api/visitor.api';
import { ELECTION_API_BASE as B, DEFAULT_ESTATE_ID, USE_MOCK } from '../constants/election.constants';
import type {
  CastVoteInput,
  CreateElectionInput,
  Election,
  MyBallot,
  VoterEligibility,
} from '../types/election.types';
import { hasEnded, isLiveNow } from '../utils/electionFormatters';
import { seedElections } from './election.mock';

let elections: Election[] = JSON.parse(JSON.stringify(seedElections));
const ballots: Record<string, MyBallot> = {};

const latency = (ms = 350) => new Promise((r) => setTimeout(r, ms));
const idem = (key?: string) => ({ headers: { 'Idempotency-Key': key ?? generateIdempotencyKey() } });

export class ElectionApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'ElectionApiError';
  }
}

// MISSING BACKEND ENDPOINT: no GET /estate/:id/elections/active exists (the
// estate handler only exposes create/vote/results/eligibility — no list or
// "currently open" read). Falls back to the mock store so the banner still
// derives from the window client-side.
export async function getActiveElection(): Promise<Election | null> {
  await latency(200);
  const live = elections.find((e) => isLiveNow(e));
  return live ? JSON.parse(JSON.stringify(live)) : null;
}

// MISSING BACKEND ENDPOINT: no GET /estate/:id/elections (list) exists.
export async function listElections(): Promise<Election[]> {
  await latency();
  return JSON.parse(JSON.stringify(elections));
}

// MISSING BACKEND ENDPOINT: no GET /estate/:id/elections/:electionId (single
// election read) exists — the backend only exposes GetResults (post-close).
export async function getElection(id: string): Promise<Election> {
  await latency(250);
  const e = elections.find((x) => x.id === id);
  if (!e) throw new ElectionApiError('NOT_FOUND', 'Election not found.');
  return JSON.parse(JSON.stringify(e));
}

// Backend: GET /api/finance/estate/:id/elections/:electionId/eligibility →
// { data: { eligible, reason? } }.
export async function getVoterEligibility(electionId: string): Promise<VoterEligibility> {
  if (USE_MOCK) {
    // Wired to payment standing: residents under a hard payment ban are
    // payment-ineligible to vote (elections PRD). Reads the same restriction
    // status the Visitor module consumes from Payments.
    try {
      const r = await getRestrictionStatus();
      if (r.state === 'hard_ban') {
        return { eligible: false, reason: 'Voting is disabled while you have outstanding estate dues. Settle your balance to vote.' };
      }
    } catch {
      /* if standing can't be read, fail open so genuine voters aren't blocked */
    }
    return { eligible: true };
  }
  const { data } = await api.get<{ data: VoterEligibility }>(
    `${B}/${DEFAULT_ESTATE_ID}/elections/${electionId}/eligibility`,
  );
  return (data as unknown as { data?: VoterEligibility }).data ?? (data as unknown as VoterEligibility);
}

// MISSING BACKEND ENDPOINT: no GET .../ballot (the resident's own picks so
// far) exists — CastVote is write-only server-side. Falls back to the local
// ballot cache so the UI can still show "already voted" state client-side.
export async function getMyBallot(electionId: string): Promise<MyBallot> {
  await latency(150);
  return ballots[electionId] ?? { electionId, choices: {} };
}

export async function castVote(input: CastVoteInput): Promise<MyBallot> {
  if (USE_MOCK) {
    await latency(450);
    const election = elections.find((e) => e.id === input.electionId);
    if (!election) throw new ElectionApiError('NOT_FOUND', 'Election not found.');
    if (!isLiveNow(election)) throw new ElectionApiError('CLOSED', 'Voting is not open for this election.');

    const ballot = ballots[input.electionId] ?? { electionId: input.electionId, choices: {} };
    if (ballot.choices[input.positionId]) {
      throw new ElectionApiError('ALREADY_VOTED', 'You have already voted for this position.');
    }

    const position = election.positions.find((p) => p.id === input.positionId);
    const candidate = position?.candidates.find((c) => c.id === input.candidateId);
    if (!position || !candidate) throw new ElectionApiError('INVALID', 'Invalid candidate selection.');

    candidate.votes += 1;
    ballot.choices[input.positionId] = input.candidateId;

    // Count a fully-submitted ballot once the resident has voted every position.
    const complete = election.positions.every((p) => ballot.choices[p.id]);
    if (complete && !ballot.submittedAt) {
      ballot.submittedAt = new Date().toISOString();
      election.votesCast += 1;
    }
    ballots[input.electionId] = ballot;
    return JSON.parse(JSON.stringify(ballot));
  }
  // MODEL MISMATCH: the backend's estate election is single-position (one
  // flat candidate list per election — CastVoteRequest only carries
  // candidate_id, no position_id) while the mobile Election/MyBallot model is
  // multi-position (a ballot with one choice per ElectionPosition). Until the
  // backend supports multi-position elections, we send candidate_id only and
  // record the choice against the given positionId purely client-side so the
  // multi-position UI still renders a per-position "voted" state.
  await api.post(
    `${B}/${DEFAULT_ESTATE_ID}/elections/${input.electionId}/vote`,
    { candidate_id: input.candidateId },
    idem(input.idempotencyKey),
  );
  const ballot = ballots[input.electionId] ?? { electionId: input.electionId, choices: {} };
  ballot.choices[input.positionId] = input.candidateId;
  ballots[input.electionId] = ballot;
  return { ...ballot, choices: { ...ballot.choices } };
}

// Admin: create/schedule an election. Status is derived from the window on read.
export async function createElection(input: CreateElectionInput): Promise<Election> {
  if (USE_MOCK) {
    await latency(600);
    if (!input.title.trim()) throw new ElectionApiError('VALIDATION', 'Election title is required.');
    if (+new Date(input.endsAt) <= +new Date(input.startsAt)) {
      throw new ElectionApiError('VALIDATION', 'End time must be after the start time.');
    }
    const validPositions = input.positions
      .map((p) => ({ ...p, title: p.title.trim(), candidateNames: p.candidateNames.map((n) => n.trim()).filter(Boolean) }))
      .filter((p) => p.title && p.candidateNames.length >= 2);
    if (validPositions.length === 0) {
      throw new ElectionApiError('VALIDATION', 'Add at least one position with two or more candidates.');
    }
    const id = `elec_${Date.now()}`;
    const election: Election = {
      id,
      estateId: 'est_amber_court',
      title: input.title.trim(),
      description: input.description?.trim() || undefined,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      status: 'scheduled',
      totalEligibleVoters: 142,
      votesCast: 0,
      resultsPublished: false,
      positions: validPositions.map((p, pi) => ({
        id: `pos_${id}_${pi}`,
        title: p.title,
        seats: Math.max(1, p.seats),
        candidates: p.candidateNames.map((name, ci) => ({
          id: `cand_${id}_${pi}_${ci}`,
          positionId: `pos_${id}_${pi}`,
          name,
          votes: 0,
        })),
      })),
    };
    elections = [election, ...elections];
    return JSON.parse(JSON.stringify(election));
  }
  // MODEL MISMATCH: backend CreateElectionRequest is single-position
  // (title/description/starts_at/ends_at/candidates: Candidate[] — no nested
  // "positions"). We flatten the mobile's first position's candidates into
  // the single candidate list the backend supports; multi-position elections
  // are NOT representable server-side yet (MISSING: multi-position election
  // support). The response is also just the created election row, not the
  // full nested-positions shape, so we keep constructing the local shape.
  const firstPosition = input.positions[0];
  const candidateNames = firstPosition?.candidateNames ?? [];
  const res = await api.post<Record<string, unknown>>(
    `${B}/${DEFAULT_ESTATE_ID}/elections`,
    {
      title: input.title,
      description: input.description ?? '',
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      candidates: candidateNames.map((name) => ({ name })),
    },
    idem(input.idempotencyKey),
  );
  const created = res.data ?? {};
  const id = String(created.id ?? `elec_${Date.now()}`);
  const election: Election = {
    id,
    estateId: DEFAULT_ESTATE_ID,
    title: input.title,
    description: input.description,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    status: 'scheduled',
    totalEligibleVoters: 0,
    votesCast: 0,
    resultsPublished: false,
    positions: [
      {
        id: `pos_${id}_0`,
        title: firstPosition?.title ?? 'Position',
        seats: Math.max(1, firstPosition?.seats ?? 1),
        candidates: candidateNames.map((name, ci) => ({
          id: `cand_${id}_0_${ci}`,
          positionId: `pos_${id}_0`,
          name,
          votes: 0,
        })),
      },
    ],
  };
  elections = [election, ...elections];
  return election;
}

// MISSING BACKEND ENDPOINT: no POST /elections/:id/publish exists — the
// backend only exposes GetResults (a read), with no "publish" state
// transition. Falls back to the mock store's publish behaviour.
export async function publishResults(electionId: string): Promise<Election> {
  await latency(400);
  const e = elections.find((x) => x.id === electionId);
  if (!e) throw new ElectionApiError('NOT_FOUND', 'Election not found.');
  if (!hasEnded(e)) throw new ElectionApiError('NOT_ENDED', 'Results can only be published after the election closes.');
  e.resultsPublished = true;
  e.status = 'results_published';
  return JSON.parse(JSON.stringify(e));
}

/** Test helper — reset the in-memory stores (mock mode). */
export function __resetElectionStore(): void {
  elections = JSON.parse(JSON.stringify(seedElections));
  Object.keys(ballots).forEach((k) => delete ballots[k]);
}
