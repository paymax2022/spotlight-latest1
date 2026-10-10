package escrow

// DB-free reference-implementation tests for the money-path CRASH DURABILITY of
// Hold() (service.go), mirroring resolve_durability_test.go: the Service wires
// SQL + ledger against concrete structs with no interface seam and no Postgres
// in this CI lane, so the invariant that matters — "a crash between the ledger
// debit and the escrow_holds insert never strands parked funds, and a retry
// converges to exactly-once" — is mirrored here as pure logic against the
// production ordering.
//
// Production source of truth (service.go Hold / postHoldDebit /
// verifyHoldDebitLeg):
//   - fresh call : getByIdem miss -> ledger.Posted probe miss -> tier gate ->
//     debit leg ("<idem>:hold", ref "escrow:<module>:<reference>") -> INSERT
//     escrow_holds.
//   - heal call  : getByIdem miss -> Posted hit -> identity check (both legs +
//     payer wallet + module segment) -> skip gate AND debit -> INSERT heals
//     the row. (The pre-fix code re-ran the gate and re-debited: the Redis
//     idem-lock answered ErrDuplicate inside its TTL and the gate re-counted
//     the posted debit against the daily cap — the wedge this test guards.)
//   - row replay : getByIdem hit -> module + payer identity check -> return
//     row. Cross-module/cross-payer claims refuse (covered live in
//     hold_recovery_live_db_test.go; this mirror models the payer leg only).

import "testing"

// holdLog models the durable side effects as idempotent stores, mirroring the
// production idempotency keys: the "<idem>:hold" ledger pair (applied at most
// once per key, and carrying the DEBITED payer's wallet identity — the heal
// path must verify the claimant is that payer) and the escrow_holds row
// (UNIQUE idempotency_key).
type holdLog struct {
	debited   map[string]int    // hold leg key -> times applied (invariant: <= 1)
	debitedBy map[string]string // hold leg key -> payer wallet that funded it
	rows      map[string]bool   // idemKey -> escrow_holds row exists
	balance   map[string]int64  // user -> wallet balance
}

func newHoldLog() *holdLog {
	return &holdLog{debited: map[string]int{}, debitedBy: map[string]string{},
		rows: map[string]bool{}, balance: map[string]int64{}}
}

// debit mirrors an idempotent ledger debit: first call applies (balance moves);
// later calls with the same key dedup to a no-op. tierRefused models the
// fail-closed daily-cap refusal the gate would return once the already-posted
// debit has consumed the payer's allowance.
func (e *holdLog) debit(key, payer string, amount int64) {
	if e.debited[key] == 0 {
		e.debited[key] = 1
		e.debitedBy[key] = payer
		e.balance[payer] -= amount
	}
}
func (e *holdLog) debitPosted(key string) bool { return e.debited[key] > 0 }

// runHold mirrors the FIXED Hold(): on a getByIdem miss it probes the ledger of
// record; an already-posted leg skips the tier gate + re-debit and heals the
// row — but only when BOTH legs verify as THIS caller's journal (the credit
// leg is payer-agnostic, so the debit leg's wallet is the binding check:
// verifyHoldDebitLeg). tierRefused simulates the cap refusal (the posted debit
// counts toward the daily total — re-running the gate on a heal replay can
// only refuse).
func runHold(e *holdLog, idem, payer string, amount int64, tierRefused bool, cc *crashClock) {
	if e.rows[idem] {
		return // full replay: existing row returned
	}
	key := idem + ":hold"
	if !e.debitPosted(key) {
		if tierRefused {
			return // fresh attempt refused by the tier gate — nothing moves
		}
		if !cc.tick() {
			return
		}
		e.debit(key, payer, amount)
	} else if e.debitedBy[key] != payer {
		return // fail closed: the parked debit was funded by a DIFFERENT wallet
	}
	// Ledger leg durable (posted now or on a prior attempt) — the row insert.
	if !cc.tick() {
		return // crash: debit committed, row absent — the wedge state
	}
	e.rows[idem] = true
}

// runHoldOldBroken mirrors the PRE-FIX ordering: no Posted probe, so a retry on
// a crashed hold re-ran the tier gate (which re-counts the posted debit and can
// refuse) and then re-debited — ErrDuplicate inside the Redis-lock TTL. Either
// way the row was never healed: funds stayed parked with no hold row.
func runHoldOldBroken(e *holdLog, idem, payer string, amount int64, tierRefused bool, cc *crashClock) {
	if e.rows[idem] {
		return
	}
	if tierRefused && e.debitPosted(idem+":hold") {
		return // pre-fix: the gate re-counted the posted debit and refused the heal
	}
	key := idem + ":hold"
	if e.debitPosted(key) {
		return // pre-fix: ErrDuplicate propagated — row never inserted
	}
	if !cc.tick() {
		return
	}
	e.debit(key, payer, amount)
	if !cc.tick() {
		return
	}
	e.rows[idem] = true
}

// TestHold_CrashBetweenDebitAndInsert_HealsOnRetry drives a crash at EVERY step
// of the fixed ordering: whatever survives, a retry must converge to exactly
// one debit + exactly one hold row — even when the tier gate would now refuse
// (the posted debit consumed the daily cap).
func TestHold_CrashBetweenDebitAndInsert_HealsOnRetry(t *testing.T) {
	const amount int64 = 400_000
	for crashAt := range 3 {
		for _, tierRefused := range []bool{false, true} {
			e := newHoldLog()
			runHold(e, "idem-H", "payer-1", amount, false, &crashClock{at: crashAt}) // crash mid-flight
			runHold(e, "idem-H", "payer-1", amount, tierRefused, &crashClock{at: -1})

			if crashAt == 0 && tierRefused {
				// Died before the debit ever posted: a gate-refused retry is the
				// CORRECT fail-closed outcome — nothing moved, nothing to heal.
				if e.rows["idem-H"] || e.debited["idem-H:hold"] != 0 || e.balance["payer-1"] != 0 {
					t.Fatalf("crashAt=0 refused retry must leave everything unmoved")
				}
				continue
			}
			if !e.rows["idem-H"] {
				t.Fatalf("crashAt=%d tierRefused=%v: hold row missing after retry — parked funds unreachable", crashAt, tierRefused)
			}
			if e.debited["idem-H:hold"] != 1 {
				t.Fatalf("crashAt=%d tierRefused=%v: hold debit applied %d times, want exactly 1 (lost or double-debited)", crashAt, tierRefused, e.debited["idem-H:hold"])
			}
			if e.balance["payer-1"] != -amount {
				t.Fatalf("crashAt=%d tierRefused=%v: payer balance %d, want %d", crashAt, tierRefused, e.balance["payer-1"], -amount)
			}
		}
	}
}

// TestHold_OldOrdering_WedgesRowInsert documents the pre-fix defect so the
// mirror proves it models the real ordering (kept as a witness, same as
// resolve's runResolveOldBroken).
func TestHold_OldOrdering_WedgesRowInsert(t *testing.T) {
	const amount int64 = 10_000
	e := newHoldLog()
	runHoldOldBroken(e, "idem-W", "payer-1", amount, false, &crashClock{at: 1}) // crash after debit
	if !e.debitPosted("idem-W:hold") || e.rows["idem-W"] {
		t.Fatal("precondition: old path parked the debit with no hold row")
	}
	// Retry under a now-refusing tier gate (the posted debit used up the cap):
	// the old ordering could never heal the row.
	runHoldOldBroken(e, "idem-W", "payer-1", amount, true, &crashClock{at: -1})
	if e.rows["idem-W"] {
		t.Fatal("old path unexpectedly healed the row; mirror does not reproduce the bug")
	}
}

// TestHold_CrossPayerClaimFailsClosed pins the ledger-auditor blocking finding:
// the "<idem>:hold:credit" leg (escrow standing account + reference + amount)
// is IDENTICAL for every payer, so a heal that verified only the credit leg
// would let a different user adopt payer-A's parked debit and write a hold row
// naming THEMSELVES as payer_id — RaiseDispute/Refund control over funds they
// never paid. The debit leg's wallet must bind the claim.
func TestHold_CrossPayerClaimFailsClosed(t *testing.T) {
	const amount int64 = 140_000
	e := newHoldLog()
	runHold(e, "idem-X", "payer-A", amount, false, &crashClock{at: 1}) // crash after A's debit

	// A DIFFERENT user replays the same key/reference/amount — must NOT heal.
	runHold(e, "idem-X", "payer-B", amount, false, &crashClock{at: -1})
	if e.rows["idem-X"] {
		t.Fatal("cross-payer replay attached a hold row to funds it never paid")
	}
	if e.balance["payer-B"] != 0 {
		t.Fatalf("claimant balance %d, want 0 — the failed claim must not move money", e.balance["payer-B"])
	}

	// The honest retry still heals: same payer, same key.
	runHold(e, "idem-X", "payer-A", amount, false, &crashClock{at: -1})
	if !e.rows["idem-X"] {
		t.Fatal("honest payer retry must heal the missing row")
	}
	if e.debited["idem-X:hold"] != 1 {
		t.Fatalf("hold debit applied %d times, want exactly 1", e.debited["idem-X:hold"])
	}
}
