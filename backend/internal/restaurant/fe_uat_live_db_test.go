package restaurant

// ---------------------------------------------------------------------------
// FE-UAT: independent live-DB reproductions for the Food module UAT test-plan
// rows FE-004, FE-005 and FE-008 (docs/qa/food-restaurant-test-plan.md).
// These are NEW tests, written fresh for this UAT pass — not a re-read of any
// prior batch's coverage. Skipped unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"sync"
	"testing"

	goredis "github.com/redis/go-redis/v9"

	"github.com/google/uuid"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/finance/tiers"

	"spotlight/backend/internal/testsupport"
)

// ── FE-004 ───────────────────────────────────────────────────────────────────
// Reproduces the EXACT crash window reconciler.go's own doc comment describes:
// transitionInternal flips orders.status='delivered' first, then calls
// settleOrder — two separate statements, not one transaction. A crash between
// them leaves a delivered order whose settlement is still 'escrowed'. We force
// that state directly (bypassing settleOrder, mirroring what a real crash
// leaves behind) and then drive the real ReconcileStuckSettlements — the
// production function under test, against the real DB — to confirm it recovers
// the stranded escrow, and that running it AGAIN (as a second sweep, or a
// second instance, would) never double-settles.
func TestLiveDB_FE004_ReconcilerRecoversStrandedEscrowNoDoubleSettle(t *testing.T) {
	pool := tipPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := NewService(pool, settlement.NewService(pool, led)).WithLedger(led).WithTiers(tiers.NewService(pool))

	owner, customer, rider := uuid.New().String(), uuid.New().String(), uuid.New().String()
	for _, u := range []string{owner, customer, rider} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		testsupport.CleanupUser(t, pool, u)
	}
	seedKYCTier(t, ctx, pool, customer, 3)
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open, packaging_fee_kobo) VALUES ($1,$2,'FE004 Kitchen','1 St',TRUE,0)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	cat, err := svc.CreateCategory(ctx, restID, owner, "Mains")
	if err != nil {
		t.Fatalf("category: %v", err)
	}
	item, err := svc.CreateItem(ctx, restID, owner, CreateItemRequest{CategoryID: cat.ID, Name: "Rice", PriceKobo: 300_000})
	if err != nil {
		t.Fatalf("create item: %v", err)
	}
	revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	if err := led.Credit(ctx, customer, "fe004-seed", "fe004fund-"+customer, revAcc.ID, 2_000_000); err != nil {
		t.Fatalf("fund customer: %v", err)
	}

	order, err := svc.PlaceOrder(ctx, restID, customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 1}},
		DeliveryAddress: "Lekki",
		IdempotencyKey:  "fe004-order-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place order: %v", err)
	}

	// Simulate the crash window: flip status to 'delivered' via the SAME bare
	// UPDATE transitionInternal itself issues, WITHOUT calling settleOrder — this
	// is exactly the state a crash between the two statements leaves behind. We
	// also age the settlement's escrowed_at so it clears the reconciler's grace
	// window (which is normally meant to avoid racing an in-flight live delivery).
	if _, err := pool.Exec(ctx, `UPDATE orders SET status='delivered' WHERE id=$1`, order.ID); err != nil {
		t.Fatalf("force delivered: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE settlements SET escrowed_at = now() - interval '1 hour' WHERE id=$1`, order.SettlementID); err != nil {
		t.Fatalf("age settlement: %v", err)
	}

	// Confirm the stranded state exists before reconciling: settlement still
	// escrowed, order delivered, no ledger legs posted for this settlement yet.
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM settlements WHERE id=$1`, order.SettlementID).Scan(&status); err != nil {
		t.Fatalf("read settlement status: %v", err)
	}
	if status != "escrowed" {
		t.Fatalf("precondition failed: settlement status = %s, want escrowed", status)
	}
	ownerAcc, err := led.GetOrCreateUserWallet(ctx, owner)
	if err != nil {
		t.Fatalf("owner wallet: %v", err)
	}
	ownerBalBefore, err := led.GetAccountBalance(ctx, ownerAcc.ID)
	if err != nil {
		t.Fatalf("owner balance: %v", err)
	}
	if ownerBalBefore != 0 {
		t.Fatalf("owner already has balance %d before reconcile — fixture contaminated", ownerBalBefore)
	}

	// Run the REAL reconciler function against the REAL DB, twice in a row —
	// the second call is the "ran again / raced by another instance" case.
	n1, err := svc.ReconcileStuckSettlements(ctx, 0)
	if err != nil {
		t.Fatalf("reconcile #1: %v", err)
	}
	if n1 != 1 {
		t.Fatalf("reconcile #1 reconciled=%d, want 1", n1)
	}
	n2, err := svc.ReconcileStuckSettlements(ctx, 0)
	if err != nil {
		t.Fatalf("reconcile #2: %v", err)
	}
	if n2 != 0 {
		t.Fatalf("reconcile #2 reconciled=%d, want 0 (settlement is no longer 'delivered'+'escrowed' — must not re-settle)", n2)
	}

	if err := pool.QueryRow(ctx, `SELECT status FROM settlements WHERE id=$1`, order.SettlementID).Scan(&status); err != nil {
		t.Fatalf("read settlement status after reconcile: %v", err)
	}
	if status != "settled" {
		t.Fatalf("settlement status after reconcile = %s, want settled", status)
	}

	ownerBalAfter, err := led.GetAccountBalance(ctx, ownerAcc.ID)
	if err != nil {
		t.Fatalf("owner balance after: %v", err)
	}
	if ownerBalAfter <= 0 {
		t.Fatalf("owner balance after reconcile = %d, want > 0 (the 80%% restaurant leg)", ownerBalAfter)
	}

	// Double-settle guard at the ledger level: the rider-less 90/10 restaurant
	// credit leg must exist exactly once, however many times reconcile ran.
	var legCount int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM ledger_entries WHERE idempotency_key = $1`,
		"settle:"+order.SettlementID+":provider:credit").Scan(&legCount); err != nil {
		t.Fatalf("count owner credit legs: %v", err)
	}
	if legCount != 1 {
		t.Fatalf("owner credit ledger legs = %d, want exactly 1 (no double-settle)", legCount)
	}
}

// ── FE-005 ───────────────────────────────────────────────────────────────────
// Independent, fresh reproduction of the double-disbursement protection —
// racing TWO separate payout runs (different period keys, same provider) for
// the SAME settlement via true concurrency (goroutines + a start barrier), not
// a re-read of the prior batch's ProcessRun tests. Proves the settlement can be
// claimed by at most one run's payout line (uq_restaurant_payout_lines_settlement)
// and therefore disbursed at most once even when both runs are processed.
func TestLiveDB_FE005_ConcurrentPayoutRunsNeverDoubleDisburseSameSettlement(t *testing.T) {
	pool := processRunPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := newProcessRunService(pool)

	owner := uuid.New().String()
	customer := uuid.New().String()
	prSeedUser(t, ctx, pool, owner)
	prSeedUser(t, ctx, pool, customer)
	restID := prSeedRestaurant(t, ctx, pool, owner)

	settID := prSeedRestaurantSettlement(t, ctx, pool, restID, customer, 80_000, 5_000)

	// Race two BuildRuns for two DIFFERENT periods (so they are genuinely two
	// separate runs, not the same idempotent draft) against the same provider,
	// fired with a start barrier so both begin their unpaid-settlement read
	// before either commits its line insert — the actual race window BuildRun's
	// own comment documents (ON CONFLICT DO NOTHING on the settlement's unique
	// index absorbing the loser).
	periodA := "2026-FE005-A"
	periodB := "2026-FE005-B"
	var wg sync.WaitGroup
	start := make(chan struct{})
	runs := make([]*PayoutRun, 2)
	errs := make([]error, 2)
	wg.Add(2)
	go func() {
		defer wg.Done()
		<-start
		runs[0], errs[0] = svc.BuildRun(ctx, periodA, PayoutProviderRestaurant, owner)
	}()
	go func() {
		defer wg.Done()
		<-start
		runs[1], errs[1] = svc.BuildRun(ctx, periodB, PayoutProviderRestaurant, owner)
	}()
	close(start)
	wg.Wait()
	if errs[0] != nil || errs[1] != nil {
		t.Fatalf("BuildRun errors: %v / %v", errs[0], errs[1])
	}

	// The unique index must have let exactly ONE of the two runs claim the line.
	if n := prPayoutLineCount(t, ctx, pool, settID); n != 1 {
		t.Fatalf("payout line count for settlement = %d, want exactly 1 across BOTH runs", n)
	}
	if runs[0].NetMinor+runs[1].NetMinor != 80_000 {
		t.Fatalf("combined net across the two runs = %d, want exactly 80000 (claimed once, not split, not doubled)",
			runs[0].NetMinor+runs[1].NetMinor)
	}
	if runs[0].NetMinor != 0 && runs[1].NetMinor != 0 {
		t.Fatalf("BOTH runs claimed the settlement (net %d and %d) — the unique index did not hold", runs[0].NetMinor, runs[1].NetMinor)
	}

	settleAcctBefore := prStandingBalance(t, ctx, pool, "settlement")
	ownerBalBefore := prWalletBalance(t, ctx, pool, owner)

	// Now fire a fresh, live double-disbursement ATTEMPT: ProcessRun BOTH runs
	// (also truly concurrently) — one holds the real settlement money, the other
	// is an empty (net=0) shell that must be refused rather than paid.
	var wg2 sync.WaitGroup
	procErrs := make([]error, 2)
	procRuns := make([]*PayoutRun, 2)
	start2 := make(chan struct{})
	wg2.Add(2)
	go func() {
		defer wg2.Done()
		<-start2
		procRuns[0], procErrs[0] = svc.ProcessRun(ctx, runs[0].ID, "fe005-proc-a-"+uuid.New().String())
	}()
	go func() {
		defer wg2.Done()
		<-start2
		procRuns[1], procErrs[1] = svc.ProcessRun(ctx, runs[1].ID, "fe005-proc-b-"+uuid.New().String())
	}()
	close(start2)
	wg2.Wait()

	// Exactly one of the two must succeed with the real net; the other run has
	// nothing to disburse (net=0) and ProcessRun refuses it fail-closed
	// (ErrPayoutNothingDue) rather than paying it anything.
	paidCount := 0
	for i, e := range procErrs {
		if e == nil {
			paidCount++
			if procRuns[i].NetMinor != 80_000 {
				t.Errorf("processed run %d net = %d, want 80000", i, procRuns[i].NetMinor)
			}
		} else if e != ErrPayoutNothingDue {
			t.Errorf("processed run %d unexpected error: %v", i, e)
		}
	}
	if paidCount != 1 {
		t.Fatalf("paidCount = %d, want exactly 1 (double-disbursement of the same settlement must be refused)", paidCount)
	}

	// DB-level proof: the settlement standing account moved by EXACTLY the
	// settlement's net once, and the owner's wallet received it exactly once.
	settleDelta := settleAcctBefore - prStandingBalance(t, ctx, pool, "settlement")
	ownerDelta := prWalletBalance(t, ctx, pool, owner) - ownerBalBefore
	if settleDelta != 80_000 {
		t.Fatalf("settlement account net debit = %d, want 80000 (exactly one disbursement)", settleDelta)
	}
	if ownerDelta != 80_000 {
		t.Fatalf("owner wallet net credit = %d, want 80000 (exactly one disbursement)", ownerDelta)
	}
}

// ── FE-008 ───────────────────────────────────────────────────────────────────
// A dispute refund on an order whose escrow never reached a rider AT ALL — no
// rider was ever assigned (rider_id NULL throughout, the restaurant's own 90/10
// no-rider settlement branch). disputes_service.go gates the tip-clawback block
// on `riderID != nil && *riderID != ""` — this order never satisfies that, so no
// clawback attempt (phantom or otherwise) can fire, and the refund itself must
// still move the correct money.
func TestLiveDB_FE008_DisputeRefundNoRiderNeverAssignedNoPhantomClawback(t *testing.T) {
	pool := tipPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := NewService(pool, settlement.NewService(pool, led)).WithLedger(led).WithTiers(tiers.NewService(pool))

	owner, customer, admin := uuid.New().String(), uuid.New().String(), uuid.New().String()
	for _, u := range []string{owner, customer, admin} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		testsupport.CleanupUser(t, pool, u)
	}
	seedKYCTier(t, ctx, pool, customer, 3)
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open, packaging_fee_kobo) VALUES ($1,$2,'FE008 Kitchen','1 St',TRUE,0)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	cat, err := svc.CreateCategory(ctx, restID, owner, "Mains")
	if err != nil {
		t.Fatalf("category: %v", err)
	}
	item, err := svc.CreateItem(ctx, restID, owner, CreateItemRequest{CategoryID: cat.ID, Name: "Suya", PriceKobo: 400_000})
	if err != nil {
		t.Fatalf("create item: %v", err)
	}
	revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	if err := led.Credit(ctx, customer, "fe008-seed", "fe008fund-"+customer, revAcc.ID, 2_000_000); err != nil {
		t.Fatalf("fund customer: %v", err)
	}

	const tip int64 = 30_000
	order, err := svc.PlaceOrder(ctx, restID, customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 1}},
		DeliveryAddress: "Ikoyi",
		TipKobo:         tip,
		IdempotencyKey:  "fe008-order-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place order: %v", err)
	}

	// Drive it to 'ready' then straight to 'delivered' WITHOUT ever assigning a
	// rider — no dispatch, no handoff, no pickup code. This exercises the
	// no-rider settlement branch (90/10 restaurant/platform, tip folded in) via
	// the real transitionInternal path (delivered is only reachable internally
	// or via ConfirmHandoff in the live product; here we drive the same function
	// the crash-recovery reconciler and ConfirmHandoff both call).
	if err := svc.transitionInternal(ctx, order.ID, OrderConfirmed); err != nil {
		t.Fatalf("confirm: %v", err)
	}
	if err := svc.transitionInternal(ctx, order.ID, OrderPreparing); err != nil {
		t.Fatalf("preparing: %v", err)
	}
	if err := svc.transitionInternal(ctx, order.ID, OrderReady); err != nil {
		t.Fatalf("ready: %v", err)
	}
	var riderID *string
	if err := pool.QueryRow(ctx, `SELECT rider_id FROM orders WHERE id=$1`, order.ID).Scan(&riderID); err != nil {
		t.Fatalf("read rider_id: %v", err)
	}
	if riderID != nil {
		t.Fatalf("precondition failed: a rider (%s) was auto-dispatched — fixture must have NO rider for this case", *riderID)
	}
	if err := svc.transitionInternal(ctx, order.ID, OrderPickedUp); err != nil {
		t.Fatalf("picked_up (no rider): %v", err)
	}
	if err := svc.transitionInternal(ctx, order.ID, OrderDelivered); err != nil {
		t.Fatalf("deliver (no rider): %v", err)
	}

	var settStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM settlements WHERE id=$1`, order.SettlementID).Scan(&settStatus); err != nil {
		t.Fatalf("read settlement status: %v", err)
	}
	if settStatus != "settled" {
		t.Fatalf("settlement status = %s, want settled", settStatus)
	}

	custBefore, err := led.GetBalance(ctx, customer)
	if err != nil {
		t.Fatalf("customer balance before: %v", err)
	}

	d, err := svc.RaiseFoodDispute(ctx, order.ID, customer, "wrong_item",
		"food arrived wrong and cold — requesting full refund")
	if err != nil {
		t.Fatalf("raise dispute: %v", err)
	}

	res, err := svc.AdminResolveFoodDispute(ctx, d.ID, admin, FoodRefundFull, 0, "confirmed cold food, full refund")
	if err != nil {
		t.Fatalf("resolve dispute (full refund, no rider): %v", err)
	}

	wantRefund := order.TotalKobo - tip // platform-funded refund basis excludes the tip
	if res.RefundKobo != wantRefund {
		t.Fatalf("refund = %d, want %d (total %d − tip %d)", res.RefundKobo, wantRefund, order.TotalKobo, tip)
	}
	custAfter, err := led.GetBalance(ctx, customer)
	if err != nil {
		t.Fatalf("customer balance after: %v", err)
	}
	if delta := custAfter - custBefore; delta != wantRefund {
		t.Fatalf("customer credited %d, want %d", delta, wantRefund)
	}

	// No phantom clawback: zero rows, ever, for this dispute/order.
	var clawbacks int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM restaurant_dispute_tip_clawbacks WHERE dispute_id=$1 OR order_id=$2`,
		d.ID, order.ID).Scan(&clawbacks); err != nil {
		t.Fatalf("count clawbacks: %v", err)
	}
	if clawbacks != 0 {
		t.Fatalf("clawback rows = %d, want 0 (no rider was ever assigned/paid — nothing to claw back, and no attempt should have been made)", clawbacks)
	}
	// The customer's credited delta already proves the tip was NOT additionally
	// refunded by the platform (delta == wantRefund == total-tip exactly, checked
	// above) — there is no rider for a clawback to have paid it from either.
}
