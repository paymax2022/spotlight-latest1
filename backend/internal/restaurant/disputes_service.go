package restaurant

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"

	"spotlight/backend/internal/finance/ledger"
)

// FoodDispute is a restaurant food-order dispute (a projection of the shared `disputes`
// ticket + this module's resolution/refund record).
type FoodDispute struct {
	ID          string     `json:"id"`
	OrderID     string     `json:"order_id"`
	ReporterID  string     `json:"reporter_id"`
	Type        string     `json:"type"`
	Description string     `json:"description"`
	Status      string     `json:"status"`
	Resolution  *string    `json:"resolution,omitempty"` // food resolution (refund_full…) once resolved
	RefundKobo  int64      `json:"refund_kobo"`          // platform-funded refund credited to the customer
	AdminNote   *string    `json:"admin_note,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	ResolvedAt  *time.Time `json:"resolved_at,omitempty"`
}

// postedDisputeRefundKobo reads how much has actually been credited to the customer under
// a dispute's platform-refund key, straight from the ledger of record. Reports the amount
// and whether any entry exists.
//
// Redis-independent by construction (it reads ledger_entries), which is the point: it is
// the only way to tell a genuine duplicate from a Redis idempotency lock left behind by an
// attempt that never posted. ledger.Posted answers the boolean; this also needs the amount,
// so it reads the credit leg directly.
func (s *Service) postedDisputeRefundKobo(ctx context.Context, refundKey string) (int64, bool, error) {
	var amountKobo int64
	var found bool
	if err := s.db.QueryRow(ctx,
		`SELECT COALESCE(SUM(amount_kobo),0), COUNT(*) > 0
		   FROM ledger_entries WHERE idempotency_key=$1 AND type='CREDIT'`,
		refundKey+":credit").Scan(&amountKobo, &found); err != nil {
		return 0, false, fmt.Errorf("restaurant: read posted dispute refund: %w", err)
	}
	return amountKobo, found, nil
}

// RaiseFoodDispute opens a dispute against a DELIVERED order (party only). The ticket is
// stored in the shared `disputes` table (module_type='food', reference=order id). Only a
// party to the order (customer/owner/rider) may raise it, and only one dispute may be
// active per order at a time.
func (s *Service) RaiseFoodDispute(ctx context.Context, orderID, actorID, dtype, description string) (*FoodDispute, error) {
	customer, owner, rider, err := s.orderParties(ctx, orderID)
	if err != nil {
		return nil, err
	}
	var status string
	if err := s.db.QueryRow(ctx, `SELECT status FROM orders WHERE id=$1`, orderID).Scan(&status); err != nil {
		return nil, fmt.Errorf("restaurant: order not found")
	}
	if status != string(OrderDelivered) {
		return nil, fmt.Errorf("%w: only a delivered order can be disputed (use cancellation before delivery)", ErrDisputeInvalid)
	}
	if err := validateRaise(actorID, customer, owner, rider, dtype, description); err != nil {
		return nil, err
	}
	// One active dispute per order.
	var active bool
	if err := s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM disputes WHERE reference=$1 AND module_type='food' AND status IN ('open','investigating'))`,
		orderID).Scan(&active); err != nil {
		return nil, err
	}
	if active {
		return nil, fmt.Errorf("%w: this order already has an open dispute", ErrDisputeInvalid)
	}

	id := uuid.New().String()
	if _, err := s.db.Exec(ctx,
		`INSERT INTO disputes (id, user_id, reference, module_type, type, description, status)
		 VALUES ($1,$2,$3,'food',$4,$5,'open')`,
		id, actorID, orderID, dtype, description); err != nil {
		return nil, fmt.Errorf("restaurant: open dispute: %w", err)
	}
	// Notify the restaurant owner a dispute was opened.
	if owner != "" && owner != actorID {
		s.notify(ctx, Notification{UserID: owner, Event: EventOrderCancelled, Title: "Order disputed",
			Body: "A customer opened a dispute on an order.", Data: map[string]any{"order_id": orderID, "dispute_id": id}})
	}
	return &FoodDispute{ID: id, OrderID: orderID, ReporterID: actorID, Type: dtype, Description: description, Status: "open", CreatedAt: time.Now()}, nil
}

// AdminResolveFoodDispute resolves a food dispute (platform ops only — enforced by the
// restaurant.admin.disputes permission on the route). A refund resolution credits the
// customer with a PLATFORM-FUNDED reversing entry (debit paymax_revenue → credit
// customer wallet), computed on the order total LESS the customer tip; it never claws
// back the restaurant, so neither wallet goes negative. Idempotent: the resolution record
// is keyed by dispute id, and the ledger credit is idempotent on the same key, so a retry
// neither double-refunds nor double-records.
//
// The TIP is the one exception to "no clawback" (ADR-031). It is escrowed with the order
// total and paid 100% to the rider at settlement — which has always already happened
// here, since only a DELIVERED order can be disputed. Refunding it from platform revenue
// would mean funding the rider's tip out of the platform's own pocket, so on a full
// refund the tip is instead recovered FROM THE RIDER: debited immediately when their
// wallet covers it, otherwise queued and taken off their next delivery settlement. The
// rider's wallet is never driven negative either way.
func (s *Service) AdminResolveFoodDispute(ctx context.Context, disputeID, adminID string, res FoodDisputeResolution, requestedRefundKobo int64, note string) (*FoodDispute, error) {
	if s.ledger == nil {
		return nil, fmt.Errorf("restaurant: dispute refunds require the ledger (not configured)")
	}
	// Load the ticket; must be a food dispute in a resolvable state.
	var reference, moduleType, status string
	if err := s.db.QueryRow(ctx,
		`SELECT reference, module_type, status FROM disputes WHERE id=$1`, disputeID).
		Scan(&reference, &moduleType, &status); err != nil {
		return nil, fmt.Errorf("%w: dispute not found", ErrDisputeInvalid)
	}
	if moduleType != "food" {
		return nil, fmt.Errorf("%w: not a food dispute", ErrDisputeInvalid)
	}
	if !foodDisputeResolvable(status) {
		return nil, fmt.Errorf("%w: dispute is already %s", ErrDisputeInvalid, status)
	}
	orderID := reference

	// Resolve the order → customer + total + tip + rider, and compute the (capped) refund.
	var customerID, settlementID string
	var riderID *string
	var totalKobo, tipKobo int64
	if err := s.db.QueryRow(ctx,
		`SELECT customer_id, rider_id, total_kobo, COALESCE(tip_kobo,0), COALESCE(settlement_id::text,'')
		   FROM orders WHERE id=$1`, orderID).
		Scan(&customerID, &riderID, &totalKobo, &tipKobo, &settlementID); err != nil {
		return nil, fmt.Errorf("restaurant: dispute order not found")
	}
	// orders.tip_kobo is what the CUSTOMER was charged; it is not proof of what the rider
	// was PAID. Clamp it to the order total so diverged data can never claw back more than
	// the customer ever paid.
	if tipKobo > totalKobo {
		tipKobo = totalKobo
	}
	// --- Refund budget + money move, serialised per ORDER (ADR-031). ---
	//
	// The budget is cumulative across all of an order's disputes, so computing it and
	// spending it must not interleave with another resolution on the same order: two
	// admins resolving two tickets concurrently would both read the same "already
	// refunded" figure and both pay out against it. An advisory lock keyed on the order
	// makes the read-compute-spend-record sequence atomic with respect to other resolvers.
	//
	// The lock is held across the ledger credit, which runs on a SECOND connection from the
	// same pool and opens its own transaction. No LOCK-ordering deadlock is possible — the
	// ledger's own advisory locks live in the `wallet:` namespace, Credit takes none at
	// all, and the tip clawback runs only after this tx commits — but the nesting does hold
	// one pooled connection while acquiring another, so enough simultaneous resolves could
	// exhaust the pool and stall until their contexts cancel. Dispute resolution is a
	// low-concurrency admin path and this mirrors the existing pattern in withdrawal.go;
	// the real fix is a tx-aware ledger credit so both legs share this transaction.
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("restaurant: begin dispute refund: %w", err)
	}
	defer tx.Rollback(ctx)
	// Lowercased: the DB backstop trigger takes this SAME lock keyed on
	// lower(order_id::text), and the two must be byte-identical or they serialise in
	// separate namespaces and neither protects the other. orderID comes from
	// disputes.reference (TEXT), which is not guaranteed to be canonical UUID casing even
	// though the FK lookup tolerates it.
	orderLockKey := "dispute-refund:" + strings.ToLower(strings.TrimSpace(orderID))
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, orderLockKey); err != nil {
		return nil, fmt.Errorf("restaurant: lock order for refund: %w", err)
	}

	// What the order's OTHER disputes have already drawn. Excluding this dispute keeps the
	// figure stable across a retry that has already written its own row.
	var alreadyRefundedKobo int64
	if err := tx.QueryRow(ctx,
		`SELECT COALESCE(SUM(refund_kobo),0) FROM restaurant_dispute_refunds
		  WHERE order_id=$1 AND dispute_id <> $2`, orderID, disputeID).Scan(&alreadyRefundedKobo); err != nil {
		return nil, fmt.Errorf("restaurant: read prior refunds: %w", err)
	}

	// The PLATFORM-funded refund is computed on the non-tip basis (ADR-031). The tip was
	// paid straight through to the rider at settlement — which has already happened, since
	// only a DELIVERED order can be disputed — so the platform never held it and must not
	// refund it. The tip comes back to the customer via the rider clawback below.
	orderCapKobo := platformRefundableKobo(totalKobo, tipKobo)
	remainingKobo := remainingRefundableKobo(orderCapKobo, alreadyRefundedKobo)
	// Exhausted budget: reject rather than silently paying zero. Gated on something having
	// ACTUALLY been drawn — a cap of 0 with nothing refunded is a different case (an
	// all-tip order, or diverged tip/total data), and must still resolve so the rider tip
	// clawback below can run.
	if alreadyRefundedKobo > 0 && remainingKobo <= 0 && (res == FoodRefundFull || res == FoodRefundPartial) {
		return nil, fmt.Errorf("%w: this order has already been refunded in full (%d of %d kobo) — nothing remains to refund",
			ErrDisputeInvalid, alreadyRefundedKobo, orderCapKobo)
	}

	// What this dispute has ALREADY moved, if a previous attempt got as far as the credit.
	// The ledger is the record of what actually happened, so when a pair exists it is
	// authoritative over anything recomputed now: a retry that resolved differently (a
	// smaller partial, or `dismissed`) would otherwise record a figure the money does not
	// match, and since the per-order budget is derived from those records, the difference
	// would silently become spendable again.
	refundKey := "dispute-refund:" + disputeID
	postedKobo, alreadyPosted, perr := s.postedDisputeRefundKobo(ctx, refundKey)
	if perr != nil {
		return nil, perr
	}

	var refundKobo int64
	switch {
	case alreadyPosted:
		refundKobo = postedKobo
	default:
		refundKobo, err = foodRefundKobo(res, requestedRefundKobo, remainingKobo)
		if err != nil {
			return nil, err
		}
		// Execute the platform-funded refund FIRST (idempotent), so a record can never
		// claim a refund that did not move. Debit platform revenue, credit the customer.
		if refundKobo > 0 {
			revAcc, aerr := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
			if aerr != nil {
				return nil, aerr
			}
			cerr := s.ledger.Credit(ctx, customerID, refundKey, refundKey, revAcc.ID, refundKobo)
			if cerr != nil {
				if !errors.Is(cerr, ledger.ErrDuplicate) {
					return nil, fmt.Errorf("restaurant: dispute refund credit: %w", cerr)
				}
				// ErrDuplicate is NOT proof the money moved — Credit takes the Redis idem
				// lock (10s TTL) before posting, so an attempt that acquired the lock and
				// then failed reports duplicate having written nothing. Recording that as a
				// refund would burn the order's budget on money that never left. Confirm
				// against the ledger of record before believing it.
				if _, ok, e := s.postedDisputeRefundKobo(ctx, refundKey); e != nil {
					return nil, e
				} else if !ok {
					return nil, fmt.Errorf("restaurant: dispute refund credit reported duplicate but no entry was posted — retry")
				}
			}
		}
	}

	// Record the resolution INSIDE the lock, so the amount just spent is visible to the
	// next resolver's budget read the moment it acquires the lock. The DB trigger added
	// alongside this is the hard backstop if any future writer skips the lock.
	if _, err := tx.Exec(ctx,
		`INSERT INTO restaurant_dispute_refunds (dispute_id, order_id, resolution, refund_kobo, resolved_by, note)
		 VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (dispute_id) DO NOTHING`,
		disputeID, orderID, string(res), refundKobo, adminID, note); err != nil {
		return nil, fmt.Errorf("restaurant: record dispute resolution: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("restaurant: commit dispute refund: %w", err)
	}

	// The TIP leg (ADR-031). A full refund repudiates the delivery outright, so the tip
	// follows it — clawed back from the rider who was paid it, never from the platform.
	// Recovered immediately if the rider's wallet covers it, otherwise queued against
	// their next delivery settlement. Deliberately NOT run for refund_partial: that is
	// characteristically a kitchen fault, and the rider should not fund it.
	// Gate on the order actually ENDING UP fully refunded, not on the `refund_full` label.
	// Now that the budget is cumulative, `refund_full` means "whatever is left", so the
	// label alone no longer implies the customer got the whole order back. What justifies
	// taking a third party's tip is the outcome: the customer has been made whole on the
	// entire non-tip basis. A partial that leaves any of it unrefunded never claws, however
	// large — and a zero-basis order (all-tip, or diverged data) satisfies this trivially,
	// which is what keeps the tip recoverable there.
	fullyRepudiated := res == FoodRefundFull && alreadyRefundedKobo+refundKobo >= orderCapKobo
	tipRefundedKobo := int64(0)
	if fullyRepudiated && tipKobo > 0 && riderID != nil && *riderID != "" {
		// Only claw back a tip the rider DEMONSTRABLY received. See riderWasPaidTip: an
		// order can be `delivered` with its escrow still held, and settleOrder drops the
		// tip leg outright when the escrow and the order total have diverged. Debiting a
		// rider for a tip that went 90/10 to the restaurant and platform — or that is
		// still sitting in escrow — would be a real loss to a third party with nothing
		// anywhere to offset it.
		paid, perr := s.riderWasPaidTip(ctx, settlementID, *riderID, totalKobo)
		if perr != nil {
			return nil, perr
		}
		if !paid {
			log.Printf("[restaurant] dispute %s: order %s carries a %d kobo tip the rider was never paid "+
				"(settlement %q not settled, or escrow diverged from the order total) — no clawback",
				disputeID, orderID, tipKobo, settlementID)
		} else {
			recovered, cerr := s.clawBackDisputedTip(ctx, disputeID, orderID, *riderID, customerID, tipKobo)
			if cerr != nil {
				return nil, cerr
			}
			if recovered {
				tipRefundedKobo = tipKobo
			}
		}
	}

	// The resolution record was written inside the refund lock above (it is what the next
	// resolver's budget read must see). Close the ticket. We deliberately do NOT set the shared disputes.resolution
	// column: it carries two mutually-exclusive CHECK constraints across modules, so no
	// value can satisfy both. The authoritative food resolution + refund live in
	// restaurant_dispute_refunds (written above and surfaced by AdminListFoodDisputes).
	if _, err := s.db.Exec(ctx,
		`UPDATE disputes SET status='resolved', admin_note=NULLIF($2,''), updated_at=now() WHERE id=$1`,
		disputeID, note); err != nil {
		return nil, err
	}
	_, _ = s.db.Exec(ctx, `UPDATE orders SET disputed_at=COALESCE(disputed_at, now()) WHERE id=$1`, orderID)

	// Tell the customer the outcome. credited is what actually landed in their wallet
	// now — the platform-funded refund plus the tip if the rider could cover it this
	// instant. A tip still queued against the rider's next delivery is NOT announced as
	// credited; the recovery sweep notifies separately when it lands.
	credited := refundKobo + tipRefundedKobo
	if credited > 0 {
		s.notify(ctx, Notification{UserID: customerID, Event: EventOrderCancelled, Title: "Dispute resolved — refund issued",
			Body: "Your dispute was resolved and a refund was credited to your wallet.",
			Data: map[string]any{"order_id": orderID, "refund_kobo": credited}})
	}
	resStr := string(res)
	return &FoodDispute{ID: disputeID, OrderID: orderID, Type: "", Status: "resolved", Resolution: &resStr, RefundKobo: refundKobo}, nil
}

// GetFoodDispute returns a dispute for a party to its order (or admin via the admin
// list). Loads the ticket + any resolution/refund record.
func (s *Service) GetFoodDispute(ctx context.Context, disputeID, actorID string) (*FoodDispute, error) {
	d, err := s.loadFoodDispute(ctx, disputeID)
	if err != nil {
		return nil, err
	}
	customer, owner, rider, perr := s.orderParties(ctx, d.OrderID)
	if perr == nil && classifyOrderActor(actorID, customer, owner, rider) == roleNone {
		return nil, fmt.Errorf("%w: not a party to this dispute", ErrForbidden)
	}
	return d, nil
}

// loadFoodDispute reads the shared ticket + this module's resolution record.
func (s *Service) loadFoodDispute(ctx context.Context, disputeID string) (*FoodDispute, error) {
	var d FoodDispute
	var moduleType string
	if err := s.db.QueryRow(ctx,
		`SELECT id, user_id, reference, module_type, type, description, status, admin_note, created_at
		 FROM disputes WHERE id=$1`, disputeID).
		Scan(&d.ID, &d.ReporterID, &d.OrderID, &moduleType, &d.Type, &d.Description, &d.Status, &d.AdminNote, &d.CreatedAt); err != nil {
		return nil, fmt.Errorf("%w: dispute not found", ErrDisputeInvalid)
	}
	if moduleType != "food" {
		return nil, fmt.Errorf("%w: not a food dispute", ErrDisputeInvalid)
	}
	var resolution *string
	var refund int64
	_ = s.db.QueryRow(ctx, `SELECT resolution, refund_kobo FROM restaurant_dispute_refunds WHERE dispute_id=$1`, disputeID).Scan(&resolution, &refund)
	d.Resolution = resolution
	d.RefundKobo = refund
	return &d, nil
}

// AdminListFoodDisputes lists food disputes for the ops queue, newest first, optionally
// filtered by status.
func (s *Service) AdminListFoodDisputes(ctx context.Context, status string, limit, offset int) ([]FoodDispute, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	q := `
		SELECT d.id, d.user_id, d.reference, d.type, d.description, d.status, d.admin_note, d.created_at,
		       r.resolution, COALESCE(r.refund_kobo,0)
		FROM disputes d
		LEFT JOIN restaurant_dispute_refunds r ON r.dispute_id = d.id
		WHERE d.module_type='food'`
	args := []any{}
	if status != "" {
		q += ` AND d.status=$1`
		args = append(args, status)
	}
	q += fmt.Sprintf(` ORDER BY d.created_at DESC LIMIT %d OFFSET %d`, limit, offset)
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []FoodDispute{}
	for rows.Next() {
		var d FoodDispute
		if err := rows.Scan(&d.ID, &d.ReporterID, &d.OrderID, &d.Type, &d.Description, &d.Status,
			&d.AdminNote, &d.CreatedAt, &d.Resolution, &d.RefundKobo); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}
