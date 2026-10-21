package otp

// Live-DB regression for the deterministic test-mode OTP against real Postgres.
// Gated on TEST_DATABASE_URL (never DATABASE_URL).
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/otp/ -run TestLiveDBTestOTP -v

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func liveSvc(t *testing.T, tm *TestMode) (*Service, *fakeSender) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	sender := &fakeSender{}
	svc, err := NewService(NewPostgresStore(pool), sender, NewPostgresLimiter(pool),
		Config{Pepper: []byte("test-pepper-do-not-use-in-production-" + uuid.NewString()), ResendCooldown: time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	return svc.WithTestMode(tm), sender
}

func uniqTestPhone() string { return fmt.Sprintf("+234999%07d", time.Now().UnixNano()%10000000) }

func TestLiveDBTestOTP(t *testing.T) {
	ctx := context.Background()

	t.Run("test phone accepts deterministic code", func(t *testing.T) {
		svc, sender := liveSvc(t, NewTestMode(true, true, "development"))
		p := uniqTestPhone()
		if err := svc.Issue(ctx, p, "", PurposePhoneVerify, ""); err != nil {
			t.Fatal(err)
		}
		if sender.last().Code != "" {
			t.Fatal("no delivery expected")
		}
		if err := svc.Verify(ctx, p, PurposePhoneVerify, TestOTPCode, ""); err != nil {
			t.Fatalf("verify: %v", err)
		}
		if err := svc.Verify(ctx, p, PurposePhoneVerify, TestOTPCode, ""); !errors.Is(err, ErrInvalidCode) {
			t.Fatalf("replay = %v, want ErrInvalidCode", err)
		}
	})

	t.Run("non-test phone rejects deterministic code", func(t *testing.T) {
		svc, sender := liveSvc(t, NewTestMode(true, true, "development"))
		p := fmt.Sprintf("+23480%08d", time.Now().UnixNano()%100000000)
		if err := svc.Issue(ctx, p, "", PurposePhoneVerify, ""); err != nil {
			t.Fatal(err)
		}
		real := sender.last().Code
		if real == "" {
			t.Fatal("real phone must be delivered")
		}
		if real != TestOTPCode {
			if err := svc.Verify(ctx, p, PurposePhoneVerify, TestOTPCode, ""); !errors.Is(err, ErrInvalidCode) {
				t.Fatalf("got %v, want ErrInvalidCode", err)
			}
		}
		if err := svc.Verify(ctx, p, PurposePhoneVerify, real, ""); err != nil {
			t.Fatalf("real code: %v", err)
		}
	})

	t.Run("production + flag on is refused", func(t *testing.T) {
		svc, sender := liveSvc(t, NewTestMode(true, false, "production"))
		p := uniqTestPhone()
		if err := svc.Issue(ctx, p, "", PurposePhoneVerify, ""); err != nil {
			t.Fatal(err)
		}
		real := sender.last().Code
		if real == "" {
			t.Fatal("production must deliver a real code")
		}
		if real != TestOTPCode {
			if err := svc.Verify(ctx, p, PurposePhoneVerify, TestOTPCode, ""); !errors.Is(err, ErrInvalidCode) {
				t.Fatalf("got %v, want ErrInvalidCode", err)
			}
		}
	})
}
