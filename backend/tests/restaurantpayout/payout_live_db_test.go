package restaurantpayout_test

// ---------------------------------------------------------------------------
// LIVE-DB integration tests for the restaurant / rider PAYOUT-RUN money path
// (backend/internal/restaurant/payout.go: BuildRun + ProcessRun).
//
// restaurant.Service (restaurant.NewService(pool, settlementSvc).WithLedger(led))
// talks to a concrete *pgxpool.Pool for the payout-run aggregation and to the
// real ledger.Service for the ONE balanced disbursement transfer (DR settlement
// standing account, CR provider wallet). None of this can run without a migrated
// Postgres, so this file is SKIPPED whenever TEST_DATABASE_URL is
// unset — the SAME env-var gate as backend/tests/crypto/live_db_integration_test.go
// and backend/tests/association/live_db_integration_test.go. The skip is NOT a
// stub; every step drives the real Service against real tables.
//
// ── Bring-up note (read before running) ───────────────────────────────────
//  1. Apply migrations, in particular:
//       supabase/migrations/20260616270000_restaurant.sql   (restaurants, orders)
//       supabase/migrations/20260616220000_fx_conversions.sql (settlements)
//       supabase/migrations/20260613030000_ledger_entries.sql (ledger)
//       supabase/migrations/20260919000400_restaurant_payouts.sql (payout runs/lines)
//     Confirm the core tables landed:
//       psql "$TEST_DATABASE_URL" -c "\d restaurant_payout_runs"
//       psql "$TEST_DATABASE_URL" -c "\d restaurant_payout_lines"
//  2. Set TEST_DATABASE_URL to a disposable/test database —
//     never point this at production. `supabase db reset` (local, port 54322)
//     is the safest target:
//       export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//  3. Run:
//       cd backend && go test ./tests/restaurantpayout/... -run LiveDB -v
//
// Every row this file touches is created by the test itself with a fresh
// uuid.New() id, and each test uses a unique provider + period_key so runs are
// isolated — no truncation, no shared fixtures, safe to re-run repeatedly.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/restaurant"
)

// liveDBPool connects using TEST_DATABASE_URL, or skips.
func liveDBPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB restaurant payout integration test; see bring-up note in payout_live_db_test.go")
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

// newLiveLedgerService wires the real ledger.Service with a nil Redis client
// (confirmed nil-safe, matching the other live-DB suites in this repo).
func newLiveLedgerService(pool *pgxpool.Pool) *ledger.Service {
	ledRepo := ledger.NewRepository(pool)
	return ledger.NewService(ledRepo, (*goredis.Client)(nil))
}

// newLiveRestaurantService wires restaurant.Service exactly as the payout path
// requires: a pool + a (nil) settlement service (payout.go never touches
// s.settlement) plus the real ledger via WithLedger (without it BuildRun/
// ProcessRun refuse to move money).
func newLiveRestaurantService(pool *pgxpool.Pool, led *ledger.Service) *restaurant.Service {
	return restaurant.NewService(pool, nil).WithLedger(led)
}

func newIdemKey(t *testing.T, label string) string {
	t.Helper()
	return label + "-" + uuid.New().String()
}

// seedUser inserts a synthetic auth.users row so FKs (owner_id, payer_id,
// provider wallet user_id -> auth.users) are satisfied. email is required by the
// handle_new_user trigger (user_profiles.email NOT NULL).
func seedUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`, id, id+"@seed.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	return id
}

// seedRestaurant inserts a restaurant owned by ownerID and returns its id.
func seedRestaurant(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ownerID string) string {
	t.Helper()
	id := uuid.New().String()
	// KYB-approved so the Phase-17 verified-account payout gate (PY-007) includes it.
	if _, err := pool.Exec(ctx, `
		INSERT INTO restaurants (id, owner_id, name, address, kyb_status)
		VALUES ($1, $2, $3, '1 Test Street', 'approved')`, id, ownerID, "Test Kitchen "+id[:8]); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	return id
}

// seedDeliveredOrder inserts a delivered order for the restaurant + customer and
// returns its id. The settlement will reference this order via 'order:'+id.
func seedDeliveredOrder(t *testing.T, ctx context.Context, pool *pgxpool.Pool, restaurantID, customerID string, totalKobo int64) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO orders (id, customer_id, restaurant_id, subtotal_kobo, total_kobo,
		                    status, idempotency_key, delivery_address)
		VALUES ($1, $2, $3, $4, $4, 'delivered', $5, '1 Test Street')`,
		id, customerID, restaurantID, totalKobo, "order-idem-"+id); err != nil {
		t.Fatalf("seed order: %v", err)
	}
	return id
}

// seedSettledSettlement inserts a SETTLED food_delivery settlement referencing
// orderID with the given split (total/fee/provider are integer minor units), so
// BuildRun's loadUnpaidSettlements picks it up (module_type='food_delivery',
// status='settled', restaurant owner match, provider_kobo>0, not yet on a line).
// Returns the settlement id.
func seedSettledSettlement(t *testing.T, ctx context.Context, pool *pgxpool.Pool, orderID, payerID string, totalKobo, feeKobo, providerKobo int64) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO settlements (id, reference, module_type, payer_id, total_kobo,
		                         fee_kobo, provider_kobo, status, settled_at, idempotency_key)
		VALUES ($1, $2, 'food_delivery', $3, $4, $5, $6, 'settled', now(), $7)`,
		id, "order:"+orderID, payerID, totalKobo, feeKobo, providerKobo, "settle-idem-"+id); err != nil {
		t.Fatalf("seed settlement: %v", err)
	}
	return id
}

// ledgerEntryCount returns how many ledger_entries rows exist for a reference.
func ledgerEntryCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, reference string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM ledger_entries WHERE reference=$1`, reference).Scan(&n); err != nil {
		t.Fatalf("count ledger entries for %q: %v", reference, err)
	}
	return n
}

// ---------------------------------------------------------------------------
// BuildRun: aggregate settled settlements into a draft run + lines.
// ProcessRun: post exactly ONE balanced transfer, flip to paid, replay-safe.
// ---------------------------------------------------------------------------

// TestLiveDB_Payout_BuildThenProcess_PostsOneBalancedTransfer_ReplaySafe drives
// the full restaurant payout money path and proves:
//   - BuildRun aggregates the two settled settlements into a DRAFT run whose
//     net_minor == sum(provider_kobo), plus one append-only line per settlement;
//   - ProcessRun (with an Idempotency-Key) flips the run to PAID, posts EXACTLY
//     ONE balanced ledger transfer (settlement account DEBIT == provider wallet
//     CREDIT, equal amounts) referenced 'rpayout:'+runID, and stamps
//     ledger_reference;
//   - a REPLAY of ProcessRun with the SAME key posts NO second ledger move (the
//     provider is never double-paid) and the run stays PAID.
func TestLiveDB_Payout_BuildThenProcess_PostsOneBalancedTransfer_ReplaySafe(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	led := newLiveLedgerService(pool)
	svc := newLiveRestaurantService(pool, led)
	ctx := context.Background()

	owner := seedUser(t, ctx, pool)    // restaurant provider (money lands in this wallet)
	customer := seedUser(t, ctx, pool) // settlement payer
	restID := seedRestaurant(t, ctx, pool, owner)

	// Two delivered orders, each with a settled settlement. provider_kobo is the
	// restaurant's share; net = sum(provider_kobo).
	order1 := seedDeliveredOrder(t, ctx, pool, restID, customer, 5_000_00)
	order2 := seedDeliveredOrder(t, ctx, pool, restID, customer, 3_000_00)
	const p1, f1 = int64(4_000_00), int64(1_000_00) // provider 4000, fee 1000
	const p2, f2 = int64(2_500_00), int64(500_00)   // provider 2500, fee 500
	settle1 := seedSettledSettlement(t, ctx, pool, order1, customer, 5_000_00, f1, p1)
	settle2 := seedSettledSettlement(t, ctx, pool, order2, customer, 3_000_00, f2, p2)

	period := "2026-W28-" + uuid.New().String()[:8]

	// ── BuildRun ──────────────────────────────────────────────────────────────
	run, err := svc.BuildRun(ctx, period, restaurant.PayoutProviderRestaurant, owner)
	if err != nil {
		t.Fatalf("BuildRun: %v", err)
	}
	if run.Status != restaurant.PayoutStatusDraft {
		t.Fatalf("built run status = %s, want draft", run.Status)
	}
	wantNet := p1 + p2
	if run.NetMinor != wantNet {
		t.Errorf("run net_minor = %d, want %d (sum of provider_kobo)", run.NetMinor, wantNet)
	}
	if run.FeeMinor != f1+f2 {
		t.Errorf("run fee_minor = %d, want %d (sum of fee_kobo)", run.FeeMinor, f1+f2)
	}
	if run.GrossMinor != wantNet+f1+f2 {
		t.Errorf("run gross_minor = %d, want %d (net + fees)", run.GrossMinor, wantNet+f1+f2)
	}

	detail, err := svc.GetRun(ctx, run.ID)
	if err != nil {
		t.Fatalf("GetRun after build: %v", err)
	}
	if len(detail.Lines) != 2 {
		t.Fatalf("payout lines = %d, want exactly 2 (one per settled settlement)", len(detail.Lines))
	}
	var lineSum int64
	for _, l := range detail.Lines {
		lineSum += l.AmountMinor
	}
	if lineSum != wantNet {
		t.Errorf("sum of line amounts = %d, want %d (net)", lineSum, wantNet)
	}

	// ── ProcessRun ────────────────────────────────────────────────────────────
	settleAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		t.Fatalf("resolve settlement account: %v", err)
	}
	providerBalBefore, err := led.GetBalance(ctx, owner)
	if err != nil {
		t.Fatalf("provider balance before: %v", err)
	}
	settleBalBefore, err := balanceOf(ctx, pool, settleAcc.ID)
	if err != nil {
		t.Fatalf("settlement account balance before: %v", err)
	}

	key := newIdemKey(t, "rpayout-process")
	paid, err := svc.ProcessRun(ctx, run.ID, key)
	if err != nil {
		t.Fatalf("ProcessRun: %v", err)
	}
	if paid.Status != restaurant.PayoutStatusPaid {
		t.Fatalf("processed run status = %s, want paid", paid.Status)
	}
	if paid.LedgerReference == nil || *paid.LedgerReference != "rpayout:"+run.ID {
		t.Errorf("ledger_reference = %v, want %q", paid.LedgerReference, "rpayout:"+run.ID)
	}

	// Exactly ONE balanced transfer (one DEBIT leg + one CREDIT leg = 2 rows).
	if got := ledgerEntryCount(t, ctx, pool, "rpayout:"+run.ID); got != 2 {
		t.Fatalf("ledger_entries for rpayout:%s = %d, want 2 (one balanced DR/CR pair)", run.ID, got)
	}
	// The provider wallet gained exactly net; the settlement account fell by net.
	providerBalAfter, err := led.GetBalance(ctx, owner)
	if err != nil {
		t.Fatalf("provider balance after: %v", err)
	}
	if providerBalAfter-providerBalBefore != wantNet {
		t.Errorf("provider wallet credited %d, want exactly %d (net)", providerBalAfter-providerBalBefore, wantNet)
	}
	settleBalAfter, err := balanceOf(ctx, pool, settleAcc.ID)
	if err != nil {
		t.Fatalf("settlement account balance after: %v", err)
	}
	if settleBalBefore-settleBalAfter != wantNet {
		t.Errorf("settlement account debited %d, want exactly %d (net) — debit must equal credit (balanced)", settleBalBefore-settleBalAfter, wantNet)
	}

	// ── ProcessRun REPLAY (same key) — no double-pay ─────────────────────────
	replay, err := svc.ProcessRun(ctx, run.ID, key)
	if err != nil {
		t.Fatalf("ProcessRun replay: %v", err)
	}
	if replay.Status != restaurant.PayoutStatusPaid {
		t.Errorf("run status after replay = %s, want still paid", replay.Status)
	}
	if got := ledgerEntryCount(t, ctx, pool, "rpayout:"+run.ID); got != 2 {
		t.Errorf("ledger_entries after replay = %d, want still 2 (NO second ledger move — provider not double-paid)", got)
	}
	providerBalReplay, err := led.GetBalance(ctx, owner)
	if err != nil {
		t.Fatalf("provider balance after replay: %v", err)
	}
	if providerBalReplay != providerBalAfter {
		t.Errorf("provider wallet balance changed on replay: %d -> %d, want unchanged (no double disbursement)", providerBalAfter, providerBalReplay)
	}

	// ── Unique-index guard: a settlement is bound to exactly ONE run ─────────
	// A fresh run for the same provider/settlements over a different period must
	// NOT re-claim settlements already disbursed by the paid run (unique index
	// uq_restaurant_payout_lines_settlement). BuildRun therefore finds nothing.
	period2 := "2026-W29-" + uuid.New().String()[:8]
	run2, err := svc.BuildRun(ctx, period2, restaurant.PayoutProviderRestaurant, owner)
	if err != nil {
		t.Fatalf("BuildRun (second period): %v", err)
	}
	d2, err := svc.GetRun(ctx, run2.ID)
	if err != nil {
		t.Fatalf("GetRun (second period): %v", err)
	}
	if len(d2.Lines) != 0 {
		t.Errorf("second-period run claimed %d lines, want 0 — already-disbursed settlements must not be re-claimed by another run", len(d2.Lines))
	}
	if run2.NetMinor != 0 {
		t.Errorf("second-period run net = %d, want 0 (nothing left to disburse)", run2.NetMinor)
	}

	// And each settlement id appears on exactly ONE payout line across all runs.
	for _, sid := range []string{settle1, settle2} {
		var n int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM restaurant_payout_lines WHERE settlement_id=$1`, sid).Scan(&n); err != nil {
			t.Fatalf("count lines for settlement %s: %v", sid, err)
		}
		if n != 1 {
			t.Errorf("settlement %s appears on %d payout lines, want exactly 1 (bound to one run)", sid, n)
		}
	}
}

// balanceOf projects an account's balance directly from ledger_entries the same
// way the ledger repo does (CREDIT − DEBIT, reversals included), so the test can
// assert the settlement STANDING account's movement without a wallet helper.
func balanceOf(ctx context.Context, pool *pgxpool.Pool, accountID string) (int64, error) {
	// Mirror ledger.Repository.balanceProjectionSQL EXACTLY: CREDIT + REVERSAL_DEBIT
	// count as +balance; everything else (DEBIT, REVERSAL_CREDIT) as −balance.
	const q = `
		SELECT COALESCE(SUM(
			CASE WHEN type IN ('CREDIT','REVERSAL_DEBIT') THEN amount_kobo
			     ELSE -amount_kobo END
		), 0)
		FROM ledger_entries WHERE account_id = $1`
	var bal int64
	err := pool.QueryRow(ctx, q, accountID).Scan(&bal)
	return bal, err
}
