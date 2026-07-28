package cryptoaml_test

// ---------------------------------------------------------------------------
// LIVE-DB integration tests for the crypto WITHDRAWAL AML gate (the P0
// "money-must-not-leave-before-approval" fix).
//
// crypto.Service (crypto.NewService(pool, ledgerSvc, priceProvider)) drives the
// withdrawal state machine against a concrete *pgxpool.Pool and the real
// ledger.Service. The provider broadcast seam is the default MockWithdrawalProvider
// wired inside NewService (service.go: `withdraw: NewMockWithdrawalProvider()`),
// which performs NO network call — it deterministically returns Accepted=true so
// the approve→broadcast STATE TRANSITION is exercisable end-to-end without a real
// dispatch. We therefore assert the STATE, not a real network side effect.
//
// This file is SKIPPED whenever TEST_DATABASE_URL/DATABASE_URL is unset — the SAME
// env-var gate as backend/tests/crypto/live_db_integration_test.go and
// backend/tests/association/live_db_integration_test.go. The skip is NOT a stub;
// every step drives the real Service against real tables.
//
// ── Bring-up note (read before running) ───────────────────────────────────
//  1. Apply the crypto migrations, in particular:
//       supabase/migrations/20260815001600_crypto.sql       (crypto_* tables)
//       supabase/migrations/20260920000000_crypto_schema.sql (widens
//         crypto_withdrawals.status to include 'pending_review' and 'approved')
//     plus the finance/ledger migrations (Buy/Withdraw post through the real
//     ledger.Service). Confirm:
//       psql "$DATABASE_URL" -c "\d crypto_withdrawals"
//  2. Set DATABASE_URL (or TEST_DATABASE_URL) to a disposable/test database —
//     never point this at production. `supabase db reset` (local, port 54322)
//     is the safest target:
//       export DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//  3. Run:
//       cd backend && go test ./tests/cryptoaml/... -run LiveDB -v
//
// Every row this file touches is created by the test itself with a fresh
// uuid.New() id; assets are upserted via AdminConfigAsset (keyed on a random
// symbol), so re-running is safe. No truncation, no shared fixtures.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/crypto"
	"spotlight/backend/internal/finance/ledger"
)

// liveDBPool connects using TEST_DATABASE_URL/DATABASE_URL, or skips.
func liveDBPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL/DATABASE_URL set — skipping live-DB crypto AML withdrawal integration test; see bring-up note in withdrawal_aml_live_db_test.go")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

func newLiveLedgerService(pool *pgxpool.Pool) *ledger.Service {
	ledRepo := ledger.NewRepository(pool)
	return ledger.NewService(ledRepo, (*goredis.Client)(nil))
}

// newLiveCryptoService builds the crypto service exactly as production does, with
// nil price (→ deterministic MockPriceProvider) and the built-in
// MockWithdrawalProvider broadcast seam (no network; always Accepted). This lets
// the approve→broadcast STATE TRANSITION run end-to-end without a real dispatch.
func newLiveCryptoService(pool *pgxpool.Pool, led *ledger.Service) *crypto.Service {
	return crypto.NewService(pool, led, nil)
}

func newIdemKey(t *testing.T, label string) string {
	t.Helper()
	return label + "-" + uuid.New().String()
}

// seedUser inserts a synthetic auth.users row so FKs (crypto_holdings.user_id,
// crypto_withdrawals.user_id, wallet -> auth.users) are satisfied. email is
// required by the handle_new_user trigger (user_profiles.email NOT NULL).
func seedUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`, id, id+"@seed.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	return id
}

// seedAsset upserts one active tradable asset via the admin path (unique symbol per
// run) and returns its id.
func seedAsset(t *testing.T, ctx context.Context, svc *crypto.Service) string {
	t.Helper()
	sym := "TWD" + uuid.New().String()[:8]
	a, err := svc.AdminConfigAsset(ctx, "test-admin", sym, "Test Withdraw Asset", 100_000_000, true)
	if err != nil {
		t.Fatalf("seed asset: %v", err)
	}
	return a.ID
}

// seedWallet credits userID's wallet so the withdrawal fiat processing fee has
// funds to draw down (Debit fails closed on insufficient balance).
func seedWallet(t *testing.T, ctx context.Context, led *ledger.Service, userID string, amountKobo int64) {
	t.Helper()
	settle, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		t.Fatalf("seed wallet: standing account: %v", err)
	}
	if err := led.Credit(ctx, userID, "test-seed:"+uuid.New().String(), "test-seed-idem:"+uuid.New().String(), settle.ID, amountKobo); err != nil {
		t.Fatalf("seed wallet: credit: %v", err)
	}
}

// seedHolding gives userID a non-zero holding of assetID by executing a real Buy
// fill (the same helper pattern as backend/tests/crypto), so the parked-units
// accounting the withdrawal FSM relies on stays consistent with the ledger.
func seedHolding(t *testing.T, ctx context.Context, svc *crypto.Service, userID, assetID string, cashKobo int64) int64 {
	t.Helper()
	if _, err := svc.Buy(ctx, userID, assetID, cashKobo, newIdemKey(t, "seed-buy")); err != nil {
		t.Fatalf("seed holding via Buy: %v", err)
	}
	return holdingUnits(t, ctx, svc, userID, assetID)
}

func holdingUnits(t *testing.T, ctx context.Context, svc *crypto.Service, userID, assetID string) int64 {
	t.Helper()
	hs, err := svc.Holdings(ctx, userID)
	if err != nil {
		t.Fatalf("Holdings: %v", err)
	}
	for _, h := range hs {
		if h.AssetID == assetID {
			return h.Units
		}
	}
	return 0
}

// ---------------------------------------------------------------------------
// AML GATE: member Withdraw parks + STOPS at pending_review (no broadcast);
// admin approve advances past pending_review (broadcast fires via mock);
// admin reject returns the parked units. Regression-guards the P0 fix: money
// must not leave before an approve.
// ---------------------------------------------------------------------------

// TestLiveDB_Withdraw_ParksAtPendingReview_NoBroadcast proves the member create
// path parks the units and STOPS at pending_review — the provider is NEVER
// dispatched (no broadcast; status is exactly pending_review, no provider_ref /
// tx_hash), and the parked units left the holding.
func TestLiveDB_Withdraw_ParksAtPendingReview_NoBroadcast(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	led := newLiveLedgerService(pool)
	svc := newLiveCryptoService(pool, led)
	ctx := context.Background()

	assetID := seedAsset(t, ctx, svc)
	userID := seedUser(t, ctx, pool)
	seedWallet(t, ctx, led, userID, 5_000_000_00)
	unitsBefore := seedHolding(t, ctx, svc, userID, assetID, 1_000_000_00)
	if unitsBefore <= 0 {
		t.Fatal("expected a positive holding after the seed buy")
	}

	addr, err := svc.AddAddress(ctx, userID, assetID, "My wallet", "ethereum", "0x1234567890abcdef1234567890abcdef12345678")
	if err != nil {
		t.Fatalf("AddAddress: %v", err)
	}

	withdrawUnits := unitsBefore / 4
	w, err := svc.Withdraw(ctx, userID, assetID, addr.ID, withdrawUnits, 15_000, newIdemKey(t, "wd-park"))
	if err != nil {
		t.Fatalf("Withdraw: %v", err)
	}

	// AML GATE: the member path STOPS at pending_review. It must NOT reach approved
	// / broadcast / confirmed, and the provider must not have been dispatched.
	if w.Status != crypto.WithdrawalPendingReview {
		t.Fatalf("withdrawal status = %s, want %s (member path parks for AML review, NO broadcast)", w.Status, crypto.WithdrawalPendingReview)
	}
	if w.ProviderRef != "" || w.TxHash != "" {
		t.Errorf("provider_ref=%q tx_hash=%q — provider must NOT have been dispatched before approval (P0 AML bypass guard)", w.ProviderRef, w.TxHash)
	}
	// Cross-check persisted status directly.
	var dbStatus, provRef, txHash string
	if err := pool.QueryRow(ctx, `SELECT status, COALESCE(provider_ref,''), COALESCE(tx_hash,'') FROM crypto_withdrawals WHERE id=$1`, w.ID).Scan(&dbStatus, &provRef, &txHash); err != nil {
		t.Fatalf("read persisted withdrawal: %v", err)
	}
	if dbStatus != crypto.WithdrawalPendingReview {
		t.Errorf("persisted status = %s, want %s", dbStatus, crypto.WithdrawalPendingReview)
	}
	if provRef != "" || txHash != "" {
		t.Errorf("persisted provider_ref=%q tx_hash=%q — nothing must be broadcast at pending_review", provRef, txHash)
	}

	// The units are parked (holding decreased immediately by the withdrawn units).
	unitsAfter := holdingUnits(t, ctx, svc, userID, assetID)
	if unitsBefore-unitsAfter != withdrawUnits {
		t.Errorf("holding decreased by %d, want exactly %d (units parked on create)", unitsBefore-unitsAfter, withdrawUnits)
	}

	// The parked row is the AML review queue: AdminListWithdrawals (no filter,
	// defaults to pending_review) surfaces it.
	queue, err := svc.AdminListWithdrawals(ctx, "", 200, 0)
	if err != nil {
		t.Fatalf("AdminListWithdrawals: %v", err)
	}
	found := false
	for _, q := range queue {
		if q.ID == w.ID {
			found = true
			if q.Status != crypto.WithdrawalPendingReview {
				t.Errorf("queued withdrawal status = %s, want %s", q.Status, crypto.WithdrawalPendingReview)
			}
		}
	}
	if !found {
		t.Error("parked withdrawal not surfaced by AdminListWithdrawals default (pending_review) queue")
	}
}

// TestLiveDB_AdminApprove_AdvancesPastPendingReview_BroadcastFires proves the
// admin approve path drives pending_review → approved → broadcast (the mock
// provider accepts), i.e. money is cleared to leave ONLY after the AML approval.
func TestLiveDB_AdminApprove_AdvancesPastPendingReview_BroadcastFires(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	led := newLiveLedgerService(pool)
	svc := newLiveCryptoService(pool, led)
	ctx := context.Background()

	assetID := seedAsset(t, ctx, svc)
	userID := seedUser(t, ctx, pool)
	seedWallet(t, ctx, led, userID, 5_000_000_00)
	unitsBefore := seedHolding(t, ctx, svc, userID, assetID, 1_000_000_00)

	addr, err := svc.AddAddress(ctx, userID, assetID, "Approve wallet", "ethereum", "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd")
	if err != nil {
		t.Fatalf("AddAddress: %v", err)
	}
	w, err := svc.Withdraw(ctx, userID, assetID, addr.ID, unitsBefore/4, 15_000, newIdemKey(t, "wd-approve"))
	if err != nil {
		t.Fatalf("Withdraw: %v", err)
	}
	if w.Status != crypto.WithdrawalPendingReview {
		t.Fatalf("pre-approve status = %s, want %s", w.Status, crypto.WithdrawalPendingReview)
	}

	out, err := svc.AdminDecideWithdrawal(ctx, "compliance-officer", w.ID, "approve", "AML cleared")
	if err != nil {
		t.Fatalf("AdminDecideWithdrawal(approve): %v", err)
	}
	// After approval the AML gate has cleared and the (mock) provider broadcast has
	// fired: status has advanced PAST pending_review (to broadcast) — money released.
	if out.Status != crypto.WithdrawalBroadcast {
		t.Fatalf("post-approve status = %s, want %s (approve fires the provider broadcast)", out.Status, crypto.WithdrawalBroadcast)
	}
	if out.ProviderRef == "" {
		t.Error("expected a provider_ref stamped after broadcast (mock provider accepted)")
	}
	var dbStatus, provRef string
	if err := pool.QueryRow(ctx, `SELECT status, COALESCE(provider_ref,'') FROM crypto_withdrawals WHERE id=$1`, w.ID).Scan(&dbStatus, &provRef); err != nil {
		t.Fatalf("read persisted withdrawal: %v", err)
	}
	if dbStatus != crypto.WithdrawalBroadcast {
		t.Errorf("persisted status = %s, want %s (advanced past pending_review)", dbStatus, crypto.WithdrawalBroadcast)
	}
	if provRef == "" {
		t.Error("persisted provider_ref is empty after broadcast")
	}

	// A second decision on the now-broadcast row is rejected (guarded: only acts on
	// a still-in-review row) — idempotent gate.
	if _, err := svc.AdminDecideWithdrawal(ctx, "compliance-officer", w.ID, "approve", "again"); err == nil {
		t.Error("expected a second approve on an already-decided withdrawal to be rejected")
	}
}

// TestLiveDB_AdminReject_FailsAndReturnsParkedUnits proves the admin reject path
// drives pending_review → failed and RETURNS the parked units to the holding (the
// compensating transition), with no broadcast.
func TestLiveDB_AdminReject_FailsAndReturnsParkedUnits(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	led := newLiveLedgerService(pool)
	svc := newLiveCryptoService(pool, led)
	ctx := context.Background()

	assetID := seedAsset(t, ctx, svc)
	userID := seedUser(t, ctx, pool)
	seedWallet(t, ctx, led, userID, 5_000_000_00)
	unitsBefore := seedHolding(t, ctx, svc, userID, assetID, 1_000_000_00)

	addr, err := svc.AddAddress(ctx, userID, assetID, "Reject wallet", "ethereum", "0x9999999999999999999999999999999999999999")
	if err != nil {
		t.Fatalf("AddAddress: %v", err)
	}
	withdrawUnits := unitsBefore / 4
	w, err := svc.Withdraw(ctx, userID, assetID, addr.ID, withdrawUnits, 15_000, newIdemKey(t, "wd-reject"))
	if err != nil {
		t.Fatalf("Withdraw: %v", err)
	}
	if w.Status != crypto.WithdrawalPendingReview {
		t.Fatalf("pre-reject status = %s, want %s", w.Status, crypto.WithdrawalPendingReview)
	}
	unitsParked := holdingUnits(t, ctx, svc, userID, assetID)
	if unitsBefore-unitsParked != withdrawUnits {
		t.Fatalf("holding decreased by %d after create, want %d (parked)", unitsBefore-unitsParked, withdrawUnits)
	}

	out, err := svc.AdminDecideWithdrawal(ctx, "compliance-officer", w.ID, "reject", "AML flagged")
	if err != nil {
		t.Fatalf("AdminDecideWithdrawal(reject): %v", err)
	}
	if out.Status != crypto.WithdrawalFailed {
		t.Fatalf("post-reject status = %s, want %s", out.Status, crypto.WithdrawalFailed)
	}
	if out.ProviderRef != "" || out.TxHash != "" {
		t.Errorf("reject must not broadcast: provider_ref=%q tx_hash=%q", out.ProviderRef, out.TxHash)
	}

	// The parked units are RETURNED in full to the holding (compensation, no burn).
	unitsAfter := holdingUnits(t, ctx, svc, userID, assetID)
	if unitsAfter != unitsBefore {
		t.Errorf("holding after reject = %d, want %d (parked units returned in full)", unitsAfter, unitsBefore)
	}

	var dbStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM crypto_withdrawals WHERE id=$1`, w.ID).Scan(&dbStatus); err != nil {
		t.Fatalf("read persisted withdrawal: %v", err)
	}
	if dbStatus != crypto.WithdrawalFailed {
		t.Errorf("persisted status = %s, want %s", dbStatus, crypto.WithdrawalFailed)
	}
}
