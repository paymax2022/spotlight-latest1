package escrow

// LIVE-DB coverage for the payee-pinning fix (F2) and the disputed-hold
// resolution guard (F6d):
//
//   - F2: payee_id was only ever written at RELEASE commit, so every DISPUTED
//     hold carried NULL and Arbitrate(DecisionRelease) was dead code — a real
//     arbitration could only ever REFUND. HoldWithPayee records the
//     counterparty at hold time (p2pmarket passes the listing's seller), and a
//     NULL payee on a mid-flight hold is healed when the payer replays the hold
//     with a counterparty.
//   - F6d: a direct Release/Refund on a DISPUTED hold used to move the money
//     while the dispute row stayed OPEN forever. It now fails closed with
//     ErrDisputeRequired — only Arbitrate may resolve contested funds.
//
// Skips unless TEST_DATABASE_URL is set (mirrors resolve_recovery_live_db_test.go).

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

// TestLiveDB_ArbitrateRelease_PaysPinnedPayee is the F2 end-to-end: a hold
// created with a pinned payee can be arbitrated to RELEASE — previously this
// path was unreachable because every DISPUTED hold had payee_id NULL.
func TestLiveDB_ArbitrateRelease_PaysPinnedPayee(t *testing.T) {
	f := newRecoveryFixture(t)
	ctx := context.Background()
	const amount int64 = 260_000
	f.fund(t, f.payer, 1_000_000)

	idem := "escrow-pin-arb-" + uuid.New().String()
	h, err := f.svc.HoldWithPayee(ctx, f.payer, f.payee, "p2p:listing-release", "p2pmarket", idem, amount)
	if err != nil {
		t.Fatalf("hold with payee: %v", err)
	}
	if h.PayeeID == nil || *h.PayeeID != f.payee {
		t.Fatalf("pinned payee = %v, want %s", h.PayeeID, f.payee)
	}

	if _, err := f.svc.RaiseDispute(ctx, h.ID, f.payer, "item not delivered"); err != nil {
		t.Fatalf("raise dispute: %v", err)
	}
	// The ruling that was dead code before the fix: RELEASE to the pinned payee.
	if err := f.svc.Arbitrate(ctx, h.ID, DecisionRelease, f.decoy); err != nil {
		t.Fatalf("arbitrate release on pinned-payee hold: %v", err)
	}
	if got := f.walletBalance(t, f.payee); got != amount {
		t.Fatalf("payee balance = %d, want %d — arbitration release must pay the pinned payee", got, amount)
	}
	if n := f.entryCount(t, idem+":release:credit"); n != 1 {
		t.Fatalf("release credit entries = %d, want exactly 1", n)
	}
	d, err := f.svc.GetDispute(ctx, h.ID)
	if err != nil {
		t.Fatalf("load dispute: %v", err)
	}
	if d.State != "RESOLVED" || d.Decision == nil || *d.Decision != string(DecisionRelease) {
		t.Fatalf("dispute = %s/%v, want RESOLVED/RELEASE", d.State, d.Decision)
	}
}

// TestLiveDB_Release_PinnedPayeeGuards pins the fail-closed payee check: once a
// payee is recorded at hold time, Release must credit exactly that
// counterparty — a mismatched payee argument refuses (never redirects funds),
// while an empty argument uses the pin.
func TestLiveDB_Release_PinnedPayeeGuards(t *testing.T) {
	f := newRecoveryFixture(t)
	ctx := context.Background()
	const amount int64 = 120_000
	f.fund(t, f.payer, 1_000_000)

	h, err := f.svc.HoldWithPayee(ctx, f.payer, f.payee, "p2p:listing-guard", "p2pmarket",
		"escrow-pin-guard-"+uuid.New().String(), amount)
	if err != nil {
		t.Fatalf("hold with payee: %v", err)
	}

	// A different payee argument must fail closed — no money moves.
	if err := f.svc.Release(ctx, h.ID, f.decoy); err == nil {
		t.Fatal("release to a payee != the pinned payee must fail closed")
	}
	if got := f.walletBalance(t, f.decoy); got != 0 {
		t.Fatalf("decoy balance = %d, want 0 — a mismatched release must not move money", got)
	}
	// The failed release must not have resolved the hold.
	got, err := f.svc.Get(ctx, h.ID)
	if err != nil {
		t.Fatalf("get hold: %v", err)
	}
	if got.State != StateHeld {
		t.Fatalf("hold state after refused release = %s, want HELD", got.State)
	}

	// The pinned payee is used even when the argument is empty.
	if err := f.svc.Release(ctx, h.ID, ""); err != nil {
		t.Fatalf("release with empty payee arg must use the pin, got %v", err)
	}
	if got := f.walletBalance(t, f.payee); got != amount {
		t.Fatalf("payee balance = %d, want %d", got, amount)
	}
}

// TestLiveDB_DisputedHold_DirectResolveBlocked pins F6d: a direct Release or
// Refund on a DISPUTED hold bypasses dispute bookkeeping — both must fail
// closed with ErrDisputeRequired, and only Arbitrate may move the money (which
// also closes the dispute row).
func TestLiveDB_DisputedHold_DirectResolveBlocked(t *testing.T) {
	f := newRecoveryFixture(t)
	ctx := context.Background()
	const amount int64 = 180_000
	f.fund(t, f.payer, 1_000_000)

	h, err := f.svc.HoldWithPayee(ctx, f.payer, f.payee, "p2p:listing-guarded", "p2pmarket",
		"escrow-disputed-guard-"+uuid.New().String(), amount)
	if err != nil {
		t.Fatalf("hold: %v", err)
	}
	if _, err := f.svc.RaiseDispute(ctx, h.ID, f.payee, "buyer claims non-delivery"); err != nil {
		t.Fatalf("raise dispute (seller/payee is a party too — payee pinning makes this possible): %v", err)
	}

	if err := f.svc.Release(ctx, h.ID, f.payee); !errors.Is(err, ErrDisputeRequired) {
		t.Fatalf("direct Release on DISPUTED hold must fail with ErrDisputeRequired, got %v", err)
	}
	if err := f.svc.Refund(ctx, h.ID); !errors.Is(err, ErrDisputeRequired) {
		t.Fatalf("direct Refund on DISPUTED hold must fail with ErrDisputeRequired, got %v", err)
	}
	// Nothing moved: funds still parked, dispute still OPEN.
	if got := f.walletBalance(t, f.payee); got != 0 {
		t.Fatalf("payee balance = %d, want 0", got)
	}
	if d, err := f.svc.GetDispute(ctx, h.ID); err != nil || d.State != "OPEN" {
		t.Fatalf("dispute must stay OPEN after refused resolves, got %+v err=%v", d, err)
	}

	// The arbitration lane still resolves it.
	if err := f.svc.Arbitrate(ctx, h.ID, DecisionRefund, f.decoy); err != nil {
		t.Fatalf("arbitrate refund: %v", err)
	}
	if got := f.walletBalance(t, f.payer); got != 1_000_000 {
		t.Fatalf("payer balance = %d, want %d (refunded)", got, 1_000_000)
	}
	if d, err := f.svc.GetDispute(ctx, h.ID); err != nil || d.State != "RESOLVED" {
		t.Fatalf("dispute must be RESOLVED after arbitration, got %+v err=%v", d, err)
	}
}

// TestLiveDB_HoldReplay_HealsMissingPayee covers mid-flight holds: a hold taken
// WITHOUT a payee (pre-fix rows, or Hold callers) that is replayed by the same
// payer WITH a counterparty gains the pin — so its eventual arbitration keeps
// RELEASE reachable. A replay by a DIFFERENT payer must never pin.
func TestLiveDB_HoldReplay_HealsMissingPayee(t *testing.T) {
	f := newRecoveryFixture(t)
	ctx := context.Background()
	const amount int64 = 140_000
	f.fund(t, f.payer, 1_000_000)

	idem := "escrow-pin-heal-" + uuid.New().String()
	h, err := f.svc.Hold(ctx, f.payer, "p2p:listing-legacy", "p2pmarket", idem, amount)
	if err != nil {
		t.Fatalf("hold: %v", err)
	}
	if h.PayeeID != nil {
		t.Fatalf("legacy Hold must leave payee NULL, got %v", *h.PayeeID)
	}

	// A different payer replaying the same key must NOT pin a payee onto a
	// hold they don't own.
	h2, err := f.svc.HoldWithPayee(ctx, f.decoy, f.payee, "p2p:listing-legacy", "p2pmarket", idem, amount)
	if err != nil {
		t.Fatalf("foreign replay returns the persisted hold: %v", err)
	}
	if h2.PayeeID != nil {
		t.Fatal("foreign-payer replay must not pin a payee")
	}

	// The honest payer's replay heals the pin.
	h3, err := f.svc.HoldWithPayee(ctx, f.payer, f.payee, "p2p:listing-legacy", "p2pmarket", idem, amount)
	if err != nil {
		t.Fatalf("payer replay: %v", err)
	}
	if h3.PayeeID == nil || *h3.PayeeID != f.payee {
		t.Fatalf("healed payee = %v, want %s", h3.PayeeID, f.payee)
	}

	// And the healed pin is real: dispute → arbitration RELEASE pays the payee.
	if _, err := f.svc.RaiseDispute(ctx, h.ID, f.payer, "snafu"); err != nil {
		t.Fatalf("raise dispute: %v", err)
	}
	if err := f.svc.Arbitrate(ctx, h.ID, DecisionRelease, f.decoy); err != nil {
		t.Fatalf("arbitrate release on healed payee: %v", err)
	}
	if got := f.walletBalance(t, f.payee); got != amount {
		t.Fatalf("payee balance = %d, want %d", got, amount)
	}
}

// TestLiveDB_NullPayee_ArbitrateRefundOnly preserves the pre-fix fail-closed
// contract for holds that STAY unpinned: REFUND arbitration works, RELEASE
// arbitration fails closed rather than guess a beneficiary.
func TestLiveDB_NullPayee_ArbitrateRefundOnly(t *testing.T) {
	f := newRecoveryFixture(t)
	ctx := context.Background()
	const amount int64 = 70_000
	f.fund(t, f.payer, 500_000)

	h, err := f.svc.Hold(ctx, f.payer, "p2p:listing-nopayee", "p2pmarket",
		"escrow-nopayee-"+uuid.New().String(), amount)
	if err != nil {
		t.Fatalf("hold: %v", err)
	}
	if _, err := f.svc.RaiseDispute(ctx, h.ID, f.payer, "problem"); err != nil {
		t.Fatalf("raise dispute: %v", err)
	}
	if err := f.svc.Arbitrate(ctx, h.ID, DecisionRelease, f.decoy); err == nil {
		t.Fatal("arbitrate RELEASE on a NULL-payee hold must fail closed")
	}
	if err := f.svc.Arbitrate(ctx, h.ID, DecisionRefund, f.decoy); err != nil {
		t.Fatalf("arbitrate refund on NULL-payee hold: %v", err)
	}
	if got := f.walletBalance(t, f.payer); got != 500_000 {
		t.Fatalf("payer balance = %d, want %d (refunded)", got, 500_000)
	}
}

// TestLiveDB_RaiseDispute_IdempotentReplay pins the F6b heal: a second
// RaiseDispute on an already-DISPUTED hold returns the SAME dispute instead of
// erroring — a module caller whose own bookkeeping update failed can retry the
// whole operation and converge.
func TestLiveDB_RaiseDispute_IdempotentReplay(t *testing.T) {
	f := newRecoveryFixture(t)
	ctx := context.Background()
	const amount int64 = 60_000
	f.fund(t, f.payer, 300_000)

	h, err := f.svc.HoldWithPayee(ctx, f.payer, f.payee, "p2p:listing-disp", "p2pmarket",
		"escrow-disp-replay-"+uuid.New().String(), amount)
	if err != nil {
		t.Fatalf("hold: %v", err)
	}
	d1, err := f.svc.RaiseDispute(ctx, h.ID, f.payer, "first")
	if err != nil {
		t.Fatalf("raise dispute: %v", err)
	}
	d2, err := f.svc.RaiseDispute(ctx, h.ID, f.payer, "retry evidence")
	if err != nil {
		t.Fatalf("replay raise dispute must converge, got %v", err)
	}
	if d2.ID != d1.ID {
		t.Fatalf("replay returned dispute %s, want the persisted %s (no second row)", d2.ID, d1.ID)
	}
	var n int
	if err := f.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM escrow_disputes WHERE escrow_id=$1`, h.ID).Scan(&n); err != nil {
		t.Fatalf("count disputes: %v", err)
	}
	if n != 1 {
		t.Fatalf("dispute rows = %d, want exactly 1", n)
	}

	// The other party replaying also converges on the same dispute (they may
	// instead add evidence via AddEvidence).
	d3, err := f.svc.RaiseDispute(ctx, h.ID, f.payee, "counter-claim")
	if err != nil {
		t.Fatalf("payee replay raise dispute must converge, got %v", err)
	}
	if d3.ID != d1.ID {
		t.Fatalf("payee replay returned dispute %s, want %s", d3.ID, d1.ID)
	}
}
