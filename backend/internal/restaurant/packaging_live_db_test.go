package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration test for the takeaway-packaging charge.
//
// SCOPE — read it before trusting this:
//   * COVERS the persistence + read wiring. packaging_kobo was added to SIX
//     order SELECTs against THREE shared scan sites; a column/scan mismatch in
//     pgx fails at RUNTIME, not compile time, so this is the check that catches
//     it. Every order read path is exercised: GetOrder, ListOrders (all three
//     role variants) and queryOrders (rider offers/active).
//   * COVERS the money invariant at rest: total_kobo == subtotal + delivery +
//     packaging for a row carrying a packaging charge.
//   * DOES NOT cover PlaceOrder's escrow arithmetic end to end — that needs a
//     real settlement + ledger service. The pure clamp/multiply is table-tested
//     in packaging_test.go; the missing piece is an assertion that the ESCROWED
//     amount includes packaging. Still owed, along with a ledger-auditor review.
//
// Skipped unless TEST_DATABASE_URL/DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func packagingLivePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL/DATABASE_URL set — skipping live-DB packaging test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	return pool
}

func TestLiveDB_PackagingPersistsAndReadsBack(t *testing.T) {
	pool := packagingLivePool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := NewService(pool, nil)

	owner := uuid.New().String()
	customer := uuid.New().String()
	rider := uuid.New().String()
	for _, u := range []string{owner, customer, rider} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}

	// A store that charges ₦200 per pack.
	const packFee int64 = 20000
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO restaurants (id, owner_id, name, address, is_open, packaging_fee_kobo)
		 VALUES ($1,$2,'Packaging Kitchen','1 St',TRUE,$3)`, restID, owner, packFee); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}

	// The fee must survive the round trip — the admin console reads it back to
	// show the operator what a store charges.
	var storeFee int64
	if err := pool.QueryRow(ctx,
		`SELECT packaging_fee_kobo FROM restaurants WHERE id=$1`, restID).Scan(&storeFee); err != nil {
		t.Fatalf("read store fee: %v", err)
	}
	if storeFee != packFee {
		t.Fatalf("store packaging_fee_kobo = %d, want %d", storeFee, packFee)
	}

	// An order carrying a 3-pack charge. Inserted directly so this test stays
	// independent of the escrow/ledger stack (see SCOPE above).
	const (
		subtotal  int64 = 750_000
		delivery  int64 = 50_000
		packaging       = packFee * 3
	)
	total := subtotal + delivery + packaging
	orderID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO orders (id, customer_id, restaurant_id, rider_id, subtotal_kobo, delivery_kobo,
		                     packaging_kobo, total_kobo, status, idempotency_key, delivery_address)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,'1 Test St')`,
		orderID, customer, restID, rider, subtotal, delivery, packaging, total,
		"packaging-"+uuid.New().String()); err != nil {
		t.Fatalf("seed order: %v", err)
	}

	// ── GetOrder (single-row scan site) ──────────────────────────────────
	got, err := svc.GetOrder(ctx, orderID, customer)
	if err != nil {
		t.Fatalf("GetOrder: %v", err)
	}
	if got.PackagingKobo != packaging {
		t.Fatalf("GetOrder packaging_kobo = %d, want %d (column/scan misalignment?)",
			got.PackagingKobo, packaging)
	}
	// The money invariant at rest. If this fails the row is internally
	// inconsistent and settlement would divide a total that isn't the sum of
	// its parts.
	if sum := got.SubtotalKobo + got.DeliveryKobo + got.PackagingKobo; sum != got.TotalKobo {
		t.Fatalf("total_kobo = %d but subtotal+delivery+packaging = %d", got.TotalKobo, sum)
	}

	// ── ListOrders: all three role variants share ONE scan loop, so each
	//    variant's column list must line up with it.
	for _, role := range []string{"customer", "restaurant", "rider"} {
		var actor string
		switch role {
		case "customer":
			actor = customer
		case "restaurant":
			actor = owner
		case "rider":
			actor = rider
		}
		list, err := svc.ListOrders(ctx, actor, role)
		if err != nil {
			t.Fatalf("ListOrders(%s): %v", role, err)
		}
		var found bool
		for _, o := range list {
			if o.ID != orderID {
				continue
			}
			found = true
			if o.PackagingKobo != packaging {
				t.Fatalf("ListOrders(%s) packaging_kobo = %d, want %d", role, o.PackagingKobo, packaging)
			}
			if sum := o.SubtotalKobo + o.DeliveryKobo + o.PackagingKobo; sum != o.TotalKobo {
				t.Fatalf("ListOrders(%s): total %d != sum %d", role, o.TotalKobo, sum)
			}
		}
		if !found {
			t.Fatalf("ListOrders(%s) did not return the seeded order", role)
		}
	}

	// ── queryOrders (the shared helper behind RiderOffers/RiderActive). The
	//    order is assigned to this rider and not terminal, so it is active.
	active, err := svc.RiderActive(ctx, rider)
	if err != nil {
		t.Fatalf("RiderActive: %v", err)
	}
	var seen bool
	for _, o := range active {
		if o.ID != orderID {
			continue
		}
		seen = true
		if o.PackagingKobo != packaging {
			t.Fatalf("RiderActive packaging_kobo = %d, want %d", o.PackagingKobo, packaging)
		}
	}
	if !seen {
		t.Fatal("RiderActive did not return the seeded order for the assigned rider")
	}

	// A store that has not opted in must still charge nothing — this is the
	// default for every restaurant, so a regression here reprices the platform.
	var defaultFee int64
	freeID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'Free Packing','2 St',TRUE)`,
		freeID, owner); err != nil {
		t.Fatalf("seed free restaurant: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT packaging_fee_kobo FROM restaurants WHERE id=$1`, freeID).Scan(&defaultFee); err != nil {
		t.Fatalf("read default fee: %v", err)
	}
	if defaultFee != 0 {
		t.Fatalf("a new restaurant defaults to packaging_fee_kobo = %d, want 0", defaultFee)
	}
	if charged := packagingKobo(5, 10, defaultFee); charged != 0 {
		t.Fatalf("opted-out store charged %d, want 0", charged)
	}

	// Cleanup — keep the shared local DB tidy for the next run.
	_, _ = pool.Exec(ctx, `DELETE FROM orders WHERE id=$1`, orderID)
	_, _ = pool.Exec(ctx, `DELETE FROM restaurants WHERE id = ANY($1)`, []string{restID, freeID})
	_, _ = pool.Exec(ctx, `DELETE FROM auth.users WHERE id = ANY($1)`, []string{owner, customer, rider})
}
