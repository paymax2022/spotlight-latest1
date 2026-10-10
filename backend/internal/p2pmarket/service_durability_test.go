package p2pmarket

// DB-free reference-implementation tests for the CRASH DURABILITY of the p2p
// layer's ordering over the escrow core (mirroring escrow's
// resolve_durability_test.go): the Service wires SQL + escrow against concrete
// structs with no interface seam and no Postgres in this CI lane, so the
// wave-12 invariants are mirrored here as pure logic against the production
// ordering in service.go:
//
//   - Checkout: the escrow hold commits BEFORE the p2p_orders insert. A failed
//     insert may refund the hold — but ONLY after probing that no committed
//     order references it (F6a); and a replay must never attach a CHECKOUT
//     order to a non-HELD (already-refunded) hold.
//   - RaiseDispute: the escrow side commits first (hold DISPUTED + dispute
//     row), then the order update. A crash between them wedges order=CHECKOUT
//     over a DISPUTED hold — the retry converges because the escrow core
//     returns the persisted dispute on an already-DISPUTED hold (F6b).
//   - Arbitrate: escrow resolves (terminal hold + RESOLVED dispute), then the
//     order finalize commits. A crash between them strands order=DISPUTED —
//     the retry converges via the decision-consistent heal (F6c).

import "testing"

// crashClock stops execution after `at` steps (simulating process death);
// at < 0 means "no crash" (the recovery retry). Mirrors escrow's crashClock.
type crashClock struct{ at, n int }

func (c *crashClock) tick() bool { c.n++; return c.at < 0 || c.n <= c.at }

// p2pLog models the durable side effects of one order's lifecycle: the escrow
// hold's state ("" = not created), whether an OPEN dispute exists, and the
// p2p_orders row keyed by idempotency_key. refunds counts escrow.Refund calls
// that actually moved money — the exactly-once / never-drain-owned invariant.
type p2pLog struct {
	holdState string            // "" | HELD | DISPUTED | RELEASED | REFUNDED
	dispute   bool              // OPEN dispute row exists
	orders    map[string]string // idemKey -> order state ("" absent)
	refunds   int
}

func newP2PLog() *p2pLog { return &p2pLog{orders: map[string]string{}} }

// holdReferenced mirrors the production probe: any committed order pointing at
// this hold blocks the best-effort refund.
func (e *p2pLog) holdReferenced() bool {
	for _, st := range e.orders {
		if st != "" {
			return true
		}
	}
	return false
}

// runCheckout mirrors the FIXED Checkout ordering (service.go). failInsert
// forces the p2p_orders Exec to error; raceCommitted models a same-key retry
// committing between the orderByIdem read and the failed insert — the exact
// F6a drain scenario.
func runCheckout(e *p2pLog, idem string, failInsert, raceCommitted bool, cc *crashClock) {
	if e.orders[idem] != "" {
		return // idempotent replay: return the persisted order
	}
	if e.holdState == "" {
		e.holdState = "HELD" // escrow hold commits first (idempotent on idem)
	}
	if e.holdState != "HELD" {
		return // fail closed: never attach an order to terminal money
	}
	if !cc.tick() {
		return // crash: hold committed, order insert never attempted
	}
	if failInsert {
		// Probe before refund: a committed order referencing this hold —
		// committed by a racing same-key retry — makes the hold untouchable.
		if raceCommitted && e.orders[idem] == "" {
			e.orders[idem] = "CHECKOUT"
		}
		if e.orders[idem] != "" {
			return // same-key order exists: return persisted, no refund
		}
		if e.holdReferenced() {
			return // hold may be owned: leave HELD for recon, no refund
		}
		e.holdState = "REFUNDED"
		e.refunds++
		return
	}
	e.orders[idem] = "CHECKOUT"
}

// runCheckoutOldBroken mirrors the PRE-FIX ordering: the refund ran blind on
// any insert error — draining a hold a racing committed order referenced.
func runCheckoutOldBroken(e *p2pLog, idem string, failInsert, raceCommitted bool, cc *crashClock) {
	if e.orders[idem] != "" {
		return
	}
	if e.holdState == "" {
		e.holdState = "HELD"
	}
	if !cc.tick() {
		return
	}
	if failInsert {
		if raceCommitted && e.orders[idem] == "" {
			e.orders[idem] = "CHECKOUT"
		}
		e.holdState = "REFUNDED" // pre-fix: refund unconditional on insert error
		e.refunds++
		return
	}
	e.orders[idem] = "CHECKOUT"
}

// TestCheckout_CrashAfterHold_HealsOnRetry: the hold commits, the process dies
// before the order insert — a retry must create the order over the SAME
// (still-HELD) hold and refund nothing.
func TestCheckout_CrashAfterHold_HealsOnRetry(t *testing.T) {
	for crashAt := range 2 {
		e := newP2PLog()
		runCheckout(e, "idem-A", false, false, &crashClock{at: crashAt})
		runCheckout(e, "idem-A", false, false, &crashClock{at: -1})
		if e.orders["idem-A"] != "CHECKOUT" {
			t.Fatalf("crashAt=%d: order = %q, want CHECKOUT", crashAt, e.orders["idem-A"])
		}
		if e.refunds != 0 {
			t.Fatalf("crashAt=%d: refunds = %d, want 0 — the committed hold must not be drained", crashAt, e.refunds)
		}
		if e.holdState != "HELD" {
			t.Fatalf("crashAt=%d: hold = %s, want HELD (owned by the order)", crashAt, e.holdState)
		}
	}
}

// TestCheckout_InsertFailure_RefundsOnlyUnownedHold: a genuine insert failure
// refunds the orphan hold exactly once; the same-key retry then refuses to
// attach an order to the refunded money (the pre-fix zombie-order wedge).
func TestCheckout_InsertFailure_RefundsOnlyUnownedHold(t *testing.T) {
	e := newP2PLog()
	runCheckout(e, "idem-B", true, false, &crashClock{at: -1})
	if e.holdState != "REFUNDED" || e.refunds != 1 {
		t.Fatalf("unowned hold must refund exactly once: state=%s refunds=%d", e.holdState, e.refunds)
	}
	runCheckout(e, "idem-B", false, false, &crashClock{at: -1}) // client retries same key
	if e.orders["idem-B"] != "" {
		t.Fatal("retry attached a CHECKOUT order to refunded money — the wedge the fix prevents")
	}
	if e.refunds != 1 {
		t.Fatalf("refunds = %d, want exactly 1", e.refunds)
	}
}

// TestCheckout_InsertFailure_CommittedOrder_NeverDrains pins F6a: when the
// insert fails BECAUSE a racing retry already committed the order, the probe
// finds it and no refund runs — the hold stays owned by that order.
func TestCheckout_InsertFailure_CommittedOrder_NeverDrains(t *testing.T) {
	e := newP2PLog()
	runCheckout(e, "idem-C", true, true, &crashClock{at: -1})
	if e.orders["idem-C"] != "CHECKOUT" {
		t.Fatalf("racing order = %q, want CHECKOUT preserved", e.orders["idem-C"])
	}
	if e.holdState != "HELD" {
		t.Fatalf("hold = %s, want HELD — a refund must never drain an owned hold", e.holdState)
	}
	if e.refunds != 0 {
		t.Fatalf("refunds = %d, want 0", e.refunds)
	}
}

// TestCheckout_OldOrdering_DrainedOwnedHold is the witness that the mirror
// reproduces the pre-fix defect the probe now prevents.
func TestCheckout_OldOrdering_DrainedOwnedHold(t *testing.T) {
	e := newP2PLog()
	runCheckoutOldBroken(e, "idem-D", true, true, &crashClock{at: -1})
	if e.holdState != "REFUNDED" || e.orders["idem-D"] != "CHECKOUT" {
		t.Fatal("precondition: old path refunded a hold a committed order references")
	}
	if e.refunds != 1 {
		t.Fatal("old path must have issued the drain — mirror does not reproduce the bug")
	}
}

// runRaiseDispute mirrors the FIXED RaiseDispute ordering: the escrow side
// commits (hold DISPUTED + dispute row, atomically), then the order update —
// with the escrow replay returning the persisted dispute on a DISPUTED hold.
func runRaiseDispute(e *p2pLog, idem string, cc *crashClock) {
	if e.orders[idem] == "DISPUTED" {
		if !e.dispute {
			return // inconsistent: order DISPUTED, no open dispute — recon
		}
		return // converged replay: no-op success
	}
	if e.orders[idem] != "CHECKOUT" {
		return // only an in-escrow order can be disputed
	}
	// escrow.RaiseDispute: already-DISPUTED returns the existing dispute
	// (the F6b heal) instead of erroring the retry.
	if e.holdState != "DISPUTED" {
		e.holdState = "DISPUTED"
		e.dispute = true
	}
	if !cc.tick() {
		return // crash: escrow committed, order update never ran — the wedge
	}
	e.orders[idem] = "DISPUTED"
}

// TestRaiseDispute_CrashAfterEscrowCommit_Converges: order stuck CHECKOUT over
// a DISPUTED hold heals on retry — escrow returns the persisted dispute and
// the order update lands.
func TestRaiseDispute_CrashAfterEscrowCommit_Converges(t *testing.T) {
	for crashAt := range 2 {
		e := newP2PLog()
		e.holdState = "HELD"
		e.orders["idem-E"] = "CHECKOUT"
		runRaiseDispute(e, "idem-E", &crashClock{at: crashAt})
		runRaiseDispute(e, "idem-E", &crashClock{at: -1})
		if e.orders["idem-E"] != "DISPUTED" {
			t.Fatalf("crashAt=%d: order = %q, want DISPUTED", crashAt, e.orders["idem-E"])
		}
		if e.holdState != "DISPUTED" || !e.dispute {
			t.Fatalf("crashAt=%d: hold=%s dispute=%v — escrow state must stay consistent", crashAt, e.holdState, e.dispute)
		}
	}
}

// runArbitrate mirrors the FIXED Arbitrate ordering: escrow resolves (terminal
// hold + dispute RESOLVED), then the order finalize — plus the
// decision-consistent no-op on a finalized order.
func runArbitrate(e *p2pLog, idem, decision string, cc *crashClock) {
	want := "CONFIRMED"
	if decision == "REFUND" {
		want = "REFUNDED"
	}
	if e.orders[idem] != "DISPUTED" {
		if e.orders[idem] == want {
			return // converged replay: no-op success
		}
		return // not a disputable/finalizable state for this decision
	}
	// escrow.Arbitrate: on a DISPUTED hold it resolves; on a decision-
	// consistent terminal hold it no-ops (the heal path); a contradicting
	// terminal state fails before money moves.
	if e.holdState == "DISPUTED" {
		if decision == "RELEASE" {
			e.holdState = "RELEASED"
		} else {
			e.holdState = "REFUNDED"
		}
		e.dispute = false // dispute row marked RESOLVED
	} else if holdWant := map[string]string{"RELEASE": "RELEASED", "REFUND": "REFUNDED"}[decision]; e.holdState != holdWant {
		return // terminal mismatch — fail closed (already resolved differently)
	}
	if !cc.tick() {
		return // crash: escrow resolved, order finalize never ran — the wedge
	}
	e.orders[idem] = want
}

// TestArbitrate_CrashAfterEscrowResolve_Converges: order stuck DISPUTED over
// resolved money heals on retry — escrow no-ops on the consistent terminal
// state and the order finalize lands.
func TestArbitrate_CrashAfterEscrowResolve_Converges(t *testing.T) {
	for crashAt := range 2 {
		for _, decision := range []string{"RELEASE", "REFUND"} {
			e := newP2PLog()
			e.holdState = "DISPUTED"
			e.dispute = true
			e.orders["idem-F"] = "DISPUTED"
			runArbitrate(e, "idem-F", decision, &crashClock{at: crashAt})
			runArbitrate(e, "idem-F", decision, &crashClock{at: -1})
			want := "CONFIRMED"
			if decision == "REFUND" {
				want = "REFUNDED"
			}
			if e.orders["idem-F"] != want {
				t.Fatalf("crashAt=%d decision=%s: order = %q, want %s", crashAt, decision, e.orders["idem-F"], want)
			}
			if e.dispute {
				t.Fatalf("crashAt=%d decision=%s: dispute must be RESOLVED", crashAt, decision)
			}
		}
	}
}

// TestArbitrate_ReplayFinalizedOrder_NoOpAndFailClosed: a retry of a fully
// converged arbitration is a no-op for the same decision and fails closed for
// the opposite one.
func TestArbitrate_ReplayFinalizedOrder_NoOpAndFailClosed(t *testing.T) {
	e := newP2PLog()
	e.holdState = "DISPUTED"
	e.dispute = true
	e.orders["idem-G"] = "DISPUTED"
	runArbitrate(e, "idem-G", "RELEASE", &crashClock{at: -1})
	if e.orders["idem-G"] != "CONFIRMED" {
		t.Fatal("precondition: arbitration finalized")
	}
	releases := e.holdState
	runArbitrate(e, "idem-G", "RELEASE", &crashClock{at: -1}) // same decision: no-op
	if e.holdState != releases {
		t.Fatal("a converged replay must not move the hold again")
	}
	holdBefore, orderBefore := e.holdState, e.orders["idem-G"]
	runArbitrate(e, "idem-G", "REFUND", &crashClock{at: -1}) // contradicting: fail closed
	if e.holdState != holdBefore || e.orders["idem-G"] != orderBefore {
		t.Fatal("a contradicting decision must not touch order or hold")
	}
}
