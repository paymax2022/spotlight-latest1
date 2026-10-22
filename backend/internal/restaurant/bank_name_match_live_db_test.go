package restaurant

// LIVE-DB tests for payout-account name matching (FEATURE_BANK_ACCOUNT_NAME_MATCH):
// a restaurant payout account is only verified when the bank's holder name
// matches the owner's KYC-verified name or an approved KYB legal name; anything
// else is held for review (withdrawals refused) until an admin decides.
// Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/provider"
)

// fakeNameResolver answers name-enquiry with a fixed holder name.
type fakeNameResolver struct {
	provider.DisbursementProvider
	holder string
}

func (f fakeNameResolver) ResolveAccount(_ context.Context, bankCode, acct string) (*provider.AccountResolution, error) {
	return &provider.AccountResolution{AccountName: f.holder, AccountNumber: acct, BankCode: bankCode}, nil
}

// fakeKYCName returns a fixed verified legal name ("" = none) and its strength.
type fakeKYCName struct {
	name   string
	strong bool
}

func (f fakeKYCName) VerifiedLegalName(context.Context, string) (string, bool, bool, error) {
	return f.name, f.strong, f.name != "", nil
}

var strongJohn = fakeKYCName{name: "John Adewale Smith", strong: true}

func addAcct(t *testing.T, ctx context.Context, svc *Service, owner, number string) (*BankAccount, error) {
	t.Helper()
	return svc.AddBankAccount(ctx, owner, AddBankAccountRequest{
		BankName: "Test Bank", BankCode: "057", AccountNumber: number, AccountName: "typed by client", PIN: "1234",
	})
}

func TestBankNameMatch_Integration(t *testing.T) {
	pool := withdrawalPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc, _, merchant, legacyID := withdrawalFixture(t, ctx, pool, 1_000_00)

	// No verified KYC name: refused before anything is written.
	svc.WithDisbursementProvider(fakeNameResolver{holder: "JOHN SMITH"}).WithBankNameMatch(true, true, fakeKYCName{})
	if _, err := addAcct(t, ctx, svc, merchant, "1111111111"); !errors.Is(err, ErrKYCNameRequired) {
		t.Fatalf("no KYC name: err = %v, want ErrKYCNameRequired", err)
	}
	var n int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM restaurant_bank_accounts WHERE user_id=$1 AND account_number='1111111111'`, merchant).Scan(&n)
	if n != 0 {
		t.Fatalf("%d rows written without a KYC name", n)
	}

	// Flag on but no reader wired: fail closed.
	svc.WithBankNameMatch(true, true, nil)
	if _, err := addAcct(t, ctx, svc, merchant, "1111111111"); !errors.Is(err, ErrNameMatchUnavailable) {
		t.Fatalf("unwired reader: err = %v, want ErrNameMatchUnavailable", err)
	}

	// The owner's own account (bank prints surname first): verified.
	svc.WithBankNameMatch(true, true, strongJohn)
	own, err := addAcct(t, ctx, svc, merchant, "2222222222")
	if err != nil {
		t.Fatalf("own account: %v", err)
	}
	if !own.IsVerified || own.NameMatchStatus != NameMatchMatched {
		t.Fatalf("own account: verified=%v status=%q, want verified + matched", own.IsVerified, own.NameMatchStatus)
	}

	// The approved KYB business name is owner-typed: a match on it alone is held
	// for review (and shown to the admin as context), never auto-verified.
	restID := seedKYBRestaurant(t, ctx, pool, merchant, "approved")
	if _, err := pool.Exec(ctx, `INSERT INTO restaurant_kyb (restaurant_id, legal_name, status) VALUES ($1,'Mama Put Kitchen Limited','approved')`, restID); err != nil {
		t.Fatalf("seed kyb: %v", err)
	}
	svc.WithDisbursementProvider(fakeNameResolver{holder: "MAMA PUT KITCHEN LTD"})
	biz, err := addAcct(t, ctx, svc, merchant, "3333333333")
	if err != nil {
		t.Fatalf("business account: %v", err)
	}
	if biz.IsVerified || biz.NameMatchStatus != NameMatchReview {
		t.Fatalf("KYB-name-only account: verified=%v status=%q, want held for review", biz.IsVerified, biz.NameMatchStatus)
	}

	// A weak identity (legacy or conflicting checks) never auto-verifies…
	svc.WithBankNameMatch(true, true, fakeKYCName{name: "John Adewale Smith", strong: false}).
		WithDisbursementProvider(fakeNameResolver{holder: "JOHN SMITH"})
	weak, err := addAcct(t, ctx, svc, merchant, "7777777777")
	if err != nil {
		t.Fatalf("weak identity: %v", err)
	}
	if weak.IsVerified || weak.NameMatchStatus != NameMatchReview {
		t.Fatalf("weak identity: verified=%v status=%q, want held for review", weak.IsVerified, weak.NameMatchStatus)
	}
	// …and neither does anything while auto-verify is off (ownership gate off).
	svc.WithBankNameMatch(true, false, strongJohn)
	noAuto, err := addAcct(t, ctx, svc, merchant, "8888888888")
	if err != nil {
		t.Fatalf("auto-verify off: %v", err)
	}
	if noAuto.IsVerified || noAuto.NameMatchStatus != NameMatchReview {
		t.Fatalf("auto-verify off: verified=%v status=%q, want held for review", noAuto.IsVerified, noAuto.NameMatchStatus)
	}
	svc.WithBankNameMatch(true, true, strongJohn)

	// An account verified before matching existed cannot be withdrawn to with the
	// flag on until it is re-added, which re-runs the check.
	if _, err := svc.RequestWithdrawal(ctx, merchant, RequestWithdrawalInput{AmountKobo: 10_000, BankAccountID: legacyID, IdempotencyKey: "wd-legacy-" + uuid.NewString()}); !errors.Is(err, ErrBankAccountNameUnchecked) {
		t.Fatalf("legacy account withdrawal: err = %v, want ErrBankAccountNameUnchecked", err)
	}
	svc.WithDisbursementProvider(fakeNameResolver{holder: "SMITH JOHN"})
	readd, err := svc.AddBankAccount(ctx, merchant, AddBankAccountRequest{ // the fixture's account
		BankName: "Test Bank", BankCode: "999", AccountNumber: "0123456789", AccountName: "typed by client", PIN: "1234",
	})
	if err != nil {
		t.Fatalf("re-add legacy: %v", err)
	}
	if readd.ID != legacyID || !readd.IsVerified || readd.NameMatchStatus != NameMatchMatched {
		t.Fatalf("re-added legacy: id=%s verified=%v status=%q, want same row, verified + matched", readd.ID, readd.IsVerified, readd.NameMatchStatus)
	}
	if _, err := svc.RequestWithdrawal(ctx, merchant, RequestWithdrawalInput{AmountKobo: 10_000, BankAccountID: legacyID, IdempotencyKey: "wd-legacy-ok-" + uuid.NewString()}); err != nil {
		t.Fatalf("withdrawal after re-check: %v", err)
	}

	// Someone else's account: saved but held for review, and unusable.
	svc.WithDisbursementProvider(fakeNameResolver{holder: "PETER OBI"})
	other, err := addAcct(t, ctx, svc, merchant, "4444444444")
	if err != nil {
		t.Fatalf("other account: %v", err)
	}
	if other.IsVerified || other.NameMatchStatus != NameMatchReview {
		t.Fatalf("other account: verified=%v status=%q, want unverified + review", other.IsVerified, other.NameMatchStatus)
	}
	if _, err := svc.RequestWithdrawal(ctx, merchant, RequestWithdrawalInput{AmountKobo: 10_000, BankAccountID: other.ID, IdempotencyKey: "wd-held-" + uuid.NewString()}); !errors.Is(err, ErrBankAccountUnverified) {
		t.Fatalf("withdrawal to a held account: err = %v, want ErrBankAccountUnverified", err)
	}

	// It shows in the admin review queue…
	held, err := svc.AdminListHeldBankAccounts(ctx)
	if err != nil {
		t.Fatalf("list held: %v", err)
	}
	if !containsHeld(held, other.ID) || containsHeld(held, own.ID) {
		t.Fatalf("held queue wrong: %+v", held)
	}
	for _, h := range held {
		if h.ID == other.ID && (h.VerifiedName != "John Adewale Smith" || len(h.KYBLegalNames) != 1) {
			t.Fatalf("held row lacks the names to compare: %+v", h)
		}
	}
	// …an approval needs a reason, then makes it usable.
	admin := uuid.NewString()
	if err := svc.AdminDecideBankAccountName(ctx, admin, other.ID, "approve", ""); err == nil {
		t.Fatal("approval without a reason must be refused")
	}
	if err := svc.AdminDecideBankAccountName(ctx, admin, other.ID, "approve", "married name, marriage certificate on file"); err != nil {
		t.Fatalf("approve: %v", err)
	}
	if _, err := svc.RequestWithdrawal(ctx, merchant, RequestWithdrawalInput{AmountKobo: 10_000, BankAccountID: other.ID, IdempotencyKey: "wd-approved-" + uuid.NewString()}); err != nil {
		t.Fatalf("withdrawal after approval: %v", err)
	}
	// A decided account is no longer in the queue and cannot be decided again.
	if err := svc.AdminDecideBankAccountName(ctx, admin, other.ID, "reject", "second look"); !errors.Is(err, ErrHeldBankAccountNotFound) {
		t.Fatalf("re-deciding: err = %v, want ErrHeldBankAccountNotFound", err)
	}

	// A rejected account stays unverified.
	svc.WithDisbursementProvider(fakeNameResolver{holder: "ADA EZE"})
	rej, err := addAcct(t, ctx, svc, merchant, "5555555555")
	if err != nil {
		t.Fatalf("rejected account: %v", err)
	}
	if err := svc.AdminDecideBankAccountName(ctx, admin, rej.ID, "reject", "not the owner's account"); err != nil {
		t.Fatalf("reject: %v", err)
	}
	var verified bool
	var status string
	_ = pool.QueryRow(ctx, `SELECT is_verified, name_match_status FROM restaurant_bank_accounts WHERE id=$1`, rej.ID).Scan(&verified, &status)
	if verified || status != NameMatchRejected {
		t.Fatalf("rejected: verified=%v status=%q", verified, status)
	}

	// Flag off: today's behaviour (name-enquiry success = verified, no matching).
	svc.WithBankNameMatch(false, false, nil).WithDisbursementProvider(fakeNameResolver{holder: "PETER OBI"})
	off, err := addAcct(t, ctx, svc, merchant, "6666666666")
	if err != nil {
		t.Fatalf("flag off: %v", err)
	}
	if !off.IsVerified || off.NameMatchStatus != "" {
		t.Fatalf("flag off: verified=%v status=%q, want verified and no match status", off.IsVerified, off.NameMatchStatus)
	}
}

func containsHeld(list []HeldBankAccount, id string) bool {
	for _, h := range list {
		if h.ID == id {
			return true
		}
	}
	return false
}
