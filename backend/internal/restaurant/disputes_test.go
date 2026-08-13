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

// TestPlatformRefundableKobo: the platform-funded dispute refund is computed on the
// order total LESS the tip (ADR-030). Disputes resolve only on DELIVERED orders, so the
// rider has already been paid 100% of the tip and the platform never held it.
func TestPlatformRefundableKobo(t *testing.T) {
	cases := []struct {
		name       string
		total, tip int64
		want       int64
	}{
		{"untipped → whole total", 100_000, 0, 100_000},
		{"tipped → total less tip", 1_066_285, 50_000, 1_016_285},
		{"negative tip ignored", 100_000, -1, 100_000},
		// Only reachable if tip_kobo and total_kobo have diverged; must fail closed to a
		// zero basis rather than produce a negative refund.
		{"tip == total → no basis", 50_000, 50_000, 0},
		{"tip > total → no basis", 50_000, 60_000, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := platformRefundableKobo(c.total, c.tip); got != c.want {
				t.Fatalf("platformRefundableKobo(%d,%d) = %d, want %d", c.total, c.tip, got, c.want)
			}
		})
	}
}

// TestFoodRefundPartialInheritsTipCap is the loophole guard. The partial branch derives
// its ceiling from the SAME basis as the full branch, so capping only refund_full would
// leave refund_partial able to refund the tip. Anything at or above the non-tip basis
// must be rejected — including amounts that are legal against the raw order total.
func TestFoodRefundPartialInheritsTipCap(t *testing.T) {
	const total, tip int64 = 1_066_285, 50_000
	basis := platformRefundableKobo(total, tip) // 1_016_285

	// The whole tip band [basis, total) is legal against the raw total but must NOT be.
	for _, requested := range []int64{basis, basis + 1, total - 1} {
		if got, err := foodRefundKobo(FoodRefundPartial, requested, basis); !errors.Is(err, ErrDisputeInvalid) {
			t.Errorf("partial %d against basis %d = %d,%v — must be rejected; a partial "+
				"must not reach into the tip the platform never held", requested, basis, got, err)
		}
	}
	// Just under the basis is still a valid partial.
	if got, err := foodRefundKobo(FoodRefundPartial, basis-1, basis); err != nil || got != basis-1 {
		t.Errorf("partial %d = %d,%v, want %d with no error", basis-1, got, err, basis-1)
	}
	// And the full branch pays exactly the basis — never the tip-inclusive total.
	got, err := foodRefundKobo(FoodRefundFull, 0, basis)
	if err != nil {
		t.Fatalf("full refund: %v", err)
	}
	if got != basis {
		t.Errorf("full refund = %d, want %d (the non-tip basis)", got, basis)
	}
	if got >= total {
		t.Errorf("full refund %d reaches the tip-inclusive total %d — the platform would fund the tip", got, total)
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
