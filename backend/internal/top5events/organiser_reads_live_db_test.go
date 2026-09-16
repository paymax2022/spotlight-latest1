package top5events_test

// Live-DB regressions for the organiser "manage" reads (ListMyOrganiserEvents,
// AttendeesForEvent, VendorsForEvent, WalletEntries) — the four GET endpoints
// the mobile organiser dashboard/attendees/vendors/wallet screens needed but
// never had, so they fell back to client-derived or mock data.
//
// Reuses seedTicketTokenUser / ticketTokenService / seedIssuedTicket /
// ticketEventID / reassignOrganiser from ticket_token_live_db_test.go and
// scan_authz_live_db_test.go (same package, no build tag).
//
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/credential"
	"spotlight/backend/internal/top5events"
)

func TestLiveDB_ListMyOrganiserEvents_ScopedWithRealAggregates(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)
	cred := credential.NewService(pool, nil)

	organiser := seedTicketTokenUser(t, ctx, pool)
	other := seedTicketTokenUser(t, ctx, pool)

	// One ticket sold for the organiser's own event (seedIssuedTicket's tier is
	// priced 500000 kobo / capacity 100) and one for someone else's event.
	seedIssuedTicket(t, ctx, pool, cred, organiser)
	seedIssuedTicket(t, ctx, pool, cred, other)

	got, err := svc.ListMyOrganiserEvents(ctx, organiser)
	if err != nil {
		t.Fatalf("ListMyOrganiserEvents: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d events, want exactly 1 (the caller's own)", len(got))
	}
	stat := got[0]
	if stat.TicketsSold != 1 {
		t.Errorf("TicketsSold = %d, want 1", stat.TicketsSold)
	}
	if stat.TicketsTotal == nil || *stat.TicketsTotal != 100 {
		t.Errorf("TicketsTotal = %v, want 100", stat.TicketsTotal)
	}
	if stat.GrossKobo != 500000 {
		t.Errorf("GrossKobo = %d, want 500000", stat.GrossKobo)
	}
}

func TestLiveDB_ListMyOrganiserEvents_EmptyIsEmptyNotNil(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)

	organiser := seedTicketTokenUser(t, ctx, pool)
	got, err := svc.ListMyOrganiserEvents(ctx, organiser)
	if err != nil {
		t.Fatalf("ListMyOrganiserEvents: %v", err)
	}
	if got == nil {
		t.Error("got nil slice, want a non-nil empty slice")
	}
}

func TestLiveDB_AttendeesForEvent_OrganiserSeesRoster(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)
	cred := credential.NewService(pool, nil)

	organiser := seedTicketTokenUser(t, ctx, pool)
	holder := seedTicketTokenUser(t, ctx, pool)
	ticketID := seedIssuedTicket(t, ctx, pool, cred, holder)
	eventID := ticketEventID(t, ctx, pool, ticketID)
	reassignOrganiser(t, ctx, pool, eventID, organiser)

	got, err := svc.AttendeesForEvent(ctx, organiser, eventID)
	if err != nil {
		t.Fatalf("AttendeesForEvent: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d attendees, want 1", len(got))
	}
	if got[0].TicketID != ticketID {
		t.Errorf("TicketID = %q, want %q", got[0].TicketID, ticketID)
	}
	if got[0].CheckedIn {
		t.Error("CheckedIn = true for a never-scanned ticket, want false")
	}
}

func TestLiveDB_AttendeesForEvent_StewardCanSeeRoster(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)
	cred := credential.NewService(pool, nil)

	organiser := seedTicketTokenUser(t, ctx, pool)
	steward := seedTicketTokenUser(t, ctx, pool)
	holder := seedTicketTokenUser(t, ctx, pool)
	ticketID := seedIssuedTicket(t, ctx, pool, cred, holder)
	eventID := ticketEventID(t, ctx, pool, ticketID)
	reassignOrganiser(t, ctx, pool, eventID, organiser)

	if err := svc.AddSteward(ctx, organiser, eventID, steward); err != nil {
		t.Fatalf("AddSteward: %v", err)
	}
	if _, err := svc.AttendeesForEvent(ctx, steward, eventID); err != nil {
		t.Fatalf("AttendeesForEvent as steward: %v", err)
	}
}

func TestLiveDB_AttendeesForEvent_RandomUserForbidden(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)
	cred := credential.NewService(pool, nil)

	organiser := seedTicketTokenUser(t, ctx, pool)
	stranger := seedTicketTokenUser(t, ctx, pool)
	ticketID := seedIssuedTicket(t, ctx, pool, cred, organiser)
	eventID := ticketEventID(t, ctx, pool, ticketID)

	_, err := svc.AttendeesForEvent(ctx, stranger, eventID)
	if err != top5events.ErrForbidden {
		t.Fatalf("got err=%v, want ErrForbidden", err)
	}
}

func TestLiveDB_VendorsForEvent_AnyAuthenticatedUserCanRead(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)

	organiser := seedTicketTokenUser(t, ctx, pool)
	vendorUser := seedTicketTokenUser(t, ctx, pool)
	eventID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO events (id, organizer_id, organiser_id, title, starts_at, ends_at) VALUES ($1,$2,$2,'Vendor Test Event',now()+interval '1 day', now()+interval '2 day')`,
		eventID, organiser); err != nil {
		t.Fatalf("seed event: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM events WHERE id=$1`, eventID) })

	if _, err := svc.AddVendor(ctx, organiser, eventID, top5events.Vendor{UserID: vendorUser, Name: "Suya Spot"}); err != nil {
		t.Fatalf("AddVendor: %v", err)
	}

	// Any authenticated caller — not just the organiser — should see the vendor
	// list (needed to tap-pay).
	got, err := svc.VendorsForEvent(ctx, eventID)
	if err != nil {
		t.Fatalf("VendorsForEvent: %v", err)
	}
	if len(got) != 1 || got[0].Name != "Suya Spot" {
		t.Fatalf("got %+v, want exactly one active vendor named Suya Spot", got)
	}
}

func TestLiveDB_WalletEntries_OwnerOnly(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)

	owner := seedTicketTokenUser(t, ctx, pool)
	stranger := seedTicketTokenUser(t, ctx, pool)
	eventID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO events (id, organizer_id, organiser_id, title, starts_at, ends_at) VALUES ($1,$2,$2,'Wallet Entries Test Event',now()+interval '1 day', now()+interval '2 day')`,
		eventID, owner); err != nil {
		t.Fatalf("seed event: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM events WHERE id=$1`, eventID) })

	wallet, err := svc.OpenWallet(ctx, owner, eventID)
	if err != nil {
		t.Fatalf("OpenWallet: %v", err)
	}

	walletID := wallet.ID
	entryID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO event_wallet_ledger (id, wallet_id, type, amount_kobo, reference, idempotency_key) VALUES ($1,$2,'TOPUP',100000,'itest-ref',$3)`,
		entryID, walletID, "itest-idem-"+entryID); err != nil {
		t.Fatalf("seed wallet entry: %v", err)
	}

	got, err := svc.WalletEntries(ctx, owner, walletID)
	if err != nil {
		t.Fatalf("WalletEntries (owner): %v", err)
	}
	if len(got) != 1 || got[0].AmountKobo != 100000 {
		t.Fatalf("got %+v, want exactly one 100000-kobo TOPUP entry", got)
	}

	if _, err := svc.WalletEntries(ctx, stranger, walletID); err != top5events.ErrForbidden {
		t.Fatalf("got err=%v for a non-owner, want ErrForbidden", err)
	}
}
