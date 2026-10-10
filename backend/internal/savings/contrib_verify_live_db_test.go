package savings

// LIVE-DB coverage for R-3: AjoService.Contribute used to tolerate
// ledger.ErrDuplicate unconditionally — a bare-lock or foreign claim under
// the leg key then counted the contribution into collected_kobo with zero (or
// the wrong) legs behind it, letting the scheduled payout drain escrow for
// money never collected. verifyContribLeg now proves the durable legs are
// exactly this member's journal before the dup is tolerated (the
// verifyPayoutLegs standard). Pins all three branches: no legs → retryable
// ErrReconPending; foreign legs → ErrDuplicate conflict; identical journal →
// nil.
// SKIPPED whenever TEST_DATABASE_URL is unset.

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/finance/ledger"
)

func TestLiveDB_VerifyContribLeg_Branches(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := &AjoService{db: pool, led: led}

	member := newTestOwner(t, pool)
	setKycTier(t, pool, member, 1) // the planted DebitGated runs the strict in-tx cap
	circleID := uuid.NewString()
	legKey := uuid.NewString() + ":ajo:" + circleID + ":c1:prepay:" + member
	amount := int64(200_000)

	escrow, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		t.Fatalf("escrow account: %v", err)
	}

	// 1) No legs at all → ErrReconPending (retryable — never counted).
	if err := svc.verifyContribLeg(ctx, member, legKey, circleID, escrow.ID, amount); !errors.Is(err, ErrReconPending) {
		t.Fatalf("no legs must answer ErrReconPending, got %v", err)
	}

	// 2) Foreign journal under the leg key (different reference) →
	//    ErrDuplicate-wrapped conflict — never counted as this contribution.
	decoy := newTestOwner(t, pool)
	decoyWallet, err := led.GetOrCreateUserWallet(ctx, decoy)
	if err != nil {
		t.Fatalf("decoy wallet: %v", err)
	}
	if err := led.PostJournal(ctx, ledger.JournalEntry{
		Reference: "foreign:" + circleID, IdempotencyKey: legKey, AmountKobo: amount,
		DebitAccountID: decoyWallet.ID, CreditAccountID: escrow.ID,
	}); err != nil {
		t.Fatalf("plant foreign journal: %v", err)
	}
	if err := svc.verifyContribLeg(ctx, member, legKey, circleID, escrow.ID, amount); !errors.Is(err, ledger.ErrDuplicate) {
		t.Fatalf("foreign legs must answer ErrDuplicate conflict, got %v", err)
	}

	// 3) SUCCESS branch: the exact contribution journal under a fresh key
	//    (member wallet debit → escrow credit, ref "ajo:contrib:<circle>") →
	//    verify returns nil, so the tolerated dup may count it.
	legKey2 := uuid.NewString() + ":ajo:" + circleID + ":c1:prepay:" + member
	if err := led.Credit(ctx, member, "seed", "seed:"+uuid.NewString(), escrow.ID, amount); err != nil {
		t.Fatalf("fund member: %v", err)
	}
	if err := led.DebitGated(ctx, member, "ajo:contrib:"+circleID, legKey2, escrow.ID, amount); err != nil {
		t.Fatalf("plant contribution journal: %v", err)
	}
	if err := svc.verifyContribLeg(ctx, member, legKey2, circleID, escrow.ID, amount); err != nil {
		t.Fatalf("identical durable journal must verify nil, got %v", err)
	}
}
