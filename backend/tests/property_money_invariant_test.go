package tests

// ---------------------------------------------------------------------------
// Property Management suite — money-invariant tests (INV) for
// backend/internal/property/rentpassport.go GetRentPassport.
//
// PROPERTY-INV-011 (docs/qa/modules/property.md §4): TotalPaidKobo must be an
// EXACT integer-kobo sum across BOTH the estate dues path (estate_payments)
// and the realtor lease path (realtor_payments) — no float coercion, no
// rounding, no drift. PROPERTY-INT-012: recentPayments caps at 20,
// most-recent-first, while paymentsCount stays uncapped.
//
// Live-DB only: GetRentPassport takes a concrete *pgxpool.Pool
// (property.NewService(db *pgxpool.Pool)) and cannot run without one.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/property"
	"spotlight/backend/internal/testsupport"
)

func newPropertyMoneyTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB property money-invariant test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect test db: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping test db: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func seedPropertyMoneyUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.NewString()
	ctx := context.Background()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email, created_at) VALUES ($1,$2,NOW())`, id, id+"@property-money.invalid"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM auth.users WHERE id=$1`, id) })
	testsupport.CleanupUser(t, pool, id)
	return id
}

// seedRealtorPayment builds the full realtor funnel chain (portfolio ->
// property -> unit -> listing -> rental application -> lease -> invoice ->
// payment) required by GetRentPassport's realtor query (rentpassport.go
// L121-128: realtor_payments JOIN realtor_invoices JOIN realtor_leases,
// WHERE pay.user_id=$1 AND pay.status='paid'), and registers teardown in
// reverse dependency order (children before parents — CASCADE would handle
// most of this, but being explicit keeps the fixture self-documenting).
func seedRealtorPayment(t *testing.T, pool *pgxpool.Pool, tenant string, amountKobo int64, dueDate *time.Time, paidAt time.Time) {
	t.Helper()
	ctx := context.Background()

	portfolioID := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO realtor_portfolios (id, owner_id, name) VALUES ($1,$2,'Money Inv Portfolio')`, portfolioID, tenant); err != nil {
		t.Fatalf("seed portfolio: %v", err)
	}

	propID := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO realtor_properties (id, portfolio_id, name, property_type, address, area, city, state)
		 VALUES ($1,$2,'Bldg','apartment','1 St','Area','City','State')`, propID, portfolioID); err != nil {
		t.Fatalf("seed realtor_properties: %v", err)
	}

	unitID := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO realtor_units (id, property_id, label, property_type) VALUES ($1,$2,'Unit',$3)`,
		unitID, propID, "apartment"); err != nil {
		t.Fatalf("seed realtor_units: %v", err)
	}

	listingID := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO realtor_listings (id, unit_id, title, mode) VALUES ($1,$2,'Listing','long_rent')`,
		listingID, unitID); err != nil {
		t.Fatalf("seed realtor_listings: %v", err)
	}

	appID := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO realtor_rental_applications (id, listing_id, user_id, full_name, email, phone)
		 VALUES ($1,$2,$3,'Tenant','tenant@money-inv.invalid','+2340000000000')`,
		appID, listingID, tenant); err != nil {
		t.Fatalf("seed realtor_rental_applications: %v", err)
	}

	leaseID := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO realtor_leases (id, application_id, listing_id, tenant_id, start_date, end_date)
		 VALUES ($1,$2,$3,$4, CURRENT_DATE - INTERVAL '1 year', CURRENT_DATE + INTERVAL '1 year')`,
		leaseID, appID, listingID, tenant); err != nil {
		t.Fatalf("seed realtor_leases: %v", err)
	}

	invoiceID := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO realtor_invoices (id, lease_id, status, total_kobo, due_date) VALUES ($1,$2,'paid',$3,$4)`,
		invoiceID, leaseID, amountKobo, dueDate); err != nil {
		t.Fatalf("seed realtor_invoices: %v", err)
	}

	payID := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO realtor_payments (id, invoice_id, user_id, channel, amount_kobo, status, reference, idempotency_key, paid_at)
		 VALUES ($1,$2,$3,'WALLET',$4,'paid',$5,$5,$6)`,
		payID, invoiceID, tenant, amountKobo, "idem-"+payID, paidAt); err != nil {
		t.Fatalf("seed realtor_payments: %v", err)
	}

	t.Cleanup(func() {
		bg := context.Background()
		pool.Exec(bg, `DELETE FROM realtor_payments WHERE id=$1`, payID)
		pool.Exec(bg, `DELETE FROM realtor_invoices WHERE id=$1`, invoiceID)
		pool.Exec(bg, `DELETE FROM realtor_leases WHERE id=$1`, leaseID)
		pool.Exec(bg, `DELETE FROM realtor_rental_applications WHERE id=$1`, appID)
		pool.Exec(bg, `DELETE FROM realtor_listings WHERE id=$1`, listingID)
		pool.Exec(bg, `DELETE FROM realtor_units WHERE id=$1`, unitID)
		pool.Exec(bg, `DELETE FROM realtor_properties WHERE id=$1`, propID)
		pool.Exec(bg, `DELETE FROM realtor_portfolios WHERE id=$1`, portfolioID)
	})
}

func seedEstatePayment(t *testing.T, pool *pgxpool.Pool, payer, estateID string, amountKobo int64, dueDate *time.Time, createdAt time.Time) {
	t.Helper()
	ctx := context.Background()
	invoiceID := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO estate_dues_invoices (id, estate_id, resident_id, category, amount_kobo, due_date)
		 VALUES ($1,$2,$3,'rent',$4,$5)`,
		invoiceID, estateID, payer, amountKobo, dueDate); err != nil {
		t.Fatalf("seed estate_dues_invoices: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM estate_dues_invoices WHERE id=$1`, invoiceID) })

	payID := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO estate_payments (id, estate_id, invoice_id, payer_id, amount_kobo, method, status, created_at)
		 VALUES ($1,$2,$3,$4,$5,'wallet','successful',$6)`,
		payID, estateID, invoiceID, payer, amountKobo, createdAt); err != nil {
		t.Fatalf("seed estate_payments: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM estate_payments WHERE id=$1`, payID) })
}

// TestLiveDB_RentPassport_TotalPaidKobo_ExactSumAcrossEstateAndRealtor is
// PROPERTY-INV-011: a mix of estate and realtor payments whose kobo amounts
// do NOT divide evenly by any common base (so a float64/naira-conversion bug
// anywhere in the summation would show up as drift) must sum to EXACTLY the
// integer total, and each RecentPayment.AmountKobo must echo its source's
// integer verbatim.
func TestLiveDB_RentPassport_TotalPaidKobo_ExactSumAcrossEstateAndRealtor(t *testing.T) {
	pool := newPropertyMoneyTestPool(t)
	ctx := context.Background()
	svc := property.NewService(pool)

	tenant := seedPropertyMoneyUser(t, pool)
	admin := seedPropertyMoneyUser(t, pool)

	estateID := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO estates (id, name, admin_id) VALUES ($1,'Money Inv Estate',$2)`, estateID, admin); err != nil {
		t.Fatalf("seed estate: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM estates WHERE id=$1`, estateID) })

	// Deliberately awkward kobo amounts: 100000003 kobo (₦1,000,000.03) has a
	// fractional-naira remainder, and 233333337 kobo is not a multiple of any
	// round naira/kobo denomination — chosen so any accidental float64 or
	// naira-then-back-to-kobo round-trip in a future refactor would show as a
	// non-exact sum here.
	const estateAmount int64 = 100_000_003
	const realtorAmount int64 = 233_333_337
	wantTotal := estateAmount + realtorAmount // 333,333,340

	due := time.Now().Add(24 * time.Hour)
	seedEstatePayment(t, pool, tenant, estateID, estateAmount, &due, time.Now().Add(-2*time.Hour))
	seedRealtorPayment(t, pool, tenant, realtorAmount, &due, time.Now().Add(-1*time.Hour))

	rp, err := svc.GetRentPassport(ctx, tenant)
	if err != nil {
		t.Fatalf("GetRentPassport: %v", err)
	}
	if rp.TotalPaidKobo != wantTotal {
		t.Fatalf("TotalPaidKobo = %d, want EXACT %d (estate %d + realtor %d) — any drift indicates a float/rounding bug",
			rp.TotalPaidKobo, wantTotal, estateAmount, realtorAmount)
	}
	if rp.PaymentsCount != 2 {
		t.Fatalf("PaymentsCount = %d, want 2", rp.PaymentsCount)
	}

	byAmount := map[int64]bool{}
	for _, p := range rp.RecentPayments {
		byAmount[p.AmountKobo] = true
	}
	if !byAmount[estateAmount] {
		t.Errorf("recentPayments missing the exact estate amount %d: %+v", estateAmount, rp.RecentPayments)
	}
	if !byAmount[realtorAmount] {
		t.Errorf("recentPayments missing the exact realtor amount %d: %+v", realtorAmount, rp.RecentPayments)
	}
}

// TestLiveDB_RentPassport_RecentPaymentsCapAndOrder is PROPERTY-INT-012:
// recentPayments caps at 20, ordered most-recent-first (paidAt DESC), while
// PaymentsCount stays uncapped at the true row count (25).
func TestLiveDB_RentPassport_RecentPaymentsCapAndOrder(t *testing.T) {
	pool := newPropertyMoneyTestPool(t)
	ctx := context.Background()
	svc := property.NewService(pool)

	tenant := seedPropertyMoneyUser(t, pool)
	admin := seedPropertyMoneyUser(t, pool)

	estateID := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO estates (id, name, admin_id) VALUES ($1,'Cap Order Estate',$2)`, estateID, admin); err != nil {
		t.Fatalf("seed estate: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM estates WHERE id=$1`, estateID) })

	const rowCount = 25
	base := time.Now().Add(-time.Duration(rowCount) * time.Hour)
	dueDate := time.Now().Add(24 * time.Hour) // estate_dues_invoices.due_date is NOT NULL
	// Payment i is created at base + i hours, so payment 24 (amount 24*1000) is
	// the most recent and payment 0 is the oldest.
	for i := 0; i < rowCount; i++ {
		amount := int64((i + 1) * 1000) // distinct amounts double as an ordering fingerprint
		createdAt := base.Add(time.Duration(i) * time.Hour)
		seedEstatePayment(t, pool, tenant, estateID, amount, &dueDate, createdAt)
	}

	rp, err := svc.GetRentPassport(ctx, tenant)
	if err != nil {
		t.Fatalf("GetRentPassport: %v", err)
	}
	if rp.PaymentsCount != rowCount {
		t.Fatalf("PaymentsCount = %d, want uncapped %d", rp.PaymentsCount, rowCount)
	}
	if len(rp.RecentPayments) != 20 {
		t.Fatalf("len(RecentPayments) = %d, want capped at 20", len(rp.RecentPayments))
	}
	// Most-recent-first: the top of the slice must be payment index 24 (amount
	// 25000), the 20th (last kept) must be payment index 5 (amount 6000) — the
	// 5 oldest (indices 0-4) must have been dropped by the cap.
	if rp.RecentPayments[0].AmountKobo != 25000 {
		t.Errorf("RecentPayments[0].AmountKobo = %d, want 25000 (the most recent payment)", rp.RecentPayments[0].AmountKobo)
	}
	if rp.RecentPayments[19].AmountKobo != 6000 {
		t.Errorf("RecentPayments[19].AmountKobo = %d, want 6000 (20th most recent)", rp.RecentPayments[19].AmountKobo)
	}
	for i := 1; i < len(rp.RecentPayments); i++ {
		if rp.RecentPayments[i].PaidAt.After(rp.RecentPayments[i-1].PaidAt) {
			t.Fatalf("RecentPayments not ordered most-recent-first at index %d: %v after %v",
				i, rp.RecentPayments[i].PaidAt, rp.RecentPayments[i-1].PaidAt)
		}
	}
}
