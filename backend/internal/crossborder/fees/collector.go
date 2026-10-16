// Package fees charges the SP-3a L1 Platform Fee in OUR ledger at execution
// (spec §4, §7.4). Three collection strategies sit behind one FeeCollector
// interface; the choice is config-driven and made by the caller (wiring is
// Task 9). This package only charges the fee and tracks fees_unswept — the
// sweep itself (Task 5) and revenue recognition/commission/reversal (Task 4)
// live elsewhere; Result exposes the account IDs and keys those need.
//
// Money rules: int64 minor units only, every post is a balanced two-account
// journal through the ledger service (no bare balance writes), every post is
// keyed idempotently, and every failure path is fail-closed.
package fees

import (
	"context"
	"errors"
	"fmt"
	"regexp"

	"github.com/google/uuid"

	"spotlight/backend/internal/finance/ledger"
)

// Strategy names a fee-collection strategy (spec §7.4).
type Strategy string

const (
	StrategyLedgerCharge Strategy = "ledger_charge" // A (default)
	StrategyNGNWallet    Strategy = "ngn_wallet"    // B (fallback when sweep unavailable)
	StrategySpreadBaked  Strategy = "spread_baked"  // C (fee baked into the spread)
)

// ErrInsufficientFunds is returned when the payer's wallet cannot cover the
// fee. Nothing is posted. It wraps ledger.ErrInsufficientFunds so either
// sentinel matches with errors.Is.
var ErrInsufficientFunds = errors.New("fees: wallet cannot cover platform fee")

// ErrInvalidCharge is returned for a malformed FeeCharge; nothing is posted.
var ErrInvalidCharge = errors.New("fees: invalid fee charge")

// FeeCharge is one platform-fee collection request.
type FeeCharge struct {
	// IdempotencyKey is cb:{transfer_id}:platform_fee:{service}. Required.
	IdempotencyKey string
	TransferID     string
	UserID         string // payer: owner of the wallet that is debited
	CompanyID      string // canonical lowercase UUID; names the fees_unswept account (strategy A)
	Service        string // ^[a-z][a-z0-9_]{0,31}$; names the revenue account
	Currency       string // ISO-4217 upper-case; names the fees_unswept sub-ledger (A); must be NGN for B
	AmountMinor    int64  // fee in minor units, >= 0 (0 is a no-op)
}

// Result describes what Collect did. The account IDs and keys are what a
// reversal (Task 4) needs: restore WalletAccountID, release RevenueAccountID /
// UnsweptAccountID using the recorded keys.
type Result struct {
	Strategy         Strategy
	Charged          bool // a ledger charge exists for this key (new or converged replay)
	IntentRecorded   bool // strategy C: fee intent noted, nothing posted
	AmountMinor      int64
	FeeKey           string // idempotency key of the wallet->revenue journal
	UnsweptKey       string // idempotency key of the fees_unswept journal (A only)
	WalletAccountID  string
	RevenueAccountID string
	UnsweptAccountID string
}

// FeeCollector collects a platform fee. Collect is idempotent by
// in.IdempotencyKey: a retry converges and never double-charges.
type FeeCollector interface {
	Collect(ctx context.Context, in FeeCharge) (Result, error)
}

// Ledger is the slice of *ledger.Service the collectors need.
type Ledger interface {
	GetOrCreateUserWallet(ctx context.Context, userID string) (*ledger.Account, error)
	GetOrCreateStandingAccount(ctx context.Context, t ledger.AccountType) (*ledger.Account, error)
	PostJournalGated(ctx context.Context, j ledger.JournalEntry, walletLockKey string) error
	PostJournal(ctx context.Context, j ledger.JournalEntry) error
	EntryByKey(ctx context.Context, idempotencyKey string) (*ledger.Entry, bool, error)
}

var _ Ledger = (*ledger.Service)(nil)

// NewCollector builds the collector for a config-selected strategy.
func NewCollector(s Strategy, l Ledger) (FeeCollector, error) {
	switch s {
	case StrategySpreadBaked:
		return NewSpreadBakedCollector(), nil
	case StrategyLedgerCharge, StrategyNGNWallet:
		if l == nil {
			return nil, fmt.Errorf("fees: strategy %q requires a ledger", s)
		}
		if s == StrategyLedgerCharge {
			return NewLedgerChargeCollector(l), nil
		}
		return NewNGNWalletCollector(l), nil
	default:
		return nil, fmt.Errorf("fees: unknown collection strategy %q", s)
	}
}

var (
	serviceRe  = regexp.MustCompile(`^[a-z][a-z0-9_]{0,31}$`)
	currencyRe = regexp.MustCompile(`^[A-Z]{3}$`)
)

func (in FeeCharge) validate(needCompany bool) error {
	switch {
	case in.IdempotencyKey == "":
		return fmt.Errorf("%w: idempotency key required", ErrInvalidCharge)
	case in.AmountMinor < 0:
		return fmt.Errorf("%w: negative amount %d", ErrInvalidCharge, in.AmountMinor)
	case !serviceRe.MatchString(in.Service):
		return fmt.Errorf("%w: service %q", ErrInvalidCharge, in.Service)
	case !currencyRe.MatchString(in.Currency):
		return fmt.Errorf("%w: currency %q", ErrInvalidCharge, in.Currency)
	}
	if needCompany {
		if u, err := uuid.Parse(in.CompanyID); err != nil || u.String() != in.CompanyID {
			return fmt.Errorf("%w: company id %q", ErrInvalidCharge, in.CompanyID)
		}
	}
	return nil
}

func (in FeeCharge) feeReference() string {
	return "cb:platform_fee:" + in.TransferID + ":" + in.Service
}
func (in FeeCharge) unsweptReference() string {
	return "cb:fees_unswept:" + in.TransferID + ":" + in.Service
}

// chargeWalletToRevenue posts DR user wallet / CR revenue:platform_fee:{svc}
// gated (balance + tier cap under the wallet advisory lock), converging on a
// retry. Returns the wallet and revenue account IDs.
func chargeWalletToRevenue(ctx context.Context, l Ledger, in FeeCharge) (walletID, revenueID string, err error) {
	wallet, err := l.GetOrCreateUserWallet(ctx, in.UserID)
	if err != nil {
		return "", "", err
	}
	revType, err := ledger.PlatformFeeAccount(in.Service)
	if err != nil {
		return "", "", fmt.Errorf("%w: %v", ErrInvalidCharge, err)
	}
	rev, err := l.GetOrCreateStandingAccount(ctx, revType)
	if err != nil {
		return "", "", err
	}
	j := ledger.JournalEntry{
		Reference:       in.feeReference(),
		IdempotencyKey:  in.IdempotencyKey,
		AmountKobo:      in.AmountMinor,
		DebitAccountID:  wallet.ID,
		CreditAccountID: rev.ID,
		Description:     "platform fee " + in.Service,
	}
	err = l.PostJournalGated(ctx, j, in.UserID)
	if errors.Is(err, ledger.ErrDuplicate) {
		// The Redis fast-path (or a held key) reports a duplicate without
		// proving OUR journal landed. Converge only if the ledger of record
		// holds exactly this journal; otherwise it is a foreign claim.
		if verr := verifyPosted(ctx, l, j); verr != nil {
			return "", "", fmt.Errorf("%w (replay not verified: %v)", err, verr)
		}
		err = nil
	}
	if err != nil {
		if errors.Is(err, ledger.ErrInsufficientFunds) {
			return "", "", fmt.Errorf("%w: %w", ErrInsufficientFunds, err)
		}
		return "", "", err
	}
	return wallet.ID, rev.ID, nil
}

// verifyPosted proves both legs of j exist in the ledger with the identical
// account, type, amount and reference.
func verifyPosted(ctx context.Context, l Ledger, j ledger.JournalEntry) error {
	legs := []struct {
		suffix  string
		account string
		typ     ledger.EntryType
	}{
		{":debit", j.DebitAccountID, ledger.EntryDebit},
		{":credit", j.CreditAccountID, ledger.EntryCredit},
	}
	for _, leg := range legs {
		e, ok, err := l.EntryByKey(ctx, j.IdempotencyKey+leg.suffix)
		if err != nil {
			return err
		}
		if !ok {
			return fmt.Errorf("leg %s%s not found", j.IdempotencyKey, leg.suffix)
		}
		if e.AccountID != leg.account || e.Type != leg.typ || e.AmountKobo != j.AmountKobo || e.Reference != j.Reference {
			return fmt.Errorf("leg %s%s differs from intended journal", j.IdempotencyKey, leg.suffix)
		}
	}
	return nil
}

// LedgerChargeCollector is strategy A (default): the fee is charged to the
// user's wallet and recognised as platform-fee revenue; the same amount is
// tracked in fees_unswept:{companyId}:{ccy} as money still sitting in the
// user's Verto wallet pending sweep.
//
// Posting shape — two independent, balanced, individually idempotent journals
// (the ledger API posts one account pair per call; there is no atomic
// three-account post):
//
//  1. DR user_wallet            / CR revenue:platform_fee:{svc}   (gated)
//  2. DR provider_clearing      / CR fees_unswept:{co}:{ccy}      key = {key}:unswept
//
// Journal 2 raises the unswept balance (balance = credits - debits, so the
// account balance equals the amount still awaiting sweep) against provider
// clearing, where the underlying cash sits. The fee journal posts first; if
// the process dies between the two, a retry with the same key replays 1 as a
// verified no-op and posts 2, so the pair always converges. The sweep (Task 5)
// drains fees_unswept with the mirror-image journal.
//
// NGN-ONLY: the ledger is a single-currency NGN-kobo ledger, so a non-NGN fee
// would debit the NGN wallet by the wrong magnitude (USD 25.00 = 2500 cents
// would charge N25) and mislabel the fees_unswept sub-ledger. Collect fails
// closed with ErrInvalidCharge for any other currency. Multi-currency
// collection (routing through the orchestration customer-wallet plane,
// orch_balances) is a follow-up deferred to the wiring task.
type LedgerChargeCollector struct{ l Ledger }

// NewLedgerChargeCollector builds strategy A.
func NewLedgerChargeCollector(l Ledger) *LedgerChargeCollector { return &LedgerChargeCollector{l: l} }

func (c *LedgerChargeCollector) Collect(ctx context.Context, in FeeCharge) (Result, error) {
	if err := in.validate(true); err != nil {
		return Result{}, err
	}
	if in.Currency != "NGN" {
		return Result{}, fmt.Errorf("%w: ledger charge strategy is NGN-only, got %s", ErrInvalidCharge, in.Currency)
	}
	res := Result{Strategy: StrategyLedgerCharge, AmountMinor: in.AmountMinor}
	if in.UserID == "" {
		return Result{}, fmt.Errorf("%w: user id required", ErrInvalidCharge)
	}
	if in.AmountMinor == 0 {
		return res, nil // nothing to charge
	}

	walletID, revID, err := chargeWalletToRevenue(ctx, c.l, in)
	if err != nil {
		return Result{}, err
	}

	unT, err := ledger.FeesUnsweptAccount(in.CompanyID, in.Currency)
	if err != nil {
		return Result{}, fmt.Errorf("%w: %v", ErrInvalidCharge, err)
	}
	un, err := c.l.GetOrCreateStandingAccount(ctx, unT)
	if err != nil {
		return Result{}, err
	}
	clearing, err := c.l.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		return Result{}, err
	}
	uj := ledger.JournalEntry{
		Reference:       in.unsweptReference(),
		IdempotencyKey:  in.IdempotencyKey + ":unswept",
		AmountKobo:      in.AmountMinor,
		DebitAccountID:  clearing.ID,
		CreditAccountID: un.ID,
		Description:     "fees_unswept accrual " + in.Service,
	}
	err = c.l.PostJournal(ctx, uj)
	if errors.Is(err, ledger.ErrDuplicate) {
		if verr := verifyPosted(ctx, c.l, uj); verr != nil {
			return Result{}, fmt.Errorf("%w (replay not verified: %v)", err, verr)
		}
		err = nil
	}
	if err != nil {
		// The fee is charged but unswept tracking is missing; the caller must
		// retry with the same key to converge (the error is not swallowed).
		return Result{}, fmt.Errorf("fees: fees_unswept tracking not posted (retry same key): %w", err)
	}

	res.Charged = true
	res.FeeKey = in.IdempotencyKey
	res.UnsweptKey = uj.IdempotencyKey
	res.WalletAccountID = walletID
	res.RevenueAccountID = revID
	res.UnsweptAccountID = un.ID
	return res, nil
}

// NGNWalletCollector is strategy B: the fee is charged to the user's existing
// Spotlight NGN wallet (fallback when the Verto sweep is unavailable). The
// cash is already ours in NGN, so no fees_unswept tracking is made.
type NGNWalletCollector struct{ l Ledger }

// NewNGNWalletCollector builds strategy B.
func NewNGNWalletCollector(l Ledger) *NGNWalletCollector { return &NGNWalletCollector{l: l} }

func (c *NGNWalletCollector) Collect(ctx context.Context, in FeeCharge) (Result, error) {
	if err := in.validate(false); err != nil {
		return Result{}, err
	}
	if in.Currency != "NGN" {
		return Result{}, fmt.Errorf("%w: NGN wallet strategy charges NGN, got %s", ErrInvalidCharge, in.Currency)
	}
	if in.UserID == "" {
		return Result{}, fmt.Errorf("%w: user id required", ErrInvalidCharge)
	}
	res := Result{Strategy: StrategyNGNWallet, AmountMinor: in.AmountMinor}
	if in.AmountMinor == 0 {
		return res, nil
	}
	walletID, revID, err := chargeWalletToRevenue(ctx, c.l, in)
	if err != nil {
		return Result{}, err
	}
	res.Charged = true
	res.FeeKey = in.IdempotencyKey
	res.WalletAccountID = walletID
	res.RevenueAccountID = revID
	return res, nil
}

// SpreadBakedCollector is strategy C: the fee is baked into the FX spread, so
// there is no separate ledger charge. It validates the request and records the
// intent in the Result; nothing is posted.
type SpreadBakedCollector struct{}

// NewSpreadBakedCollector builds strategy C.
func NewSpreadBakedCollector() *SpreadBakedCollector { return &SpreadBakedCollector{} }

func (c *SpreadBakedCollector) Collect(_ context.Context, in FeeCharge) (Result, error) {
	if err := in.validate(false); err != nil {
		return Result{}, err
	}
	return Result{Strategy: StrategySpreadBaked, IntentRecorded: true, AmountMinor: in.AmountMinor, FeeKey: in.IdempotencyKey}, nil
}
