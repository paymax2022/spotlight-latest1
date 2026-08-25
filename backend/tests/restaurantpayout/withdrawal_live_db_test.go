package restaurantpayout_test

// ---------------------------------------------------------------------------
// LIVE-DB integration tests for the restaurant merchant WITHDRAWAL money path
// (backend/internal/restaurant/withdrawal.go: RequestWithdrawal + the webhook
// status flips MarkWithdrawalPaid / MarkWithdrawalFailed).
//
// A withdrawal moves a merchant's EARNED wallet balance (credited by paid
// restaurant_payout_runs — here seeded directly via ledger.Credit) OUT to a
// saved settlement bank account. RequestWithdrawal posts ONE balanced ledger
// reserve (DR merchant wallet, CR failed_transfer_suspense) keyed on the
// caller's Idempotency-Key, records a `processing` withdrawal row, and hands to
// a disbursement adapter that — with the default Noop — executes NOTHING (money
// stays reserved). A later provider webhook flips the row paid (drain suspense →
// provider_clearing) or failed (reverse suspense → wallet).
//
// Iron rules proven here (root CLAUDE.md "Money handling"):
//   - balanced double-entry: the reserve reference nets to ZERO (DR == CR);
//   - amounts are integer kobo; the wallet is debited by EXACTLY the amount;
//   - idempotent replay posts NO second ledger move (never double-debits);
//   - insufficient balance is fail-closed (no row, no ledger move);
//   - owner-scoping: a merchant cannot withdraw to another owner's bank account;
//   - tier limits are enforced fail-closed (Tier 0 wallet disabled → blocked).
//
// SKIPPED whenever TEST_DATABASE_URL is unset (same gate + helpers
// as payout_live_db_test.go, whose liveDBPool/seedUser/seedRestaurant/balanceOf/
// newIdemKey/ledgerEntryCount/newLiveLedgerService this file reuses).
//
// Bring-up: apply migrations incl. 20261101000100_restaurant_bank_accounts.sql
// and 20261101000200_restaurant_withdrawals.sql, then:
//   cd backend && TEST_DATABASE_URL=postgres://postgres:postgres@localhost:54322/postgres?sslmode=disable \
//     go test ./tests/restaurantpayout/... -run LiveDB_Withdrawal -v
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/restaurant"
)

// newLiveWithdrawalService wires restaurant.Service for the withdrawal money
// path: a pool + real ledger (WithLedger) + real tiers (WithTiers, fail-closed
// limit check) + withdrawals feature ON. The disburser is left at the default
// Noop (executes nothing) — exactly the pre-provider posture this slice ships.
func newLiveWithdrawalService(pool *pgxpool.Pool, led *ledger.Service) *restaurant.Service {
	return restaurant.NewService(pool, nil).
		WithLedger(led).
		WithTiers(tiers.NewService(pool)).
		WithWithdrawals(true)
}

// setUserTier stamps the seeded user's KYC tier (user_profiles.kyc_tier), which
// tiers.GetUserTier reads. The handle_new_user trigger already created the row on
// the auth.users insert, so an UPDATE is sufficient. Tier 3 = unlimited debits.
func setUserTier(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string, tier int) {
	t.Helper()
	ct, err := pool.Exec(ctx, `UPDATE user_profiles SET kyc_tier=$2 WHERE id=$1`, userID, tier)
	if err != nil {
		t.Fatalf("set user tier: %v", err)
	}
	if ct.RowsAffected() == 0 {
		// Fallback if the trigger did not materialise a profile row.
		if _, err := pool.Exec(ctx,
			`INSERT INTO user_profiles (id, email, kyc_tier) VALUES ($1, $2, $3)
			 ON CONFLICT (id) DO UPDATE SET kyc_tier=EXCLUDED.kyc_tier`,
			userID, userID+"@seed.test", tier); err != nil {
			t.Fatalf("insert user profile tier: %v", err)
		}
	}
}

// seedMerchantBankAccount inserts a saved settlement account owned by ownerID and
// returns its id (the withdrawal destination).
func seedMerchantBankAccount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ownerID string) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO restaurant_bank_accounts
			(id, user_id, bank_name, bank_code, account_number, account_name, is_default)
		VALUES ($1, $2, 'Guaranty Trust Bank', '058', '0123456789', 'TEST MERCHANT', true)`,
		id, ownerID); err != nil {
		t.Fatalf("seed bank account: %v", err)
	}
	return id
}

// creditMerchantWallet gives ownerID a real wallet balance the way a paid payout
// run would (DR settlement standing account, CR user wallet) via the ledger.
func creditMerchantWallet(t *testing.T, ctx context.Context, pool *pgxpool.Pool, led *ledger.Service, ownerID string, amountKobo int64) {
	t.Helper()
	settleAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		t.Fatalf("resolve settlement account: %v", err)
	}
	if err := led.Credit(ctx, ownerID, "seed-earnings:"+ownerID, "seed-earn-"+uuid.New().String(), settleAcc.ID, amountKobo); err != nil {
		t.Fatalf("credit merchant wallet: %v", err)
	}
}

// signedLedgerSum returns the SIGNED sum of all ledger_entries for a reference,
// mirroring the ledger balance projection (CREDIT/REVERSAL_DEBIT = +amount,
// DEBIT/REVERSAL_CREDIT = −amount). A BALANCED double-entry nets to exactly 0.
func signedLedgerSum(t *testing.T, ctx context.Context, pool *pgxpool.Pool, reference string) int64 {
	t.Helper()
	const q = `
		SELECT COALESCE(SUM(
			CASE WHEN type IN ('CREDIT','REVERSAL_DEBIT') THEN amount_kobo ELSE -amount_kobo END
		), 0)
		FROM ledger_entries WHERE reference = $1`
	var sum int64
	if err := pool.QueryRow(ctx, q, reference).Scan(&sum); err != nil {
		t.Fatalf("signed ledger sum for %q: %v", reference, err)
	}
	return sum
}

// netPostedForReference returns the SIGNED amount posted to ONE account by the
// balanced pair carrying reference.
//
// Prefer this over a before/after balance delta on any standing account.
// Standing accounts are singletons keyed by type (finance/ledger/service.go):
// settlement and the failed-transfer suspense account are shared by the entire
// database, and `go test ./...` runs packages in parallel with nine live-DB
// suites posting to settlement. A delta measured across a call therefore also
// measures whatever every other suite did in that window — which is exactly how
// tests/edtechfees came to report "settlement account rose by -4900000 on apply,
// want 100000" while the transfer under test was perfectly correct.
//
// Scoping to this operation's own reference is exact and cannot be perturbed by
// concurrent work.
func netPostedForReference(t *testing.T, ctx context.Context, pool *pgxpool.Pool, accountID, reference string) int64 {
	t.Helper()
	const q = `
		SELECT COALESCE(SUM(
			CASE WHEN type IN ('CREDIT','REVERSAL_DEBIT') THEN amount_kobo ELSE -amount_kobo END
		), 0)
		FROM ledger_entries WHERE account_id = $1 AND reference = $2`
	var amt int64
	if err := pool.QueryRow(ctx, q, accountID, reference).Scan(&amt); err != nil {
		t.Fatalf("net posted to %s for reference %q: %v", accountID, reference, err)
	}
	return amt
}

func withdrawalRowCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ownerID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM restaurant_withdrawals WHERE user_id=$1`, ownerID).Scan(&n); err != nil {
		t.Fatalf("count withdrawals: %v", err)
	}
	return n
}

// ---------------------------------------------------------------------------
// 1. Balanced-post invariant + Noop executes nothing.
// ---------------------------------------------------------------------------

// TestLiveDB_Withdrawal_RequestPostsOneBalancedReserve_NoopExecutesNothing proves
// the core money invariant: a withdrawal reserve is ONE balanced ledger post
// (DR merchant wallet == CR suspense, reference nets to 0), the wallet falls by
// EXACTLY the amount, the row rests at 'processing', and the Noop disburser moved
// no real money (Executed=false, no provider reference).
func TestLiveDB_Withdrawal_RequestPostsOneBalancedReserve_NoopExecutesNothing(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	led := newLiveLedgerService(pool)
	svc := newLiveWithdrawalService(pool, led)
	ctx := context.Background()

	owner := seedUser(t, ctx, pool)
	setUserTier(t, ctx, pool, owner, 3) // unlimited
	bankID := seedMerchantBankAccount(t, ctx, pool, owner)
	creditMerchantWallet(t, ctx, pool, led, owner, 10_000_00) // ₦10,000

	balBefore, err := led.GetBalance(ctx, owner)
	if err != nil {
		t.Fatalf("wallet balance before: %v", err)
	}
	suspAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountFailedTransferSusp)
	if err != nil {
		t.Fatalf("resolve suspense account: %v", err)
	}

	const amount = int64(4_000_00) // ₦4,000
	key := newIdemKey(t, "rwithdraw")
	w, err := svc.RequestWithdrawal(ctx, owner, restaurant.RequestWithdrawalInput{
		AmountKobo:     amount,
		BankAccountID:  bankID,
		IdempotencyKey: key,
	})
	if err != nil {
		t.Fatalf("RequestWithdrawal: %v", err)
	}
	if w.Status != restaurant.WithdrawalStatusProcessing {
		t.Fatalf("status = %s, want processing (Noop executes nothing → funds reserved)", w.Status)
	}
	if w.LedgerRef == nil || *w.LedgerRef == "" {
		t.Fatalf("ledger_ref not stamped on the withdrawal")
	}
	if w.ProviderReference != nil && *w.ProviderReference != "" {
		t.Errorf("provider_reference = %v, want empty (no real disbursement executed yet)", *w.ProviderReference)
	}

	// Exactly ONE balanced pair (DR + CR = 2 rows) for the reserve reference…
	if got := ledgerEntryCount(t, ctx, pool, *w.LedgerRef); got != 2 {
		t.Fatalf("ledger_entries for %s = %d, want 2 (one balanced DR/CR reserve pair)", *w.LedgerRef, got)
	}
	// …and it NETS TO ZERO — debit equals credit (the balanced invariant).
	if s := signedLedgerSum(t, ctx, pool, *w.LedgerRef); s != 0 {
		t.Errorf("signed ledger sum for %s = %d, want 0 (DR must equal CR — balanced)", *w.LedgerRef, s)
	}

	// The merchant wallet fell by EXACTLY the amount; the suspense rose by exactly it.
	balAfter, err := led.GetBalance(ctx, owner)
	if err != nil {
		t.Fatalf("wallet balance after: %v", err)
	}
	if balBefore-balAfter != amount {
		t.Errorf("wallet debited %d, want exactly %d", balBefore-balAfter, amount)
	}
	if got := netPostedForReference(t, ctx, pool, suspAcc.ID, *w.LedgerRef); got != amount {
		t.Errorf("suspense credited %d, want exactly %d (funds reserved, not sent)", got, amount)
	}
}

// ---------------------------------------------------------------------------
// 2. Idempotent replay — same key posts NO second ledger move.
// ---------------------------------------------------------------------------

func TestLiveDB_Withdrawal_IdempotentReplay_NoSecondMove(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	led := newLiveLedgerService(pool)
	svc := newLiveWithdrawalService(pool, led)
	ctx := context.Background()

	owner := seedUser(t, ctx, pool)
	setUserTier(t, ctx, pool, owner, 3)
	bankID := seedMerchantBankAccount(t, ctx, pool, owner)
	creditMerchantWallet(t, ctx, pool, led, owner, 10_000_00)

	const amount = int64(3_000_00)
	key := newIdemKey(t, "rwithdraw-idem")

	first, err := svc.RequestWithdrawal(ctx, owner, restaurant.RequestWithdrawalInput{AmountKobo: amount, BankAccountID: bankID, IdempotencyKey: key})
	if err != nil {
		t.Fatalf("first RequestWithdrawal: %v", err)
	}
	balAfterFirst, _ := led.GetBalance(ctx, owner)

	// Replay with the SAME key — must return the SAME withdrawal and move no money.
	second, err := svc.RequestWithdrawal(ctx, owner, restaurant.RequestWithdrawalInput{AmountKobo: amount, BankAccountID: bankID, IdempotencyKey: key})
	if err != nil {
		t.Fatalf("replay RequestWithdrawal: %v", err)
	}
	if second.ID != first.ID {
		t.Errorf("replay returned a different withdrawal id %s, want %s (idempotent)", second.ID, first.ID)
	}
	if !second.AlreadyProcessed {
		t.Errorf("replay AlreadyProcessed = false, want true")
	}
	if n := withdrawalRowCount(t, ctx, pool, owner); n != 1 {
		t.Errorf("withdrawal rows = %d, want 1 (replay must not create a second row)", n)
	}
	if got := ledgerEntryCount(t, ctx, pool, *first.LedgerRef); got != 2 {
		t.Errorf("ledger_entries after replay = %d, want still 2 (no second move — merchant not double-debited)", got)
	}
	balAfterReplay, _ := led.GetBalance(ctx, owner)
	if balAfterReplay != balAfterFirst {
		t.Errorf("wallet balance changed on replay: %d -> %d, want unchanged", balAfterFirst, balAfterReplay)
	}
}

// ---------------------------------------------------------------------------
// 3. Insufficient balance — fail-closed (no row, no ledger move).
// ---------------------------------------------------------------------------

func TestLiveDB_Withdrawal_InsufficientBalance_FailsClosed(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	led := newLiveLedgerService(pool)
	svc := newLiveWithdrawalService(pool, led)
	ctx := context.Background()

	owner := seedUser(t, ctx, pool)
	setUserTier(t, ctx, pool, owner, 3)
	bankID := seedMerchantBankAccount(t, ctx, pool, owner)
	creditMerchantWallet(t, ctx, pool, led, owner, 1_000_00) // only ₦1,000

	balBefore, _ := led.GetBalance(ctx, owner)

	_, err := svc.RequestWithdrawal(ctx, owner, restaurant.RequestWithdrawalInput{
		AmountKobo:     5_000_00, // ask ₦5,000 > ₦1,000 available
		BankAccountID:  bankID,
		IdempotencyKey: newIdemKey(t, "rwithdraw-insufficient"),
	})
	if !errors.Is(err, ledger.ErrInsufficientFunds) {
		t.Fatalf("RequestWithdrawal error = %v, want ledger.ErrInsufficientFunds (fail-closed)", err)
	}
	if n := withdrawalRowCount(t, ctx, pool, owner); n != 0 {
		t.Errorf("withdrawal rows = %d, want 0 (a rejected request must persist nothing)", n)
	}
	balAfter, _ := led.GetBalance(ctx, owner)
	if balAfter != balBefore {
		t.Errorf("wallet balance moved on a rejected withdrawal: %d -> %d, want unchanged", balBefore, balAfter)
	}
}

// ---------------------------------------------------------------------------
// 4. Owner-scoping — cannot withdraw to another owner's bank account.
// ---------------------------------------------------------------------------

func TestLiveDB_Withdrawal_OwnerScoped_ForeignBankAccountRejected(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	led := newLiveLedgerService(pool)
	svc := newLiveWithdrawalService(pool, led)
	ctx := context.Background()

	owner := seedUser(t, ctx, pool)
	other := seedUser(t, ctx, pool)
	setUserTier(t, ctx, pool, owner, 3)
	creditMerchantWallet(t, ctx, pool, led, owner, 10_000_00)
	foreignBank := seedMerchantBankAccount(t, ctx, pool, other) // belongs to `other`

	_, err := svc.RequestWithdrawal(ctx, owner, restaurant.RequestWithdrawalInput{
		AmountKobo:     2_000_00,
		BankAccountID:  foreignBank,
		IdempotencyKey: newIdemKey(t, "rwithdraw-foreign"),
	})
	if !errors.Is(err, restaurant.ErrWithdrawNoBankAccount) {
		t.Fatalf("RequestWithdrawal error = %v, want ErrWithdrawNoBankAccount (owner-scoped)", err)
	}
	if n := withdrawalRowCount(t, ctx, pool, owner); n != 0 {
		t.Errorf("withdrawal rows = %d, want 0 (foreign-account request must persist nothing)", n)
	}

	// And ListWithdrawals never leaks another owner's rows.
	list, err := svc.ListWithdrawals(ctx, owner, 50)
	if err != nil {
		t.Fatalf("ListWithdrawals: %v", err)
	}
	for _, w := range list {
		if w.UserID != owner {
			t.Errorf("ListWithdrawals returned a row for %s, want only %s", w.UserID, owner)
		}
	}
}

// ---------------------------------------------------------------------------
// 5. Tier-limit — fail-closed (Tier 0 wallet disabled → blocked).
// ---------------------------------------------------------------------------

func TestLiveDB_Withdrawal_TierLimit_FailsClosed(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	led := newLiveLedgerService(pool)
	svc := newLiveWithdrawalService(pool, led)
	ctx := context.Background()

	owner := seedUser(t, ctx, pool)
	setUserTier(t, ctx, pool, owner, 0) // Tier 0 — wallet disabled
	bankID := seedMerchantBankAccount(t, ctx, pool, owner)
	creditMerchantWallet(t, ctx, pool, led, owner, 10_000_00) // has funds, but tier blocks

	balBefore, _ := led.GetBalance(ctx, owner)

	_, err := svc.RequestWithdrawal(ctx, owner, restaurant.RequestWithdrawalInput{
		AmountKobo:     2_000_00,
		BankAccountID:  bankID,
		IdempotencyKey: newIdemKey(t, "rwithdraw-tier0"),
	})
	if err == nil {
		t.Fatalf("RequestWithdrawal succeeded for a Tier 0 wallet, want a fail-closed tier error")
	}
	if !errors.Is(err, tiers.ErrWalletDisabled) {
		t.Fatalf("RequestWithdrawal error = %v, want tiers.ErrWalletDisabled (fail-closed tier gate)", err)
	}
	if n := withdrawalRowCount(t, ctx, pool, owner); n != 0 {
		t.Errorf("withdrawal rows = %d, want 0 (tier-blocked request persists nothing)", n)
	}
	balAfter, _ := led.GetBalance(ctx, owner)
	if balAfter != balBefore {
		t.Errorf("wallet moved on a tier-blocked withdrawal: %d -> %d, want unchanged", balBefore, balAfter)
	}
}

// ---------------------------------------------------------------------------
// 6. Full lifecycle via the webhook flips: paid drains suspense → clearing;
//    a failed disbursement REVERSES the reserved funds back to the wallet.
// ---------------------------------------------------------------------------

func TestLiveDB_Withdrawal_WebhookPaid_DrainsSuspenseToClearing(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	led := newLiveLedgerService(pool)
	svc := newLiveWithdrawalService(pool, led)
	ctx := context.Background()

	owner := seedUser(t, ctx, pool)
	setUserTier(t, ctx, pool, owner, 3)
	bankID := seedMerchantBankAccount(t, ctx, pool, owner)
	creditMerchantWallet(t, ctx, pool, led, owner, 10_000_00)

	const amount = int64(4_000_00)
	w, err := svc.RequestWithdrawal(ctx, owner, restaurant.RequestWithdrawalInput{AmountKobo: amount, BankAccountID: bankID, IdempotencyKey: newIdemKey(t, "rwithdraw-paid")})
	if err != nil {
		t.Fatalf("RequestWithdrawal: %v", err)
	}
	walletAfterReserve, _ := led.GetBalance(ctx, owner)

	paid, err := svc.MarkWithdrawalPaid(ctx, w.ID, "prov_ref_123", newIdemKey(t, "rwithdraw-paid-hook"))
	if err != nil {
		t.Fatalf("MarkWithdrawalPaid: %v", err)
	}
	if paid.Status != restaurant.WithdrawalStatusPaid {
		t.Fatalf("status = %s, want paid", paid.Status)
	}
	if paid.ProviderReference == nil || *paid.ProviderReference != "prov_ref_123" {
		t.Errorf("provider_reference = %v, want prov_ref_123", paid.ProviderReference)
	}
	// The settle leg is balanced (DR suspense → CR provider_clearing) and does NOT
	// touch the wallet again — the money already left the wallet at reserve time.
	if s := signedLedgerSum(t, ctx, pool, *w.LedgerRef+":settle"); s != 0 {
		t.Errorf("settle leg signed sum = %d, want 0 (balanced)", s)
	}
	walletAfterPaid, _ := led.GetBalance(ctx, owner)
	if walletAfterPaid != walletAfterReserve {
		t.Errorf("wallet moved on paid webhook: %d -> %d, want unchanged (settle drains suspense, not wallet)", walletAfterReserve, walletAfterPaid)
	}
}

// TestLiveDB_Withdrawal_ConcurrentPaidAndFailed_MutuallyExclusive is the
// regression test for the ledger-auditor's concurrency finding: a settle (paid)
// and a reversal (failed) processed CONCURRENTLY on the same reserved withdrawal
// must NOT both post — that would be a double-move (platform pays the bank AND
// refunds the wallet). The two transitions serialise on the withdrawal-row
// FOR UPDATE lock, so exactly one wins: exactly one of the {settle, reversal}
// balanced legs is posted, and the wallet ends in exactly one consistent state.
func TestLiveDB_Withdrawal_ConcurrentPaidAndFailed_MutuallyExclusive(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	led := newLiveLedgerService(pool)
	svc := newLiveWithdrawalService(pool, led)
	ctx := context.Background()

	owner := seedUser(t, ctx, pool)
	setUserTier(t, ctx, pool, owner, 3)
	bankID := seedMerchantBankAccount(t, ctx, pool, owner)
	creditMerchantWallet(t, ctx, pool, led, owner, 10_000_00)
	walletStart, _ := led.GetBalance(ctx, owner)

	const amount = int64(4_000_00)
	w, err := svc.RequestWithdrawal(ctx, owner, restaurant.RequestWithdrawalInput{AmountKobo: amount, BankAccountID: bankID, IdempotencyKey: newIdemKey(t, "rwithdraw-race")})
	if err != nil {
		t.Fatalf("RequestWithdrawal: %v", err)
	}
	walletAfterReserve, _ := led.GetBalance(ctx, owner)

	// Fire paid and failed at the same time on the same withdrawal.
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); _, _ = svc.MarkWithdrawalPaid(ctx, w.ID, "prov_race", newIdemKey(t, "hook-paid")) }()
	go func() { defer wg.Done(); _, _ = svc.MarkWithdrawalFailed(ctx, w.ID, "race", newIdemKey(t, "hook-fail")) }()
	wg.Wait()

	// Exactly ONE terminal leg posted (2 rows for the winner's reference, 0 for the loser).
	settleRows := ledgerEntryCount(t, ctx, pool, "rwithdraw:"+w.ID+":settle")
	reversalRows := ledgerEntryCount(t, ctx, pool, "rwithdraw:"+w.ID+":reversal")
	paidWon := settleRows == 2 && reversalRows == 0
	reversedWon := settleRows == 0 && reversalRows == 2
	if !paidWon && !reversedWon {
		t.Fatalf("concurrent paid+failed posted settle=%d reversal=%d rows, want EXACTLY one direction (2/0 or 0/2) — no double-move", settleRows, reversalRows)
	}

	var finalStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM restaurant_withdrawals WHERE id=$1`, w.ID).Scan(&finalStatus); err != nil {
		t.Fatalf("read final status: %v", err)
	}
	walletEnd, _ := led.GetBalance(ctx, owner)
	if paidWon {
		if finalStatus != restaurant.WithdrawalStatusPaid {
			t.Errorf("settle won but status=%s, want paid", finalStatus)
		}
		if walletEnd != walletAfterReserve {
			t.Errorf("paid: wallet=%d, want %d (money stayed out; settle must not touch the wallet)", walletEnd, walletAfterReserve)
		}
	} else {
		if finalStatus != restaurant.WithdrawalStatusReversed {
			t.Errorf("reversal won but status=%s, want reversed", finalStatus)
		}
		if walletEnd != walletStart {
			t.Errorf("reversed: wallet=%d, want %d (funds fully restored, exactly once)", walletEnd, walletStart)
		}
	}
}

func TestLiveDB_Withdrawal_WebhookFailed_ReversesFundsToWallet(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	led := newLiveLedgerService(pool)
	svc := newLiveWithdrawalService(pool, led)
	ctx := context.Background()

	owner := seedUser(t, ctx, pool)
	setUserTier(t, ctx, pool, owner, 3)
	bankID := seedMerchantBankAccount(t, ctx, pool, owner)
	creditMerchantWallet(t, ctx, pool, led, owner, 10_000_00)
	walletStart, _ := led.GetBalance(ctx, owner)

	const amount = int64(4_000_00)
	w, err := svc.RequestWithdrawal(ctx, owner, restaurant.RequestWithdrawalInput{AmountKobo: amount, BankAccountID: bankID, IdempotencyKey: newIdemKey(t, "rwithdraw-fail")})
	if err != nil {
		t.Fatalf("RequestWithdrawal: %v", err)
	}

	failed, err := svc.MarkWithdrawalFailed(ctx, w.ID, "bank rejected", newIdemKey(t, "rwithdraw-fail-hook"))
	if err != nil {
		t.Fatalf("MarkWithdrawalFailed: %v", err)
	}
	if failed.Status != restaurant.WithdrawalStatusReversed {
		t.Fatalf("status = %s, want reversed (funds returned to wallet)", failed.Status)
	}
	// The reversal restored the wallet to its starting balance — no funds lost.
	walletEnd, _ := led.GetBalance(ctx, owner)
	if walletEnd != walletStart {
		t.Errorf("wallet after reversal = %d, want %d (funds fully restored)", walletEnd, walletStart)
	}
}
