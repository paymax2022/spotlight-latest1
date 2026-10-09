package transfers

// Live-DB regression tests for the settle/reverse funding-state defects:
//
//   - PHANTOM REFUND: a bank-source transfer at awaiting_funding never
//     collected any money — no fund leg has posted, suspense holds nothing for
//     it. AdminReverse / a settle webhook on that row used to post the full
//     REVERSAL pair anyway: REVERSAL_DEBIT minting amount+fee into
//     provider_clearing (the provider never collected it) and REVERSAL_CREDIT
//     draining a suspense hold that does not exist. The correct terminal move
//     for an unfunded bank→bank is a bare cancellation — status flip, no legs.
//   - PHANTOM SETTLE: the same row settling 'successful' swept suspense →
//     settlement + fee → revenue for a payout that could never have fired
//     (requirePayoutableStatus refuses awaiting_funding, so no provider call
//     ever ran). Refused outright now.
//   - REFUND+PAYOUT DOUBLE SPEND: AdminReverse on provider_initiated reversed
//     the hold while the fired payout could still land at the provider — the
//     user is refunded AND the recipient is paid. provider_initiated now goes
//     through reconcileFiredLeg: only a provider-confirmed failure settles the
//     reversal; anything else is ErrPayoutAlreadyFired.
//   - IN-FLIGHT RACE: AdminReverse ran without the per-transfer payout-leg
//     claim, so it could CAS a row to reversed while a provider call was
//     mid-flight — the payout then landed on a refunded row. The reverse now
//     claims the same lock: a held lock answers ErrPayoutLegInFlight (409).
//
// Bring-up: TEST_DATABASE_URL only — see atomicity_live_db_test.go.

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/provider"
)

// seedInitiatedTransfer seeds a wallet-source bank_transfers row at
// provider_initiated with a provider_transfer_ref to reconcile against.
func seedInitiatedTransfer(t *testing.T, svc *Service, pool *pgxpool.Pool, ctx context.Context, userID string) *BankTransfer {
	t.Helper()
	bt := seedBankTransfer(t, ctx, pool, svc, userID, string(BankTransferProviderInitiated), string(SourceWallet), 500_000, 1_000)
	ref := "paystack_trf_w10-xfer-" + uuid.New().String()[:8]
	if _, err := pool.Exec(ctx, `UPDATE bank_transfers SET provider_transfer_ref=$1, provider_transfer_code=$1 WHERE id=$2`, ref, bt.ID); err != nil {
		t.Fatalf("set provider ref: %v", err)
	}
	fresh, err := svc.getBankTransfer(ctx, bt.ID)
	if err != nil {
		t.Fatalf("re-read: %v", err)
	}
	return fresh
}

// TestLiveDB_AdminReverse_UnfundedBankToBankCancelsWithoutLegs: reversing a
// bank→bank row that never collected pay-in must flip status to reversed and
// post NO ledger entries — there is no hold to refund.
func TestLiveDB_AdminReverse_UnfundedBankToBankCancelsWithoutLegs(t *testing.T) {
	pool := liveDBPool(t)
	ctx := context.Background()
	led := newLiveLedgerService(pool)
	svc := NewService(pool, led, tiers.NewService(pool), nil, mockRegistry())
	userID := seedUser(t, ctx, pool)

	bt := seedBankTransfer(t, ctx, pool, svc, userID, string(BankTransferAwaitingFunding), string(SourceBank), 900_000, 2_500)

	got, err := svc.AdminReverse(ctx, bt.ID, userID)
	if err != nil {
		t.Fatalf("AdminReverse on unfunded bank→bank: %v", err)
	}
	if got.Status != BankTransferReversed {
		t.Fatalf("status = %s, want reversed (cancellation)", got.Status)
	}
	if n := countEntries(t, ctx, pool, bt.Reference); n != 0 {
		t.Fatalf("unfunded reversal posted %d ledger entries, want 0 — nothing was collected to refund", n)
	}
}

// TestLiveDB_SettleSuccessful_UnfundedBankToBankRefused: a 'successful'
// terminal settle on awaiting_funding can only be a misrouted webhook — the
// payout leg could not have fired (the pay-in never arrived). It must fail
// closed: error, status untouched, no suspense sweep minted.
func TestLiveDB_SettleSuccessful_UnfundedBankToBankRefused(t *testing.T) {
	pool := liveDBPool(t)
	ctx := context.Background()
	led := newLiveLedgerService(pool)
	svc := NewService(pool, led, tiers.NewService(pool), nil, nil)
	userID := seedUser(t, ctx, pool)

	bt := seedBankTransfer(t, ctx, pool, svc, userID, string(BankTransferAwaitingFunding), string(SourceBank), 900_000, 2_500)

	if err := svc.settleTransfer(ctx, bt, BankTransferSuccessful); err == nil {
		t.Fatal("settling an unfunded bank→bank transfer successful must be refused")
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM bank_transfers WHERE id=$1`, bt.ID).Scan(&status); err != nil {
		t.Fatalf("read status: %v", err)
	}
	if status != string(BankTransferAwaitingFunding) {
		t.Fatalf("status = %s, want awaiting_funding (refused settle must not flip it)", status)
	}
	if n := countEntries(t, ctx, pool, bt.Reference); n != 0 {
		t.Fatalf("refused settle posted %d ledger entries, want 0", n)
	}
}

// TestLiveDB_SettleFailed_FundedBankToBankStillReverses is the other half: once
// the collection leg DID post (status funded), a terminal failure must still
// refund — REVERSAL_DEBIT to provider_clearing, REVERSAL_CREDIT draining
// suspense.
func TestLiveDB_SettleFailed_FundedBankToBankStillReverses(t *testing.T) {
	pool := liveDBPool(t)
	ctx := context.Background()
	led := newLiveLedgerService(pool)
	svc := NewService(pool, led, tiers.NewService(pool), nil, nil) // nil registry — auto leg is a no-op
	userID := seedUser(t, ctx, pool)

	bt := seedBankTransfer(t, ctx, pool, svc, userID, string(BankTransferAwaitingFunding), string(SourceBank), 600_000, 1_000)
	if err := svc.markFunded(ctx, bt, bt.Status); err != nil {
		t.Fatalf("markFunded: %v", err)
	}
	fresh, err := svc.getBankTransfer(ctx, bt.ID)
	if err != nil {
		t.Fatalf("re-read: %v", err)
	}
	if err := svc.settleTransfer(ctx, fresh, BankTransferFailed); err != nil {
		t.Fatalf("settleTransfer failed: %v", err)
	}
	revKey := fresh.IdempotencyKey + ":reversal:" + string(BankTransferFailed)
	for _, k := range []string{revKey + ":rev_debit", revKey + ":rev_credit"} {
		if !entryExists(t, ctx, pool, k) {
			t.Fatalf("expected reversal entry %s on a FUNDED bank→bank failure", k)
		}
	}
	// fund pair (2) + reversal pair (2) = 4 entries under the reference.
	if n := countEntries(t, ctx, pool, fresh.Reference); n != 4 {
		t.Fatalf("entries for reference = %d, want 4", n)
	}
}

// TestLiveDB_AdminReverse_ProviderInitiated verifies the fired-payout guard:
// AdminReverse must never blindly refund a transfer whose payout already
// reached the provider — only a provider-confirmed failure may settle.
func TestLiveDB_AdminReverse_ProviderInitiated(t *testing.T) {
	t.Run("provider confirms failure → reversal settles, no re-fire", func(t *testing.T) {
		pool := liveDBPool(t)
		ctx := context.Background()
		led := newLiveLedgerService(pool)
		rec := &recordingProvider{name: "paystack", transferStatus: &provider.PayoutStatus{Status: "failed"}}
		svc := NewService(pool, led, tiers.NewService(pool), nil, recordingRegistry(rec))
		userID := seedUser(t, ctx, pool)
		bt := seedInitiatedTransfer(t, svc, pool, ctx, userID)

		got, err := svc.AdminReverse(ctx, bt.ID, userID)
		if err != nil {
			t.Fatalf("AdminReverse on provider-confirmed failure: %v", err)
		}
		if got.Status != BankTransferFailed && got.Status != BankTransferReversed {
			t.Fatalf("status = %s, want a terminal refund state", got.Status)
		}
		if rec.payoutCalls() != 0 || rec.recipientCalls() != 0 {
			t.Fatalf("reverse path re-fired the provider: %d/%d calls", rec.recipientCalls(), rec.payoutCalls())
		}
		if rec.statusCalls == 0 {
			t.Fatal("provider status was never queried before the reverse decision")
		}
	})

	t.Run("provider not-confirmed-failed → refuse, no refund legs", func(t *testing.T) {
		for _, st := range []string{"successful", "pending"} {
			pool := liveDBPool(t)
			ctx := context.Background()
			led := newLiveLedgerService(pool)
			rec := &recordingProvider{name: "paystack", transferStatus: &provider.PayoutStatus{Status: st}}
			svc := NewService(pool, led, tiers.NewService(pool), nil, recordingRegistry(rec))
			userID := seedUser(t, ctx, pool)
			bt := seedInitiatedTransfer(t, svc, pool, ctx, userID)

			_, err := svc.AdminReverse(ctx, bt.ID, userID)
			if !errors.Is(err, ErrPayoutAlreadyFired) {
				t.Fatalf("provider status %q → AdminReverse = %v, want ErrPayoutAlreadyFired", st, err)
			}
			var status string
			if err := pool.QueryRow(ctx, `SELECT status FROM bank_transfers WHERE id=$1`, bt.ID).Scan(&status); err != nil {
				t.Fatalf("read status: %v", err)
			}
			if status != string(BankTransferProviderInitiated) {
				t.Fatalf("status = %s, want provider_initiated — refused reverse must not flip it", status)
			}
			if n := countEntries(t, ctx, pool, bt.Reference); n != 0 {
				t.Fatalf("refused reverse posted %d ledger entries, want 0", n)
			}
		}
	})
}

// TestLiveDB_AdminReverse_BlockedWhilePayoutLegInFlight: while a payout leg
// holds the per-transfer advisory lock (provider call mid-flight), AdminReverse
// must refuse 409 — reversing underneath an in-flight payout is the
// refund+payout double spend.
func TestLiveDB_AdminReverse_BlockedWhilePayoutLegInFlight(t *testing.T) {
	pool := liveDBPool(t)
	ctx := context.Background()
	led := newLiveLedgerService(pool)
	svc := NewService(pool, led, tiers.NewService(pool), nil, mockRegistry())
	userID := seedUser(t, ctx, pool)

	bt := seedBankTransfer(t, ctx, pool, svc, userID, string(BankTransferFundsReserved), string(SourceWallet), 500_000, 1_000)

	conn, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatalf("acquire conn: %v", err)
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock(hashtext($1))`, payoutLegLockKey(bt.ID)); err != nil {
		t.Fatalf("advisory lock: %v", err)
	}
	defer func() {
		_, _ = conn.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock(hashtext($1))`, payoutLegLockKey(bt.ID))
	}()

	if _, err := svc.AdminReverse(ctx, bt.ID, userID); !errors.Is(err, ErrPayoutLegInFlight) {
		t.Fatalf("AdminReverse under held leg lock = %v, want ErrPayoutLegInFlight", err)
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM bank_transfers WHERE id=$1`, bt.ID).Scan(&status); err != nil {
		t.Fatalf("read status: %v", err)
	}
	if status != string(BankTransferFundsReserved) {
		t.Fatalf("status = %s, want funds_reserved — refused reverse must not move it", status)
	}
}
