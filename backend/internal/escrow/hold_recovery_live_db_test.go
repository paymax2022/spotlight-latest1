package escrow

// LIVE-DB regression coverage for the commit-ordering defect in Hold(): the
// ledger debit ("<idem>:hold") posts in the ledger's own transaction BEFORE the
// escrow_holds insert. A crash (or insert failure) in that gap parked the
// payer's money in the escrow standing account with NO hold row — and a naive
// retry wedged:
//   - the Redis idem-lock returned ErrDuplicate inside its TTL;
//   - the fail-closed tier gate re-counted the already-posted debit against
//     today's cap (tiers.getDailyDebited sums ledger_entries), refusing the
//     very replay meant to heal.
//
// The fix probes the ledger of record FIRST (ledger.Posted + EntryByKey
// identity check): an already-posted matching leg skips the gate and the
// re-debit, and the missing row is healed by the insert.
//
// These tests simulate the crash by posting the debit leg directly
// (led.Debit with the exact journal Hold would write) while leaving
// escrow_holds empty, then drive the real Service code path.
// Skips unless TEST_DATABASE_URL is set (mirrors resolve_recovery_live_db_test.go).

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/finance/ledger"
)

// TestLiveDB_Hold_HealsCrashedRowInsert plants the exact crashed state the bug
// produced — "<idem>:hold" balanced pair committed, escrow_holds row absent —
// then calls Hold again. The retry must heal the missing row WITHOUT re-debiting
// the payer, and the healed hold must be resolvable like any other.
func TestLiveDB_Hold_HealsCrashedRowInsert(t *testing.T) {
	f := newRecoveryFixture(t)
	ctx := context.Background()
	const amount int64 = 320_000
	f.fund(t, f.payer, 1_000_000)

	ref := "p2p:listing-heal"
	idem := "escrow-hold-heal-" + uuid.New().String()
	// Simulate the crash: post the exact debit journal Hold would write, then
	// die before the escrow_holds INSERT.
	if err := f.led.Debit(ctx, f.payer, "escrow:"+ref, idem+":hold", f.escrow.ID, amount); err != nil {
		t.Fatalf("plant crashed hold debit: %v", err)
	}
	var rowCount int
	if err := f.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM escrow_holds WHERE idempotency_key=$1`, idem).Scan(&rowCount); err != nil {
		t.Fatalf("count hold rows: %v", err)
	}
	if rowCount != 0 {
		t.Fatalf("precondition: no escrow_holds row may exist for the crashed key, got %d", rowCount)
	}

	// Retry with the SAME key and params. Must converge: heal the row, no
	// second debit, no error.
	h, err := f.svc.Hold(ctx, f.payer, ref, "p2pmarket", idem, amount)
	if err != nil {
		t.Fatalf("hold retry must heal the missing row, got %v", err)
	}
	if h.State != StateHeld {
		t.Fatalf("healed hold state = %s, want HELD", h.State)
	}
	if got := f.walletBalance(t, f.payer); got != 1_000_000-amount {
		t.Fatalf("payer balance = %d, want %d — heal must not double-debit", got, 1_000_000-amount)
	}
	if n := f.entryCount(t, idem+":hold:debit"); n != 1 {
		t.Fatalf("hold debit entries = %d, want exactly 1", n)
	}
	if n := f.entryCount(t, idem+":hold:credit"); n != 1 {
		t.Fatalf("hold credit entries = %d, want exactly 1 (balanced pair)", n)
	}

	// A further replay returns the same persisted hold — still exactly-once.
	h2, err := f.svc.Hold(ctx, f.payer, ref, "p2pmarket", idem, amount)
	if err != nil {
		t.Fatalf("second hold replay must return the healed row, got %v", err)
	}
	if h2.ID != h.ID {
		t.Fatalf("second replay returned hold %s, want the persisted row %s", h2.ID, h.ID)
	}
	if n := f.entryCount(t, idem+":hold:debit"); n != 1 {
		t.Fatalf("hold debit entries after second replay = %d, want exactly 1", n)
	}

	// The healed hold is a real hold: it can resolve to the payee.
	if err := f.svc.Release(ctx, h.ID, f.payee); err != nil {
		t.Fatalf("release on healed hold: %v", err)
	}
	if got := f.walletBalance(t, f.payee); got != amount {
		t.Fatalf("payee balance = %d, want %d", got, amount)
	}
}

// TestLiveDB_Hold_HealSkipsTierGate pins the wedge the gate itself created: the
// posted debit counts toward the daily cap, so re-running the gate on a heal
// replay could refuse the only call able to attach the missing row. Inject a
// gate that refuses EVERYTHING — a heal retry must still succeed, proving the
// gate is never consulted once the money leg is durable.
func TestLiveDB_Hold_HealSkipsTierGate(t *testing.T) {
	f := newRecoveryFixture(t)
	ctx := context.Background()
	const amount int64 = 80_000
	f.fund(t, f.payer, 500_000)

	ref := "p2p:listing-gated"
	idem := "escrow-hold-gate-" + uuid.New().String()
	if err := f.led.Debit(ctx, f.payer, "escrow:"+ref, idem+":hold", f.escrow.ID, amount); err != nil {
		t.Fatalf("plant crashed hold debit: %v", err)
	}

	gate := &recordingDebitLimiter{err: errors.New("test gate: refuse all")}
	f.svc.WithTiers(gate)

	h, err := f.svc.Hold(ctx, f.payer, ref, "p2pmarket", idem, amount)
	if err != nil {
		t.Fatalf("heal replay must not consult the tier gate, got %v", err)
	}
	if h == nil || h.State != StateHeld {
		t.Fatalf("heal replay must return the healed HELD row, got %+v", h)
	}
	if gate.calls != 0 {
		t.Fatalf("tier gate consulted %d times on the heal path — the already-posted debit would re-count against the daily cap", gate.calls)
	}
}

// TestLiveDB_Hold_ForeignKeyClaimFailsClosed pins the fail-closed half of the
// heal: a replay whose params do NOT match the journal recorded under the key
// (different reference, different amount) must refuse — never attach a hold row
// claiming money that was moved for something else.
func TestLiveDB_Hold_ForeignKeyClaimFailsClosed(t *testing.T) {
	f := newRecoveryFixture(t)
	ctx := context.Background()
	const amount int64 = 60_000
	f.fund(t, f.payer, 500_000)

	idem := "escrow-hold-foreign-" + uuid.New().String()
	// A foreign claim posted under this key: same amount, DIFFERENT reference.
	if err := f.led.Debit(ctx, f.payer, "escrow:other-listing", idem+":hold", f.escrow.ID, amount); err != nil {
		t.Fatalf("plant foreign debit: %v", err)
	}

	if _, err := f.svc.Hold(ctx, f.payer, "p2p:my-listing", "p2pmarket", idem, amount); !errors.Is(err, ledger.ErrDuplicate) {
		t.Fatalf("replay with a mismatched reference must fail closed (ErrDuplicate), got %v", err)
	}
	// Same key, SAME reference, different amount — still a different journal.
	idem2 := "escrow-hold-foreign2-" + uuid.New().String()
	if err := f.led.Debit(ctx, f.payer, "escrow:p2p:listed", idem2+":hold", f.escrow.ID, amount); err != nil {
		t.Fatalf("plant foreign debit 2: %v", err)
	}
	if _, err := f.svc.Hold(ctx, f.payer, "p2p:listed", "p2pmarket", idem2, amount+1); !errors.Is(err, ledger.ErrDuplicate) {
		t.Fatalf("replay with a mismatched amount must fail closed (ErrDuplicate), got %v", err)
	}

	// No hold rows may exist for either wedged key — recon, not silent attach.
	var n int
	if err := f.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM escrow_holds WHERE idempotency_key = ANY($1)`,
		[]string{idem, idem2}).Scan(&n); err != nil {
		t.Fatalf("count wedged hold rows: %v", err)
	}
	if n != 0 {
		t.Fatalf("foreign-claim replays attached %d hold rows, want 0", n)
	}
}
