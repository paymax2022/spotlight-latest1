package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration test for the customer tip on the food-delivery money path:
// the tip must be ESCROWED with the order total at placement, PERSISTED on the
// order row, and paid 100% to the rider at settlement — with conservation intact
// (escrow released == provider + platform + rider legs).
//
// Regression guard: PlaceOrder used to drop req.TipKobo entirely (never added to
// the escrowed total, never set on the Order, never in the INSERT column list), so
// a tip was neither charged to the customer nor paid to the rider.
//
// Skipped unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	goredis "github.com/redis/go-redis/v9"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/finance/tiers"

	"spotlight/backend/internal/testsupport"
)

func tipPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB tip test")
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

// creditLegKobo returns the CREDIT amount posted under a settlement leg reference
// (e.g. "settle:order:<id>:rider"), or 0 when the leg was not posted.
func creditLegKobo(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ref string) int64 {
	t.Helper()
	var amt int64
	if err := pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(amount_kobo),0) FROM ledger_entries WHERE reference=$1 AND type='CREDIT'`,
		ref).Scan(&amt); err != nil {
		t.Fatalf("read credit leg %s: %v", ref, err)
	}
	return amt
}

func TestLiveDB_OrderTipEscrowAndRiderPayout(t *testing.T) {
	pool := tipPool(t)
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
	// PlaceOrder's escrow is tier-gated (fail-closed), so the paying customer needs a
	// KYC tier. Tier 3 is unlimited — this test is about the tip, not the cap.
	seedKYCTier(t, ctx, pool, customer, 3)
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open, packaging_fee_kobo) VALUES ($1,$2,'Tip Kitchen','1 St',TRUE,0)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	cat, err := svc.CreateCategory(ctx, restID, owner, "Mains")
	if err != nil {
		t.Fatalf("category: %v", err)
	}
	item, err := svc.CreateItem(ctx, restID, owner, CreateItemRequest{CategoryID: cat.ID, Name: "Jollof", PriceKobo: 450_000})
	if err != nil {
		t.Fatalf("create item: %v", err)
	}

	// Fund the customer generously — both orders below are escrowed from this wallet.
	revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	if err := led.Credit(ctx, customer, "seed-fund", "tipfund-"+customer, revAcc.ID, 5_000_000); err != nil {
		t.Fatalf("fund customer: %v", err)
	}

	// --- Placement: the tip is added to the escrowed total AND persisted. ---
	// No delivery coords → the flat DeliveryFeeKobo applies, so the arithmetic is exact.
	const tip int64 = 50_000 // ₦500
	subtotal := int64(2) * 450_000
	wantTotal := subtotal + DeliveryFeeKobo + tip

	order, err := svc.PlaceOrder(ctx, restID, customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 2}},
		DeliveryAddress: "Victoria Island",
		TipKobo:         tip,
		IdempotencyKey:  "tip-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place tipped order: %v", err)
	}
	if order.TipKobo != tip {
		t.Errorf("returned order tip = %d, want %d", order.TipKobo, tip)
	}
	if order.TotalKobo != wantTotal {
		t.Errorf("returned order total = %d, want %d (subtotal %d + delivery %d + tip %d)",
			order.TotalKobo, wantTotal, subtotal, DeliveryFeeKobo, tip)
	}
	var dbTip, dbTotal int64
	if err := pool.QueryRow(ctx, `SELECT tip_kobo, total_kobo FROM orders WHERE id=$1`, order.ID).Scan(&dbTip, &dbTotal); err != nil {
		t.Fatalf("read order row: %v", err)
	}
	if dbTip != tip {
		t.Errorf("persisted tip_kobo = %d, want %d (the tip was dropped from the INSERT)", dbTip, tip)
	}
	if dbTotal != wantTotal {
		t.Errorf("persisted total_kobo = %d, want %d", dbTotal, wantTotal)
	}
	// The escrow actually HELD the tip: the settlement row is for the tipped total.
	var escrowedTotal int64
	if err := pool.QueryRow(ctx, `SELECT total_kobo FROM settlements WHERE id=$1`, order.SettlementID).Scan(&escrowedTotal); err != nil {
		t.Fatalf("read settlement: %v", err)
	}
	if escrowedTotal != wantTotal {
		t.Errorf("escrowed total = %d, want %d — the tip must be escrowed with the order", escrowedTotal, wantTotal)
	}
	// And the CUSTOMER was actually charged it — the ledger debit is the money move
	// the original bug skipped (the tip was never taken from anyone).
	var debited int64
	if err := pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(amount_kobo),0) FROM ledger_entries WHERE reference=$1 AND type='DEBIT'`,
		"escrow:order:"+order.ID).Scan(&debited); err != nil {
		t.Fatalf("read escrow debit: %v", err)
	}
	if debited != wantTotal {
		t.Errorf("customer debited %d, want %d — the tip must be charged at placement", debited, wantTotal)
	}

	// --- Settlement: the rider is paid its 10% of the NON-tip base + 100% of the tip. ---
	if _, err := pool.Exec(ctx,
		`UPDATE orders SET rider_id=$2, status='picked_up', dispatch_status='assigned', delivery_code='4321' WHERE id=$1`,
		order.ID, rider); err != nil {
		t.Fatalf("assign rider: %v", err)
	}
	if err := svc.ConfirmHandoff(ctx, order.ID, rider, "4321"); err != nil {
		t.Fatalf("confirm handoff: %v", err)
	}

	gross := wantTotal - tip // the base the 80/10/10 percentages price
	wantRider := gross/10 + tip
	wantPlatform := gross / 10
	wantProvider := wantTotal - wantPlatform - wantRider

	legRef := "settle:order:" + order.ID
	gotRider := creditLegKobo(t, ctx, pool, legRef+":rider")
	gotPlatform := creditLegKobo(t, ctx, pool, legRef+":commission")
	gotProvider := creditLegKobo(t, ctx, pool, legRef+":provider")

	if gotRider != wantRider {
		t.Errorf("rider leg = %d, want %d (10%% of %d + the full %d tip)", gotRider, wantRider, gross, tip)
	}
	if gotPlatform != wantPlatform {
		t.Errorf("platform leg = %d, want %d — the platform must take no cut of the tip", gotPlatform, wantPlatform)
	}
	if gotProvider != wantProvider {
		t.Errorf("provider leg = %d, want %d — the restaurant must take no cut of the tip", gotProvider, wantProvider)
	}
	// Conservation: everything escrowed is released, nothing minted.
	if sum := gotRider + gotPlatform + gotProvider; sum != wantTotal {
		t.Errorf("settlement legs sum to %d, want the escrowed total %d", sum, wantTotal)
	}
	var settledProvider, settledFee int64
	var settledStatus string
	if err := pool.QueryRow(ctx,
		`SELECT status, provider_kobo, fee_kobo FROM settlements WHERE id=$1`, order.SettlementID).
		Scan(&settledStatus, &settledProvider, &settledFee); err != nil {
		t.Fatalf("read settled row: %v", err)
	}
	if settledStatus != "settled" {
		t.Errorf("settlement status = %s, want settled", settledStatus)
	}
	if settledProvider != wantProvider || settledFee != wantPlatform {
		t.Errorf("settlement row provider=%d fee=%d, want %d/%d", settledProvider, settledFee, wantProvider, wantPlatform)
	}

	// --- A negative tip is clamped to 0, never treated as a discount. ---
	untipped, err := svc.PlaceOrder(ctx, restID, customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		TipKobo:         -100_000,
		IdempotencyKey:  "tipneg-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place negative-tip order: %v", err)
	}
	if untipped.TipKobo != 0 {
		t.Errorf("negative tip = %d, want it clamped to 0", untipped.TipKobo)
	}
	if want := int64(450_000) + DeliveryFeeKobo; untipped.TotalKobo != want {
		t.Errorf("negative-tip order total = %d, want %d (a negative tip must not discount the order)", untipped.TotalKobo, want)
	}

	// --- A tip larger than the order itself is rejected BEFORE any money moves. ---
	if _, err := svc.PlaceOrder(ctx, restID, customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		TipKobo:         9_000_000,
		IdempotencyKey:  "tipbig-" + uuid.New().String(),
	}); err == nil {
		t.Error("a tip exceeding the order value must be rejected")
	}
}

// TestLiveDB_OrderTipRefundedOnCancel: a cancelled order returns the WHOLE escrow to
// the customer — tip included. The tip is the customer's money until a rider earns it.
func TestLiveDB_OrderTipRefundedOnCancel(t *testing.T) {
	pool := tipPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := NewService(pool, settlement.NewService(pool, led)).WithLedger(led).WithTiers(tiers.NewService(pool))

	owner := uuid.New().String()
	customer := uuid.New().String()
	for _, u := range []string{owner, customer} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		testsupport.CleanupUser(t, pool, u)
	}
	seedKYCTier(t, ctx, pool, customer, 3) // unlimited — the escrow is tier-gated
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open, packaging_fee_kobo) VALUES ($1,$2,'Tip Refund Kitchen','1 St',TRUE,0)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	cat, err := svc.CreateCategory(ctx, restID, owner, "Mains")
	if err != nil {
		t.Fatalf("category: %v", err)
	}
	item, err := svc.CreateItem(ctx, restID, owner, CreateItemRequest{CategoryID: cat.ID, Name: "Suya", PriceKobo: 300_000})
	if err != nil {
		t.Fatalf("create item: %v", err)
	}
	revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	if err := led.Credit(ctx, customer, "seed-fund", "tiprefund-"+customer, revAcc.ID, 2_000_000); err != nil {
		t.Fatalf("fund customer: %v", err)
	}
	before, err := led.GetBalance(ctx, customer)
	if err != nil {
		t.Fatalf("balance before: %v", err)
	}

	order, err := svc.PlaceOrder(ctx, restID, customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		TipKobo:         25_000,
		IdempotencyKey:  "tipcancel-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place tipped order: %v", err)
	}
	if order.TipKobo != 25_000 {
		t.Fatalf("tip = %d, want 25000", order.TipKobo)
	}
	if err := svc.UpdateStatus(ctx, order.ID, customer, OrderCancelled); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	after, err := led.GetBalance(ctx, customer)
	if err != nil {
		t.Fatalf("balance after: %v", err)
	}
	if after != before {
		t.Errorf("customer balance after cancel = %d, want %d — the refund must return the tip too (short by %d)",
			after, before, before-after)
	}
}

// TestLiveDB_OrderTipDroppedWhenEscrowDiverges: settleOrder pays the tip only when the
// escrow covers the order it belongs to. If the two diverge (a PlaceOrder crash between
// Escrow and the order insert, replayed with a different tip), the tip leg is dropped
// rather than paid out of the restaurant's share — and the escrow still fully releases.
func TestLiveDB_OrderTipDroppedWhenEscrowDiverges(t *testing.T) {
	pool := tipPool(t)
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
	seedKYCTier(t, ctx, pool, customer, 3) // unlimited — the escrow is tier-gated
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open, packaging_fee_kobo) VALUES ($1,$2,'Tip Divergence Kitchen','1 St',TRUE,0)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	cat, err := svc.CreateCategory(ctx, restID, owner, "Mains")
	if err != nil {
		t.Fatalf("category: %v", err)
	}
	item, err := svc.CreateItem(ctx, restID, owner, CreateItemRequest{CategoryID: cat.ID, Name: "Egusi", PriceKobo: 400_000})
	if err != nil {
		t.Fatalf("create item: %v", err)
	}
	revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	if err := led.Credit(ctx, customer, "seed-fund", "tipdiv-"+customer, revAcc.ID, 2_000_000); err != nil {
		t.Fatalf("fund customer: %v", err)
	}

	order, err := svc.PlaceOrder(ctx, restID, customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		TipKobo:         40_000,
		IdempotencyKey:  "tipdiv-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place tipped order: %v", err)
	}
	// Simulate the divergence: the escrow row holds LESS than the order claims.
	escrowed := order.TotalKobo - 40_000
	if _, err := pool.Exec(ctx, `UPDATE settlements SET total_kobo=$2 WHERE id=$1`, order.SettlementID, escrowed); err != nil {
		t.Fatalf("diverge escrow: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`UPDATE orders SET rider_id=$2, status='picked_up', dispatch_status='assigned', delivery_code='1234' WHERE id=$1`,
		order.ID, rider); err != nil {
		t.Fatalf("assign rider: %v", err)
	}
	if err := svc.ConfirmHandoff(ctx, order.ID, rider, "1234"); err != nil {
		t.Fatalf("confirm handoff: %v", err)
	}

	legRef := "settle:order:" + order.ID
	gotRider := creditLegKobo(t, ctx, pool, legRef+":rider")
	gotPlatform := creditLegKobo(t, ctx, pool, legRef+":commission")
	gotProvider := creditLegKobo(t, ctx, pool, legRef+":provider")
	if want := escrowed / 10; gotRider != want {
		t.Errorf("rider leg = %d, want %d — a tip the escrow does not cover must not be paid", gotRider, want)
	}
	if sum := gotRider + gotPlatform + gotProvider; sum != escrowed {
		t.Errorf("legs sum to %d, want the escrowed %d — the escrow must still fully release", sum, escrowed)
	}
}
