package top5events_test

// Live-DB tests for UpdateEvent / authorizeManage (organiser self-service edit
// with tiered lock). Skips unless TEST_DATABASE_URL is set (via ticketTokenPool).

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/credential"
	"spotlight/backend/internal/top5events"
)

func seedManageEvent(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ownerID, state string) string {
	t.Helper()
	eventID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO events (id, organizer_id, organiser_id, title, description, state, starts_at, ends_at)
		 VALUES ($1,$2,$2,'Manage Test Event','orig',$3,$4,$5)`,
		eventID, ownerID, state, time.Now().Add(24*time.Hour), time.Now().Add(30*time.Hour)); err != nil {
		t.Fatalf("seed event: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM event_team_members WHERE event_id=$1`, eventID)
		_, _ = pool.Exec(bg, `DELETE FROM events WHERE id=$1`, eventID)
	})
	return eventID
}

func strp(s string) *string { return &s }

func TestLiveDB_UpdateEvent_SoftFieldsOrganiser(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")

	got, err := svc.UpdateEvent(ctx, owner, ev, top5events.EventPatch{Description: strp("new desc")})
	if err != nil {
		t.Fatalf("UpdateEvent: %v", err)
	}
	if got.Description != "new desc" {
		t.Fatalf("returned description = %q", got.Description)
	}
	var d string
	if err := pool.QueryRow(ctx, `SELECT description FROM events WHERE id=$1`, ev).Scan(&d); err != nil || d != "new desc" {
		t.Fatalf("persisted description = %q err=%v", d, err)
	}
}

func TestLiveDB_UpdateEvent_HardTimeLockedAfterSale(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	ticketID := seedIssuedTicket(t, ctx, pool, credential.NewService(pool, nil), owner)
	var ev string
	if err := pool.QueryRow(ctx, `SELECT event_id FROM event_tickets WHERE id=$1`, ticketID).Scan(&ev); err != nil {
		t.Fatalf("lookup event: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE events SET state='LIVE' WHERE id=$1`, ev); err != nil {
		t.Fatalf("set live: %v", err)
	}
	var before time.Time
	_ = pool.QueryRow(ctx, `SELECT starts_at FROM events WHERE id=$1`, ev).Scan(&before)

	newStart := before.Add(-2 * time.Hour)
	_, err := svc.UpdateEvent(ctx, owner, ev, top5events.EventPatch{StartsAt: &newStart, Title: strp("sneaky")})
	if !errors.Is(err, top5events.ErrEditLocked) {
		t.Fatalf("want ErrEditLocked, got %v", err)
	}
	var after time.Time
	var title string
	_ = pool.QueryRow(ctx, `SELECT starts_at, title FROM events WHERE id=$1`, ev).Scan(&after, &title)
	if !after.Equal(before) || title != "Ticket Token Test Event" {
		t.Fatalf("event mutated despite lock: starts_at %v->%v title=%q", before, after, title)
	}
}

func TestLiveDB_UpdateEvent_ManagerAllowed(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	mgr := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	if _, err := pool.Exec(ctx,
		`INSERT INTO event_team_members (event_id, user_id, role, granted_by) VALUES ($1,$2,'MANAGER',$3)`, ev, mgr, owner); err != nil {
		t.Fatalf("seed team member: %v", err)
	}
	got, err := svc.UpdateEvent(ctx, mgr, ev, top5events.EventPatch{Venue: strp("New Hall")})
	if err != nil {
		t.Fatalf("manager UpdateEvent: %v", err)
	}
	if got.Venue != "New Hall" {
		t.Fatalf("venue = %q", got.Venue)
	}
}

func TestLiveDB_UpdateEvent_StrangerForbidden(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	stranger := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	_, err := svc.UpdateEvent(ctx, stranger, ev, top5events.EventPatch{Title: strp("x")})
	if !errors.Is(err, top5events.ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
}

func TestLiveDB_DuplicateEvent(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	caller := seedTicketTokenUser(t, ctx, pool)
	ticketID := seedIssuedTicket(t, ctx, pool, credential.NewService(pool, nil), owner)
	var src string
	if err := pool.QueryRow(ctx, `SELECT event_id FROM event_tickets WHERE id=$1`, ticketID).Scan(&src); err != nil {
		t.Fatalf("lookup event: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE events SET state='LIVE', venue='Hall A', category='music', fee_bps=750 WHERE id=$1`, src); err != nil {
		t.Fatalf("set live: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO event_ticket_tiers (id, event_id, name, price_kobo, capacity, sold) VALUES ($1,$2,'VIP',900000,10,4)`,
		uuid.New().String(), src); err != nil {
		t.Fatalf("seed tier2: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO event_promo_codes (id, event_id, code, version, percent_off, max_uses, used) VALUES ($1,$2,'SAVE10',1,10,50,7)`,
		uuid.New().String(), src); err != nil {
		t.Fatalf("seed promo: %v", err)
	}

	got, err := svc.DuplicateEvent(ctx, caller, src)
	if err != nil {
		t.Fatalf("DuplicateEvent: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM events WHERE id=$1`, got.ID) })
	if got.ID == src || got.State != top5events.EventDraft || got.OrganiserID != caller {
		t.Fatalf("bad duplicate: %+v", got)
	}
	var title, venue, cat, state, org1, org2 string
	var fee int
	if err := pool.QueryRow(ctx,
		`SELECT title, venue, category, state, organizer_id::text, organiser_id::text, fee_bps FROM events WHERE id=$1`, got.ID).
		Scan(&title, &venue, &cat, &state, &org1, &org2, &fee); err != nil {
		t.Fatalf("read new event: %v", err)
	}
	if title != "Ticket Token Test Event (copy)" || venue != "Hall A" || cat != "music" || state != "DRAFT" ||
		org1 != caller || org2 != caller || fee != 750 {
		t.Fatalf("persisted mismatch: %q %q %q %q %q %q %d", title, venue, cat, state, org1, org2, fee)
	}
	var tiers, soldSum, promos, usedSum, tickets int
	_ = pool.QueryRow(ctx, `SELECT count(*), COALESCE(sum(sold),0) FROM event_ticket_tiers WHERE event_id=$1`, got.ID).Scan(&tiers, &soldSum)
	_ = pool.QueryRow(ctx, `SELECT count(*), COALESCE(sum(used),0) FROM event_promo_codes WHERE event_id=$1`, got.ID).Scan(&promos, &usedSum)
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM event_tickets WHERE event_id=$1`, got.ID).Scan(&tickets)
	if tiers != 2 || soldSum != 0 || promos != 1 || usedSum != 0 || tickets != 0 {
		t.Fatalf("tiers=%d sold=%d promos=%d used=%d tickets=%d", tiers, soldSum, promos, usedSum, tickets)
	}
}
