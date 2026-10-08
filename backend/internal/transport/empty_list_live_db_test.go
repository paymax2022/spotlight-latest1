package transport_test

// LIVE-DB test: empty booking lists must serialize as [] — not null — so
// clients that do Array.isArray(bookings) (k6 harness, mobile app) don't
// crash on a user with zero rows. Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
	"spotlight/backend/internal/transport"
)

func emptyListPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB empty-list test")
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

func TestScheduledLists_EmptyReturnNonNilSlices_Integration(t *testing.T) {
	pool := emptyListPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := transport.NewService(pool, nil)
	admin := transport.NewAdminService(svc)

	riderID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, riderID, riderID+"@emptylist.test"); err != nil {
		t.Fatalf("seed rider: %v", err)
	}
	testsupport.CleanupUser(t, pool, riderID)

	t.Run("ListScheduled", func(t *testing.T) {
		items, err := svc.ListScheduled(ctx, riderID, "all", "", 0)
		if err != nil {
			t.Fatalf("ListScheduled: %v", err)
		}
		if items == nil {
			t.Fatal("ListScheduled returned nil slice — serializes as bookings:null")
		}
		body, _ := json.Marshal(map[string]any{"bookings": items})
		if string(body) != `{"bookings":[]}` {
			t.Fatalf("serialized %s, want bookings:[]", body)
		}
	})

	t.Run("ListScheduledAdmin", func(t *testing.T) {
		items, err := admin.ListScheduledAdmin(ctx, transport.AdminScheduledFilter{})
		if err != nil {
			t.Fatalf("ListScheduledAdmin: %v", err)
		}
		if items == nil {
			t.Fatal("ListScheduledAdmin returned nil slice — serializes as bookings:null")
		}
	})

	t.Run("ListCarHire", func(t *testing.T) {
		items, err := svc.ListCarHire(ctx, riderID)
		if err != nil {
			t.Fatalf("ListCarHire: %v", err)
		}
		if items == nil {
			t.Fatal("ListCarHire returned nil slice — serializes as bookings:null")
		}
	})

	t.Run("ListCarHireBookings", func(t *testing.T) {
		items, err := admin.ListCarHireBookings(ctx, "no_such_status")
		if err != nil {
			t.Fatalf("ListCarHireBookings: %v", err)
		}
		if items == nil {
			t.Fatal("ListCarHireBookings returned nil slice — serializes as bookings:null")
		}
	})

	t.Run("ListEventBookings", func(t *testing.T) {
		items, err := svc.ListEventBookings(ctx, riderID)
		if err != nil {
			t.Fatalf("ListEventBookings: %v", err)
		}
		if items == nil {
			t.Fatal("ListEventBookings returned nil slice — serializes as bookings:null")
		}
	})

	t.Run("ListEventBookingsAdmin", func(t *testing.T) {
		items, err := admin.ListEventBookingsAdmin(ctx, "no_such_status")
		if err != nil {
			t.Fatalf("ListEventBookingsAdmin: %v", err)
		}
		if items == nil {
			t.Fatal("ListEventBookingsAdmin returned nil slice — serializes as bookings:null")
		}
	})
}
