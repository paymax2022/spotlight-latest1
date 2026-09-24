package vtpass

import "testing"

// ════════════════════════════════════════════════════════════════════════════
// THE SEAM: kobo (Paymax's internal unit, everywhere else) vs naira (VTpass's
// wire unit, here and ONLY here)
// ════════════════════════════════════════════════════════════════════════════
//
// This mirrors provider/mycover/money_seam_test.go's rigor: a dedicated,
// table-driven test for the money-unit conversion function alone, covering the
// rounding boundaries explicitly rather than folding it into a purchase test
// where a wrong answer could pass unnoticed.
//
// asNaira(kobo) = max(1, round(kobo / 100)), ported from the TS source's
// `Math.max(1, Math.round(kobo / 100))` using ONLY integer arithmetic (see
// vtpass.go's doc comment on asNaira for why: this repo's iron rule is that
// money math never uses floats).

func TestAsNaira_FloorAtOneNaira(t *testing.T) {
	// The `max(1, ...)` floor: even the smallest possible non-zero kobo amount
	// must never round down to a free (0-naira) VTpass request.
	if got := asNaira(1); got != 1 {
		t.Fatalf("asNaira(1 kobo) = %d, want 1 (the max(1,...) floor)", got)
	}
	if got := asNaira(0); got != 1 {
		t.Fatalf("asNaira(0 kobo) = %d, want 1 (the max(1,...) floor)", got)
	}
	if got := asNaira(49); got != 1 {
		t.Fatalf("asNaira(49 kobo) = %d, want 1 (rounds to 0, then floored to 1)", got)
	}
}

func TestAsNaira_RoundsDown(t *testing.T) {
	// 149 kobo = ₦1.49 → rounds DOWN to ₦1.
	if got := asNaira(149); got != 1 {
		t.Fatalf("asNaira(149 kobo) = %d, want 1 (₦1.49 rounds down)", got)
	}
	// 100 kobo = exactly ₦1.00 → ₦1, no rounding ambiguity.
	if got := asNaira(100); got != 1 {
		t.Fatalf("asNaira(100 kobo) = %d, want 1", got)
	}
	// 12399 kobo = ₦123.99 → rounds down to ₦124... actually rounds UP (0.99).
	// Kept as a distinct down-rounding case instead: 12340 kobo = ₦123.40 → ₦123.
	if got := asNaira(12_340); got != 123 {
		t.Fatalf("asNaira(12340 kobo) = %d, want 123 (₦123.40 rounds down)", got)
	}
}

func TestAsNaira_RoundsUp(t *testing.T) {
	// 150 kobo = ₦1.50 → ties round UP (away from zero / toward +Infinity, the
	// same direction JS Math.round takes for a non-negative half), to ₦2.
	if got := asNaira(150); got != 2 {
		t.Fatalf("asNaira(150 kobo) = %d, want 2 (₦1.50 rounds up)", got)
	}
	// 250 kobo = ₦2.50 → ₦3.
	if got := asNaira(250); got != 3 {
		t.Fatalf("asNaira(250 kobo) = %d, want 3 (₦2.50 rounds up)", got)
	}
	// 12_360 kobo = ₦123.60 → rounds up to ₦124.
	if got := asNaira(12_360); got != 124 {
		t.Fatalf("asNaira(12360 kobo) = %d, want 124 (₦123.60 rounds up)", got)
	}
}

func TestAsNaira_LargeRealisticAmount(t *testing.T) {
	// A ₦50,000 electricity top-up, expressed in kobo with no fractional kobo:
	// exact, no rounding to prove at all — the point is that integer division
	// does not silently truncate a whole-naira amount.
	if got := asNaira(5_000_000); got != 50_000 {
		t.Fatalf("asNaira(5,000,000 kobo) = %d, want 50000", got)
	}
	// A large amount with kobo change: ₦123,456.78 → rounds up to ₦123,457.
	if got := asNaira(12_345_678); got != 123_457 {
		t.Fatalf("asNaira(12,345,678 kobo) = %d, want 123457", got)
	}
}

func TestAsNaira_NegativeInputNeverProducesLessThanOne(t *testing.T) {
	// Never a valid purchase amount, but the function must fail safe rather
	// than return a non-positive or nonsensical naira amount if it ever
	// receives one (e.g. a caller bug upstream).
	if got := asNaira(-500); got != 1 {
		t.Fatalf("asNaira(-500) = %d, want 1 (fail-safe floor)", got)
	}
}

// TestAsNaira_TableMatchesTSRoundingRule is a broader table exercising the same
// rule (`max(1, round(kobo/100))`) as a single, easy-to-scan matrix, including
// every boundary already covered individually above.
func TestAsNaira_TableMatchesTSRoundingRule(t *testing.T) {
	cases := []struct {
		kobo int64
		want int64
	}{
		{0, 1},
		{1, 1},
		{49, 1},
		{50, 1}, // 0.50 naira rounds up to 1, which is also the floor — not a distinguishing case on its own.
		{99, 1},
		{100, 1},
		{101, 1},
		{149, 1},
		{150, 2},
		{199, 2},
		{200, 2},
		{201, 2},
		{249, 2},
		{250, 3},
		{100_00, 100},     // ₦100.00
		{100_49, 100},     // ₦100.49
		{100_50, 101},     // ₦100.50
		{999_999, 10_000}, // ₦9999.99 -> rounds up to ₦10000
	}
	for _, tc := range cases {
		if got := asNaira(tc.kobo); got != tc.want {
			t.Errorf("asNaira(%d) = %d, want %d", tc.kobo, got, tc.want)
		}
	}
}
