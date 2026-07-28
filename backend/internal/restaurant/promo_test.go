package restaurant

import (
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
