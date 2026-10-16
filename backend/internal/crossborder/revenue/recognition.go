package revenue

import (
	"context"
	"errors"
	"fmt"
	"regexp"

	"spotlight/backend/internal/crossborder/fees"
	"spotlight/backend/internal/finance/ledger"
)

const (
	commissionCategory = "crossborder"
	commissionModule   = "crossborder"
)

var serviceRe = regexp.MustCompile(`^[a-z][a-z0-9_]{0,31}$`)

// Recognizer recognises, settles and reverses cross-border revenue.
//
// Atomicity note: the ledger posts one account pair per call and there is no
// outbox, so multi-journal operations are made atomic by convergence — every
// journal is individually idempotent and keyed, the component state flips only
// after all its journals landed, and any error is returned so the caller retries
// with the same inputs (PENDING/retry). Reverse additionally preflights both
// components before posting anything.
type Recognizer struct {
	l     Ledger
	c     CommissionRecorder
	store Store
}

// NewRecognizer builds the recognizer. All three dependencies are required.
func NewRecognizer(l Ledger, c CommissionRecorder, s Store) *Recognizer {
	return &Recognizer{l: l, c: c, store: s}
}

// FXSpreadTrade is the FX spread earned on one executed trade, in its NATIVE
// currency (the currency of the orchestration `paymax_spread` line).
type FXSpreadTrade struct {
	TransferID string
	Service    string // fx | convert | send | receive | onboarding
	UserID     string
	Currency   string // native currency of the spread
	// SpreadMinor is the recognised spread (the value handed to Verto as
	// fxMarkupPerc; D1 — recognised once). FixedMinor is the spread engine's
	// fixed-fee component, added when the config uses it.
	SpreadMinor int64
	FixedMinor  int64
	GrossMinor  int64 // native trade amount (commission gross, converted)
	// Rate is the trade's own native->NGN rate. Required unless Currency is NGN.
	Rate Rate
}

// PlatformFeeCharge is one platform fee as charged by the FeeCollector.
type PlatformFeeCharge struct {
	TransferID  string
	Service     string
	UserID      string
	Currency    string // NGN (strategy A/B are NGN-only)
	AmountMinor int64
	Result      fees.Result
}

// Settlement identifies the external settlement event (Verto statement line,
// sweep id) that settled a component.
type Settlement struct{ Reference string }

func fxKey(tid, svc string) string  { return "cb:" + tid + ":fx_spread:" + svc }
func feeKey(tid, svc string) string { return "cb:" + tid + ":platform_fee:" + svc }

func spreadRef(r Record) string {
	return fmt.Sprintf("cb:fx_spread:%s:%s:ccy=%s:native=%d:rate=%d/%d", r.TransferID, r.Service, r.Currency, r.NativeMinor, r.Rate.Num, r.Rate.Den)
}

// RecognizeFXSpread recognises the spread once: a native-currency Record, the
// NGN-equivalent receivable accrual in the main ledger (DR receivable:verto_markup
// / CR revenue:fx_markup), and the NGN roll-up into the commission registry.
// Idempotent on redelivery at every step.
func (r *Recognizer) RecognizeFXSpread(ctx context.Context, t FXSpreadTrade) error {
	switch {
	case t.TransferID == "":
		return fmt.Errorf("%w: transfer id", ErrInvalid)
	case !serviceRe.MatchString(t.Service):
		return fmt.Errorf("%w: service %q", ErrInvalid, t.Service)
	case t.Currency == "":
		return fmt.Errorf("%w: currency", ErrInvalid)
	case t.SpreadMinor < 0 || t.FixedMinor < 0 || t.GrossMinor < 0:
		return fmt.Errorf("%w: negative amount", ErrInvalid)
	}
	native := t.SpreadMinor + t.FixedMinor
	if native == 0 {
		return nil
	}
	rate := t.Rate
	if t.Currency == "NGN" {
		rate = NGN
	} else if !rate.valid() {
		return ErrNoNGNRate
	}
	ngn := rate.Apply(native)
	if ngn <= 0 {
		return nil // below one kobo after conversion: nothing to recognise
	}

	rec := Record{
		TransferID: t.TransferID, Component: ComponentFXSpread, Service: t.Service, UserID: t.UserID,
		State: StateAccrued, Currency: t.Currency, NativeMinor: native, Rate: rate, NGNMinor: ngn,
		AccrueKey: fxKey(t.TransferID, t.Service), CommissionKey: fxKey(t.TransferID, t.Service),
	}
	recv, err := r.l.GetOrCreateStandingAccount(ctx, ledger.AccountReceivableVertoMarkup)
	if err != nil {
		return err
	}
	rev, err := r.l.GetOrCreateStandingAccount(ctx, ledger.AccountRevenueFxMarkup)
	if err != nil {
		return err
	}
	if err := postVerified(ctx, r.l, ledger.JournalEntry{
		Reference: spreadRef(rec), IdempotencyKey: rec.AccrueKey + ":accrue", AmountKobo: ngn,
		DebitAccountID: recv.ID, CreditAccountID: rev.ID, Description: "fx spread accrual (receivable from Verto)",
	}); err != nil {
		return fmt.Errorf("revenue: spread accrual: %w", err)
	}
	if _, err := r.store.Put(ctx, rec); err != nil {
		return err
	}
	var uid *string
	if t.UserID != "" {
		uid = &t.UserID
	}
	if _, err := r.c.RecordExact(ctx, commissionCategory, t.Service, string(ComponentFXSpread),
		rate.Apply(t.GrossMinor), ngn, commissionModule, t.TransferID, uid, rec.CommissionKey); err != nil {
		return fmt.Errorf("revenue: commission roll-up: %w", err)
	}
	return nil
}

// RecognizePlatformFee recognises a platform fee already charged by the
// FeeCollector (its revenue:platform_fee posting is the native line). It only
// records the Record and the NGN commission roll-up. A fee that was not charged
// (strategy C intent-only, or a zero fee) is not recognised.
func (r *Recognizer) RecognizePlatformFee(ctx context.Context, c PlatformFeeCharge) error {
	switch {
	case c.TransferID == "":
		return fmt.Errorf("%w: transfer id", ErrInvalid)
	case !serviceRe.MatchString(c.Service):
		return fmt.Errorf("%w: service %q", ErrInvalid, c.Service)
	case c.AmountMinor < 0:
		return fmt.Errorf("%w: negative amount", ErrInvalid)
	}
	if !c.Result.Charged || c.AmountMinor == 0 {
		return nil
	}
	if c.Currency != "NGN" {
		return fmt.Errorf("%w: platform fee is NGN-only, got %s", ErrInvalid, c.Currency)
	}
	if c.Result.AmountMinor != c.AmountMinor {
		return fmt.Errorf("%w: charged amount %d != recognised amount %d", ErrInvalid, c.Result.AmountMinor, c.AmountMinor)
	}
	rec := Record{
		TransferID: c.TransferID, Component: ComponentPlatformFee, Service: c.Service, UserID: c.UserID,
		State: StateAccrued, Currency: "NGN", NativeMinor: c.AmountMinor, Rate: NGN, NGNMinor: c.AmountMinor,
		CommissionKey: feeKey(c.TransferID, c.Service),
		FeeKey:        c.Result.FeeKey, UnsweptKey: c.Result.UnsweptKey,
		WalletAccountID: c.Result.WalletAccountID, RevenueAccountID: c.Result.RevenueAccountID, UnsweptAccountID: c.Result.UnsweptAccountID,
	}
	if _, err := r.store.Put(ctx, rec); err != nil {
		return err
	}
	var uid *string
	if c.UserID != "" {
		uid = &c.UserID
	}
	if _, err := r.c.RecordExact(ctx, commissionCategory, c.Service, string(ComponentPlatformFee),
		c.AmountMinor, c.AmountMinor, commissionModule, c.TransferID, uid, rec.CommissionKey); err != nil {
		return fmt.Errorf("revenue: commission roll-up: %w", err)
	}
	return nil
}

// Record returns the recognised component, if any.
func (r *Recognizer) Record(ctx context.Context, transferID string, c Component) (Record, bool, error) {
	return r.store.Get(ctx, transferID, c)
}

// MarkSettled moves a component ACCRUED -> SETTLED.
//   - fx_spread: the Verto statement paid the receivable:
//     DR provider_clearing / CR receivable:verto_markup.
//   - platform_fee: the fee was swept/collected: drain fees_unswept
//     (DR fees_unswept / CR provider_clearing); strategy B has none to drain.
//
// Idempotent; settling a REVERSED component is rejected.
func (r *Recognizer) MarkSettled(ctx context.Context, transferID string, c Component, s Settlement) error {
	rec, ok, err := r.store.Get(ctx, transferID, c)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotFound
	}
	if rec.State == StateReversed {
		return fmt.Errorf("%w: %s is reversed", ErrInvalidState, c)
	}
	clearing, err := r.l.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		return err
	}
	switch c {
	case ComponentFXSpread:
		recv, err := r.l.GetOrCreateStandingAccount(ctx, ledger.AccountReceivableVertoMarkup)
		if err != nil {
			return err
		}
		if err := postVerified(ctx, r.l, ledger.JournalEntry{
			Reference: "cb:fx_spread:settle:" + transferID + ":" + rec.Service, IdempotencyKey: rec.AccrueKey + ":settle",
			AmountKobo: rec.NGNMinor, DebitAccountID: clearing.ID, CreditAccountID: recv.ID,
			Description: "fx spread settled by Verto statement " + s.Reference,
		}); err != nil {
			return fmt.Errorf("revenue: settle spread: %w", err)
		}
	case ComponentPlatformFee:
		if rec.UnsweptAccountID != "" {
			if err := postVerified(ctx, r.l, ledger.JournalEntry{
				Reference: "cb:fees_unswept:settle:" + transferID + ":" + rec.Service, IdempotencyKey: rec.UnsweptKey + ":settle",
				AmountKobo: rec.NGNMinor, DebitAccountID: rec.UnsweptAccountID, CreditAccountID: clearing.ID,
				Description: "platform fee swept " + s.Reference,
			}); err != nil {
				return fmt.Errorf("revenue: settle fee: %w", err)
			}
		}
	default:
		return fmt.Errorf("%w: component %q", ErrInvalid, c)
	}
	return r.store.SetState(ctx, transferID, c, StateSettled)
}

// Reverse reverses BOTH components (platform fee + accrued spread) of a
// failed/refunded transfer with reversing entries only (nothing is deleted or
// updated). Idempotent: a repeat converges; an interrupted run is completed by a
// retry. Both components are preflighted first — if either is already SETTLED the
// call fails closed with ErrSettledNotUndone and posts nothing (a settled amount
// needs a clawback, not a ledger reversal).
//
// The commission roll-up row is immutable and RecordExact rejects negative
// revenue, so it is NOT reversed here (see task report).
func (r *Recognizer) Reverse(ctx context.Context, transferID, reason string) error {
	recs, err := r.store.List(ctx, transferID)
	if err != nil {
		return err
	}
	for _, rec := range recs {
		if rec.State == StateSettled {
			return fmt.Errorf("%w: %s of %s", ErrSettledNotUndone, rec.Component, transferID)
		}
	}
	for _, rec := range recs {
		if rec.State == StateReversed {
			continue
		}
		switch rec.Component {
		case ComponentFXSpread:
			err = r.reverseSpread(ctx, rec, reason)
		case ComponentPlatformFee:
			err = r.reverseFee(ctx, rec, reason)
		}
		if err != nil {
			return fmt.Errorf("revenue: reverse %s of %s: %w", rec.Component, transferID, err)
		}
		if err := r.store.SetState(ctx, transferID, rec.Component, StateReversed); err != nil {
			return err
		}
	}
	return nil
}

func (r *Recognizer) reverseSpread(ctx context.Context, rec Record, reason string) error {
	recv, err := r.l.GetOrCreateStandingAccount(ctx, ledger.AccountReceivableVertoMarkup)
	if err != nil {
		return err
	}
	rev, err := r.l.GetOrCreateStandingAccount(ctx, ledger.AccountRevenueFxMarkup)
	if err != nil {
		return err
	}
	// Mirror of the accrual: DR revenue:fx_markup / CR receivable:verto_markup.
	return postVerified(ctx, r.l, ledger.JournalEntry{
		Reference: "cb:fx_spread:reversal:" + rec.TransferID + ":" + rec.Service, IdempotencyKey: rec.AccrueKey + ":reverse",
		AmountKobo: rec.NGNMinor, DebitAccountID: rev.ID, CreditAccountID: recv.ID, Description: "fx spread reversal: " + reason,
	})
}

func (r *Recognizer) reverseFee(ctx context.Context, rec Record, reason string) error {
	ref := "cb:platform_fee:reversal:" + rec.TransferID + ":" + rec.Service
	// Restore the payer's wallet, release the fee revenue.
	if err := r.reversal(ctx, rec.WalletAccountID, rec.RevenueAccountID, rec.NGNMinor, ref, rec.FeeKey+":reverse"); err != nil {
		return err
	}
	if rec.UnsweptAccountID == "" {
		return nil
	}
	clearing, err := r.l.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		return err
	}
	// Mirror of the collector's accrual (DR clearing / CR fees_unswept).
	return postVerified(ctx, r.l, ledger.JournalEntry{
		Reference: "cb:fees_unswept:reversal:" + rec.TransferID + ":" + rec.Service, IdempotencyKey: rec.UnsweptKey + ":reverse",
		AmountKobo: rec.NGNMinor, DebitAccountID: rec.UnsweptAccountID, CreditAccountID: clearing.ID,
		Description: "fees_unswept release: " + reason,
	})
}

// reversal posts a ledger reversal pair, accepting a duplicate only when the
// ledger of record proves the key was posted.
func (r *Recognizer) reversal(ctx context.Context, restore, release string, amt int64, ref, key string) error {
	err := r.l.PostReversal(ctx, restore, release, amt, ref, key)
	if errors.Is(err, ledger.ErrDuplicate) {
		ok, perr := r.l.Posted(ctx, key)
		if perr != nil {
			return perr
		}
		if !ok {
			return fmt.Errorf("%w (replay not verified)", err)
		}
		return nil
	}
	return err
}
