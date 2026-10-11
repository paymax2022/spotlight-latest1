package cryptoprov

import (
	"errors"
	"fmt"
)

// SwapState is the lifecycle of a crypto swap in our ledger and database.
type SwapState string

const (
	SwapStateQuoted      SwapState = "quoted"
	SwapStateConfirming  SwapState = "confirming"
	SwapStateProcessing  SwapState = "processing"
	SwapStateCompleted   SwapState = "completed"
	SwapStateFailed      SwapState = "failed"
	SwapStateExpired     SwapState = "expired"
	SwapStateNeedsReview SwapState = "needs_review"
)

// ErrInvalidTransition is returned when a swap state change is not allowed.
var ErrInvalidTransition = errors.New("cryptoprov: invalid swap state transition")

// swapTransitions lists every allowed move. Terminal states have no outgoing edges,
// so a terminal swap can never regress. needs_review is resolved only forward.
var swapTransitions = map[SwapState][]SwapState{
	SwapStateQuoted:      {SwapStateConfirming, SwapStateExpired},
	SwapStateConfirming:  {SwapStateProcessing, SwapStateFailed, SwapStateNeedsReview},
	SwapStateProcessing:  {SwapStateCompleted, SwapStateFailed, SwapStateNeedsReview},
	SwapStateNeedsReview: {SwapStateCompleted, SwapStateFailed},
}

// IsTerminal reports whether a swap has finished and must not change again.
func (s SwapState) IsTerminal() bool {
	switch s {
	case SwapStateCompleted, SwapStateFailed, SwapStateExpired:
		return true
	}
	return false
}

// CanTransition reports whether from -> to is allowed.
func CanTransition(from, to SwapState) bool {
	for _, next := range swapTransitions[from] {
		if next == to {
			return true
		}
	}
	return false
}

// Transition returns to if the move is allowed, otherwise ErrInvalidTransition.
// The database layer must pair this with a conditional UPDATE ... WHERE status=from,
// so two racing writers (user, webhook, reconciler) cannot both win.
func Transition(from, to SwapState) (SwapState, error) {
	if !CanTransition(from, to) {
		return from, fmt.Errorf("%w: %s -> %s", ErrInvalidTransition, from, to)
	}
	return to, nil
}
