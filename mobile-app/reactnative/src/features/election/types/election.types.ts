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
  status: ElectionStatus;
  positions: ElectionPosition[];
  totalEligibleVoters: number;
  votesCast: number;        // ballots fully submitted
  resultsPublished: boolean;
  // How the poll was configured by the estate admin. `weighting` decides whether a
  // resident votes once in total or once per unit held; quorumType/tieBreak explain a
  // published result that has no winner (EST-UAT-0205/0223/0225/0230).
  governance?: {
    kind: 'binding' | 'poll';
    weighting: 'one_person_one_vote' | 'one_vote_per_unit';
    quorumType: 'none' | 'percent' | 'count';
    quorumValue: number;
    tieBreak: 'none' | 'earliest_candidate' | 'runoff';
    nominationOpensAt?: string | null;
    nominationClosesAt?: string | null;
    rollFrozenAt?: string | null;
    rulesLockedAt?: string | null;
  };
}

// Which candidate the current resident picked per position.
export interface MyBallot {
  electionId: string;
  choices: Record<string, string>;  // positionId -> candidateId, or 'sealed'
  submittedAt?: string;
  // A one_vote_per_unit receipt is keyed `${positionId}:${unitId}`, so the app needs the
  // voter's own holdings to show which ballots are still outstanding (EST-UAT-0205).
  weighted?: boolean;
  units?: { id: string; label: string; voted: boolean }[];
  outstanding?: number;
}

export interface VoterEligibility {
  eligible: boolean;
  reason?: string;          // e.g. "Outstanding dues" (payment-ineligible)
  reasons?: string[];
}

export interface CastVoteInput {
  electionId: string;
  positionId: string;
  candidateId: string;
  // Abstention is a ballot with no candidate: counted in turnout, credited to nobody
  // (EST-UAT-0221). Send abstain with an empty candidateId.
  abstain?: boolean;
  unitId?: string;          // required when governance.weighting is one_vote_per_unit
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
