package cryptosvc

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/shopspring/decimal"

	"spotlight/backend/internal/cryptoprov"
)

// Outcome says what a delivery did. Every outcome except an error is an HTTP 200.
type Outcome string

const (
	OutcomeApplied      Outcome = "applied"       // a state transition was written
	OutcomeDuplicate    Outcome = "duplicate"     // this delivery was already processed
	OutcomeIgnored      Outcome = "ignored"       // recorded, nothing to do in this slice
	OutcomePending      Outcome = "pending"       // provider has not reached a final state
	OutcomeAlreadyFinal Outcome = "already_final" // our swap is already terminal
)

// ErrDedupeNotReleased means processing failed AND removing the dedupe row failed,
// so the provider's retry would be swallowed as a duplicate. This is the one case
// that must page someone; the reconciler is the safety net for the stranded swap.
var ErrDedupeNotReleased = errors.New("cryptosvc: webhook failed and its dedupe row could not be released")

// SwapSettler posts the ledger legs of a swap the provider has finalised. It runs
// BEFORE the state transition so a crash between the two converges on retry (the
// settler is idempotent and replay-verified); state is always the last write.
type SwapSettler interface {
	Complete(ctx context.Context, rec SwapRecord, received decimal.Decimal) error
	Fail(ctx context.Context, rec SwapRecord) error
}

// DepositSettler settles a money-IN transfer the provider has finalised. It receives the
// authoritative re-queried cryptoprov.Deposit (never the webhook payload) and returns the
// outcome this delivery produced. The provider name is passed so the journal records it.
// It is implemented outside this package (the app wiring bridges it to the deposit engine),
// keeping the webhook layer free of the deposit package's types.
type DepositSettler interface {
	SettleDeposit(ctx context.Context, provider string, d cryptoprov.Deposit) (Outcome, error)
}

// Ingest authenticates, dedupes and applies provider webhooks.
type Ingest struct {
	reg     *cryptoprov.Registry
	store   Store
	now     func() time.Time
	settler SwapSettler
	deposit DepositSettler
	audit   Auditor
}

// WithDepositSettler enables money-IN settlement for deposit events. Without it deposit
// events are recorded and ignored (the pre-deposit behaviour) so wiring is additive.
func (i *Ingest) WithDepositSettler(s DepositSettler) *Ingest { i.deposit = s; return i }

// WithAuditor records completed and failed settlements.
func (i *Ingest) WithAuditor(a Auditor) *Ingest { i.audit = a; return i }

func (i *Ingest) auditSettled(ctx context.Context, rec SwapRecord, target cryptoprov.SwapState) {
	if i.audit == nil {
		return
	}
	action := ""
	switch target {
	case cryptoprov.SwapStateCompleted:
		action = "crypto.swap.completed"
	case cryptoprov.SwapStateFailed:
		action = "crypto.swap.failed"
	default:
		return
	}
	i.audit.Audit(ctx, AuditEvent{Actor: "system:provider", Action: action, EntityID: rec.ID, Detail: map[string]any{"user_id": rec.UserID, "ngn_kobo": rec.NGNKobo, "fee_kobo": rec.FeeKobo}})
}

// WithSettler enables ledger settlement on completed and failed swaps. Without it the
// ingest only moves state (the original, ledger-free behaviour).
func (i *Ingest) WithSettler(s SwapSettler) *Ingest { i.settler = s; return i }

// NewIngest builds the webhook path over a registry and a store.
func NewIngest(reg *cryptoprov.Registry, store Store) *Ingest {
	return &Ingest{reg: reg, store: store, now: time.Now}
}

// isSwapEvent routes an event to the swap path. Only the routing uses the event
// type; the outcome is always taken from a provider re-query by id, so a
// mis-routed type costs one extra read, never a wrong credit. The sandbox checklist
// still has to confirm the real name (swap_transaction.* per the spec vs trade.*).
func isSwapEvent(t string) bool {
	return strings.HasPrefix(t, "swap_transaction.") || strings.HasPrefix(t, "trade.")
}

// isDepositEvent routes an inbound (money-IN) event to the deposit path. Like the swap
// routing it uses the event type ONLY to choose a re-query; the credit always comes from a
// provider GetDeposit, never the payload. The exact name is UNVERIFIED against the sandbox
// (deposit.* vs transaction.*), so the checklist must settle it before go-live.
func isDepositEvent(t string) bool {
	return strings.HasPrefix(t, "deposit.") || strings.HasPrefix(t, "transaction.")
}

// Handle processes one delivery (spec 8.3): verify, dedupe, re-query, apply with a
// conditional transition. If processing fails after the dedupe insert, the dedupe
// row is removed so the provider's retry re-runs it. The payload is never trusted
// to release value.
func (i *Ingest) Handle(ctx context.Context, providerName string, headers map[string]string, body []byte) (Outcome, error) {
	p, err := i.reg.Get(providerName)
	if err != nil {
		return "", ErrUnknownProvider
	}
	wp, err := cryptoprov.As[cryptoprov.WebhookProvider](p)
	if err != nil {
		return "", fmt.Errorf("cryptosvc: provider %q has no webhook capability: %w", providerName, err)
	}
	if err := wp.VerifyWebhook(headers, body); err != nil {
		return "", ErrBadSignature
	}
	ev, err := wp.ParseWebhook(body)
	if err != nil {
		return "", fmt.Errorf("cryptosvc: unparseable webhook: %w", err)
	}

	inserted, err := i.store.InsertWebhookEvent(ctx, WebhookEvent{
		Key: ev.Key, Provider: providerName, Type: ev.Type, Payload: ev.Raw, ReceivedAt: i.now().UTC(),
	})
	if err != nil {
		return "", fmt.Errorf("cryptosvc: record webhook: %w", err)
	}
	if !inserted {
		return OutcomeDuplicate, nil
	}

	out, perr := i.process(ctx, p, providerName, ev)
	if perr != nil {
		// Cleanup must survive the request context being cancelled.
		cctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if derr := i.store.DeleteWebhookEvent(cctx, ev.Key); derr != nil {
			return "", errors.Join(ErrDedupeNotReleased, perr, derr)
		}
		return "", perr
	}
	return out, nil
}

func (i *Ingest) process(ctx context.Context, p cryptoprov.Provider, providerName string, ev cryptoprov.Event) (Outcome, error) {
	if isDepositEvent(ev.Type) {
		return i.processDeposit(ctx, p, providerName, ev)
	}
	if !isSwapEvent(ev.Type) {
		return OutcomeIgnored, nil
	}
	rec, found, err := i.store.SwapByProviderID(ctx, providerName, ev.Ref)
	if err != nil {
		return "", fmt.Errorf("cryptosvc: look up swap: %w", err)
	}
	if !found {
		return "", ErrSwapNotRecorded
	}
	if rec.State.IsTerminal() {
		return OutcomeAlreadyFinal, nil
	}
	return i.resolve(ctx, p, providerName, rec)
}

// processDeposit settles a money-IN delivery. The payload only names the transfer (its id
// and the sub-account); the authoritative amount, confirmation count and status come from a
// provider re-query. If the deposit engine is not wired, the delivery is recorded and ignored
// — a deposit is never credited without the engine. A re-query or settle error is returned so
// Handle releases the dedupe row and the provider redelivers.
func (i *Ingest) processDeposit(ctx context.Context, p cryptoprov.Provider, providerName string, ev cryptoprov.Event) (Outcome, error) {
	if i.deposit == nil {
		return OutcomeIgnored, nil
	}
	dp, err := cryptoprov.As[cryptoprov.DepositProvider](p)
	if err != nil {
		return "", fmt.Errorf("cryptosvc: provider %q cannot be re-queried for deposits: %w", providerName, err)
	}
	dep, err := dp.GetDeposit(ctx, ev.Account, ev.Ref)
	if err != nil {
		return "", fmt.Errorf("cryptosvc: re-query deposit: %w", err)
	}
	out, err := i.deposit.SettleDeposit(ctx, providerName, dep)
	if err != nil {
		return "", err
	}
	return out, nil
}

// ResolveSwap re-reads the provider's authoritative state for one swap and applies it
// (settling the ledger, then moving state). Shared by the webhook path, the confirm
// step and the future reconciler.
func (i *Ingest) ResolveSwap(ctx context.Context, providerName string, rec SwapRecord) (Outcome, error) {
	p, err := i.reg.Get(providerName)
	if err != nil {
		return "", ErrUnknownProvider
	}
	if rec.State.IsTerminal() {
		return OutcomeAlreadyFinal, nil
	}
	return i.resolve(ctx, p, providerName, rec)
}

func (i *Ingest) resolve(ctx context.Context, p cryptoprov.Provider, providerName string, rec SwapRecord) (Outcome, error) {
	sp, err := cryptoprov.As[cryptoprov.SwapProvider](p)
	if err != nil {
		return "", fmt.Errorf("cryptosvc: provider %q cannot be re-queried: %w", providerName, err)
	}
	sw, err := sp.GetSwap(ctx, rec.ProviderAccountID, rec.ProviderSwapID)
	if err != nil {
		return "", fmt.Errorf("cryptosvc: re-query swap: %w", err)
	}

	switch sw.Status {
	case cryptoprov.SwapCompleted:
		if !sw.ToAmt.IsPositive() {
			// Completed with nothing received cannot be credited; a human decides.
			return i.apply(ctx, rec, cryptoprov.SwapStateNeedsReview, decimal.Zero, "provider reported completed with a non-positive amount")
		}
		return i.apply(ctx, rec, cryptoprov.SwapStateCompleted, sw.ToAmt, "")
	case cryptoprov.SwapFailed:
		return i.apply(ctx, rec, cryptoprov.SwapStateFailed, decimal.Zero, "provider reported failed")
	default:
		// Provider still working: the most we learn is that it left "confirming".
		if rec.State == cryptoprov.SwapStateConfirming {
			if _, err := i.step(ctx, rec, cryptoprov.SwapStateProcessing, decimal.Zero, ""); err != nil {
				return "", err
			}
		}
		return OutcomePending, nil
	}
}

// apply moves rec to target, walking confirming -> processing first when needed.
func (i *Ingest) apply(ctx context.Context, rec SwapRecord, target cryptoprov.SwapState, received decimal.Decimal, reason string) (Outcome, error) {
	if i.settler != nil {
		var serr error
		switch target {
		case cryptoprov.SwapStateCompleted:
			serr = i.settler.Complete(ctx, rec, received)
		case cryptoprov.SwapStateFailed:
			serr = i.settler.Fail(ctx, rec)
		}
		if serr != nil {
			if errors.Is(serr, ErrPermanent) {
				// Retrying can never fix this; leave it for a human instead of looping.
				return i.apply0(ctx, rec, cryptoprov.SwapStateNeedsReview, decimal.Zero, "settlement refused: "+serr.Error())
			}
			return "", fmt.Errorf("cryptosvc: settle swap %s: %w", rec.ID, serr)
		}
	}
	out, err := i.apply0(ctx, rec, target, received, reason)
	if err == nil && out == OutcomeApplied {
		i.auditSettled(ctx, rec, target)
	}
	return out, err
}

// apply0 walks the swap to target with conditional transitions (no settlement).
func (i *Ingest) apply0(ctx context.Context, rec SwapRecord, target cryptoprov.SwapState, received decimal.Decimal, reason string) (Outcome, error) {
	if rec.State == cryptoprov.SwapStateConfirming && target != cryptoprov.SwapStateNeedsReview {
		applied, err := i.step(ctx, rec, cryptoprov.SwapStateProcessing, decimal.Zero, "")
		if err != nil {
			return "", err
		}
		if !applied {
			return i.lostRace(ctx, rec)
		}
		rec.State = cryptoprov.SwapStateProcessing
	}
	applied, err := i.step(ctx, rec, target, received, reason)
	if err != nil {
		return "", err
	}
	if !applied {
		return i.lostRace(ctx, rec)
	}
	return OutcomeApplied, nil
}

// step performs one conditional transition after checking the FSM allows it.
func (i *Ingest) step(ctx context.Context, rec SwapRecord, to cryptoprov.SwapState, received decimal.Decimal, reason string) (bool, error) {
	if _, err := cryptoprov.Transition(rec.State, to); err != nil {
		return false, err
	}
	applied, err := i.store.TransitionSwap(ctx, rec.ID, rec.State, to, received, reason)
	if err != nil {
		return false, fmt.Errorf("cryptosvc: transition swap: %w", err)
	}
	return applied, nil
}

// lostRace handles a conditional update that matched no row: another writer moved
// the swap. If it is terminal now, that writer won and there is nothing to do;
// otherwise report an error so the provider retries.
func (i *Ingest) lostRace(ctx context.Context, rec SwapRecord) (Outcome, error) {
	cur, found, err := i.store.SwapByProviderID(ctx, rec.Provider, rec.ProviderSwapID)
	if err != nil {
		return "", fmt.Errorf("cryptosvc: re-read swap after a lost race: %w", err)
	}
	if found && cur.State.IsTerminal() {
		return OutcomeAlreadyFinal, nil
	}
	return "", errors.New("cryptosvc: swap changed concurrently; retry")
}
