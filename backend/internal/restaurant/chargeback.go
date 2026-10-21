package restaurant

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"

	"github.com/jackc/pgx/v5"

	"spotlight/backend/internal/finance/settlement"
)

// FOOD-UAT-H-004 — Paystack dispute / chargeback / refund ingestion.
//
// Before this, only charge.success + transfer.* were recognised anywhere in the
// webhook stack, so a food-order chargeback silently 200'd: Paystack debited the
// merchant balance while the platform ledger still showed the customer's money
// escrowed/settled, breaking ADR-040 conservation. This file adds a NEW method on
// Service (no existing method is changed).
//
// Ledger correction is the existing settlement.RefundExternal pair
// (DR escrow / CR provider-clearing, key "refund:<settlementID>"): ADR-040 allows
// reversing entries only, and that pair is the exact reverse of EscrowExternal.
// Replay-safety is therefore two-layered: the restaurant_order_chargebacks row is
// unique on "chargeback:<dispute id>", and RefundExternal is itself a no-op once
// the settlement left escrowed/disputed.

const (
	// OrderChargebacked is the terminal status for an order whose payment was
	// reversed by the card network. Added to orders_status_check by
	// 20271061000000_food_order_chargebacks.sql.
	OrderChargebacked OrderStatus = "chargebacked"

	ChargebackKindDispute = "dispute"
	ChargebackKindRefund  = "refund"

	ChargebackOutcomeReversed  = "reversed"
	ChargebackOutcomeUnrecover = "settled_unrecovered"
	ChargebackOutcomeNoOrder   = "no_order"
	ChargebackOutcomeRecorded  = "recorded"
	chargebackKeyDisputePrefix = "chargeback:"
	chargebackKeyRefundPrefix  = "refund-event:"
	foodOrderReferencePrefix   = "foodorder-"
)

// ChargebackEvent is the normalized provider event handed to HandleChargeback.
type ChargebackEvent struct {
	Kind            string // ChargebackKindDispute | ChargebackKindRefund
	ProviderEventID string // Paystack dispute id / refund id
	Reference       string // the original foodorder-... transaction reference
	AmountKobo      int64
	Resolved        bool   // true for charge.dispute.resolve
	Resolution      string // e.g. "merchant-accepted", "declined" (resolve only)
}

// IsFoodReference reports whether ref belongs to the food-order checkout.
func IsFoodReference(ref string) bool { return strings.HasPrefix(ref, foodOrderReferencePrefix) }

// HandleChargeback ingests one dispute/refund event for a food order. Safe to
// replay: a second delivery of the same provider id is a no-op.
func (s *Service) HandleChargeback(ctx context.Context, ev ChargebackEvent) error {
	if ev.ProviderEventID == "" || !IsFoodReference(ev.Reference) {
		return fmt.Errorf("restaurant: chargeback: missing event id or non-food reference %q", ev.Reference)
	}
	key := chargebackKeyDisputePrefix + ev.ProviderEventID
	if ev.Kind == ChargebackKindRefund {
		key = chargebackKeyRefundPrefix + ev.ProviderEventID
	}

	if ev.Resolved {
		return s.resolveChargeback(ctx, key, ev)
	}

	// Resolve the order from the checkout intent (reference -> order_id).
	var orderID string
	var intentStatus string
	err := s.db.QueryRow(ctx,
		`SELECT COALESCE(order_id,''), status FROM restaurant_order_paystack_intents WHERE reference=$1`,
		ev.Reference).Scan(&orderID, &intentStatus)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("restaurant: chargeback: load intent: %w", err)
	}
	if orderID == "" {
		log.Printf("[restaurant] chargeback %s: no order for reference %s (intent status=%q) — recorded only", key, ev.Reference, intentStatus)
		return s.recordChargeback(ctx, key, ev, "", "", ChargebackOutcomeNoOrder)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("restaurant: chargeback: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	var status, settlementID string
	if err := tx.QueryRow(ctx,
		`SELECT status, COALESCE(settlement_id::text,'') FROM orders WHERE id=$1 FOR UPDATE`, orderID).
		Scan(&status, &settlementID); err != nil {
		return fmt.Errorf("restaurant: chargeback: lock order %s: %w", orderID, err)
	}

	// Replay guard inside the order lock.
	var seen bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM restaurant_order_chargebacks WHERE idempotency_key=$1)`, key).Scan(&seen); err != nil {
		return fmt.Errorf("restaurant: chargeback: replay check: %w", err)
	}
	if seen {
		return tx.Commit(ctx)
	}

	outcome := ChargebackOutcomeRecorded
	var settStatus string
	if settlementID != "" {
		if err := tx.QueryRow(ctx, `SELECT status FROM settlements WHERE id=$1`, settlementID).Scan(&settStatus); err != nil {
			return fmt.Errorf("restaurant: chargeback: load settlement: %w", err)
		}
	}

	// Ledger reversal runs on its own tx (settlement.RefundExternal owns its
	// settlement row lock); we hold only the ORDER lock, so there is no
	// lock-order inversion with refundAndClose (order lock -> settlement lock).
	switch settlement.Status(settStatus) {
	case settlement.StatusEscrowed, settlement.StatusDisputed:
		if err := s.settlement.RefundExternal(ctx, settlementID, "paystack_"+ev.Kind); err != nil {
			return fmt.Errorf("restaurant: chargeback: reverse escrow %s: %w", settlementID, err)
		}
		outcome = ChargebackOutcomeReversed
	case settlement.StatusRefunded:
		outcome = ChargebackOutcomeReversed // already reversed (our own refund flow); nothing to post
	case settlement.StatusSettled, settlement.StatusReleasing:
		// Funds already left escrow for merchant/rider/platform. No clawback
		// primitive exists; surface loudly for ops instead of faking a reversal.
		log.Printf("[restaurant] CHARGEBACK ON SETTLED ORDER order=%s settlement=%s %s=%s — funds already released, needs manual recovery", orderID, settlementID, ev.Kind, ev.ProviderEventID)
		outcome = ChargebackOutcomeUnrecover
	}

	flip := ev.Kind == ChargebackKindDispute && status != string(OrderChargebacked)
	if flip {
		if _, err := tx.Exec(ctx,
			`UPDATE orders SET status=$2, status_reason=$3 WHERE id=$1`,
			orderID, string(OrderChargebacked), "paystack dispute "+ev.ProviderEventID); err != nil {
			return fmt.Errorf("restaurant: chargeback: flip order %s: %w", orderID, err)
		}
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO restaurant_order_chargebacks
		   (idempotency_key, kind, provider_event_id, reference, order_id, settlement_id, amount_kobo, outcome)
		 VALUES ($1,$2,$3,$4,$5,NULLIF($6,''),$7,$8)
		 ON CONFLICT (idempotency_key) DO NOTHING`,
		key, ev.Kind, ev.ProviderEventID, ev.Reference, orderID, settlementID, ev.AmountKobo, outcome); err != nil {
		return fmt.Errorf("restaurant: chargeback: record: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("restaurant: chargeback: commit: %w", err)
	}

	if flip {
		s.recordOrderEvent(ctx, orderID, "system:paystack", OrderStatus(status), OrderChargebacked)
	}
	if s.audit != nil {
		s.audit.LogAction("system:paystack", "", "order.chargeback."+ev.Kind, "restaurant", "order", orderID,
			map[string]any{keyStatus: status},
			map[string]any{"outcome": outcome, "provider_event_id": ev.ProviderEventID, "reference": ev.Reference, "amount_kobo": ev.AmountKobo},
			"", "", "warning")
	}
	return nil
}

// recordChargeback inserts an audit row outside the order lock (no-order path).
func (s *Service) recordChargeback(ctx context.Context, key string, ev ChargebackEvent, orderID, settlementID, outcome string) error {
	_, err := s.db.Exec(ctx,
		`INSERT INTO restaurant_order_chargebacks
		   (idempotency_key, kind, provider_event_id, reference, order_id, settlement_id, amount_kobo, outcome)
		 VALUES ($1,$2,$3,$4,NULLIF($5,''),NULLIF($6,''),$7,$8)
		 ON CONFLICT (idempotency_key) DO NOTHING`,
		key, ev.Kind, ev.ProviderEventID, ev.Reference, orderID, settlementID, ev.AmountKobo, outcome)
	if err != nil {
		return fmt.Errorf("restaurant: chargeback: record: %w", err)
	}
	return nil
}

// resolveChargeback stamps the outcome of charge.dispute.resolve on the existing
// row. It never re-credits: a reversal already posted stays posted (ADR-040 —
// a won dispute is returned by a NEW forward entry decided by ops, not by
// mutating or deleting the reversal).
func (s *Service) resolveChargeback(ctx context.Context, key string, ev ChargebackEvent) error {
	tag, err := s.db.Exec(ctx,
		`UPDATE restaurant_order_chargebacks SET resolution=$2, resolved_at=now()
		   WHERE idempotency_key=$1 AND resolved_at IS NULL`, key, ev.Resolution)
	if err != nil {
		return fmt.Errorf("restaurant: chargeback: resolve: %w", err)
	}
	if tag.RowsAffected() == 0 {
		log.Printf("[restaurant] chargeback resolve %s: no open row (unknown dispute or replay) — ignored", key)
	}
	return nil
}
