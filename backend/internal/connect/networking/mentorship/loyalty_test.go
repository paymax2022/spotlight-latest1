package connectmentor

import (
	"context"
	"testing"
)

// fakeAwarder models the Paymax Black emit seam. It mimics the points-ledger
// idempotency: a repeat of the SAME reference is a no-op net award (dedup by ref),
// while recording every raw call so we can assert call shape.
type fakeAwarder struct {
	calls  []award // every raw AwardFor call
	netRef map[string]award
}

type award struct{ userID, module, trigger, ref string }

func newFakeAwarder() *fakeAwarder { return &fakeAwarder{netRef: map[string]award{}} }

func (f *fakeAwarder) AwardFor(_ context.Context, userID, module, trigger, ref string) error {
	a := award{userID, module, trigger, ref}
	f.calls = append(f.calls, a)
	if _, seen := f.netRef[ref]; !seen { // idempotent: distinct references only
		f.netRef[ref] = a
	}
	return nil
}

// PN-8: on COMPLETED, mentorship_complete emits for BOTH parties, exactly once each,
// with distinct references (idempotent). repo is nil here so the emit seam is
// exercised without a DB (the log write is skipped).
func TestEmitCompletion_BothPartiesExactlyOnce(t *testing.T) {
	fa := newFakeAwarder()
	svc := NewService(nil, fa, nil)
	m := &MentorshipMatch{ID: "match-9", MentorID: "mentor-A", MenteeID: "mentee-B", State: string(StateCompleted)}

	svc.emitCompletion(context.Background(), m)

	if len(fa.netRef) != 2 {
		t.Fatalf("expected 2 distinct loyalty emits (mentor+mentee), got %d", len(fa.netRef))
	}
	byUser := map[string]award{}
	for _, a := range fa.netRef {
		if a.module != LoyaltyModule {
			t.Errorf("emit module=%q want %q", a.module, LoyaltyModule)
		}
		if a.trigger != TriggerMentorshipDone {
			t.Errorf("emit trigger=%q want %q", a.trigger, TriggerMentorshipDone)
		}
		byUser[a.userID] = a
	}
	if _, ok := byUser["mentor-A"]; !ok {
		t.Error("mentor did not receive a mentorship_complete emit")
	}
	if _, ok := byUser["mentee-B"]; !ok {
		t.Error("mentee did not receive a mentorship_complete emit")
	}
	if byUser["mentor-A"].ref == byUser["mentee-B"].ref {
		t.Error("mentor and mentee emits must use DISTINCT references")
	}

	// Idempotency: a replayed completion (e.g. a retried request) must not
	// double-award — distinct references + ledger idempotency keep the NET award at
	// exactly one per party even though raw calls doubled.
	svc.emitCompletion(context.Background(), m)
	if len(fa.calls) != 4 {
		t.Fatalf("expected 4 raw calls after replay, got %d", len(fa.calls))
	}
	if len(fa.netRef) != 2 {
		t.Fatalf("replay double-awarded: expected 2 net emits, got %d", len(fa.netRef))
	}
}
