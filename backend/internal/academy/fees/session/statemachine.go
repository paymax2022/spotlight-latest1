package feessession

import "spotlight/backend/go-common/fsm"

//	active → closed      (session ends; scores/promotions finalized)
//	closed → archived    (moved to cold storage; read-only)
//	active → archived    (direct archive, e.g. mistakenly-created session)
//	Terminal: archived
// PURE, dependency-free guard (unit-tested in session_test.go), mirroring the shared
// feesstatemachine per-machine style. Kept in-package because the shared statemachine
// package (T0.3) defines invoice/vault/promotion/competition machines only and MUST NOT
// be modified by this task; the session lifecycle is small and lives with its entity.

var sessionTransitions = fsm.Table[SessionStatus]{
	SessionActive:   fsm.Set(SessionClosed, SessionArchived),
	SessionClosed:   fsm.Set(SessionArchived),
	SessionArchived: {}, // terminal
}

func validSessionStatus(s SessionStatus) bool {
	switch s {
	case SessionActive, SessionClosed, SessionArchived:
		return true
	default:
		return false
	}
}

// SessionCanTransition reports whether from→to is a legal session status move. Pure.
func SessionCanTransition(from, to SessionStatus) bool {
	return sessionTransitions.Can(from, to)
}

// SessionTransition validates from→to and returns the target status or a typed error.
// Unknown target ⇒ ErrInvalidStatus; known-but-illegal ⇒ ErrIllegalTransition.
func SessionTransition(from, to SessionStatus) (SessionStatus, error) {
	if !validSessionStatus(to) {
		return from, ErrInvalidStatus
	}
	if !validSessionStatus(from) {
		return from, ErrIllegalTransition
	}
	if SessionCanTransition(from, to) {
		return to, nil
	}
	return from, ErrIllegalTransition
}
