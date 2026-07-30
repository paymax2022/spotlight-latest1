package healthlab

import (
	"errors"
	"math"
	"testing"
)

// TS-13 Payments: PM-008/PM-011 (minor-unit exactness, no drift/overflow) and
// PM-005 (refund single/idempotent via the terminal REFUNDED state). Pure,
// deterministic assertions — no DB, no floats.

func TestSumLineKoboExact(t *testing.T) {
	got, err := sumLineKobo([]int64{100_00, 2_50, 1})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != 100_00+2_50+1 {
		t.Fatalf("sum = %d, want %d", got, 100_00+2_50+1)
	}
	if empty, err := sumLineKobo(nil); err != nil || empty != 0 {
		t.Fatalf("empty sum = %d, err %v; want 0, nil", empty, err)
	}
}

// PM-011: a negative line price cannot silently offset the cart total.
func TestSumLineKoboRejectsNegative(t *testing.T) {
	if _, err := sumLineKobo([]int64{100, -1}); !errors.Is(err, ErrNegativeLinePrice) {
		t.Fatalf("negative line must be rejected, got %v", err)
	}
}

// PM-008: integer minor-unit math must not wrap around (overflow guarded).
func TestSumLineKoboOverflow(t *testing.T) {
	if _, err := sumLineKobo([]int64{math.MaxInt64, 1}); !errors.Is(err, ErrTotalOverflow) {
		t.Fatalf("overflow must be rejected, got %v", err)
	}
	if got, err := sumLineKobo([]int64{math.MaxInt64}); err != nil || got != math.MaxInt64 {
		t.Fatalf("max single value should pass exactly: got %d err %v", got, err)
	}
}

// PM-005: a cancellation refunds once — REFUNDED is terminal, so no re-refund, and
// the refund edge is only reachable from CANCELLED.
func TestRefundIsSingleAndTerminal(t *testing.T) {
	if !canTransitionOrder(StateCancelled, StateRefunded) {
		t.Fatal("a cancelled order must be refundable")
	}
	if len(allowedOrderTransitions[StateRefunded]) != 0 {
		t.Fatal("REFUNDED must be terminal (no double refund / re-transition)")
	}
	// Refund is not reachable from a released/closed order (funds already settled).
	for _, from := range []OrderState{StateReleased, StateClosed, StateProcessing, StateResultReady} {
		if canTransitionOrder(from, StateRefunded) {
			t.Fatalf("must not refund from %s", from)
		}
	}
}

// PM-004 (state half): a charged order can only be cancelled/refunded before the
// sample enters the lab pipeline; once accessioned the money path is committed.
func TestCancelOnlyPreCollection(t *testing.T) {
	pre := map[OrderState]bool{
		StateCreated: true, StateScheduled: true, StateSampleCollected: true,
		StateAccessioned: false, StateProcessing: false, StateResultReady: false,
		StateReleased: false, StateClosed: false,
	}
	for st, want := range pre {
		if got := isPreCollection(st); got != want {
			t.Errorf("isPreCollection(%s) = %v, want %v", st, got, want)
		}
	}
}
