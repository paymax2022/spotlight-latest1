// Package ladder is the deterministic promotion-ladder state machine (§12) that
// governs how far a trading strategy config is allowed to act. It is pure and
// dependency-free: the anti-overfitting validation verdict enters as a boolean
// (the caller runs validate.Evaluate), so this package imports nothing and can be
// exhaustively tested.
//
// The ladder is FORWARD-ONLY through gates and one rung at a time; DEMOTION (any
// step down, or straight to Halted) is always allowed because reducing exposure is
// always safe. Every gate is fail-closed: missing evidence, an unknown stage, a
// skipped rung, or a tripped circuit denies promotion.
//
// IMPORTANT: reaching Canary or Live is an ELIGIBILITY state only. This package
// (and this build) execute NOTHING — there is no venue adapter. Real capital moves
// only once execution is wired separately, behind the §12 ladder AND legal sign-off.
package ladder

import "fmt"

// Stage is a rung on the promotion ladder.
type Stage string

const (
	StageNotPromoted Stage = "not_promoted" // registered, no eligibility
	StagePaper       Stage = "paper"        // decisions recorded, nothing executed
	StageShadow      Stage = "shadow"       // run alongside a benchmark, no execution
	StageCanary      Stage = "canary"       // eligible for a tiny capped allocation (execution still stubbed)
	StageLive        Stage = "live"         // eligible for full allocation (still risk/committee-gated)
	StageHalted      Stage = "halted"       // stopped on breach; must re-enter at Paper
)

// rung orders the active promotion stages. Halted/NotPromoted are off-ladder.
var rung = map[Stage]int{StagePaper: 1, StageShadow: 2, StageCanary: 3, StageLive: 4}

func known(s Stage) bool {
	switch s {
	case StageNotPromoted, StagePaper, StageShadow, StageCanary, StageLive, StageHalted:
		return true
	}
	return false
}

// AllowsRealCapital reports whether a stage is an eligibility state for real
// capital. Even when true, THIS build executes nothing — see the package doc.
func AllowsRealCapital(s Stage) bool { return s == StageCanary || s == StageLive }

// Requirements are the promotion thresholds, fixed by policy before evaluation.
type Requirements struct {
	ShadowMinTrackRecordDays int // Paper → Shadow
	CanaryMinTrackRecordDays int // Shadow → Canary
	LiveMinTrackRecordDays   int // Canary → Live
}

// Evidence is everything a promotion decision is judged on. The caller assembles
// it from the validation harness, the recorded track record, and the sign-off
// records; this package never fetches any of it.
type Evidence struct {
	ValidationPassed bool   // validate.Evaluate verdict for the strategy
	TrackRecordDays  int    // days of recorded paper/shadow performance
	MakerID          string // admin who proposed the promotion
	CheckerID        string // admin who approved it (must differ from MakerID)
	RiskSignedOff    bool   // Risk officer authorization (Canary → Live)
	LegalSignedOff   bool   // legal authorization (Canary → Live)
	CircuitTripped   bool   // a live circuit breaker is currently tripped
}

// CanTransition reports whether moving from → to is allowed given the evidence and
// requirements, and if not, the reason. It is the single authority for both
// promotion and demotion. Fail-closed by default.
func CanTransition(from, to Stage, ev Evidence, req Requirements) (bool, string) {
	if !known(from) || !known(to) {
		return false, "unknown stage"
	}
	if from == to {
		return false, "no change: already in stage " + string(to)
	}

	// Demotion is always permitted (reducing exposure is safe): any active stage
	// may drop to Halted, and any step DOWN the rungs is allowed ungated.
	if to == StageHalted {
		if from == StageHalted || from == StageNotPromoted {
			return false, "nothing to halt from " + string(from)
		}
		return true, "halt"
	}
	if isStepDown(from, to) {
		return true, "de-risk step-down"
	}

	// From here on this is a forward promotion. A tripped circuit blocks ALL
	// promotion regardless of everything else.
	if ev.CircuitTripped {
		return false, "circuit breaker tripped — promotion blocked"
	}

	// Entering the ladder at Paper needs no capital and no track record.
	if to == StagePaper {
		if from == StageNotPromoted || from == StageHalted {
			return true, "enter paper"
		}
		return false, illegal(from, to)
	}

	// Every remaining promotion must climb exactly one rung.
	if rung[from] == 0 || rung[to] != rung[from]+1 {
		return false, illegal(from, to)
	}

	switch to {
	case StageShadow:
		if !ev.ValidationPassed {
			return false, "validation verdict must pass before Shadow"
		}
		if ev.TrackRecordDays < req.ShadowMinTrackRecordDays {
			return false, fmt.Sprintf("need %d track-record days for Shadow, have %d", req.ShadowMinTrackRecordDays, ev.TrackRecordDays)
		}
		return true, "promote to shadow"
	case StageCanary:
		if !ev.ValidationPassed {
			return false, "validation verdict must pass before Canary"
		}
		if ev.TrackRecordDays < req.CanaryMinTrackRecordDays {
			return false, fmt.Sprintf("need %d track-record days for Canary, have %d", req.CanaryMinTrackRecordDays, ev.TrackRecordDays)
		}
		if !makerChecker(ev) {
			return false, "Canary requires two distinct admins (maker≠checker)"
		}
		return true, "promote to canary"
	case StageLive:
		if !ev.ValidationPassed {
			return false, "validation verdict must pass before Live"
		}
		if ev.TrackRecordDays < req.LiveMinTrackRecordDays {
			return false, fmt.Sprintf("need %d track-record days for Live, have %d", req.LiveMinTrackRecordDays, ev.TrackRecordDays)
		}
		if !makerChecker(ev) {
			return false, "Live requires two distinct admins (maker≠checker)"
		}
		if !ev.RiskSignedOff {
			return false, "Live requires Risk sign-off"
		}
		if !ev.LegalSignedOff {
			return false, "Live requires legal sign-off"
		}
		return true, "promote to live"
	}
	return false, illegal(from, to)
}

// Transition applies CanTransition, returning the new stage or an error.
func Transition(from, to Stage, ev Evidence, req Requirements) (Stage, error) {
	if ok, reason := CanTransition(from, to, ev, req); !ok {
		return from, fmt.Errorf("ladder: %s → %s denied: %s", from, to, reason)
	}
	return to, nil
}

// ForceHalt is the always-available emergency stop from any active stage.
func ForceHalt(from Stage) (Stage, error) {
	return Transition(from, StageHalted, Evidence{}, Requirements{})
}

func isStepDown(from, to Stage) bool {
	return rung[from] != 0 && rung[to] != 0 && rung[to] < rung[from]
}

func makerChecker(ev Evidence) bool {
	return ev.MakerID != "" && ev.CheckerID != "" && ev.MakerID != ev.CheckerID
}

func illegal(from, to Stage) string {
	return fmt.Sprintf("illegal transition %s → %s (promote one rung at a time)", from, to)
}
