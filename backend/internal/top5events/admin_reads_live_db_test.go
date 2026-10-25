package top5events_test

// Live-DB regressions for the admin console reads (AdminListEvents,
// AdminGetEvent, AdminListTickets, AdminGetCashlessFloat, AdminListVendors,
// AdminGetSettlement, AdminGetDashboard) — the seven GET endpoints the admin
// console needed but never had (only 3 admin POST routes existed: approve,
// suspend, settle).
//
// Reuses seedTicketTokenUser / ticketTokenService from ticket_token_live_db_test.go.
//
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func TestLiveDB_AdminListEvents_SeesAllStatesNotJustPublic(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)

	organiser := seedTicketTokenUser(t, ctx, pool)
	draftID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO events (id, organizer_id, organiser_id, title, starts_at, ends_at, state)
		 VALUES ($1,$2,$2,'Admin Reads Draft Event',now()+interval '1 day', now()+interval '2 day','DRAFT')`,
		draftID, organiser); err != nil {
		t.Fatalf("seed draft event: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(t.Context()), `DELETE FROM events WHERE id=$1`, draftID)
	})

	got, err := svc.AdminListEvents(ctx, "", "Admin Reads Draft Event")
	if err != nil {
		t.Fatalf("AdminListEvents: %v", err)
	}
	found := false
	for _, e := range got {
		if e.ID == draftID {
			found = true
			if e.Status != "draft" {
				t.Errorf("Status = %q, want lowercase %q", e.Status, "draft")
			}
		}
	}
	if !found {
		t.Fatal("DRAFT event missing from admin list — admin view must not be restricted to public-visible states like discovery is")
	}
}

func TestLiveDB_AdminListEvents_StatusFilterUppercasesForTheDBEnum(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)

	organiser := seedTicketTokenUser(t, ctx, pool)
	eventID := uuid.New().String()
	if _, err := pool.Exec(context.WithoutCancel(ctx),
		`INSERT INTO events (id, organizer_id, organiser_id, title, starts_at, ends_at, state)
		 VALUES ($1,$2,$2,'Admin Reads Suspended Event',now()+interval '1 day', now()+interval '2 day','SUSPENDED')`,
		eventID, organiser); err != nil {
		t.Fatalf("seed event: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(t.Context()), `DELETE FROM events WHERE id=$1`, eventID)
	})

	got, err := svc.AdminListEvents(ctx, "suspended", "")
	if err != nil {
		t.Fatalf("AdminListEvents: %v", err)
	}
	found := false
	for _, e := range got {
		if e.ID == eventID {
			found = true
		}
	}
	if !found {
		t.Fatal("lowercase status filter 'suspended' didn't match the DB's uppercase SUSPENDED state")
	}
}

func TestLiveDB_AdminGetEvent_RealAggregatesAndNoFabricatedTimeline(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)

	organiser := seedTicketTokenUser(t, ctx, pool)
	eventID := uuid.New().String()
	if _, err := pool.Exec(context.WithoutCancel(ctx),
		`INSERT INTO events (id, organizer_id, organiser_id, title, venue, starts_at, ends_at, state, fee_bps)
		 VALUES ($1,$2,$2,'Admin Reads Detail Event','Venue X',now()+interval '1 day', now()+interval '2 day','LIVE',500)`,
		eventID, organiser); err != nil {
		t.Fatalf("seed event: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(t.Context()), `DELETE FROM events WHERE id=$1`, eventID)
	})

	tierID := uuid.New().String()
	if _, err := pool.Exec(context.WithoutCancel(ctx),
		`INSERT INTO event_ticket_tiers (id, event_id, name, price_kobo, capacity, sold) VALUES ($1,$2,'GA',100000,50,20)`,
		tierID, eventID); err != nil {
		t.Fatalf("seed tier: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(t.Context()), `DELETE FROM event_ticket_tiers WHERE id=$1`, tierID)
	})

	// GMV is order-derived now (PAID event_orders), not tiers.sold*price: seed
	// 20 PAID orders of 100000 + the issued tickets they correspond to.
	for range 20 {
		orderID := uuid.New().String()
		if _, err := pool.Exec(context.WithoutCancel(ctx),
			`INSERT INTO event_orders (id, event_id, buyer_id, tier_id, total_kobo, status, idempotency_key)
			 VALUES ($1,$2,$3,$4,100000,'PAID',$5)`,
			orderID, eventID, organiser, tierID, "adm-reads-"+orderID); err != nil {
			t.Fatalf("seed order: %v", err)
		}
		if _, err := pool.Exec(context.WithoutCancel(ctx),
			`INSERT INTO event_tickets (id, event_id, tier_id, order_id, owner_id, state, price_paid_kobo)
			 VALUES ($1,$2,$3,$4,$5,'ISSUED',100000)`,
			uuid.New().String(), eventID, tierID, orderID, organiser); err != nil {
			t.Fatalf("seed ticket: %v", err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(t.Context()),
			`DELETE FROM event_tickets WHERE event_id=$1; DELETE FROM event_orders WHERE event_id=$1`, eventID)
	})

	got, err := svc.AdminGetEvent(ctx, eventID)
	if err != nil {
		t.Fatalf("AdminGetEvent: %v", err)
	}
	if got.GMVKobo != 2000000 { // 20 * 100000
		t.Errorf("GMVKobo = %d, want 2000000", got.GMVKobo)
	}
	if got.NetRevenueKobo != 100000 { // 2000000 * 500/10000
		t.Errorf("NetRevenueKobo = %d, want 100000", got.NetRevenueKobo)
	}
	if len(got.Tiers) != 1 || got.Tiers[0].Sold != 20 {
		t.Errorf("Tiers = %+v, want exactly one tier with Sold=20", got.Tiers)
	}
	if got.Timeline == nil || len(got.Timeline) != 0 {
		t.Errorf("Timeline = %+v, want a non-nil empty slice (no audit trail is wired here — must not be fabricated)", got.Timeline)
	}
}

func TestLiveDB_AdminGetEvent_UnknownIsNotFound(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)

	if _, err := svc.AdminGetEvent(ctx, uuid.New().String()); err == nil {
		t.Fatal("got nil error for an unknown event id, want ErrNotFound")
	}
}

func TestLiveDB_AdminGetDashboard_DoesNotError(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)

	d, err := svc.AdminGetDashboard(ctx)
	if err != nil {
		t.Fatalf("AdminGetDashboard: %v", err)
	}
	// Fields with no real data source must stay at their honest neutral
	// default, never a fabricated non-zero value.
	if d.SettlementBreaks != 0 || d.FraudOpen != 0 {
		t.Errorf("SettlementBreaks=%d FraudOpen=%d, want both 0 — no real data source exists for either", d.SettlementBreaks, d.FraudOpen)
	}
	if d.TicketMix == nil || d.GMVTrend == nil || d.Activity == nil {
		t.Error("TicketMix/GMVTrend/Activity must be non-nil empty slices, not nil")
	}
}
