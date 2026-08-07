package makercheck

import (
	"errors"
	"testing"
)

// TS-15 SC-004/SC-011: maker-checker (four-eyes) on sensitive actions. Pure,
// deterministic assertions — no DB.

func TestAuthorizeRejectsSelfApproval(t *testing.T) {
	if err := Authorize("alice", "alice"); !errors.Is(err, ErrSelfApproval) {
		t.Fatalf("self-approval must be rejected, got %v", err)
	}
	// Case/space-insensitive: the same person can't slip through with different casing.
	if err := Authorize("Alice", "  alice "); !errors.Is(err, ErrSelfApproval) {
		t.Fatalf("normalized self-approval must be rejected, got %v", err)
	}
}

func TestAuthorizeRequiresBothActors(t *testing.T) {
	for _, c := range [][2]string{{"", "bob"}, {"alice", ""}, {"", ""}} {
		if err := Authorize(c[0], c[1]); !errors.Is(err, ErrMissingActor) {
			t.Fatalf("missing actor must be rejected for %v, got %v", c, err)
		}
	}
}

func TestAuthorizeAllowsDistinctChecker(t *testing.T) {
	if err := Authorize("alice", "bob"); err != nil {
		t.Fatalf("a distinct checker must be allowed, got %v", err)
	}
}

// The async flow: a pending request needs an independent approval; self-approval
// is rejected; a rejected/approved request can't be re-approved.
func TestApproveFlow(t *testing.T) {
	// self-approval on a pending request is rejected.
	if _, err := Approve("alice", "alice", StatePending, true); !errors.Is(err, ErrSelfApproval) {
		t.Fatalf("self-approval must fail, got %v", err)
	}
	// distinct checker approves.
	st, err := Approve("alice", "bob", StatePending, true)
	if err != nil || st != StateApproved {
		t.Fatalf("distinct approval should yield APPROVED, got %s %v", st, err)
	}
	// can't approve again (not pending).
	if _, err := Approve("alice", "carol", st, true); !errors.Is(err, ErrNotPending) {
		t.Fatalf("re-approval must fail, got %v", err)
	}
	// reject path.
	if st, _ := Approve("alice", "bob", StatePending, false); st != StateRejected {
		t.Fatalf("reject should yield REJECTED, got %s", st)
	}
}

// An approved action executes exactly once.
func TestConsumeSingleUse(t *testing.T) {
	st, err := Consume(StateApproved)
	if err != nil || st != StateConsumed {
		t.Fatalf("approved request should consume once, got %s %v", st, err)
	}
	if _, err := Consume(StateConsumed); !errors.Is(err, ErrNotApproved) {
		t.Fatalf("double execution must be rejected, got %v", err)
	}
	if _, err := Consume(StatePending); !errors.Is(err, ErrNotApproved) {
		t.Fatalf("executing an unapproved request must fail, got %v", err)
	}
}
