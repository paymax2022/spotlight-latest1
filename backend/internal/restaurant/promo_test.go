package restaurant

import (
	"errors"
	"testing"
	"time"
)

func ptrKobo(v int64) *int64 { return &v }

func TestComputeDiscount(t *testing.T) {
	cases := []struct {
		name     string
		promo    Promo
		subtotal int64
		want     int64
	}{
		{"10% of 100k", Promo{Kind: PromoPercent, ValueBp: 1000}, 100_000, 10_000},
		{"7.5% floors", Promo{Kind: PromoPercent, ValueBp: 750}, 10_005, 750}, // 10005*750/10000 = 750.375 → 750
		{"percent capped", Promo{Kind: PromoPercent, ValueBp: 5000, MaxDiscountKobo: ptrKobo(20_000)}, 100_000, 20_000},
		{"fixed", Promo{Kind: PromoFixed, AmountKobo: 15_000}, 100_000, 15_000},
		{"fixed clamped to subtotal", Promo{Kind: PromoFixed, AmountKobo: 200_000}, 50_000, 50_000},
		{"percent clamped to subtotal (100%)", Promo{Kind: PromoPercent, ValueBp: 10000}, 30_000, 30_000},
		{"below minimum → 0", Promo{Kind: PromoFixed, AmountKobo: 10_000, MinSubtotalKobo: 100_000}, 50_000, 0},
		{"at minimum → applies", Promo{Kind: PromoFixed, AmountKobo: 10_000, MinSubtotalKobo: 50_000}, 50_000, 10_000},
		{"zero subtotal → 0", Promo{Kind: PromoFixed, AmountKobo: 10_000}, 0, 0},
		{"unknown kind → 0", Promo{Kind: "bogus", AmountKobo: 10_000}, 100_000, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := computeDiscount(tc.promo, tc.subtotal); got != tc.want {
				t.Errorf("computeDiscount = %d, want %d", got, tc.want)
			}
		})
	}
}

// TestComputeDiscountNeverExceedsSubtotal is the money guard: no promo, however
// configured, may discount more than the items (which would push the escrowed total
// below delivery+tip and risk a negative provider leg at settlement).
func TestComputeDiscountNeverExceedsSubtotal(t *testing.T) {
	for _, sub := range []int64{1, 999, 50_000, 1_000_000} {
		for _, p := range []Promo{
			{Kind: PromoPercent, ValueBp: 10000},
			{Kind: PromoFixed, AmountKobo: 1 << 40},
			{Kind: PromoPercent, ValueBp: 9999, MaxDiscountKobo: ptrKobo(1 << 40)},
		} {
			if d := computeDiscount(p, sub); d < 0 || d > sub {
				t.Errorf("discount %d out of [0,%d] for %+v", d, sub, p)
			}
		}
	}
}

func TestPromoWindowOK(t *testing.T) {
	base := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)
	past := base.Add(-time.Hour)
	future := base.Add(time.Hour)

	if promoWindowOK(Promo{Active: false}, base) {
		t.Error("inactive promo must be rejected")
	}
	if !promoWindowOK(Promo{Active: true}, base) {
		t.Error("active promo with no window must be accepted")
	}
	if promoWindowOK(Promo{Active: true, StartsAt: &future}, base) {
		t.Error("not-yet-started promo must be rejected")
	}
	if promoWindowOK(Promo{Active: true, EndsAt: &past}, base) {
		t.Error("expired promo must be rejected")
	}
	if !promoWindowOK(Promo{Active: true, StartsAt: &past, EndsAt: &future}, base) {
		t.Error("in-window promo must be accepted")
	}
}

// TestPromoFunderCapKobo locks the placement-time bound to the arithmetic
// settlement.Settle actually performs, so an escrowed order can never carry a discount
// that makes its own settlement fail closed (which would strand the escrow forever).
func TestPromoFunderCapKobo(t *testing.T) {
	const gross = 950_000
	platformLeg := int64(float64(gross) * splitPlatformPct)
	riderLeg := int64(float64(gross) * splitRiderPct)

	if got, want := promoFunderCapKobo(FunderPlatform, gross), platformLeg; got != want {
		t.Errorf("platform cap = %d, want its own leg %d", got, want)
	}
	if got, want := promoFunderCapKobo(FunderRestaurant, gross), gross-platformLeg-riderLeg; got != want {
		t.Errorf("restaurant cap = %d, want the provider remainder %d", got, want)
	}
	if got := promoFunderCapKobo(FunderRestaurant, 0); got != 0 {
		t.Errorf("cap on a zero gross = %d, want 0", got)
	}
	if got := promoFunderCapKobo(FunderPlatform, -1); got != 0 {
		t.Errorf("cap on a negative gross = %d, want 0", got)
	}
}

// TestAssertDiscountFundable: exactly at the cap it passes, one kobo over it fails as a
// CLIENT error (ErrPromoInvalid → 422), never a 500.
func TestAssertDiscountFundable(t *testing.T) {
	const gross = 950_000
	for _, funder := range []PromoFunder{FunderPlatform, FunderRestaurant} {
		maxKobo := promoFunderCapKobo(funder, gross)
		if err := assertDiscountFundable(appliedPromo{Funder: funder, DiscountKobo: maxKobo}, gross); err != nil {
			t.Errorf("%s discount exactly at the cap (%d) must be allowed: %v", funder, maxKobo, err)
		}
		err := assertDiscountFundable(appliedPromo{Funder: funder, DiscountKobo: maxKobo + 1}, gross)
		if err == nil {
			t.Errorf("%s discount of %d exceeds the %d cap and must be rejected", funder, maxKobo+1, maxKobo)
			continue
		}
		if !errors.Is(err, ErrPromoInvalid) {
			t.Errorf("%s over-cap error = %v, want it to wrap ErrPromoInvalid", funder, err)
		}
	}
}

// TestDiscountedSplitConservesValue proves the placement bound is exactly the one that
// keeps every settlement leg non-negative — for BOTH funders and both rider shapes —
// by replaying Settle's own arithmetic against the escrowed (already-discounted) total.
func TestDiscountedSplitConservesValue(t *testing.T) {
	for _, gross := range []int64{1, 51_000, 950_000, 3_333_337} {
		for _, funder := range []PromoFunder{FunderPlatform, FunderRestaurant} {
			discount := promoFunderCapKobo(funder, gross) // the worst case placement allows
			total := gross - discount                     // what is escrowed
			platformLeg := int64(float64(gross) * splitPlatformPct)
			for _, withRider := range []bool{true, false} {
				platform := platformLeg
				if funder == FunderPlatform {
					platform -= discount
				}
				var rider int64
				if withRider {
					rider = int64(float64(gross) * splitRiderPct)
				}
				provider := total - platform - rider
				if platform < 0 || rider < 0 || provider < 0 {
					t.Errorf("gross=%d funder=%s rider=%v: negative leg (provider=%d platform=%d rider=%d) — the cap is too loose",
						gross, funder, withRider, provider, platform, rider)
				}
				if sum := provider + platform + rider; sum != total {
					t.Errorf("gross=%d funder=%s rider=%v: legs sum to %d, want the escrowed %d",
						gross, funder, withRider, sum, total)
				}
			}
		}
	}
}
