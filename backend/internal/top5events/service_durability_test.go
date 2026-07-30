// DB-free reference-implementation tests for the money-path CRASH DURABILITY of
// SettleVendor, CloseWallet and Purchase (see service.go). Same rationale as
// service_mirror_test.go: the Service wires SQL + ledger/wallet against concrete
// structs with no interface seam and no Postgres in this CI lane, so the invariant
// that matters — "a crash between the ledger post and the DB state-mark never
// strands, loses, or double-moves money, and a same-idempotency-key retry
// converges to exactly-once" — is mirrored here as pure logic against the
// production ordering.
//
// Production source of truth for each mirror:
//   - SettleVendor : post net → post fee → THEN mark settled + commit.
//   - CloseWallet  : credit residual → THEN mark CLOSED + append REFUND + commit.
//   - Purchase     : reserve+PENDING(commit) → debit → PAID → issue ticket; expire
//     (release seat) ONLY when the debit definitively never posted
//     (ledger.Posted), never on the ambiguous error alone.
package top5events_test

import "testing"

// ---------------------------------------------------------------------------
// effectLog models the durable side effects as idempotent, replay-counted stores,
// mirroring the production idempotency keys. A ledger post applies at most once per
// key (ledger.Credit/Debit/PostJournal dedup on idempotency_key); a state mark is
// the DB row transition (settled=true / CLOSED / status='PAID').
// ---------------------------------------------------------------------------

type effectLog struct {
	ledger map[string]int // idempotency key -> times actually applied (invariant: <= 1)
	marks  map[string]int // state-mark key   -> times applied
}

func newEffectLog() *effectLog {
	return &effectLog{ledger: map[string]int{}, marks: map[string]int{}}
}

// post mirrors an idempotent ledger post: the first call applies; later calls with
// the same key are dedup no-ops. Callers treat BOTH outcomes as success (this is
// the production `alreadyApplied` contract).
func (e *effectLog) post(key string) {
	if e.ledger[key] == 0 {
		e.ledger[key] = 1
	}
}
func (e *effectLog) posted(key string) bool { return e.ledger[key] > 0 }
func (e *effectLog) mark(key string)        { e.marks[key]++ }
func (e *effectLog) marked(key string) bool { return e.marks[key] > 0 }

// crashClock stops execution after `at` steps (simulating a process death); at < 0
// means "no crash — run to completion" (the recovery retry).
type crashClock struct {
	at, n int
}

func (c *crashClock) tick() bool { c.n++; return c.at < 0 || c.n <= c.at }

// ===========================================================================
// 1. SettleVendor — ledger legs FIRST, mark settled LAST.
// ===========================================================================

// runSettle mirrors SettleVendor. gross is re-derived from the UNSETTLED float, so
// on a retry after a crash (settled never marked) it is unchanged — the same net/
// fee re-post and dedup rather than double-pay.
func runSettle(e *effectLog, vendorID, idemKey string, grossIfUnsettled, feeBps int64, cc *crashClock) {
	if e.marked("settled:" + vendorID) {
		return // idempotent: SUM(settled=false)=0 -> nothing to settle
	}
	gross := grossIfUnsettled
	fee := gross * feeBps / 10000
	net := gross - fee
	_ = net

	if !cc.tick() {
		return
	}
	e.post(idemKey + ":net")
	if !cc.tick() {
		return
	}
	if fee > 0 {
		e.post(idemKey + ":fee")
	}
	if !cc.tick() {
		return
	}
	e.mark("settled:" + vendorID)
}

func TestSettleVendor_LedgerBeforeMark_ExactlyOnceUnderCrashAtEveryStep(t *testing.T) {
	const gross, feeBps int64 = 10_000, 250 // 2.5% -> fee 250, net 9_750
	for crashAt := 0; crashAt <= 3; crashAt++ {
		e := newEffectLog()
		runSettle(e, "v1", "idem-A", gross, feeBps, &crashClock{at: crashAt}) // crash
		runSettle(e, "v1", "idem-A", gross, feeBps, &crashClock{at: -1})      // same-key retry to completion

		// Exactly-once money: net and fee each applied exactly once after recovery.
		if e.ledger["idem-A:net"] != 1 {
			t.Fatalf("crashAt=%d: net posted %d times, want exactly 1 (double-pay or lost)", crashAt, e.ledger["idem-A:net"])
		}
		if e.ledger["idem-A:fee"] != 1 {
			t.Fatalf("crashAt=%d: fee posted %d times, want exactly 1", crashAt, e.ledger["idem-A:fee"])
		}
		if !e.marked("settled:v1") {
			t.Fatalf("crashAt=%d: settlement did not converge to settled after retry", crashAt)
		}
		// Core invariant: settled is only ever marked AFTER both legs are durable, so
		// "settled" can never exist without the vendor having been paid.
		if e.marked("settled:v1") && (!e.posted("idem-A:net") || !e.posted("idem-A:fee")) {
			t.Fatalf("crashAt=%d: INVARIANT VIOLATED — settled without a paid vendor", crashAt)
		}
	}
}

// runSettleOldBroken mirrors the PRE-FIX ordering (mark settled → commit → THEN
// post). A crash in the gap strands the vendor's money forever.
func runSettleOldBroken(e *effectLog, vendorID, idemKey string, gross, feeBps int64, cc *crashClock) {
	if e.marked("settled:" + vendorID) {
		return
	}
	if !cc.tick() {
		return
	}
	e.mark("settled:" + vendorID) // mark FIRST (the bug)
	if !cc.tick() {
		return
	}
	fee := gross * feeBps / 10000
	e.post(idemKey + ":net")
	if fee > 0 {
		e.post(idemKey + ":fee")
	}
}

func TestSettleVendor_OldOrdering_StrandsMoney_DemonstratesWhyFixMatters(t *testing.T) {
	e := newEffectLog()
	runSettleOldBroken(e, "v1", "idem-A", 10_000, 250, &crashClock{at: 1}) // crash right after mark
	runSettleOldBroken(e, "v1", "idem-A", 10_000, 250, &crashClock{at: -1})

	// settled, but vendor never paid — and the retry early-returns ("nothing to
	// settle") so it stays stranded forever. This is the behaviour the fix removes.
	if !e.marked("settled:v1") {
		t.Fatal("precondition: old path marks settled")
	}
	if e.posted("idem-A:net") {
		t.Fatal("old path unexpectedly paid the vendor; mirror does not reproduce the bug")
	}
}

// ===========================================================================
// 2. CloseWallet — residual credit FIRST, mark CLOSED LAST.
// ===========================================================================

func runCloseWallet(e *effectLog, walletID string, residual int64, cc *crashClock) {
	if e.marked("closed:" + walletID) {
		return // idempotent early return
	}
	if !cc.tick() {
		return
	}
	if residual > 0 {
		e.post("evtwallet:refund:" + walletID) // fixed key -> dedup on retry
	}
	if !cc.tick() {
		return
	}
	e.mark("closed:" + walletID)
}

func TestCloseWallet_RefundBeforeMark_ExactlyOnceUnderCrashAtEveryStep(t *testing.T) {
	for crashAt := 0; crashAt <= 2; crashAt++ {
		e := newEffectLog()
		runCloseWallet(e, "w1", 3_500, &crashClock{at: crashAt})
		runCloseWallet(e, "w1", 3_500, &crashClock{at: -1})

		if e.ledger["evtwallet:refund:w1"] != 1 {
			t.Fatalf("crashAt=%d: residual refunded %d times, want exactly 1", crashAt, e.ledger["evtwallet:refund:w1"])
		}
		if !e.marked("closed:w1") {
			t.Fatalf("crashAt=%d: wallet did not converge to CLOSED", crashAt)
		}
		// Invariant: CLOSED is only marked after the residual is durably credited, so
		// a closed wallet can never have swallowed the attendee's residual.
		if e.marked("closed:w1") && !e.posted("evtwallet:refund:w1") {
			t.Fatalf("crashAt=%d: INVARIANT VIOLATED — wallet CLOSED but residual not refunded", crashAt)
		}
	}
}

// ===========================================================================
// 3. Purchase — PENDING -> debit -> PAID -> ticket; expire only if never posted.
// ===========================================================================

type purchaseWorld struct {
	e          *effectLog
	status     string // "", PENDING, PAID, EXPIRED
	sold       int    // reserved seats
	ticketRows int    // must never exceed 1
	canPay     bool   // does the buyer's wallet cover payable at debit time
}

// runPurchase mirrors Purchase+finalizePurchase for one order/idemKey. On a fresh
// call (status=="") it reserves+PENDING; then it debits, marks PAID and issues the
// ticket. A retry re-enters with the persisted status (crash-resume). Expiry
// releases the seat ONLY when the debit did not post (the ledger.Posted mirror).
func runPurchase(w *purchaseWorld, idemKey string, payable int64, cc *crashClock) {
	if w.status == "" { // fresh reservation (only when no order exists yet)
		if !cc.tick() {
			return
		}
		w.sold++ // reserve seat
		w.status = "PENDING"
	}
	if w.status == "EXPIRED" { // terminal
		return
	}
	// Debit + PAID flip run ONLY while PENDING. A resumed PAID order skips straight
	// to ticket issuance below — mirrors finalizePurchase NOT early-returning on PAID
	// (a crash can land after the PAID flip but before the ticket insert).
	if w.status == "PENDING" {
		if !cc.tick() {
			return
		}
		if payable > 0 {
			if w.canPay {
				w.e.post(idemKey + ":ticket") // idempotent debit; replay dedups
			}
			if !w.e.posted(idemKey + ":ticket") {
				// Definitively not posted (mirrors ledger.Posted==false) -> expire and
				// release the seat. Never expire a posted order.
				w.status = "EXPIRED"
				if w.sold > 0 {
					w.sold--
				}
				return
			}
		}
		if !cc.tick() {
			return
		}
		w.status = "PAID"
	}
	// Issue the ticket idempotently — runs for a just-paid PENDING order AND for a
	// resumed PAID order still missing its ticket.
	if !cc.tick() {
		return
	}
	if w.ticketRows == 0 { // ON CONFLICT (order_id) DO NOTHING -> at most one ticket
		w.ticketRows = 1
	}
}

func TestPurchase_PendingResume_NeverFreeTicket_NeverDoubleCharge(t *testing.T) {
	// Funded buyer: for a crash at EVERY step, a same-idemKey retry must converge to
	// PAID with the debit posted exactly once and exactly one ticket — and must NEVER
	// leave a PAID/ticketed order whose debit never posted (the "free ticket" bug).
	for crashAt := 0; crashAt <= 4; crashAt++ {
		w := &purchaseWorld{e: newEffectLog(), canPay: true}
		runPurchase(w, "idem-P", 5_000, &crashClock{at: crashAt})
		runPurchase(w, "idem-P", 5_000, &crashClock{at: -1})

		if w.status != "PAID" {
			t.Fatalf("crashAt=%d: funded purchase converged to %q, want PAID", crashAt, w.status)
		}
		if w.e.ledger["idem-P:ticket"] != 1 {
			t.Fatalf("crashAt=%d: buyer charged %d times, want exactly 1", crashAt, w.e.ledger["idem-P:ticket"])
		}
		if w.ticketRows != 1 {
			t.Fatalf("crashAt=%d: %d ticket rows, want exactly 1", crashAt, w.ticketRows)
		}
		// The invariant that was broken before: PAID/ticketed <=> money actually moved.
		if (w.status == "PAID" || w.ticketRows > 0) && !w.e.posted("idem-P:ticket") {
			t.Fatalf("crashAt=%d: INVARIANT VIOLATED — free ticket (PAID/ticketed without a debit)", crashAt)
		}
	}
}

func TestPurchase_UnfundedBuyer_ExpiresAndReleasesSeat_NeverCharges(t *testing.T) {
	w := &purchaseWorld{e: newEffectLog(), canPay: false}
	runPurchase(w, "idem-Q", 5_000, &crashClock{at: -1})

	if w.status != "EXPIRED" {
		t.Fatalf("unfunded purchase converged to %q, want EXPIRED", w.status)
	}
	if w.e.posted("idem-Q:ticket") {
		t.Fatal("unfunded buyer was charged — must never happen")
	}
	if w.sold != 0 {
		t.Fatalf("expired order left %d seats reserved, want 0 (seat must be released)", w.sold)
	}
	if w.ticketRows != 0 {
		t.Fatalf("expired order issued %d tickets, want 0", w.ticketRows)
	}
}
