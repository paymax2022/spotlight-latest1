// Package makercheck is a pure, deterministic four-eyes (maker-checker) primitive
// for sensitive clinical/admin actions (test plan SC-004/SC-011): an action
// proposed by one actor (the maker) may be approved and executed only by a
// DIFFERENT authorized actor (the checker). It has no I/O — callers supply the two
// actor ids and (for the async flow) the current approval state.
package makercheck

import (
	"errors"
	"strings"
)

var (
	// ErrMissingActor is returned when the maker or checker id is empty — a
	// four-eyes control cannot be evaluated without both parties.
	ErrMissingActor = errors.New("makercheck: maker and checker are both required")
	// ErrSelfApproval is returned when the checker is the same person as the maker
	// (self-approval) — the second pair of eyes must be independent.
	ErrSelfApproval = errors.New("makercheck: the approver must be a different person than the maker (four-eyes)")
	// ErrNotPending is returned when an approval is attempted on a request that is
	// not awaiting approval (already approved/rejected/consumed).
	ErrNotPending = errors.New("makercheck: request is not pending approval")
	// ErrNotApproved is returned when execution is attempted before an independent
	// approval, or after the approval was already consumed.
	ErrNotApproved = errors.New("makercheck: request is not in an approved, executable state")
)

// Authorize is the core four-eyes decision: `checkerID` may approve/execute an
// action proposed by `makerID` only if both are present and they are different
// people (case- and space-insensitive). Returns nil when the pairing is allowed.
func Authorize(makerID, checkerID string) error {
	m, c := norm(makerID), norm(checkerID)
	if m == "" || c == "" {
		return ErrMissingActor
	}
	if strings.EqualFold(m, c) {
		return ErrSelfApproval
	}
	return nil
}

func norm(s string) string { return strings.TrimSpace(s) }

// State is the lifecycle of a maker-checker request (async two-step flow).
type State string

const (
	StatePending  State = "PENDING_APPROVAL" // proposed by the maker, awaiting an independent checker
	StateApproved State = "APPROVED"         // approved by a distinct checker; executable once
	StateRejected State = "REJECTED"         // declined by a checker
	StateConsumed State = "CONSUMED"         // the approved action has been executed (single-use)
)

// Approve records a checker's decision on a PENDING request. The checker must be a
// different person than the maker (Authorize). Returns the resulting state
// (StateApproved / StateRejected) or an error.
func Approve(makerID, checkerID string, cur State, approve bool) (State, error) {
	if cur != StatePending {
		return cur, ErrNotPending
	}
	if err := Authorize(makerID, checkerID); err != nil {
		return cur, err
	}
	if !approve {
		return StateRejected, nil
	}
	return StateApproved, nil
}

// Consume marks an APPROVED request executed exactly once (guards against a
// double-execution of the same approval). Returns StateConsumed or an error.
func Consume(cur State) (State, error) {
	if cur != StateApproved {
		return cur, ErrNotApproved
	}
	return StateConsumed, nil
}
