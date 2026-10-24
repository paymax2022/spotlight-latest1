package restaurant

// LIVE-DB regression for FOOD-UAT-F-004: withdrawals had no KYB predicate, so a
// merchant whose KYB was rejected/revoked could still reserve and settle wallet
// money. Skipped unless TEST_DATABASE_URL is set.

import (
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestLiveDB_Withdrawal_KYBGate(t *testing.T) {
	pool := withdrawalPool(t)
	defer pool.Close()
	ctx := t.Context()

	// (a) approved owner can request.
	svc, _, owner, bank := withdrawalFixture(t, ctx, pool, 500_000)
	if _, err := svc.RequestWithdrawal(ctx, owner, RequestWithdrawalInput{
		AmountKobo: 100_000, BankAccountID: bank, IdempotencyKey: "wd-kyb-ok-" + uuid.New().String(),
	}); err != nil {
		t.Fatalf("approved-KYB owner must be able to withdraw: %v", err)
	}

	// (b) owner whose KYB is rejected cannot, and nothing is reserved.
	svc2, _, owner2, bank2 := withdrawalFixture(t, ctx, pool, 500_000)
	if _, err := pool.Exec(ctx, `UPDATE restaurants SET kyb_status='rejected' WHERE owner_id=$1`, owner2); err != nil {
		t.Fatal(err)
	}
	key := "wd-kyb-rej-" + uuid.New().String()
	_, err := svc2.RequestWithdrawal(ctx, owner2, RequestWithdrawalInput{AmountKobo: 100_000, BankAccountID: bank2, IdempotencyKey: key})
	if !errors.Is(err, ErrKYBNotApproved) {
		t.Fatalf("rejected-KYB owner: want ErrKYBNotApproved, got %v", err)
	}
	if got := withdrawalErrStatus(err); got != 403 {
		t.Fatalf("http status = %d, want 403", got)
	}
	if n := reserveLegs(t, ctx, pool, key); n != 0 {
		t.Fatalf("reserve legs posted despite KYB refusal: %d", n)
	}

	// (c) KYB revoked between request and mark-paid: clean refusal, request stays
	// processing with the reserve intact, and mark-failed still reverses it.
	svc3, _, owner3, bank3 := withdrawalFixture(t, ctx, pool, 500_000)
	w, err := svc3.RequestWithdrawal(ctx, owner3, RequestWithdrawalInput{
		AmountKobo: 100_000, BankAccountID: bank3, IdempotencyKey: "wd-kyb-rev-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE restaurants SET kyb_status='rejected' WHERE owner_id=$1`, owner3); err != nil {
		t.Fatal(err)
	}
	if _, err := svc3.MarkWithdrawalPaid(ctx, w.ID, "prov-ref", ""); !errors.Is(err, ErrKYBNotApproved) {
		t.Fatalf("mark-paid after revoke: want ErrKYBNotApproved, got %v", err)
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM restaurant_withdrawals WHERE id=$1`, w.ID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != string(WithdrawalStatusProcessing) {
		t.Fatalf("status after refused mark-paid = %q, want processing", status)
	}
	if n := reserveLegs(t, ctx, pool, w.IdempotencyKey); n != 2 {
		t.Fatalf("reserve legs = %d, want 2 (intact)", n)
	}
	if _, err := svc3.MarkWithdrawalFailed(ctx, w.ID, "kyb revoked", ""); err != nil {
		t.Fatalf("mark-failed must still reverse a revoked-KYB request: %v", err)
	}
}
