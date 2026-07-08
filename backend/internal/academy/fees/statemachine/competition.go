package feesstatemachine

// ── Competition state machine (build-spec §3.4) ──────────────────────────────
//
//	draft → open_registration → registration_closed → in_progress
//	      → results_pending → completed → archived
//
// Strictly LINEAR and FORWARD-ONLY: no skips, no backward moves. Terminal:
// archived.
//
// Scoring-lock rule (§3.4): "Scoring writes lock the instant a competition
// enters results_pending — no LeaderboardEntry may be created or edited against
// a competition in that state or later." ScoringLocked(s) encodes exactly that
// boundary so the leaderboard writer can fail-closed.

// CompetitionState mirrors the Competition.status set (build-spec §2, §3.4).
type CompetitionState string

const (
	CompetitionDraft              CompetitionState = "draft"
	CompetitionOpenRegistration   CompetitionState = "open_registration"
	CompetitionRegistrationClosed CompetitionState = "registration_closed"
	CompetitionInProgress         CompetitionState = "in_progress"
	CompetitionResultsPending     CompetitionState = "results_pending"
	CompetitionCompleted          CompetitionState = "completed"
	CompetitionArchived           CompetitionState = "archived"
)

// Competition events — one per forward step, mirroring the linear pipeline.
const (
	EvCompOpenRegistration  Event = "open_registration"  // draft → open_registration
	EvCompCloseRegistration Event = "close_registration" // open_registration → registration_closed
	EvCompStart             Event = "start"              // registration_closed → in_progress
	EvCompPendResults       Event = "pend_results"       // in_progress → results_pending
	EvCompComplete          Event = "complete"           // results_pending → completed
	EvCompArchive           Event = "archive"            // completed → archived
)

// competitionOrder is the linear sequence; index position drives both the
// adjacency (each state may only advance to its immediate successor) and the
// ScoringLocked boundary.
var competitionOrder = []CompetitionState{
	CompetitionDraft,
	CompetitionOpenRegistration,
	CompetitionRegistrationClosed,
	CompetitionInProgress,
	CompetitionResultsPending,
	CompetitionCompleted,
	CompetitionArchived,
}

// competitionIndex maps a state to its position in competitionOrder (-1 if
// unknown). Built once at package init from the ordered slice so the two can
// never drift apart.
var competitionIndex = func() map[CompetitionState]int {
	m := make(map[CompetitionState]int, len(competitionOrder))
	for i, s := range competitionOrder {
		m[s] = i
	}
	return m
}()

// competitionEventTarget resolves the target state for an event, or "".
func competitionEventTarget(event Event) CompetitionState {
	switch event {
	case EvCompOpenRegistration:
		return CompetitionOpenRegistration
	case EvCompCloseRegistration:
		return CompetitionRegistrationClosed
	case EvCompStart:
		return CompetitionInProgress
	case EvCompPendResults:
		return CompetitionResultsPending
	case EvCompComplete:
		return CompetitionCompleted
	case EvCompArchive:
		return CompetitionArchived
	default:
		return ""
	}
}

// validCompetitionState reports whether s is a known competition state.
func validCompetitionState(s CompetitionState) bool {
	_, ok := competitionIndex[s]
	return ok
}

// CompetitionCanTransition reports whether from→to is a legal competition
// transition: to must be the immediate successor of from in the linear order.
// Pure. No skips, no backward moves.
func CompetitionCanTransition(from, to CompetitionState) bool {
	fi, okF := competitionIndex[from]
	ti, okT := competitionIndex[to]
	if !okF || !okT {
		return false
	}
	return ti == fi+1
}

// CompetitionTransition applies an event and returns the resulting state or a
// typed error. Firing an event whose target equals the current state is the
// idempotent no-op ErrAlreadyInState; any non-adjacent (skip/backward) move is
// ErrIllegalTransition; archived rejects everything as ErrTerminal.
func CompetitionTransition(from CompetitionState, event Event) (CompetitionState, error) {
	if !validCompetitionState(from) {
		return from, ErrIllegalTransition
	}
	if from == CompetitionArchived {
		return from, ErrTerminal
	}
	to := competitionEventTarget(event)
	if to == "" {
		return from, ErrIllegalTransition
	}
	if CompetitionCanTransition(from, to) {
		return to, nil
	}
	if to == from {
		return from, ErrAlreadyInState
	}
	return from, ErrIllegalTransition
}

// ScoringLocked reports whether scoring/leaderboard writes are locked for a
// competition in state s. Per §3.4 the lock engages the instant the competition
// enters results_pending and stays locked for every later state
// (results_pending, completed, archived). Returns false for all earlier states.
func ScoringLocked(s CompetitionState) bool {
	i, ok := competitionIndex[s]
	if !ok {
		return false
	}
	return i >= competitionIndex[CompetitionResultsPending]
}
