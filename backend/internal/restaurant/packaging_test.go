package restaurant

import "testing"

// Packaging is a MONEY term: it is added to the escrowed order total and settles
// to the restaurant via the provider remainder. These are pure table tests over
// the arithmetic and the clamp, written before the wiring.
//
// The clamp exists because package_count arrives FROM THE CLIENT. Without it a
// caller could send 0 to dodge the charge, or a huge number to inflate a
// merchant's take. The server cannot cheaply re-derive the true minimum pack
// count (the cart's packing rules are a client concern), but it can bound it:
// at least one pack for any order, and never more packs than there are items.
func TestPackagingKobo(t *testing.T) {
	cases := []struct {
		name         string
		packageCount int
		totalQty     int
		feeKobo      int64
		want         int64
	}{
		// ── the ordinary path ────────────────────────────────────────────
		{"one pack", 1, 1, 20000, 20000},
		{"three packs", 3, 6, 20000, 60000},

		// ── store does not charge for packaging ──────────────────────────
		// Every restaurant defaults to packaging_fee_kobo = 0, so this is the
		// behaviour for every store that has not opted in. It MUST stay zero
		// or the migration silently repriced the whole platform.
		{"zero fee charges nothing", 4, 8, 0, 0},

		// ── client under-reports to dodge the charge ─────────────────────
		{"zero packs clamps up to one", 0, 3, 20000, 20000},
		{"negative packs clamps up to one", -5, 3, 20000, 20000},

		// ── client over-reports to inflate the merchant's take ───────────
		{"packs above item count clamps down", 99, 2, 20000, 40000},

		// ── degenerate inputs ────────────────────────────────────────────
		// An order with no items cannot happen (items is binding:"required,min=1"),
		// but the function must not return a negative or explode if it ever does.
		{"no items still charges one pack", 3, 0, 20000, 20000},
		{"negative fee is treated as zero", 2, 4, -100, 0},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := packagingKobo(tc.packageCount, tc.totalQty, tc.feeKobo)
			if got != tc.want {
				t.Fatalf("packagingKobo(%d, %d, %d) = %d, want %d",
					tc.packageCount, tc.totalQty, tc.feeKobo, got, tc.want)
			}
			if got < 0 {
				t.Fatalf("packaging must never be negative, got %d", got)
			}
		})
	}
}

// The charge must be exactly divisible by the unit fee — i.e. a whole number of
// packs, never a fraction. Guards against anyone "improving" this with float math.
func TestPackagingKoboIsAWholeNumberOfPacks(t *testing.T) {
	const fee int64 = 33333 // deliberately not a round number
	for packs := 1; packs <= 20; packs++ {
		got := packagingKobo(packs, packs, fee)
		if got%fee != 0 {
			t.Fatalf("packs=%d: %d is not a whole multiple of the %d unit fee", packs, got, fee)
		}
		if got/fee != int64(packs) {
			t.Fatalf("packs=%d: charged for %d packs", packs, got/fee)
		}
	}
}
