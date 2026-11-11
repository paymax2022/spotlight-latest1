package restaurant

// LIVE-DB tests for the wallet → ANY account payout destination (KYB no longer
// collects a settlement account, so the withdrawal lane takes the destination at
// request time). What these pin:
//  1. An ad-hoc destination (bank_code + account_number + PIN) is captured through
//     the same AddBankAccount path as a saved account — step-up, bank name-enquiry,
//     name-match verdict, audit — and then pays out with ONE balanced reserve.
//  2. The anti-fraud controls still gate the money: a destination the bank refuses
//     to confirm (is_verified=false) moves nothing, and so does one with no PIN.
//  3. Exactly one of {saved account, ad-hoc destination} is required.
//  4. The disbursement adapter is told WHERE the money goes (it could not be paid
//     correctly without the recipient triple).
// Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/provider"
)

// recordingDisburser captures the outbound instruction handed to the adapter.
type recordingDisburser struct {
	req   WithdrawalDisburseRequest
	calls int
}

func (r *recordingDisburser) Disburse(_ context.Context, req WithdrawalDisburseRequest) (WithdrawalDisburseResult, error) {
	r.calls++
	r.req = req
	return WithdrawalDisburseResult{Executed: false}, nil
}

// failingResolver is a name-enquiry that cannot confirm the account — the soft-fail
// path that leaves a destination is_verified=false and therefore unable to receive money.
type failingResolver struct{ provider.DisbursementProvider }

func (failingResolver) ResolveAccount(context.Context, string, string) (*provider.AccountResolution, error) {
	return nil, errors.New("bank name-enquiry unavailable")
}

func TestRequestWithdrawal_AdHocDestinationPaysAnyAccount(t *testing.T) {
	pool := withdrawalPool(t)
	defer pool.Close()
	ctx := context.Background()

	svc, led, merchant, savedID := withdrawalFixture(t, ctx, pool, 1_000_00) // ₦1,000
	rec := &recordingDisburser{}
	svc.WithDisbursementProvider(fakeNameResolver{holder: "MERCHANT TEST"}).WithDisburser(rec)

	before, err := led.GetBalance(ctx, merchant)
	if err != nil {
		t.Fatalf("balance before: %v", err)
	}

	// A destination this merchant has never saved, supplied on the request itself.
	const acctNo = "0246813579"
	idem := "wd-adhoc-" + uuid.New().String()
	w, err := svc.RequestWithdrawal(ctx, merchant, RequestWithdrawalInput{
		AmountKobo: 40_000, BankCode: "057", AccountNumber: acctNo, PIN: "1234", IdempotencyKey: idem,
	})
	if err != nil {
		t.Fatalf("RequestWithdrawal to an ad-hoc destination: %v", err)
	}
	if w.Status != WithdrawalStatusProcessing {
		t.Errorf("status = %q, want processing", w.Status)
	}
	if w.BankAccountID == savedID {
		t.Error("withdrawal paid the fixture's saved account, not the requested destination")
	}

	var destID string
	if err := pool.QueryRow(ctx,
		`SELECT id FROM restaurant_bank_accounts WHERE user_id=$1 AND bank_code=$2 AND account_number=$3`,
		merchant, "057", acctNo).Scan(&destID); err != nil {
		t.Fatalf("the ad-hoc destination was not captured as a payout account: %v", err)
	}
	if w.BankAccountID != destID {
		t.Errorf("withdrawal bank_account_id = %s, want the captured destination %s", w.BankAccountID, destID)
	}

	// The bank's answer, not the caller's label, is what gets stored and checked.
	var verified bool
	var holder string
	if err := pool.QueryRow(ctx,
		`SELECT is_verified, account_name FROM restaurant_bank_accounts WHERE id=$1`, destID).
		Scan(&verified, &holder); err != nil {
		t.Fatal(err)
	}
	if !verified {
		t.Error("a destination that failed name-enquiry must not be able to receive money")
	}
	if holder != "MERCHANT TEST" {
		t.Errorf("stored holder name = %q, want the name-enquiry result", holder)
	}

	if n := reserveLegs(t, ctx, pool, idem); n != 2 {
		t.Errorf("%d ledger legs posted, want 2 (balanced debit/credit)", n)
	}
	after, err := led.GetBalance(ctx, merchant)
	if err != nil {
		t.Fatalf("balance after: %v", err)
	}
	if want := before - 40_000; after != want {
		t.Errorf("wallet balance = %d, want %d", after, want)
	}

	if rec.calls != 1 {
		t.Fatalf("%d disburse calls, want 1", rec.calls)
	}
	if rec.req.BankCode != "057" || rec.req.AccountNumber != acctNo || rec.req.AccountName != "MERCHANT TEST" {
		t.Errorf("the adapter was not told where the money goes: %+v", rec.req)
	}
}

// FOOD-UAT-B-003 still applies to a destination supplied at request time: the bank
// must confirm it before any kobo moves.
func TestRequestWithdrawal_AdHocDestinationUnverifiedRefused(t *testing.T) {
	pool := withdrawalPool(t)
	defer pool.Close()
	ctx := context.Background()

	svc, led, merchant, _ := withdrawalFixture(t, ctx, pool, 1_000_00)
	svc.WithDisbursementProvider(failingResolver{})

	before, err := led.GetBalance(ctx, merchant)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	idem := "wd-adhoc-unverified-" + uuid.New().String()
	_, err = svc.RequestWithdrawal(ctx, merchant, RequestWithdrawalInput{
		AmountKobo: 40_000, BankCode: "057", AccountNumber: "1357924680", PIN: "1234", IdempotencyKey: idem,
	})
	if !errors.Is(err, ErrBankAccountUnverified) {
		t.Fatalf("err = %v, want ErrBankAccountUnverified", err)
	}
	after, err := led.GetBalance(ctx, merchant)
	if err != nil {
		t.Fatalf("balance after: %v", err)
	}
	if after != before {
		t.Errorf("wallet moved %d kobo for a refused withdrawal", before-after)
	}
	if n := reserveLegs(t, ctx, pool, idem); n != 0 {
		t.Errorf("%d ledger legs posted for a refused withdrawal, want 0", n)
	}
}

// FOOD-UAT-B-002: choosing a payout destination is a takeover vector, so an ad-hoc
// one needs the transaction PIN and writes nothing when it is missing.
func TestRequestWithdrawal_AdHocDestinationRequiresPin(t *testing.T) {
	pool := withdrawalPool(t)
	defer pool.Close()
	ctx := context.Background()

	svc, led, merchant, _ := withdrawalFixture(t, ctx, pool, 1_000_00)
	svc.WithDisbursementProvider(fakeNameResolver{holder: "MERCHANT TEST"})

	before, err := led.GetBalance(ctx, merchant)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	const acctNo = "2468135790"
	idem := "wd-adhoc-nopin-" + uuid.New().String()
	_, err = svc.RequestWithdrawal(ctx, merchant, RequestWithdrawalInput{
		AmountKobo: 40_000, BankCode: "057", AccountNumber: acctNo, IdempotencyKey: idem,
	})
	if !errors.Is(err, ErrStepUpRequired) {
		t.Fatalf("err = %v, want ErrStepUpRequired", err)
	}
	after, err := led.GetBalance(ctx, merchant)
	if err != nil {
		t.Fatalf("balance after: %v", err)
	}
	if after != before {
		t.Errorf("wallet moved without a PIN, want untouched")
	}
	if n := reserveLegs(t, ctx, pool, idem); n != 0 {
		t.Errorf("%d ledger legs posted without a PIN, want 0", n)
	}
	var rows int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM restaurant_bank_accounts WHERE user_id=$1 AND account_number=$2`,
		merchant, acctNo).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 0 {
		t.Errorf("%d payout destinations written without a PIN", rows)
	}
}

func TestRequestWithdrawal_DestinationIsSavedAccountOrAdHocNotBoth(t *testing.T) {
	pool := withdrawalPool(t)
	defer pool.Close()
	ctx := context.Background()

	svc, led, merchant, savedID := withdrawalFixture(t, ctx, pool, 1_000_00)
	before, err := led.GetBalance(ctx, merchant)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}

	cases := map[string]RequestWithdrawalInput{
		"neither":           {AmountKobo: 40_000, PIN: "1234", IdempotencyKey: "wd-dest-none-" + uuid.New().String()},
		"both":              {AmountKobo: 40_000, BankAccountID: savedID, BankCode: "057", AccountNumber: "1122334455", PIN: "1234", IdempotencyKey: "wd-dest-both-" + uuid.New().String()},
		"account no number": {AmountKobo: 40_000, BankCode: "057", PIN: "1234", IdempotencyKey: "wd-dest-partial-" + uuid.New().String()},
		"number no account": {AmountKobo: 40_000, AccountNumber: "1122334455", PIN: "1234", IdempotencyKey: "wd-dest-partial2-" + uuid.New().String()},
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := svc.RequestWithdrawal(ctx, merchant, in)
			if !errors.Is(err, ErrWithdrawBadDestination) {
				t.Fatalf("err = %v, want ErrWithdrawBadDestination", err)
			}
			if n := reserveLegs(t, ctx, pool, in.IdempotencyKey); n != 0 {
				t.Errorf("%d ledger legs posted for a malformed request, want 0", n)
			}
		})
	}
	after, err := led.GetBalance(ctx, merchant)
	if err != nil {
		t.Fatalf("balance after: %v", err)
	}
	if after != before {
		t.Errorf("wallet balance changed from %d to %d on rejected requests", before, after)
	}
}

// An ad-hoc destination is captured once, not per attempt: a replay of the same
// Idempotency-Key must not reserve twice nor re-write the destination row.
func TestRequestWithdrawal_AdHocDestinationReplayIsSafeNoOp(t *testing.T) {
	pool := withdrawalPool(t)
	defer pool.Close()
	ctx := context.Background()

	svc, led, merchant, _ := withdrawalFixture(t, ctx, pool, 1_000_00)
	svc.WithDisbursementProvider(fakeNameResolver{holder: "MERCHANT TEST"})

	const acctNo = "3579135790"
	idem := "wd-adhoc-replay-" + uuid.New().String()
	in := RequestWithdrawalInput{AmountKobo: 40_000, BankCode: "057", AccountNumber: acctNo, PIN: "1234", IdempotencyKey: idem}
	first, err := svc.RequestWithdrawal(ctx, merchant, in)
	if err != nil {
		t.Fatalf("first request: %v", err)
	}
	second, err := svc.RequestWithdrawal(ctx, merchant, in)
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if !second.AlreadyProcessed {
		t.Error("replay reported a fresh reserve")
	}
	if second.ID != first.ID {
		t.Errorf("replay returned withdrawal %s, want the original %s", second.ID, first.ID)
	}
	if n := reserveLegs(t, ctx, pool, idem); n != 2 {
		t.Errorf("%d ledger legs after a replay, want 2 (one balanced reserve)", n)
	}
	var rows int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM restaurant_bank_accounts WHERE user_id=$1 AND account_number=$2`,
		merchant, acctNo).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 1 {
		t.Errorf("%d destination rows for one account number, want 1", rows)
	}
	// One reserve, so exactly one 400.00 debit off the ₦1,000 the fixture funded.
	if bal, berr := led.GetBalance(ctx, merchant); berr != nil {
		t.Fatalf("balance: %v", berr)
	} else if want := int64(1_000_00) - 40_000; bal != want {
		t.Errorf("wallet balance = %d after a replay, want %d", bal, want)
	}
}

// The HTTP surface must classify a bad destination as the caller's mistake and an
// unwired step-up as the deployment's, not as a missing account.
func TestWithdrawalErrStatus_AdHocDestination(t *testing.T) {
	want := map[error]int{
		ErrWithdrawBadDestination: http.StatusBadRequest,
		ErrStepUpRequired:         http.StatusBadRequest,
		ErrStepUpFailed:           http.StatusForbidden,
		ErrStepUpUnavailable:      http.StatusServiceUnavailable,
		ErrBankAccountUnverified:  http.StatusBadRequest,
	}
	for err, status := range want {
		// Wrapped the way RequestWithdrawal returns it, through AddBankAccount.
		got := withdrawalErrStatus(fmt.Errorf("capture payout destination: %w", err))
		if got != status {
			t.Errorf("withdrawalErrStatus(%v) = %d, want %d", err, got, status)
		}
	}
}
