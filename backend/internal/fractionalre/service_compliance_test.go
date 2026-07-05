package fractionalre

import "testing"

// TestComputeRetailCapHardBlock verifies the SEC retail 10%-of-annual-income cap
// arithmetic, including the fail-closed HARD BLOCK when a subscription would push
// the investor over the cap. All values are integer kobo (no float math).
func TestComputeRetailCapHardBlock(t *testing.T) {
	// ₦1,000,000 declared annual income = 100_000_000 kobo. 10% cap = 10_000_000 kobo.
	const income = int64(100_000_000)
	const cap = int64(10_000_000)

	cases := []struct {
		name          string
		ytd           int64
		requested     int64
		wantCap       int64
		wantRemaining int64
		wantAllowed   bool
	}{
		{"fresh, within cap", 0, 5_000_000, cap, cap, true},
		{"exactly at cap", 0, cap, cap, cap, true},
		{"one kobo over cap → hard block", 0, cap + 1, cap, cap, false},
		{"partial ytd, within remaining", 6_000_000, 4_000_000, cap, 4_000_000, true},
		{"partial ytd, over remaining → hard block", 6_000_000, 4_000_001, cap, 4_000_000, false},
		{"cap exhausted → remaining 0, block any positive", cap, 1, cap, 0, false},
		{"cap exceeded historically → remaining clamps to 0", cap + 500, 1, cap, 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotCap, gotRem, gotAllowed, _ := computeRetailCap(income, 0, tc.ytd, tc.requested)
			if gotCap != tc.wantCap {
				t.Errorf("cap: got %d want %d", gotCap, tc.wantCap)
			}
			if gotRem != tc.wantRemaining {
				t.Errorf("remaining: got %d want %d", gotRem, tc.wantRemaining)
			}
			if gotAllowed != tc.wantAllowed {
				t.Errorf("allowed: got %v want %v (ytd=%d requested=%d remaining=%d)",
					gotAllowed, tc.wantAllowed, tc.ytd, tc.requested, gotRem)
			}
		})
	}
}

// TestComputeRetailCapWithOverride verifies a compliance override raises the cap.
func TestComputeRetailCapWithOverride(t *testing.T) {
	const income = int64(100_000_000) // cap 10_000_000
	override := int64(5_000_000)
	// Without override a 12M request is blocked; with a 5M override (cap 15M) it passes.
	if _, _, allowed, _ := computeRetailCap(income, 0, 0, 12_000_000); allowed {
		t.Fatal("expected hard block without override")
	}
	if _, _, allowed, _ := computeRetailCap(income, override, 0, 12_000_000); !allowed {
		t.Fatal("expected allow once override headroom is applied")
	}
}

// TestComputeRetailCapSoftWarn verifies the >= 80% soft-warn threshold.
func TestComputeRetailCapSoftWarn(t *testing.T) {
	const income = int64(100_000_000) // cap 10_000_000; 80% = 8_000_000
	// ytd 0 + requested 7.9M → below 80% → no warn.
	if _, _, _, warn := computeRetailCap(income, 0, 0, 7_900_000); warn {
		t.Error("did not expect soft-warn below 80% of cap")
	}
	// ytd 0 + requested 8M → exactly 80% → warn.
	if _, _, _, warn := computeRetailCap(income, 0, 0, 8_000_000); !warn {
		t.Error("expected soft-warn at 80% of cap")
	}
}

// TestExemptClassificationsBypassCap documents that HNI/qualified are exempt
// (the cap engine returns Exempt + Allowed before any arithmetic). This guards
// the classification constants used by LimitCheck.
func TestExemptClassificationsBypassCap(t *testing.T) {
	exempt := map[Classification]bool{ClassHNI: true, ClassQualified: true}
	if !exempt[ClassHNI] || !exempt[ClassQualified] {
		t.Fatal("HNI and qualified must be exempt from the retail cap")
	}
	if exempt[ClassRetail] {
		t.Fatal("retail must NOT be exempt from the cap")
	}
}
