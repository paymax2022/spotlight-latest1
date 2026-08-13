package restaurant

import (
	"context"
	"errors"
	"fmt"
	"log"

	"spotlight/backend/internal/finance/ledger"
)

// Rider tip clawback on post-settlement food disputes (ADR-030).
//
// A food dispute resolves only on a DELIVERED order, so settlement has already paid the
// rider 100% of the customer's tip. The platform-funded refund is capped at the non-tip
// basis (see platformRefundableKobo) — so the tip, if it is to come back to the customer
// at all, has to come from the party that was paid it. This file is that path:
//
//	refund_full on a tipped order with a rider
//	  → record the obligation (restaurant_dispute_tip_clawbacks, keyed by dispute id)
//	  → try to settle it NOW: one balanced pair, DR rider wallet → CR customer wallet
//	  → if the rider's wallet is short (they have already withdrawn), leave it PENDING
//	     and recover it off their next delivery settlement (recoverRiderTipDebts).
//
// The rider's wallet is NEVER driven negative: ledger.Debit performs the sufficiency
// check and the insert atomically under the wallet's advisory lock, so an unaffordable
// clawback fails cleanly and stays queued instead of overdrawing.
//
// Deliberately NOT applied to refund_partial: a partial refund is characteristically a
// restaurant fault (wrong_item, quality), and taking a rider's tip for the kitchen's
// mistake is indefensible. The partial branch is still bounded by the non-tip basis, so
// it cannot refund the tip by another route.

// tipClawbackKey is the ledger idempotency key + reference for a dispute's tip clawback.
// One key per dispute: the immediate attempt at resolution and every later recovery sweep
// post under the SAME key, so the pair can be written at most once however many times the
// path is re-driven.
func tipClawbackKey(disputeID string) string { return "dispute-tip-clawback:" + disputeID }

// recordTipClawback durably records the obligation to return `tipKobo` to the customer
// out of the rider's earnings, keyed by dispute id. Idempotent — a re-resolve of the same
// dispute does not queue a second debt.
func (s *Service) recordTipClawback(ctx context.Context, disputeID, orderID, riderID, customerID string, tipKobo int64) error {
	_, err := s.db.Exec(ctx,
		`INSERT INTO restaurant_dispute_tip_clawbacks (dispute_id, order_id, rider_id, customer_id, tip_kobo, status)
		 VALUES ($1,$2,$3,$4,$5,'pending') ON CONFLICT (dispute_id) DO NOTHING`,
		disputeID, orderID, riderID, customerID, tipKobo)
	if err != nil {
		return fmt.Errorf("restaurant: record tip clawback: %w", err)
	}
	return nil
}

// settleTipClawback attempts the actual money move for one recorded clawback: a single
// balanced pair debiting the rider's wallet and crediting the customer's. Reports whether
// the debt is now discharged.
//
// Returns (false, nil) — NOT an error — when the rider's wallet cannot cover it. That is
// the expected steady state for a rider who has already withdrawn, and it leaves the row
// pending for the next settlement sweep.
func (s *Service) settleTipClawback(ctx context.Context, disputeID, riderID, customerID string, tipKobo int64) (bool, error) {
	custAcc, err := s.ledger.GetOrCreateUserWallet(ctx, customerID)
	if err != nil {
		return false, err
	}
	key := tipClawbackKey(disputeID)

	// DR rider wallet → CR customer wallet as ONE balanced pair. Debit does the balance
	// check and the insert inside a single transaction under the rider's advisory lock,
	// so this can never overdraw the rider and never races another debit of that wallet.
	err = s.ledger.Debit(ctx, riderID, key, key, custAcc.ID, tipKobo)
	switch {
	case err == nil:
		return true, nil

	case errors.Is(err, ledger.ErrInsufficientFunds):
		// Expected: the rider has already withdrawn the tip. Stay pending.
		return false, nil

	case errors.Is(err, ledger.ErrDuplicate):
		// ErrDuplicate is NOT proof the money moved. Debit takes the Redis idempotency
		// lock BEFORE its balance check, so an attempt that failed on insufficient funds
		// leaves that lock held for its 10s TTL — and a retry inside that window reports
		// duplicate having posted nothing. Ask the ledger of record instead (Posted reads
		// the credit side of the pair from the DB, Redis-independent). Only a durable
		// entry discharges the debt; otherwise stay pending and try again later.
		posted, perr := s.ledger.Posted(ctx, key)
		if perr != nil {
			return false, fmt.Errorf("restaurant: confirm tip clawback posting: %w", perr)
		}
		return posted, nil

	default:
		return false, fmt.Errorf("restaurant: tip clawback debit: %w", err)
	}
}

// markTipClawbackRecovered flips a settled debt to 'recovered'. Guarded on the pending
// status so a concurrent sweep cannot double-stamp it, and paired with the table's
// status/recovered_at CHECK.
func (s *Service) markTipClawbackRecovered(ctx context.Context, disputeID string) error {
	if _, err := s.db.Exec(ctx,
		`UPDATE restaurant_dispute_tip_clawbacks
		    SET status='recovered', recovered_at=NOW()
		  WHERE dispute_id=$1 AND status='pending'`, disputeID); err != nil {
		return fmt.Errorf("restaurant: mark tip clawback recovered: %w", err)
	}
	return nil
}

// clawBackDisputedTip records the obligation and immediately tries to discharge it.
// Called from the dispute resolve path for refund_full on a tipped order.
//
// ORDERING: the row is written BEFORE the money move is attempted, the mirror of the
// refund path's "move first, then record". Here the record is the DEBT, not the receipt —
// a crash after a successful debit leaves a pending row whose ledger pair already exists,
// which the next sweep resolves through Posted and stamps correctly. A crash the other
// way round (money moved, no row) would silently forget the obligation, which is the one
// outcome that cannot be recovered from.
//
// Reports whether the customer has been credited the tip already.
func (s *Service) clawBackDisputedTip(ctx context.Context, disputeID, orderID, riderID, customerID string, tipKobo int64) (bool, error) {
	if err := s.recordTipClawback(ctx, disputeID, orderID, riderID, customerID, tipKobo); err != nil {
		return false, err
	}
	recovered, err := s.settleTipClawback(ctx, disputeID, riderID, customerID, tipKobo)
	if err != nil {
		return false, err
	}
	if recovered {
		if err := s.markTipClawbackRecovered(ctx, disputeID); err != nil {
			return false, err
		}
	} else {
		log.Printf("[restaurant] dispute %s: rider %s cannot cover the %d kobo tip clawback — queued for recovery at their next settlement",
			disputeID, riderID, tipKobo)
	}
	return recovered, nil
}

// recoverRiderTipDebts sweeps a rider's outstanding tip clawbacks, oldest first, and
// discharges every one their wallet can now cover — crediting each disputing customer.
// Called right after a settlement has paid the rider, which is the moment their balance
// is highest.
//
// BEST-EFFORT by design: it must never fail the settlement that triggered it. The
// settlement's own legs are already committed by then, and a debt that cannot be
// recovered on this pass is still pending for the next one, so the correct response to
// any error here is to log and move on rather than unwind a completed payout.
//
// Recovery is all-or-nothing per debt: a debt is discharged only when the wallet covers
// it in full. Balances accumulate across deliveries, so a rider whose single next payout
// is smaller than the tip still converges — just over a few deliveries rather than one.
// It also keeps each debt to exactly one ledger pair under one idempotency key, which a
// part-paid debt could not be.
func (s *Service) recoverRiderTipDebts(ctx context.Context, riderID string) {
	if s.ledger == nil || riderID == "" {
		return
	}
	rows, err := s.db.Query(ctx,
		`SELECT dispute_id, customer_id, tip_kobo
		   FROM restaurant_dispute_tip_clawbacks
		  WHERE rider_id=$1 AND status='pending'
		  ORDER BY created_at`, riderID)
	if err != nil {
		log.Printf("[restaurant] rider %s: list pending tip clawbacks: %v", riderID, err)
		return
	}
	type debt struct {
		disputeID  string
		customerID string
		tipKobo    int64
	}
	var debts []debt
	for rows.Next() {
		var d debt
		if err := rows.Scan(&d.disputeID, &d.customerID, &d.tipKobo); err != nil {
			rows.Close()
			log.Printf("[restaurant] rider %s: scan pending tip clawback: %v", riderID, err)
			return
		}
		debts = append(debts, d)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		log.Printf("[restaurant] rider %s: read pending tip clawbacks: %v", riderID, err)
		return
	}

	for _, d := range debts {
		recovered, err := s.settleTipClawback(ctx, d.disputeID, riderID, d.customerID, d.tipKobo)
		if err != nil {
			log.Printf("[restaurant] dispute %s: tip clawback recovery failed: %v", d.disputeID, err)
			continue
		}
		if !recovered {
			// Wallet still short. Every later debt is at least as unaffordable right now,
			// but keep going: they are independent obligations and a smaller one further
			// down the queue may well be coverable.
			continue
		}
		if err := s.markTipClawbackRecovered(ctx, d.disputeID); err != nil {
			// The money HAS moved; only the projection is stale. The next sweep re-reads
			// this row, finds the pair already posted via Posted, and stamps it then.
			log.Printf("[restaurant] dispute %s: tip clawback recovered but not stamped: %v", d.disputeID, err)
			continue
		}
		s.notify(ctx, Notification{UserID: d.customerID, Event: EventOrderCancelled,
			Title: "Tip refunded",
			Body:  "The tip from your disputed order has been refunded to your wallet.",
			Data:  map[string]any{"dispute_id": d.disputeID, "refund_kobo": d.tipKobo}})
	}
}
