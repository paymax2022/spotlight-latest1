package tiers_test

// LIVE-DB tests for the tier LOOKUP behind the merchant receipt ceiling. The restaurant
// gate asks what an outlet's OWNER may take in; this is where that answer comes from, and
// the states worth pinning are the two a unit test cannot see:
//   - a brand-new account: the auth.users trigger creates user_profiles at kyc_tier 0, so
//     an outlet whose owner has not done KYC is capped at the unverified rung by default;
//   - a legacy account with NO user_profiles row at all: GetUserTier returns
//     pgx.ErrNoRows, which reads as Tier 0. Not an error — the payee of every order would
//     otherwise be refused whatever it is worth, verified or not. And not unlimited:
//     "we could not find your verification level" must never be the most generous answer.
// Skipped unless TEST_DATABASE_URL is set (never DATABASE_URL — that is the production
// pooler), same gate as TestLiveDB_ConcurrentDebits:
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:54322/postgres"
//	go test ./internal/finance/tiers/ -run TestLiveDB_EnforceMerchantReceiptLimit -v

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/testsupport"
)

const (
	smallOrderKobo int64 = 1_000_000   // ₦10,000 — inside every rung of the ladder
	hugeOrderKobo  int64 = 500_000_000 // ₦500,000 — above every cap short of Tier 3
)

// TestLiveDB_EnforceMerchantReceiptLimit_NewAccountIsCappedAtTier0: creating an account is
// the whole of the seeding here — no tier is set by the test. The trigger-created profile
// must put the outlet at the unverified ceiling.
func TestLiveDB_EnforceMerchantReceiptLimit_NewAccountIsCappedAtTier0(t *testing.T) {
	pool := tiersConcurrencyPool(t)
	ctx := context.Background()
	svc := tiers.NewService(pool)

	user := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1, $2)`,
		user, "mrc-newacct-"+user+"@example.invalid"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	testsupport.CleanupUser(t, pool, user)

	var tier int
	if err := pool.QueryRow(ctx, `SELECT kyc_tier FROM user_profiles WHERE id=$1`, user).Scan(&tier); err != nil {
		t.Fatalf("the auth.users trigger should have created a user_profiles row: %v", err)
	}
	if tier != 0 {
		t.Fatalf("a new account starts at kyc_tier %d, want 0 — the ceiling this test asserts assumes that", tier)
	}

	unverified := tiers.SmallTransactionMaxKobo
	if err := svc.EnforceMerchantReceiptLimit(ctx, user, unverified); err != nil {
		t.Errorf("an order of exactly ₦20,000 to a never-verified owner = %v, want nil (a ceiling, not a ban on trading)", err)
	}
	if err := svc.EnforceMerchantReceiptLimit(ctx, user, unverified+1); !errors.Is(err, tiers.ErrMerchantOrderLimitExceeded) {
		t.Errorf("an order ₦10 above the unverified ceiling = %v, want ErrMerchantOrderLimitExceeded", err)
	}
}

// TestLiveDB_EnforceMerchantReceiptLimit_MissingProfileRowReadsAsTier0: the ErrNoRows
// branch. An id the database has never heard of must behave exactly like a Tier-0 one —
// accepted up to the unverified ceiling, refused above it, and never a lookup failure.
func TestLiveDB_EnforceMerchantReceiptLimit_MissingProfileRowReadsAsTier0(t *testing.T) {
	pool := tiersConcurrencyPool(t)
	ctx := context.Background()
	svc := tiers.NewService(pool)

	ghost := uuid.NewString() // no auth.users row, so no user_profiles row either
	if err := svc.EnforceMerchantReceiptLimit(ctx, ghost, smallOrderKobo); err != nil {
		t.Errorf("a ₦10,000 order to an owner with no profile row = %v, want nil", err)
	}
	if err := svc.EnforceMerchantReceiptLimit(ctx, ghost, tiers.SmallTransactionMaxKobo); err != nil {
		t.Errorf("an order at the unverified ceiling for an owner with no profile row = %v, want nil", err)
	}
	if err := svc.EnforceMerchantReceiptLimit(ctx, ghost, tiers.SmallTransactionMaxKobo+1); !errors.Is(err, tiers.ErrMerchantOrderLimitExceeded) {
		t.Errorf("a ₦30,000 order to an owner with no profile row = %v, want ErrMerchantOrderLimitExceeded — "+
			"an unreadable tier may not read as unlimited", err)
	}
}

// TestLiveDB_EnforceMerchantReceiptLimit_UsesTheProfileTier: each rung of ADR-001's ladder
// lets its own daily-spend number through and no more, and Tier 3 lets anything through.
// The boundary is inclusive — an order AT the ceiling is not "more than" it.
func TestLiveDB_EnforceMerchantReceiptLimit_UsesTheProfileTier(t *testing.T) {
	pool := tiersConcurrencyPool(t)
	ctx := context.Background()
	svc := tiers.NewService(pool)

	for _, tc := range []struct {
		name    string
		tier    tiers.Tier
		ceiling int64 // 0 = unlimited
	}{
		// Tier 0 is NOT read off GetConfig: its DailyDebitLimitKobo is 0 because the
		// WALLET is disabled there, and on the receipt side 0 means unlimited — the
		// opposite of what an unverified account should get. The unverified rung borrows
		// the small-transaction number instead. Tiers 1 and 2 do mirror their own cap.
		{"tier0", tiers.Tier0, tiers.SmallTransactionMaxKobo},
		{"tier1", tiers.Tier1, tiers.GetConfig(tiers.Tier1).DailyDebitLimitKobo},
		{"tier2", tiers.Tier2, tiers.GetConfig(tiers.Tier2).DailyDebitLimitKobo},
		{"tier3", tiers.Tier3, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			user := tiersConcurrencyUser(t, pool, int(tc.tier))
			if err := svc.EnforceMerchantReceiptLimit(ctx, user, smallOrderKobo); err != nil {
				t.Fatalf("a small order at %s = %v, want nil", tc.name, err)
			}
			if tc.ceiling == 0 {
				if err := svc.EnforceMerchantReceiptLimit(ctx, user, hugeOrderKobo); err != nil {
					t.Errorf("a fully verified owner was refused ₦500,000: %v", err)
				}
				return
			}
			if err := svc.EnforceMerchantReceiptLimit(ctx, user, tc.ceiling); err != nil {
				t.Errorf("an order of exactly the %s ceiling (%d kobo) = %v, want nil", tc.name, tc.ceiling, err)
			}
			if err := svc.EnforceMerchantReceiptLimit(ctx, user, tc.ceiling+1); !errors.Is(err, tiers.ErrMerchantOrderLimitExceeded) {
				t.Errorf("an order a kobo above the %s ceiling = %v, want ErrMerchantOrderLimitExceeded", tc.name, err)
			}
		})
	}
}
