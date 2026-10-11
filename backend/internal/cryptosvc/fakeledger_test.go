package cryptosvc

import (
	"context"
	"fmt"
	"sync"

	"spotlight/backend/internal/finance/ledger"
)

// fakeLedger models the ledger semantics the settler relies on: credit-normal
// balances, two entries per journal under key+":debit"/":credit" (reversals under
// ":rev_debit"/":rev_credit"), identity-verified replay (identical = nil success,
// different journal = ErrDuplicate) and the sufficiency gate on gated debits.
type fakeLedger struct {
	mu       sync.Mutex
	accounts map[string]*ledger.Account // by "user:<id>" or "std:<type>"
	balance  map[string]int64
	entries  map[string]ledger.Entry
	posted   []string // journal base keys in order
	seq      int

	// duplicateFirst makes the Redis-style fast path return ErrDuplicate for a key
	// that is already durably posted, without verifying identity (the real service does).
	duplicateOnReplay bool
	claimOnly         map[string]bool // keys the cache "claimed" but never posted: answer ErrDuplicate
	failKey           string          // return this error for a journal with this base key
	failErr           error
}

func newFakeLedger() *fakeLedger {
	return &fakeLedger{accounts: map[string]*ledger.Account{}, balance: map[string]int64{}, entries: map[string]ledger.Entry{}}
}

func (f *fakeLedger) acct(key string, t ledger.AccountType, user *string) *ledger.Account {
	if a, ok := f.accounts[key]; ok {
		return a
	}
	f.seq++
	a := &ledger.Account{ID: fmt.Sprintf("acc-%d", f.seq), Type: t, UserID: user}
	f.accounts[key] = a
	return a
}

func (f *fakeLedger) GetOrCreateUserWallet(_ context.Context, userID string) (*ledger.Account, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.acct("user:"+userID, ledger.AccountUserWallet, &userID), nil
}

func (f *fakeLedger) GetOrCreateStandingAccount(_ context.Context, t ledger.AccountType) (*ledger.Account, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.acct("std:"+string(t), t, nil), nil
}

func (f *fakeLedger) fund(userID string, kobo int64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.balance[f.acct("user:"+userID, ledger.AccountUserWallet, &userID).ID] += kobo
}

func (f *fakeLedger) bal(key string) int64 {
	f.mu.Lock()
	defer f.mu.Unlock()
	if a, ok := f.accounts[key]; ok {
		return f.balance[a.ID]
	}
	return 0
}

func (f *fakeLedger) total() int64 {
	f.mu.Lock()
	defer f.mu.Unlock()
	var s int64
	for _, b := range f.balance {
		s += b
	}
	return s
}

func (f *fakeLedger) PostJournal(_ context.Context, j ledger.JournalEntry) error {
	return f.post(j, false)
}

func (f *fakeLedger) PostJournalGated(_ context.Context, j ledger.JournalEntry, _ string) error {
	return f.post(j, true)
}

func (f *fakeLedger) post(j ledger.JournalEntry, gated bool) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.failKey != "" && j.IdempotencyKey == f.failKey {
		return f.failErr
	}
	if j.AmountKobo <= 0 {
		return fmt.Errorf("ledger: amount must be positive kobo, got %d", j.AmountKobo)
	}
	if f.claimOnly[j.IdempotencyKey] {
		return ledger.ErrDuplicate
	}
	d, hasD := f.entries[j.IdempotencyKey+":debit"]
	c, hasC := f.entries[j.IdempotencyKey+":credit"]
	if hasD || hasC {
		if f.duplicateOnReplay {
			return ledger.ErrDuplicate
		}
		same := hasD && hasC && d.AccountID == j.DebitAccountID && d.AmountKobo == j.AmountKobo && d.Reference == j.Reference &&
			c.AccountID == j.CreditAccountID && c.AmountKobo == j.AmountKobo && c.Reference == j.Reference
		if same {
			return nil
		}
		return ledger.ErrDuplicate
	}
	if gated && f.balance[j.DebitAccountID] < j.AmountKobo {
		return ledger.ErrInsufficientFunds
	}
	f.entries[j.IdempotencyKey+":debit"] = ledger.Entry{AccountID: j.DebitAccountID, Type: ledger.EntryDebit, AmountKobo: j.AmountKobo, Reference: j.Reference, IdempotencyKey: j.IdempotencyKey + ":debit"}
	f.entries[j.IdempotencyKey+":credit"] = ledger.Entry{AccountID: j.CreditAccountID, Type: ledger.EntryCredit, AmountKobo: j.AmountKobo, Reference: j.Reference, IdempotencyKey: j.IdempotencyKey + ":credit"}
	f.balance[j.DebitAccountID] -= j.AmountKobo
	f.balance[j.CreditAccountID] += j.AmountKobo
	f.posted = append(f.posted, j.IdempotencyKey)
	return nil
}

func (f *fakeLedger) PostReversal(_ context.Context, restore, release string, amt int64, ref, key string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if amt <= 0 {
		return fmt.Errorf("ledger: reversal amount must be positive, got %d", amt)
	}
	if _, ok := f.entries[key+":rev_debit"]; ok {
		return ledger.ErrDuplicate
	}
	f.entries[key+":rev_debit"] = ledger.Entry{AccountID: restore, Type: ledger.EntryReversalDebit, AmountKobo: amt, Reference: ref, IdempotencyKey: key + ":rev_debit"}
	f.entries[key+":rev_credit"] = ledger.Entry{AccountID: release, Type: ledger.EntryReversalCredit, AmountKobo: amt, Reference: ref, IdempotencyKey: key + ":rev_credit"}
	f.balance[restore] += amt
	f.balance[release] -= amt
	f.posted = append(f.posted, key)
	return nil
}

func (f *fakeLedger) EntryByKey(_ context.Context, key string) (*ledger.Entry, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	e, ok := f.entries[key]
	if !ok {
		return nil, false, nil
	}
	return &e, true, nil
}
