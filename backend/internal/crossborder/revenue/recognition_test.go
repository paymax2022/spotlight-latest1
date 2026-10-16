package revenue_test

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"spotlight/backend/internal/crossborder/fees"
	"spotlight/backend/internal/crossborder/revenue"
	"spotlight/backend/internal/finance/commission"
	"spotlight/backend/internal/finance/ledger"
)

// fakeLedger mirrors the real posting contract: balanced keyed pairs, identical
// replay is a no-op, balances = credits - debits (reversal restore = +balance).
type fakeLedger struct {
	accts    map[string]*ledger.Account
	entries  map[string]ledger.Entry
	balances map[string]int64
	n        int
	posted   map[string]bool
}

func newFake() *fakeLedger {
	return &fakeLedger{accts: map[string]*ledger.Account{}, entries: map[string]ledger.Entry{}, balances: map[string]int64{}, posted: map[string]bool{}}
}

func (f *fakeLedger) id(t ledger.AccountType) string {
	a, _ := f.GetOrCreateStandingAccount(context.Background(), t)
	return a.ID
}
func (f *fakeLedger) GetOrCreateStandingAccount(_ context.Context, t ledger.AccountType) (*ledger.Account, error) {
	if a, ok := f.accts[string(t)]; ok {
		return a, nil
	}
	f.n++
	a := &ledger.Account{ID: fmt.Sprintf("acct-%d", f.n), Type: t}
	f.accts[string(t)] = a
	return a, nil
}
func (f *fakeLedger) EntryByKey(_ context.Context, k string) (*ledger.Entry, bool, error) {
	e, ok := f.entries[k]
	if !ok {
		return nil, false, nil
	}
	return &e, true, nil
}
func (f *fakeLedger) Posted(_ context.Context, k string) (bool, error) { return f.posted[k], nil }
func (f *fakeLedger) PostJournal(_ context.Context, j ledger.JournalEntry) error {
	if d, ok := f.entries[j.IdempotencyKey+":debit"]; ok {
		if d.AccountID == j.DebitAccountID && d.AmountKobo == j.AmountKobo && d.Reference == j.Reference {
			return nil
		}
		return ledger.ErrDuplicate
	}
	f.entries[j.IdempotencyKey+":debit"] = ledger.Entry{AccountID: j.DebitAccountID, Type: ledger.EntryDebit, AmountKobo: j.AmountKobo, Reference: j.Reference}
	f.entries[j.IdempotencyKey+":credit"] = ledger.Entry{AccountID: j.CreditAccountID, Type: ledger.EntryCredit, AmountKobo: j.AmountKobo, Reference: j.Reference}
	f.balances[j.DebitAccountID] -= j.AmountKobo
	f.balances[j.CreditAccountID] += j.AmountKobo
	f.posted[j.IdempotencyKey] = true
	return nil
}
func (f *fakeLedger) PostReversal(_ context.Context, restore, release string, amt int64, ref, key string) error {
	if f.posted[key] {
		return ledger.ErrDuplicate
	}
	f.balances[restore] += amt
	f.balances[release] -= amt
	f.posted[key] = true
	return nil
}

type fakeCommission struct {
	rows  map[string]*commission.Earning
	calls int
}

func (c *fakeCommission) RecordExact(_ context.Context, cat, svc, sub string, gross, rev int64, mod, ref string, uid *string, key string) (*commission.Earning, error) {
	c.calls++
	if c.rows == nil {
		c.rows = map[string]*commission.Earning{}
	}
	if e, ok := c.rows[key]; ok {
		return e, nil
	}
	e := &commission.Earning{ServiceCategory: cat, Service: svc, ServiceSubtype: sub, GrossAmountKobo: gross, SpotlightRevenueKobo: rev, SourceModule: mod, SourceRef: ref, Currency: "NGN"}
	c.rows[key] = e
	return e, nil
}

func setup() (*revenue.Recognizer, *fakeLedger, *fakeCommission) {
	l, c := newFake(), &fakeCommission{}
	return revenue.NewRecognizer(l, c, revenue.NewMemStore()), l, c
}

// USD 100.00 -> NGN 150,000.00 : 1 US cent = 1500 kobo.
var usdNGN = revenue.Rate{Num: 15_000_000, Den: 10_000}

func spreadTrade() revenue.FXSpreadTrade {
	return revenue.FXSpreadTrade{TransferID: "t1", Service: "fx", UserID: "u1", Currency: "USD",
		SpreadMinor: 2500, FixedMinor: 100, GrossMinor: 100_00, Rate: usdNGN}
}

func TestRecognizeFXSpread_NativeRecordAndNGNRollupOnce(t *testing.T) {
	ctx := context.Background()
	r, l, c := setup()
	for i := 0; i < 3; i++ { // redelivery
		if err := r.RecognizeFXSpread(ctx, spreadTrade()); err != nil {
			t.Fatal(err)
		}
	}
	// spread (2500) + fixed (100) = 2600 USD cents = 3,900,000 kobo, recognised once.
	const want = int64(2600 * 1500)
	e := c.rows["cb:t1:fx_spread:fx"]
	if e == nil || len(c.rows) != 1 {
		t.Fatalf("want exactly one commission row under cb:t1:fx_spread:fx, got %v", c.rows)
	}
	if e.SpotlightRevenueKobo != want || e.GrossAmountKobo != 100_00*1500 || e.SourceRef != "t1" || e.SourceModule != "crossborder" {
		t.Fatalf("bad commission row %+v", e)
	}
	// Receivable accrual mirrors revenue once (no double count across redeliveries).
	if got := l.balances[l.id(ledger.AccountRevenueFxMarkup)]; got != want {
		t.Fatalf("revenue:fx_markup = %d, want %d", got, want)
	}
	if got := l.balances[l.id(ledger.AccountReceivableVertoMarkup)]; got != -want {
		t.Fatalf("receivable:verto_markup = %d, want %d", got, -want)
	}
	// Native line (original ccy + rate) is retrievable.
	rec, ok, _ := r.Record(ctx, "t1", revenue.ComponentFXSpread)
	if !ok || rec.Currency != "USD" || rec.NativeMinor != 2600 || rec.Rate != usdNGN || rec.State != revenue.StateAccrued || rec.NGNMinor != want {
		t.Fatalf("bad native record %+v ok=%v", rec, ok)
	}
}

func TestRecognizeFXSpread_NGNNeedsNoRate_NonNGNWithoutRateFailsClosed(t *testing.T) {
	ctx := context.Background()
	r, l, c := setup()
	tr := spreadTrade()
	tr.Rate = revenue.Rate{}
	if err := r.RecognizeFXSpread(ctx, tr); !errors.Is(err, revenue.ErrNoNGNRate) {
		t.Fatalf("want ErrNoNGNRate, got %v", err)
	}
	if c.calls != 0 || len(l.entries) != 0 {
		t.Fatal("nothing may post without a rate")
	}
	ngn := revenue.FXSpreadTrade{TransferID: "t2", Service: "send", Currency: "NGN", SpreadMinor: 700, GrossMinor: 10_000}
	if err := r.RecognizeFXSpread(ctx, ngn); err != nil {
		t.Fatal(err)
	}
	if c.rows["cb:t2:fx_spread:send"].SpotlightRevenueKobo != 700 {
		t.Fatal("NGN spread should roll up 1:1")
	}
}

func TestRecognizeFXSpread_ZeroIsNoop(t *testing.T) {
	r, l, c := setup()
	tr := spreadTrade()
	tr.SpreadMinor, tr.FixedMinor = 0, 0
	if err := r.RecognizeFXSpread(context.Background(), tr); err != nil {
		t.Fatal(err)
	}
	if c.calls != 0 || len(l.entries) != 0 {
		t.Fatal("zero spread must not post")
	}
}

func chargedFee(l *fakeLedger) fees.Result {
	return fees.Result{Strategy: fees.StrategyLedgerCharge, Charged: true, AmountMinor: 5000,
		FeeKey: "cb:t1:platform_fee:send", UnsweptKey: "cb:t1:platform_fee:send:unswept",
		WalletAccountID: "wallet-1", RevenueAccountID: "rev-send", UnsweptAccountID: "unswept-1"}
}

func feeCharge(l *fakeLedger) revenue.PlatformFeeCharge {
	return revenue.PlatformFeeCharge{TransferID: "t1", Service: "send", UserID: "u1", Currency: "NGN", AmountMinor: 5000, Result: chargedFee(l)}
}

func TestRecognizePlatformFee_RollupAndStrategyC(t *testing.T) {
	ctx := context.Background()
	r, l, c := setup()
	for i := 0; i < 2; i++ {
		if err := r.RecognizePlatformFee(ctx, feeCharge(l)); err != nil {
			t.Fatal(err)
		}
	}
	e := c.rows["cb:t1:platform_fee:send"]
	if e == nil || len(c.rows) != 1 || e.SpotlightRevenueKobo != 5000 {
		t.Fatalf("want one NGN row of 5000, got %v", c.rows)
	}
	// Strategy C: intent only, never recognised as a platform-fee line.
	cc := feeCharge(l)
	cc.TransferID = "t9"
	cc.Result = fees.Result{Strategy: fees.StrategySpreadBaked, IntentRecorded: true, AmountMinor: 5000}
	before := c.calls
	if err := r.RecognizePlatformFee(ctx, cc); err != nil {
		t.Fatal(err)
	}
	if c.calls != before {
		t.Fatal("strategy C (Charged==false) must not be recognised")
	}
	if _, ok, _ := r.Record(ctx, "t9", revenue.ComponentPlatformFee); ok {
		t.Fatal("no record for uncharged fee")
	}
}

func TestMarkSettled_AccruedToSettled(t *testing.T) {
	ctx := context.Background()
	r, l, _ := setup()
	_ = r.RecognizeFXSpread(ctx, spreadTrade())
	_ = r.RecognizePlatformFee(ctx, feeCharge(l))

	for i := 0; i < 2; i++ { // idempotent
		if err := r.MarkSettled(ctx, "t1", revenue.ComponentFXSpread, revenue.Settlement{Reference: "verto-stmt-1"}); err != nil {
			t.Fatal(err)
		}
	}
	const want = int64(2600 * 1500)
	// Receivable cleared by the Verto statement settlement.
	if got := l.balances[l.id(ledger.AccountReceivableVertoMarkup)]; got != 0 {
		t.Fatalf("receivable after settle = %d, want 0 (accrued %d)", got, want)
	}
	rec, _, _ := r.Record(ctx, "t1", revenue.ComponentFXSpread)
	if rec.State != revenue.StateSettled {
		t.Fatalf("state %s", rec.State)
	}
	if err := r.MarkSettled(ctx, "t1", revenue.ComponentPlatformFee, revenue.Settlement{Reference: "sweep-1"}); err != nil {
		t.Fatal(err)
	}
	rec, _, _ = r.Record(ctx, "t1", revenue.ComponentPlatformFee)
	if rec.State != revenue.StateSettled {
		t.Fatalf("fee state %s", rec.State)
	}
	if err := r.MarkSettled(ctx, "nope", revenue.ComponentFXSpread, revenue.Settlement{}); !errors.Is(err, revenue.ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
}

func TestReverse_ReversesBothComponents_Idempotent(t *testing.T) {
	ctx := context.Background()
	r, l, _ := setup()
	_ = r.RecognizeFXSpread(ctx, spreadTrade())
	// The collector charged the fee: wallet debited, revenue credited, unswept credited.
	_ = r.RecognizePlatformFee(ctx, feeCharge(l))
	l.balances["wallet-1"] = -5000
	l.balances["rev-send"] = 5000
	l.balances["unswept-1"] = 5000

	for i := 0; i < 2; i++ {
		if err := r.Reverse(ctx, "t1", "refund"); err != nil {
			t.Fatal(err)
		}
	}
	if l.balances[l.id(ledger.AccountRevenueFxMarkup)] != 0 || l.balances[l.id(ledger.AccountReceivableVertoMarkup)] != 0 {
		t.Fatalf("spread accrual not reversed: rev=%d recv=%d", l.balances[l.id(ledger.AccountRevenueFxMarkup)], l.balances[l.id(ledger.AccountReceivableVertoMarkup)])
	}
	if l.balances["wallet-1"] != 0 || l.balances["rev-send"] != 0 {
		t.Fatalf("platform fee not reversed: wallet=%d rev=%d", l.balances["wallet-1"], l.balances["rev-send"])
	}
	if l.balances["unswept-1"] != 0 {
		t.Fatalf("fees_unswept not released: %d", l.balances["unswept-1"])
	}
	for _, c := range []revenue.Component{revenue.ComponentFXSpread, revenue.ComponentPlatformFee} {
		rec, _, _ := r.Record(ctx, "t1", c)
		if rec.State != revenue.StateReversed {
			t.Fatalf("%s state %s", c, rec.State)
		}
	}
}

func TestReverse_SettledComponentFailsClosed_NothingPartial(t *testing.T) {
	ctx := context.Background()
	r, l, _ := setup()
	_ = r.RecognizeFXSpread(ctx, spreadTrade())
	_ = r.RecognizePlatformFee(ctx, feeCharge(l))
	l.balances["wallet-1"], l.balances["rev-send"], l.balances["unswept-1"] = -5000, 5000, 5000
	_ = r.MarkSettled(ctx, "t1", revenue.ComponentFXSpread, revenue.Settlement{Reference: "s"})

	err := r.Reverse(ctx, "t1", "refund")
	if !errors.Is(err, revenue.ErrSettledNotUndone) {
		t.Fatalf("want ErrSettledNotUndone, got %v", err)
	}
	// Preflight refusal: the (still accrued) fee must not have been reversed alone.
	if l.balances["wallet-1"] != -5000 {
		t.Fatal("partial reversal: fee was reversed although spread could not be")
	}
}

func TestReverse_NothingRecognised(t *testing.T) {
	r, _, _ := setup()
	if err := r.Reverse(context.Background(), "ghost", "x"); err != nil {
		t.Fatalf("nothing to reverse should be a no-op, got %v", err)
	}
}
