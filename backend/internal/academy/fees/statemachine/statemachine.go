// Package feesstatemachine holds the PURE, dependency-free guard logic for the
// EdTech School-Fees lifecycles (build-spec §3, invariants SF-1…SF-12).
//
// Nothing in this package touches a DB, a gin context, or the ledger. Every
// machine is a table-driven set of guarded transitions so that illegal states
// are STRUCTURALLY unreachable and the guards are trivially unit-testable
// (statemachine_test.go), exactly like the existing academy machines
// (academy/edupay, academy/assessment, academy/exam).
//
// Convention (mirrored from academy/exam/statemachine.go + academy/edupay):
//   - Each machine defines a `State` string type with snake_case const values
//     that match the DB CHECK constraint verbatim.
//   - Each machine exposes `CanTransition(from, to State) bool` (pure adjacency
//     check) and `Transition(from State, event Event) (State, error)` which
//     returns a typed error for illegal moves.
//   - Transitions are IDEMPOTENT via a distinct ErrAlreadyInState signal:
//     re-applying an event that would land on the state you are already in is
//     reported as ErrAlreadyInState (a no-op sentinel, NOT ErrIllegalTransition),
//     so callers can treat "already there" as success. This mirrors edupay's
//     approach of distinguishing an illegal move from a benign repeat.
//
// The one non-negotiable structural property lives in promotion.go: there is no
// table entry and no code path that reaches `applied` from anything other than
// `promotion_approved` (SF-3, release blocker).
package feesstatemachine

import "errors"

// Event is the trigger name for a guarded transition. Events are the only way to
// drive a machine forward — callers never set a target state directly (§3: "No
// direct field mutation anywhere in this module; all state changes are events").
type Event string

// Exported sentinel errors, mapped to stable snake_case codes / HTTP statuses by
// the service+handler layers that wrap these machines. Kept here (shared across
// all four machines) so error identity is consistent module-wide.
var (
	// ErrIllegalTransition is returned when from→(event) is not a permitted move.
	ErrIllegalTransition = errors.New("illegal_transition")
	// ErrTerminal is returned when a transition is attempted OUT of a terminal
	// state (a more specific flavour of an illegal transition).
	ErrTerminal = errors.New("terminal_state")
	// ErrApprovalRequired is the SF-3 guard: an attempt to reach `applied` (or
	// otherwise advance the promotion machine) without the required human
	// approval event. Distinct from ErrIllegalTransition so the promotion
	// bypass is observably its own failure mode.
	ErrApprovalRequired = errors.New("approval_required")
	// ErrAlreadyInState signals an idempotent no-op: the event would land on the
	// state the entity is already in. Callers should treat this as success and
	// skip re-emitting side effects. Not an error condition in the money sense.
	ErrAlreadyInState = errors.New("already_in_state")
)
