package marketplace

// EXECUTED, DB-free unit test of the boost money-path ledger effect — the SOLE live
// marketplace revenue path after ADR-023 retired escrow settlement. The prior QA
// suite (backend/tests/marketplace/*) only asserted transcribed FSM *tables*; the
// actual charge/auto-refund ledger postings had NO executed test. This exercises the
// real postBoostCharge / postBoostRefund production code (called by PurchaseBoost /
// RejectBoost) against an in-memory fake boostLedger, so it runs in CI with no
// Postgres, no Redis, and no network — mirroring the house pattern in
// backend/internal/academy/fees/payment/payment_test.go (fakeLedger).
//
// Asserted invariants:
//   - charge: one BALANCED debit (seller wallet DR, commission account CR) of exactly
//     the tier price; deterministic idempotency key == ledger reference.
//   - charge idempotent: a duplicate deterministic key posts nothing new
//     (ledger.ErrDuplicate tolerated → no error, single posting).
//   - charge fail-closed: ledger.ErrInsufficientFunds maps to 402
//     INSUFFICIENT_WALLET_BALANCE and posts nothing.
//   - auto-refund: one BALANCED reversal (seller wallet restore, commission drain) of
//     exactly the boost price; deterministic key.
//   - auto-refund idempotent: a duplicate reversal posts nothing new.

import (
	"context"
	"errors"
	"testing"
	"time"

	"spotlight/backend/internal/finance/ledger"
)

// ── fakeBoostLedger: in-memory boostLedger implementing balanced-pair + idempotency ──

type recordedDebit struct {
	debitAccount  string // the seller wallet (money out)
	creditAccount string // the counter account (commission)
	amount        int64
	reference     string
	idem          string
}

type recordedReversal struct {
	restoreAccount string // seller wallet restored (REVERSAL_DEBIT, +balance)
	releaseAccount string // commission account drained (REVERSAL_CREDIT)
	amount         int64
	reference      string
	idem           string
}

type fakeBoostLedger struct {
	standing  map[ledger.AccountType]*ledger.Account
	wallets   map[string]*ledger.Account
	debits    []recordedDebit
	reversals []recordedReversal
	seen      map[string]bool // idempotency keys already durably posted

	// debitErr, when non-nil, is returned by the NEXT Debit (e.g. ErrInsufficientFunds)
	// without recording a posting — models the fail-closed sufficiency check.
	debitErr error
}

func newFakeBoostLedger() *fakeBoostLedger {
	return &fakeBoostLedger{
		standing: map[ledger.AccountType]*ledger.Account{},
		wallets:  map[string]*ledger.Account{},
		seen:     map[string]bool{},
	}
}

func (f *fakeBoostLedger) GetOrCreateStandingAccount(_ context.Context, t ledger.AccountType) (*ledger.Account, error) {
	if a, ok := f.standing[t]; ok {
		return a, nil
	}
	a := &ledger.Account{ID: "standing:" + string(t), Type: t}
	f.standing[t] = a
	return a, nil
}

func (f *fakeBoostLedger) GetOrCreateUserWallet(_ context.Context, userID string) (*ledger.Account, error) {
	if a, ok := f.wallets[userID]; ok {
		return a, nil
	}
	uid := userID
	a := &ledger.Account{ID: "wallet:" + userID, UserID: &uid, Type: ledger.AccountUserWallet}
	f.wallets[userID] = a
	return a, nil
}

func (f *fakeBoostLedger) Debit(_ context.Context, userID, reference, idempotencyKey, creditAccountID string, amountKobo int64) error {
	if f.debitErr != nil {
		return f.debitErr // fail-closed: sufficiency (or other) error, nothing posted
	}
	if f.seen[idempotencyKey] {
		return ledger.ErrDuplicate // idempotent replay: no second posting
	}
	f.seen[idempotencyKey] = true
	wallet, _ := f.GetOrCreateUserWallet(context.Background(), userID)
	f.debits = append(f.debits, recordedDebit{
		debitAccount:  wallet.ID,
		creditAccount: creditAccountID,
		amount:        amountKobo,
		reference:     reference,
		idem:          idempotencyKey,
	})
	return nil
}

func (f *fakeBoostLedger) PostReversal(_ context.Context, restoreAccountID, releaseAccountID string, amountKobo int64, reference, idempotencyKey string) error {
	if f.seen[idempotencyKey] {
		return ledger.ErrDuplicate
	}
	f.seen[idempotencyKey] = true
	f.reversals = append(f.reversals, recordedReversal{
		restoreAccount: restoreAccountID,
		releaseAccount: releaseAccountID,
		amount:         amountKobo,
		reference:      reference,
		idem:           idempotencyKey,
	})
	return nil
}

// serviceWithLedger builds a Service wired ONLY with the fake ledger. postBoostCharge
// / postBoostRefund touch nothing else (no repo, no redis), so this is sufficient and
// keeps the test a pure unit test.
func serviceWithLedger(l boostLedger) *Service { return &Service{ledger: l} }

// ── charge ───────────────────────────────────────────────────────────────────────

func TestPostBoostCharge_BalancedDebitIntoCommission(t *testing.T) {
	f := newFakeBoostLedger()
	s := serviceWithLedger(f)
	tier := BoostTier{Tier: "vip", DurationDays: 14, PriceKobo: 200000, Weight: 2.0}

	ref, err := s.postBoostCharge(context.Background(), "seller-1", "listing-1", tier)
	if err != nil {
		t.Fatalf("charge returned error: %v", err)
	}

	wantKey := boostChargeKey("seller-1", "listing-1", "vip")
	if ref != wantKey {
		t.Errorf("charge ref = %q, want deterministic key %q", ref, wantKey)
	}
	if len(f.debits) != 1 {
		t.Fatalf("want exactly ONE debit posting, got %d", len(f.debits))
	}
	d := f.debits[0]
	commission := f.standing[ledger.AccountCommission]
	if commission == nil || d.creditAccount != commission.ID {
		t.Errorf("debit must credit the commission account (%v), got creditAccount=%q", commission, d.creditAccount)
	}
	if d.debitAccount != "wallet:seller-1" {
		t.Errorf("debit must draw down the seller wallet, got debitAccount=%q", d.debitAccount)
	}
	if d.amount != tier.PriceKobo {
		t.Errorf("debit amount = %d kobo, want tier price %d", d.amount, tier.PriceKobo)
	}
	// Balanced pair: exactly the same amount flows out of the wallet and into the
	// commission account, and reference == idempotency key (deterministic).
	if d.reference != d.idem || d.idem != wantKey {
		t.Errorf("charge reference/idem must both equal %q; got reference=%q idem=%q", wantKey, d.reference, d.idem)
	}
}

func TestPostBoostCharge_IdempotentSinglePosting(t *testing.T) {
	f := newFakeBoostLedger()
	s := serviceWithLedger(f)
	tier := BoostTier{Tier: "start", DurationDays: 7, PriceKobo: 50000, Weight: 1.0}

	ref1, err1 := s.postBoostCharge(context.Background(), "seller-1", "listing-1", tier)
	ref2, err2 := s.postBoostCharge(context.Background(), "seller-1", "listing-1", tier) // retry, same deterministic key

	if err1 != nil || err2 != nil {
		t.Fatalf("neither charge should error (duplicate is tolerated); got %v, %v", err1, err2)
	}
	if ref1 != ref2 {
		t.Errorf("retried charge must return the SAME ref: %q vs %q", ref1, ref2)
	}
	if len(f.debits) != 1 {
		t.Fatalf("duplicate charge must post NOTHING new: want 1 debit, got %d", len(f.debits))
	}
}

func TestPostBoostCharge_FailsClosedOnInsufficientFunds(t *testing.T) {
	f := newFakeBoostLedger()
	f.debitErr = ledger.ErrInsufficientFunds
	s := serviceWithLedger(f)
	tier := BoostTier{Tier: "diamond", DurationDays: 30, PriceKobo: 1500000, Weight: 5.0}

	_, err := s.postBoostCharge(context.Background(), "broke-seller", "listing-9", tier)
	if err == nil {
		t.Fatal("charge must fail closed when the wallet has insufficient funds")
	}
	var ce *CodedError
	if !errors.As(err, &ce) {
		t.Fatalf("want a *CodedError, got %T: %v", err, err)
	}
	if ce.Code != CodeInsufficientWallet || ce.Status != 402 {
		t.Errorf("want 402 %s, got %d %s", CodeInsufficientWallet, ce.Status, ce.Code)
	}
	if len(f.debits) != 0 {
		t.Errorf("a failed-closed charge must post NOTHING, got %d debits", len(f.debits))
	}
}

// ── auto-refund ────────────────────────────────────────────────────────────────────

func TestPostBoostRefund_BalancedReversal(t *testing.T) {
	f := newFakeBoostLedger()
	s := serviceWithLedger(f)

	ref, err := s.postBoostRefund(context.Background(), "seller-1", "boost-42", 200000)
	if err != nil {
		t.Fatalf("refund returned error: %v", err)
	}
	wantKey := boostRefundKey("boost-42")
	if ref != wantKey {
		t.Errorf("refund ref = %q, want deterministic key %q", ref, wantKey)
	}
	if len(f.reversals) != 1 {
		t.Fatalf("want exactly ONE reversal posting, got %d", len(f.reversals))
	}
	r := f.reversals[0]
	commission := f.standing[ledger.AccountCommission]
	if r.restoreAccount != "wallet:seller-1" {
		t.Errorf("reversal must restore the seller wallet, got %q", r.restoreAccount)
	}
	if commission == nil || r.releaseAccount != commission.ID {
		t.Errorf("reversal must drain the commission account (%v), got %q", commission, r.releaseAccount)
	}
	if r.amount != 200000 {
		t.Errorf("reversal amount = %d, want the full boost price 200000", r.amount)
	}
	if r.reference != r.idem || r.idem != wantKey {
		t.Errorf("refund reference/idem must both equal %q; got reference=%q idem=%q", wantKey, r.reference, r.idem)
	}
}

func TestPostBoostRefund_IdempotentSinglePosting(t *testing.T) {
	f := newFakeBoostLedger()
	s := serviceWithLedger(f)

	_, err1 := s.postBoostRefund(context.Background(), "seller-1", "boost-42", 200000)
	_, err2 := s.postBoostRefund(context.Background(), "seller-1", "boost-42", 200000) // retried reject

	if err1 != nil || err2 != nil {
		t.Fatalf("neither refund should error (duplicate tolerated); got %v, %v", err1, err2)
	}
	if len(f.reversals) != 1 {
		t.Fatalf("duplicate refund must post NOTHING new: want 1 reversal, got %d", len(f.reversals))
	}
}

// ── customBoostDuration (custom date-range pricing money-math) ────────────────

func TestCustomBoostDuration_RoundsPartDayUp(t *testing.T) {
	now := time.Date(2027, 1, 1, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		name string
		ends time.Time
		want int
	}{
		{"exactly 1 day", now.Add(24 * time.Hour), 1},
		{"1 minute over 1 day rounds to 2", now.Add(24*time.Hour + time.Minute), 2},
		{"3 days 6 hours rounds up to 4", now.Add(78 * time.Hour), 4},
		{"a few minutes rounds up to 1 (never zero)", now.Add(10 * time.Minute), 1},
		{"exactly 90 days is the cap, still allowed", now.Add(90 * 24 * time.Hour), 90},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := customBoostDuration(now, c.ends)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != c.want {
				t.Errorf("customBoostDuration(...) = %d days, want %d", got, c.want)
			}
		})
	}
}

func TestCustomBoostDuration_RejectsPastOrPresentEnd(t *testing.T) {
	now := time.Date(2027, 1, 1, 12, 0, 0, 0, time.UTC)
	for _, ends := range []time.Time{now, now.Add(-time.Minute)} {
		if _, err := customBoostDuration(now, ends); err == nil {
			t.Fatalf("ends_at=%v (not after now) must be rejected", ends)
		}
	}
}

func TestCustomBoostDuration_RejectsOverTheCap(t *testing.T) {
	now := time.Date(2027, 1, 1, 12, 0, 0, 0, time.UTC)
	_, err := customBoostDuration(now, now.Add((maxCustomBoostDays+1)*24*time.Hour))
	if err == nil {
		t.Fatal("a range exceeding maxCustomBoostDays must be rejected")
	}
	var ce *CodedError
	if !errors.As(err, &ce) {
		t.Fatalf("want a *CodedError, got %T: %v", err, err)
	}
	if ce.Code != CodeInvalidBoostRange {
		t.Errorf("want %s, got %s", CodeInvalidBoostRange, ce.Code)
	}
}

// ── boostChargeTierKey (custom-mode idempotency derivation) ───────────────────

func TestBoostChargeTierKey_PackageModeIsTierVerbatim(t *testing.T) {
	q := &BoostQuote{Mode: "package", Tier: "vip"}
	if got := boostChargeTierKey(q); got != "vip" {
		t.Errorf("package-mode key = %q, want the tier verbatim %q", got, "vip")
	}
}

func TestBoostChargeTierKey_CustomModeIsDeterministicPerEndDate(t *testing.T) {
	end1 := time.Date(2027, 1, 5, 9, 30, 0, 0, time.UTC)
	end2 := time.Date(2027, 1, 6, 9, 30, 0, 0, time.UTC)

	keyA := boostChargeTierKey(&BoostQuote{Mode: "custom", EndsAt: end1})
	keyB := boostChargeTierKey(&BoostQuote{Mode: "custom", EndsAt: end1}) // retry, same request
	keyC := boostChargeTierKey(&BoostQuote{Mode: "custom", EndsAt: end2}) // different request

	if keyA != keyB {
		t.Errorf("a retry of the SAME custom request must derive the SAME key: %q vs %q", keyA, keyB)
	}
	if keyA == keyC {
		t.Errorf("two DIFFERENT custom requests must derive DIFFERENT keys, both got %q", keyA)
	}
}
