package connectonboarding_test

// Live-DB test for the SOC-039 phone-verify write path: proves, against real
// Postgres, that RequestPhoneVerification stores the number pending
// verification and ConfirmPhoneVerification flips phone_verified (and thus
// lets onboarding status reach 'complete') on the correct code.
// Gated on TEST_DATABASE_URL — same convention as the repo's other live suites.
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/connect/onboarding/ -run TestLiveDB -v

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	connectonboarding "spotlight/backend/internal/connect/onboarding"
	connectsafety "spotlight/backend/internal/connect/safety"
	"spotlight/backend/internal/otp"
	"spotlight/backend/internal/testsupport"
)

func newPhoneTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

type captureSMSSender struct{ code string }

func (c *captureSMSSender) SendOTP(_ context.Context, _to, _name, code string, _ time.Duration) error {
	c.code = code
	return nil
}

func seedOnboardUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, id, id+"@seed.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	testsupport.CleanupUser(t, pool, id)
	return id
}

func TestLiveDBPhoneVerification(t *testing.T) {
	pool := newPhoneTestPool(t)
	ctx := context.Background()
	userID := seedOnboardUser(t, pool)
	svc := connectonboarding.NewService(pool, connectsafety.NewService(pool))

	sender := &captureSMSSender{}
	otpSvc, err := otp.NewService(
		otp.NewPostgresStore(pool), sender, otp.NewPostgresLimiter(pool),
		otp.Config{Pepper: []byte("test-pepper-do-not-use-in-production")},
	)
	if err != nil {
		t.Fatalf("otp.NewService: %v", err)
	}

	// Verify before requesting a code → ErrNoPhonePending.
	if _, err := svc.ConfirmPhoneVerification(ctx, userID, "000000", "10.0.0.1", otpSvc); !errors.Is(err, connectonboarding.ErrNoPhonePending) {
		t.Fatalf("verify-without-request = %v, want ErrNoPhonePending", err)
	}

	if err := svc.RequestPhoneVerification(ctx, userID, "+234 801-234 5678", "10.0.0.1", otpSvc); err != nil {
		t.Fatalf("RequestPhoneVerification: %v", err)
	}
	if sender.code == "" {
		t.Fatal("no SMS code sent")
	}
	var stored string
	if err := pool.QueryRow(ctx, `SELECT phone FROM connect_onboarding WHERE user_id=$1`, userID).Scan(&stored); err != nil {
		t.Fatalf("read phone: %v", err)
	}
	if stored != "+2348012345678" {
		t.Fatalf("stored phone = %q, want normalised +2348012345678", stored)
	}

	// Wrong code → ErrInvalidCode, still unverified.
	if _, err := svc.ConfirmPhoneVerification(ctx, userID, "000000", "10.0.0.1", otpSvc); !errors.Is(err, otp.ErrInvalidCode) {
		t.Fatalf("wrong code = %v, want ErrInvalidCode", err)
	}

	// Correct code → phone_verified flips.
	st, err := svc.ConfirmPhoneVerification(ctx, userID, sender.code, "10.0.0.1", otpSvc)
	if err != nil {
		t.Fatalf("ConfirmPhoneVerification: %v", err)
	}
	if !st.PhoneVerified {
		t.Fatal("phone_verified should be true after a correct code")
	}

	// Requesting a code for a DIFFERENT number un-verifies the old one.
	if err := svc.RequestPhoneVerification(ctx, userID, "+2349090909090", "10.0.0.2", otpSvc); err != nil {
		t.Fatalf("re-request new number: %v", err)
	}
	var verified bool
	if err := pool.QueryRow(ctx, `SELECT phone_verified FROM connect_onboarding WHERE user_id=$1`, userID).Scan(&verified); err != nil {
		t.Fatalf("read verified: %v", err)
	}
	if verified {
		t.Fatal("swapping to a new number must reset phone_verified")
	}
}
