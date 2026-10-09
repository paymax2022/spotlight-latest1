package escrow

// LIVE-DB regression coverage for the commit-before-credit defect in resolve():
// the state transition committed, THEN the ledger credit posted outside the tx.
// A crash (or credit failure) in that gap left the hold terminal — RELEASED /
// REFUNDED — with the beneficiary never paid, and the idempotent early-return
// (`if from == to { return nil }`) skipped re-attempting the credit, so NO retry
// could ever heal it.
//
// The fix makes the money leg recoverable: on from == to the service now runs
// ensureResolutionCredit, which verifies the per-leg journal entry against the
// ledger of record (ledger.Posted) and posts it if missing — the beneficiary is
// the STORED payee/payer, never the replay's argument.
//
// These tests simulate the crash by planting the post-commit/pre-credit row
// state directly (UPDATE escrow_holds SET state=... with no credit posted),
// then drive the real Service code path.
// Skips unless TEST_DATABASE_URL is set (mirrors transport's orphan-escrow suite).

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/testsupport"
)

func recoveryPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping escrow resolve-recovery live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// recoveryFixture seeds a funded payer, a payee, and a decoy user (to prove a
// replay cannot redirect the payout), and returns a wired Service + ledger.
type recoveryFixture struct {
	pool   *pgxpool.Pool
	svc    *Service
	led    *ledger.Service
	payer  string
	payee  string
	decoy  string
	escrow *ledger.Account
}

func newRecoveryFixture(t *testing.T) *recoveryFixture {
	t.Helper()
	pool := recoveryPool(t)
	ctx := context.Background()

	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := NewService(pool, led, nil)

	f := &recoveryFixture{pool: pool, svc: svc, led: led,
		payer: uuid.New().String(), payee: uuid.New().String(), decoy: uuid.New().String()}
	for _, u := range []string{f.payer, f.payee, f.decoy} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
			u, u+"@recovery.test"); err != nil {
			t.Fatalf("seed user %s: %v", u, err)
		}
	}
	testsupport.CleanupUsers(t, pool, f.payer, f.payee, f.decoy)
	// The hold's wallet debit is tier-gated fail-closed — promote the payer.
	testsupport.SetKycTier(t, ctx, pool, f.payer, testsupport.KycTierUnlimited)

	var err error
	f.escrow, err = led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		t.Fatalf("resolve escrow account: %v", err)
	}
	return f
}

func (f *recoveryFixture) fund(t *testing.T, userID string, kobo int64) {
	t.Helper()
	revAcc, err := f.led.GetOrCreateStandingAccount(context.Background(), ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("resolve revenue account: %v", err)
	}
	if err := f.led.Credit(context.Background(), userID, "seed:recovery-fixtures",
		"seed-fund-"+userID, revAcc.ID, kobo); err != nil {
		t.Fatalf("fund user %s: %v", userID, err)
	}
}

func (f *recoveryFixture) walletBalance(t *testing.T, userID string) int64 {
	t.Helper()
	bal, err := f.led.GetBalance(context.Background(), userID)
	if err != nil {
		t.Fatalf("balance for %s: %v", userID, err)
	}
	return bal
}

// entryCount counts ledger_entries rows under an exact idempotency key — the
// exactly-once assertion (the ledger stores one row per side; both sides must
// exist exactly once for a balanced post).
func (f *recoveryFixture) entryCount(t *testing.T, idemKey string) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM ledger_entries WHERE idempotency_key=$1`, idemKey).Scan(&n); err != nil {
		t.Fatalf("count ledger entries %s: %v", idemKey, err)
	}
	return n
}

// TestLiveDB_Resolve_ReleaseHealsCrashedCredit plants the exact crashed state
// the bug produced — escrow_holds committed to RELEASED with payee_id set, but
// the "<idem>:release" credit never posted — then calls Release again. The
// replay must post the missing credit to the STORED payee (not the caller's
// payee argument) exactly once.
func TestLiveDB_Resolve_ReleaseHealsCrashedCredit(t *testing.T) {
	f := newRecoveryFixture(t)
	ctx := context.Background()
	const amount int64 = 250_000
	f.fund(t, f.payer, 1_000_000)

	idem := "escrow-release-heal-" + uuid.New().String()
	h, err := f.svc.Hold(ctx, f.payer, "p2p:listing-1", "p2pmarket", idem, amount)
	if err != nil {
		t.Fatalf("hold: %v", err)
	}
	if got := f.walletBalance(t, f.payer); got != 1_000_000-amount {
		t.Fatalf("payer balance after hold = %d, want %d", got, 1_000_000-amount)
	}

	// Simulate the crash: state commit succeeded, the credit never posted.
	if _, err := f.pool.Exec(ctx,
		`UPDATE escrow_holds SET state='RELEASED', payee_id=$2, resolved_at=now() WHERE id=$1`,
		h.ID, f.payee); err != nil {
		t.Fatalf("plant crashed RELEASED state: %v", err)
	}

	// Retry. The caller passes the DECOY as payee — a vulnerable implementation
	// would pay the replay's argument; the fix pays the recorded beneficiary.
	if err := f.svc.Release(ctx, h.ID, f.decoy); err != nil {
		t.Fatalf("release replay must heal the missing credit, got %v", err)
	}

	if got := f.walletBalance(t, f.payee); got != amount {
		t.Fatalf("payee balance = %d, want %d — crashed release must be healed", got, amount)
	}
	if got := f.walletBalance(t, f.decoy); got != 0 {
		t.Fatalf("decoy balance = %d, want 0 — beneficiary must be the STORED payee", got)
	}
	if n := f.entryCount(t, idem+":release:credit"); n != 1 {
		t.Fatalf("release credit entries = %d, want exactly 1", n)
	}
	if n := f.entryCount(t, idem+":release:debit"); n != 1 {
		t.Fatalf("release debit entries = %d, want exactly 1 (balanced pair)", n)
	}

	// A further retry is a clean no-op — exactly-once still holds.
	if err := f.svc.Release(ctx, h.ID, f.payee); err != nil {
		t.Fatalf("second release replay must be a no-op success, got %v", err)
	}
	if n := f.entryCount(t, idem+":release:credit"); n != 1 {
		t.Fatalf("release credit entries after second replay = %d, want exactly 1", n)
	}
	if got := f.walletBalance(t, f.payee); got != amount {
		t.Fatalf("payee balance after second replay = %d, want %d (no double-pay)", got, amount)
	}
}

// TestLiveDB_Resolve_RefundHealsCrashedCredit is the REFUNDED counterpart: a
// refund that committed its state but died before crediting the payer must be
// healed by a retry — the payer gets the money back.
func TestLiveDB_Resolve_RefundHealsCrashedCredit(t *testing.T) {
	f := newRecoveryFixture(t)
	ctx := context.Background()
	const amount int64 = 175_000
	f.fund(t, f.payer, 500_000)

	idem := "escrow-refund-heal-" + uuid.New().String()
	h, err := f.svc.Hold(ctx, f.payer, "p2p:listing-2", "p2pmarket", idem, amount)
	if err != nil {
		t.Fatalf("hold: %v", err)
	}

	// Simulate the crash on the refund path: REFUNDED committed, credit absent.
	if _, err := f.pool.Exec(ctx,
		`UPDATE escrow_holds SET state='REFUNDED', resolved_at=now() WHERE id=$1`, h.ID); err != nil {
		t.Fatalf("plant crashed REFUNDED state: %v", err)
	}

	if err := f.svc.Refund(ctx, h.ID); err != nil {
		t.Fatalf("refund replay must heal the missing credit, got %v", err)
	}
	if got := f.walletBalance(t, f.payer); got != 500_000 {
		t.Fatalf("payer balance = %d, want %d — crashed refund must be healed", got, 500_000)
	}
	if n := f.entryCount(t, idem+":refund:credit"); n != 1 {
		t.Fatalf("refund credit entries = %d, want exactly 1", n)
	}

	// Replay again: still exactly-once, still refunded-once.
	if err := f.svc.Refund(ctx, h.ID); err != nil {
		t.Fatalf("second refund replay must be a no-op success, got %v", err)
	}
	if n := f.entryCount(t, idem+":refund:credit"); n != 1 {
		t.Fatalf("refund credit entries after second replay = %d, want exactly 1", n)
	}
}

// TestLiveDB_Resolve_HappyPathStillExactlyOnce guards the normal path: a
// fresh Release through resolve() posts exactly one balanced pair and the
// escrow standing account returns to its pre-hold level.
func TestLiveDB_Resolve_HappyPathStillExactlyOnce(t *testing.T) {
	f := newRecoveryFixture(t)
	ctx := context.Background()
	const amount int64 = 90_000
	f.fund(t, f.payer, 300_000)

	escrowBefore, err := f.led.GetAccountBalance(ctx, f.escrow.ID)
	if err != nil {
		t.Fatalf("escrow balance before: %v", err)
	}

	idem := "escrow-happy-" + uuid.New().String()
	h, err := f.svc.Hold(ctx, f.payer, "p2p:listing-3", "p2pmarket", idem, amount)
	if err != nil {
		t.Fatalf("hold: %v", err)
	}
	if err := f.svc.Release(ctx, h.ID, f.payee); err != nil {
		t.Fatalf("release: %v", err)
	}

	if got := f.walletBalance(t, f.payee); got != amount {
		t.Fatalf("payee balance = %d, want %d", got, amount)
	}
	escrowAfter, err := f.led.GetAccountBalance(ctx, f.escrow.ID)
	if err != nil {
		t.Fatalf("escrow balance after: %v", err)
	}
	if escrowAfter != escrowBefore {
		t.Fatalf("escrow standing account drifted %d -> %d; hold+release must net to zero", escrowBefore, escrowAfter)
	}
	if n := f.entryCount(t, idem+":release:credit"); n != 1 {
		t.Fatalf("release credit entries = %d, want exactly 1", n)
	}
}

// TestLiveDB_Arbitrate_HealsStuckOpenDispute plants the worst-case crash inside
// Arbitrate: the prior attempt committed the hold's terminal state (RELEASED,
// payee recorded) but died before BOTH the money leg and the dispute-row update.
// A naive retry errored on "hold not in DISPUTED state" — leaving the dispute
// OPEN forever even though the decision already took effect. The fix lets a
// decision-consistent terminal state fall through: resolve() heals the missing
// credit and the dispute is marked RESOLVED.
func TestLiveDB_Arbitrate_HealsStuckOpenDispute(t *testing.T) {
	f := newRecoveryFixture(t)
	ctx := context.Background()
	const amount int64 = 210_000
	f.fund(t, f.payer, 800_000)

	idem := "escrow-arb-heal-" + uuid.New().String()
	h, err := f.svc.Hold(ctx, f.payer, "p2p:listing-arb", "p2pmarket", idem, amount)
	if err != nil {
		t.Fatalf("hold: %v", err)
	}
	if _, err := f.svc.RaiseDispute(ctx, h.ID, f.payer, "item not delivered"); err != nil {
		t.Fatalf("raise dispute: %v", err)
	}

	// Simulate the crash mid-Arbitrate: the state commit landed (RELEASED +
	// recorded payee), the credit and the dispute update never did.
	if _, err := f.pool.Exec(ctx,
		`UPDATE escrow_holds SET state='RELEASED', payee_id=$2, resolved_at=now() WHERE id=$1`,
		h.ID, f.payee); err != nil {
		t.Fatalf("plant crashed arbitration state: %v", err)
	}

	// Retry the same decision. The arbiter is the decoy (a non-party —
	// separation of duties still applies on the heal path).
	if err := f.svc.Arbitrate(ctx, h.ID, DecisionRelease, f.decoy); err != nil {
		t.Fatalf("arbitrate retry must heal money leg + dispute row, got %v", err)
	}

	if got := f.walletBalance(t, f.payee); got != amount {
		t.Fatalf("payee balance = %d, want %d — crashed arbitration must heal the credit", got, amount)
	}
	if n := f.entryCount(t, idem+":release:credit"); n != 1 {
		t.Fatalf("release credit entries = %d, want exactly 1", n)
	}
	d, err := f.svc.GetDispute(ctx, h.ID)
	if err != nil {
		t.Fatalf("load dispute: %v", err)
	}
	if d.State != "RESOLVED" || d.Decision == nil || *d.Decision != string(DecisionRelease) {
		t.Fatalf("dispute = state %s decision %v, want RESOLVED/RELEASE", d.State, d.Decision)
	}
	if d.ArbiterID == nil || *d.ArbiterID != f.decoy {
		t.Fatalf("dispute arbiter = %v, want %s", d.ArbiterID, f.decoy)
	}
}

// TestLiveDB_Arbitrate_TerminalMismatchFailsClosed pins the fail-closed half:
// a decision that contradicts the committed terminal state must NOT heal —
// RELEASED+REFUND (or REFUNDED+RELEASE) is rejected before any money moves.
func TestLiveDB_Arbitrate_TerminalMismatchFailsClosed(t *testing.T) {
	f := newRecoveryFixture(t)
	ctx := context.Background()
	const amount int64 = 45_000
	f.fund(t, f.payer, 200_000)

	h, err := f.svc.Hold(ctx, f.payer, "p2p:listing-mismatch", "p2pmarket",
		"escrow-arb-mismatch-"+uuid.New().String(), amount)
	if err != nil {
		t.Fatalf("hold: %v", err)
	}
	if _, err := f.svc.RaiseDispute(ctx, h.ID, f.payer, "changed my mind"); err != nil {
		t.Fatalf("raise dispute: %v", err)
	}

	// Plant a REFUNDED terminal state (a prior arbitration ruled refund) with
	// its credit posted — then a retry arriving with the OPPOSITE decision.
	if err := f.svc.Refund(ctx, h.ID); err != nil {
		t.Fatalf("refund: %v", err)
	}
	if err := f.svc.Arbitrate(ctx, h.ID, DecisionRelease, f.decoy); err == nil {
		t.Fatal("arbitrate RELEASE on a REFUNDED hold must fail closed")
	}
	if got := f.walletBalance(t, f.payee); got != 0 {
		t.Fatalf("payee balance = %d, want 0 — a contradicting decision must not move money", got)
	}
}

// TestLiveDB_Arbitrate_CompletedReplayNoOp pins full idempotency for Arbitrate:
// a retry of a COMPLETED arbitration (terminal hold + dispute already RESOLVED)
// is a no-op success when the requested decision matches the recorded ruling —
// not a "not in DISPUTED state" error — while a contradicting decision still
// fails closed. Runs the REAL path end-to-end (no planted state).
func TestLiveDB_Arbitrate_CompletedReplayNoOp(t *testing.T) {
	f := newRecoveryFixture(t)
	ctx := context.Background()
	const amount int64 = 95_000
	f.fund(t, f.payer, 300_000)

	idem := "escrow-arb-replay-" + uuid.New().String()
	h, err := f.svc.Hold(ctx, f.payer, "p2p:listing-done", "p2pmarket", idem, amount)
	if err != nil {
		t.Fatalf("hold: %v", err)
	}
	if _, err := f.svc.RaiseDispute(ctx, h.ID, f.payer, "not as described"); err != nil {
		t.Fatalf("raise dispute: %v", err)
	}
	if err := f.svc.Arbitrate(ctx, h.ID, DecisionRefund, f.decoy); err != nil {
		t.Fatalf("arbitrate: %v", err)
	}
	if got := f.walletBalance(t, f.payer); got != 300_000 {
		t.Fatalf("payer balance after refund = %d, want %d", got, 300_000)
	}

	// Same decision again → no-op success; the refund leg stays exactly-once.
	if err := f.svc.Arbitrate(ctx, h.ID, DecisionRefund, f.decoy); err != nil {
		t.Fatalf("completed-arbitration replay must be a no-op success, got %v", err)
	}
	if n := f.entryCount(t, idem+":refund:credit"); n != 1 {
		t.Fatalf("refund credit entries = %d, want exactly 1", n)
	}

	// A contradicting decision on the resolved dispute still fails closed.
	if err := f.svc.Arbitrate(ctx, h.ID, DecisionRelease, f.decoy); err == nil {
		t.Fatal("arbitrate RELEASE on a refund-resolved dispute must fail closed")
	}
	if got := f.walletBalance(t, f.payee); got != 0 {
		t.Fatalf("payee balance = %d, want 0", got)
	}
}
