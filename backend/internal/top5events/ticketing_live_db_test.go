package top5events_test

// Live-DB tests for UpdateTier (Phase 2 ticketing depth).

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/top5events"
)

func seedTier(t *testing.T, ctx context.Context, pool *pgxpool.Pool, eventID string, price int64, capacity, sold int) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO event_ticket_tiers (id, event_id, name, price_kobo, capacity, sold, active)
		 VALUES ($1,$2,'General',$3,$4,$5,true)`, id, eventID, price, capacity, sold); err != nil {
		t.Fatalf("seed tier: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM event_ticket_tiers WHERE id=$1`, id) })
	return id
}

func TestLiveDB_UpdateTier_SoftFields(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 1000, 10, 0)
	start := time.Now().Add(time.Hour).UTC().Truncate(time.Second)
	end := start.Add(48 * time.Hour)
	inv := true
	got, err := svc.UpdateTier(ctx, owner, ev, tier, top5events.TierPatch{
		Name: strp("VIP"), Description: strp("front row"), SalesStartAt: &start, SalesEndAt: &end, InviteOnly: &inv,
	})
	if err != nil {
		t.Fatalf("UpdateTier: %v", err)
	}
	if got.Name != "VIP" || got.Description != "front row" || !got.InviteOnly || got.SalesStartAt == nil || !got.SalesStartAt.Equal(start) {
		t.Fatalf("returned tier wrong: %+v", got)
	}
	var name, desc string
	var e *time.Time
	if err := pool.QueryRow(ctx, `SELECT name, description, sales_end_at FROM event_ticket_tiers WHERE id=$1`, tier).Scan(&name, &desc, &e); err != nil {
		t.Fatal(err)
	}
	if name != "VIP" || desc != "front row" || e == nil || !e.Equal(end) {
		t.Fatalf("not persisted: %q %q %v", name, desc, e)
	}
}

func TestLiveDB_UpdateTier_PriceLockedAfterSale(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 1000, 10, 2)
	price := int64(5000)
	_, err := svc.UpdateTier(ctx, owner, ev, tier, top5events.TierPatch{PriceKobo: &price, Name: strp("sneaky")})
	if !errors.Is(err, top5events.ErrTierLocked) {
		t.Fatalf("want ErrTierLocked, got %v", err)
	}
	var p int64
	var name string
	_ = pool.QueryRow(ctx, `SELECT price_kobo, name FROM event_ticket_tiers WHERE id=$1`, tier).Scan(&p, &name)
	if p != 1000 || name != "General" {
		t.Fatalf("mutated despite lock: %d %q", p, name)
	}
}

func TestLiveDB_UpdateTier_CapacityBelowSoldRejected(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 1000, 10, 5)
	low := 3
	if _, err := svc.UpdateTier(ctx, owner, ev, tier, top5events.TierPatch{Capacity: &low}); !errors.Is(err, top5events.ErrTierLocked) {
		t.Fatalf("want ErrTierLocked, got %v", err)
	}
	ok := 5
	if _, err := svc.UpdateTier(ctx, owner, ev, tier, top5events.TierPatch{Capacity: &ok}); err != nil {
		t.Fatalf("capacity == sold should pass: %v", err)
	}
}

func TestLiveDB_UpdateTier_InvalidWindow(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 1000, 10, 0)
	s := time.Now().Add(2 * time.Hour)
	e := time.Now().Add(time.Hour)
	if _, err := svc.UpdateTier(ctx, owner, ev, tier, top5events.TierPatch{SalesStartAt: &s, SalesEndAt: &e}); !errors.Is(err, top5events.ErrInvalidWindow) {
		t.Fatalf("want ErrInvalidWindow, got %v", err)
	}
	// Setting only one side is allowed; a later conflicting one-sided patch is not.
	if _, err := svc.UpdateTier(ctx, owner, ev, tier, top5events.TierPatch{SalesEndAt: &e}); err != nil {
		t.Fatalf("one side only should pass: %v", err)
	}
	if _, err := svc.UpdateTier(ctx, owner, ev, tier, top5events.TierPatch{SalesStartAt: &s}); !errors.Is(err, top5events.ErrInvalidWindow) {
		t.Fatalf("want ErrInvalidWindow vs stored end, got %v", err)
	}
}

func TestLiveDB_UpdateTier_ManagerAllowed(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	mgr := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 1000, 10, 0)
	if _, err := pool.Exec(ctx,
		`INSERT INTO event_team_members (event_id, user_id, role, granted_by) VALUES ($1,$2,'MANAGER',$3)`, ev, mgr, owner); err != nil {
		t.Fatalf("seed team: %v", err)
	}
	got, err := svc.UpdateTier(ctx, mgr, ev, tier, top5events.TierPatch{Name: strp("Mgr Edit")})
	if err != nil || got.Name != "Mgr Edit" {
		t.Fatalf("manager UpdateTier: %v %+v", err, got)
	}
}

func TestLiveDB_UpdateTier_StrangerForbidden(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	stranger := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 1000, 10, 0)
	if _, err := svc.UpdateTier(ctx, stranger, ev, tier, top5events.TierPatch{Name: strp("x")}); !errors.Is(err, top5events.ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
}
