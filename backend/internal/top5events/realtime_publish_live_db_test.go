package top5events_test

// Live-DB regression for ScanTicket's live check-in push (SetRealtime /
// publishCheckinSafe) — added alongside the router-level shared SSE hub
// (backend/internal/app/router.go). Verifies the actual contract: publish
// fires on an ACCEPTED scan (not a rejected one), reaches the organiser, and
// a publish failure never fails the scan itself — a fake RealtimePublisher
// stands in for the real Hub so this doesn't depend on an SSE connection.
//
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"sync"
	"testing"

	"spotlight/backend/internal/credential"
)

// fakeRealtimePublisher records every PublishToUser call for assertions, and
// can be told to always fail (to prove a publish error never fails a scan).
type fakeRealtimePublisher struct {
	mu       sync.Mutex
	calls    []fakePublishCall
	failWith error
}

type fakePublishCall struct {
	userID    string
	eventType string
}

func (f *fakeRealtimePublisher) PublishToUser(ctx context.Context, userID, eventType string, payload any) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, fakePublishCall{userID: userID, eventType: eventType})
	return f.failWith
}

func (f *fakeRealtimePublisher) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.calls)
}

func TestLiveDB_ScanTicket_PublishesOnAcceptToOrganiser(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)
	cred := credential.NewService(pool, nil)

	fake := &fakeRealtimePublisher{}
	svc.SetRealtime(fake)

	organiser := seedTicketTokenUser(t, ctx, pool)
	ticketID := seedIssuedTicket(t, ctx, pool, cred, organiser)
	credentialID := ticketCredentialID(t, ctx, pool, ticketID)

	res, err := scanToken(t, ctx, svc, cred, organiser, credentialID)
	if err != nil {
		t.Fatalf("ScanTicket: %v", err)
	}
	if !res.OK {
		t.Fatalf("got res.OK=false, want accepted")
	}
	if fake.callCount() != 1 {
		t.Fatalf("got %d publish calls, want exactly 1 for an accepted scan", fake.callCount())
	}
	fake.mu.Lock()
	got := fake.calls[0]
	fake.mu.Unlock()
	if got.userID != organiser {
		t.Errorf("published to %q, want the organiser %q", got.userID, organiser)
	}
	if got.eventType != "events.checkin" {
		t.Errorf("eventType = %q, want \"events.checkin\"", got.eventType)
	}
}

func TestLiveDB_ScanTicket_DoesNotPublishOnReject(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)
	cred := credential.NewService(pool, nil)

	fake := &fakeRealtimePublisher{}
	svc.SetRealtime(fake)

	organiser := seedTicketTokenUser(t, ctx, pool)
	stranger := seedTicketTokenUser(t, ctx, pool)
	ticketID := seedIssuedTicket(t, ctx, pool, cred, organiser)
	credentialID := ticketCredentialID(t, ctx, pool, ticketID)

	// A forbidden caller never reaches Validate, so no scan is ever accepted or
	// rejected by the credential layer — but publish must still not fire.
	if _, err := scanToken(t, ctx, svc, cred, stranger, credentialID); err == nil {
		t.Fatal("expected ErrForbidden for a non-organiser, non-steward caller")
	}
	if fake.callCount() != 0 {
		t.Fatalf("got %d publish calls for a forbidden (never-validated) scan, want 0", fake.callCount())
	}
}

func TestLiveDB_ScanTicket_PublishFailureDoesNotFailTheScan(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)
	cred := credential.NewService(pool, nil)

	fake := &fakeRealtimePublisher{}
	fake.failWith = context.DeadlineExceeded // any non-nil error stands in for a real delivery failure
	svc.SetRealtime(fake)

	organiser := seedTicketTokenUser(t, ctx, pool)
	ticketID := seedIssuedTicket(t, ctx, pool, cred, organiser)
	credentialID := ticketCredentialID(t, ctx, pool, ticketID)

	res, err := scanToken(t, ctx, svc, cred, organiser, credentialID)
	if err != nil {
		t.Fatalf("ScanTicket returned an error because the BEST-EFFORT publish failed: %v — this must never happen", err)
	}
	if !res.OK {
		t.Fatal("got res.OK=false — a publish failure must not turn an otherwise-valid scan into a rejection")
	}
	if fake.callCount() != 1 {
		t.Fatalf("got %d publish attempts, want exactly 1 (the failure is swallowed, not retried)", fake.callCount())
	}
}
