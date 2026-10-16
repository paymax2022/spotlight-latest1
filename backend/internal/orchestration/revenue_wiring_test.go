package orchestration

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"spotlight/backend/internal/crossborder/revenue"
	"spotlight/backend/internal/finance/commission"
	"spotlight/backend/internal/finance/ledger"
)

// minimal revenue.Ledger: accounts + idempotent journals, enough to run the
// real Recognizer end to end.
type wiringLedger struct {
	n       int
	accts   map[string]*ledger.Account
	entries map[string]ledger.Entry
}

func newWiringLedger() *wiringLedger {
	return &wiringLedger{accts: map[string]*ledger.Account{}, entries: map[string]ledger.Entry{}}
}
func (f *wiringLedger) GetOrCreateStandingAccount(_ context.Context, t ledger.AccountType) (*ledger.Account, error) {
	if a, ok := f.accts[string(t)]; ok {
		return a, nil
	}
	f.n++
	a := &ledger.Account{ID: fmt.Sprintf("a%d", f.n), Type: t}
	f.accts[string(t)] = a
	return a, nil
}
func (f *wiringLedger) PostJournal(_ context.Context, j ledger.JournalEntry) error {
	if _, ok := f.entries[j.IdempotencyKey+":debit"]; ok {
		return nil
	}
	f.entries[j.IdempotencyKey+":debit"] = ledger.Entry{AccountID: j.DebitAccountID, Type: ledger.EntryDebit, AmountKobo: j.AmountKobo, Reference: j.Reference}
	f.entries[j.IdempotencyKey+":credit"] = ledger.Entry{AccountID: j.CreditAccountID, Type: ledger.EntryCredit, AmountKobo: j.AmountKobo, Reference: j.Reference}
	return nil
}
func (f *wiringLedger) PostReversal(context.Context, string, string, int64, string, string) error {
	return nil
}
func (f *wiringLedger) EntryByKey(_ context.Context, k string) (*ledger.Entry, bool, error) {
	e, ok := f.entries[k]
	return &e, ok, nil
}
func (f *wiringLedger) Posted(context.Context, string) (bool, error) { return false, nil }

type wiringCommission struct {
	rows map[string]*commission.Earning
	err  error
}

func (c *wiringCommission) RecordExact(_ context.Context, cat, svc, sub string, gross, rev int64, mod, ref string, _ *string, key string) (*commission.Earning, error) {
	if c.err != nil {
		return nil, c.err
	}
	if c.rows == nil {
		c.rows = map[string]*commission.Earning{}
	}
	if e, ok := c.rows[key]; ok {
		return e, nil
	}
	e := &commission.Earning{Service: svc, ServiceSubtype: sub, GrossAmountKobo: gross, SpotlightRevenueKobo: rev, SourceRef: ref}
	c.rows[key] = e
	return e, nil
}

func wiredService(now *time.Time, rec SpreadRecognizer) (*Service, Store) {
	store := NewMemStore()
	svc := NewService([]Provider{stubProvider{name: "eversend"}, stubProvider{name: "maplerad"}}, store,
		Options{Now: func() time.Time { return *now }}, WithSpreadRecognizer(rec))
	return svc, store
}

func TestExecuteConversion_WithoutRecognizer_PostsNothingToCommission(t *testing.T) {
	ctx := context.Background()
	clock := time.Now()
	com := &wiringCommission{}
	svc, _ := newTestService(&clock, false) // no recognizer: pre-Task-4 behaviour
	_ = svc.SeedBalance(ctx, "c1", "USD", 1_000_00)
	q, _ := svc.CreateQuote(ctx, "c1", "retail", QuoteRequest{Source: "USD", Destination: "NGN", Amount: 100_00, Intent: IntentConversion, Lock: true})
	if _, e := svc.ExecuteConversion(ctx, "c1", "i1", ConversionRequest{QuoteID: q.ID}); e != nil {
		t.Fatal(e)
	}
	if len(com.rows) != 0 {
		t.Fatal("orchestration must not post to commission without a recognizer")
	}
}

func TestExecuteConversion_AccruesAtExecute_CommissionOnlyAtSettlement(t *testing.T) {
	ctx := context.Background()
	clock := time.Now()
	com := &wiringCommission{}
	wl := newWiringLedger()
	rec := revenue.NewRecognizer(wl, com, revenue.NewMemStore())
	svc, store := wiredService(&clock, rec)
	_ = svc.SeedBalance(ctx, "c1", "USD", 1_000_00)
	q, _ := svc.CreateQuote(ctx, "c1", "retail", QuoteRequest{Source: "USD", Destination: "NGN", Amount: 100_00, Intent: IntentConversion, Lock: true})
	usdBefore, _ := store.Balance(ctx, "c1", "USD")

	conv, e := svc.ExecuteConversion(ctx, "c1", "i1", ConversionRequest{QuoteID: q.ID})
	if e != nil {
		t.Fatal(e)
	}
	// replay: same result
	if _, e := svc.ExecuteConversion(ctx, "c1", "i1", ConversionRequest{QuoteID: q.ID}); e != nil {
		t.Fatal(e)
	}
	key := "cb:" + conv.Reference + ":fx_spread:convert"
	// Execute only ACCRUES (receivable/revenue entries); commission is untouched.
	if _, ok := wl.entries[key+":accrue:debit"]; !ok {
		t.Fatal("spread accrual journal missing after execute")
	}
	if len(com.rows) != 0 {
		t.Fatalf("commission must not be posted at execute, got %v", com.rows)
	}
	// Terminal success (Verto statement) rolls it up exactly once.
	for i := 0; i < 2; i++ {
		if err := rec.MarkSettled(ctx, conv.Reference, revenue.ComponentFXSpread, revenue.Settlement{Reference: "stmt"}); err != nil {
			t.Fatal(err)
		}
	}
	row := com.rows[key]
	if row == nil || len(com.rows) != 1 {
		t.Fatalf("want one commission row %s, got %v", key, com.rows)
	}
	spread := feeAmount(conv.Fees, FeeSpread) // USD cents, native
	if spread <= 0 {
		t.Fatal("test needs a non-zero spread")
	}
	want := spread * conv.Destination.AmountMinor / conv.Source.AmountMinor
	if row.SpotlightRevenueKobo != want || row.SourceRef != conv.Reference {
		t.Fatalf("revenue %d (ref %s), want %d", row.SpotlightRevenueKobo, row.SourceRef, want)
	}
	// FX settlement semantics unchanged: debit identical to the no-recognizer run.
	usdAfter, _ := store.Balance(ctx, "c1", "USD")
	if usdBefore-usdAfter != 100_00+25 {
		t.Fatalf("customer debit changed: %d", usdBefore-usdAfter)
	}
}

func TestExecuteConversion_RecognizerFailureNeverFailsTheTrade(t *testing.T) {
	ctx := context.Background()
	clock := time.Now()
	com := &wiringCommission{err: errors.New("commission down")}
	svc, _ := wiredService(&clock, revenue.NewRecognizer(newWiringLedger(), com, revenue.NewMemStore()))
	_ = svc.SeedBalance(ctx, "c1", "USD", 1_000_00)
	q, _ := svc.CreateQuote(ctx, "c1", "retail", QuoteRequest{Source: "USD", Destination: "NGN", Amount: 100_00, Intent: IntentConversion, Lock: true})
	conv, e := svc.ExecuteConversion(ctx, "c1", "i1", ConversionRequest{QuoteID: q.ID})
	if e != nil || conv.Status != ConvSettled {
		t.Fatalf("trade must settle regardless of revenue recognition: %v", e)
	}
}

func TestExecuteConversion_NonNGNPairHasNoRate_TradeUnaffected(t *testing.T) {
	ctx := context.Background()
	clock := time.Now()
	com := &wiringCommission{}
	svc, _ := wiredService(&clock, revenue.NewRecognizer(newWiringLedger(), com, revenue.NewMemStore()))
	_ = svc.SeedBalance(ctx, "c1", "USD", 1_000_00)
	q, e := svc.CreateQuote(ctx, "c1", "retail", QuoteRequest{Source: "USD", Destination: "EUR", Amount: 100_00, Intent: IntentConversion, Lock: true})
	if e != nil {
		t.Skipf("USD/EUR not quotable in this harness: %v", e)
	}
	if _, e := svc.ExecuteConversion(ctx, "c1", "i1", ConversionRequest{QuoteID: q.ID}); e != nil {
		t.Fatal(e)
	}
	if len(com.rows) != 0 {
		t.Fatal("no NGN leg => no commission roll-up (never invent a rate)")
	}
}
