package restaurant

import (
	"errors"
	"testing"
)

func TestFoodRefundKobo(t *testing.T) {
	const total = 100_000
	cases := []struct {
		name      string
		res       FoodDisputeResolution
		requested int64
		want      int64
		wantErr   bool
	}{
		{"full → total", FoodRefundFull, 0, total, false},
		{"partial mid", FoodRefundPartial, 40_000, 40_000, false},
		{"partial at 1", FoodRefundPartial, 1, 1, false},
		{"partial == total invalid (use full)", FoodRefundPartial, total, 0, true},
		{"partial > total invalid", FoodRefundPartial, total + 1, 0, true},
		{"partial 0 invalid (use dismissed)", FoodRefundPartial, 0, 0, true},
		{"partial negative invalid", FoodRefundPartial, -5, 0, true},
		{"replacement → 0", FoodReplacement, 0, 0, false},
		{"dismissed → 0", FoodDismissed, 0, 0, false},
		{"unknown → err", FoodDisputeResolution("bogus"), 0, 0, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := foodRefundKobo(c.res, c.requested, total)
			if c.wantErr {
				if !errors.Is(err, ErrDisputeInvalid) {
					t.Fatalf("want ErrDisputeInvalid, got %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != c.want {
				t.Fatalf("refund = %d, want %d", got, c.want)
			}
		})
	}
}

// TestFoodRefundNeverExceedsTotal is the money guard: whatever the resolution, the
// refund is in [0, total] — a dispute can never pay out more than the order was worth.
func TestFoodRefundNeverExceedsTotal(t *testing.T) {
	for _, total := range []int64{1, 5_000, 250_000} {
		for _, res := range []FoodDisputeResolution{FoodRefundFull, FoodReplacement, FoodDismissed} {
			got, err := foodRefundKobo(res, 0, total)
			if err != nil || got < 0 || got > total {
				t.Fatalf("res=%s total=%d → %d,%v out of range", res, total, got, err)
			}
		}
	}
}

func TestFoodDisputeResolvable(t *testing.T) {
	for _, ok := range []string{"open", "investigating"} {
		if !foodDisputeResolvable(ok) {
			t.Errorf("%q should be resolvable", ok)
		}
	}
	for _, no := range []string{"resolved", "closed", ""} {
		if foodDisputeResolvable(no) {
			t.Errorf("%q should NOT be resolvable", no)
		}
	}
}

func TestResolutionToDBFields(t *testing.T) {
	want := map[FoodDisputeResolution]string{
		FoodRefundFull:    "refund",
		FoodRefundPartial: "partial_refund",
		FoodReplacement:   "no_action",
		FoodDismissed:     "no_action",
	}
	for res, exp := range want {
		if got := resolutionToDBFields(res); got != exp {
			t.Errorf("resolutionToDBFields(%s) = %s, want %s", res, got, exp)
		}
	}
}

func TestValidateRaise(t *testing.T) {
	const (
		customer = "cust"
		owner    = "own"
		rider    = "rid"
	)
	longDesc := "the jollof rice was missing from my order entirely"

	// Party + good type + long description → allowed.
	if err := validateRaise(customer, customer, owner, rider, "wrong_item", longDesc); err != nil {
		t.Fatalf("valid raise rejected: %v", err)
	}
	if err := validateRaise(rider, customer, owner, rider, "non_delivery", longDesc); err != nil {
		t.Fatalf("rider raise rejected: %v", err)
	}
	// Stranger → forbidden.
	if err := validateRaise("stranger", customer, owner, rider, "wrong_item", longDesc); !errors.Is(err, ErrForbidden) {
		t.Fatalf("stranger raise: want ErrForbidden, got %v", err)
	}
	// Unknown type → invalid.
	if err := validateRaise(customer, customer, owner, rider, "aliens", longDesc); !errors.Is(err, ErrDisputeInvalid) {
		t.Fatalf("bad type: want ErrDisputeInvalid, got %v", err)
	}
	// Too-short description → invalid.
	if err := validateRaise(customer, customer, owner, rider, "other", "too short"); !errors.Is(err, ErrDisputeInvalid) {
		t.Fatalf("short description: want ErrDisputeInvalid, got %v", err)
	}
}
