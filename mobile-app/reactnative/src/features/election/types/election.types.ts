// ── Estate Election — Type Contract ──────────────────────────────────────────
// Admin sets the election window (startsAt/endsAt). The app derives "live" from
// the current time, so the resident header banner switches on automatically at
// the start date/time and off at the end.

export type ElectionStatus = 'scheduled' | 'live' | 'closed' | 'results_published';

export interface Candidate {
  id: string;
  name: string;
  positionId: string;
  manifesto?: string;
  photoRef?: string;
  votes: number;
}

export interface ElectionPosition {
  id: string;
  title: string;            // e.g. "Chairperson"
  seats: number;            // number of winners
  candidates: Candidate[];
}

export interface Election {
  id: string;
  estateId: string;
  title: string;
  description?: string;
  startsAt: string;         // ISO — admin-set start
  endsAt: string;           // ISO — admin-set end
  status: ElectionStatus;   // server status; UI also derives live from the window
  positions: ElectionPosition[];
  totalEligibleVoters: number;
  votesCast: number;        // ballots fully submitted
  resultsPublished: boolean;
}

// Which candidate the current resident picked per position.
export interface MyBallot {
  electionId: string;
  choices: Record<string, string>;  // positionId -> candidateId
  submittedAt?: string;
}

export interface VoterEligibility {
  eligible: boolean;
  reason?: string;          // e.g. "Outstanding dues" (payment-ineligible)
}

export interface CastVoteInput {
  electionId: string;
  positionId: string;
  candidateId: string;
  idempotencyKey: string;
}

// Admin election setup (sets the window + ballot).
export interface CreateElectionPositionInput {
  title: string;
  seats: number;
  candidateNames: string[];
}

export interface CreateElectionInput {
  title: string;
  description?: string;
  startsAt: string;     // ISO
  endsAt: string;       // ISO
  positions: CreateElectionPositionInput[];
  idempotencyKey: string;
}
