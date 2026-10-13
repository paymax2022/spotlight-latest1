package admin_test

// LIVE-DB test for GET /dashboard. Seeds reservations/commission/intents and
// asserts the dashboard moves by exactly the seeded amounts (deltas, so rows
// already in a shared DB do not matter).
// SKIPPED whenever TEST_DATABASE_URL is unset.
//   cd backend && go test ./internal/stays/admin/ -run TestLiveDBDashboard -v -count=1

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/stays/admin"
	"spotlight/backend/internal/testsupport"
)

func dashPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

type dash struct {
	GMVToday           int64   `json:"gmv_today_kobo"`
	GMV30d             int64   `json:"gmv_30d_kobo"`
	BookingsToday      int     `json:"bookings_today"`
	Bookings30d        int     `json:"bookings_30d"`
	NetRevenue30d      int64   `json:"net_revenue_30d_kobo"`
	Commission30d      int64   `json:"commission_30d_kobo"`
	RefundsPending     int     `json:"refunds_pending"`
	PaidUnconfirmed    int     `json:"paid_unconfirmed"`
	MappingConflicts   int     `json:"mapping_conflicts_open"`
	ModerationPending  int     `json:"moderation_pending"`
	Conversion         float64 `json:"conversion"`
	TakeRate           float64 `json:"take_rate"`
	GMVTrend           []struct {
		Date    string `json:"date"`
		GMVKobo int64  `json:"gmv_kobo"`
	} `json:"gmv_trend"`
	Activity []struct {
		Kind string `json:"kind"`
	} `json:"activity"`
}

func fetchDash(t *testing.T, pool *pgxpool.Pool) dash {
	t.Helper()
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.GET("/dashboard", admin.NewHandler(pool).Dashboard)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/dashboard", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("GET /dashboard = %d: %s", w.Code, w.Body.String())
	}
	var env struct {
		Data dash `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return env.Data
}

func seedGuest(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, id, id+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUser(t, pool, id)
	return id
}

func seedRes(t *testing.T, pool *pgxpool.Pool, guest, state, currency string, gross, markup, commission int64) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO public.stays_reservation
			(guest_user_id, source_rail, supplier_code, state, check_in, check_out, currency,
			 gross_amount_kobo, markup_kobo, commission_kobo, payment_method, idempotency_key,
			 updated_at)
		VALUES ($1,'DIRECT','dash-test',$2, current_date, current_date+1, $3, $4,$5,$6,'WALLET',$7,
		        CASE WHEN $2 IN ('PAYMENT_HELD','BOOKING') THEN now() - interval '1 hour' ELSE now() END)
		RETURNING id`,
		guest, state, currency, gross, markup, commission, "dash-"+uuid.NewString()).Scan(&id); err != nil {
		t.Fatalf("seed reservation %s: %v", state, err)
	}
	return id
}

func seedIntent(t *testing.T, pool *pgxpool.Pool, resID, status string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO public.stays_payment_intent (reservation_id, method, status, idempotency_key, amount_kobo)
		VALUES ($1,'WALLET',$2,$3,1000)`, resID, status, "dash-pi-"+uuid.NewString()); err != nil {
		t.Fatalf("seed intent: %v", err)
	}
}

func TestLiveDBDashboard(t *testing.T) {
	pool := dashPool(t)
	before := fetchDash(t, pool)
	guest := seedGuest(t, pool)

	// Two booked NGN reservations (counted), one CONFIRMED + one COMPLETED.
	seedRes(t, pool, guest, "CONFIRMED", "NGN", 100_000, 7_000, 3_000)
	completed := seedRes(t, pool, guest, "COMPLETED", "NGN", 50_000, 1_000, 1_500)
	// Not booked: must not touch GMV.
	seedRes(t, pool, guest, "SEARCHING", "NGN", 999_999, 0, 0)
	seedRes(t, pool, guest, "CANCELLED_BY_GUEST", "NGN", 888_888, 0, 0)
	// Booked but in USD: this dashboard is NGN kobo only.
	seedRes(t, pool, guest, "CONFIRMED", "USD", 777_777, 5, 5)

	// Money held on a dead reservation = a refund owed.
	dead := seedRes(t, pool, guest, "BOOK_FAILED", "NGN", 20_000, 0, 0)
	seedIntent(t, pool, dead, "held")
	// Same state, but already refunded: not pending.
	deadDone := seedRes(t, pool, guest, "BOOK_FAILED", "NGN", 20_000, 0, 0)
	seedIntent(t, pool, deadDone, "refunded")
	// Paid but stuck for an hour in BOOKING.
	stuck := seedRes(t, pool, guest, "BOOKING", "NGN", 30_000, 0, 0)
	seedIntent(t, pool, stuck, "charged")

	// Net commission: +1_500 accrual then a -500 reversal.
	for _, amt := range []int64{1_500, -500} {
		kind := "ACCRUAL"
		if amt < 0 {
			kind = "REVERSAL"
		}
		if _, err := pool.Exec(context.Background(), `
			INSERT INTO public.stays_commission_entry (reservation_id, amount_kobo, kind, idempotency_key)
			VALUES ($1,$2,$3,$4)`, completed, amt, kind, "dash-ce-"+uuid.NewString()); err != nil {
			t.Fatalf("seed commission: %v", err)
		}
	}

	after := fetchDash(t, pool)

	if d := after.GMV30d - before.GMV30d; d != 150_000 {
		t.Errorf("gmv_30d moved by %d, want 150000 (booked NGN only)", d)
	}
	if d := after.GMVToday - before.GMVToday; d != 150_000 {
		t.Errorf("gmv_today moved by %d, want 150000", d)
	}
	if d := after.Bookings30d - before.Bookings30d; d != 2 {
		t.Errorf("bookings_30d moved by %d, want 2", d)
	}
	if d := after.BookingsToday - before.BookingsToday; d != 2 {
		t.Errorf("bookings_today moved by %d, want 2", d)
	}
	if d := after.NetRevenue30d - before.NetRevenue30d; d != 12_500 {
		t.Errorf("net_revenue moved by %d, want 12500 (markup+commission on booked)", d)
	}
	if d := after.Commission30d - before.Commission30d; d != 1_000 {
		t.Errorf("commission_30d moved by %d, want 1000 (accrual net of reversal)", d)
	}
	if d := after.RefundsPending - before.RefundsPending; d != 1 {
		t.Errorf("refunds_pending moved by %d, want 1 (the held intent only)", d)
	}
	if d := after.PaidUnconfirmed - before.PaidUnconfirmed; d != 1 {
		t.Errorf("paid_unconfirmed moved by %d, want 1", d)
	}

	if len(after.GMVTrend) != 30 {
		t.Fatalf("gmv_trend has %d days, want 30", len(after.GMVTrend))
	}
	if after.Conversion < 0 || after.Conversion > 1 || after.TakeRate < 0 || after.TakeRate > 1 {
		t.Errorf("rates out of 0..1: conversion=%v take_rate=%v", after.Conversion, after.TakeRate)
	}
	if len(after.Activity) > 15 {
		t.Errorf("activity has %d rows, max 15", len(after.Activity))
	}
}
