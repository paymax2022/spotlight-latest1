package paystackcheckout

// Reconciliation sweeper (H7). Nothing the engine starts may stay stranded:
//   - a paid charge whose webhook never arrived and whose client stopped polling
//   - a 'processing' claim whose owner crashed (stale takeover)
//   - a 'refunding' row whose outcome was unknown (lost reply, failed final write)
//   - amount_mismatch / order_failed rows whose refund definitively did not happen
// Every action is driven through the SAME fenced, idempotent paths the live
// flow uses, and only on gateway-verified facts.

import (
	"context"
	"errors"
	"log"
	"time"

	"spotlight/backend/internal/finance/settlement"
)

// ReconcileStats counts what one Reconcile sweep did.
type ReconcileStats struct {
	Examined, Confirmed, RefundsCompleted, RefundsRetried, Skipped, Errors int
	// CancelRefundsCompleted / CancelRefundsFailed: cancelled bookings whose
	// card refund was driven by step 3 (see CancelledRefundSweeper).
	CancelRefundsCompleted, CancelRefundsFailed int
}

const reconcileBatch = 100

// Reconcile runs one sweep. minAge is how long an intent must have been idle
// before the sweeper touches it (so it never races the live webhook/poll);
// maxAge bounds how far back unpaid checkouts are re-verified (0 = unbounded).
func (e *Engine) Reconcile(ctx context.Context, minAge, maxAge time.Duration) (ReconcileStats, error) {
	var st ReconcileStats

	// 1. Charges that may have been paid: drive them through the normal confirm
	//    path (which verifies with the gateway first; an unpaid checkout simply
	//    stays pending).
	open, err := e.store.ListForSweep(ctx, []string{StatusPending, StatusProcessing}, minAge, maxAge, reconcileBatch)
	if err != nil {
		return st, err
	}
	for _, rec := range open {
		st.Examined++
		res, cerr := e.OnChargeSuccess(ctx, rec.Reference, rec.Reference)
		switch {
		case cerr == nil && res != nil && res.Status == StatusConfirmed:
			st.Confirmed++
		case errors.Is(cerr, ErrChargeNotSuccessful), errors.Is(cerr, ErrVerifyUnavailable), cerr == nil:
			st.Skipped++
		default:
			st.Errors++
			log.Printf("[transport/paystackcheckout] reconcile confirm %s: %v", rec.Reference, cerr)
		}
	}

	// 2. Refunds that never completed. No maxAge: money owed back is chased
	//    until it is back.
	stuck, err := e.store.ListForSweep(ctx, []string{StatusRefunding, StatusAmountMismatch, StatusOrderFailed}, minAge, 0, reconcileBatch)
	if err != nil {
		return st, err
	}
	for _, rec := range stuck {
		if (rec.Status == StatusAmountMismatch || rec.Status == StatusOrderFailed) && rec.RefundReference != nil {
			continue // refunded earlier; nothing owed
		}
		st.Examined++
		switch e.retryRefund(ctx, rec) {
		case refundDone:
			st.RefundsCompleted++
		case refundNotDone, refundUnknown, refundBlocked:
			st.RefundsRetried++
		default:
			st.Skipped++
		}
	}

	// 3. Cancelled bookings whose settlement is still escrowed (the customer's
	//    cancel flipped the booking but the card refund failed / had no refunder).
	//    The entity tables know which bookings are cancelled, so each domain
	//    that implements CancelledRefundSweeper finds and drives its own.
	e.mu.RLock()
	doms := append([]Domain(nil), e.prefixes...)
	e.mu.RUnlock()
	for _, d := range doms {
		sw, ok := d.(CancelledRefundSweeper)
		if !ok {
			continue
		}
		res, serr := sw.SweepCancelledRefunds(ctx, minAge, reconcileBatch)
		st.CancelRefundsCompleted += res.Completed
		st.CancelRefundsFailed += res.Failed
		if serr != nil {
			st.Errors++
			log.Printf("[transport/paystackcheckout] reconcile cancelled-refund sweep (%s): %v", d.Name(), serr)
		}
	}

	// 3. Piece refunds (partial refunds of a multi-settlement charge) that never
	//    completed, and 4. pieces the gateway refunded whose ledger reversal never
	//    ran. Same fenced, lookup-first, idempotent paths as the live refund.
	if _, pst, ok := e.partials(); ok {
		stranded, err := pst.ListPartialsForSweep(ctx, minAge, reconcileBatch)
		if err != nil {
			return st, err
		}
		for _, row := range stranded {
			st.Examined++
			switch e.retryPiece(ctx, row) {
			case refundDone:
				st.RefundsCompleted++
			case refundNotDone, refundUnknown, refundBlocked:
				st.RefundsRetried++
			default:
				st.Skipped++
			}
		}
		pending, err := pst.ListPartialsAwaitingLedger(ctx, minAge, reconcileBatch)
		if err != nil {
			return st, err
		}
		for _, row := range pending {
			sett, gerr := e.settlement.GetByID(ctx, row.SettlementID)
			if gerr != nil || (sett.Status != settlement.StatusEscrowed && sett.Status != settlement.StatusDisputed) {
				continue // finished (or unreadable: next sweep)
			}
			st.Examined++
			if e.finishPieceLedger(ctx, row) == refundDone {
				st.RefundsCompleted++
			} else {
				st.RefundsRetried++
			}
		}
	}
	return st, nil
}

// retryRefund re-drives one stranded refund. Always verifies with the gateway
// before asking it to refund again.
func (e *Engine) retryRefund(ctx context.Context, rec Intent) refundOutcome {
	d, ok := e.domain(rec.Domain)
	if !ok {
		return refundLost
	}
	win := newClaimWindow(ctx)
	bctx, cancel := win.phase(staleClaimAfter / 2)
	defer cancel()

	br, began, err := e.store.BeginRefund(bctx, rec.Reference, []string{StatusAmountMismatch, StatusOrderFailed}, staleClaimAfter)
	if err != nil {
		log.Printf("[transport/paystackcheckout] reconcile begin refund %s: %v", rec.Reference, err)
		return refundBlocked
	}
	if !began {
		return refundLost
	}
	restore := func(cause string) refundOutcome {
		log.Printf("[transport/paystackcheckout] reconcile %s: %s — left %s for manual review", rec.Reference, cause, br.RefundFrom)
		_, _ = e.store.Mark(bctx, rec.Reference, Transition{From: StatusRefunding, To: br.RefundFrom, Fence: br.Fence})
		return refundBlocked
	}

	if br.RefundFrom == StatusOrderFailed {
		// Book was attempted for this charge. Never refund a charge that backs a
		// real booking; and re-assert the ledger unwind before the money goes.
		_, found, ferr := d.Find(bctx, rec.PayerID, rec.Reference)
		if ferr != nil {
			return restore("cannot determine whether a booking exists: " + ferr.Error())
		}
		if found {
			return restore("a booking exists for this charge — NOT refunding (needs manual reconciliation)")
		}
		if lerr := e.reverseLedger(bctx, rec.Reference, "card_direct_order_failed"); lerr != nil {
			return restore("ledger unwind failed: " + lerr.Error())
		}
	}

	out, _, derr := e.driveRefund(bctx, rec.Reference, br.Fence, br.RefundAmountKobo, br.RefundFrom, true)
	if derr != nil {
		log.Printf("[transport/paystackcheckout] reconcile refund %s: %v", rec.Reference, derr)
	}
	if out == refundDone && br.RefundFrom == StatusConfirmed {
		// A cancelled booking's refund was finished here (its cancel handler may
		// never retry): reverse the escrow too, so books and customer agree.
		if lerr := e.reverseLedger(bctx, rec.Reference, "card_direct_refund_completed"); lerr != nil {
			log.Printf("[transport/paystackcheckout] reconcile %s: refund recorded but ledger reversal failed: %v — cancel retry / manual", rec.Reference, lerr)
		}
	}
	return out
}

// StartReconciler runs Reconcile on a ticker until ctx is cancelled. Multi-
// instance safe: every action is a fenced, idempotent store transition.
func StartReconciler(ctx context.Context, e *Engine, interval, minAge time.Duration) {
	if e == nil || ctx.Err() != nil {
		return
	}
	if interval <= 0 {
		interval = 5 * time.Minute
	}
	if minAge <= 0 {
		minAge = 5 * time.Minute
	}
	run := func() {
		cctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
		defer cancel()
		st, err := e.Reconcile(cctx, minAge, 7*24*time.Hour)
		if err != nil {
			log.Printf("[transport/paystackcheckout] reconcile sweep error: %v", err)
			return
		}
		if st.Confirmed+st.RefundsCompleted+st.RefundsRetried+st.CancelRefundsCompleted+st.CancelRefundsFailed+st.Errors > 0 {
			log.Printf("[transport/paystackcheckout] reconcile sweep: %+v", st)
		}
	}
	go func() {
		run()
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				run()
			}
		}
	}()
	log.Printf("[transport/paystackcheckout] reconciler started (interval %s, min age %s)", interval, minAge)
}
