package wallet

import "testing"

// The canonical high-water-mark scenario: gain → fee, drawdown → no fee,
// partial recovery → no fee, new peak → fee only on the NEW gain above the peak.
func TestHWM_DrawdownRecoveryCycle(t *testing.T) {
	const feeBps = 2000 // 20%
	units := UnitScale  // 1.0 unit
	hwm := ParNAVKobo   // start at par 1_000_000

	// 1) NAV +20% → fee on the 200_000 gain, HWM advances to the new peak.
	fee, hwm := PerformanceFee(1_200_000, hwm, units, feeBps, 0)
	if fee != 40_000 { // 200_000 * 20%
		t.Fatalf("gain fee = %d, want 40_000", fee)
	}
	if hwm != 1_200_000 {
		t.Fatalf("HWM should advance to 1_200_000, got %d", hwm)
	}

	// 2) NAV drops below HWM → NO fee, HWM unchanged (does not ratchet down).
	fee, hwm = PerformanceFee(1_050_000, hwm, units, feeBps, 0)
	if fee != 0 {
		t.Fatalf("no fee expected during drawdown, got %d", fee)
	}
	if hwm != 1_200_000 {
		t.Fatalf("HWM must not fall during drawdown, got %d", hwm)
	}

	// 3) Partial recovery, still below the prior peak → still NO fee.
	fee, hwm = PerformanceFee(1_150_000, hwm, units, feeBps, 0)
	if fee != 0 {
		t.Fatalf("no fee until prior peak exceeded, got %d", fee)
	}
	if hwm != 1_200_000 {
		t.Fatalf("HWM unchanged, got %d", hwm)
	}

	// 4) New peak above prior HWM → fee ONLY on the new gain (1_300_000-1_200_000).
	fee, hwm = PerformanceFee(1_300_000, hwm, units, feeBps, 0)
	if fee != 20_000 { // 100_000 * 20%, NOT charged again on the first 200_000
		t.Fatalf("new-peak fee = %d, want 20_000 (only the incremental gain)", fee)
	}
	if hwm != 1_300_000 {
		t.Fatalf("HWM should advance to 1_300_000, got %d", hwm)
	}
}

func TestHWM_NoFeeAtOrBelowMark(t *testing.T) {
	fee, hwm := PerformanceFee(1_000_000, 1_000_000, UnitScale, 2000, 0)
	if fee != 0 || hwm != 1_000_000 {
		t.Fatalf("flat NAV: fee=%d hwm=%d, want 0/1_000_000", fee, hwm)
	}
}

func TestHWM_Hurdle(t *testing.T) {
	// 10% hurdle over HWM 1_000_000 → threshold 1_100_000. NAV 1_080_000 is above
	// the mark but below the hurdle → no fee, and the HWM must NOT advance (no fee
	// was crystallized).
	fee, hwm := PerformanceFee(1_080_000, 1_000_000, UnitScale, 2000, 1000)
	if fee != 0 {
		t.Fatalf("no fee below hurdle, got %d", fee)
	}
	if hwm != 1_000_000 {
		t.Fatalf("HWM must stay put when no fee crystallizes, got %d", hwm)
	}
	// NAV 1_200_000 with same 10% hurdle → fee on (1_200_000 - 1_100_000) = 100_000.
	fee, _ = PerformanceFee(1_200_000, 1_000_000, UnitScale, 2000, 1000)
	if fee != 20_000 {
		t.Fatalf("fee above hurdle = %d, want 20_000", fee)
	}
}

// Regression for the audit HIGH finding: a peak that clears the HWM but not the
// hurdle must NOT ratchet the HWM up, or the next period's hurdle base inflates
// and legitimate fees are permanently under-collected. Chains the HWM forward
// (the exact leak the earlier suite masked by resetting it).
func TestHWM_HurdleDoesNotRatchetOnUnchargedPeak(t *testing.T) {
	const feeBps, hurdleBps = 2000, 1000
	hwm := ParNAVKobo // 1_000_000

	// Period 1: NAV 1_080_000 — above mark, below hurdle threshold 1_100_000 →
	// no fee, HWM stays at 1_000_000.
	fee, hwm := PerformanceFee(1_080_000, hwm, UnitScale, feeBps, hurdleBps)
	if fee != 0 || hwm != 1_000_000 {
		t.Fatalf("period 1: fee=%d hwm=%d, want 0/1_000_000", fee, hwm)
	}

	// Period 2: NAV 1_200_000 with the (correctly unchanged) HWM → threshold is
	// still 1_100_000, so fee = (1_200_000-1_100_000)*20% = 20_000. The buggy
	// ratchet would have inflated the base to 1_080_000 → threshold 1_188_000 →
	// only 2_400 (an 88% under-collection).
	fee, hwm = PerformanceFee(1_200_000, hwm, UnitScale, feeBps, hurdleBps)
	if fee != 20_000 {
		t.Fatalf("period 2 fee = %d, want 20_000 (no ratchet leak)", fee)
	}
	if hwm != 1_200_000 {
		t.Fatalf("HWM should advance to the fee-paid peak 1_200_000, got %d", hwm)
	}
}

// feeBps outside (0,10000] is a config error and must fail closed (no fee, no HWM
// move) rather than over-charging the client many times their profit.
func TestHWM_InsaneFeeBpsFailsClosed(t *testing.T) {
	fee, hwm := PerformanceFee(1_200_000, 1_000_000, UnitScale, 1_000_000, 0)
	if fee != 0 || hwm != 1_000_000 {
		t.Fatalf("out-of-range feeBps must fail closed: fee=%d hwm=%d", fee, hwm)
	}
}

func TestHWM_ScalesWithUnits(t *testing.T) {
	// 5 whole units, +100_000 kobo/unit gain, 20% → 5 * 100_000 * 20% = 100_000.
	fee, _ := PerformanceFee(1_100_000, 1_000_000, 5*UnitScale, 2000, 0)
	if fee != 100_000 {
		t.Fatalf("fee for 5 units = %d, want 100_000", fee)
	}
}

func TestHWM_RoundsDownNeverOvercharges(t *testing.T) {
	// A gain that doesn't divide evenly must truncate the fee down.
	fee, _ := PerformanceFee(1_000_003, 1_000_000, UnitScale, 3333, 0)
	// profit = 3 kobo; fee = 3*3333/10000 = 0 (rounds down), never 1+.
	if fee != 0 {
		t.Fatalf("sub-kobo fee must round to 0, got %d", fee)
	}
}

func TestHWM_ZeroInputsSafe(t *testing.T) {
	if fee, _ := PerformanceFee(1_200_000, 1_000_000, 0, 2000, 0); fee != 0 {
		t.Fatal("zero units → zero fee")
	}
	if fee, _ := PerformanceFee(1_200_000, 1_000_000, UnitScale, 0, 0); fee != 0 {
		t.Fatal("zero feeBps → zero fee")
	}
}
