// Package revenue recognises cross-border (SP-3a) revenue: the FX spread
// (native-currency line + receivable accrual, spec §4 D1) and the L1 platform
// fee (spec §7), rolls both up to NGN into the commission registry, settles
// them (accrued -> settled) and reverses BOTH on a failed/refunded transfer.
//
// Decision D3: revenue is recognised in its NATIVE currency (the orchestration
// book already holds the per-currency `paymax_spread` line at execution) and
// rolled up to NGN kobo for the single-currency main ledger and the commission
// registry. The main ledger is NGN-kobo only, so every main-ledger amount posted
// here is the NGN equivalent, computed with the trade's own recorded rate by
// integer/rational math (no floats on amounts). The native currency, native
// amount and rate are recorded on the Record (and in the journal reference), not
// on the commission row, which stays NGN-only; join on source_ref = transfer id.
//
// D1: the spread is recognised ONCE. The accrual mirrors the receivable owed by
// Verto (the fxMarkupPerc value); it is not a second charge to the customer.
package revenue

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"sync"

	"spotlight/backend/internal/finance/commission"
	"spotlight/backend/internal/finance/ledger"
)

// Component names a revenue component of one transfer.
type Component string

const (
	ComponentFXSpread    Component = "fx_spread"
	ComponentPlatformFee Component = "platform_fee"
)

// State is the lifecycle of one recognised component.
type State string

const (
	StateAccrued  State = "ACCRUED"
	StateSettled  State = "SETTLED"
	StateReversed State = "REVERSED"
)

var (
	ErrInvalid          = errors.New("revenue: invalid input")
	ErrNoNGNRate        = errors.New("revenue: no NGN conversion rate on the trade; NGN roll-up not posted")
	ErrNotFound         = errors.New("revenue: component not recognised")
	ErrInvalidState     = errors.New("revenue: invalid state transition")
	ErrSettledNotUndone = errors.New("revenue: component already settled; reversal needs a clawback, not a ledger reversal")
)

// Ledger is the slice of *ledger.Service this package needs.
type Ledger interface {
	GetOrCreateStandingAccount(ctx context.Context, t ledger.AccountType) (*ledger.Account, error)
	PostJournal(ctx context.Context, j ledger.JournalEntry) error
	PostReversal(ctx context.Context, restoreAccountID, releaseAccountID string, amountKobo int64, reference, idempotencyKey string) error
	EntryByKey(ctx context.Context, idempotencyKey string) (*ledger.Entry, bool, error)
	Posted(ctx context.Context, baseIdempotencyKey string) (bool, error)
}

var _ Ledger = (*ledger.Service)(nil)

// CommissionRecorder is the NGN roll-up target (satisfied by *commission.Service).
type CommissionRecorder interface {
	RecordExact(ctx context.Context, category, service, subtype string, grossKobo, recordedRevenueKobo int64,
		sourceModule, sourceRef string, userID *string, idempotencyKey string) (*commission.Earning, error)
}

var _ CommissionRecorder = (*commission.Service)(nil)

// Rate converts native minor units to NGN kobo: kobo = native * Num / Den
// (floor). It is the ratio of the trade's own destination/source minor amounts,
// so it already carries the currencies' minor-unit scales.
type Rate struct{ Num, Den int64 }

// NGN is the identity rate.
var NGN = Rate{1, 1}

func (r Rate) valid() bool { return r.Num > 0 && r.Den > 0 }

// Apply returns floor(native*Num/Den) using big integers (no overflow, no float).
func (r Rate) Apply(native int64) int64 {
	v := new(big.Int).Mul(big.NewInt(native), big.NewInt(r.Num))
	v.Quo(v, big.NewInt(r.Den))
	return v.Int64()
}

// Record is the native-currency revenue line plus its NGN roll-up and state.
type Record struct {
	TransferID string
	Component  Component
	Service    string
	UserID     string
	State      State

	Currency    string // native currency of the revenue line
	NativeMinor int64  // revenue in native minor units (spread + fixed)
	Rate        Rate   // native -> NGN kobo used for the roll-up
	NGNMinor    int64  // NGN-equivalent revenue (main ledger + commission)
	GrossNGN    int64  // NGN-equivalent trade amount (commission gross)

	AccrueKey     string // base ledger key of the accrual journal (spread)
	CommissionKey string // cb:{transfer}:{component}:{service}

	// Platform fee wiring from fees.Result (needed to reverse / settle).
	FeeKey           string
	UnsweptKey       string
	WalletAccountID  string
	RevenueAccountID string
	UnsweptAccountID string
}

// Store persists Records keyed by (transfer, component).
type Store interface {
	// Put stores r if absent and returns the stored record (existing wins, so
	// replays never reset state).
	Put(ctx context.Context, r Record) (Record, error)
	Get(ctx context.Context, transferID string, c Component) (Record, bool, error)
	List(ctx context.Context, transferID string) ([]Record, error)
	SetState(ctx context.Context, transferID string, c Component, s State) error
}

// MemStore is an in-process Store. NOTE: a durable store needs a table (no
// migration in Task 4); until then recognitions do not survive a restart.
type MemStore struct {
	mu sync.Mutex
	m  map[string]Record
}

func NewMemStore() *MemStore { return &MemStore{m: map[string]Record{}} }

func skey(t string, c Component) string { return t + "|" + string(c) }

func (s *MemStore) Put(_ context.Context, r Record) (Record, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if ex, ok := s.m[skey(r.TransferID, r.Component)]; ok {
		return ex, nil
	}
	s.m[skey(r.TransferID, r.Component)] = r
	return r, nil
}

func (s *MemStore) Get(_ context.Context, t string, c Component) (Record, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.m[skey(t, c)]
	return r, ok, nil
}

func (s *MemStore) List(_ context.Context, t string) ([]Record, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []Record
	for _, c := range []Component{ComponentFXSpread, ComponentPlatformFee} {
		if r, ok := s.m[skey(t, c)]; ok {
			out = append(out, r)
		}
	}
	return out, nil
}

func (s *MemStore) SetState(_ context.Context, t string, c Component, st State) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.m[skey(t, c)]
	if !ok {
		return ErrNotFound
	}
	r.State = st
	s.m[skey(t, c)] = r
	return nil
}

// postVerified posts j and converges on a replay: a duplicate is accepted only
// if both legs of THIS journal exist (a foreign claim on the key is an error).
func postVerified(ctx context.Context, l Ledger, j ledger.JournalEntry) error {
	err := l.PostJournal(ctx, j)
	if !errors.Is(err, ledger.ErrDuplicate) {
		return err
	}
	for _, leg := range []struct {
		suffix, acct string
		typ          ledger.EntryType
	}{{":debit", j.DebitAccountID, ledger.EntryDebit}, {":credit", j.CreditAccountID, ledger.EntryCredit}} {
		e, ok, gerr := l.EntryByKey(ctx, j.IdempotencyKey+leg.suffix)
		if gerr != nil {
			return gerr
		}
		if !ok || e.AccountID != leg.acct || e.Type != leg.typ || e.AmountKobo != j.AmountKobo || e.Reference != j.Reference {
			return fmt.Errorf("%w (replay not verified: leg %s%s differs)", err, j.IdempotencyKey, leg.suffix)
		}
	}
	return nil
}
