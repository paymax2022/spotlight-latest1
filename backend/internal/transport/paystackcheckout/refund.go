package paystackcheckout

// Refund machinery. Three rules, each earned from a ledger-audit finding:
//
//  1. RECORD, THEN CALL. The intent is moved to 'refunding' (fenced) BEFORE the
//     gateway is called, so a crash, timeout or lost reply leaves a durable
//     "a refund may exist" marker — never a bare 'processing'/'confirmed' row
//     whose refund might already have left.
//  2. VERIFY, DON'T GUESS. An ambiguous outcome (timeout, 5xx, "already
//     reversed") is resolved by LOOKING UP the refund at the gateway: a found
//     accepted refund is a success (never recorded as amount_mismatch /
//     order_failed); a found failed refund is a definite non-refund; an
//     unknowable outcome stays 'refunding' for the reconciler.
//  3. THE REFUND STATUS IS PART OF THE ANSWER. pending / processing / processed
//     mean the customer gets (or has) the money; failed means they do not.

import (
	"context"
	"errors"
	"fmt"
	"log"

	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/provider"
)

type refundOutcome int

const (
	// refundDone: the gateway accepted the refund and the intent is 'refunded'.
	refundDone refundOutcome = iota
	// refundNotDone: the gateway definitely did not refund; the intent was
	// restored to its pre-refund failure status (the reconciler retries).
	refundNotDone
	// refundUnknown: outcome unknowable right now (or the final write failed);
	// the intent stays 'refunding' and the reconciler resolves it by lookup.
	refundUnknown
	// refundLost: the fence was lost — a successor owns the row; do nothing more.
	refundLost
	// refundBlocked: a precondition (ledger unwind) failed; nothing was sent
	// to the gateway and the intent was left in its claimed state for retry.
	refundBlocked
)

// refundUnbooked refunds a verified charge that cannot back a booking. The
// caller holds `fence` on a 'processing' row.
func (e *Engine) refundUnbooked(ctx context.Context, rec *Intent, fence Fence, collectedKobo int64, failStatus string, reverseLedger bool) refundOutcome {
	if reverseLedger {
		// H6: Book may have escrowed (EscrowExternal) and then failed before —
		// or while — compensating. Reverse the external settlement for this
		// reference BEFORE refunding the customer so the books balance whatever
		// Book managed to do. Idempotent; a no-op when nothing was escrowed.
		if err := e.settlement.RefundExternalByKey(ctx, rec.Reference, "card_direct_order_failed"); err != nil {
			log.Printf("[transport/paystackcheckout] ledger unwind failed for %s (%v) — gateway refund NOT issued; left processing for retry", rec.Reference, err)
			return refundBlocked
		}
	}
	applied, err := e.store.Mark(ctx, rec.Reference, Transition{
		From: StatusProcessing, To: StatusRefunding, Fence: fence,
		RefundFrom: failStatus, RefundAmountKobo: collectedKobo,
	})
	if err != nil {
		log.Printf("[transport/paystackcheckout] cannot record refunding for %s: %v — gateway refund NOT issued; left processing for retry", rec.Reference, err)
		return refundBlocked
	}
	if !applied {
		return refundLost
	}
	out, _, err := e.driveRefund(ctx, rec.Reference, fence, collectedKobo, failStatus, false)
	if err != nil {
		log.Printf("[transport/paystackcheckout] refund of %s (%d kobo, reason=%s): %v", rec.Reference, collectedKobo, failStatus, err)
	}
	return out
}

// driveRefund issues (or verifies) the gateway refund for a row the caller
// holds in 'refunding' under `fence`, then records the outcome — each write
// conditional on the fence. lookupFirst ⇒ a previous attempt may have reached
// the gateway, so ask it before asking it to refund again.
func (e *Engine) driveRefund(ctx context.Context, reference string, fence Fence, amountKobo int64, restoreTo string, lookupFirst bool) (refundOutcome, string, error) {
	if lookupFirst {
		res, err := e.gateway.LookupRefund(ctx, reference)
		switch {
		case err != nil:
			return refundUnknown, "", fmt.Errorf("verify earlier refund: %w", err)
		case res != nil && provider.RefundAccepted(res.Status):
			return e.recordRefunded(ctx, reference, fence, res.Reference)
		}
		// none found, or only failed attempts → safe to issue one.
	}

	res, rerr := e.gateway.RefundPayment(ctx, reference, amountKobo)
	switch {
	case rerr == nil && res != nil && provider.RefundAccepted(res.Status):
		if res.AmountKobo != 0 && res.AmountKobo != amountKobo {
			// A partial refund is not "the customer got their money back".
			return refundUnknown, "", fmt.Errorf("gateway refunded %d kobo, asked for %d — needs manual reconciliation", res.AmountKobo, amountKobo)
		}
		return e.recordRefunded(ctx, reference, fence, res.Reference)
	case rerr == nil && res != nil && res.Status == provider.RefundStatusFailed,
		errors.Is(rerr, provider.ErrRefundFailed):
		return e.recordNotRefunded(ctx, reference, fence, restoreTo, fmt.Errorf("gateway refund failed"))
	}

	// Ambiguous: an error that is not a definite failure (timeout, 5xx, a
	// malformed reply, "already reversed"), or an unrecognised refund status.
	// Ask the gateway what it actually holds.
	lres, lerr := e.gateway.LookupRefund(ctx, reference)
	switch {
	case lerr != nil:
		return refundUnknown, "", fmt.Errorf("refund outcome unknown (refund: %v; lookup: %w)", rerr, lerr)
	case lres != nil && provider.RefundAccepted(lres.Status):
		return e.recordRefunded(ctx, reference, fence, lres.Reference) // accepted, reply was lost
	case lres != nil && lres.Status == provider.RefundStatusFailed:
		return e.recordNotRefunded(ctx, reference, fence, restoreTo, errors.New("gateway refund attempt shows failed"))
	case errors.Is(rerr, provider.ErrAlreadyReversed):
		// The gateway says a refund exists but we cannot see it: do not claim
		// either way. Stay 'refunding'; the reconciler will look again.
		return refundUnknown, "", fmt.Errorf("gateway reports the transaction already reversed but no refund is visible: %w", rerr)
	}
	// Request errored and the gateway holds no refund for the transaction: it
	// did not happen. Restore the failure status so the reconciler retries.
	return e.recordNotRefunded(ctx, reference, fence, restoreTo, fmt.Errorf("gateway refund not accepted: %v", rerr))
}

func (e *Engine) recordRefunded(ctx context.Context, reference string, fence Fence, refundRef string) (refundOutcome, string, error) {
	if refundRef == "" {
		refundRef = "rf:" + reference
	}
	applied, err := e.store.Mark(ctx, reference, Transition{From: StatusRefunding, To: StatusRefunded, Fence: fence, RefundReference: &refundRef})
	switch {
	case err != nil:
		// The customer WAS refunded. Do NOT downgrade the row to a failure
		// status; leave 'refunding' so the reconciler records it by lookup.
		return refundUnknown, refundRef, fmt.Errorf("gateway refunded %s but recording it failed (left 'refunding' — the reconciler verifies and records it): %w", reference, err)
	case !applied:
		return refundLost, refundRef, nil
	}
	return refundDone, refundRef, nil
}

func (e *Engine) recordNotRefunded(ctx context.Context, reference string, fence Fence, restoreTo string, cause error) (refundOutcome, string, error) {
	if restoreTo == "" {
		restoreTo = StatusOrderFailed
	}
	applied, err := e.store.Mark(ctx, reference, Transition{From: StatusRefunding, To: restoreTo, Fence: fence})
	switch {
	case err != nil:
		return refundUnknown, "", fmt.Errorf("%v; and restoring %s failed: %w", cause, restoreTo, err)
	case !applied:
		return refundLost, "", nil
	}
	return refundNotDone, "", cause
}

// RefundExternalSettlement does BOTH halves of a real refund for a CANCELLED
// booking, ordered so a partial failure is retryable and never double-refunds
// the customer:
//
//  0. the settlement is loaded and must BE this intent's live external escrow
//     (external funding, escrowed/disputed, same payer, same amount, same
//     reference) — before ANY gateway call;
//  1. gateway refund (intent → 'refunding' first; skipped if the intent is
//     already 'refunded'; an ambiguous outcome is resolved by lookup);
//  2. ledger reversal (settlement.RefundExternal — idempotent).
//
// Failure after (1) leaves the intent 'refunded' and the settlement still
// 'escrowed'; the next attempt skips the gateway and finishes the ledger.
func (r domainRefunder) RefundExternalSettlement(ctx context.Context, entityID, settlementID, reason string) error {
	e := r.e
	rec, err := e.store.GetByEntity(ctx, r.domain, entityID)
	if err != nil || rec == nil {
		return fmt.Errorf("paystackcheckout: no %s intent found for entity %s: %w", r.domain, entityID, ErrUnknownReference)
	}
	sett, err := e.settlement.GetByID(ctx, settlementID)
	if err != nil {
		return fmt.Errorf("paystackcheckout: load settlement %s before refunding %s %s: %w", settlementID, r.domain, entityID, err)
	}
	switch {
	case sett.FundingSource != "external":
		return fmt.Errorf("paystackcheckout: settlement %s is %q-funded, not external — refusing a gateway refund", settlementID, sett.FundingSource)
	case sett.IdempotencyKey != rec.Reference:
		return fmt.Errorf("paystackcheckout: settlement %s is not the escrow of %s (key %q) — refusing a gateway refund", settlementID, rec.Reference, sett.IdempotencyKey)
	case sett.PayerID != rec.PayerID:
		return fmt.Errorf("paystackcheckout: settlement %s payer differs from intent %s — refusing a gateway refund", settlementID, rec.Reference)
	case sett.TotalKobo != rec.AmountKobo:
		return fmt.Errorf("paystackcheckout: settlement %s holds %d kobo but %s charged %d — refusing a gateway refund", settlementID, sett.TotalKobo, rec.Reference, rec.AmountKobo)
	}
	switch sett.Status {
	case settlement.StatusEscrowed, settlement.StatusDisputed:
		// refundable
	case settlement.StatusRefunded:
		if rec.Status == StatusRefunded {
			return nil // both halves already done
		}
		return fmt.Errorf("paystackcheckout: settlement %s is already refunded ledger-side but %s is %q at the gateway — needs manual reconciliation (no gateway call made)", settlementID, rec.Reference, rec.Status)
	default:
		return fmt.Errorf("paystackcheckout: settlement %s is %q — not refundable", settlementID, sett.Status)
	}

	if rec.Status != StatusRefunded {
		if rec.Status != StatusConfirmed && rec.Status != StatusRefunding {
			return fmt.Errorf("paystackcheckout: intent %s is %q — only a confirmed booking can be refunded on cancel", rec.Reference, rec.Status)
		}
		win := newClaimWindow(ctx)
		gctx, cancel := win.phase(staleClaimAfter / 2)
		defer cancel()
		br, ok, berr := e.store.BeginRefund(gctx, rec.Reference, []string{StatusConfirmed}, staleClaimAfter)
		if berr != nil {
			return fmt.Errorf("paystackcheckout: begin refund %s: %w", rec.Reference, berr)
		}
		if !ok {
			cur, gerr := e.store.Get(gctx, rec.Reference)
			if gerr != nil || cur == nil || cur.Status != StatusRefunded {
				return fmt.Errorf("paystackcheckout: a refund of %s is already in progress — retry shortly", rec.Reference)
			}
		} else {
			out, _, derr := e.driveRefund(gctx, rec.Reference, br.Fence, br.RefundAmountKobo, br.RefundFrom, br.Prev == StatusRefunding)
			switch out {
			case refundDone:
			case refundLost:
				cur, gerr := e.store.Get(gctx, rec.Reference)
				if gerr != nil || cur == nil || cur.Status != StatusRefunded {
					return fmt.Errorf("paystackcheckout: refund of %s was taken over by another worker — retry shortly", rec.Reference)
				}
			default:
				return fmt.Errorf("paystackcheckout: gateway refund for %s %s not completed: %w", r.domain, entityID, derr)
			}
		}
	}
	if serr := e.settlement.RefundExternal(ctx, settlementID, reason); serr != nil {
		return fmt.Errorf("paystackcheckout: ledger reversal for %s %s: %w", r.domain, entityID, serr)
	}
	return nil
}

// completeBooked is a tiny helper for the reconciler: after the gateway refund
// of a CANCELLED booking is recorded, make sure its escrow is reversed too.
func (e *Engine) reverseLedger(ctx context.Context, reference, reason string) error {
	return e.settlement.RefundExternalByKey(ctx, reference, reason)
}
