package crypto

// PURE money-path invariant tests — no live DB.
//
// The crypto Repository is pgx-backed (repository.go / repository_ext.go), so the
// order-fill, holding-projection and withdrawal-persistence write paths cannot run
// without Postgres and are NOT exercised here (see the header note at the bottom for
// what still needs a live-DB integration test). What IS exercised is every PURE
// money primitive the service layer relies on:
//
//   - unitsForCash / cashForUnits: integer-only unit<->cash conversion + the int64
//     overflow guard (big.Int intermediate, fail-closed to 0). These are the exact
//     helpers service.go / service_ext.go call to size fills and swaps.
//   - the swap spread formula (cash*bps/10_000, net = cash - spread) transcribed
//     from service_ext.go priceSwap so the conservation "sell cash = buy cash +
//     retained spread" is pinned.
//   - networkFeeUnits: the in-asset miner-fee floor.
//   - canTransitionWithdrawal: the guarded AML withdrawal FSM (legal transitions
//     succeed, illegal skips rejected, terminal states reject).
//
// All symbols under test are unexported, so this file is in-package (package crypto).

import "testing"

// ---------------------------------------------------------------------------
// unit <-> cash conversion (iron rule: integers only, truncate, never over-credit)
// ---------------------------------------------------------------------------

// TestUnitsForCash_ExactAndTruncating verifies the buy-side sizing: units are
// cashKobo*scale/priceKobo with integer truncation, so the buyer is never
// OVER-credited units. priceKobo is per one whole unit; scale is minor units per
// whole unit.
func TestUnitsForCash_ExactAndTruncating(t *testing.T) {
	const scale = 100_000_000 // 1e8 minor units per whole unit (BTC-style)

	// price 100 kobo per whole unit, scale 1: 500 kobo buys 5 whole units.
	if got := unitsForCash(500, 100, 1); got != 5 {
		t.Errorf("unitsForCash(500,100,1) = %d, want 5", got)
	}
	// Truncation: 550 kobo at price 100 => 5.5 => truncated to 5, never 6.
	if got := unitsForCash(550, 100, 1); got != 5 {
		t.Errorf("unitsForCash(550,100,1) = %d, want 5 (must truncate, never over-credit)", got)
	}
	// Large scale: 1 kobo at price 1 with scale 1e8 => 1e8 minor units.
	if got := unitsForCash(1, 1, scale); got != scale {
		t.Errorf("unitsForCash(1,1,%d) = %d, want %d", scale, got, scale)
	}
}

// TestUnitsForCash_FailClosedOnBadInputs verifies non-positive price/scale yield 0
// (never a divide-by-zero panic, never a negative/garbage credit).
func TestUnitsForCash_FailClosedOnBadInputs(t *testing.T) {
	for _, c := range []struct{ cash, price, scale int64 }{
		{100, 0, 1},   // zero price
		{100, -5, 1},  // negative price
		{100, 10, 0},  // zero scale
		{100, 10, -1}, // negative scale
	} {
		if got := unitsForCash(c.cash, c.price, c.scale); got != 0 {
			t.Errorf("unitsForCash(%d,%d,%d) = %d, want 0 (fail-closed)", c.cash, c.price, c.scale, got)
		}
	}
}

// TestUnitsForCash_OverflowGuard verifies cashKobo*scale is computed via a big.Int
// intermediate and fails closed (returns 0) rather than silently wrapping int64 to a
// wrong (possibly huge) unit count. This is the guard the model comment promises.
func TestUnitsForCash_OverflowGuard(t *testing.T) {
	const maxI64 = int64(9_223_372_036_854_775_807)
	// cash * scale overflows int64 hugely; result quotient would still be enormous
	// and MUST be reported as non-representable => 0, not a wrapped value.
	if got := unitsForCash(maxI64, 1, maxI64); got != 0 {
		t.Errorf("unitsForCash overflow case = %d, want 0 (must fail closed on int64 overflow)", got)
	}
}

// TestCashForUnits_ExactAndTruncating verifies the sell/valuation side: cash is
// units*priceKobo/scale with truncation.
func TestCashForUnits_ExactAndTruncating(t *testing.T) {
	// 5 whole units (scale 1) at 100 kobo each => 500 kobo.
	if got := cashForUnits(5, 100, 1); got != 500 {
		t.Errorf("cashForUnits(5,100,1) = %d, want 500", got)
	}
	// 1e8 minor units at price 100 with scale 1e8 => 100 kobo (one whole unit).
	const scale = 100_000_000
	if got := cashForUnits(scale, 100, scale); got != 100 {
		t.Errorf("cashForUnits(1e8,100,1e8) = %d, want 100", got)
	}
	// Truncation: 3 minor units, price 100, scale 2 => 300/2 = 150 exact; 3*100/7 => 42.
	if got := cashForUnits(3, 100, 7); got != 42 {
		t.Errorf("cashForUnits(3,100,7) = %d, want 42 (truncated)", got)
	}
}

// TestCashForUnits_FailClosedOnBadScale verifies scale<=0 yields 0 (no panic).
func TestCashForUnits_FailClosedOnBadScale(t *testing.T) {
	if got := cashForUnits(1000, 100, 0); got != 0 {
		t.Errorf("cashForUnits with scale 0 = %d, want 0", got)
	}
	if got := cashForUnits(1000, 100, -5); got != 0 {
		t.Errorf("cashForUnits with negative scale = %d, want 0", got)
	}
}

// TestCashForUnits_OverflowGuard pins the KNOWN cashForUnits overflow guard: the
// units*priceKobo product is taken in big.Int and, if the quotient is not int64
// representable, the function fails closed to 0 rather than wrapping to a wrong cash
// value. A wrapped value here would let a huge holding be valued as a small (or
// negative) cash amount — a mispricing / theft vector.
func TestCashForUnits_OverflowGuard(t *testing.T) {
	const maxI64 = int64(9_223_372_036_854_775_807)
	// units * price = maxI64 * maxI64 (astronomically over int64); with scale 1 the
	// quotient is still non-representable and MUST be reported as 0.
	if got := cashForUnits(maxI64, maxI64, 1); got != 0 {
		t.Errorf("cashForUnits overflow case = %d, want 0 (must fail closed on int64 overflow)", got)
	}
}

// TestUnitsCashRoundTrip verifies cash -> units -> cash never INFLATES value: after
// buying units for some cash and re-valuing at the same price, the recovered cash is
// <= the cash spent (truncation only ever loses fractions, never mints value).
func TestUnitsCashRoundTrip(t *testing.T) {
	const scale = 100_000_000
	for _, price := range []int64{1, 37, 1_000, 5_000_000} {
		for _, cash := range []int64{1, 999, 250_000, 9_999_999} {
			units := unitsForCash(cash, price, scale)
			recovered := cashForUnits(units, price, scale)
			if recovered > cash {
				t.Errorf("round trip inflated value: cash=%d price=%d units=%d recovered=%d (must be <= cash)",
					cash, price, units, recovered)
			}
		}
	}
}

// ---------------------------------------------------------------------------
// swap spread math (transcribed from service_ext.go priceSwap, lines ~60-64)
// ---------------------------------------------------------------------------

// swapSpread mirrors priceSwap: spreadKobo = cashKobo*spreadBps/10_000 and the buy
// leg receives netCash = cashKobo - spreadKobo. Kept here as a transcription so a
// drift between production and this expectation is caught. See DOC note: the real
// priceSwap is pgx-quote-backed and cannot run without a DB, but this arithmetic is
// the money-conserving core.
func swapSpread(cashKobo int64, spreadBps int) (spreadKobo, netCash int64) {
	spreadKobo = cashKobo * int64(spreadBps) / 10_000
	netCash = cashKobo - spreadKobo
	return
}

// TestSwapSpread_Conserves verifies the swap conservation invariant: the sell-leg
// cash equals the buy-leg cash PLUS the retained spread — no NGN is minted, the
// spread is revenue, and net wallet delta is zero (matches the ledger legs the
// service posts: escrow credit cashKobo, wallet debit netCash + spread).
func TestSwapSpread_Conserves(t *testing.T) {
	for _, cash := range []int64{0, 1, 199, 10_000, 500_000_00, 999_999_999} {
		spread, net := swapSpread(cash, DefaultSwapSpreadBps)
		if net+spread != cash {
			t.Errorf("swap does not conserve: cash=%d net=%d spread=%d (net+spread must == cash)", cash, net, spread)
		}
		if spread < 0 || net < 0 {
			t.Errorf("swap legs must be non-negative: cash=%d net=%d spread=%d", cash, net, spread)
		}
		if net > cash {
			t.Errorf("buy leg %d must not exceed sell cash %d", net, cash)
		}
	}
}

// TestDefaultSwapSpreadBps_Sane locks the default spread to a positive, sub-100%
// basis-point value (50 bps documented).
func TestDefaultSwapSpreadBps_Sane(t *testing.T) {
	if DefaultSwapSpreadBps <= 0 {
		t.Errorf("DefaultSwapSpreadBps must be positive, got %d", DefaultSwapSpreadBps)
	}
	if DefaultSwapSpreadBps >= 10_000 {
		t.Errorf("DefaultSwapSpreadBps must be < 10000 (100%%), got %d", DefaultSwapSpreadBps)
	}
}

// ---------------------------------------------------------------------------
// networkFeeUnits (in-asset miner fee floor, service_ext.go)
// ---------------------------------------------------------------------------

// TestNetworkFeeUnits verifies the 0.05% fee (units/2000) floored at one minor unit.
func TestNetworkFeeUnits(t *testing.T) {
	// Below the 2000-unit threshold the floor of 1 minor unit applies.
	if got := networkFeeUnits(0); got != 1 {
		t.Errorf("networkFeeUnits(0) = %d, want 1 (floored)", got)
	}
	if got := networkFeeUnits(1999); got != 1 {
		t.Errorf("networkFeeUnits(1999) = %d, want 1 (floored)", got)
	}
	// At/above the threshold the percentage applies.
	if got := networkFeeUnits(2000); got != 1 {
		t.Errorf("networkFeeUnits(2000) = %d, want 1", got)
	}
	if got := networkFeeUnits(4000); got != 2 {
		t.Errorf("networkFeeUnits(4000) = %d, want 2", got)
	}
	if got := networkFeeUnits(1_000_000); got != 500 {
		t.Errorf("networkFeeUnits(1_000_000) = %d, want 500", got)
	}
	// The fee is always strictly positive so a withdrawal can never dodge it.
	for _, u := range []int64{0, 1, 100, 2000, 1_000_000_000} {
		if networkFeeUnits(u) < 1 {
			t.Errorf("networkFeeUnits(%d) must be >= 1", u)
		}
	}
}

// ---------------------------------------------------------------------------
// withdrawal state machine (guarded FSM — AML gate before any provider dispatch)
// ---------------------------------------------------------------------------

// TestWithdrawalFSM_LegalTransitions verifies every intended edge is permitted:
// requested -> pending_review -> approved -> broadcast -> confirmed, plus the reject
// edge (-> failed) reachable from every non-terminal state (returns parked units).
func TestWithdrawalFSM_LegalTransitions(t *testing.T) {
	legal := [][2]string{
		{WithdrawalRequested, WithdrawalPendingReview},
		{WithdrawalRequested, WithdrawalFailed},
		{WithdrawalPendingReview, WithdrawalApproved},
		{WithdrawalPendingReview, WithdrawalFailed},
		{WithdrawalApproved, WithdrawalBroadcast},
		{WithdrawalApproved, WithdrawalFailed},
		{WithdrawalBroadcast, WithdrawalConfirmed},
		{WithdrawalBroadcast, WithdrawalFailed},
	}
	for _, e := range legal {
		if !canTransitionWithdrawal(e[0], e[1]) {
			t.Errorf("expected legal withdrawal transition %s -> %s to be allowed", e[0], e[1])
		}
	}
}

// TestWithdrawalFSM_IllegalSkipsRejected verifies the AML gate cannot be skipped:
// requested MUST NOT jump straight to approved/broadcast/confirmed, and no path may
// reach broadcast/confirmed without first passing approved. Money can only leave
// AFTER a compliance approval — these are the transitions that enforce that.
func TestWithdrawalFSM_IllegalSkipsRejected(t *testing.T) {
	illegal := [][2]string{
		{WithdrawalRequested, WithdrawalApproved},   // skips AML review
		{WithdrawalRequested, WithdrawalBroadcast},  // skips review + approval (money out!)
		{WithdrawalRequested, WithdrawalConfirmed},  // skips everything
		{WithdrawalPendingReview, WithdrawalBroadcast}, // skips approval
		{WithdrawalPendingReview, WithdrawalConfirmed},
		{WithdrawalApproved, WithdrawalConfirmed},   // skips broadcast
		{WithdrawalBroadcast, WithdrawalApproved},   // backwards
		{WithdrawalPendingReview, WithdrawalRequested}, // backwards
	}
	for _, e := range illegal {
		if canTransitionWithdrawal(e[0], e[1]) {
			t.Errorf("expected ILLEGAL withdrawal transition %s -> %s to be rejected", e[0], e[1])
		}
	}
}

// TestWithdrawalFSM_TerminalStatesReject verifies confirmed and failed are terminal:
// no outgoing transition (including to themselves) is permitted, so a confirmed
// withdrawal cannot be re-broadcast and a failed one cannot silently resurrect.
func TestWithdrawalFSM_TerminalStatesReject(t *testing.T) {
	allStates := []string{
		WithdrawalRequested, WithdrawalPendingReview, WithdrawalApproved,
		WithdrawalBroadcast, WithdrawalConfirmed, WithdrawalFailed,
	}
	for _, terminal := range []string{WithdrawalConfirmed, WithdrawalFailed} {
		for _, to := range allStates {
			if canTransitionWithdrawal(terminal, to) {
				t.Errorf("terminal state %s must reject transition to %s", terminal, to)
			}
		}
	}
}

// TestWithdrawalFSM_UnknownStateRejects verifies an unrecognised current state is
// fail-closed (no transitions), so a corrupted/unexpected status can never advance.
func TestWithdrawalFSM_UnknownStateRejects(t *testing.T) {
	if canTransitionWithdrawal("bogus", WithdrawalApproved) {
		t.Error("unknown source state must not permit any transition")
	}
	if canTransitionWithdrawal(WithdrawalRequested, "bogus") {
		t.Error("transition to an unknown target must be rejected")
	}
}

// ---------------------------------------------------------------------------
// DOC — needs a live-DB integration test (no injectable seam here):
//
//   - Order fill (service.go Buy/Sell): the ledger legs (wallet debit -> escrow /
//     credit) + holding projection + the unique idempotency partial index that makes
//     a replayed fill a no-op are all pgx-backed. Assert: a replayed idem key does
//     not double-debit, and the holding == SUM(fills) projection.
//   - Swap execution (service_ext.go Swap): the three ledger legs (sell credit, buy
//     debit netCash, spread debit) and the oversell fail-closed path.
//   - Withdraw parking (service_ext.go Withdraw): units leave the holding into the
//     row, the fee debit to paymax_revenue, and that the member path STOPS at
//     pending_review without any provider dispatch (the AML gate).
//   - Reject-returns-units: pending_review/approved -> failed must credit the parked
//     units back to the holding (conservation). Only assertable against the DB.
// ---------------------------------------------------------------------------
