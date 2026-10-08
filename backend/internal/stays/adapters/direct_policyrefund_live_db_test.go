package adapters

// LIVE-DB regression for policyRefund: a rate-plan join miss must not default
// to refundable (refund 0, fail closed), and rate_plan_id may carry a supplier
// reference — the join must match supplier_rate_plan_ref too.
// Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func policyRefundAdapter(t *testing.T) (*DirectInventoryAdapter, *pgxpool.Pool) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect TEST_DATABASE_URL: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping TEST_DATABASE_URL: %v", err)
	}
	return &DirectInventoryAdapter{db: pool}, pool
}

// seedResForPolicy plants a property → room type → rate plan → reservation and
// returns the supplier_ref the adapter's policyRefund looks up. ratePlanIdent
// is what the reservation's rate_plan_id carries ("internal" uuid, "supplier"
// ref, or "orphan" non-existent uuid); refundable is the plan's flag.
func seedResForPolicy(t *testing.T, pool *pgxpool.Pool, ratePlanIdent string, refundable bool) string {
	t.Helper()
	ctx := context.Background()

	userID := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		userID, userID+"@policy.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	var propID, roomID, planID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.stays_property
			(source_rail,supplier_code,supplier_property_ref,name,address,city,star_rating,property_type,status)
		VALUES ('DIRECT','self',$1,'Policy Test','1 St','Lagos',3,'hotel','ACTIVE') RETURNING id`,
		uuid.NewString()).Scan(&propID); err != nil {
		t.Fatalf("seed property: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.stays_room_type (property_id,supplier_room_type_ref,name)
		VALUES ($1,$2,'Deluxe') RETURNING id`, propID, uuid.NewString()).Scan(&roomID); err != nil {
		t.Fatalf("seed room type: %v", err)
	}
	// uuid-typed supplier ref: the uuid rate_plan_id column can carry it, and the
	// supplier_rate_plan_ref branch must match it as text.
	supplierRef := uuid.NewString()
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.stays_rate_plan (room_type_id,supplier_rate_plan_ref,refundable)
		VALUES ($1,$2,$3) RETURNING id`, roomID, supplierRef, refundable).Scan(&planID); err != nil {
		t.Fatalf("seed rate plan: %v", err)
	}
	ident := planID
	switch ratePlanIdent {
	case "supplier":
		ident = supplierRef
	case "orphan":
		ident = uuid.NewString() // resolves to no plan — the join misses
	}
	resSupplierRef := "REF-" + uuid.NewString()[:12]
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.stays_reservation
			(guest_user_id,property_id,room_type_id,rate_plan_id,check_in,check_out,rooms,
			 source_rail,supplier_code,supplier_ref,gross_amount_kobo,currency,state,idempotency_key)
		VALUES ($1,$2,$3,$4,current_date + 5,current_date + 6,1,
			 'DIRECT','self',$5,$6,'NGN','CONFIRMED',$7)`,
		userID, propID, roomID, ident, resSupplierRef, int64(1_100_000), "pol-"+uuid.NewString()); err != nil {
		t.Fatalf("seed reservation: %v", err)
	}
	return resSupplierRef
}

func TestLiveDB_PolicyRefund(t *testing.T) {
	a, pool := policyRefundAdapter(t)
	ctx := context.Background()
	const gross = int64(1_100_000)

	// Internal uuid + refundable plan → full refund, no penalty.
	ref, pen := a.policyRefund(ctx, seedResForPolicy(t, pool, "internal", true))
	if ref != gross || pen != 0 {
		t.Fatalf("internal refundable plan → refund=%d penalty=%d, want %d/0", ref, pen, gross)
	}

	// SUPPLIER-REF shaped rate_plan_id + refundable plan → the join must still
	// resolve — a miss now fails closed to refund=0 rather than refund anyway.
	ref, pen = a.policyRefund(ctx, seedResForPolicy(t, pool, "supplier", true))
	if ref != gross || pen != 0 {
		t.Fatalf("supplier-ref refundable plan → refund=%d penalty=%d, want %d/0 (join miss mis-priced)", ref, pen, gross)
	}

	// Non-refundable plan → zero refund, penalty = gross.
	ref, pen = a.policyRefund(ctx, seedResForPolicy(t, pool, "internal", false))
	if ref != 0 || pen != gross {
		t.Fatalf("non-refundable plan → refund=%d penalty=%d, want 0/%d", ref, pen, gross)
	}

	// JOIN MISS — no plan resolves → FAIL CLOSED: refund 0, penalty = gross.
	// (The defect-1 default refunded EVERYTHING on a miss.)
	ref, pen = a.policyRefund(ctx, seedResForPolicy(t, pool, "orphan", false))
	if ref != 0 || pen != gross {
		t.Fatalf("join miss → refund=%d penalty=%d, want 0/%d (default must fail closed, not refund everything)", ref, pen, gross)
	}
}
