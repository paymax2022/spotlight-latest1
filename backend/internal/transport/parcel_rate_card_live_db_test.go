package transport

// LIVE-DB test for the parcel rate card migration (20271046000000): the seeded
// default card loads, an unknown zone falls back to it, the switch-off returns
// no card, and parcels now accepts the speed and category values the app sends.
// Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func rateCardPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping parcel rate card test")
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

func TestParcelRateCard_SeededDefaultsLoad(t *testing.T) {
	pool := rateCardPool(t)
	ctx := context.Background()
	s := &Service{db: pool, parcelRateCardOn: true}

	card, err := s.loadParcelRateCard(ctx, "default")
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(card) != 12 {
		t.Fatalf("default card has %d cells, want 12", len(card))
	}
	if got := card["small/same_day"]; got != (parcelRate{MultiplierBps: 22000, MinFareKobo: 300000}) {
		t.Fatalf("small/same_day = %+v", got)
	}
	if got := card["small/standard"]; got != (parcelRate{MultiplierBps: 10000, MinFareKobo: 100000}) {
		t.Fatalf("small/standard = %+v, want the legacy 1x and the config minimum", got)
	}

	other, err := s.loadParcelRateCard(ctx, "no-such-zone")
	if err != nil {
		t.Fatalf("load unknown zone: %v", err)
	}
	if len(other) != 12 {
		t.Fatalf("unknown zone loaded %d cells, want the 12 default cells", len(other))
	}

	off, err := (&Service{db: pool}).loadParcelRateCard(ctx, "default")
	if err != nil || off != nil {
		t.Fatalf("switched-off card = %v, %v; want nil, nil", off, err)
	}
}

func TestParcelChecks_AcceptTheAppsValues(t *testing.T) {
	pool := rateCardPool(t)
	ctx := context.Background()
	defs := map[string]string{}
	rows, err := pool.Query(ctx,
		`SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
		 WHERE conrelid = 'public.parcels'::regclass AND conname IN ('parcels_speed_check','parcels_category_check')`)
	if err != nil {
		t.Fatalf("read constraints: %v", err)
	}
	for rows.Next() {
		var n, d string
		if err := rows.Scan(&n, &d); err != nil {
			t.Fatalf("scan: %v", err)
		}
		defs[n] = d
	}
	rows.Close()
	for _, v := range []string{"'same_day'", "'standard'", "'express'", "'scheduled'"} {
		if !strings.Contains(defs["parcels_speed_check"], v) {
			t.Errorf("parcels_speed_check does not allow %s: %s", v, defs["parcels_speed_check"])
		}
	}
	for _, v := range []string{"'documents'", "'clothing'", "'other'", "'document'", "'electronics'"} {
		if !strings.Contains(defs["parcels_category_check"], v) {
			t.Errorf("parcels_category_check does not allow %s: %s", v, defs["parcels_category_check"])
		}
	}
}
