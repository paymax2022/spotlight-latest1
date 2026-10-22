package transport_test

// LIVE-DB tests for the parcel rate-card admin editor
// (GetParcelRateCard / PatchParcelRateCell). Skipped unless TEST_DATABASE_URL
// is set. Each test seeds its own zone so it never edits the shared 'default'
// card, and removes its rows (and their audit rows) on cleanup.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/transport"
)

func rateCardPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping parcel rate-card live-DB test")
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

// seedRateCardZone copies the 12 seeded 'default' cells into a fresh zone and
// returns its name.
func seedRateCardZone(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	zone := "test-" + uuid.NewString()[:8]
	tag, err := pool.Exec(ctx, `
		INSERT INTO public.transport_parcel_rate_card (zone, size, speed, multiplier_bps, min_fare_kobo)
		SELECT $1, s.size, sp.speed, 10000, 100000
		FROM unnest(ARRAY['small','medium','large']) s(size)
		CROSS JOIN unnest(ARRAY['standard','express','same_day','scheduled']) sp(speed)`, zone)
	if err != nil {
		t.Fatalf("seed zone: %v", err)
	}
	if tag.RowsAffected() != 12 {
		t.Fatalf("seeded %d cells, want 12", tag.RowsAffected())
	}
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = pool.Exec(ctx, `DELETE FROM transport_audit_log WHERE entity_type='parcel_rate_card' AND entity_id LIKE $1`, zone+":%")
		_, _ = pool.Exec(ctx, `DELETE FROM public.transport_parcel_rate_card WHERE zone=$1`, zone)
	})
	return zone
}

func TestLiveDB_GetParcelRateCard_DisplayOrder(t *testing.T) {
	pool := rateCardPool(t)
	ctx := context.Background()
	zone := seedRateCardZone(t, ctx, pool)
	admin := transport.NewAdminService(transport.NewService(pool, nil))

	card, err := admin.GetParcelRateCard(ctx, zone)
	if err != nil {
		t.Fatal(err)
	}
	if card.Zone != zone || len(card.Cells) != 12 {
		t.Fatalf("zone=%q cells=%d, want %q/12", card.Zone, len(card.Cells), zone)
	}
	want := [][2]string{{"small", "standard"}, {"small", "express"}, {"small", "same_day"}, {"small", "scheduled"}, {"medium", "standard"}}
	for i, w := range want {
		if c := card.Cells[i]; c.Size != w[0] || c.Speed != w[1] {
			t.Fatalf("cell %d = %s/%s, want %s/%s", i, c.Size, c.Speed, w[0], w[1])
		}
	}

	empty, err := admin.GetParcelRateCard(ctx, "no-such-zone-"+uuid.NewString()[:8])
	if err != nil {
		t.Fatal(err)
	}
	if empty.Cells == nil || len(empty.Cells) != 0 {
		t.Fatalf("unknown zone: want empty (non-nil) cells, got %#v", empty.Cells)
	}
}

func TestLiveDB_PatchParcelRateCell_UpdatesAndAudits(t *testing.T) {
	pool := rateCardPool(t)
	ctx := context.Background()
	zone := seedRateCardZone(t, ctx, pool)
	admin := transport.NewAdminService(transport.NewService(pool, nil))
	adminID := uuid.NewString()

	bps, minFare := int64(22000), int64(350000)
	cell, err := admin.PatchParcelRateCell(ctx, adminID, "large", "same_day", transport.ParcelRateCellPatch{
		Zone: zone, MultiplierBps: &bps, MinFareKobo: &minFare, Reason: "  bigger vehicle needed  ",
	})
	if err != nil {
		t.Fatal(err)
	}
	if cell.MultiplierBps != 22000 || cell.MinFareKobo != 350000 || !cell.Active {
		t.Fatalf("returned cell %+v", cell)
	}
	if cell.UpdatedBy == nil || *cell.UpdatedBy != adminID {
		t.Fatalf("updated_by = %v, want %s", cell.UpdatedBy, adminID)
	}

	// Only that cell changed.
	var changed int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.transport_parcel_rate_card
		WHERE zone=$1 AND (multiplier_bps<>10000 OR min_fare_kobo<>100000)`, zone).Scan(&changed); err != nil {
		t.Fatal(err)
	}
	if changed != 1 {
		t.Fatalf("%d cells changed, want 1", changed)
	}

	// One audit row with the old and new cell and the trimmed reason.
	var auditAdmin, reason string
	var oldJSON, newJSON []byte
	if err := pool.QueryRow(ctx, `SELECT admin_id::text, reason, old_value, new_value FROM transport_audit_log
		WHERE action='parcel_rate_card.update' AND entity_id=$1`, zone+":large:same_day").
		Scan(&auditAdmin, &reason, &oldJSON, &newJSON); err != nil {
		t.Fatalf("audit row: %v", err)
	}
	if auditAdmin != adminID || reason != "bigger vehicle needed" {
		t.Fatalf("audit admin=%s reason=%q", auditAdmin, reason)
	}
	var oldCell, newCell transport.ParcelRateCell
	_ = json.Unmarshal(oldJSON, &oldCell)
	_ = json.Unmarshal(newJSON, &newCell)
	if oldCell.MultiplierBps != 10000 || oldCell.MinFareKobo != 100000 || newCell.MultiplierBps != 22000 || newCell.MinFareKobo != 350000 {
		t.Fatalf("audit old=%+v new=%+v", oldCell, newCell)
	}

	// Deactivating leaves the numbers alone.
	off := false
	cell, err = admin.PatchParcelRateCell(ctx, adminID, "large", "same_day", transport.ParcelRateCellPatch{Zone: zone, Active: &off, Reason: "pause"})
	if err != nil {
		t.Fatal(err)
	}
	if cell.Active || cell.MultiplierBps != 22000 || cell.MinFareKobo != 350000 {
		t.Fatalf("after deactivate %+v", cell)
	}
}

func TestLiveDB_PatchParcelRateCell_MissingCellIs404(t *testing.T) {
	pool := rateCardPool(t)
	ctx := context.Background()
	admin := transport.NewAdminService(transport.NewService(pool, nil))
	bps := int64(15000)
	_, err := admin.PatchParcelRateCell(ctx, uuid.NewString(), "small", "standard", transport.ParcelRateCellPatch{
		Zone: "no-such-zone-" + uuid.NewString()[:8], MultiplierBps: &bps, Reason: "x",
	})
	var ce *transport.CodedError
	if !errors.As(err, &ce) || ce.Status != http.StatusNotFound {
		t.Fatalf("want 404, got %v", err)
	}
}

// The cell change and its audit row are one transaction: if the audit insert
// fails (here: an actor id that is not a uuid), the cell is left untouched.
func TestLiveDB_PatchParcelRateCell_AuditFailureRollsBack(t *testing.T) {
	pool := rateCardPool(t)
	ctx := context.Background()
	zone := seedRateCardZone(t, ctx, pool)
	admin := transport.NewAdminService(transport.NewService(pool, nil))

	bps := int64(50000)
	if _, err := admin.PatchParcelRateCell(ctx, "", "small", "express", transport.ParcelRateCellPatch{
		Zone: zone, MultiplierBps: &bps, Reason: "no actor",
	}); err == nil {
		t.Fatal("want an error when the audit row cannot be written")
	}
	var got int64
	if err := pool.QueryRow(ctx, `SELECT multiplier_bps FROM public.transport_parcel_rate_card
		WHERE zone=$1 AND size='small' AND speed='express'`, zone).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != 10000 {
		t.Fatalf("multiplier_bps = %d after a failed audit, want unchanged 10000", got)
	}
}
