package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration tests for FOOD-001: the restaurant/rider payout-run
// DISBURSEMENT subsystem (payout.go BuildRun/ProcessRun) had zero test coverage.
// The only existing payout-adjacent test (payout_readiness_live_db_test.go)
// covers the read-only eligibility check (payout_readiness.go), not the real
// money-moving transfer logic here. Skipped unless TEST_DATABASE_URL is set.
//
// Design constraint that shapes these tests: a payout RUN is scoped to exactly
// ONE (provider_type, provider_id, period_key) — see the unique index
// uq_restaurant_payout_runs_provider_period and BuildRun's signature. There is
// no such thing as one run holding both a restaurant owner's and a rider's
// lines. ProcessRun also posts ONE aggregate ledger transfer for the run's net,
// not one transfer per line — so there is no per-line 'failed' status; a run
// fails or succeeds as a whole. The "mixed batch across providers" test below
// therefore builds two independent runs (one per provider type, each with
// multiple settlement lines) and proves they process independently and never
// cross-credit each other's wallet, which is the real-world equivalent of the
// scenario (a payout admin processing a batch of runs touching both restaurant
// owners and riders in one sitting).
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/testsupport"
)

func processRunPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping payout ProcessRun live-DB tests")
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

// prSeedUser inserts a minimal auth.users row and registers cleanup.
func prSeedUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id string) {
	t.Helper()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, id, id+"@seed.test"); err != nil {
		t.Fatalf("seed user %s: %v", id, err)
	}
	testsupport.CleanupUser(t, pool, id)
}

// prSeedRestaurant inserts a KYB-approved restaurant (PY-007 payout gate) owned
// by ownerID.
func prSeedRestaurant(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ownerID string) string {
	t.Helper()
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO restaurants (id, owner_id, name, address, is_open, kyb_status) VALUES ($1,$2,'PR Kitchen','1 St',TRUE,'approved')`,
		restID, ownerID); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM restaurants WHERE id=$1`, restID) })
	return restID
}

// prSeedRestaurantSettlement seeds a settled, unpaid settlement + delivered order
// for a restaurant provider (BuildRun's PayoutProviderRestaurant branch pays
// out st.provider_kobo). Returns the settlement id.
func prSeedRestaurantSettlement(t *testing.T, ctx context.Context, pool *pgxpool.Pool, restID, customerID string, providerKobo, feeKobo int64) string {
	t.Helper()
	oid := uuid.New().String()
	settID := uuid.New().String()
	totalKobo := providerKobo + feeKobo + 10000
	if _, err := pool.Exec(ctx, `
		INSERT INTO settlements (id, reference, module_type, payer_id, total_kobo, provider_kobo, fee_kobo, idempotency_key, status, settled_at)
		VALUES ($1,$2,'food_delivery',$3,$4,$5,$6,$7,'settled',now())`,
		settID, "order:"+oid, customerID, totalKobo, providerKobo, feeKobo, "pr-"+settID); err != nil {
		t.Fatalf("seed settlement: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO orders (id, customer_id, restaurant_id, subtotal_kobo, total_kobo, status, idempotency_key, delivery_address, settlement_id)
		VALUES ($1,$2,$3,$4,$4,'delivered',$5,'1 Test St',$6)`,
		oid, customerID, restID, totalKobo, "prorder-"+oid, settID); err != nil {
		t.Fatalf("seed order: %v", err)
	}
	return settID
}

// prSeedRiderSettlement seeds a settled, unpaid settlement + delivered order
// carrying a rider_id (BuildRun's PayoutProviderRider branch pays out the
// remainder: total - provider - fee).
func prSeedRiderSettlement(t *testing.T, ctx context.Context, pool *pgxpool.Pool, restID, customerID, riderID string, riderShare, providerKobo, feeKobo int64) string {
	t.Helper()
	oid := uuid.New().String()
	settID := uuid.New().String()
	totalKobo := riderShare + providerKobo + feeKobo
	if _, err := pool.Exec(ctx, `
		INSERT INTO settlements (id, reference, module_type, payer_id, total_kobo, provider_kobo, fee_kobo, idempotency_key, status, settled_at)
		VALUES ($1,$2,'food_delivery',$3,$4,$5,$6,$7,'settled',now())`,
		settID, "order:"+oid, customerID, totalKobo, providerKobo, feeKobo, "pr-"+settID); err != nil {
		t.Fatalf("seed settlement: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO orders (id, customer_id, restaurant_id, rider_id, subtotal_kobo, total_kobo, status, idempotency_key, delivery_address, settlement_id)
		VALUES ($1,$2,$3,$4,$5,$5,'delivered',$6,'1 Test St',$7)`,
		oid, customerID, restID, riderID, totalKobo, "prorder-"+oid, settID); err != nil {
		t.Fatalf("seed order: %v", err)
	}
	return settID
}

// prWalletBalance sums the ledger_entries for a user's wallet directly (not via
// the service), mirroring the pattern in disputes_live_db_test.go's walletBalance.
func prWalletBalance(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string) int64 {
	t.Helper()
	var bal int64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN e.type IN ('CREDIT','REVERSAL_CREDIT') THEN e.amount_kobo ELSE -e.amount_kobo END),0)
		FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
		WHERE a.user_id=$1`, userID).Scan(&bal); err != nil {
		t.Fatalf("wallet balance for %s: %v", userID, err)
	}
	return bal
}

// prSettlementDebitKobo returns the total kobo debited FROM the standing settlement
// account by one or more payout runs' own deterministic journals — the DEBIT leg(s)
// PostJournal writes under "<run.IdempotencyKey>:debit" (repository.go suffixes the
// balanced pair ":debit"/":credit"). 0 means nothing was posted.
//
// Deliberately NOT a before/after read of the account's BALANCE. settlement is a single
// global standing account also moved by estate dues, academy, connect, realtor and other
// suites, and `go test ./...` runs packages concurrently against one database (make test
// / CI) — a balance delta flakes on their postings and misattributes them to this payout.
// A run's idempotency key is deterministic (rpayout:<type>:<provider>:<period>) on a
// provider seeded fresh per test, so the key scopes the read to exactly what this fixture
// caused, and its absence just as exactly.
func prSettlementDebitKobo(t *testing.T, ctx context.Context, pool *pgxpool.Pool, runIdemKeys ...string) int64 {
	t.Helper()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	settleAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		t.Fatalf("settlement standing account: %v", err)
	}
	var total int64
	for _, k := range runIdemKeys {
		var paid int64
		if err := pool.QueryRow(ctx,
			`SELECT COALESCE(SUM(amount_kobo),0) FROM ledger_entries
			  WHERE idempotency_key=$1 AND type='DEBIT' AND account_id=$2`,
			k+":debit", settleAcc.ID).Scan(&paid); err != nil {
			t.Fatalf("read settlement debit leg %s: %v", k, err)
		}
		total += paid
	}
	return total
}

// prPayoutLineCount counts restaurant_payout_lines rows for a settlement — the
// unique index uq_restaurant_payout_lines_settlement guarantees this is at
// most 1 across the WHOLE table, not just within one run.
func prPayoutLineCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, settlementID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM restaurant_payout_lines WHERE settlement_id=$1`, settlementID).Scan(&n); err != nil {
		t.Fatalf("payout line count: %v", err)
	}
	return n
}

func newProcessRunService(pool *pgxpool.Pool) *Service {
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	return NewService(pool, nil).WithLedger(led)
}

// TestLiveDB_ProcessRunHappyPath: a real settled-but-unpaid settlement is built
// into a draft run and disbursed. Proves — via direct SQL against
// ledger_entries, not just the returned struct — that ProcessRun posts a real
// balanced double-entry transfer (settlement standing account debited,
// provider wallet credited, by exactly the run's net), marks the settlement
// disbursed exactly once, and flips the run's own status to 'paid'.
func TestLiveDB_ProcessRunHappyPath(t *testing.T) {
	pool := processRunPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := newProcessRunService(pool)

	owner := uuid.New().String()
	customer := uuid.New().String()
	prSeedUser(t, ctx, pool, owner)
	prSeedUser(t, ctx, pool, customer)
	restID := prSeedRestaurant(t, ctx, pool, owner)

	settID := prSeedRestaurantSettlement(t, ctx, pool, restID, customer, 60000, 5000)

	ownerBalBefore := prWalletBalance(t, ctx, pool, owner)

	run, err := svc.BuildRun(ctx, "2026-HP1", PayoutProviderRestaurant, owner)
	if err != nil {
		t.Fatalf("BuildRun: %v", err)
	}
	if run.Status != PayoutStatusDraft {
		t.Fatalf("freshly built run status = %s, want draft", run.Status)
	}
	if run.NetMinor != 60000 {
		t.Fatalf("run.NetMinor = %d, want 60000", run.NetMinor)
	}

	paid, err := svc.ProcessRun(ctx, run.ID, "idem-happy-path-1")
	if err != nil {
		t.Fatalf("ProcessRun: %v", err)
	}
	if paid.Status != PayoutStatusPaid {
		t.Fatalf("run status after ProcessRun = %s, want paid", paid.Status)
	}
	if paid.LedgerReference == nil || *paid.LedgerReference != "rpayout:"+run.ID {
		t.Fatalf("ledger_reference = %v, want rpayout:%s", paid.LedgerReference, run.ID)
	}
	if paid.ProcessedAt == nil {
		t.Fatal("processed_at not stamped")
	}

	// Direct SQL proof: this run's own journal debited the settlement standing
	// account by exactly net, and the owner's wallet moved UP by exactly net — a
	// real balanced double-entry, not a status-flip with no money behind it.
	ownerBalAfter := prWalletBalance(t, ctx, pool, owner)
	if got := prSettlementDebitKobo(t, ctx, pool, run.IdempotencyKey); got != 60000 {
		t.Errorf("settlement standing account debited %d kobo for this run, want 60000", got)
	}
	if delta := ownerBalAfter - ownerBalBefore; delta != 60000 {
		t.Errorf("owner wallet delta = %d, want 60000", delta)
	}

	// The settlement is claimed by exactly one payout line — disbursed exactly
	// once (uq_restaurant_payout_lines_settlement).
	if n := prPayoutLineCount(t, ctx, pool, settID); n != 1 {
		t.Errorf("payout line count for settlement = %d, want 1", n)
	}

	// Re-fetching via GetRun (the admin-console read path) agrees with the
	// direct ProcessRun return.
	detail, err := svc.GetRun(ctx, run.ID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	if detail.Status != PayoutStatusPaid || detail.NetMinor != 60000 {
		t.Errorf("GetRun disagrees with ProcessRun result: status=%s net=%d", detail.Status, detail.NetMinor)
	}
	if len(detail.Lines) != 1 || detail.Lines[0].SettlementID == nil || *detail.Lines[0].SettlementID != settID {
		t.Errorf("GetRun lines = %+v, want exactly the one seeded settlement", detail.Lines)
	}
}

// TestLiveDB_ProcessRunNeverDoublePays proves the double-disbursement guard
// end to end, through the REAL BuildRun/ProcessRun call path (not a raw SQL
// probe of the unique index):
//   - replaying ProcessRun on the SAME already-paid run is an idempotent
//     no-op that does not re-credit the wallet;
//   - building a SECOND run for the SAME provider in a DIFFERENT period, after
//     the settlement is already claimed, aggregates to net=0 (the settlement
//     is invisible to loadUnpaidSettlements once any line claims it), so
//     ProcessRun on that second run correctly refuses with ErrPayoutNothingDue
//     rather than paying the same settlement again under a different run.
func TestLiveDB_ProcessRunNeverDoublePays(t *testing.T) {
	pool := processRunPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := newProcessRunService(pool)

	owner := uuid.New().String()
	customer := uuid.New().String()
	prSeedUser(t, ctx, pool, owner)
	prSeedUser(t, ctx, pool, customer)
	restID := prSeedRestaurant(t, ctx, pool, owner)
	settID := prSeedRestaurantSettlement(t, ctx, pool, restID, customer, 45000, 5000)

	runA, err := svc.BuildRun(ctx, "2026-DP1", PayoutProviderRestaurant, owner)
	if err != nil {
		t.Fatalf("BuildRun A: %v", err)
	}
	paidA, err := svc.ProcessRun(ctx, runA.ID, "idem-double-pay-a")
	if err != nil {
		t.Fatalf("ProcessRun A: %v", err)
	}
	balAfterFirst := prWalletBalance(t, ctx, pool, owner)

	// Replaying ProcessRun on the SAME run (e.g. a retried admin click) must be
	// an idempotent no-op returning the already-paid run, not an error and not
	// a second credit.
	replay, err := svc.ProcessRun(ctx, runA.ID, "idem-double-pay-a-retry")
	if err != nil {
		t.Fatalf("ProcessRun replay: want idempotent success, got error %v", err)
	}
	if replay.Status != PayoutStatusPaid || replay.ID != paidA.ID {
		t.Fatalf("replay result = %+v, want the same paid run", replay)
	}
	if bal := prWalletBalance(t, ctx, pool, owner); bal != balAfterFirst {
		t.Fatalf("wallet balance changed on replay: %d != %d", bal, balAfterFirst)
	}

	// A second run for the SAME provider, a DIFFERENT period: the settlement is
	// already claimed by runA's line, so BuildRun for period B must aggregate
	// to net=0 — it must NOT re-claim the settlement into a second payable run.
	runB, err := svc.BuildRun(ctx, "2026-DP2", PayoutProviderRestaurant, owner)
	if err != nil {
		t.Fatalf("BuildRun B: %v", err)
	}
	if runB.ID == runA.ID {
		t.Fatalf("BuildRun for a different period returned the SAME run id")
	}
	if runB.NetMinor != 0 {
		t.Fatalf("run B net = %d, want 0 (settlement already claimed by run A)", runB.NetMinor)
	}

	// Attempting to disburse the (empty) second run must fail closed rather
	// than silently posting a zero/duplicate transfer.
	if _, err := svc.ProcessRun(ctx, runB.ID, "idem-double-pay-b"); !errors.Is(err, ErrPayoutNothingDue) {
		t.Fatalf("ProcessRun on the empty second run: want ErrPayoutNothingDue, got %v", err)
	}
	if bal := prWalletBalance(t, ctx, pool, owner); bal != balAfterFirst {
		t.Fatalf("wallet balance changed after processing the empty second run: %d != %d", bal, balAfterFirst)
	}

	// The DB-level guarantee behind all of this: the settlement is claimed by
	// exactly one payout line in the WHOLE table, never two.
	if n := prPayoutLineCount(t, ctx, pool, settID); n != 1 {
		t.Errorf("payout line count for settlement = %d, want 1 (double-disbursement guard)", n)
	}
}

// TestLiveDB_ProcessRunMixedProviderBatch builds and processes two independent
// runs in the same "batch" sitting — a restaurant owner with TWO settled
// orders folded into one run, and a rider with TWO settled orders folded into
// a separate run — and proves each provider's wallet receives exactly its own
// correctly-computed, correctly-directed amount, with no cross-crediting.
// (A single run cannot span two providers — see the file header — so this is
// the faithful equivalent of "a batch touching a restaurant and a rider".)
func TestLiveDB_ProcessRunMixedProviderBatch(t *testing.T) {
	pool := processRunPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := newProcessRunService(pool)

	owner := uuid.New().String()
	rider := uuid.New().String()
	customer := uuid.New().String()
	prSeedUser(t, ctx, pool, owner)
	prSeedUser(t, ctx, pool, rider)
	prSeedUser(t, ctx, pool, customer)
	restID := prSeedRestaurant(t, ctx, pool, owner)

	// Restaurant owner: two settled orders → provider shares 30000 + 20000 = 50000.
	prSeedRestaurantSettlement(t, ctx, pool, restID, customer, 30000, 4000)
	prSeedRestaurantSettlement(t, ctx, pool, restID, customer, 20000, 3000)
	// Rider: two settled orders on the SAME restaurant, but with provider_kobo=0
	// so they do NOT also count towards the owner's restaurant payout run above
	// (the restaurant branch requires provider_kobo > 0; the rider branch pays
	// the remainder total-provider-fee regardless of provider_kobo) → rider
	// shares 15000 + 12000 = 27000.
	prSeedRiderSettlement(t, ctx, pool, restID, customer, rider, 15000, 0, 4000)
	prSeedRiderSettlement(t, ctx, pool, restID, customer, rider, 12000, 0, 3000)

	ownerBalBefore := prWalletBalance(t, ctx, pool, owner)
	riderBalBefore := prWalletBalance(t, ctx, pool, rider)

	ownerRun, err := svc.BuildRun(ctx, "2026-MIX1", PayoutProviderRestaurant, owner)
	if err != nil {
		t.Fatalf("BuildRun owner: %v", err)
	}
	if ownerRun.NetMinor != 50000 {
		t.Fatalf("owner run net = %d, want 50000", ownerRun.NetMinor)
	}
	riderRun, err := svc.BuildRun(ctx, "2026-MIX1", PayoutProviderRider, rider)
	if err != nil {
		t.Fatalf("BuildRun rider: %v", err)
	}
	if riderRun.NetMinor != 27000 {
		t.Fatalf("rider run net = %d, want 27000", riderRun.NetMinor)
	}

	if _, err := svc.ProcessRun(ctx, ownerRun.ID, "idem-mix-owner"); err != nil {
		t.Fatalf("ProcessRun owner: %v", err)
	}
	if _, err := svc.ProcessRun(ctx, riderRun.ID, "idem-mix-rider"); err != nil {
		t.Fatalf("ProcessRun rider: %v", err)
	}

	ownerBalAfter := prWalletBalance(t, ctx, pool, owner)
	riderBalAfter := prWalletBalance(t, ctx, pool, rider)
	if delta := ownerBalAfter - ownerBalBefore; delta != 50000 {
		t.Errorf("owner wallet delta = %d, want 50000 (not confused with the rider's share)", delta)
	}
	if delta := riderBalAfter - riderBalBefore; delta != 27000 {
		t.Errorf("rider wallet delta = %d, want 27000 (not confused with the owner's share)", delta)
	}
}

// TestLiveDB_ProcessRunConcurrentClaimIsSingleWinner proves the fail-closed
// concurrency guard the code comments promise: two callers racing ProcessRun
// on the SAME draft run (e.g. a double-clicked admin button, or two API
// replicas both picking up a retry) must result in exactly ONE ledger transfer
// — the guarded `UPDATE ... WHERE status='draft'` means only one caller can
// ever win the draft->processing claim.
func TestLiveDB_ProcessRunConcurrentClaimIsSingleWinner(t *testing.T) {
	pool := processRunPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := newProcessRunService(pool)

	owner := uuid.New().String()
	customer := uuid.New().String()
	prSeedUser(t, ctx, pool, owner)
	prSeedUser(t, ctx, pool, customer)
	restID := prSeedRestaurant(t, ctx, pool, owner)
	prSeedRestaurantSettlement(t, ctx, pool, restID, customer, 33000, 2000)

	run, err := svc.BuildRun(ctx, "2026-RACE1", PayoutProviderRestaurant, owner)
	if err != nil {
		t.Fatalf("BuildRun: %v", err)
	}

	const racers = 5
	var wg sync.WaitGroup
	results := make([]error, racers)
	statuses := make([]string, racers)
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			r, err := svc.ProcessRun(ctx, run.ID, "idem-race")
			results[i] = err
			if r != nil {
				statuses[i] = r.Status
			}
		}(i)
	}
	wg.Wait()

	successes := 0
	for i := 0; i < racers; i++ {
		if results[i] == nil {
			successes++
			if statuses[i] != PayoutStatusPaid {
				t.Errorf("racer %d succeeded but status = %s, want paid", i, statuses[i])
			}
		}
	}
	// Every racer either wins the claim outright, or (once the winner has
	// already finalised to 'paid') observes the idempotent already-paid path —
	// both are modeled as success here. What must NEVER happen is more than one
	// ledger transfer landing. A racer that hits the run mid-'processing' (not
	// yet 'paid') correctly errors rather than double-posting — that is the
	// fail-closed behavior under test, not a bug.
	if successes == 0 {
		t.Fatalf("no racer succeeded at all: %+v", results)
	}

	// The real proof: exactly ONE balanced transfer posted, regardless of how
	// many callers raced.
	ownerBal := prWalletBalance(t, ctx, pool, owner)
	if ownerBal != 33000 {
		t.Fatalf("owner wallet balance = %d, want exactly 33000 (single transfer, no double-post under concurrency)", ownerBal)
	}
}

// TestLiveDB_ProcessRunUnknownRunFailsCleanly: a bad/unknown run id (malformed
// admin request, stale link, id typo) must fail closed with the typed
// ErrPayoutRunNotFound rather than a generic/ambiguous error or, worse, a
// silent no-op that looks like success.
func TestLiveDB_ProcessRunUnknownRunFailsCleanly(t *testing.T) {
	pool := processRunPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := newProcessRunService(pool)

	if _, err := svc.ProcessRun(ctx, uuid.New().String(), "idem-unknown-run"); !errors.Is(err, ErrPayoutRunNotFound) {
		t.Fatalf("ProcessRun(unknown id): want ErrPayoutRunNotFound, got %v", err)
	}
}

// TestLiveDB_ProcessRunRecoversFromCrashBetweenPostAndFinalise: FOOD-002.
//
// ProcessRun's real sequence is: (1) atomically claim the run draft->processing,
// (2) post the ledger transfer, (3) atomically finalise processing->paid. If the
// process dies after (2) commits but before (3) does, the run was stuck at
// 'processing' FOREVER — a retry's claim query requires status='draft' (fails),
// falls through to the existing.Status check, sees 'processing' (not 'paid'),
// and returned a bare "not disbursable" error. The money had already moved;
// only the run's own bookkeeping never caught up. Nothing else in the codebase
// reconciled this (no cron, no admin retry-to-paid path).
//
// This simulates that exact crash window directly — claim the run and post the
// real ledger transfer by hand, WITHOUT running the finalise step — then calls
// ProcessRun again exactly as an operator retrying a stuck run would, and
// proves it now recovers to 'paid' (using the ledger as the source of truth,
// via ledger.Posted) instead of erroring forever, and that recovery reuses the
// existing transfer rather than posting a second one.
func TestLiveDB_ProcessRunRecoversFromCrashBetweenPostAndFinalise(t *testing.T) {
	pool := processRunPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := newProcessRunService(pool)
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))

	owner := uuid.New().String()
	customer := uuid.New().String()
	prSeedUser(t, ctx, pool, owner)
	prSeedUser(t, ctx, pool, customer)
	restID := prSeedRestaurant(t, ctx, pool, owner)
	prSeedRestaurantSettlement(t, ctx, pool, restID, customer, 42000, 3000)

	run, err := svc.BuildRun(ctx, "2026-CRASH1", PayoutProviderRestaurant, owner)
	if err != nil {
		t.Fatalf("BuildRun: %v", err)
	}

	// Manually reproduce steps (1) and (2) of ProcessRun, then STOP — simulating
	// the process dying before step (3)'s finalise UPDATE commits.
	if _, err := pool.Exec(ctx,
		`UPDATE restaurant_payout_runs SET status='processing' WHERE id=$1 AND status='draft'`, run.ID); err != nil {
		t.Fatalf("simulate claim: %v", err)
	}
	settleAcct, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		t.Fatalf("GetOrCreateStandingAccount: %v", err)
	}
	ownerWallet, err := led.GetOrCreateUserWallet(ctx, owner)
	if err != nil {
		t.Fatalf("GetOrCreateUserWallet: %v", err)
	}
	if err := led.PostJournal(ctx, ledger.JournalEntry{
		Reference:       "rpayout:" + run.ID,
		IdempotencyKey:  run.IdempotencyKey,
		AmountKobo:      run.NetMinor,
		DebitAccountID:  settleAcct.ID,
		CreditAccountID: ownerWallet.ID,
		Description:     "restaurant payout run " + string(PayoutProviderRestaurant),
	}); err != nil {
		t.Fatalf("simulate PostJournal: %v", err)
	}
	// Confirm the crash state: money moved, run bookkeeping did not.
	var stuckStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM restaurant_payout_runs WHERE id=$1`, run.ID).Scan(&stuckStatus); err != nil {
		t.Fatalf("read stuck run: %v", err)
	}
	if stuckStatus != PayoutStatusProcessing {
		t.Fatalf("simulated crash state: run status = %s, want processing", stuckStatus)
	}
	ownerBalAfterCrash := prWalletBalance(t, ctx, pool, owner)
	if ownerBalAfterCrash != 42000 {
		t.Fatalf("owner wallet after simulated crash = %d, want 42000 (money already moved)", ownerBalAfterCrash)
	}

	// The recovery call: an operator (or the admin console's own retry action)
	// calls ProcessRun again on the stuck run, exactly as they would on any
	// other unprocessed-looking run.
	recovered, err := svc.ProcessRun(ctx, run.ID, "idem-recovery-retry")
	if err != nil {
		t.Fatalf("ProcessRun recovery retry: want success, got error: %v", err)
	}
	if recovered.Status != PayoutStatusPaid {
		t.Fatalf("recovered run status = %s, want paid", recovered.Status)
	}
	if recovered.LedgerReference == nil || *recovered.LedgerReference != "rpayout:"+run.ID {
		t.Fatalf("recovered ledger_reference = %v, want rpayout:%s", recovered.LedgerReference, run.ID)
	}

	// The real proof: recovery did NOT post a second transfer. Balance is still
	// exactly the one amount that moved during the simulated crash.
	ownerBalAfterRecovery := prWalletBalance(t, ctx, pool, owner)
	if ownerBalAfterRecovery != 42000 {
		t.Fatalf("owner wallet after recovery = %d, want still 42000 (recovery must not double-pay)", ownerBalAfterRecovery)
	}
}
