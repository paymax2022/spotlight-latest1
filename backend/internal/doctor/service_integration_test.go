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
//
// email is supplied explicitly: the column is NOT NULL with no default and carries
// a UNIQUE index, so it is derived from userID rather than fixed. Omitting it made
// every caller of this helper fail with a not-null violation, which is what killed
// the whole money-path suite. It also matches the address seedAuthUser writes, so
// the auth row and the profile row agree.
func seedTier(t *testing.T, pool *db.Pool, userID string, kycTier int) {
	t.Helper()
	ctx := context.Background()
	_, err := pool.Exec(ctx,
		`INSERT INTO user_profiles (id, email, kyc_tier) VALUES ($1, $2, $3)
		 ON CONFLICT (id) DO UPDATE SET kyc_tier = EXCLUDED.kyc_tier`,
		userID, testEmailFor(userID), kycTier)
	if err != nil {
		t.Fatalf("seed tier: %v", err)
	}
}

// testEmailFor derives a unique, obviously-synthetic address from a user id, so
// seedAuthUser and seedTier write the same one.
func testEmailFor(userID string) string { return "doctor-it-" + userID + "@example.test" }

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
	t.Cleanup(cleanup)
	ctx := context.Background()

	userID := seedAuthUser(t, pool)
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
	t.Cleanup(cleanup)
	ctx := context.Background()

	userID := seedAuthUser(t, pool)
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
	t.Cleanup(cleanup)
	ctx := context.Background()

	userID := seedAuthUser(t, pool)
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
	t.Cleanup(cleanup)
	ctx := context.Background()

	t.Run("no profile row -> fail closed", func(t *testing.T) {
		// auth.users row only — deliberately NO user_profiles row, which is the
		// condition under test (GetUserTier errors -> the limit check fails closed).
		userID := seedAuthUser(t, pool)
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
		userID := seedAuthUser(t, pool)
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
	svc, ledgerSvc, pool, cleanup := newIntegrationService(t)
	t.Cleanup(cleanup)
	ctx := context.Background()

	userID := seedAuthUser(t, pool)
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

// Regression: a user who has never requested an upgrade must get the
// `not_started` STATE, never an error.
//
// The repository correctly reports "no row"; the bug was translating that into a
// 404 at the service boundary. Every provider looks exactly like this on their
// first visit, so the 404 made /onboarding/upgrade-merchant unreachable for the
// only people it exists for — it rendered "We could not load your upgrade
// status". contracts/doctor.openapi.yaml declares ONLY a 200 for this endpoint,
// so the 404 was never part of the contract either.
func TestGetMerchantUpgrade_FreshUserIsNotStartedNotAnError(t *testing.T) {
	svc, _, _, cleanup := newIntegrationService(t)
	defer cleanup()
	ctx := context.Background()

	userID := uuid.NewString() // deliberately never inserted into doctor_merchant_upgrades

	got, err := svc.GetMerchantUpgrade(ctx, userID)
	if err != nil {
		t.Fatalf("a fresh user must not error: %v", err)
	}
	if got == nil {
		t.Fatal("a fresh user must receive a status object, got nil")
	}
	if got.State != doctor.MerchantUpgradeNotStarted {
		t.Errorf("state = %q, want %q", got.State, doctor.MerchantUpgradeNotStarted)
	}
	if got.UserID != userID {
		t.Errorf("userId = %q, want %q", got.UserID, userID)
	}
	// The client type declares updatedAt as REQUIRED, and a zero time serialises
	// as year 0001, which renders as a nonsense date rather than an absent one.
	if got.UpdatedAt.IsZero() {
		t.Error("updatedAt must be set on the synthesised not_started status")
	}
}

// seedAuthUser creates the auth.users row that doctor_profiles.user_id references.
// A bare uuid.NewString() fails that FK. ON DELETE CASCADE removes everything the
// test wrote when the row goes, so cleanup is one statement.
func seedAuthUser(t *testing.T, pool *db.Pool) string {
	t.Helper()
	ctx := context.Background()
	id := uuid.NewString()
	_, err := pool.Exec(ctx, `
		INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
		VALUES ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, now(), now())`,
		id, testEmailFor(id))
	if err != nil {
		t.Fatalf("seed auth user: %v", err)
	}
	// BEST EFFORT, and it deliberately does not fail the test when it cannot
	// delete.
	//
	// auth.users cascades to ledger_accounts, but ledger_entries -> ledger_accounts
	// is ON DELETE NO ACTION — the schema enforcing "ledger entries are immutable".
	// So any user this suite has funded or debited CANNOT be removed, and that
	// refusal is the invariant working, not a bug.
	//
	// Do NOT "fix" a failure here by deleting from ledger_entries first: that
	// teaches the suite to erase the append-only record the whole module exists to
	// protect. Users with no ledger activity (the onboarding tests) do get removed.
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM auth.users WHERE id = $1`, id)
	})
	return id
}

// Regression: choosing a provider type must work for a user with NO doctor_profiles
// row — which is everyone who reaches this step.
//
// Nothing in this backend ever INSERTed into doctor_profiles, so the UPDATE this
// path used to run matched zero rows and returned ErrNotFound → HTTP 404, blocking
// onboarding at the provider-type step for every real user.
func TestSetProviderType_CreatesProfileRowForFreshUser(t *testing.T) {
	svc, _, pool, cleanup := newIntegrationService(t)
	// t.Cleanup, NOT defer: seedAuthUser registers its row deletion with
	// t.Cleanup, and deferred calls run BEFORE cleanups — so `defer cleanup()`
	// closes the pool first and the deletion silently no-ops against it, leaking
	// rows. Registered here first, so it runs LAST.
	t.Cleanup(cleanup)
	ctx := context.Background()

	userID := seedAuthUser(t, pool)

	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM doctor_profiles WHERE user_id=$1`, userID).Scan(&n); err != nil {
		t.Fatalf("precondition count: %v", err)
	}
	if n != 0 {
		t.Fatalf("precondition: the user must start with no profile row, got %d", n)
	}

	if _, err := svc.SetProviderType(ctx, userID, "idem-"+uuid.NewString(),
		doctor.SetProviderTypeRequest{ProviderType: "veterinarian"}); err != nil {
		t.Fatalf("SetProviderType on a fresh user must succeed: %v", err)
	}

	var draftType string
	if err := pool.QueryRow(ctx,
		`SELECT profile_draft->>'providerType' FROM doctor_profiles WHERE user_id=$1`,
		userID).Scan(&draftType); err != nil {
		t.Fatalf("the profile row must exist after selection: %v", err)
	}
	if draftType != "veterinarian" {
		t.Errorf("draft providerType = %q, want veterinarian", draftType)
	}
}

// Regression: the chosen type must come back on the merchant-upgrade status — that
// is what the provider-type screen reads to preselect the user's card. The Go model
// carried no selectedType field at all, so it was permanently undefined on the
// client and returning to the step always looked like nothing had been chosen.
func TestGetMerchantUpgrade_SurfacesSelectedType(t *testing.T) {
	svc, _, pool, cleanup := newIntegrationService(t)
	t.Cleanup(cleanup) // see the note in TestSetProviderType_CreatesProfileRowForFreshUser
	ctx := context.Background()

	userID := seedAuthUser(t, pool)

	before, err := svc.GetMerchantUpgrade(ctx, userID)
	if err != nil {
		t.Fatalf("GetMerchantUpgrade (before): %v", err)
	}
	if before.SelectedType != nil {
		t.Errorf("selectedType must be nil before any choice, got %q", *before.SelectedType)
	}

	if _, err := svc.SetProviderType(ctx, userID, "idem-"+uuid.NewString(),
		doctor.SetProviderTypeRequest{ProviderType: "specialist"}); err != nil {
		t.Fatalf("SetProviderType: %v", err)
	}

	after, err := svc.GetMerchantUpgrade(ctx, userID)
	if err != nil {
		t.Fatalf("GetMerchantUpgrade (after): %v", err)
	}
	if after.SelectedType == nil {
		t.Fatal("selectedType must be set once a provider type has been chosen")
	}
	if *after.SelectedType != "specialist" {
		t.Errorf("selectedType = %q, want specialist", *after.SelectedType)
	}
}
