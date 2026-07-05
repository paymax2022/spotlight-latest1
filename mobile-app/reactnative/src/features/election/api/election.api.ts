// ── Estate Election API surface ──────────────────────────────────────────────
// Two paths per function:
//   • USE_MOCK === true  → in-memory mock; "live" derived from the admin window
//   • USE_MOCK === false → real HTTP against /elections via api/client
// Signatures/types/hooks are identical for both. Flip EXPO_PUBLIC_ELECTION_USE_MOCK=false to go live.

import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { getRestrictionStatus } from '@/features/visitor/api/visitor.api';
import { ELECTION_API_BASE as B, USE_MOCK } from '../constants/election.constants';
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

// Resident-scoped: GET /api/v1/elections/active → the open election whose
// window is live now, or null (estate resolved server-side).
export async function getActiveElection(): Promise<Election | null> {
  if (USE_MOCK) {
    await latency(200);
    const live = elections.find((e) => isLiveNow(e));
    return live ? JSON.parse(JSON.stringify(live)) : null;
  }
  const { data } = await api.get<Election | null>(`${B}/active`);
  return data ?? null;
}

// Resident-scoped: GET /api/v1/elections → the caller's estate elections.
export async function listElections(): Promise<Election[]> {
  if (USE_MOCK) {
    await latency();
    return JSON.parse(JSON.stringify(elections));
  }
  const { data } = await api.get<Election[]>(B);
  return data ?? [];
}

// Resident-scoped: GET /api/v1/elections/{id} → a single election (must belong
// to the caller's estate).
export async function getElection(id: string): Promise<Election> {
  if (USE_MOCK) {
    await latency(250);
    const e = elections.find((x) => x.id === id);
    if (!e) throw new ElectionApiError('NOT_FOUND', 'Election not found.');
    return JSON.parse(JSON.stringify(e));
  }
  const { data } = await api.get<Election>(`${B}/${id}`);
  return data;
}

// Resident-scoped: GET /api/v1/elections/{id}/eligibility → VoterEligibility.
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
  const { data } = await api.get<VoterEligibility | { data: VoterEligibility }>(
    `${B}/${electionId}/eligibility`,
  );
  return (data as { data?: VoterEligibility }).data ?? (data as VoterEligibility);
}

// Resident-scoped: GET /api/v1/elections/{id}/ballot → the caller's MyBallot.
export async function getMyBallot(electionId: string): Promise<MyBallot> {
  if (USE_MOCK) {
    await latency(150);
    return ballots[electionId] ?? { electionId, choices: {} };
  }
  const { data } = await api.get<MyBallot>(`${B}/${electionId}/ballot`);
  return data ?? { electionId, choices: {} };
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
  // Resident-scoped: POST /api/v1/elections/{id}/vote, body { positionId,
  // candidateId }. The handler maps the single-position DB schema onto the
  // client's multi-position contract via a synthesized `${id}:main` position and
  // returns the full MyBallot (choices keyed by that position). We merge it into
  // the local cache so multi-position UIs keep a per-position "voted" state.
  const { data } = await api.post<MyBallot>(
    `${B}/${input.electionId}/vote`,
    { positionId: input.positionId, candidateId: input.candidateId },
    idem(input.idempotencyKey),
  );
  const prev = ballots[input.electionId] ?? { electionId: input.electionId, choices: {} };
  const merged: MyBallot = {
    electionId: input.electionId,
    choices: { ...prev.choices, ...(data?.choices ?? {}), [input.positionId]: input.candidateId },
    submittedAt: data?.submittedAt ?? prev.submittedAt,
  };
  ballots[input.electionId] = merged;
  return { ...merged, choices: { ...merged.choices } };
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
  // Resident-scoped: POST /api/v1/elections (estate admin). The handler flattens
  // all positions' candidateNames onto the single-position DB schema and returns
  // the mapped Election (single synthesized position). SCHEMA LIMITATION: the DB
  // is single-position, so a multi-position ballot collapses to one candidate
  // list until an election_positions table is added (see elections.service.ts).
  const { data: election } = await api.post<Election>(
    B,
    {
      title: input.title,
      description: input.description ?? '',
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      positions: input.positions.map((p) => ({
        title: p.title,
        seats: p.seats,
        candidateNames: p.candidateNames,
      })),
    },
    idem(input.idempotencyKey),
  );
  elections = [election, ...elections];
  return election;
}

// Resident-scoped: POST /api/v1/elections/{id}/publish (estate admin, after the
// window closes) → the updated Election with results published.
export async function publishResults(electionId: string): Promise<Election> {
  if (USE_MOCK) {
    await latency(400);
    const e = elections.find((x) => x.id === electionId);
    if (!e) throw new ElectionApiError('NOT_FOUND', 'Election not found.');
    if (!hasEnded(e)) throw new ElectionApiError('NOT_ENDED', 'Results can only be published after the election closes.');
    e.resultsPublished = true;
    e.status = 'results_published';
    return JSON.parse(JSON.stringify(e));
  }
  const { data } = await api.post<Election>(`${B}/${electionId}/publish`, {});
  return data;
}

/** Test helper — reset the in-memory stores (mock mode). */
export function __resetElectionStore(): void {
  elections = JSON.parse(JSON.stringify(seedElections));
  Object.keys(ballots).forEach((k) => delete ballots[k]);
}
