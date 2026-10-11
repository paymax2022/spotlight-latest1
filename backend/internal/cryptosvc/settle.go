package cryptosvc

import (
	"context"
	"errors"
	"fmt"

	"github.com/shopspring/decimal"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/money"
)

// Side says which NGN legs a swap has.
type Side string

const (
	SideBuy  Side = "buy"  // NGN -> crypto
	SideSell Side = "sell" // crypto -> NGN
	SideSwap Side = "swap" // crypto -> crypto: no NGN leg, nothing to post
)

// Ledger is the slice of the finance ledger the settler uses. *ledger.Service satisfies it.
type Ledger interface {
	GetOrCreateUserWallet(ctx context.Context, userID string) (*ledger.Account, error)
	GetOrCreateStandingAccount(ctx context.Context, t ledger.AccountType) (*ledger.Account, error)
	PostJournal(ctx context.Context, j ledger.JournalEntry) error
	PostJournalGated(ctx context.Context, j ledger.JournalEntry, walletLockKey string) error
	PostReversal(ctx context.Context, restoreAccountID, releaseAccountID string, amountKobo int64, reference, idempotencyKey string) error
	EntryByKey(ctx context.Context, idempotencyKey string) (*ledger.Entry, bool, error)
}

// SwapLedgerInput is what the settler needs to post one swap.
type SwapLedgerInput struct {
	SwapID  string
	UserID  string
	Side    Side
	NGNKobo int64
	FeeKobo int64
	FeeBps  int
}

// ErrReplayMismatch means a ledger key already holds a DIFFERENT journal than the one
// we meant to post. Existence of a key never proves our own posting landed.
var ErrReplayMismatch = fmt.Errorf("%w: ledger key holds a different journal", ErrPermanent)

// ErrSettlementConflict means the swap is already settled the other way (for
// example a completion arriving for a swap whose hold was released).
var ErrSettlementConflict = fmt.Errorf("%w: swap already settled the other way", ErrPermanent)

// ErrNoHold means a completion arrived for a buy whose NGN hold was never posted.
var ErrNoHold = fmt.Errorf("%w: no NGN hold exists for this swap", ErrPermanent)

// ErrPermanent marks a settlement error that retrying can never fix. The webhook path
// parks such a swap in needs_review for a human instead of retrying forever.
var ErrPermanent = errors.New("cryptosvc: permanent settlement error")

// ErrClaimedNotPosted means the cache layer claimed a ledger key whose legs are not
// durable yet (the first attempt failed after claiming). It heals on retry.
var ErrClaimedNotPosted = errors.New("cryptosvc: ledger key claimed but not posted yet; retry")

// SwapLocker serialises settlement for one swap across processes. CompleteBuy and
// FailBuy each check-then-post; without a shared lock two racing resolvers (a webhook
// and a reconciler or a human resolving needs_review) could both pass their checks and
// post contradictory outcomes. fn runs while the lock is held.
type SwapLocker interface {
	WithSwapLock(ctx context.Context, swapID string, fn func(ctx context.Context) error) error
}

// DefaultSlippageBps bounds a sell payout against the quoted proceeds (5%).
const DefaultSlippageBps = 500

// Settler posts the NGN legs of crypto swaps to the finance ledger (ADR-PR709).
//
// Model: wallet NGN is parked in the crypto_clearing standing account when a buy is
// confirmed (principal + platform fee). On provider completion the fee is recognised
// as revenue; on provider failure the whole hold is reversed to the wallet. A sell
// pays the wallet the provider's received NGN minus the fee, drawn from clearing.
// Clearing mirrors NGN held at the provider; treasury moves the real money.
//
// Every journal has a deterministic key (crypto:swap:<id>:<leg>) and every replay is
// identity-verified, never trusted on key existence. Callers post ledger first and
// move swap state last, so a crash converges on retry.
type Settler struct {
	led         Ledger
	locker      SwapLocker
	slippageBps int
}

// NewSettler builds a settler over a ledger.
func NewSettler(led Ledger) *Settler { return &Settler{led: led, slippageBps: DefaultSlippageBps} }

// WithLocker makes completion and release mutually exclusive per swap. Production
// wiring MUST set it (see PGSwapLocker); tests of single-threaded paths may omit it.
func (s *Settler) WithLocker(l SwapLocker) *Settler { s.locker = l; return s }

// WithSlippageBps overrides the allowed sell-payout deviation from the quote.
func (s *Settler) WithSlippageBps(bps int) *Settler { s.slippageBps = bps; return s }

func (s *Settler) locked(ctx context.Context, swapID string, fn func(ctx context.Context) error) error {
	if s.locker == nil {
		return fn(ctx)
	}
	return s.locker.WithSwapLock(ctx, swapID, fn)
}

func swapRef(id string) string      { return "crypto:swap:" + id }
func swapKey(id, leg string) string { return "crypto:swap:" + id + ":" + leg }

func (in SwapLedgerInput) validate() error {
	switch {
	case in.SwapID == "":
		return errors.New("cryptosvc: swap id is required")
	case in.UserID == "":
		return errors.New("cryptosvc: user id is required")
	case in.NGNKobo <= 0:
		return errors.New("cryptosvc: NGN amount must be positive kobo")
	case in.FeeKobo < 0 || in.FeeKobo > in.NGNKobo:
		return errors.New("cryptosvc: fee must be between 0 and the NGN amount")
	}
	return nil
}

type accounts struct{ wallet, clearing, revenue *ledger.Account }

func (s *Settler) accounts(ctx context.Context, userID string) (accounts, error) {
	w, err := s.led.GetOrCreateUserWallet(ctx, userID)
	if err != nil {
		return accounts{}, fmt.Errorf("cryptosvc: wallet account: %w", err)
	}
	c, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountCryptoClearing)
	if err != nil {
		return accounts{}, fmt.Errorf("cryptosvc: clearing account: %w", err)
	}
	r, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		return accounts{}, fmt.Errorf("cryptosvc: revenue account: %w", err)
	}
	return accounts{w, c, r}, nil
}

// verifyJournal confirms key already holds exactly j (both legs).
func (s *Settler) verifyJournal(ctx context.Context, j ledger.JournalEntry) (bool, error) {
	d, dok, err := s.led.EntryByKey(ctx, j.IdempotencyKey+":debit")
	if err != nil {
		return false, err
	}
	c, cok, err := s.led.EntryByKey(ctx, j.IdempotencyKey+":credit")
	if err != nil {
		return false, err
	}
	if !dok && !cok {
		return false, nil
	}
	if dok && cok &&
		d.AccountID == j.DebitAccountID && d.Type == ledger.EntryDebit && d.AmountKobo == j.AmountKobo && d.Reference == j.Reference &&
		c.AccountID == j.CreditAccountID && c.Type == ledger.EntryCredit && c.AmountKobo == j.AmountKobo && c.Reference == j.Reference {
		return true, nil
	}
	return false, fmt.Errorf("%w: %s", ErrReplayMismatch, j.IdempotencyKey)
}

// post writes j idempotently. ErrDuplicate is NOT success: the cache layer answers it
// for any claimed key, so it is resolved by comparing the recorded legs to j.
func (s *Settler) post(ctx context.Context, j ledger.JournalEntry, gatedWalletKey string) error {
	var err error
	if gatedWalletKey != "" {
		err = s.led.PostJournalGated(ctx, j, gatedWalletKey)
	} else {
		err = s.led.PostJournal(ctx, j)
	}
	if err == nil {
		return nil
	}
	if !errors.Is(err, ledger.ErrDuplicate) {
		return err
	}
	same, verr := s.verifyJournal(ctx, j)
	if verr != nil {
		return verr
	}
	if !same {
		// Neither leg is durable: the key was only claimed by a failed earlier attempt.
		return fmt.Errorf("%w: %s", ErrClaimedNotPosted, j.IdempotencyKey)
	}
	return nil
}

func (s *Settler) holdJournal(in SwapLedgerInput, a accounts) (ledger.JournalEntry, error) {
	total, err := money.Kobo(in.NGNKobo).Add(money.Kobo(in.FeeKobo))
	if err != nil {
		return ledger.JournalEntry{}, err
	}
	return ledger.JournalEntry{
		Reference: swapRef(in.SwapID), IdempotencyKey: swapKey(in.SwapID, "hold"), AmountKobo: int64(total),
		DebitAccountID: a.wallet.ID, CreditAccountID: a.clearing.ID,
		Description: "crypto buy: NGN parked in clearing",
	}, nil
}

func (s *Settler) feeJournal(in SwapLedgerInput, a accounts, amount int64) ledger.JournalEntry {
	return ledger.JournalEntry{
		Reference: swapRef(in.SwapID), IdempotencyKey: swapKey(in.SwapID, "fee"), AmountKobo: amount,
		DebitAccountID: a.clearing.ID, CreditAccountID: a.revenue.ID,
		Description: "crypto swap fee recognised",
	}
}

// HoldBuy debits the user's wallet (principal + fee, tier-gated, balance-checked under
// the wallet lock) into clearing. Call it when the buy is confirmed with the provider.
func (s *Settler) HoldBuy(ctx context.Context, in SwapLedgerInput) error {
	if in.Side != SideBuy {
		return fmt.Errorf("cryptosvc: HoldBuy needs side %q, got %q", SideBuy, in.Side)
	}
	if err := in.validate(); err != nil {
		return err
	}
	a, err := s.accounts(ctx, in.UserID)
	if err != nil {
		return err
	}
	j, err := s.holdJournal(in, a)
	if err != nil {
		return err
	}
	return s.post(ctx, j, in.UserID)
}

// releasePosted reports whether the hold was already reversed, verifying identity.
func (s *Settler) releasePosted(ctx context.Context, in SwapLedgerInput, a accounts, total int64) (bool, error) {
	key := swapKey(in.SwapID, "release")
	d, dok, err := s.led.EntryByKey(ctx, key+":rev_debit")
	if err != nil {
		return false, err
	}
	c, cok, err := s.led.EntryByKey(ctx, key+":rev_credit")
	if err != nil {
		return false, err
	}
	if !dok && !cok {
		return false, nil
	}
	ref := swapRef(in.SwapID)
	if dok && cok &&
		d.AccountID == a.wallet.ID && d.Type == ledger.EntryReversalDebit && d.AmountKobo == total && d.Reference == ref &&
		c.AccountID == a.clearing.ID && c.Type == ledger.EntryReversalCredit && c.AmountKobo == total && c.Reference == ref {
		return true, nil
	}
	return false, fmt.Errorf("%w: %s", ErrReplayMismatch, key)
}

// CompleteBuy recognises the fee (clearing -> revenue) once the provider confirms. The
// hold must exist and must not have been released.
func (s *Settler) CompleteBuy(ctx context.Context, in SwapLedgerInput) error {
	if err := in.validate(); err != nil {
		return err
	}
	return s.locked(ctx, in.SwapID, func(ctx context.Context) error { return s.completeBuy(ctx, in) })
}

func (s *Settler) completeBuy(ctx context.Context, in SwapLedgerInput) error {
	a, err := s.accounts(ctx, in.UserID)
	if err != nil {
		return err
	}
	hold, err := s.holdJournal(in, a)
	if err != nil {
		return err
	}
	held, err := s.verifyJournal(ctx, hold)
	if err != nil {
		return err
	}
	if !held {
		return ErrNoHold
	}
	released, err := s.releasePosted(ctx, in, a, hold.AmountKobo)
	if err != nil {
		return err
	}
	if released {
		return fmt.Errorf("%w: hold was released", ErrSettlementConflict)
	}
	if in.FeeKobo == 0 {
		return nil
	}
	return s.post(ctx, s.feeJournal(in, a, in.FeeKobo), "")
}

// FailBuy reverses the whole hold to the wallet. With no hold it is a no-op (nothing
// was ever taken, so nothing may be given back); after the fee was recognised it is
// refused.
func (s *Settler) FailBuy(ctx context.Context, in SwapLedgerInput) error {
	if err := in.validate(); err != nil {
		return err
	}
	return s.locked(ctx, in.SwapID, func(ctx context.Context) error { return s.failBuy(ctx, in) })
}

func (s *Settler) failBuy(ctx context.Context, in SwapLedgerInput) error {
	a, err := s.accounts(ctx, in.UserID)
	if err != nil {
		return err
	}
	hold, err := s.holdJournal(in, a)
	if err != nil {
		return err
	}
	held, err := s.verifyJournal(ctx, hold)
	if err != nil {
		return err
	}
	if !held {
		return nil
	}
	released, err := s.releasePosted(ctx, in, a, hold.AmountKobo)
	if err != nil {
		return err
	}
	if released {
		return nil
	}
	if in.FeeKobo > 0 {
		if _, found, ferr := s.led.EntryByKey(ctx, swapKey(in.SwapID, "fee")+":credit"); ferr != nil {
			return ferr
		} else if found {
			return fmt.Errorf("%w: fee already recognised", ErrSettlementConflict)
		}
	}
	err = s.led.PostReversal(ctx, a.wallet.ID, a.clearing.ID, hold.AmountKobo, swapRef(in.SwapID), swapKey(in.SwapID, "release"))
	if err != nil && !errors.Is(err, ledger.ErrDuplicate) {
		return err
	}
	if err != nil { // ErrDuplicate: confirm the recorded reversal is ours
		if ok, verr := s.releasePosted(ctx, in, a, hold.AmountKobo); verr != nil || !ok {
			if verr == nil {
				verr = ErrReplayMismatch
			}
			return verr
		}
	}
	return nil
}

// CompleteSell pays the wallet the provider's received NGN minus the fee, drawn from
// clearing, and recognises the fee. received is the NGN the provider reports; it must
// be a whole number of kobo (a fraction is refused, never rounded).
func (s *Settler) CompleteSell(ctx context.Context, in SwapLedgerInput, received decimal.Decimal) error {
	if in.SwapID == "" || in.UserID == "" {
		return errors.New("cryptosvc: swap id and user id are required")
	}
	if !received.IsPositive() {
		return fmt.Errorf("%w: sell proceeds must be positive", ErrPermanent)
	}
	scaled := received.Mul(decimal.NewFromInt(100))
	if !scaled.IsInteger() || scaled.GreaterThan(decimal.NewFromInt(1<<62)) {
		return fmt.Errorf("%w: sell proceeds are not a whole number of kobo", ErrPermanent)
	}
	gross := scaled.IntPart()
	if in.NGNKobo <= 0 {
		return fmt.Errorf("%w: a sell needs its quoted NGN to bound the payout", ErrPermanent)
	}
	// The provider's number is authoritative, but never unbounded: a payout far from the
	// quote is a provider bug or a bad read and goes to a human.
	diff := gross - in.NGNKobo
	if diff < 0 {
		diff = -diff
	}
	if decimal.NewFromInt(diff).Mul(decimal.NewFromInt(10_000)).GreaterThan(decimal.NewFromInt(in.NGNKobo).Mul(decimal.NewFromInt(int64(s.slippageBps)))) {
		return fmt.Errorf("%w: proceeds %d kobo are outside the %d bps band around the quoted %d", ErrPermanent, gross, s.slippageBps, in.NGNKobo)
	}
	fee, err := FeeKobo(gross, in.FeeBps)
	if err != nil {
		return err
	}
	net := gross - fee
	if net <= 0 {
		return fmt.Errorf("%w: sell proceeds do not cover the fee", ErrPermanent)
	}
	a, err := s.accounts(ctx, in.UserID)
	if err != nil {
		return err
	}
	return s.locked(ctx, in.SwapID, func(ctx context.Context) error {
		payout := ledger.JournalEntry{
			Reference: swapRef(in.SwapID), IdempotencyKey: swapKey(in.SwapID, "payout"), AmountKobo: net,
			DebitAccountID: a.clearing.ID, CreditAccountID: a.wallet.ID,
			Description: "crypto sell: proceeds paid to wallet",
		}
		if err := s.post(ctx, payout, ""); err != nil {
			return err
		}
		if fee == 0 {
			return nil
		}
		return s.post(ctx, s.feeJournal(SwapLedgerInput{SwapID: in.SwapID}, a, fee), "")
	})
}

// requireNoHold guards the no-NGN-leg side: a swap row that says "no NGN legs" but has
// a hold in the ledger is a data error (for example a buy inserted without a side, which
// defaults to 'swap'). Skipping it would strand the user's NGN in clearing.
func (s *Settler) requireNoHold(ctx context.Context, rec SwapRecord) error {
	if _, found, err := s.led.EntryByKey(ctx, swapKey(rec.ID, "hold")+":debit"); err != nil {
		return err
	} else if found {
		return fmt.Errorf("%w: swap %s has side %q but an NGN hold exists", ErrSettlementConflict, rec.ID, rec.Side)
	}
	return nil
}

func inputOf(rec SwapRecord) SwapLedgerInput {
	return SwapLedgerInput{SwapID: rec.ID, UserID: rec.UserID, Side: rec.Side, NGNKobo: rec.NGNKobo, FeeKobo: rec.FeeKobo, FeeBps: rec.FeeBps}
}

// Complete settles a swap the provider confirmed. received is what the provider
// reports (crypto for a buy, NGN for a sell).
func (s *Settler) Complete(ctx context.Context, rec SwapRecord, received decimal.Decimal) error {
	switch rec.Side {
	case SideBuy:
		return s.CompleteBuy(ctx, inputOf(rec))
	case SideSell:
		return s.CompleteSell(ctx, inputOf(rec), received)
	case SideSwap:
		return s.requireNoHold(ctx, rec)
	}
	return fmt.Errorf("cryptosvc: swap %s has unknown side %q: refusing to skip its ledger legs", rec.ID, rec.Side)
}

// Fail settles a swap the provider failed.
func (s *Settler) Fail(ctx context.Context, rec SwapRecord) error {
	switch rec.Side {
	case SideBuy:
		return s.FailBuy(ctx, inputOf(rec))
	case SideSell:
		return nil
	case SideSwap:
		return s.requireNoHold(ctx, rec)
	}
	return fmt.Errorf("cryptosvc: swap %s has unknown side %q: refusing to skip its ledger legs", rec.ID, rec.Side)
}
