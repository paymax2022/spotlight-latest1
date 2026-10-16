package otp

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestTicketIsSingleUse(t *testing.T) {
	ctx := context.Background()
	svc, _, _, _ := newTestService(t, nil)

	ticket, err := svc.IssueTicket(ctx, "a@b.com", PurposePasswordReset)
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if len(ticket) < 40 {
		t.Fatalf("ticket is only %d chars; want 256 bits of randomness", len(ticket))
	}
	if err := svc.RedeemTicket(ctx, "a@b.com", PurposePasswordReset, ticket, ""); err != nil {
		t.Fatalf("first redeem: %v", err)
	}
	if err := svc.RedeemTicket(ctx, "a@b.com", PurposePasswordReset, ticket, ""); !errors.Is(err, ErrInvalidCode) {
		t.Fatalf("second redeem error = %v, want ErrInvalidCode (replay must fail)", err)
	}
}

func TestTicketIsBoundToTheAddress(t *testing.T) {
	ctx := context.Background()
	svc, _, _, _ := newTestService(t, nil)
	ticket, _ := svc.IssueTicket(ctx, "a@b.com", PurposePasswordReset)

	if err := svc.RedeemTicket(ctx, "someone-else@b.com", PurposePasswordReset, ticket, ""); !errors.Is(err, ErrInvalidCode) {
		t.Fatalf("another address redeemed the ticket: err=%v", err)
	}
	// The real owner can still use it: a stranger's failed guess elsewhere must
	// not have burnt it.
	if err := svc.RedeemTicket(ctx, "a@b.com", PurposePasswordReset, ticket, ""); err != nil {
		t.Fatalf("owner redeem after a stranger's attempt: %v", err)
	}
}

func TestWrongTicketLocksOutAndDestroysTheTicket(t *testing.T) {
	ctx := context.Background()
	svc, store, _, _ := newTestService(t, func(c *Config) { c.MaxAttempts = 3 })
	ticket, _ := svc.IssueTicket(ctx, "a@b.com", PurposePasswordReset)

	var last error
	for i := 0; i < 3; i++ {
		last = svc.RedeemTicket(ctx, "a@b.com", PurposePasswordReset, "not-the-ticket", "")
	}
	if !errors.Is(last, ErrTooManyAttempts) {
		t.Fatalf("after 3 wrong guesses error = %v, want ErrTooManyAttempts", last)
	}
	if store.len() != 0 {
		t.Error("the ticket survived a lockout")
	}
	if err := svc.RedeemTicket(ctx, "a@b.com", PurposePasswordReset, ticket, ""); err == nil {
		t.Fatal("the correct ticket worked after lockout")
	}
}

func TestExpiredTicketIsRefusedAndRemoved(t *testing.T) {
	ctx := context.Background()
	svc, store, _, _ := newTestService(t, nil)
	ticket, _ := svc.IssueTicket(ctx, "a@b.com", PurposePasswordReset)

	k := svc.ticketKey(PurposePasswordReset, "a@b.com")
	rec, _ := store.Get(ctx, k)
	rec.ExpiresAt = time.Now().UTC().Add(-time.Second)
	store.rows[k] = rec

	if err := svc.RedeemTicket(ctx, "a@b.com", PurposePasswordReset, ticket, ""); !errors.Is(err, ErrExpired) {
		t.Fatalf("error = %v, want ErrExpired", err)
	}
	if store.len() != 0 {
		t.Error("expired ticket was not cleaned up on read")
	}
}

// The two kinds of secret must not be interchangeable.
func TestACodeCannotBeRedeemedAsATicketAndViceVersa(t *testing.T) {
	ctx := context.Background()
	svc, _, sender, _ := newTestService(t, nil)

	if err := svc.Issue(ctx, "a@b.com", "A", PurposePasswordReset, ""); err != nil {
		t.Fatalf("issue: %v", err)
	}
	code := sender.last().Code
	if err := svc.RedeemTicket(ctx, "a@b.com", PurposePasswordReset, code, ""); err == nil {
		t.Fatal("an emailed code was accepted as a reset ticket")
	}

	ticket, _ := svc.IssueTicket(ctx, "a@b.com", PurposePasswordReset)
	if err := svc.Verify(ctx, "a@b.com", PurposePasswordReset, ticket, ""); err == nil {
		t.Fatal("a reset ticket was accepted as an emailed code")
	}
}

func TestTicketIsNotStoredInPlaintext(t *testing.T) {
	ctx := context.Background()
	svc, store, _, _ := newTestService(t, nil)
	ticket, _ := svc.IssueTicket(ctx, "a@b.com", PurposePasswordReset)

	for k, r := range store.rows {
		if strings.Contains(k, ticket) || strings.Contains(r.Hash, ticket) {
			t.Fatal("the plaintext ticket reached storage")
		}
	}
}

func TestIssueTicketRejectsAnUnknownPurpose(t *testing.T) {
	svc, _, _, _ := newTestService(t, nil)
	if _, err := svc.IssueTicket(context.Background(), "a@b.com", "not-a-purpose"); !errors.Is(err, ErrUnknownPurpose) {
		t.Fatalf("error = %v, want ErrUnknownPurpose", err)
	}
}
