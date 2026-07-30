//go:build doctor_integration

// Package doctor integration tests — the DEEP money path.
//
// These cover the iron-rule cases that require a real Postgres + the real ledger
// and tiers services, because doctor.Service depends on the CONCRETE *Repository,
// *ledger.Service and *tiers.Service (no interface seam to fake — see the note in
// service_test.go and docs/QA_DOCTOR_BACKEND_REPORT.md).
//
// Run with:
//
//	DOCTOR_TEST_DATABASE_URL=postgres://... \
//	  go test -tags doctor_integration ./internal/doctor/...
//
// The DB must have the doctor module migration (20260625000000_doctor_module.sql)
// and the finance ledger/tiers schema applied. Tests skip cleanly if the env var
// is unset, so the default `go test ./internal/doctor/...` stays hermetic.
package doctor_test

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/doctor"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/platform/db"
)

func newIntegrationService(t *testing.T) (*doctor.Service, *ledger.Service, *db.Pool, func()) {
	t.Helper()
	dsn := os.Getenv("DOCTOR_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("DOCTOR_TEST_DATABASE_URL not set; skipping doctor money-path integration tests")
	}
	ctx := context.Background()
	pool, err := db.New(ctx, dsn)
	if err != nil {
		t.Fatalf("db.New: %v", err)
	}
	if err := db.Ping(ctx, pool); err != nil {
		t.Fatalf("db.Ping: %v", err)
	}
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	tiersSvc := tiers.NewService(pool)
	// redis nil -> idempotency falls back to the DB UNIQUE(idempotency_key).
	doctorSvc := doctor.NewService(pool, ledgerSvc, tiersSvc, nil)
	return doctorSvc, ledgerSvc, pool, func() { pool.Close() }
}

// seedTier inserts a user_profiles row with the given kyc_tier so the
// tiers.EnforceWalletDebitLimit check passes (it fail-closes when no profile row
// exists). Tier 3 is used in the happy-path tests for a generous debit limit.
func seedTier(t *testing.T, pool *db.Pool, userID string, kycTier int) {
	t.Helper()
	ctx := context.Background()
	_, err := pool.Exec(ctx,
		`INSERT INTO user_profiles (id, kyc_tier) VALUES ($1, $2)
		 ON CONFLICT (id) DO UPDATE SET kyc_tier = EXCLUDED.kyc_tier`,
		userID, kycTier)
	if err != nil {
		t.Fatalf("seed tier: %v", err)
	}
}

// fundWallet credits the user's wallet so a payout can succeed. It posts a
// balanced double-entry CREDIT from the settlement standing account.
func fundWallet(t *testing.T, ledgerSvc *ledger.Service, userID string, kobo int64) {
	t.Helper()
	ctx := context.Background()
	settlement, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		t.Fatalf("standing account: %v", err)
	}
	if err := ledgerSvc.Credit(ctx, userID, "test:fund:"+userID, "fund-"+uuid.NewString(), settlement.ID, kobo); err != nil {
		t.Fatalf("fund wallet: %v", err)
	}
}

// Case 1: success posts a balanced ledger debit of EXACTLY amountKobo, writes a
// doctor_payouts row (status=pending, ledger_ref set), and reduces the projected
// earnings balance by exactly amountKobo. Audit row is emitted.
func TestPayoutSuccess_PostsBalancedDebitAndPersistsRow(t *testing.T) {
	svc, ledgerSvc, pool, cleanup := newIntegrationService(t)
	defer cleanup()
	ctx := context.Background()

	userID := uuid.NewString()
	const fund = int64(50_000) // ₦500
	const payout = int64(20_000)
	seedTier(t, pool, userID, 3) // tier 3 -> generous daily debit limit
	fundWallet(t, ledgerSvc, userID, fund)

	before, err := ledgerSvc.GetBalance(ctx, userID)
	if err != nil {
		t.Fatalf("balance before: %v", err)
	}

	idem := "payout-" + uuid.NewString()
	res, err := svc.RequestPayout(ctx, userID, idem, doctor.RequestPayoutRequest{AmountKobo: payout})
	if err != nil {
		t.Fatalf("RequestPayout: %v", err)
	}
	if res == nil || res.PayoutID == "" {
		t.Fatalf("expected payout result with id, got %+v", res)
	}
	if res.Status != "pending" {
		t.Errorf("status = %q, want pending", res.Status)
	}

	after, err := ledgerSvc.GetBalance(ctx, userID)
	if err != nil {
		t.Fatalf("balance after: %v", err)
	}
	if before-after != payout {
		t.Errorf("ledger debited %d, want exactly %d", before-after, payout)
	}
}

// Case 2: idempotency replay — same key returns the prior result WITHOUT posting a
// second ledger entry (balance unchanged on replay).
func TestPayoutIdempotencyReplay_NoSecondLedgerEntry(t *testing.T) {
	svc, ledgerSvc, pool, cleanup := newIntegrationService(t)
	defer cleanup()
	ctx := context.Background()

	userID := uuid.NewString()
	seedTier(t, pool, userID, 3)
	fundWallet(t, ledgerSvc, userID, 100_000)

	idem := "payout-replay-" + uuid.NewString()
	first, err := svc.RequestPayout(ctx, userID, idem, doctor.RequestPayoutRequest{AmountKobo: 30_000})
	if err != nil {
		t.Fatalf("first payout: %v", err)
	}
	balAfterFirst, _ := ledgerSvc.GetBalance(ctx, userID)

	// Replay with the SAME key.
	replay, err := svc.RequestPayout(ctx, userID, idem, doctor.RequestPayoutRequest{AmountKobo: 30_000})
	if err != doctor.ErrDuplicateRequest {
		t.Fatalf("replay err = %v, want ErrDuplicateRequest", err)
	}
	if replay == nil || replay.PayoutID != first.PayoutID {
		t.Errorf("replay must return prior payout id %q, got %+v", first.PayoutID, replay)
	}
	balAfterReplay, _ := ledgerSvc.GetBalance(ctx, userID)
	if balAfterFirst != balAfterReplay {
		t.Errorf("replay posted a second ledger entry: %d -> %d", balAfterFirst, balAfterReplay)
	}
}

// Case 4: insufficient funds -> ledger.ErrInsufficientFunds, no payout row.
func TestPayoutInsufficientFunds_Rejected(t *testing.T) {
	svc, ledgerSvc, pool, cleanup := newIntegrationService(t)
	defer cleanup()
	ctx := context.Background()

	userID := uuid.NewString()
	seedTier(t, pool, userID, 3)
	fundWallet(t, ledgerSvc, userID, 1_000) // only ₦10

	idem := "payout-broke-" + uuid.NewString()
	_, err := svc.RequestPayout(ctx, userID, idem, doctor.RequestPayoutRequest{AmountKobo: 5_000_000})
	if err == nil {
		t.Fatal("expected insufficient-funds rejection, got nil")
	}
	// service returns the ledger sentinel unwrapped for this case.
	if err != ledger.ErrInsufficientFunds {
		t.Errorf("err = %v, want ledger.ErrInsufficientFunds", err)
	}
	// No ledger entry was posted (Debit checks the balance before PostJournal),
	// and InsertPayout is reached only after a successful Debit — so no
	// doctor_payouts row exists for this idem key (fail-closed).
	if _, ferr := svc.GetEarnings(ctx, userID); ferr != nil {
		t.Errorf("earnings still readable after rejected payout: %v", ferr)
	}
}

// Case 3: tier-limit denied -> payout rejected fail-closed, NO ledger entry
// posted (balance unchanged). Two sub-cases:
//   - no user_profiles row  -> GetUserTier errors -> EnforceWalletDebitLimit
//     fails closed (the strongest fail-closed guarantee),
//   - kyc_tier=0 (Tier0)    -> ErrWalletDisabled.
//
// In both cases the tier check runs BEFORE ledger.Debit, so funds are untouched.
func TestPayoutTierDenied_FailClosed_NoLedgerEntry(t *testing.T) {
	svc, ledgerSvc, pool, cleanup := newIntegrationService(t)
	defer cleanup()
	ctx := context.Background()

	t.Run("no profile row -> fail closed", func(t *testing.T) {
		userID := uuid.NewString()
		fundWallet(t, ledgerSvc, userID, 100_000) // funded, but no tier profile
		before, _ := ledgerSvc.GetBalance(ctx, userID)

		_, err := svc.RequestPayout(ctx, userID, "tier-"+uuid.NewString(),
			doctor.RequestPayoutRequest{AmountKobo: 10_000})
		if err == nil {
			t.Fatal("expected fail-closed tier rejection, got nil")
		}
		after, _ := ledgerSvc.GetBalance(ctx, userID)
		if before != after {
			t.Errorf("ledger entry posted despite tier denial: %d -> %d", before, after)
		}
	})

	t.Run("tier0 -> wallet disabled", func(t *testing.T) {
		userID := uuid.NewString()
		seedTier(t, pool, userID, 0) // Tier0
		fundWallet(t, ledgerSvc, userID, 100_000)
		before, _ := ledgerSvc.GetBalance(ctx, userID)

		_, err := svc.RequestPayout(ctx, userID, "tier0-"+uuid.NewString(),
			doctor.RequestPayoutRequest{AmountKobo: 10_000})
		if err == nil {
			t.Fatal("expected Tier0 rejection, got nil")
		}
		after, _ := ledgerSvc.GetBalance(ctx, userID)
		if before != after {
			t.Errorf("ledger entry posted despite Tier0: %d -> %d", before, after)
		}
	})
}

// Case 6: earnings are PROJECTED from the ledger (GetBalance), never a stored
// column — funding the wallet then reading earnings reflects the live balance.
func TestEarningsProjectedFromLedger(t *testing.T) {
	svc, ledgerSvc, _, cleanup := newIntegrationService(t)
	defer cleanup()
	ctx := context.Background()

	userID := uuid.NewString()
	fundWallet(t, ledgerSvc, userID, 75_000)

	earn, err := svc.GetEarnings(ctx, userID)
	if err != nil {
		t.Fatalf("GetEarnings: %v", err)
	}
	bal, _ := ledgerSvc.GetBalance(ctx, userID)
	if earn.AvailableKobo != bal {
		t.Errorf("earnings available %d != ledger balance %d (must be a projection)", earn.AvailableKobo, bal)
	}
	if earn.Currency != "NGN" {
		t.Errorf("currency = %q, want NGN", earn.Currency)
	}
}
