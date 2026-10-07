package paystackcheckout

// PARTIAL (piece) refunds — ADR-PRTBD-mobility-card-direct, "Partial refunds
// (car hire)".
//
// One card charge may fund SEVERAL settlements (car hire: "<ref>:fare" and
// "<ref>:deposit"). Each is refunded to the card on its own, for exactly its own
// total. The intent stays 'confirmed' while that happens: the whole-charge
// 'refunding' machinery in refund.go refunds the ENTIRE charge and keeps its
// single-status model; piece refunds live in transport_paystack_intent_refunds
// plus two counters on the intent (refund_reserved_kobo / refunded_kobo) under a
// DB CHECK, so "sum of refunds <= collected" is a database invariant.
//
// Rules (each one a lesson of the whole-charge path, applied from the start):
//
//  1. RECORD, THEN CALL. A piece is 'refunding' (reserved against the charge,
//     fenced) BEFORE the gateway is asked.
//  2. ONE IN FLIGHT per intent (partial unique index). That makes the gateway
//     arithmetic unambiguous: (sum of ACCEPTED gateway refunds) − (refunded_kobo
//     of our books) is either 0 — nothing in flight — or exactly this piece.
//  3. NEVER REFUND ON A GUESS. Paystack has no client idempotency key for
//     refunds, so before every POST we LOOK UP all refunds and only POST when
//     accepted == books. accepted == books + piece ⇒ our refund already
//     happened (lost reply / crash): record it, never issue another. Any other
//     number (a dashboard refund, a foreign note) ⇒ stay 'refunding', alert,
//     leave it to a human. The merchant note ("<ref>#<settlementID>") is only a
//     tie-breaker, never required.
//  4. GATEWAY FIRST, LEDGER SECOND. settlement.RefundExternal runs after the
//     piece is recorded refunded; it is idempotent, so a retry/sweep finishes it
//     without another gateway call.

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/provider"
)

// Piece refund row statuses.
const (
	PartialRefunding = "refunding"
	PartialRefunded  = "refunded"
	PartialFailed    = "failed"
)

var (
	// ErrPartialRefundsUnsupported: a settlement that is one piece of a charge
	// needs refunding but Engine.EnablePartialRefunds was never called. Fails
	// CLOSED — nothing is sent to the gateway or the ledger.
	ErrPartialRefundsUnsupported = errors.New("paystackcheckout: partial refunds are not enabled on this engine")
	// ErrPartialInFlight: another piece refund of this intent is in flight (or a
	// fresh claim of this same piece exists). Retry shortly.
	ErrPartialInFlight = errors.New("paystackcheckout: another refund of this charge is in flight")
	// ErrPartialCapExceeded: reserving this piece would push the refunds past the
	// amount collected.
	ErrPartialCapExceeded = errors.New("paystackcheckout: refund would exceed the amount collected")
	// ErrIntentNotRefundable: piece refunds require a 'confirmed' booking.
	ErrIntentNotRefundable = errors.New("paystackcheckout: the charge is not in a refundable state")
)

// PartialRefund is one row of transport_paystack_intent_refunds.
type PartialRefund struct {
	Reference       string
	RefundKey       string // the settlement id
	SettlementID    string
	AmountKobo      int64
	Status          string
	GatewayRefundID *string
	ClaimGen        Fence
	ClaimedAt       time.Time
	Attempts        int
	// PostAttemptedAt is when a gateway refund POST was last STARTED (persisted
	// BEFORE the call, cleared by a definite failure). Nil = never attempted.
	PostAttemptedAt *time.Time
}

// PartialBegin is the result of BeginPartialRefund.
type PartialBegin struct {
	Fence Fence
	// Prev is the row's status before this call: "" (new), PartialFailed
	// (re-activated) or PartialRefunding (stale takeover — a previous attempt may
	// have reached the gateway).
	Prev string
	// AlreadyDone: the piece is already refunded (replay) — skip the gateway.
	AlreadyDone bool
	Row         PartialRefund
	// ExpectedRefundedKobo is intents.refunded_kobo at Begin: what the books say
	// the gateway should already hold in accepted refunds.
	ExpectedRefundedKobo int64
	// Now is the STORE's clock at Begin (the database's now()): the engine compares
	// it with Row.PostAttemptedAt, so both timestamps come from one clock.
	Now time.Time
}

// PartialRefundStore persists piece refunds. Implemented by PGStore and by the
// in-memory fake in tests. Every method that changes state is fenced.
type PartialRefundStore interface {
	// BeginPartialRefund atomically (one transaction, intent row locked):
	//   - returns AlreadyDone for a refunded piece (any intent status);
	//   - otherwise requires the intent 'confirmed' (ErrIntentNotRefundable),
	//     no OTHER piece in flight or fresh (ErrPartialInFlight), and
	//     reserved+amount <= amount_kobo (ErrPartialCapExceeded);
	//   - inserts the row, re-activates a 'failed' one, or takes over a
	//     'refunding' one older than staleAfter; every takeover bumps the fence.
	BeginPartialRefund(ctx context.Context, reference, refundKey, settlementID string, amountKobo int64, staleAfter time.Duration) (*PartialBegin, error)
	// MarkPartialRefunded: refunding→refunded under fence, refunded_kobo += amount,
	// and the intent flips confirmed→refunded when refunded_kobo == amount_kobo.
	MarkPartialRefunded(ctx context.Context, reference, refundKey string, fence Fence, gatewayRefundID string) (applied bool, err error)
	// MarkPartialFailed: refunding→failed under fence, releasing the reservation and
	// clearing post_attempted_at (a DEFINITE failure: an immediate retry may POST).
	MarkPartialFailed(ctx context.Context, reference, refundKey string, fence Fence) (applied bool, err error)
	// MarkPartialPostAttempt stamps post_attempted_at = now under fence. It MUST be
	// called (and succeed) BEFORE the gateway refund POST.
	MarkPartialPostAttempt(ctx context.Context, reference, refundKey string, fence Fence) (applied bool, err error)
	// GetPartial returns the row, or (nil, nil) when none exists.
	GetPartial(ctx context.Context, reference, refundKey string) (*PartialRefund, error)
	// ListPartialsForSweep: rows 'refunding' whose last claim is older than olderThan.
	ListPartialsForSweep(ctx context.Context, olderThan time.Duration, limit int) ([]PartialRefund, error)
	// ListPartialsAwaitingLedger: rows 'refunded' whose settlement is still
	// escrowed/disputed (the ledger half never finished). A fake may return every
	// refunded row — the engine re-checks the settlement itself.
	ListPartialsAwaitingLedger(ctx context.Context, olderThan time.Duration, limit int) ([]PartialRefund, error)
}

// PartialGateway is the gateway slice piece refunds need beyond EngineGateway:
// a refund stamped with a note, and a lookup of EVERY refund of a transaction.
type PartialGateway interface {
	RefundPaymentNoted(ctx context.Context, reference string, amountKobo int64, note string) (*provider.RefundResult, error)
	LookupRefunds(ctx context.Context, reference string) ([]provider.RefundResult, error)
}

// EnablePartialRefunds turns on piece refunds. Wiring-time only. Without it a
// settlement that is a piece of a charge fails closed (ErrPartialRefundsUnsupported).
// Parcel, towing and movers never need it.
func (e *Engine) EnablePartialRefunds(gw PartialGateway, st PartialRefundStore) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.partialGW, e.partialStore = gw, st
}

// defaultPartialLagBound: how long after a gateway refund POST was STARTED an
// empty gateway lookup is still not trusted to mean "no refund exists" (the
// refund list can lag the POST; an ambiguous reply + an empty list must never
// allow an immediate second POST — that would double-refund a deposit). Tunable
// via SetPartialLagBound (env TRANSPORT_CARD_DIRECT_REFUND_LAG_MINUTES).
const defaultPartialLagBound = 10 * time.Minute

// SetPartialLagBound overrides the lag bound (wiring-time; d <= 0 keeps the default).
func (e *Engine) SetPartialLagBound(d time.Duration) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.partialLag = d
}

// PartialLagBound reports the effective lag bound (wiring tests).
func (e *Engine) PartialLagBound() time.Duration { return e.lagBound() }

func (e *Engine) lagBound() time.Duration {
	e.mu.RLock()
	defer e.mu.RUnlock()
	if e.partialLag > 0 {
		return e.partialLag
	}
	return defaultPartialLagBound
}

func (e *Engine) partials() (PartialGateway, PartialRefundStore, bool) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.partialGW, e.partialStore, e.partialGW != nil && e.partialStore != nil
}

func partialNote(reference, refundKey string) string { return reference + "#" + refundKey }

// validatePiece checks, BEFORE any gateway call, that sett is a live external
// settlement that is one piece of rec's charge.
func validatePiece(rec *Intent, sett *settlement.Settlement) error {
	suffix := strings.TrimPrefix(sett.IdempotencyKey, rec.Reference+":")
	switch {
	case sett.FundingSource != "external":
		return fmt.Errorf("paystackcheckout: settlement %s is %q-funded, not external — refusing a gateway refund", sett.ID, sett.FundingSource)
	case !strings.HasPrefix(sett.IdempotencyKey, rec.Reference+":") || suffix == "" || strings.Contains(suffix, ":"):
		return fmt.Errorf("paystackcheckout: settlement %s (key %q) is not a piece of %s — refusing a gateway refund", sett.ID, sett.IdempotencyKey, rec.Reference)
	case sett.PayerID != rec.PayerID:
		return fmt.Errorf("paystackcheckout: settlement %s payer differs from intent %s — refusing a gateway refund", sett.ID, rec.Reference)
	case sett.TotalKobo <= 0 || sett.TotalKobo > rec.AmountKobo:
		return fmt.Errorf("paystackcheckout: settlement %s holds %d kobo but %s charged %d — refusing a gateway refund", sett.ID, sett.TotalKobo, rec.Reference, rec.AmountKobo)
	}
	switch sett.Status {
	case settlement.StatusEscrowed, settlement.StatusDisputed:
		return nil
	default:
		return fmt.Errorf("paystackcheckout: settlement %s is %q — not refundable", sett.ID, sett.Status)
	}
}

// refundSettlementPiece refunds ONE settlement of a multi-settlement charge to
// the card (gateway first), then reverses that settlement ledger-side.
func (r domainRefunder) refundSettlementPiece(ctx context.Context, rec *Intent, sett *settlement.Settlement, reason string) error {
	e := r.e
	gw, st, ok := e.partials()
	if !ok {
		return fmt.Errorf("%w (settlement %s of %s)", ErrPartialRefundsUnsupported, sett.ID, rec.Reference)
	}
	// A settlement already reversed ledger-side: fine only if its piece refund is
	// recorded too; otherwise the books and the customer disagree — manual.
	if sett.Status == settlement.StatusRefunded {
		row, err := st.GetPartial(ctx, rec.Reference, sett.ID)
		if err != nil {
			return fmt.Errorf("paystackcheckout: load refund of %s: %w", sett.ID, err)
		}
		if row != nil && row.Status == PartialRefunded {
			return nil
		}
		return fmt.Errorf("paystackcheckout: settlement %s is already refunded ledger-side but no refund of it is recorded at the gateway for %s — needs manual reconciliation (no gateway call made)", sett.ID, rec.Reference)
	}
	if err := validatePiece(rec, sett); err != nil {
		return err
	}

	win := newClaimWindow(ctx)
	gctx, cancel := win.phase(staleClaimAfter / 2)
	defer cancel()
	begin, err := st.BeginPartialRefund(gctx, rec.Reference, sett.ID, sett.ID, sett.TotalKobo, staleClaimAfter)
	if err != nil {
		return fmt.Errorf("paystackcheckout: begin refund of %s (%s): %w", sett.ID, rec.Reference, err)
	}
	if !begin.AlreadyDone {
		out, _, derr := e.drivePartial(gctx, gw, st, rec.Reference, sett.ID, begin.Fence, sett.TotalKobo, begin.ExpectedRefundedKobo, begin.Row.PostAttemptedAt, begin.Now)
		switch out {
		case refundDone:
		case refundLost:
			cur, gerr := st.GetPartial(gctx, rec.Reference, sett.ID)
			if gerr != nil || cur == nil || cur.Status != PartialRefunded {
				return fmt.Errorf("paystackcheckout: refund of %s was taken over by another worker — retry shortly", sett.ID)
			}
		default:
			return fmt.Errorf("paystackcheckout: gateway refund of %s (%s) not completed: %w", sett.ID, rec.Reference, derr)
		}
	}
	if serr := e.settlement.RefundExternal(ctx, sett.ID, reason); serr != nil {
		return fmt.Errorf("paystackcheckout: ledger reversal of %s (%s): %w", sett.ID, rec.Reference, serr)
	}
	return nil
}

type gatewayKind int

const (
	gwNothingInFlight gatewayKind = iota // accepted == books: safe to issue
	gwOurs                               // accepted == books + this piece: already done
	gwOurFailed                          // the gateway lists OUR attempt (our note) as failed: definite non-refund
	gwUnknown                            // anything else: never act
)

// classifyGateway applies rule 3 to the gateway's refund list. Only an explicit
// `failed` status is ignorable; any other non-accepted status (needs-attention,
// reversed, empty, …) is unknowable ⇒ gwUnknown (M1).
func classifyGateway(list []provider.RefundResult, expected, amount int64, note string) (gatewayKind, string, string) {
	var accepted int64
	var ours, lastOfSize string
	var hasOurNote, anyNote, ourFailed bool
	for _, r := range list {
		st := strings.ToLower(strings.TrimSpace(r.Status))
		switch {
		case provider.RefundAccepted(st):
		case st == provider.RefundStatusFailed:
			if r.Note != "" && r.Note == note {
				ourFailed = true
			}
			continue
		default:
			return gwUnknown, "", fmt.Sprintf("a gateway refund (%s, %d kobo) has the unclassifiable status %q", r.ID, r.AmountKobo, r.Status)
		}
		accepted += r.AmountKobo
		if r.Note != "" {
			anyNote = true
		}
		if r.Note == note {
			hasOurNote, ours = true, r.ID
		}
		if r.AmountKobo == amount {
			lastOfSize = r.ID
		}
	}
	inflight := accepted - expected
	switch {
	case inflight == 0:
		if hasOurNote {
			return gwUnknown, "", "an accepted gateway refund carries this piece's note but the books do not record it"
		}
		if ourFailed {
			return gwOurFailed, "", ""
		}
		return gwNothingInFlight, "", ""
	case inflight == amount:
		if hasOurNote {
			return gwOurs, ours, ""
		}
		if anyNote {
			// The gateway echoes notes yet none is ours: the surplus is somebody
			// else's refund of the same size, not ours.
			return gwUnknown, "", "an accepted refund of this size exists but carries another note"
		}
		return gwOurs, lastOfSize, ""
	default:
		return gwUnknown, "", fmt.Sprintf("gateway holds %d accepted kobo, books record %d, this refund is %d", accepted, expected, amount)
	}
}

// drivePartial issues (or verifies) the gateway refund for a piece the caller
// holds 'refunding' under fence, then records the outcome — each write fenced.
// It ALWAYS looks the gateway up first (rule 3), and it re-POSTs only when
//
//	(a) the lookup is clean (accepted == books, no unclassifiable entry), AND
//	(b) no POST was ever started for this piece, or the last one was started
//	    longer ago than the lag bound (the gateway list may lag a POST — an
//	    ambiguous reply + an empty list is NOT proof the refund did not happen).
//
// post_attempted_at is persisted BEFORE every POST. Only a definite failure
// (ErrRefundFailed, a `failed` reply, or our own note listed as `failed`)
// releases the reservation immediately.
func (e *Engine) drivePartial(ctx context.Context, gw PartialGateway, st PartialRefundStore, reference, key string, fence Fence, amount, expected int64, postAttemptedAt *time.Time, now time.Time) (refundOutcome, string, error) {
	note := partialNote(reference, key)
	list, lerr := gw.LookupRefunds(ctx, reference)
	if lerr != nil {
		return refundUnknown, "", fmt.Errorf("verify earlier refunds of %s: %w", reference, lerr)
	}
	switch kind, gid, why := classifyGateway(list, expected, amount, note); kind {
	case gwOurs:
		return e.recordPiece(ctx, st, reference, key, fence, gid)
	case gwOurFailed:
		return e.failPiece(ctx, st, reference, key, fence, fmt.Errorf("the gateway lists this refund attempt as failed"))
	case gwUnknown:
		log.Printf("[transport/paystackcheckout] piece refund %s/%s left refunding: %s — NOT refunding on a guess (manual)", reference, key, why)
		return refundUnknown, "", fmt.Errorf("refund of %s outcome unknowable: %s", key, why)
	}

	if postAttemptedAt != nil {
		if age, bound := now.Sub(*postAttemptedAt), e.lagBound(); age <= bound {
			return refundUnknown, "", fmt.Errorf("a refund POST for %s was started %s ago and is not listed yet — waiting out the gateway lag window (%s) before re-POSTing", key, age.Round(time.Second), bound)
		}
	}
	// Persist the attempt BEFORE the POST: a crash mid-POST must look like "attempted".
	applied, aerr := st.MarkPartialPostAttempt(ctx, reference, key, fence)
	switch {
	case aerr != nil:
		return refundUnknown, "", fmt.Errorf("cannot record the refund attempt for %s — gateway refund NOT issued: %w", key, aerr)
	case !applied:
		return refundLost, "", nil
	}

	res, rerr := gw.RefundPaymentNoted(ctx, reference, amount, note)
	switch {
	case rerr == nil && res != nil && provider.RefundAccepted(res.Status):
		if res.AmountKobo != 0 && res.AmountKobo != amount {
			return refundUnknown, "", fmt.Errorf("gateway refunded %d kobo, asked for %d — needs manual reconciliation", res.AmountKobo, amount)
		}
		return e.recordPiece(ctx, st, reference, key, fence, res.ID)
	case rerr == nil && res != nil && res.Status == provider.RefundStatusFailed, errors.Is(rerr, provider.ErrRefundFailed):
		return e.failPiece(ctx, st, reference, key, fence, fmt.Errorf("gateway refund failed"))
	}

	// Ambiguous (timeout, 5xx, malformed reply, "already reversed", unrecognised
	// status): ask the gateway what it actually holds.
	list, lerr = gw.LookupRefunds(ctx, reference)
	if lerr != nil {
		return refundUnknown, "", fmt.Errorf("refund outcome unknown (refund: %v; lookup: %w)", rerr, lerr)
	}
	switch kind, gid, why := classifyGateway(list, expected, amount, note); kind {
	case gwOurs:
		return e.recordPiece(ctx, st, reference, key, fence, gid) // accepted, reply was lost
	case gwOurFailed:
		return e.failPiece(ctx, st, reference, key, fence, fmt.Errorf("the gateway lists this refund attempt as failed (reply: %v)", rerr))
	case gwUnknown:
		return refundUnknown, "", fmt.Errorf("refund of %s outcome unknowable after an ambiguous reply (%v): %s", key, rerr, why)
	}
	// Clean lookup after an ambiguous reply is NOT proof of failure (the list can
	// lag the POST): leave the piece 'refunding' with the attempt recorded. A later
	// retry/sweep may re-POST only once the lag window has passed.
	if errors.Is(rerr, provider.ErrAlreadyReversed) {
		return refundUnknown, "", fmt.Errorf("gateway reports the transaction already reversed but no refund of this piece is visible: %w", rerr)
	}
	return refundUnknown, "", fmt.Errorf("refund POST for %s was ambiguous (%v) and is not listed yet — left refunding; a re-POST is allowed only after %s", key, rerr, e.lagBound())
}

func (e *Engine) recordPiece(ctx context.Context, st PartialRefundStore, reference, key string, fence Fence, gid string) (refundOutcome, string, error) {
	applied, err := st.MarkPartialRefunded(ctx, reference, key, fence, gid)
	switch {
	case err != nil:
		// The customer WAS refunded. Never downgrade to a failure; leave
		// 'refunding' so the retry/sweep finds it by arithmetic.
		return refundUnknown, gid, fmt.Errorf("gateway refunded %s/%s but recording it failed (left 'refunding'; the reconciler records it by lookup): %w", reference, key, err)
	case !applied:
		return refundLost, gid, nil
	}
	return refundDone, gid, nil
}

func (e *Engine) failPiece(ctx context.Context, st PartialRefundStore, reference, key string, fence Fence, cause error) (refundOutcome, string, error) {
	applied, err := st.MarkPartialFailed(ctx, reference, key, fence)
	switch {
	case err != nil:
		return refundUnknown, "", fmt.Errorf("%v; and releasing the reservation failed: %w", cause, err)
	case !applied:
		return refundLost, "", nil
	}
	return refundNotDone, "", cause
}

// retryPiece re-drives one stranded 'refunding' piece (reconciler).
func (e *Engine) retryPiece(ctx context.Context, row PartialRefund) refundOutcome {
	gw, st, ok := e.partials()
	if !ok {
		return refundLost
	}
	rec, err := e.store.Get(ctx, row.Reference)
	if err != nil || rec == nil {
		return refundBlocked
	}
	sett, err := e.settlement.GetByID(ctx, row.SettlementID)
	if err != nil {
		log.Printf("[transport/paystackcheckout] reconcile piece %s/%s: load settlement: %v", row.Reference, row.RefundKey, err)
		return refundBlocked
	}
	if verr := validatePiece(rec, sett); verr != nil || sett.TotalKobo != row.AmountKobo {
		log.Printf("[transport/paystackcheckout] reconcile piece %s/%s: settlement no longer a refundable piece (%v) — manual", row.Reference, row.RefundKey, verr)
		return refundBlocked
	}
	win := newClaimWindow(ctx)
	bctx, cancel := win.phase(staleClaimAfter / 2)
	defer cancel()
	begin, err := st.BeginPartialRefund(bctx, row.Reference, row.RefundKey, row.SettlementID, row.AmountKobo, staleClaimAfter)
	switch {
	case errors.Is(err, ErrPartialInFlight):
		return refundLost
	case err != nil:
		log.Printf("[transport/paystackcheckout] reconcile piece %s/%s begin: %v", row.Reference, row.RefundKey, err)
		return refundBlocked
	case begin.AlreadyDone:
		return e.finishPieceLedger(bctx, row)
	}
	out, _, derr := e.drivePartial(bctx, gw, st, row.Reference, row.RefundKey, begin.Fence, row.AmountKobo, begin.ExpectedRefundedKobo, begin.Row.PostAttemptedAt, begin.Now)
	if derr != nil {
		log.Printf("[transport/paystackcheckout] reconcile piece %s/%s: %v", row.Reference, row.RefundKey, derr)
	}
	if out == refundDone {
		if lo := e.finishPieceLedger(bctx, row); lo != refundDone {
			return lo
		}
	}
	return out
}

// finishPieceLedger reverses a refunded piece's settlement ledger-side
// (idempotent; no-op if it is no longer escrowed).
func (e *Engine) finishPieceLedger(ctx context.Context, row PartialRefund) refundOutcome {
	sett, err := e.settlement.GetByID(ctx, row.SettlementID)
	if err != nil {
		log.Printf("[transport/paystackcheckout] reconcile piece %s/%s: load settlement: %v", row.Reference, row.RefundKey, err)
		return refundBlocked
	}
	if sett.Status != settlement.StatusEscrowed && sett.Status != settlement.StatusDisputed {
		return refundDone
	}
	if err := e.settlement.RefundExternal(ctx, row.SettlementID, "card_direct_refund_completed"); err != nil {
		log.Printf("[transport/paystackcheckout] reconcile piece %s/%s: ledger reversal failed: %v", row.Reference, row.RefundKey, err)
		return refundBlocked
	}
	return refundDone
}
