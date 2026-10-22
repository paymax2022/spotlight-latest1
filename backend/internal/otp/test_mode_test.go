package otp

import (
	"context"
	"errors"
	"testing"
)

const tPhone = "+2349991234567"

func TestTestModeUnit(t *testing.T) {
	ctx := context.Background()

	t.Run("test phone gets deterministic code, no delivery", func(t *testing.T) {
		svc, _, sender, _ := newTestService(t, nil)
		svc.WithTestMode(NewTestMode(true, true, "development"))
		if err := svc.Issue(ctx, tPhone, "", PurposePhoneVerify, "1.1.1.1"); err != nil {
			t.Fatal(err)
		}
		if sender.last().Code != "" {
			t.Fatal("test phone must not trigger delivery")
		}
		if err := svc.Verify(ctx, tPhone, PurposePhoneVerify, TestOTPCode, "1.1.1.1"); err != nil {
			t.Fatalf("deterministic verify: %v", err)
		}
	})

	t.Run("non-test phone rejects deterministic code, real code works", func(t *testing.T) {
		svc, _, sender, _ := newTestService(t, nil)
		svc.WithTestMode(NewTestMode(true, true, "development"))
		real := "+2348012345678"
		if err := svc.Issue(ctx, real, "", PurposePhoneVerify, "1.1.1.1"); err != nil {
			t.Fatal(err)
		}
		code := sender.last().Code
		if code == "" {
			t.Fatal("real phone must be delivered")
		}
		if code != TestOTPCode {
			if err := svc.Verify(ctx, real, PurposePhoneVerify, TestOTPCode, "1.1.1.1"); !errors.Is(err, ErrInvalidCode) {
				t.Fatalf("deterministic on real phone = %v, want ErrInvalidCode", err)
			}
		}
		if err := svc.Verify(ctx, real, PurposePhoneVerify, code, "1.1.1.1"); err != nil {
			t.Fatalf("real code: %v", err)
		}
	})

	t.Run("flag off: test phone is delivered a real code", func(t *testing.T) {
		svc, _, sender, _ := newTestService(t, nil)
		svc.WithTestMode(NewTestMode(false, true, "development"))
		if err := svc.Issue(ctx, tPhone, "", PurposePhoneVerify, "1.1.1.1"); err != nil {
			t.Fatal(err)
		}
		if sender.last().Code == "" {
			t.Fatal("expected real delivery with flag off")
		}
	})

	t.Run("production fails closed even with flag on", func(t *testing.T) {
		tm := NewTestMode(true, false, "production")
		if tm.Active() || tm.AppliesTo(tPhone) {
			t.Fatal("test mode must be inactive when mocks not allowed")
		}
		svc, _, sender, _ := newTestService(t, nil)
		svc.WithTestMode(tm)
		if err := svc.Issue(ctx, tPhone, "", PurposePhoneVerify, "1.1.1.1"); err != nil {
			t.Fatal(err)
		}
		if sender.last().Code == "" {
			t.Fatal("production must deliver a real code")
		}
		if sender.last().Code != TestOTPCode {
			if err := svc.Verify(ctx, tPhone, PurposePhoneVerify, TestOTPCode, "1.1.1.1"); !errors.Is(err, ErrInvalidCode) {
				t.Fatalf("deterministic code in prod = %v, want ErrInvalidCode", err)
			}
		}
	})
}
