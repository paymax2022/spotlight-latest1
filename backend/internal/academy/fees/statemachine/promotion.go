package feesstatemachine

// ── Promotion state machine (build-spec §3.3, invariant SF-3 — RELEASE BLOCKER)
//
//	session_active     → results_finalized   (all required scores entered)
//	results_finalized  → promotion_computed  (engine proposes per pass-mark policy)
//	promotion_computed → promotion_reviewed  (REQUIRES a TeacherApproval event)
//	promotion_reviewed → promotion_approved  (REQUIRES an AdminApproval event)
//	promotion_approved → applied             (Class + FeeSchedule reassignment)
//
// SF-3 HARD RULE (release blocker, not a style preference): there is NO path
// from promotion_computed straight to `applied`, no path from promotion_computed
// to promotion_approved, and no path from promotion_reviewed to `applied`. The
// ONLY predecessor of `applied` is promotion_approved. This is enforced
// STRUCTURALLY, three ways at once:
//
//  1. The adjacency table below simply does not contain those edges — an
//     illegal target is not in the map, so it cannot resolve.
//  2. `applied` is produced by exactly one event (EvAdminApply) which is only
//     legal from promotion_approved; asked to reach `applied` from anything
//     else, PromotionTransition returns ErrApprovalRequired.
//  3. The two approvals are modelled as REQUIRED, TYPED events
//     (EvTeacherApproval, EvAdminApproval). You cannot advance to
//     promotion_reviewed / promotion_approved with any other event, so the two
//     human approvals cannot be skipped or forged by a generic "advance" call.
//
// See RequiresTwoApprovals() for the documented contract.

// PromotionState mirrors the PromotionRecord lifecycle (build-spec §3.3).
type PromotionState string

const (
	PromotionSessionActive    PromotionState = "session_active"
	PromotionResultsFinalized PromotionState = "results_finalized"
	PromotionComputed         PromotionState = "promotion_computed"
	PromotionReviewed         PromotionState = "promotion_reviewed"
	PromotionApproved         PromotionState = "promotion_approved"
	PromotionApplied          PromotionState = "applied"
)

// Promotion events. The two approval events are deliberately distinct so each
// human approval is its own irreducible gate (SF-3).
const (
	EvFinalizeResults  Event = "finalize_results" // session_active → results_finalized
	EvComputePromotion Event = "compute"          // results_finalized → promotion_computed
	EvTeacherApproval  Event = "teacher_approval" // promotion_computed → promotion_reviewed (approval #1)
	EvAdminApproval    Event = "admin_approval"   // promotion_reviewed → promotion_approved (approval #2)
	EvAdminApply       Event = "apply"            // promotion_approved → applied
)

// promotionTransitions is the legal, strictly-forward adjacency for the
// promotion SM. Crucially it contains NO computed→applied, NO computed→approved,
// and NO reviewed→applied edge — those illegal jumps are structurally absent.
var promotionTransitions = map[PromotionState]map[PromotionState]bool{
	PromotionSessionActive:    {PromotionResultsFinalized: true},
	PromotionResultsFinalized: {PromotionComputed: true},
	PromotionComputed:         {PromotionReviewed: true},
	PromotionReviewed:         {PromotionApproved: true},
	PromotionApproved:         {PromotionApplied: true},
	PromotionApplied:          {}, // terminal
}

// promotionEventTarget maps each event to the single state it can produce, plus
// the ONLY state from which that event is legal. This binds each event to one
// edge — an approval event fired from the wrong state cannot land anywhere.
var promotionEventEdge = map[Event]struct {
	from PromotionState
	to   PromotionState
}{
	EvFinalizeResults:  {PromotionSessionActive, PromotionResultsFinalized},
	EvComputePromotion: {PromotionResultsFinalized, PromotionComputed},
	EvTeacherApproval:  {PromotionComputed, PromotionReviewed},
	EvAdminApproval:    {PromotionReviewed, PromotionApproved},
	EvAdminApply:       {PromotionApproved, PromotionApplied},
}

// validPromotionState reports whether s is a known promotion state.
func validPromotionState(s PromotionState) bool {
	switch s {
	case PromotionSessionActive, PromotionResultsFinalized, PromotionComputed,
		PromotionReviewed, PromotionApproved, PromotionApplied:
		return true
	default:
		return false
	}
}

// PromotionCanTransition reports whether from→to is a legal promotion
// transition. Pure. Returns false for every SF-3-forbidden jump.
func PromotionCanTransition(from, to PromotionState) bool {
	targets, ok := promotionTransitions[from]
	if !ok {
		return false
	}
	return targets[to]
}

// PromotionTransition applies an event and returns the resulting state or a
// typed error.
//
// SF-3 error semantics: any attempt to reach `applied` (event EvAdminApply) from
// a state other than promotion_approved returns ErrApprovalRequired — NOT a
// generic illegal transition — so the bypass is observably its own failure. The
// same ErrApprovalRequired guards the two approval steps: firing EvTeacherApproval
// or EvAdminApproval from the wrong state means a required approval has not yet
// been granted in order.
func PromotionTransition(from PromotionState, event Event) (PromotionState, error) {
	if !validPromotionState(from) {
		return from, ErrIllegalTransition
	}
	if from == PromotionApplied {
		return from, ErrTerminal
	}
	edge, known := promotionEventEdge[event]
	if !known {
		return from, ErrIllegalTransition
	}
	// The event is legal only from its single defined predecessor state.
	if from != edge.from {
		// Approval-gated events (the two approvals and the final apply) surface
		// the SF-3-specific signal so callers can distinguish "you skipped an
		// approval" from an unrelated illegal move.
		switch event {
		case EvTeacherApproval, EvAdminApproval, EvAdminApply:
			return from, ErrApprovalRequired
		default:
			return from, ErrIllegalTransition
		}
	}
	// Defence in depth: the table must agree with the event edge.
	if !PromotionCanTransition(from, edge.to) {
		return from, ErrIllegalTransition
	}
	return edge.to, nil
}

// RequiresTwoApprovals documents and asserts SF-3: reaching `applied` requires
// two distinct human approvals — a class_teacher approval (computed→reviewed)
// and a head_teacher/admin approval (reviewed→approved) — before the final
// apply (approved→applied). It always returns true; it exists so the invariant
// is discoverable in code and can be referenced by callers/tests as the single
// source of truth that promotion_computed can NEVER short-circuit to applied.
func RequiresTwoApprovals() bool { return true }
