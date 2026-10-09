package escrow

// DB-free reference-implementation tests for the money-path CRASH DURABILITY of
// resolve() (service.go), mirroring the top5events service_durability_test.go
// pattern: the Service wires SQL + ledger against concrete structs with no
// interface seam and no Postgres in this CI lane, so the invariant that matters
// — "a crash between the state commit and the ledger credit never strands a
// beneficiary unpaid, and a retry converges to exactly-once" — is mirrored here
// as pure logic against the production ordering.
//
// Production source of truth (service.go resolve / ensureResolutionCredit):
//   - fresh call : FOR UPDATE row -> flip terminal state + commit -> credit leg.
//   - replay call: from == to -> verify the credit via ledger.Posted, post it if
//     missing, THEN return success. (The pre-fix code returned nil here, which
//     is exactly the stranded-payee defect this test guards.)

import "testing"

// resolveLog models the durable side effects as idempotent, replay-counted
// stores, mirroring the production idempotency keys: the hold's terminal state
// mark (escrow_holds.state), the recorded payee_id (authoritative beneficiary
// on replay), and the per-leg ledger post (deduped on "<idem>:release|refund" —
// a ledger post applies at most once per key).
type resolveLog struct {
	state   string         // committed escrow_holds.state
	payee   *string        // stored payee_id
	ledger  map[string]int // idempotency key -> times applied (invariant: <= 1)
	balance map[string]int64
}

func newResolveLog() *resolveLog {
	return &resolveLog{state: "HELD", ledger: map[string]int{}, balance: map[string]int64{}}
}

// post mirrors an idempotent ledger post: first call applies; later calls with
// the same key dedup to no-ops (the ErrDuplicate-is-success contract).
func (e *resolveLog) post(key, beneficiary string, amount int64) {
	if e.ledger[key] == 0 {
		e.ledger[key] = 1
		e.balance[beneficiary] += amount
	}
}
func (e *resolveLog) posted(key string) bool { return e.ledger[key] > 0 }

func (e *resolveLog) storedPayee() string {
	if e.payee == nil {
		return "<missing-payee>" // production fails loudly rather than guess
	}
	return *e.payee
}

// crashClock stops execution after `at` steps (simulating a process death);
// at < 0 means "no crash" (the recovery retry).
type crashClock struct{ at, n int }

func (c *crashClock) tick() bool { c.n++; return c.at < 0 || c.n <= c.at }

// runResolve mirrors the FIXED resolve(): the from==to replay runs the money-leg
// check (ensureResolutionCredit) instead of returning early unpaid. argPayee is
// the caller-supplied payee on THIS attempt — only a fresh RELEASED transition
// may record it; a replay pays the STORED beneficiary and ignores it.
func runResolve(e *resolveLog, idem, argPayee string, amount int64, cc *crashClock) {
	switch e.state {
	case "RELEASED", "REFUNDED":
		// Replay of an already-terminal hold: heal the money leg if missing.
		key, beneficiary := idem+":refund", "payer"
		if e.state == "RELEASED" {
			key, beneficiary = idem+":release", e.storedPayee()
		}
		if !e.posted(key) {
			if !cc.tick() {
				return
			}
			e.post(key, beneficiary, amount)
		}
		return
	case "HELD", "DISPUTED":
		// Fresh transition — the caller picks the resolution (argPayee != ""
		// models Release; "" models Refund).
	default:
		return // illegal transition on an unknown state
	}

	if !cc.tick() {
		return
	}
	key, beneficiary := idem+":refund", "payer"
	if argPayee != "" {
		e.state, e.payee = "RELEASED", &argPayee
		key, beneficiary = idem+":release", argPayee
	} else {
		e.state = "REFUNDED"
	}
	// State committed — now the money leg (the ledger's own tx).
	if !cc.tick() {
		return
	}
	if !e.posted(key) {
		e.post(key, beneficiary, amount)
	}
}

// runResolveOldBroken mirrors the PRE-FIX ordering: the from==to early return
// skipped the money leg entirely, so a crash after the state commit stranded
// the beneficiary forever — the defect this fix removes.
func runResolveOldBroken(e *resolveLog, idem, argPayee string, amount int64, cc *crashClock) {
	if e.state == "RELEASED" || e.state == "REFUNDED" {
		return // pre-fix: idempotent early return — never re-attempts the credit
	}
	if !cc.tick() {
		return
	}
	key, beneficiary := idem+":refund", "payer"
	if argPayee != "" {
		e.state = "RELEASED"
		key, beneficiary = idem+":release", argPayee
	} else {
		e.state = "REFUNDED"
	}
	if !cc.tick() {
		return
	}
	e.post(key, beneficiary, amount)
}

// TestResolve_CrashBetweenCommitAndCredit_HealsOnRetry drives a crash at EVERY
// step of the fixed ordering: whatever survives, a retry must converge to
// terminal state + exactly-once credit to the recorded beneficiary. The
// load-bearing invariant: a RELEASED/REFUNDED state may NEVER persist with its
// money leg missing once a resolve call has completed successfully.
func TestResolve_CrashBetweenCommitAndCredit_HealsOnRetry(t *testing.T) {
	const amount int64 = 400_000
	for crashAt := range 4 {
		e := newResolveLog()
		runResolve(e, "idem-X", "payee-1", amount, &crashClock{at: crashAt}) // crash mid-flight
		runResolve(e, "idem-X", "payee-1", amount, &crashClock{at: -1})      // retry to completion

		if e.state != "RELEASED" {
			t.Fatalf("crashAt=%d: converged state %q, want RELEASED", crashAt, e.state)
		}
		if e.ledger["idem-X:release"] != 1 {
			t.Fatalf("crashAt=%d: release posted %d times, want exactly 1 (lost or double-paid)", crashAt, e.ledger["idem-X:release"])
		}
		if e.balance["payee-1"] != amount {
			t.Fatalf("crashAt=%d: payee balance %d, want %d", crashAt, e.balance["payee-1"], amount)
		}
		// The invariant that was broken: terminal state without the money leg.
		if (e.state == "RELEASED" && !e.posted("idem-X:release")) ||
			(e.state == "REFUNDED" && !e.posted("idem-X:refund")) {
			t.Fatalf("crashAt=%d: INVARIANT VIOLATED — %s committed with no credit", crashAt, e.state)
		}
	}
}

// TestResolve_CrashOnRefundPath_HealsOnRetry is the REFUNDED counterpart — the
// payer (not a payee) is the healed beneficiary.
func TestResolve_CrashOnRefundPath_HealsOnRetry(t *testing.T) {
	const amount int64 = 75_000
	for crashAt := range 4 {
		e := newResolveLog()
		runResolve(e, "idem-R", "", amount, &crashClock{at: crashAt})
		runResolve(e, "idem-R", "", amount, &crashClock{at: -1})

		if e.state != "REFUNDED" {
			t.Fatalf("crashAt=%d: converged state %q, want REFUNDED", crashAt, e.state)
		}
		if e.ledger["idem-R:refund"] != 1 {
			t.Fatalf("crashAt=%d: refund posted %d times, want exactly 1", crashAt, e.ledger["idem-R:refund"])
		}
		if e.balance["payer"] != amount {
			t.Fatalf("crashAt=%d: payer balance %d, want %d", crashAt, e.balance["payer"], amount)
		}
	}
}

// TestResolve_ReplayPaysStoredPayee pins that a re-resolve cannot redirect the
// payout: the beneficiary is the recorded payee_id, not the replay's argument.
func TestResolve_ReplayPaysStoredPayee(t *testing.T) {
	const amount int64 = 50_000
	e := newResolveLog()
	// First attempt commits RELEASED to payee-A but dies before the credit.
	runResolve(e, "idem-Y", "payee-A", amount, &crashClock{at: 1})
	// Retry arrives with a DIFFERENT payee argument — must still pay payee-A.
	runResolve(e, "idem-Y", "attacker-B", amount, &crashClock{at: -1})

	if e.balance["attacker-B"] != 0 {
		t.Fatalf("replay redirected funds to the caller's payee argument: got %d", e.balance["attacker-B"])
	}
	if e.balance["payee-A"] != amount {
		t.Fatalf("stored payee balance %d, want %d", e.balance["payee-A"], amount)
	}
}

// TestResolve_OldOrdering_StrandsMoney documents the pre-fix defect so the
// mirror proves it models the real ordering (kept as a witness, same as
// top5events' runSettleOldBroken).
func TestResolve_OldOrdering_StrandsMoney(t *testing.T) {
	const amount int64 = 10_000
	e := newResolveLog()
	runResolveOldBroken(e, "idem-Z", "payee-1", amount, &crashClock{at: 1}) // crash after commit
	runResolveOldBroken(e, "idem-Z", "payee-1", amount, &crashClock{at: -1})

	if e.state != "RELEASED" {
		t.Fatal("precondition: old path commits RELEASED")
	}
	if e.posted("idem-Z:release") {
		t.Fatal("old path unexpectedly paid the payee; mirror does not reproduce the bug")
	}
}
