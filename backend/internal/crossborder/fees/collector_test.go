package fees_test

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/crossborder/fees"
	"spotlight/backend/internal/finance/ledger"
)

// fakeLedger is an in-memory double-entry ledger mirroring the real posting
// contract: balanced pairs keyed ":debit"/":credit", identical replay is a
// no-op, a different journal under a held key is ErrDuplicate, and a gated
// debit from a wallet fails with ErrInsufficientFunds without posting.
type fakeLedger struct {
	accts    map[string]*ledger.Account // key: userID|type
	entries  map[string]ledger.Entry    // by idempotency key (with leg suffix)
	balances map[string]int64
	n        int
	// redisDup simulates the Redis fast-path: a seen key returns ErrDuplicate
	// even though the journal committed (real Service behaviour).
	redisDup bool
	seen     map[string]bool
	gated    int
	ungated  int
}

func newFake() *fakeLedger {
	return &fakeLedger{accts: map[string]*ledger.Account{}, entries: map[string]ledger.Entry{}, balances: map[string]int64{}, seen: map[string]bool{}}
}

func (f *fakeLedger) acct(user *string, t ledger.AccountType) *ledger.Account {
	k := string(t)
	if user != nil {
		k = *user + "|" + k
	}
	if a, ok := f.accts[k]; ok {
		return a
	}
	f.n++
	a := &ledger.Account{ID: fmt.Sprintf("acct-%d", f.n), UserID: user, Type: t}
	f.accts[k] = a
	return a
}
func (f *fakeLedger) GetOrCreateUserWallet(_ context.Context, u string) (*ledger.Account, error) {
	return f.acct(&u, ledger.AccountUserWallet), nil
}
func (f *fakeLedger) GetOrCreateStandingAccount(_ context.Context, t ledger.AccountType) (*ledger.Account, error) {
	return f.acct(nil, t), nil
}
func (f *fakeLedger) EntryByKey(_ context.Context, k string) (*ledger.Entry, bool, error) {
	e, ok := f.entries[k]
	if !ok {
		return nil, false, nil
	}
	return &e, true, nil
}
func (f *fakeLedger) post(j ledger.JournalEntry, checkFunds bool) error {
	if f.redisDup && f.seen[j.IdempotencyKey] {
		return ledger.ErrDuplicate
	}
	if d, ok := f.entries[j.IdempotencyKey+":debit"]; ok {
		if d.AccountID == j.DebitAccountID && d.AmountKobo == j.AmountKobo && d.Reference == j.Reference {
			return nil
		}
		return fmt.Errorf("%w: held by different journal", ledger.ErrDuplicate)
	}
	if checkFunds && f.balances[j.DebitAccountID] < j.AmountKobo {
		return ledger.ErrInsufficientFunds
	}
	f.entries[j.IdempotencyKey+":debit"] = ledger.Entry{AccountID: j.DebitAccountID, Type: ledger.EntryDebit, AmountKobo: j.AmountKobo, Reference: j.Reference}
	f.entries[j.IdempotencyKey+":credit"] = ledger.Entry{AccountID: j.CreditAccountID, Type: ledger.EntryCredit, AmountKobo: j.AmountKobo, Reference: j.Reference}
	f.balances[j.DebitAccountID] -= j.AmountKobo
	f.balances[j.CreditAccountID] += j.AmountKobo
	f.seen[j.IdempotencyKey] = true
	return nil
}
func (f *fakeLedger) PostJournalGated(_ context.Context, j ledger.JournalEntry, _ string) error {
	f.gated++
	return f.post(j, true)
}
func (f *fakeLedger) PostJournal(_ context.Context, j ledger.JournalEntry) error {
	f.ungated++
	return f.post(j, false)
}

func (f *fakeLedger) sumAll() int64 {
	var s int64
	for _, b := range f.balances {
		s += b
	}
	return s
}

func charge() fees.FeeCharge {
	return fees.FeeCharge{
		IdempotencyKey: "cb:t1:platform_fee:send",
		TransferID:     "t1",
		UserID:         "user-1",
		CompanyID:      uuid.NewString(),
		Service:        "send",
		Currency:       "USD",
		AmountMinor:    2500,
	}
}

func fund(f *fakeLedger, user string, amt int64) {
	a, _ := f.GetOrCreateUserWallet(context.Background(), user)
	f.balances[a.ID] = amt
}

func TestLedgerCharge_ChargesOnceAndTracksUnswept(t *testing.T) {
	f := newFake()
	fund(f, "user-1", 10000)
	c := fees.NewLedgerChargeCollector(f)
	in := charge()
	res, err := c.Collect(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Charged || res.Strategy != fees.StrategyLedgerCharge || res.AmountMinor != 2500 {
		t.Fatalf("bad result %+v", res)
	}
	wallet, _ := f.GetOrCreateUserWallet(context.Background(), "user-1")
	revT, _ := ledger.PlatformFeeAccount("send")
	rev, _ := f.GetOrCreateStandingAccount(context.Background(), revT)
	unT, _ := ledger.FeesUnsweptAccount(in.CompanyID, "USD")
	un, _ := f.GetOrCreateStandingAccount(context.Background(), unT)
	if f.balances[wallet.ID] != 7500 || f.balances[rev.ID] != 2500 || f.balances[un.ID] != 2500 {
		t.Fatalf("balances wallet=%d rev=%d unswept=%d", f.balances[wallet.ID], f.balances[rev.ID], f.balances[un.ID])
	}
	if f.sumAll() != 10000 {
		t.Fatalf("ledger not conserved: %d", f.sumAll())
	}
	if res.WalletAccountID != wallet.ID || res.RevenueAccountID != rev.ID || res.UnsweptAccountID != un.ID {
		t.Fatalf("result must expose accounts for reversal: %+v", res)
	}
	if f.gated != 1 {
		t.Fatalf("user-wallet debit must be gated, gated=%d", f.gated)
	}
}

func TestLedgerCharge_IdempotentRetry(t *testing.T) {
	for _, redis := range []bool{false, true} {
		f := newFake()
		f.redisDup = redis
		fund(f, "user-1", 10000)
		c := fees.NewLedgerChargeCollector(f)
		in := charge()
		if _, err := c.Collect(context.Background(), in); err != nil {
			t.Fatal(err)
		}
		res, err := c.Collect(context.Background(), in)
		if err != nil {
			t.Fatalf("retry (redis=%v): %v", redis, err)
		}
		if !res.Charged {
			t.Fatal("retry should report the converged charge")
		}
		wallet, _ := f.GetOrCreateUserWallet(context.Background(), "user-1")
		if f.balances[wallet.ID] != 7500 {
			t.Fatalf("double charge (redis=%v): wallet=%d", redis, f.balances[wallet.ID])
		}
	}
}

func TestLedgerCharge_RetryHealsAfterCrashBetweenLegs(t *testing.T) {
	f := newFake()
	fund(f, "user-1", 10000)
	in := charge()
	// Simulate crash: fee journal posted, unswept journal missing.
	wallet, _ := f.GetOrCreateUserWallet(context.Background(), "user-1")
	revT, _ := ledger.PlatformFeeAccount("send")
	rev, _ := f.GetOrCreateStandingAccount(context.Background(), revT)
	_ = f.post(ledger.JournalEntry{Reference: "cb:platform_fee:t1:send", IdempotencyKey: in.IdempotencyKey, AmountKobo: 2500, DebitAccountID: wallet.ID, CreditAccountID: rev.ID}, true)
	if _, err := fees.NewLedgerChargeCollector(f).Collect(context.Background(), in); err != nil {
		t.Fatal(err)
	}
	unT, _ := ledger.FeesUnsweptAccount(in.CompanyID, "USD")
	un, _ := f.GetOrCreateStandingAccount(context.Background(), unT)
	if f.balances[un.ID] != 2500 || f.balances[wallet.ID] != 7500 {
		t.Fatalf("not healed: unswept=%d wallet=%d", f.balances[un.ID], f.balances[wallet.ID])
	}
}

func TestLedgerCharge_FailsClosedWhenWalletCannotCover(t *testing.T) {
	f := newFake()
	fund(f, "user-1", 1000)
	_, err := fees.NewLedgerChargeCollector(f).Collect(context.Background(), charge())
	if !errors.Is(err, fees.ErrInsufficientFunds) {
		t.Fatalf("want ErrInsufficientFunds, got %v", err)
	}
	if len(f.entries) != 0 {
		t.Fatalf("partial post: %d entries", len(f.entries))
	}
}

func TestLedgerCharge_ForeignKeyClaimFailsClosed(t *testing.T) {
	f := newFake()
	f.redisDup = true
	fund(f, "user-1", 10000)
	in := charge()
	f.seen[in.IdempotencyKey] = true // Redis claims key, but ledger has nothing
	_, err := fees.NewLedgerChargeCollector(f).Collect(context.Background(), in)
	if err == nil {
		t.Fatal("ErrDuplicate with no matching posted journal must not be treated as success")
	}
}

func TestCollect_ValidationFailsClosed(t *testing.T) {
	f := newFake()
	fund(f, "user-1", 10000)
	c := fees.NewLedgerChargeCollector(f)
	bad := []func(*fees.FeeCharge){
		func(x *fees.FeeCharge) { x.IdempotencyKey = "" },
		func(x *fees.FeeCharge) { x.UserID = "" },
		func(x *fees.FeeCharge) { x.AmountMinor = -1 },
		func(x *fees.FeeCharge) { x.Service = "Bad Svc" },
		func(x *fees.FeeCharge) { x.CompanyID = "nope" },
		func(x *fees.FeeCharge) { x.Currency = "usd" },
	}
	for i, m := range bad {
		in := charge()
		m(&in)
		if _, err := c.Collect(context.Background(), in); err == nil {
			t.Errorf("case %d: expected validation error", i)
		}
	}
	if len(f.entries) != 0 {
		t.Fatal("validation failure must not post")
	}
}

func TestLedgerCharge_ZeroFeeIsNoOp(t *testing.T) {
	f := newFake()
	in := charge()
	in.AmountMinor = 0
	res, err := fees.NewLedgerChargeCollector(f).Collect(context.Background(), in)
	if err != nil || res.Charged || len(f.entries) != 0 {
		t.Fatalf("zero fee: res=%+v err=%v entries=%d", res, err, len(f.entries))
	}
}

func TestNGNWallet_ChargesWalletNoUnswept(t *testing.T) {
	f := newFake()
	fund(f, "user-1", 10000)
	in := charge()
	in.Currency = "NGN"
	res, err := fees.NewNGNWalletCollector(f).Collect(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Charged || res.Strategy != fees.StrategyNGNWallet || res.UnsweptAccountID != "" {
		t.Fatalf("bad result %+v", res)
	}
	wallet, _ := f.GetOrCreateUserWallet(context.Background(), "user-1")
	if f.balances[wallet.ID] != 7500 || f.sumAll() != 10000 {
		t.Fatalf("wallet=%d sum=%d", f.balances[wallet.ID], f.sumAll())
	}
	if _, ok := f.entries[in.IdempotencyKey+":unswept:debit"]; ok {
		t.Fatal("B must not track unswept")
	}
	// retry idempotent
	if _, err := fees.NewNGNWalletCollector(f).Collect(context.Background(), in); err != nil || f.balances[wallet.ID] != 7500 {
		t.Fatalf("retry err=%v wallet=%d", err, f.balances[wallet.ID])
	}
}

func TestNGNWallet_FailsClosedOnInsufficientAndNonNGN(t *testing.T) {
	f := newFake()
	fund(f, "user-1", 100)
	in := charge()
	in.Currency = "NGN"
	if _, err := fees.NewNGNWalletCollector(f).Collect(context.Background(), in); !errors.Is(err, fees.ErrInsufficientFunds) {
		t.Fatalf("want ErrInsufficientFunds got %v", err)
	}
	in.Currency = "USD"
	if _, err := fees.NewNGNWalletCollector(f).Collect(context.Background(), in); err == nil {
		t.Fatal("B must reject non-NGN fee currency")
	}
}

func TestSpreadBaked_NoOpRecordsIntent(t *testing.T) {
	f := newFake()
	res, err := fees.NewSpreadBakedCollector().Collect(context.Background(), charge())
	if err != nil {
		t.Fatal(err)
	}
	if res.Charged || !res.IntentRecorded || res.Strategy != fees.StrategySpreadBaked || res.AmountMinor != 2500 {
		t.Fatalf("bad result %+v", res)
	}
	if len(f.entries) != 0 {
		t.Fatal("C must not post")
	}
	in := charge()
	in.IdempotencyKey = ""
	if _, err := fees.NewSpreadBakedCollector().Collect(context.Background(), in); err == nil {
		t.Fatal("C must still require an idempotency key")
	}
}

func TestStrategySelection(t *testing.T) {
	f := newFake()
	for _, s := range []fees.Strategy{fees.StrategyLedgerCharge, fees.StrategyNGNWallet, fees.StrategySpreadBaked} {
		c, err := fees.NewCollector(s, f)
		if err != nil || c == nil {
			t.Fatalf("%s: %v", s, err)
		}
	}
	if _, err := fees.NewCollector("bogus", f); err == nil {
		t.Fatal("unknown strategy must error")
	}
	if _, err := fees.NewCollector(fees.StrategyLedgerCharge, nil); err == nil {
		t.Fatal("nil ledger must error")
	}
}
