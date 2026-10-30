package adapters

// LIVE-DB regression for "a listing is sellable the moment it is published": a
// DIRECT room type with no stays_availability_day cells still books up to its unit
// count, and the first booking materialises those cells so the next one is
// correctly blocked. An explicit cell still wins over the implicit default, which
// is how a host caps or closes a date.
// Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func implicitAvailFixture(t *testing.T, units int) (*DirectInventoryAdapter, *pgxpool.Pool, string) {
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
	ctx := context.Background()
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("ping TEST_DATABASE_URL: %v", err)
	}

	var propID, roomID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.stays_property
			(source_rail,supplier_code,supplier_property_ref,name,address,city,star_rating,property_type,status)
		VALUES ('DIRECT','self',$1,'Implicit Avail Test','1 St','Lagos',3,'hotel','ACTIVE') RETURNING id`,
		uuid.NewString()).Scan(&propID); err != nil {
		t.Fatalf("seed property: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.stays_room_type (property_id,supplier_room_type_ref,name,units)
		VALUES ($1,$2,'Deluxe',$3) RETURNING id`, propID, uuid.NewString(), units).Scan(&roomID); err != nil {
		t.Fatalf("seed room type: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.stays_property WHERE id = $1`, propID)
	})
	return &DirectInventoryAdapter{db: pool}, pool, roomID
}

func cellState(t *testing.T, pool *pgxpool.Pool, roomType string) (cells, soldOut int) {
	t.Helper()
	if err := pool.QueryRow(context.Background(), `
		SELECT count(*), count(*) FILTER (WHERE allotment - sold <= 0)
		FROM public.stays_availability_day WHERE room_type_id = $1`, roomType).
		Scan(&cells, &soldOut); err != nil {
		t.Fatalf("read calendar: %v", err)
	}
	return cells, soldOut
}

func TestLiveDB_UnlistedNightsSellAtTheUnitCount(t *testing.T) {
	a, pool, roomType := implicitAvailFixture(t, 2)
	ctx := context.Background()
	checkIn := time.Now().AddDate(0, 0, 31)
	checkOut := checkIn.AddDate(0, 0, 2)

	if cells, _ := cellState(t, pool, roomType); cells != 0 {
		t.Fatalf("fixture seeded %d calendar cells, want none", cells)
	}

	if ok, err := a.checkAvailability(ctx, roomType, checkIn, checkOut, 2); err != nil || !ok {
		t.Fatalf("checkAvailability 2 rooms over unlisted nights = %v (%v), want true", ok, err)
	}
	if ok, err := a.checkAvailability(ctx, roomType, checkIn, checkOut, 3); err != nil || ok {
		t.Errorf("checkAvailability 3 rooms on a 2-unit room type = %v (%v), want false", ok, err)
	}

	refA := "REF-" + uuid.NewString()[:12]
	if err := a.commitDecrement(ctx, refA, roomType, checkIn, checkOut, 2); err != nil {
		t.Fatalf("book the unit count: %v", err)
	}
	if cells, soldOut := cellState(t, pool, roomType); cells != 2 || soldOut != 2 {
		t.Errorf("after the first book: %d cells (%d sold out), want 2 cells both sold out", cells, soldOut)
	}

	refB := "REF-" + uuid.NewString()[:12]
	if err := a.commitDecrement(ctx, refB, roomType, checkIn, checkOut, 1); !errors.Is(err, ErrOversellBlocked) {
		t.Errorf("booking a sold-out night = %v, want ErrOversellBlocked", err)
	}
	if err := a.commitDecrement(ctx, refA, roomType, checkIn, checkOut, 2); err != nil {
		t.Errorf("replaying the book leg = %v, want nil (idempotent)", err)
	}
	if _, soldOut := cellState(t, pool, roomType); soldOut != 2 {
		t.Errorf("replay changed sold-out cells, want 2")
	}
}

func TestLiveDB_ExplicitClosedCellBeatsTheImplicitDefault(t *testing.T) {
	a, pool, roomType := implicitAvailFixture(t, 3)
	ctx := context.Background()
	checkIn := time.Now().AddDate(0, 0, 61)
	checkOut := checkIn.AddDate(0, 0, 2)

	// Only the first night is explicitly closed; the other stays unlisted.
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.stays_availability_day (room_type_id, date, allotment, sold, stop_sell)
		VALUES ($1, $2::date, 0, 0, FALSE)
		ON CONFLICT (room_type_id, date) DO UPDATE SET allotment = 0, sold = 0`,
		roomType, checkIn.Format(dateLayout)); err != nil {
		t.Fatalf("close the first night: %v", err)
	}

	if ok, err := a.checkAvailability(ctx, roomType, checkIn, checkOut, 1); err != nil || ok {
		t.Errorf("checkAvailability with an allotment-0 cell = %v (%v), want false", ok, err)
	}
	if ok, err := a.checkAvailability(ctx, roomType, checkOut, checkOut.AddDate(0, 0, 1), 3); err != nil || !ok {
		t.Errorf("checkAvailability over unlisted nights only = %v (%v), want true", ok, err)
	}
	if err := a.commitDecrement(ctx, "REF-"+uuid.NewString()[:12], roomType, checkIn, checkOut, 1); !errors.Is(err, ErrOversellBlocked) {
		t.Errorf("book across an explicitly closed night = %v, want ErrOversellBlocked", err)
	}
}
