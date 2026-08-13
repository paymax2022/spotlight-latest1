package restaurant

import (
	"context"
	"errors"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5"

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

// riderWasPaidTip reports whether the rider on this order actually RECEIVED the tip at
// settlement. The clawback must never fire on a belief — orders.tip_kobo records what the
// customer was charged, not what the rider was paid, and the two come apart:
//
//   - ESCROW DIVERGENCE. settleOrder drops the tip leg when the escrow does not cover the
//     order (settlements.total_kobo != orders.total_kobo), releasing the tip through the
//     percentages instead — 90/10 to restaurant/platform. It zeroes only its LOCAL tip
//     variable; orders.tip_kobo stays nonzero. Clawing that back would debit the rider a
//     tip they never got, with no compensating credit anywhere.
//   - DELIVERED BUT NOT YET SETTLED. transitionInternal commits status='delivered' and
//     only then calls settleOrder, outside any transaction; a settle failure leaves a
//     delivered order whose escrow is still held (this window is exactly why the
//     crash-recovery reconciler exists). A dispute can be raised AND resolved inside it,
//     and the tip is still sitting in escrow, not in the rider's wallet.
//
// The predicate has two halves, and needs both:
//
//   - The settlement must be SETTLED with its escrowed total equal to the order total.
//     This mirrors settleOrder's own decision and is what establishes that the tip leg
//     was INCLUDED in the payout rather than dropped.
//   - The rider settlement leg must exist ON THIS RIDER'S WALLET (idempotency key
//     `settle:<settlementID>:rider:credit`, written by settlement.Settle). This is what
//     establishes the payee. orders.rider_id is not evidence of who was paid: AcceptDelivery
//     guards only on there being no existing rider, not on order status, so a rider can be
//     attached to an already-settled order — one that settled through the RIDER-LESS branch,
//     which orphans the tip 90/10 to restaurant/platform. Without this half, that newly
//     attached rider would be debited for a tip that went to the restaurant.
//
// Amount alone would not do: a rider's plain percentage share can exceed a small tip, so
// `leg >= tip` proves nothing about whether the tip was in it.
func (s *Service) riderWasPaidTip(ctx context.Context, settlementID, riderID string, orderTotalKobo int64) (bool, error) {
	if settlementID == "" || riderID == "" {
		return false, nil
	}
	var status string
	var escrowedKobo int64
	if err := s.db.QueryRow(ctx,
		`SELECT status, total_kobo FROM settlements WHERE id=$1`, settlementID).Scan(&status, &escrowedKobo); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// A dangling settlement_id. Treat exactly like "no settlement": decline the
			// clawback, do NOT error — this runs AFTER the platform refund has posted, so
			// returning an error here would leave the ticket permanently unresolvable with
			// real money already moved and no resolution record to show for it.
			return false, nil
		}
		return false, fmt.Errorf("restaurant: load settlement for tip clawback: %w", err)
	}
	if status != "settled" || escrowedKobo != orderTotalKobo {
		return false, nil
	}
	riderAcc, err := s.ledger.GetOrCreateUserWallet(ctx, riderID)
	if err != nil {
		return false, err
	}
	var paid bool
	if err := s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM ledger_entries
		                WHERE idempotency_key=$1 AND type='CREDIT' AND account_id=$2)`,
		"settle:"+settlementID+":rider:credit", riderAcc.ID).Scan(&paid); err != nil {
		return false, fmt.Errorf("restaurant: confirm rider settlement leg: %w", err)
	}
	return paid, nil
}

// recordTipClawback durably records the obligation to return `tipKobo` to the customer out
// of the rider's earnings. Reports whether THIS dispute owns the order's clawback.
//
// Uniqueness is per ORDER, not per dispute. The disputes table only blocks a second
// CONCURRENTLY ACTIVE ticket on an order (status in open/investigating), and disputed_at
// is a marker rather than a gate — so once a dispute resolves, a second one is raisable on
// the same delivered order and would otherwise mint a fresh clawback key, debiting the
// rider the same tip twice and crediting the customer twice. A tip can be clawed back at
// most once per order, ever; the DB unique index on order_id is the hard guarantee and
// this read-back is how the caller learns it lost the race.
// Also returns the RECORDED tip amount, which is authoritative over the caller's freshly
// read orders.tip_kobo: on a retry the row may already exist from an earlier attempt, and
// the ledger pair is keyed to the debt, so the debt's own amount is what must move.
func (s *Service) recordTipClawback(ctx context.Context, disputeID, orderID, riderID, customerID string, tipKobo int64) (owns bool, recordedKobo int64, err error) {
	// Untargeted ON CONFLICT so BOTH the dispute_id primary key and the order_id unique
	// index are absorbed as no-ops rather than erroring.
	if _, err := s.db.Exec(ctx,
		`INSERT INTO restaurant_dispute_tip_clawbacks (dispute_id, order_id, rider_id, customer_id, tip_kobo, status)
		 VALUES ($1,$2,$3,$4,$5,'pending') ON CONFLICT DO NOTHING`,
		disputeID, orderID, riderID, customerID, tipKobo); err != nil {
		return false, 0, fmt.Errorf("restaurant: record tip clawback: %w", err)
	}
	if err := s.db.QueryRow(ctx,
		`SELECT tip_kobo FROM restaurant_dispute_tip_clawbacks WHERE dispute_id=$1`,
		disputeID).Scan(&recordedKobo); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, 0, nil // an earlier dispute on this order owns the clawback
		}
		return false, 0, fmt.Errorf("restaurant: read back tip clawback: %w", err)
	}
	return true, recordedKobo, nil
}

// settleTipClawback attempts the actual money move for one recorded clawback: a single
// balanced pair debiting the rider's wallet and crediting the customer's. Reports whether
// the debt is now discharged.
//
// Returns (false, nil) — NOT an error — when the rider's wallet cannot cover it. That is
// the expected steady state for a rider who has already withdrawn, and it leaves the row
// pending for the next settlement sweep.
func (s *Service) settleTipClawback(ctx context.Context, disputeID, riderID, customerID string, tipKobo int64) (bool, error) {
	key := tipClawbackKey(disputeID)

	// Ask the LEDGER OF RECORD first, before attempting anything. Neither error Debit can
	// return is proof about whether the pair exists:
	//
	//   - ErrDuplicate is not proof it DID post. Debit takes the Redis idempotency lock
	//     before its balance check, so an attempt that failed on insufficient funds holds
	//     that lock for its 10s TTL and a retry inside the window reports duplicate having
	//     posted nothing.
	//   - ErrInsufficientFunds is not proof it did NOT post. DebitWithBalanceCheck runs
	//     the sufficiency check BEFORE its ON CONFLICT DO NOTHING insert (ledger/
	//     repository.go), so replaying an ALREADY-POSTED clawback after the rider's
	//     balance has fallen below the tip returns insufficient funds — and treating that
	//     as "not recovered" would strand the debt as pending forever against a rider who
	//     has already paid, and re-notify the customer when a later sweep finally cleared.
	//
	// Posted reads the credit side of the pair from the DB and is Redis-independent, so it
	// settles the question outright. One cheap indexed read per attempt.
	posted, perr := s.ledger.Posted(ctx, key)
	if perr != nil {
		return false, fmt.Errorf("restaurant: confirm tip clawback posting: %w", perr)
	}
	if posted {
		return true, nil
	}

	custAcc, err := s.ledger.GetOrCreateUserWallet(ctx, customerID)
	if err != nil {
		return false, err
	}

	// DR rider wallet → CR customer wallet as ONE balanced pair. Debit does the balance
	// check and the insert inside a single transaction under the rider's advisory lock,
	// so this can never overdraw the rider and never races another debit of that wallet.
	err = s.ledger.Debit(ctx, riderID, key, key, custAcc.ID, tipKobo)
	switch {
	case err == nil:
		return true, nil

	case errors.Is(err, ledger.ErrInsufficientFunds):
		// Expected: the rider has already withdrawn the tip. Stay pending. (Not an
		// already-posted pair — the Posted check above ruled that out.)
		return false, nil

	case errors.Is(err, ledger.ErrDuplicate):
		// A concurrent sweep posted it between our Posted check and here. Re-read the
		// ledger of record rather than assuming either way.
		posted, perr := s.ledger.Posted(ctx, key)
		if perr != nil {
			return false, fmt.Errorf("restaurant: confirm tip clawback posting: %w", perr)
		}
		return posted, nil

	default:
		return false, fmt.Errorf("restaurant: tip clawback debit: %w", err)
	}
}

// markTipClawbackRecovered flips a settled debt to 'recovered' and reports whether THIS
// call performed the flip. Guarded on the pending status so a concurrent sweep cannot
// double-stamp it, and paired with the table's status/recovered_at CHECK.
//
// The bool matters: the loser of a race between two settlements for one rider (or a sweep
// racing a resolution) also reaches this point with recovered==true, and without the
// row-count guard both would notify the customer for a single credit.
func (s *Service) markTipClawbackRecovered(ctx context.Context, disputeID string) (bool, error) {
	tag, err := s.db.Exec(ctx,
		`UPDATE restaurant_dispute_tip_clawbacks
		    SET status='recovered', recovered_at=NOW()
		  WHERE dispute_id=$1 AND status='pending'`, disputeID)
	if err != nil {
		return false, fmt.Errorf("restaurant: mark tip clawback recovered: %w", err)
	}
	return tag.RowsAffected() > 0, nil
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
	owns, recordedKobo, err := s.recordTipClawback(ctx, disputeID, orderID, riderID, customerID, tipKobo)
	if err != nil {
		return false, err
	}
	if !owns {
		// An earlier dispute on this SAME order already claimed the tip. It is one tip and
		// it comes back once; a second ticket must not debit the rider again.
		log.Printf("[restaurant] dispute %s: order %s already has a tip clawback from an earlier dispute — not clawing the %d kobo tip twice",
			disputeID, orderID, tipKobo)
		return false, nil
	}
	// Move the RECORDED amount, not the freshly-read one — they differ if this is a retry
	// of an attempt whose row was written before orders.tip_kobo was corrected.
	recovered, err := s.settleTipClawback(ctx, disputeID, riderID, customerID, recordedKobo)
	if err != nil {
		return false, err
	}
	if recovered {
		// Report the tip as newly credited ONLY if this call performed the flip. On a retry
		// of a dispute left open by a mid-path error, settleTipClawback short-circuits on
		// Posted and reports recovered without moving anything; announcing it again would
		// tell the customer money arrived that did not.
		stamped, err := s.markTipClawbackRecovered(ctx, disputeID)
		if err != nil {
			return false, err
		}
		return stamped, nil
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
	// The contract above says this must never fail the settlement that triggered it. An
	// error return is not the only way to break that — a panic here would surface as a
	// failed delivery transition on an order that is already delivered AND settled.
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[restaurant] rider %s: tip clawback sweep panicked: %v", riderID, r)
		}
	}()

	rows, err := s.db.Query(ctx,
		`SELECT c.dispute_id, c.customer_id, c.tip_kobo,
		        COALESCE(o.settlement_id::text,''), o.total_kobo
		   FROM restaurant_dispute_tip_clawbacks c
		   JOIN orders o ON o.id = c.order_id
		  WHERE c.rider_id=$1 AND c.status='pending'
		  ORDER BY c.created_at`, riderID)
	if err != nil {
		log.Printf("[restaurant] rider %s: list pending tip clawbacks: %v", riderID, err)
		return
	}
	type debt struct {
		disputeID    string
		customerID   string
		tipKobo      int64
		settlementID string
		orderTotal   int64
	}
	var debts []debt
	for rows.Next() {
		var d debt
		if err := rows.Scan(&d.disputeID, &d.customerID, &d.tipKobo, &d.settlementID, &d.orderTotal); err != nil {
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
		// RE-VERIFY before every debit, not just at recording time. A debt can sit pending
		// for days, and this is the last gate before a third party's wallet is drawn down;
		// re-proving payment here means no change to the order or its settlement in the
		// interim can turn a queued debt into a wrongful debit.
		paid, perr := s.riderWasPaidTip(ctx, d.settlementID, riderID, d.orderTotal)
		if perr != nil {
			log.Printf("[restaurant] dispute %s: re-verify rider tip payment: %v", d.disputeID, perr)
			continue
		}
		if !paid {
			log.Printf("[restaurant] dispute %s: rider %s no longer evidenced as paid the %d kobo tip — skipping clawback",
				d.disputeID, riderID, d.tipKobo)
			continue
		}
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
		stamped, err := s.markTipClawbackRecovered(ctx, d.disputeID)
		if err != nil {
			// The money HAS moved; only the projection is stale. The next sweep re-reads
			// this row, finds the pair already posted via Posted, and stamps it then.
			log.Printf("[restaurant] dispute %s: tip clawback recovered but not stamped: %v", d.disputeID, err)
			continue
		}
		if !stamped {
			// Another sweep stamped it first — it also notified. Don't double-notify for
			// what is a single credit.
			continue
		}
		s.notify(ctx, Notification{UserID: d.customerID, Event: EventOrderCancelled,
			Title: "Tip refunded",
			Body:  "The tip from your disputed order has been refunded to your wallet.",
			Data:  map[string]any{"dispute_id": d.disputeID, "refund_kobo": d.tipKobo}})
	}
}
