package wallet

// Reconciliation — the fund-integrity invariant the brief makes a first-class
// control (§3.4, §7.7): internal state must match the ledger, and any divergence
// beyond tolerance halts trading. Pure check; the caller supplies the numbers
// (sum of per-user unit rows, recorded total units, mark-to-market AUM, and the
// cash balance of the fund clearing ledger account).
//
// In this paper/accounting foundation the fund holds only cash in the clearing
// account (no venue positions), so mark-to-market AUM must equal that cash
// balance exactly (tolerance covers rounding dust only). Once real positions
// exist, AUM becomes cash + MTM(positions) and this check is extended — never
// relaxed.

// ReconcileResult reports the outcome of a fund-integrity check.
type ReconcileResult struct {
	OK           bool  // both invariants hold within tolerance
	UnitsOK      bool  // Σ per-user units == recorded total units
	AUMOK        bool  // |AUM − clearing balance| ≤ tolerance
	UnitDrift    int64 // sumUserUnits − totalUnits (0 when consistent)
	AUMDriftKobo int64 // aumKobo − clearingBalanceKobo
}

// Reconcile checks the two fund invariants. Units must match EXACTLY (units are
// integer and every mint/redeem writes both the per-user row and the total in one
// transaction — any drift is a bug, not rounding). AUM may differ from the
// clearing balance by at most toleranceKobo (sub-unit valuation dust).
func Reconcile(sumUserUnits, totalUnits, aumKobo, clearingBalanceKobo, toleranceKobo int64) ReconcileResult {
	unitDrift := sumUserUnits - totalUnits
	aumDrift := aumKobo - clearingBalanceKobo

	tol := toleranceKobo
	if tol < 0 {
		tol = -tol
	}
	absAUM := aumDrift
	if absAUM < 0 {
		absAUM = -absAUM
	}

	unitsOK := unitDrift == 0
	aumOK := absAUM <= tol
	return ReconcileResult{
		OK:           unitsOK && aumOK,
		UnitsOK:      unitsOK,
		AUMOK:        aumOK,
		UnitDrift:    unitDrift,
		AUMDriftKobo: aumDrift,
	}
}
