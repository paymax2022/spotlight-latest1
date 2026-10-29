//   • USE_MOCK === false → real HTTP against /elections via api/client
// Signatures/types/hooks are identical for both. Defaults to live; set EXPO_PUBLIC_ELECTION_USE_MOCK=true for fixtures.

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
import { isLiveNow } from '../utils/electionFormatters';
import { seedElections } from './election.mock';

let elections: Election[] = JSON.parse(JSON.stringify(seedElections));
const ballots: Record<string, MyBallot> = {};

const latency = (ms = 350) => new Promise((r) => setTimeout(r, ms));

// castVote / createElection / publishResults each have a live route handler
// (frontend-web/app/api/v1/elections/**), so fixture mode refuses loudly instead of
// reporting a ballot cast, election created or result published that never reached
// the database — mirrors frontend-admin's crowdfundingAdminService.ts
// NOT_IN_FIXTURE_MODE pattern.
const notInFixtureMode = (action: string) =>
  new Error(`${action} is unavailable in fixture mode: this app will not report a write it did not perform. Set EXPO_PUBLIC_ELECTION_USE_MOCK=false to send this against the live backend.`);
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
  if (USE_MOCK) throw notInFixtureMode('Casting a vote');
  // Resident-scoped: POST /api/v1/elections/{id}/vote, body { positionId,
  // candidateId, unitId?, abstain? }. The handler maps the single-position DB schema onto
  // the client's multi-position contract via a synthesized `${id}:main` position and
  // returns the full MyBallot (choices keyed by that position, suffixed with the unit for
  // a per-unit ballot). We merge it into the local cache so multi-position UIs keep a
  // per-position "voted" state — an abstention records the sealed marker, never a
  // candidate.
  const { data } = await api.post<MyBallot>(
    `${B}/${input.electionId}/vote`,
    {
      positionId: input.positionId,
      candidateId: input.abstain ? '' : input.candidateId,
      abstain: input.abstain === true,
      ...(input.unitId ? { unitId: input.unitId } : {}),
    },
    idem(input.idempotencyKey),
  );
  const prev = ballots[input.electionId] ?? { electionId: input.electionId, choices: {} };
  const key = input.unitId ? `${input.positionId}:${input.unitId}` : input.positionId;
  const merged: MyBallot = {
    electionId: input.electionId,
    choices: { ...prev.choices, ...(data?.choices ?? {}), [key]: input.abstain ? 'sealed' : input.candidateId },
    submittedAt: data?.submittedAt ?? prev.submittedAt,
    weighted: data?.weighted ?? prev.weighted,
    units: data?.units ?? prev.units,
    outstanding: data?.outstanding ?? prev.outstanding,
  };
  ballots[input.electionId] = merged;
  return { ...merged, choices: { ...merged.choices } };
}

// Admin: create/schedule an election. Status is derived from the window on read.
export async function createElection(input: CreateElectionInput): Promise<Election> {
  if (USE_MOCK) throw notInFixtureMode('Creating an election');
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
  if (USE_MOCK) throw notInFixtureMode('Publishing results');
  const { data } = await api.post<Election>(`${B}/${electionId}/publish`, {});
  return data;
}

/** Test helper — reset the in-memory stores (mock mode). */
export function __resetElectionStore(): void {
  elections = JSON.parse(JSON.stringify(seedElections));
  Object.keys(ballots).forEach((k) => delete ballots[k]);
}
