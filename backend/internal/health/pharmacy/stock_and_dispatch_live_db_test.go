package healthpharmacy_test

// ---------------------------------------------------------------------------
// LIVE-DB regression coverage for two defects found live during the Pharmacy
// (Module 15) UAT pass:
//
//   - CreateOrder never decremented stock_qty anywhere, so a product with a
//     small tracked quantity (stock_qty > 0) could be oversold without limit —
//     two concurrent orders for the same last unit both succeeded and both
//     held real money. Fixed with an atomic, compare-and-swap decrement inside
//     the order's own DB transaction, with a compensating escrow refund if the
//     transaction fails AFTER the payment hold already posted (so a stock
//     race never strands the patient's money).
//   - The Go server panicked (nil pointer dereference) on every DELIVERY-
//     fulfilment order's Dispatch call, because health_pharmacy_routes.go
//     wired transport.NewService with a nil settlement.Service — the last-
//     mile courier payout's own internal Escrow call dereferenced it
//     unconditionally. The entire DELIVERY lifecycle could never progress
//     past DISPENSED. Fixed by wiring a real settlement.Service, mirroring
//     finance_routes.go's own transport wiring.
//
// Skips unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/escrow"
	"spotlight/backend/internal/finance/ledger"
	healthpharmacy "spotlight/backend/internal/health/pharmacy"
	"spotlight/backend/internal/testsupport"

	goredis "github.com/redis/go-redis/v9"
)

func stockDispatchPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping pharmacy stock/dispatch live-DB tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// testHoldRef and testEscrowAdapter mirror internal/app's unexported
// escrowAdapter (health_pharmacy_routes.go) — that type can't be imported
// from here, so it's re-created narrowly for this test's own EscrowHolder.
type testHoldRef struct{ id string }

func (h testHoldRef) HoldID() string { return h.id }

type testEscrowAdapter struct{ e *escrow.Service }

func newTestEscrowAdapter(pool *pgxpool.Pool, led *ledger.Service) *testEscrowAdapter {
	return &testEscrowAdapter{e: escrow.NewService(pool, led, nil)}
}

func (a *testEscrowAdapter) Hold(ctx context.Context, payerID, reference, moduleType, idemKey string, amountKobo int64) (healthpharmacy.HoldRef, error) {
	hold, err := a.e.Hold(ctx, payerID, reference, moduleType, idemKey, amountKobo)
	if err != nil {
		return nil, err
	}
	return testHoldRef{id: hold.ID}, nil
}
func (a *testEscrowAdapter) Release(ctx context.Context, escrowID, payeeID string) error {
	return a.e.Release(ctx, escrowID, payeeID)
}
func (a *testEscrowAdapter) Refund(ctx context.Context, escrowID string) error {
	return a.e.Refund(ctx, escrowID)
}

// testProviderGate always reports the given pharmacy as approved/verified —
// this test isn't exercising HL-2, just the stock/dispatch fixes.
type testProviderGate struct{ pharmacyID string }

func (g testProviderGate) VerifiedPharmacyOwner(ctx context.Context, userID, providerID string) (bool, error) {
	return providerID == g.pharmacyID, nil
}
func (g testProviderGate) IsApprovedPharmacy(ctx context.Context, providerID string) (bool, error) {
	return providerID == g.pharmacyID, nil
}

func seedStockFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool, stockQty int) (patientID, pharmacyID, productID string) {
	t.Helper()
	patientID = uuid.New().String()
	pharmacyID = uuid.New().String()
	ownerID := uuid.New().String()
	productID = uuid.New().String()

	for _, u := range []string{patientID, ownerID} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		testsupport.CleanupUser(t, pool, u)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO health_providers (id, owner_user_id, domain, provider_type, display_name, status)
		 VALUES ($1,$2,'PHARMACY','pharmacist','Stock UAT Pharmacy','APPROVED')`, pharmacyID, ownerID); err != nil {
		t.Fatalf("seed provider: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO pharmacy_products (id, pharmacy_provider_id, name, category, nafdac_ref, nafdac_status,
		     rx_required, is_controlled, price_kobo, stock_qty, active)
		 VALUES ($1,$2,'Stock UAT Product','otc',$3,'REGISTERED',false,false,100000,$4,true)`,
		productID, pharmacyID, "NAF-"+productID[:8], stockQty); err != nil {
		t.Fatalf("seed product: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		pool.Exec(bg, `DELETE FROM pharmacy_orders WHERE pharmacy_provider_id=$1`, pharmacyID)
		pool.Exec(bg, `DELETE FROM pharmacy_products WHERE id=$1`, productID)
		pool.Exec(bg, `DELETE FROM health_providers WHERE id=$1`, pharmacyID)
	})
	return
}

func fundWallet(t *testing.T, ctx context.Context, led *ledger.Service, userID string, kobo int64) {
	t.Helper()
	revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	if err := led.Credit(ctx, userID, "stock-uat-seed", "stock-uat-fund-"+userID+"-"+uuid.New().String(), revAcc.ID, kobo); err != nil {
		t.Fatalf("fund wallet: %v", err)
	}
}

// TestLiveDB_CreateOrder_TrackedStockOversellRefused locks the fix: a product
// an owner has opted into tracking (stock_qty > 0) cannot be oversold, and a
// refused order leaves no dangling escrow hold.
func TestLiveDB_CreateOrder_TrackedStockOversellRefused(t *testing.T) {
	pool := stockDispatchPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	patientID, pharmacyID, productID := seedStockFixture(t, ctx, pool, 1) // stock_qty=1, tracked
	fundWallet(t, ctx, led, patientID, 5_000_000)

	escrowAdapter := newTestEscrowAdapter(pool, led)
	svc := healthpharmacy.NewService(pool, escrowAdapter, nil, nil, nil, testProviderGate{pharmacyID: pharmacyID}, nil, nil)

	in := healthpharmacy.CreateOrderInput{
		PharmacyProviderID: pharmacyID,
		FulfilmentMethod:   "PICKUP",
		IdempotencyKey:     "stock-uat-1-" + uuid.New().String(),
		Lines:              []healthpharmacy.OrderLineInput{{ProductID: productID, Quantity: 1}},
	}
	first, err := svc.CreateOrder(ctx, patientID, in)
	if err != nil {
		t.Fatalf("first order (qty 1 against stock 1) must succeed: %v", err)
	}
	if first == nil {
		t.Fatal("nil order returned with no error")
	}

	var stockAfterFirst int
	if err := pool.QueryRow(ctx, `SELECT stock_qty FROM pharmacy_products WHERE id=$1`, productID).Scan(&stockAfterFirst); err != nil {
		t.Fatalf("read stock: %v", err)
	}
	if stockAfterFirst != 0 {
		t.Fatalf("stock_qty after first order = %d, want 0 (decremented)", stockAfterFirst)
	}

	in2 := in
	in2.IdempotencyKey = "stock-uat-2-" + uuid.New().String()
	_, err = svc.CreateOrder(ctx, patientID, in2)
	if err == nil {
		t.Fatal("second order against exhausted stock must be refused")
	}
	if !errors.Is(err, healthpharmacy.ErrInsufficientStock) {
		t.Fatalf("expected ErrInsufficientStock, got: %v", err)
	}

	// The refused order must not leave the patient's money stuck in escrow —
	// the original bug's shape (money moves, no order, un-refunded) — nor a
	// second order row.
	var orderCount int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM pharmacy_orders WHERE idempotency_key=$1`, in2.IdempotencyKey).Scan(&orderCount); err != nil {
		t.Fatalf("count orders: %v", err)
	}
	if orderCount != 0 {
		t.Fatalf("expected no order row for the refused attempt, got %d", orderCount)
	}
	var balance int64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN le.type='CREDIT' THEN le.amount_kobo ELSE -le.amount_kobo END), 0)
		FROM ledger_entries le JOIN ledger_accounts la ON la.id = le.account_id
		WHERE la.user_id = $1`, patientID).Scan(&balance); err != nil {
		t.Fatalf("read wallet balance: %v", err)
	}
	if want := int64(5_000_000 - 100_000); balance != want {
		t.Fatalf("patient wallet balance = %d, want %d (only the FIRST order's hold, second attempt fully refunded)", balance, want)
	}
}

// TestLiveDB_CreateOrder_UntrackedProductStockUnlimited locks the deliberate
// scope decision: stock_qty=0 (the DB default, and today's value for most of
// the live catalog) means "not inventory-tracked", not "zero available" — the
// oversell fix must not block checkout on untracked products.
func TestLiveDB_CreateOrder_UntrackedProductStockUnlimited(t *testing.T) {
	pool := stockDispatchPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	patientID, pharmacyID, productID := seedStockFixture(t, ctx, pool, 0) // untracked
	fundWallet(t, ctx, led, patientID, 5_000_000)

	escrowAdapter := newTestEscrowAdapter(pool, led)
	svc := healthpharmacy.NewService(pool, escrowAdapter, nil, nil, nil, testProviderGate{pharmacyID: pharmacyID}, nil, nil)

	in := healthpharmacy.CreateOrderInput{
		PharmacyProviderID: pharmacyID,
		FulfilmentMethod:   "PICKUP",
		IdempotencyKey:     "stock-uat-untracked-" + uuid.New().String(),
		Lines:              []healthpharmacy.OrderLineInput{{ProductID: productID, Quantity: 3}},
	}
	if _, err := svc.CreateOrder(ctx, patientID, in); err != nil {
		t.Fatalf("order against an untracked (stock_qty=0) product must succeed: %v", err)
	}
	var stockAfter int
	if err := pool.QueryRow(ctx, `SELECT stock_qty FROM pharmacy_products WHERE id=$1`, productID).Scan(&stockAfter); err != nil {
		t.Fatalf("read stock: %v", err)
	}
	if stockAfter != 0 {
		t.Fatalf("stock_qty for an untracked product changed to %d, want unchanged 0", stockAfter)
	}
}

// The Dispatch nil-settlement panic fix (health_pharmacy_routes.go now wires
// transport.NewService(pool, settlement.NewService(pool, ledgerSvc)) instead
// of a nil settlement service) is verified live via a throwaway backend + a
// full order lifecycle curl sweep rather than a unit test here — BookParcel's
// real signature pulls in a maps-routing provider and pricing config that
// would make a package-local test fragile and only loosely representative of
// the actual fix (a one-line wiring change matching finance_routes.go's own
// established pattern for the same transport.Service constructor).
