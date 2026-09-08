package top5events_test

// Live-DB regression for ScanTicket's steward/organiser authorization — the fix
// for the gap formerly documented (and left unfixed) by
// TestIntegration_Scan_DoesNotCheckCallerIdentityAgainstTicket_KnownGap in
// service_integration_test.go: any authenticated caller with a valid gate token
// could scan any ticket at any event. ScanTicket now resolves the ticket's event
// before validating and requires the caller be that event's organiser or a
// designated event_stewards row for that specific event.
//
// Reuses the seedTicketTokenUser / ticketTokenService / seedIssuedTicket helpers
// from ticket_token_live_db_test.go (same package, same file, no build tag, so
// they're visible here without duplication).
//
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/credential"
	"spotlight/backend/internal/top5events"
)

// scanToken mints the current live token for a credential and scans it as
// callerID, returning ScanTicket's result/error directly.
func scanToken(t *testing.T, ctx context.Context, svc *top5events.Service, cred *credential.Service, callerID, credentialID string) (*credential.Result, error) {
	t.Helper()
	tok, err := cred.CurrentToken(ctx, credentialID)
	if err != nil {
		t.Fatalf("mint token: %v", err)
	}
	return svc.ScanTicket(ctx, callerID, *tok, credential.Gate{ID: "itest-gate", Name: "Test Gate"})
}

func TestLiveDB_ScanTicket_OrganiserCanScanOwnEvent(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)
	cred := credential.NewService(pool, nil)

	organiser := seedTicketTokenUser(t, ctx, pool)
	ticketID := seedIssuedTicket(t, ctx, pool, cred, organiser)
	// The ticket's owner and its event's organiser are the same user here — that's
	// fine, ScanTicket only cares that the CALLER is the organiser, independent of
	// who owns the ticket being scanned.

	credentialID := ticketCredentialID(t, ctx, pool, ticketID)
	res, err := scanToken(t, ctx, svc, cred, organiser, credentialID)
	if err != nil {
		t.Fatalf("ScanTicket: %v", err)
	}
	if !res.OK {
		t.Fatalf("got res.OK=false, reason=%q, want accepted", res.Reason)
	}
}

func TestLiveDB_ScanTicket_DesignatedStewardCanScan(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)
	cred := credential.NewService(pool, nil)

	organiser := seedTicketTokenUser(t, ctx, pool)
	steward := seedTicketTokenUser(t, ctx, pool)
	holder := seedTicketTokenUser(t, ctx, pool)
	ticketID := seedIssuedTicket(t, ctx, pool, cred, holder)
	eventID := ticketEventID(t, ctx, pool, ticketID)
	// seedIssuedTicket makes `holder` both the event's organiser (organizer_id)
	// and the ticket owner — reassign the organiser explicitly so this test
	// exercises a real third-party steward, not the organiser-scans-own-event path.
	reassignOrganiser(t, ctx, pool, eventID, organiser)

	if err := svc.AddSteward(ctx, organiser, eventID, steward); err != nil {
		t.Fatalf("AddSteward: %v", err)
	}

	credentialID := ticketCredentialID(t, ctx, pool, ticketID)
	res, err := scanToken(t, ctx, svc, cred, steward, credentialID)
	if err != nil {
		t.Fatalf("ScanTicket: %v", err)
	}
	if !res.OK {
		t.Fatalf("got res.OK=false, reason=%q, want a designated steward to be accepted", res.Reason)
	}
}

func TestLiveDB_ScanTicket_RandomUserForbidden(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)
	cred := credential.NewService(pool, nil)

	organiser := seedTicketTokenUser(t, ctx, pool)
	stranger := seedTicketTokenUser(t, ctx, pool)
	ticketID := seedIssuedTicket(t, ctx, pool, cred, organiser)

	credentialID := ticketCredentialID(t, ctx, pool, ticketID)
	_, err := scanToken(t, ctx, svc, cred, stranger, credentialID)
	if err != top5events.ErrForbidden {
		t.Fatalf("got err=%v, want ErrForbidden for a caller who is neither organiser nor steward", err)
	}
}

func TestLiveDB_ScanTicket_StewardOfOtherEventForbidden(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)
	cred := credential.NewService(pool, nil)

	organiserA := seedTicketTokenUser(t, ctx, pool)
	organiserB := seedTicketTokenUser(t, ctx, pool)
	stewardOfA := seedTicketTokenUser(t, ctx, pool)

	ticketA := seedIssuedTicket(t, ctx, pool, cred, organiserA)
	eventA := ticketEventID(t, ctx, pool, ticketA)
	if err := svc.AddSteward(ctx, organiserA, eventA, stewardOfA); err != nil {
		t.Fatalf("AddSteward: %v", err)
	}

	ticketB := seedIssuedTicket(t, ctx, pool, cred, organiserB)
	credentialB := ticketCredentialID(t, ctx, pool, ticketB)

	_, err := scanToken(t, ctx, svc, cred, stewardOfA, credentialB)
	if err != top5events.ErrForbidden {
		t.Fatalf("got err=%v, want ErrForbidden — event A's steward has no grant on event B", err)
	}
}

func TestLiveDB_ScanTicket_RemovedStewardForbidden(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)
	cred := credential.NewService(pool, nil)

	organiser := seedTicketTokenUser(t, ctx, pool)
	steward := seedTicketTokenUser(t, ctx, pool)
	ticketID := seedIssuedTicket(t, ctx, pool, cred, organiser)
	eventID := ticketEventID(t, ctx, pool, ticketID)

	if err := svc.AddSteward(ctx, organiser, eventID, steward); err != nil {
		t.Fatalf("AddSteward: %v", err)
	}
	if err := svc.RemoveSteward(ctx, organiser, eventID, steward); err != nil {
		t.Fatalf("RemoveSteward: %v", err)
	}

	credentialID := ticketCredentialID(t, ctx, pool, ticketID)
	_, err := scanToken(t, ctx, svc, cred, steward, credentialID)
	if err != top5events.ErrForbidden {
		t.Fatalf("got err=%v, want ErrForbidden — grant was revoked before the scan", err)
	}
}

// --- small DB-read helpers, kept local to this file since they're only needed
// --- for wiring these authz scenarios, not general test infrastructure ---

func ticketEventID(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ticketID string) string {
	t.Helper()
	var eventID string
	if err := pool.QueryRow(ctx, `SELECT event_id FROM event_tickets WHERE id=$1`, ticketID).Scan(&eventID); err != nil {
		t.Fatalf("lookup event_id: %v", err)
	}
	return eventID
}

func ticketCredentialID(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ticketID string) string {
	t.Helper()
	var credentialID string
	if err := pool.QueryRow(ctx, `SELECT credential_id FROM event_tickets WHERE id=$1`, ticketID).Scan(&credentialID); err != nil {
		t.Fatalf("lookup credential_id: %v", err)
	}
	return credentialID
}

func reassignOrganiser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, eventID, newOrganiserID string) {
	t.Helper()
	if _, err := pool.Exec(ctx, `UPDATE events SET organizer_id=$2, organiser_id=$2 WHERE id=$1`, eventID, newOrganiserID); err != nil {
		t.Fatalf("reassign organiser: %v", err)
	}
}
