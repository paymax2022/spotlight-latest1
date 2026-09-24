package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration test for FOOD-009: a real order's restaurant/rider
// payout was posted TWICE — once automatically at delivery (settleOrder's call
// to settlement.Settle, which credits the provider/rider wallet directly) and
// again via the restaurant payout-run tool (BuildRun/ProcessRun, which had no
// awareness that the same settlement's provider leg had already landed).
//
// Root cause: loadUnpaidSettlements' only "already paid" signal was whether a
// restaurant_payout_lines row existed for the settlement — it never checked
// whether the ledger already carried Settle()'s own direct credit. Since EVERY
// food_delivery settlement that reaches 'settled' goes through settleOrder
// first (there is no code path that settles one without paying the provider
// directly), the payout-run tool would always pick it up as "unpaid" the
// first time anyone ever ran BuildRun for that provider — a systemic, not
// edge-case, double-payment.
//
// Found live: build+process a payout run for a restaurant with one delivered,
// settled order and watch the owner's wallet balance jump to exactly double
// the correct amount. This test reproduces that exact sequence and proves
// BuildRun now excludes the already-paid settlement instead.
//
// Skipped unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	goredis "github.com/redis/go-redis/v9"

	"github.com/google/uuid"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/finance/tiers"

	"spotlight/backend/internal/testsupport"
)

func TestLiveDB_PayoutRunExcludesSettlementAlreadyPaidDirectlyAtDelivery(t *testing.T) {
	pool := processRunPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := NewService(pool, settlement.NewService(pool, led)).WithLedger(led).WithTiers(tiers.NewService(pool))

	owner := uuid.New().String()
	customer := uuid.New().String()
	rider := uuid.New().String()
	for _, u := range []string{owner, customer, rider} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		testsupport.CleanupUser(t, pool, u)
	}
	seedKYCTier(t, ctx, pool, customer, 3)
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO restaurants (id, owner_id, name, address, is_open, packaging_fee_kobo, kyb_status) VALUES ($1,$2,'PayDup Kitchen','1 St',TRUE,0,'approved')`,
		restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	cat, err := svc.CreateCategory(ctx, restID, owner, "Mains")
	if err != nil {
		t.Fatalf("category: %v", err)
	}
	item, err := svc.CreateItem(ctx, restID, owner, CreateItemRequest{CategoryID: cat.ID, Name: "Jollof", PriceKobo: 500_000})
	if err != nil {
		t.Fatalf("create item: %v", err)
	}
	revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	if err := led.Credit(ctx, customer, "seed-fund", "paydup-fund-"+customer, revAcc.ID, 5_000_000); err != nil {
		t.Fatalf("fund customer: %v", err)
	}

	order, err := svc.PlaceOrder(ctx, restID, customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  "paydup-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place order: %v", err)
	}

	// Deliver it — settleOrder runs here and pays the owner's wallet DIRECTLY.
	if _, err := pool.Exec(ctx,
		`UPDATE orders SET rider_id=$2, status='picked_up', dispatch_status='assigned', delivery_code='4242' WHERE id=$1`,
		order.ID, rider); err != nil {
		t.Fatalf("assign rider: %v", err)
	}
	if err := svc.ConfirmHandoff(ctx, order.ID, rider, "4242"); err != nil {
		t.Fatalf("confirm handoff: %v", err)
	}

	// Confirm the fixture assumption: delivery really did pay the owner directly.
	directProviderLeg := creditLegKobo(t, ctx, pool, "settle:order:"+order.ID+":provider")
	if directProviderLeg <= 0 {
		t.Fatalf("fixture assumes settleOrder paid the owner directly at delivery; got leg=%d", directProviderLeg)
	}
	ownerBalAfterDelivery := prWalletBalance(t, ctx, pool, owner)
	if ownerBalAfterDelivery != directProviderLeg {
		t.Fatalf("owner balance after delivery = %d, want exactly the direct settlement leg %d", ownerBalAfterDelivery, directProviderLeg)
	}

	// Now run the SAME sequence a payout-ops admin would run: build a run for this
	// provider, then process it. Before the fix, this settlement was picked up as
	// "unpaid" and BuildRun/ProcessRun credited the owner's wallet a SECOND time —
	// live-confirmed to double the balance. After the fix, the already-paid
	// settlement is excluded and there is genuinely nothing to build.
	run, err := svc.BuildRun(ctx, "2026-PAYDUP1", PayoutProviderRestaurant, owner)
	if err != nil {
		t.Fatalf("BuildRun: %v", err)
	}
	if run.NetMinor != 0 {
		t.Fatalf("BuildRun picked up an already-directly-paid settlement: NetMinor=%d, want 0 (FOOD-009 regression)", run.NetMinor)
	}

	// ProcessRun on a NetMinor=0 draft correctly refuses to disburse (existing
	// ErrPayoutNothingDue path) rather than posting a zero-amount transfer.
	if _, err := svc.ProcessRun(ctx, run.ID, "paydup-process-"+run.ID); err != ErrPayoutNothingDue {
		t.Fatalf("ProcessRun on the empty run: want ErrPayoutNothingDue, got %v", err)
	}

	// The real proof: the owner's wallet balance is STILL exactly the one direct
	// settlement credit — never doubled.
	ownerBalAfterPayoutAttempt := prWalletBalance(t, ctx, pool, owner)
	if ownerBalAfterPayoutAttempt != directProviderLeg {
		t.Fatalf("owner balance after the payout-run attempt = %d, want still exactly %d (no double-payment)", ownerBalAfterPayoutAttempt, directProviderLeg)
	}
}
