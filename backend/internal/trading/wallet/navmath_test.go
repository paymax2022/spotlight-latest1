package wallet

import "testing"

func TestNAVPerUnitKobo_BootstrapPar(t *testing.T) {
	// No units outstanding → fund inception → NAV is par, regardless of aum.
	if got := NAVPerUnitKobo(0, 0); got != ParNAVKobo {
		t.Fatalf("bootstrap NAV = %d, want par %d", got, ParNAVKobo)
	}
	if got := NAVPerUnitKobo(5_000_000, 0); got != ParNAVKobo {
		t.Fatalf("NAV with units=0 must be par, got %d", got)
	}
}

func TestNAVPerUnitKobo_ZeroAUM(t *testing.T) {
	// AUM wiped to zero but units remain → NAV is 0 (worthless), not par.
	if got := NAVPerUnitKobo(0, UnitScale); got != 0 {
		t.Fatalf("NAV with aum=0, units>0 = %d, want 0", got)
	}
}

func TestFirstDeposit_EstablishesPar(t *testing.T) {
	// The very first deposit mints at par and the resulting NAV recomputes to par.
	cash := int64(1_000_000) // ₦10,000
	nav0 := NAVPerUnitKobo(0, 0)
	units := UnitsForCash(cash, nav0)
	if units != UnitScale {
		t.Fatalf("first ₦10k deposit at par should mint 1.0 unit (%d), got %d", UnitScale, units)
	}
	// After the deposit, AUM == cash, units == minted; NAV must be par again.
	if got := NAVPerUnitKobo(cash, units); got != ParNAVKobo {
		t.Fatalf("post-first-deposit NAV = %d, want par %d", got, ParNAVKobo)
	}
}

func TestMint_NeverOverCredits_ResidualToPool(t *testing.T) {
	// At NAV = par, a deposit that isn't an exact multiple truncates down: the
	// depositor gets units worth <= their cash; the pool keeps the residual.
	nav := ParNAVKobo
	cash := int64(1_500_001) // not an exact unit multiple
	units := UnitsForCash(cash, nav)
	back := CashForUnits(units, nav)
	if back > cash {
		t.Fatalf("mint over-credited: cash=%d, units worth=%d", cash, back)
	}
	if cash-back >= ParNAVKobo/UnitScale+1 {
		// residual must be sub-unit (less than one minor unit of value), not large
		t.Fatalf("residual too large: cash=%d back=%d", cash, back)
	}
}

func TestMint_RefusedAtBadNAVorCash(t *testing.T) {
	if UnitsForCash(1_000_000, 0) != 0 {
		t.Fatal("mint at NAV 0 must return 0 units")
	}
	if UnitsForCash(0, ParNAVKobo) != 0 {
		t.Fatal("mint of 0 cash must return 0 units")
	}
	if UnitsForCash(-5, ParNAVKobo) != 0 {
		t.Fatal("mint of negative cash must return 0 units")
	}
}

func TestRedeem_NeverOverPays(t *testing.T) {
	// Redeeming units never pays more than they are worth; round-trip loses at
	// most sub-unit dust to the pool.
	nav := int64(1_234_567)
	units := int64(7_777_777)
	cash := CashForUnits(units, nav)
	reunits := UnitsForCash(cash, nav)
	if reunits > units {
		t.Fatalf("redeem→remint inflated units: %d → %d", units, reunits)
	}
}

func TestNAV_RisesWithProfit_FallsWithLoss(t *testing.T) {
	// One holder, 1.0 unit at par. AUM appreciates 20% → NAV up 20%.
	units := UnitScale
	if got := NAVPerUnitKobo(1_200_000, units); got != 1_200_000 {
		t.Fatalf("NAV after +20%% = %d, want 1_200_000", got)
	}
	if got := NAVPerUnitKobo(800_000, units); got != 800_000 {
		t.Fatalf("NAV after -20%% = %d, want 800_000", got)
	}
}

func TestSecondDepositorGetsFewerUnitsAfterAppreciation(t *testing.T) {
	// Holder A: 1.0 unit, par. Fund appreciates to NAV 1_200_000. Holder B
	// deposits the SAME ₦10,000 → must get FEWER units than A (higher NAV), and
	// A's stake value must be unchanged by B's arrival (no dilution).
	navBefore := int64(1_200_000)
	aUnits := UnitScale
	aValueBefore := ValueOfUnits(aUnits, navBefore)

	cashB := int64(1_000_000)
	bUnits := UnitsForCash(cashB, navBefore)
	if bUnits >= aUnits {
		t.Fatalf("B should get fewer units than A after appreciation: A=%d B=%d", aUnits, bUnits)
	}
	// New AUM = old holdings value + B cash; NAV must be ~unchanged, so A's value holds.
	newAUM := ValueOfUnits(aUnits, navBefore) + cashB
	newTotal := aUnits + bUnits
	navAfter := NAVPerUnitKobo(newAUM, newTotal)
	aValueAfter := ValueOfUnits(aUnits, navAfter)
	// A must not lose value to B's deposit (allow 1 kobo truncation dust).
	if aValueBefore-aValueAfter > 1 {
		t.Fatalf("A diluted by B's deposit: before=%d after=%d", aValueBefore, aValueAfter)
	}
}

// Regression for the audit MEDIUM finding: a large deposit into a near-wiped fund
// pushes total units far above aum*UnitScale, flooring the NAV division to 0 —
// which (before the fix) made mint AND redeem refuse, freezing the pool. NAV must
// floor at 1 kobo so both stay operable.
func TestNAV_NeverBricksNearZero(t *testing.T) {
	// Post-grief state: ~1e12 units backed by ~₦10,000 of AUM → raw NAV floors to 0.
	units := int64(1_000_001_000_000)
	aum := int64(1_000_001)
	nav := NAVPerUnitKobo(aum, units)
	if nav < 1 {
		t.Fatalf("NAV must floor to >=1 to avoid freezing the fund, got %d", nav)
	}
	if UnitsForCash(1_000_000, nav) == 0 {
		t.Fatal("deposits must still mint at the floored NAV (not frozen)")
	}
	if CashForUnits(units, nav) == 0 {
		t.Fatal("redemptions must still price at the floored NAV (not frozen)")
	}
}

func TestNoOverflow_FailsClosed(t *testing.T) {
	const maxInt64 = int64(9_223_372_036_854_775_807)
	// Products that would overflow int64 must fail closed (0), never wrap.
	if got := UnitsForCash(maxInt64, 1); got != 0 {
		t.Fatalf("overflow mint must fail closed, got %d", got)
	}
	if got := CashForUnits(maxInt64, maxInt64); got != 0 {
		t.Fatalf("overflow valuation must fail closed, got %d", got)
	}
	if got := NAVPerUnitKobo(maxInt64, 1); got != 0 {
		t.Fatalf("overflow NAV must fail closed, got %d", got)
	}
}
