package otp

import (
	"context"
	"errors"
	"testing"
)

// SOC-039: PurposePhoneVerify issues + verifies like every other purpose —
// the service treats the "email" parameter as an opaque identifier, so a phone
// number works unchanged.
func TestPhoneVerifyPurposeRoundTrip(t *testing.T) {
	svc, _, sender, _ := newTestService(t, nil)
	ctx := context.Background()
	phone := "+2348012345678"

	if err := svc.Issue(ctx, phone, "", PurposePhoneVerify, "1.2.3.4"); err != nil {
		t.Fatalf("Issue: %v", err)
	}
	if got := sender.last().To; got != phone {
		t.Fatalf("sent to %q, want %q", got, phone)
	}
	code := sender.last().Code
	if code == "" {
		t.Fatal("no code sent")
	}
	if err := svc.Verify(ctx, phone, PurposePhoneVerify, code, "1.2.3.4"); err != nil {
		t.Fatalf("Verify: %v", err)
	}
	// Consumed codes must not verify twice.
	if err := svc.Verify(ctx, phone, PurposePhoneVerify, code, "1.2.3.4"); !errors.Is(err, ErrInvalidCode) {
		t.Fatalf("replay = %v, want ErrInvalidCode", err)
	}
}

// A code issued for phone_verify must not satisfy another purpose — the
// purpose is part of the storage key.
func TestPhoneVerifyPurposeIsolation(t *testing.T) {
	svc, _, sender, _ := newTestService(t, nil)
	ctx := context.Background()
	phone := "+2348012345678"

	if err := svc.Issue(ctx, phone, "", PurposePhoneVerify, "1.2.3.4"); err != nil {
		t.Fatalf("Issue: %v", err)
	}
	code := sender.last().Code
	if err := svc.Verify(ctx, phone, PurposeLogin, code, "1.2.3.4"); !errors.Is(err, ErrInvalidCode) {
		t.Fatalf("cross-purpose verify = %v, want ErrInvalidCode", err)
	}
}
