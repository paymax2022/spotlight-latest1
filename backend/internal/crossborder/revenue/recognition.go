package revenue

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"spotlight/backend/internal/crossborder/fees"
	"spotlight/backend/internal/finance/ledger"
)

const (
	commissionCategory = "crossborder"
	commissionModule   = "crossborder"
)

var serviceRe = regexp.MustCompile(`^[a-z][a-z0-9_]{0,31}$`)

// knownServices are the services a Record can be rebuilt for (spec §8).
var knownServices = []string{"fx", "convert", "send", "receive", "onboarding"}

// Recognizer recognises, settles and reverses cross-border revenue.
//
// Commission timing: accrual posts ONLY the native line and the main-ledger
// receivable/revenue entries. The NGN roll-up (commission.RecordExact) happens at
// SETTLEMENT (MarkSettled), because a commission row is immutable (RecordExact
// rejects negatives) and fires the referral hook: rolling up at accrual would
// leave an un-undoable row, and possibly a referral payout, for a transfer that
// is reversed before it settles.
//
// PRECONDITION (nil-ledger commission): the CommissionRecorder MUST be a
// commission.Service built with a NIL ledger (the "module adapter" form, e.g.
// commission.NewService(repo, nil)). With a non-nil ledger RecordExact also posts
// DR provider_clearing / CR commission, double-counting revenue this package
// already recognised in revenue:fx_markup / revenue:platform_fee. NewRecognizer
// panics on a recorder that reports HasLedger()==true. Task 9 wiring must pass
// the nil-ledger service.
//
// Restart safety: Records live in a Store (in-memory by default) but are rebuilt
// lazily from the durable ledger on a miss (see rebuild), so MarkSettled/Reverse
// work after a restart without any table.
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

// NewRecognizer builds the recognizer. All three dependencies are required; c
// must be a nil-ledger commission service (see Recognizer). It panics on a
// recorder that reports it carries a ledger: this is construction-time wiring,
// and a silent double-count of revenue is worse than a failed boot.
func NewRecognizer(l Ledger, c CommissionRecorder, s Store) *Recognizer {
	if h, ok := c.(interface{ HasLedger() bool }); ok && h.HasLedger() {
		panic("revenue: commission recorder must be built with a nil ledger (it would double-count revenue)")
	}
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

func spreadRefPrefix(tid, svc string) string { return "cb:fx_spread:" + tid + ":" + svc + ":" }

// spreadRef carries the native line (ccy, native amount, rate, NGN gross, user)
// in the accrual journal's reference so a Record can be rebuilt from the ledger
// alone.
func spreadRef(r Record) string {
	return fmt.Sprintf("%sccy=%s:native=%d:rate=%d/%d:gross=%d:user=%s",
		spreadRefPrefix(r.TransferID, r.Service), r.Currency, r.NativeMinor, r.Rate.Num, r.Rate.Den, r.GrossNGN, r.UserID)
}

// RecognizeFXSpread recognises the spread once: the native-currency Record and
// the NGN-equivalent receivable accrual in the main ledger (DR
// receivable:verto_markup / CR revenue:fx_markup). It does NOT touch commission —
// that roll-up happens at settlement. Idempotent on redelivery.
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
	case strings.Contains(t.UserID, ":") || strings.Contains(t.TransferID, ":"):
		return fmt.Errorf("%w: ids must not contain ':'", ErrInvalid)
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
		State: StateAccrued, Currency: t.Currency, NativeMinor: native, Rate: rate, NGNMinor: ngn, GrossNGN: rate.Apply(t.GrossMinor),
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
	_, err = r.store.Put(ctx, rec)
	return err
}

// RecognizePlatformFee recognises a platform fee already charged by the
// FeeCollector (its revenue:platform_fee posting is the native line). It only
// records the Record; the NGN commission roll-up happens at settlement. A fee
// that was not charged (strategy C intent-only, or a zero fee) is not recognised.
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
		State: StateAccrued, Currency: "NGN", NativeMinor: c.AmountMinor, Rate: NGN, NGNMinor: c.AmountMinor, GrossNGN: c.AmountMinor,
		CommissionKey: feeKey(c.TransferID, c.Service),
		FeeKey:        c.Result.FeeKey, UnsweptKey: c.Result.UnsweptKey,
		WalletAccountID: c.Result.WalletAccountID, RevenueAccountID: c.Result.RevenueAccountID, UnsweptAccountID: c.Result.UnsweptAccountID,
	}
	_, err := r.store.Put(ctx, rec)
	return err
}

// Record returns the recognised component, if any (rebuilding it from the ledger
// when the store has lost it).
func (r *Recognizer) Record(ctx context.Context, transferID string, c Component) (Record, bool, error) {
	rec, ok, err := r.store.Get(ctx, transferID, c)
	if err != nil || ok {
		return rec, ok, err
	}
	rec, ok, err = r.rebuild(ctx, transferID, c)
	if err != nil || !ok {
		return Record{}, false, err
	}
	rec, err = r.store.Put(ctx, rec)
	return rec, err == nil, err
}

// rebuild reconstructs a Record from the durable ledger entries written at
// accrual / charge time, probing each known service. State is derived from the
// presence of the settle / reverse journals. Limits: a rebuilt platform fee has
// no UserID (not in the fee journals), and a strategy-B fee has no settle journal
// so it rebuilds as ACCRUED.
func (r *Recognizer) rebuild(ctx context.Context, tid string, c Component) (Record, bool, error) {
	for _, svc := range knownServices {
		var (
			rec Record
			ok  bool
			err error
		)
		switch c {
		case ComponentFXSpread:
			rec, ok, err = r.rebuildSpread(ctx, tid, svc)
		case ComponentPlatformFee:
			rec, ok, err = r.rebuildFee(ctx, tid, svc)
		}
		if err != nil {
			return Record{}, false, err
		}
		if ok {
			return rec, true, nil
		}
	}
	return Record{}, false, nil
}

func (r *Recognizer) has(ctx context.Context, key string) (bool, error) {
	_, ok, err := r.l.EntryByKey(ctx, key)
	return ok, err
}

func (r *Recognizer) rebuildSpread(ctx context.Context, tid, svc string) (Record, bool, error) {
	key := fxKey(tid, svc)
	e, ok, err := r.l.EntryByKey(ctx, key+":accrue:debit")
	if err != nil || !ok {
		return Record{}, false, err
	}
	prefix := spreadRefPrefix(tid, svc)
	if !strings.HasPrefix(e.Reference, prefix) {
		return Record{}, false, fmt.Errorf("revenue: rebuild %s: unexpected accrual reference %q", key, e.Reference)
	}
	kv := map[string]string{}
	for _, part := range strings.Split(strings.TrimPrefix(e.Reference, prefix), ":") {
		if k, v, found := strings.Cut(part, "="); found {
			kv[k] = v
		}
	}
	rec := Record{TransferID: tid, Component: ComponentFXSpread, Service: svc, UserID: kv["user"], State: StateAccrued,
		Currency: kv["ccy"], AccrueKey: key, CommissionKey: key}
	var perr error
	num := func(s string) int64 {
		v, e := strconv.ParseInt(s, 10, 64)
		if e != nil {
			perr = e
		}
		return v
	}
	rec.NativeMinor = num(kv["native"])
	rec.GrossNGN = num(kv["gross"])
	rn, rd, _ := strings.Cut(kv["rate"], "/")
	rec.Rate = Rate{Num: num(rn), Den: num(rd)}
	if perr != nil || rec.Currency == "" || !rec.Rate.valid() {
		return Record{}, false, fmt.Errorf("revenue: rebuild %s: malformed accrual reference %q", key, e.Reference)
	}
	rec.NGNMinor = rec.Rate.Apply(rec.NativeMinor)
	if rec.NGNMinor != e.AmountKobo {
		return Record{}, false, fmt.Errorf("revenue: rebuild %s: rate/native disagree with accrued amount (%d != %d)", key, rec.NGNMinor, e.AmountKobo)
	}
	if rec.State, err = r.derivedState(ctx, key+":settle:debit", key+":reverse:debit"); err != nil {
		return Record{}, false, err
	}
	return rec, true, nil
}

func (r *Recognizer) rebuildFee(ctx context.Context, tid, svc string) (Record, bool, error) {
	key := feeKey(tid, svc)
	credit, ok, err := r.l.EntryByKey(ctx, key+":credit")
	if err != nil || !ok {
		return Record{}, false, err
	}
	debit, ok, err := r.l.EntryByKey(ctx, key+":debit")
	if err != nil {
		return Record{}, false, err
	}
	if !ok {
		return Record{}, false, fmt.Errorf("revenue: rebuild %s: fee debit leg missing", key)
	}
	rec := Record{TransferID: tid, Component: ComponentPlatformFee, Service: svc, State: StateAccrued,
		Currency: "NGN", NativeMinor: credit.AmountKobo, Rate: NGN, NGNMinor: credit.AmountKobo, GrossNGN: credit.AmountKobo,
		CommissionKey: key, FeeKey: key, WalletAccountID: debit.AccountID, RevenueAccountID: credit.AccountID}
	un, ok, err := r.l.EntryByKey(ctx, key+":unswept:credit")
	if err != nil {
		return Record{}, false, err
	}
	settle := ""
	if ok {
		rec.UnsweptKey, rec.UnsweptAccountID = key+":unswept", un.AccountID
		settle = rec.UnsweptKey + ":settle:debit"
	}
	// A fee reversal is TWO journals (wallet reversal + fees_unswept release). It is
	// REVERSED only when every journal it needs is present; a crash between them
	// must rebuild as ACCRUED so a retried Reverse posts the missing release.
	reversedKey := key + ":reverse:rev_debit"
	if rec.UnsweptAccountID != "" {
		walletRev, err := r.has(ctx, reversedKey)
		if err != nil {
			return Record{}, false, err
		}
		unsweptRel, err := r.has(ctx, rec.UnsweptKey+":reverse:debit")
		if err != nil {
			return Record{}, false, err
		}
		if walletRev && !unsweptRel {
			reversedKey = "" // partial reversal: not REVERSED
		}
	}
	if rec.State, err = r.derivedStateFee(ctx, settle, reversedKey); err != nil {
		return Record{}, false, err
	}
	return rec, true, nil
}

func (r *Recognizer) derivedState(ctx context.Context, settledKey, reversedKey string) (State, error) {
	return r.derivedStateFee(ctx, settledKey, reversedKey)
}

func (r *Recognizer) derivedStateFee(ctx context.Context, settledKey, reversedKey string) (State, error) {
	if reversedKey != "" {
		if rev, err := r.has(ctx, reversedKey); err != nil || rev {
			return StateReversed, err
		}
	}
	if settledKey != "" {
		if set, err := r.has(ctx, settledKey); err != nil || set {
			return StateSettled, err
		}
	}
	return StateAccrued, nil
}

// MarkSettled moves a component ACCRUED -> SETTLED (terminal success) and, only
// now, rolls the NGN revenue up into the commission registry.
//   - fx_spread: the Verto statement paid the receivable:
//     DR provider_clearing / CR receivable:verto_markup.
//   - platform_fee: the fee was swept/collected: drain fees_unswept
//     (DR fees_unswept / CR provider_clearing); strategy B has none to drain.
//
// Every step is idempotent and the state flips last, so a failed roll-up is
// retried by repeating the call. Settling a REVERSED component is rejected.
func (r *Recognizer) MarkSettled(ctx context.Context, transferID string, c Component, s Settlement) error {
	rec, ok, err := r.Record(ctx, transferID, c)
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
	// NGN roll-up into the commission registry, at settlement only. Idempotent on
	// the commission key; sourceRef = transfer id so the native line can be joined.
	var uid *string
	if rec.UserID != "" {
		uid = &rec.UserID
	}
	if _, err := r.c.RecordExact(ctx, commissionCategory, rec.Service, string(c),
		rec.GrossNGN, rec.NGNMinor, commissionModule, transferID, uid, rec.CommissionKey); err != nil {
		return fmt.Errorf("revenue: commission roll-up: %w", err)
	}
	return r.store.SetState(ctx, transferID, c, StateSettled)
}

// Reverse reverses BOTH components (platform fee + accrued spread) of a
// failed/refunded transfer with reversing entries only (nothing is deleted or
// updated). Because commission is rolled up only at settlement, a pre-settlement
// reversal leaves no commission row to undo. Idempotent: a repeat converges; an
// interrupted run is completed by a retry. Both components are preflighted first
// — if either is already SETTLED the call fails closed with ErrSettledNotUndone
// and posts nothing (a settled amount needs a clawback, not a ledger reversal).
func (r *Recognizer) Reverse(ctx context.Context, transferID, reason string) error {
	var recs []Record
	for _, c := range []Component{ComponentFXSpread, ComponentPlatformFee} {
		rec, ok, err := r.Record(ctx, transferID, c)
		if err != nil {
			return err
		}
		if ok {
			recs = append(recs, rec)
		}
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
		var err error
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
// ledger of record holds the reversal's ":rev_debit" leg (PostReversalPair's key
// shape; ledger.Posted checks ":credit" and would not see it).
func (r *Recognizer) reversal(ctx context.Context, restore, release string, amt int64, ref, key string) error {
	err := r.l.PostReversal(ctx, restore, release, amt, ref, key)
	if errors.Is(err, ledger.ErrDuplicate) {
		e, ok, gerr := r.l.EntryByKey(ctx, key+":rev_debit")
		if gerr != nil {
			return gerr
		}
		if !ok || e.AccountID != restore || e.AmountKobo != amt {
			return fmt.Errorf("%w (replay not verified)", err)
		}
		return nil
	}
	return err
}
