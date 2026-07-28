package wallet

import "math/big"

// High-water-mark performance fee — pure integer math (§3.5).
//
// A performance fee is charged ONLY on new net profit above the holder's previous
// peak NAV (the high-water mark), so a user who loses and then recovers is never
// charged twice for the same gains. An optional hurdle raises the threshold NAV
// the fund must clear before ANY fee applies. All arithmetic is integer kobo with
// big.Int intermediates; the fee always rounds DOWN (never over-charges the user).

// PerformanceFee computes the performance fee (kobo) on a unit holding at
// assessment time, and the new high-water mark to persist.
//
//	navNowKobo   – current NAV per whole unit
//	hwmKobo      – holder's previous high-water mark (NAV per whole unit); at
//	               inception this is the par NAV
//	units        – holder's units (scaled by UnitScale)
//	feeBps       – performance fee rate in basis points (e.g. 2000 = 20%)
//	hurdleBps    – optional hurdle in bps applied to the HWM (0 = pure HWM);
//	               fee accrues only on NAV above hwm*(1+hurdle)
//
// Returns feeKobo (>= 0) and newHWMKobo. The high-water mark advances to the new
// peak ONLY when a fee is actually crystallized (navNow clears the hurdle
// threshold); on a no-fee period the HWM is left UNCHANGED. Advancing on an
// un-charged peak would inflate the next period's hurdle base and permanently
// exempt the intermediate gains from a legitimate fee — so the mark tracks the
// level up to which fees have been PAID, never merely the highest NAV touched.
// The HWM never ratchets down, so recovering a drawdown pays no fee until the
// prior fee-paid peak is exceeded.
func PerformanceFee(navNowKobo, hwmKobo, units, feeBps, hurdleBps int64) (feeKobo, newHWMKobo int64) {
	newHWMKobo = hwmKobo // default: unchanged unless a fee crystallizes below
	// feeBps must be a sane rate in (0, 10000]; a misconfigured rate fails closed
	// (no fee, no HWM move) rather than over-charging the client.
	if units <= 0 || feeBps <= 0 || feeBps > 10_000 || hurdleBps < 0 || navNowKobo <= 0 || hwmKobo < 0 {
		return 0, newHWMKobo
	}

	// thresholdNav = hwm + hwm*hurdleBps/10000 (the NAV that must be cleared).
	threshold := new(big.Int).Set(big.NewInt(hwmKobo))
	if hurdleBps > 0 {
		h := new(big.Int).Mul(big.NewInt(hwmKobo), big.NewInt(hurdleBps))
		h.Quo(h, big.NewInt(10_000))
		threshold.Add(threshold, h)
	}

	navNow := big.NewInt(navNowKobo)
	if navNow.Cmp(threshold) <= 0 {
		return 0, hwmKobo // at/below threshold → no fee, HWM UNCHANGED
	}

	// gainPerWholeUnit = navNow - threshold   (kobo per whole unit)
	gainPerUnit := new(big.Int).Sub(navNow, threshold)
	// profitKobo = gainPerUnit * units / UnitScale   (holder's kobo profit above threshold)
	profit := new(big.Int).Mul(gainPerUnit, big.NewInt(units))
	profit.Quo(profit, big.NewInt(UnitScale))
	// feeKobo = profit * feeBps / 10000   (truncate down)
	fee := profit.Mul(profit, big.NewInt(feeBps))
	fee.Quo(fee, big.NewInt(10_000))

	if !fee.IsInt64() || fee.Sign() < 0 {
		return 0, hwmKobo // fail closed on overflow / degenerate — HWM unchanged
	}
	// Fee crystallized: advance the mark to the new fee-paid peak.
	return fee.Int64(), navNowKobo
}
