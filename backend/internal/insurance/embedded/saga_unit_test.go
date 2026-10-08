package embedded

import (
	"context"
	"errors"
	"testing"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/insurance/policy"
)

// Service-level convergence tests driven through the Repo seam — no database.
// They pin the ownership check and the terminal-state replay contract that
// replaced the old "any existing row ⇒ ACTIVE+Replayed" leak.

type fakeRepo struct {
	byLine  *EmbeddedProduct
	lineErr error
	pol     *policy.Policy
	found   bool
	err     error
}

func (f *fakeRepo) ResolveCoverByLine(_ context.Context, _ string) (*EmbeddedProduct, error) {
	return f.byLine, f.lineErr
}

func (f *fakeRepo) PolicyForSourceEvent(_ context.Context, _ string) (*policy.Policy, bool, error) {
	return f.pol, f.found, f.err
}

// wiredEnough builds a Service whose non-repo deps are non-nil but empty — the
// paths under test return before touching wallet/ledger/policyRepo.
func wiredEnough(repo Repo) *Service {
	svc := NewService(Deps{Repo: repo})
	svc.policyRepo = policy.NewRepository(nil)
	svc.wallet = wallet.NewService(nil, nil)
	svc.ledger = ledger.NewService(nil, nil)
	return svc
}

func TestHandle_ForeignOwnedSourceEvent_Conflict(t *testing.T) {
	svc := wiredEnough(&fakeRepo{
		pol:   &policy.Policy{ID: "p1", PolicyholderID: "someone-else", State: policy.StateActive},
		found: true,
	})
	_, err := svc.Handle(t.Context(), EmbeddedEvent{
		SourceEventID: "ev-1", EventType: "trip.started", UserID: "victim",
	})
	if !errors.Is(err, ErrSourceEventConflict) {
		t.Fatalf("foreign-owned source_event_id err = %v, want ErrSourceEventConflict", err)
	}
}

func TestHandle_OwnedActivePolicy_Replays(t *testing.T) {
	svc := wiredEnough(&fakeRepo{
		pol: &policy.Policy{
			ID:             "p1",
			PolicyholderID: "u1",
			ProductCode:    "prod.x",
			Provider:       "fake",
			State:          policy.StateActive,
		},
		found: true,
	})
	res, err := svc.Handle(t.Context(), EmbeddedEvent{
		SourceEventID: "ev-1", EventType: "trip.started", UserID: "u1",
	})
	if err != nil {
		t.Fatalf("replay err: %v", err)
	}
	if !res.Replayed || res.State != StateActive || res.PolicyID != "p1" {
		t.Fatalf("expected ACTIVE replay of p1, got %+v", res)
	}
}

// A policy in a terminal-no-cover state must report UNCOVERED, not ACTIVE —
// the old pre-check claimed ACTIVE for ANY existing row, so a member whose
// premium was reversed looked covered.
func TestHandle_OwnedVoidPolicy_UncoveredReplay(t *testing.T) {
	svc := wiredEnough(&fakeRepo{
		pol:   &policy.Policy{ID: "p1", PolicyholderID: "u1", State: policy.StateVoid},
		found: true,
	})
	res, err := svc.Handle(t.Context(), EmbeddedEvent{
		SourceEventID: "ev-1", EventType: "trip.started", UserID: "u1",
	})
	if err != nil {
		t.Fatalf("void replay err: %v", err)
	}
	if !res.Replayed || res.State != StateUncovered {
		t.Fatalf("expected UNCOVERED replay, got %+v", res)
	}
}

func TestHandle_UnmappedEvent_NoOp(t *testing.T) {
	svc := wiredEnough(&fakeRepo{}) // no anchor found, then no line mapping
	res, err := svc.Handle(t.Context(), EmbeddedEvent{
		SourceEventID: "s1", EventType: "unmapped.probe", UserID: "u1",
	})
	if err != nil {
		t.Fatalf("unmapped event err: %v", err)
	}
	if res.State != StateNoMapping {
		t.Fatalf("expected NO_MAPPING, got %+v", res)
	}
}

func TestHandle_MissingFields_Rejected(t *testing.T) {
	svc := wiredEnough(&fakeRepo{})
	for _, ev := range []EmbeddedEvent{
		{EventType: "trip.started", UserID: "u1"},                   // no src
		{SourceEventID: "s", UserID: "u1"},                          // no type
		{SourceEventID: "s", EventType: "trip.started"},             // no user
		{SourceEventID: "s", EventType: "trip.started", UserID: ""}, // empty user
	} {
		if _, err := svc.Handle(t.Context(), ev); err == nil {
			t.Fatalf("event %+v should be rejected", ev)
		}
	}
}

// The FSM guard must refuse a state jump the lifecycle forbids — advance()
// previously ran unguarded SetState.
func TestAdvance_RejectsIllegalTransition(t *testing.T) {
	svc := wiredEnough(&fakeRepo{})
	p := &policy.Policy{ID: "p1", State: policy.StateVoid, Version: 3}
	if err := svc.advance(t.Context(), p, policy.StateActive); err == nil {
		t.Fatal("VOID → ACTIVE should be an illegal transition")
	}
	if err := svc.advance(t.Context(), p, policy.StatePendingPayment); err == nil {
		t.Fatal("VOID → PENDING_PAYMENT should be an illegal transition")
	}
}
