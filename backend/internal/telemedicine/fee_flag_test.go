package telemedicine

import "testing"

// The FEATURE_TELEMEDICINE_PLATFORM_FEE_ENABLED gate. The flag resolves to a rate,
// and the rate is the only thing that changes — so "off" must reproduce the
// pre-ADR-044 world exactly: the patient pays the consultation fee, that is what
// gets escrowed, and Settle sees ServiceFeeKobo = 0 (the pure 85/15 split).
//
// Money bug prevented: a flag that only hid the fee in the UI while still escrowing
// it would charge patients a fee they were never shown — the original defect
// inverted.
func TestPlatformFeeFlagOffPricesLikeBeforeTheFee(t *testing.T) {
	for _, consult := range []int64{1, 19, 33_333, 350_000, 10_000_000_000} {
		off := QuoteAt(consult, 0)
		if off.PlatformFeeKobo != 0 {
			t.Errorf("flag off: consult %d charged a %d kobo fee", consult, off.PlatformFeeKobo)
		}
		if off.TotalKobo != consult {
			t.Errorf("flag off: consult %d escrows %d, want %d (the consultation fee alone)",
				consult, off.TotalKobo, consult)
		}
		// Still a real, bookable price — "no fee" must not mean "free consultation".
		if !off.Priceable() {
			t.Errorf("flag off: consult %d became unpriceable — bookings would be refused", consult)
		}
		on := QuoteAt(consult, PlatformFeeBp)
		if on.TotalKobo < off.TotalKobo {
			t.Errorf("flag on must never charge less than off (consult %d: on %d, off %d)",
				consult, on.TotalKobo, off.TotalKobo)
		}
	}
}

// An unwired service must not charge. NewService leaves the rate at 0, so a wiring
// mistake under-charges (recoverable) instead of billing patients a fee nobody
// switched on (a refund exercise across every booking).
func TestNewServiceDoesNotChargeTheFeeUntilWired(t *testing.T) {
	s := NewService(nil, nil)
	if got := s.quote(350_000); got.PlatformFeeKobo != 0 || got.TotalKobo != 350_000 {
		t.Fatalf("unwired service quoted fee %d total %d, want fee 0 total 350000",
			got.PlatformFeeKobo, got.TotalKobo)
	}
	if got := s.WithPlatformFeeBp(PlatformFeeBp).quote(350_000); got.TotalKobo != 367_500 {
		t.Fatalf("wired service quoted total %d, want 367500", got.TotalKobo)
	}
	// A negative rate is never a discount.
	if got := NewService(nil, nil).WithPlatformFeeBp(-500).quote(350_000); got.TotalKobo != 350_000 {
		t.Fatalf("negative rate produced total %d, want 350000", got.TotalKobo)
	}
}
