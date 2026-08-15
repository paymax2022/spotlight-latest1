package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration test for weekly business hours (Phase 5): owner replace-all
// SetBusinessHours, the loader, and the effective-open gate driven off real rows.
// Skipped unless TEST_DATABASE_URL is set. Requires the restaurant +
// business-hours migrations.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func hoursLivePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB business-hours test")
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

func TestLiveDB_BusinessHours(t *testing.T) {
	pool := hoursLivePool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := NewService(pool, nil)

	owner := uuid.New().String()
	stranger := uuid.New().String()
	for _, u := range []string{owner, stranger} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'Hours Kitchen','1 St',TRUE)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}

	// A stranger cannot set hours.
	if _, err := svc.SetBusinessHours(ctx, restID, stranger, []BusinessHourInput{{DayOfWeek: 1, Open: "09:00", Close: "17:00"}}); err == nil {
		t.Fatal("stranger must not set business hours")
	}
	// Invalid time is rejected.
	if _, err := svc.SetBusinessHours(ctx, restID, owner, []BusinessHourInput{{DayOfWeek: 1, Open: "25:00", Close: "17:00"}}); err == nil {
		t.Fatal("invalid time must be rejected")
	}

	// Owner sets Mon 09:00–17:00 + a Fri 18:00→02:00 overnight window.
	if _, err := svc.SetBusinessHours(ctx, restID, owner, []BusinessHourInput{
		{DayOfWeek: int(time.Monday), Open: "09:00", Close: "17:00"},
		{DayOfWeek: int(time.Friday), Open: "18:00", Close: "02:00"},
	}); err != nil {
		t.Fatalf("set hours: %v", err)
	}

	hours, err := svc.loadBusinessHours(ctx, restID)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(hours) != 2 {
		t.Fatalf("want 2 windows, got %d", len(hours))
	}

	// Gate off DB-loaded rows: Mon noon open; Mon 20:00 closed; Sat 01:00 open (Fri spill).
	monNoon := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)
	monEve := time.Date(2026, 7, 27, 20, 0, 0, 0, time.UTC)
	satEarly := time.Date(2026, 8, 1, 1, 0, 0, 0, time.UTC)
	if !effectiveOpen(true, hours, monNoon, time.UTC) {
		t.Error("Mon noon should be open")
	}
	if effectiveOpen(true, hours, monEve, time.UTC) {
		t.Error("Mon 20:00 should be closed")
	}
	if !effectiveOpen(true, hours, satEarly, time.UTC) {
		t.Error("Sat 01:00 should be open (Fri overnight spill)")
	}
	// Manual switch overrides even within hours.
	if effectiveOpen(false, hours, monNoon, time.UTC) {
		t.Error("manual is_open=false must force closed")
	}

	// Replace-all with an empty list clears the schedule (reverts to is_open only).
	if _, err := svc.SetBusinessHours(ctx, restID, owner, nil); err != nil {
		t.Fatalf("clear hours: %v", err)
	}
	if cleared, _ := svc.loadBusinessHours(ctx, restID); len(cleared) != 0 {
		t.Fatalf("schedule should be cleared, got %d rows", len(cleared))
	}
}
