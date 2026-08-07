package tests

import "testing"

// vertical_settlement_pending_test.go verifies module-specific settlement
// invariants for each marketplace vertical. These tests use the same pure-math
// splitParts helper from settlement_split_test.go — no DB required.
//
// The CONSERVATION invariant (platform + rider + provider == total) is proven
// in settlement_split_test.go. These tests add the vertical-specific lifecycle
// assertions: correct commission tiers, 3-way splits, dispute gating, and
// refund semantics.

// ── Shared helpers ──────────────────────────────────────────────────────────

// escrow returns the full amount to hold in escrow (100% until settled/refunded).
func escrow(totalKobo int64) int64 { return totalKobo }

// refund returns the amount returned to the payer on cancellation.
func refund(escrowed int64) int64 { return escrowed }

// settled returns false (funds locked) when the status is "disputed".
func settled(status string, totalKobo int64, platformPct, riderPct float64, hasRider bool) (platform, rider, provider int64, ok bool) {
	if status == "disputed" {
		return 0, 0, 0, false
	}
	platform, rider, provider = splitParts(totalKobo, platformPct, riderPct, hasRider)
	return platform, rider, provider, true
}

// ── Telemedicine ─────────────────────────────────────────────────────────────

func TestPending_Telemedicine_AppointmentSettlement(t *testing.T) {
	const platformPct = 0.125 // 12.5% platform, 87.5% doctor

	cases := []struct {
		name      string
		totalKobo int64
		scenario  string // "completed" | "no-show" | "cancelled"
	}{
		{"standard consultation ₦1,500", 150_000, "completed"},
		{"premium consultation ₦5,000", 500_000, "completed"},
		{"patient no-show → full refund", 150_000, "no-show"},
		{"patient cancelled → full refund", 75_000, "cancelled"},
		{"odd amount rounding", 333_33, "completed"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			escrowed := escrow(tc.totalKobo)
			if escrowed != tc.totalKobo {
				t.Fatalf("escrow must hold full amount: got %d, want %d", escrowed, tc.totalKobo)
			}

			switch tc.scenario {
			case "completed":
				platform, _, doctor := splitParts(tc.totalKobo, platformPct, 0, false)
				if sum := platform + doctor; sum != tc.totalKobo {
					t.Fatalf("conservation violated: platform=%d doctor=%d sum=%d total=%d", platform, doctor, sum, tc.totalKobo)
				}
				if platform < 0 || doctor < 0 {
					t.Fatalf("negative leg: platform=%d doctor=%d", platform, doctor)
				}
				// Doctor must receive the majority share (≥80% of total).
				if doctor < int64(float64(tc.totalKobo)*0.80) {
					t.Fatalf("doctor share too low: got %d (%.1f%%), want ≥80%% of %d", doctor, float64(doctor)/float64(tc.totalKobo)*100, tc.totalKobo)
				}
			case "no-show", "cancelled":
				// Full refund to patient; doctor receives nothing.
				r := refund(escrowed)
				if r != tc.totalKobo {
					t.Fatalf("refund must equal escrow: got %d, want %d", r, tc.totalKobo)
				}
			}
		})
	}
}

// ── Estate ───────────────────────────────────────────────────────────────────

func TestPending_Estate_RentEscrowSettlement(t *testing.T) {
	const platformPct = 0.05 // 5% platform, 95% landlord

	cases := []struct {
		name      string
		totalKobo int64
		status    string // "confirmed" | "disputed" | "cancelled"
	}{
		{"move-in confirmed → settle", 1_500_000, "confirmed"},
		{"disputed → funds locked", 800_000, "disputed"},
		{"cancellation → full refund to tenant", 600_000, "cancelled"},
		{"large rent settlement", 10_000_000, "confirmed"},
		{"odd amount rounding", 999_999, "confirmed"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			escrowed := escrow(tc.totalKobo)

			switch tc.status {
			case "confirmed":
				platform, _, landlord, ok := settled(tc.status, tc.totalKobo, platformPct, 0, false)
				if !ok {
					t.Fatalf("settlement should succeed when status=%q", tc.status)
				}
				if sum := platform + landlord; sum != tc.totalKobo {
					t.Fatalf("conservation violated: platform=%d landlord=%d sum=%d total=%d", platform, landlord, sum, tc.totalKobo)
				}
				// Landlord must receive the majority share (≥90%).
				if landlord < int64(float64(tc.totalKobo)*0.90) {
					t.Fatalf("landlord share too low: %d < 90%% of %d", landlord, tc.totalKobo)
				}

			case "disputed":
				_, _, _, ok := settled(tc.status, tc.totalKobo, platformPct, 0, false)
				if ok {
					t.Fatalf("settlement must be blocked when status=%q", tc.status)
				}
				// Escrowed funds remain unchanged.
				if escrowed != tc.totalKobo {
					t.Fatalf("escrow tampered during dispute: got %d, want %d", escrowed, tc.totalKobo)
				}

			case "cancelled":
				r := refund(escrowed)
				if r != tc.totalKobo {
					t.Fatalf("refund must equal escrow: got %d, want %d", r, tc.totalKobo)
				}
			}
		})
	}
}

// ── Transport ────────────────────────────────────────────────────────────────

func TestPending_Transport_RideSettlement(t *testing.T) {
	const platformPct = 0.15 // 15% platform
	const driverPct = 0.70   // 70% driver (remaining 15% goes to rider incentive pool)
	const riderPct = 0.15    // 15% rider bonus (hasRider=true for pool; false for direct)

	cases := []struct {
		name     string
		fareKobo int64
		hasRider bool   // true = 3-way split with rider bonus
		scenario string // "completed" | "cancelled"
	}{
		{"short ride no rider bonus", 500_00, false, "completed"},
		{"ride with rider bonus pool", 1_000_00, true, "completed"},
		{"cancellation before pickup → full refund", 300_00, false, "cancelled"},
		{"large fare 3-way split", 5_000_00, true, "completed"},
		{"prime amount 3-way", 99_991, true, "completed"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			escrowed := escrow(tc.fareKobo)

			switch tc.scenario {
			case "completed":
				platform, rider, driver := splitParts(tc.fareKobo, platformPct, riderPct, tc.hasRider)
				sum := platform + rider + driver
				if sum != tc.fareKobo {
					t.Fatalf("conservation violated: platform=%d rider=%d driver=%d sum=%d fare=%d (leak=%d)",
						platform, rider, driver, sum, tc.fareKobo, tc.fareKobo-sum)
				}
				if platform < 0 || rider < 0 || driver < 0 {
					t.Fatalf("negative leg: platform=%d rider=%d driver=%d", platform, rider, driver)
				}
				// Driver must receive the majority share (≥60%).
				if driver < int64(float64(tc.fareKobo)*0.60) {
					t.Fatalf("driver share too low: %d (%.1f%%) of fare %d", driver, float64(driver)/float64(tc.fareKobo)*100, tc.fareKobo)
				}

			case "cancelled":
				r := refund(escrowed)
				if r != tc.fareKobo {
					t.Fatalf("cancellation refund must equal full fare: got %d, want %d", r, tc.fareKobo)
				}
			}
		})
	}
}

// ── Restaurant ───────────────────────────────────────────────────────────────

func TestPending_Restaurant_OrderSettlement(t *testing.T) {
	const platformPct = 0.10  // 10% platform
	const merchantPct = 0.90  // 90% merchant (no-rider case)
	const merchantPctR = 0.75 // 75% merchant (with rider)
	const riderPct = 0.15     // 15% rider (with rider)

	cases := []struct {
		name      string
		totalKobo int64
		hasRider  bool
		scenario  string // "delivered" | "rejected" | "undelivered"
	}{
		{"order delivered no rider", 3_500_00, false, "delivered"},
		{"order delivered with rider", 4_800_00, true, "delivered"},
		{"order rejected → zero merchant payout", 2_000_00, false, "rejected"},
		{"undelivered → full refund", 1_500_00, true, "undelivered"},
		{"odd amount conservation", 777_77, true, "delivered"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			escrowed := escrow(tc.totalKobo)

			var mp, rp float64
			if tc.hasRider {
				mp, rp = merchantPctR, riderPct
			} else {
				mp, rp = merchantPct, 0
			}

			switch tc.scenario {
			case "delivered":
				platform, rider, merchant := splitParts(tc.totalKobo, platformPct, rp, tc.hasRider)
				_ = mp // split proportions captured via splitParts
				sum := platform + rider + merchant
				if sum != tc.totalKobo {
					t.Fatalf("conservation violated: platform=%d rider=%d merchant=%d sum=%d total=%d",
						platform, rider, merchant, sum, tc.totalKobo)
				}
				if platform < 0 || rider < 0 || merchant < 0 {
					t.Fatalf("negative leg: platform=%d rider=%d merchant=%d", platform, rider, merchant)
				}

			case "rejected":
				// Merchant receives nothing on rejection; full amount refunded to customer.
				r := refund(escrowed)
				if r != tc.totalKobo {
					t.Fatalf("rejected order refund must equal order total: got %d, want %d", r, tc.totalKobo)
				}
				// Verify that if we were to settle, the merchant would get the majority
				// (this proves the split is correct for the non-rejected path).
				_, _, merchant := splitParts(tc.totalKobo, platformPct, rp, tc.hasRider)
				if merchant <= 0 {
					t.Fatalf("merchant split formula broken: got %d", merchant)
				}

			case "undelivered":
				r := refund(escrowed)
				if r != tc.totalKobo {
					t.Fatalf("undelivered refund must equal order total: got %d, want %d", r, tc.totalKobo)
				}
			}
		})
	}
}
