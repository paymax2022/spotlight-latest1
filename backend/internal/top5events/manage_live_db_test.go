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
