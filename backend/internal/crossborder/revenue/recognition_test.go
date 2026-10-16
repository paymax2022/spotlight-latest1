package revenue_test

import (
	"context"
	"fmt"

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
	// real PostReversalPair key shape
	f.entries[key+":rev_debit"] = ledger.Entry{AccountID: restore, Type: ledger.EntryReversalDebit, AmountKobo: amt, Reference: ref}
	f.entries[key+":rev_credit"] = ledger.Entry{AccountID: release, Type: ledger.EntryReversalCredit, AmountKobo: amt, Reference: ref}
	return nil
}

// postCollector emulates what the FeeCollector (strategy A) posted for the
// fixtures in feeCharge: wallet->revenue, then clearing->fees_unswept.
func (f *fakeLedger) postCollector() {
	clearing := f.id(ledger.AccountProviderClearing)
	_ = f.PostJournal(context.Background(), ledger.JournalEntry{Reference: "cb:platform_fee:t1:send", IdempotencyKey: "cb:t1:platform_fee:send",
		AmountKobo: 5000, DebitAccountID: "wallet-1", CreditAccountID: "rev-send"})
	_ = f.PostJournal(context.Background(), ledger.JournalEntry{Reference: "cb:fees_unswept:t1:send", IdempotencyKey: "cb:t1:platform_fee:send:unswept",
		AmountKobo: 5000, DebitAccountID: clearing, CreditAccountID: "unswept-1"})
}

// ledgerBackedCommission reports HasLedger so the construction guard is testable.
type ledgerBackedCommission struct{ fakeCommission }

func (ledgerBackedCommission) HasLedger() bool { return true }

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
