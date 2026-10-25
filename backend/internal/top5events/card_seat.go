package top5events

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// reserveSeatTx reserves one seat of a tier inside tx: locks the tier row,
// checks capacity / active / sales window, applies a promo if present,
// increments sold, inserts a PENDING order row (with payment_rail and
// card_reference for the card path) and returns (orderID, payableKobo, error).
func (s *Service) reserveSeatTx(ctx context.Context, tx pgx.Tx, r seatReservation) (string, int64, error) {
	var price int64
	var capacity, sold int
	var active, inviteOnly bool
	var salesStart, salesEnd *time.Time
	if err := tx.QueryRow(ctx,
		`SELECT price_kobo, capacity, sold, active, sales_start_at, sales_end_at, invite_only
		 FROM event_ticket_tiers WHERE id=$1 AND event_id=$2 FOR UPDATE`,
		r.tierID, r.eventID,
	).Scan(&price, &capacity, &sold, &active, &salesStart, &salesEnd, &inviteOnly); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", 0, ErrNotFound
		}
		return "", 0, fmt.Errorf("events: lock tier: %w", err)
	}
	if !active {
		return "", 0, errors.New("events: tier inactive")
	}
	now := time.Now()
	if inviteOnly {
		return "", 0, ErrInviteOnly
	}
	if (salesStart != nil && now.Before(*salesStart)) || (salesEnd != nil && now.After(*salesEnd)) {
		return "", 0, ErrTierNotOnSale
	}
	if capacity > 0 && sold >= capacity {
		return "", 0, ErrSoldOut
	}

	payable := price
	var appliedPromoID string
	if r.promo != "" {
		var pid string
		var pct, maxUses, used, perUser int
		var promoTier *string
		var amountOff *int64
		var startsAt, endsAt *time.Time
		err := tx.QueryRow(ctx,
			`SELECT id, percent_off, max_uses, used, tier_id::text, amount_off_kobo, starts_at, ends_at, per_user_limit
			 FROM event_promo_codes WHERE event_id=$1 AND code=$2 AND active=true FOR UPDATE`,
			r.eventID, r.promo,
		).Scan(&pid, &pct, &maxUses, &used, &promoTier, &amountOff, &startsAt, &endsAt, &perUser)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return "", 0, fmt.Errorf("%w: unknown or inactive code", ErrPromoNotApplicable)
			}
			return "", 0, fmt.Errorf("events: lock promo: %w", err)
		}
		if maxUses > 0 && used >= maxUses {
			return "", 0, fmt.Errorf("%w: code exhausted", ErrPromoNotApplicable)
		}
		if (startsAt != nil && now.Before(*startsAt)) || (endsAt != nil && now.After(*endsAt)) {
			return "", 0, fmt.Errorf("%w: outside validity window", ErrPromoNotApplicable)
		}
		if promoTier != nil && *promoTier != r.tierID {
			return "", 0, fmt.Errorf("%w: code is for a different tier", ErrPromoNotApplicable)
		}
		if perUser > 0 {
			var n int
			if err := tx.QueryRow(ctx,
				`SELECT count(*) FROM event_promo_redemptions WHERE promo_id=$1 AND user_id=$2`,
				pid, r.buyerID,
			).Scan(&n); err != nil {
				return "", 0, fmt.Errorf("events: promo per-user count: %w", err)
			}
			if n >= perUser {
				return "", 0, fmt.Errorf("%w: per-user limit reached", ErrPromoNotApplicable)
			}
		}
		if amountOff != nil {
			payable = price - *amountOff
			if payable < 0 {
				payable = 0
			}
		} else {
			payable = price - (price*int64(pct))/100
		}
		if _, err := tx.Exec(ctx, `UPDATE event_promo_codes SET used=used+1 WHERE id=$1`, pid); err != nil {
			return "", 0, fmt.Errorf("events: bump promo: %w", err)
		}
		appliedPromoID = pid
	}

	if _, err := tx.Exec(ctx, `UPDATE event_ticket_tiers SET sold=sold+1 WHERE id=$1`, r.tierID); err != nil {
		return "", 0, fmt.Errorf("events: reserve inventory: %w", err)
	}
	orderID := uuid.New().String()
	if _, err := tx.Exec(ctx,
		`INSERT INTO event_orders (id, event_id, buyer_id, tier_id, total_kobo, status, idempotency_key, payment_rail, card_reference)
		 VALUES ($1,$2,$3,$4,$5,'PENDING',$6,$7,$8)`,
		orderID, r.eventID, r.buyerID, r.tierID, payable, r.idemKey, r.rail, r.cardRef,
	); err != nil {
		return "", 0, fmt.Errorf("events: insert order: %w", err)
	}
	if appliedPromoID != "" {
		if _, err := tx.Exec(ctx,
			`INSERT INTO event_promo_redemptions (id, promo_id, user_id, order_id) VALUES ($1,$2,$3,$4) ON CONFLICT (promo_id, order_id) DO NOTHING`,
			uuid.New().String(), appliedPromoID, r.buyerID, orderID,
		); err != nil {
			return "", 0, fmt.Errorf("events: record promo redemption: %w", err)
		}
	}
	return orderID, payable, nil
}
