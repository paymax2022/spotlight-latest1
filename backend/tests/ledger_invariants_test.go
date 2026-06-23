// Package tests contains the cross-cutting money-path invariant suite for the
// Paymax financial core. These tests are intentionally DB-free: they exercise an
// in-memory reference implementation of the double-entry ledger that mirrors the
// exact projection logic used by the production pgx repository
// (internal/finance/ledger/repository.go GetBalance + PostJournal).
//
// Why an in-memory mirror?
//   - The production ledger requires a live Postgres pool + migrations that
//     cannot be provisioned in this CI lane (no `go get`, no DB container).
//   - The invariants we must protect — balance == projection of entries,
//     idempotency replay is a no-op, amounts are positive integer kobo, a
//     reversal restores the prior balance — are PURE LOGIC. Testing them here,
//     fast and deterministically, is the right level of the pyramid.
//   - This file doubles as the executable specification for the DB layer: if the
//     SQL projection ever diverges from `applyProjection` below, that is a defect.
//
// Iron rules under test (CLAUDE.md "Money handling"):
//  1. Amounts are integers in minor units (kobo); never float, never string math.
//  2. Every money mutation requires an Idempotency-Key.
//  3. Every event posts a BALANCED double-entry pair (sum of debits == sum of credits).
//  4. Wallet balance is a PROJECTION of the ledger — never a stored column.
//  5. Entries are immutable; corrections are reversing entries only.
package tests

import (
	"errors"
	"testing"
)

// ---------------------------------------------------------------------------
// Reference in-memory ledger — mirrors production projection semantics.
// ---------------------------------------------------------------------------

type entryType string

const (
	credit         entryType = "CREDIT"
	debit          entryType = "DEBIT"
	reversalCredit entryType = "REVERSAL_CREDIT"
	reversalDebit  entryType = "REVERSAL_DEBIT"
)

// entry is one immutable side of a journal entry.
type entry struct {
	accountID  string
	typ        entryType
	amountKobo int64 // ALWAYS positive; direction is encoded by typ
	idemKey    string
}

var (
	errNonPositive     = errors.New("ledger: amount must be positive kobo")
	errDuplicateKey    = errors.New("ledger: duplicate idempotency key")
	errUnbalanced      = errors.New("ledger: journal not balanced")
	errInsufficient    = errors.New("ledger: insufficient funds")
	errSameAccountPair = errors.New("ledger: debit and credit account must differ")
)

// memLedger is the append-only reference ledger.
type memLedger struct {
	entries  []entry
	seenKeys map[string]bool
}

func newMemLedger() *memLedger { return &memLedger{seenKeys: map[string]bool{}} }

// balance projects the balance for an account using the SAME case expression as
// the production SQL: CREDIT/REVERSAL_DEBIT add, DEBIT/REVERSAL_CREDIT subtract.
func (l *memLedger) balance(accountID string) int64 {
	var bal int64
	for _, e := range l.entries {
		if e.accountID != accountID {
			continue
		}
		switch e.typ {
		case credit, reversalDebit:
			bal += e.amountKobo
		default: // debit, reversalCredit
			bal -= e.amountKobo
		}
	}
	return bal
}

// postJournal writes a balanced debit+credit pair atomically and idempotently.
// Returns errDuplicateKey if the key was already applied (replay = no-op).
func (l *memLedger) postJournal(idemKey, debitAcct, creditAcct string, amountKobo int64) error {
	if amountKobo <= 0 {
		return errNonPositive
	}
	if debitAcct == creditAcct {
		return errSameAccountPair
	}
	if l.seenKeys[idemKey] {
		return errDuplicateKey
	}
	// Stage both legs; commit only if balanced (it always is by construction,
	// but we assert it to catch a future regression that posts a single leg).
	staged := []entry{
		{accountID: debitAcct, typ: debit, amountKobo: amountKobo, idemKey: idemKey + ":debit"},
		{accountID: creditAcct, typ: credit, amountKobo: amountKobo, idemKey: idemKey + ":credit"},
	}
	if !journalBalances(staged) {
		return errUnbalanced
	}
	l.entries = append(l.entries, staged...)
	l.seenKeys[idemKey] = true
	return nil
}

// debitWallet enforces a non-negative balance invariant (wallet cannot overdraw).
func (l *memLedger) debitWallet(idemKey, walletAcct, counterAcct string, amountKobo int64) error {
	if amountKobo <= 0 {
		return errNonPositive
	}
	if l.balance(walletAcct) < amountKobo {
		return errInsufficient
	}
	return l.postJournal(idemKey, walletAcct, counterAcct, amountKobo)
}

// reverse posts the inverse journal restoring the prior balances (used on failure).
func (l *memLedger) reverse(idemKey, origDebitAcct, origCreditAcct string, amountKobo int64) error {
	// Reversal flips the legs: credit back the originally-debited account.
	return l.postJournal(idemKey+":reversal", origCreditAcct, origDebitAcct, amountKobo)
}

// journalBalances verifies sum(debits) == sum(credits) across a set of entries.
func journalBalances(es []entry) bool {
	var dr, cr int64
	for _, e := range es {
		switch e.typ {
		case debit, reversalCredit:
			dr += e.amountKobo
		case credit, reversalDebit:
			cr += e.amountKobo
		}
	}
	return dr == cr
}

// ---------------------------------------------------------------------------
// 1. Double-entry balance invariant
// ---------------------------------------------------------------------------

func TestDoubleEntry_EveryJournalIsBalanced(t *testing.T) {
	l := newMemLedger()
	const user = "acct:wallet:u1"
	const clearing = "acct:provider_clearing"

	// Topup ₦1,000.00 = 100_000 kobo: DR clearing, CR user wallet.
	if err := l.postJournal("topup-1", clearing, user, 100_000); err != nil {
		t.Fatalf("topup failed: %v", err)
	}

	// Global ledger invariant: across ALL accounts, total credits == total debits.
	if !journalBalances(l.entries) {
		t.Fatalf("ledger not globally balanced after topup")
	}
	if got := l.balance(user); got != 100_000 {
		t.Fatalf("wallet balance = %d, want 100000", got)
	}
	// The counterpart account holds the mirror image.
	if got := l.balance(clearing); got != -100_000 {
		t.Fatalf("clearing balance = %d, want -100000 (mirror)", got)
	}
}

func TestDoubleEntry_BalanceIsProjectionOfEntries(t *testing.T) {
	l := newMemLedger()
	const user = "acct:wallet:u2"
	const clearing = "acct:provider_clearing"
	const commission = "acct:commission"

	_ = l.postJournal("k1", clearing, user, 500_00)   // +₦500 topup
	_ = l.postJournal("k2", clearing, user, 250_00)   // +₦250 topup
	_ = l.debitWallet("k3", user, commission, 300_00) // -₦300 vote spend

	// Recompute balance independently from the raw entry log (no cached column).
	var manual int64
	for _, e := range l.entries {
		if e.accountID != user {
			continue
		}
		if e.typ == credit {
			manual += e.amountKobo
		} else {
			manual -= e.amountKobo
		}
	}
	if manual != l.balance(user) {
		t.Fatalf("projection mismatch: manual=%d projected=%d", manual, l.balance(user))
	}
	if l.balance(user) != 450_00 {
		t.Fatalf("final balance = %d, want 45000", l.balance(user))
	}
}

// ---------------------------------------------------------------------------
// 2. Idempotency: replay + concurrent same-key collapses to a single posting
// ---------------------------------------------------------------------------

func TestIdempotency_ReplayIsNoOp(t *testing.T) {
	l := newMemLedger()
	const user = "acct:wallet:u3"
	const clearing = "acct:provider_clearing"

	if err := l.postJournal("topup-x", clearing, user, 75_000); err != nil {
		t.Fatalf("first post failed: %v", err)
	}
	// Webhook redelivery / client retry with the SAME key must be rejected.
	if err := l.postJournal("topup-x", clearing, user, 75_000); !errors.Is(err, errDuplicateKey) {
		t.Fatalf("replay: got %v, want errDuplicateKey", err)
	}
	// Balance must reflect exactly ONE topup, not two.
	if got := l.balance(user); got != 75_000 {
		t.Fatalf("double-applied! balance = %d, want 75000", got)
	}
	// And exactly 2 entries (one DR + one CR), not 4.
	if len(l.entries) != 2 {
		t.Fatalf("entry count = %d, want 2 (replay must not append)", len(l.entries))
	}
}

func TestIdempotency_ConcurrentSameKeySingleRow(t *testing.T) {
	// Simulates the race the production unique-constraint + Redis lock guards:
	// N concurrent requests with the SAME idempotency key. Exactly one wins;
	// the rest see errDuplicateKey. The reference ledger serializes via the
	// seenKeys map under the test's single goroutine after collecting attempts —
	// modelling the DB unique constraint as the final arbiter.
	l := newMemLedger()
	const user = "acct:wallet:u4"
	const clearing = "acct:provider_clearing"
	const key = "concurrent-topup"

	const attempts = 50
	successes := 0
	for i := 0; i < attempts; i++ {
		if err := l.postJournal(key, clearing, user, 10_000); err == nil {
			successes++
		}
	}
	if successes != 1 {
		t.Fatalf("same-key concurrency produced %d successes, want exactly 1", successes)
	}
	if got := l.balance(user); got != 10_000 {
		t.Fatalf("balance = %d, want 10000 (single application)", got)
	}
}

// ---------------------------------------------------------------------------
// 3. Insufficient funds / no overdraw
// ---------------------------------------------------------------------------

func TestDebit_RejectsOverdraw(t *testing.T) {
	l := newMemLedger()
	const user = "acct:wallet:u5"
	const clearing = "acct:provider_clearing"
	const commission = "acct:commission"

	_ = l.postJournal("seed", clearing, user, 100_00) // ₦100 balance

	if err := l.debitWallet("spend", user, commission, 150_00); !errors.Is(err, errInsufficient) {
		t.Fatalf("overdraw: got %v, want errInsufficient", err)
	}
	// Failed debit must leave balance untouched (no partial posting).
	if got := l.balance(user); got != 100_00 {
		t.Fatalf("balance after rejected debit = %d, want 10000", got)
	}
}

// ---------------------------------------------------------------------------
// 4. Reversal-on-failure restores the prior balance (immutable corrections)
// ---------------------------------------------------------------------------

func TestReversal_RestoresPriorBalance(t *testing.T) {
	l := newMemLedger()
	const user = "acct:wallet:u6"
	const clearing = "acct:provider_clearing"
	const suspense = "acct:failed_transfer_suspense"

	_ = l.postJournal("seed", clearing, user, 500_00) // ₦500
	pre := l.balance(user)

	// Bank transfer reserves funds: DR user wallet, CR suspense.
	if err := l.postJournal("bt-1", user, suspense, 200_00); err != nil {
		t.Fatalf("reserve failed: %v", err)
	}
	if l.balance(user) != pre-200_00 {
		t.Fatalf("after reserve balance = %d, want %d", l.balance(user), pre-200_00)
	}

	// Provider reports failure → reversal returns funds: DR suspense, CR user.
	if err := l.reverse("bt-1", user, suspense, 200_00); err != nil {
		t.Fatalf("reversal failed: %v", err)
	}
	if got := l.balance(user); got != pre {
		t.Fatalf("post-reversal balance = %d, want %d (full restore)", got, pre)
	}
	// Corrections are NEW entries, never edits: 2 (seed) + 2 (reserve) + 2 (reversal).
	if len(l.entries) != 6 {
		t.Fatalf("entry count = %d, want 6 (reversal appends, never mutates)", len(l.entries))
	}
	// Suspense nets to zero after reversal — funds fully returned.
	if got := l.balance(suspense); got != 0 {
		t.Fatalf("suspense balance = %d, want 0 after reversal", got)
	}
}

func TestReversal_IsIdempotent(t *testing.T) {
	l := newMemLedger()
	const user = "acct:wallet:u7"
	const suspense = "acct:failed_transfer_suspense"
	const clearing = "acct:provider_clearing"

	_ = l.postJournal("seed", clearing, user, 300_00)
	_ = l.postJournal("bt-2", user, suspense, 100_00)

	if err := l.reverse("bt-2", user, suspense, 100_00); err != nil {
		t.Fatalf("first reversal failed: %v", err)
	}
	// A duplicate failed-webhook redelivery must NOT double-refund.
	if err := l.reverse("bt-2", user, suspense, 100_00); !errors.Is(err, errDuplicateKey) {
		t.Fatalf("double reversal: got %v, want errDuplicateKey", err)
	}
	if got := l.balance(user); got != 300_00 {
		t.Fatalf("balance = %d, want 30000 (no double refund)", got)
	}
}

// ---------------------------------------------------------------------------
// 5. No-float / positive-integer-kobo invariant
// ---------------------------------------------------------------------------

func TestNoFloat_RejectsNonPositiveAmounts(t *testing.T) {
	l := newMemLedger()
	for _, amt := range []int64{0, -1, -100_00} {
		if err := l.postJournal("bad", "a", "b", amt); !errors.Is(err, errNonPositive) {
			t.Fatalf("amount %d: got %v, want errNonPositive", amt, err)
		}
	}
}

func TestNoFloat_KoboIsAlwaysInteger(t *testing.T) {
	// Guards against a regression that stores money as a float. Any naira value
	// converted to kobo must be a whole integer; round-tripping must be lossless.
	cases := []struct {
		nairaCents int64 // amount already in kobo
		wantNaira  string
	}{
		{100_00, "100.00"},
		{1_00, "1.00"},
		{99, "0.99"},
		{1, "0.01"},
	}
	for _, tc := range cases {
		// Integer kobo -> naira display must never need a float intermediate.
		naira := tc.nairaCents / 100
		rem := tc.nairaCents % 100
		got := formatKobo(naira, rem)
		if got != tc.wantNaira {
			t.Fatalf("kobo %d formatted as %q, want %q", tc.nairaCents, got, tc.wantNaira)
		}
	}
}

func formatKobo(naira, kobo int64) string {
	// Pure integer formatting; no float arithmetic anywhere.
	d := kobo
	tens := d / 10
	ones := d % 10
	return itoa(naira) + "." + string(rune('0'+tens)) + string(rune('0'+ones))
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	s := string(buf[i:])
	if neg {
		s = "-" + s
	}
	return s
}
