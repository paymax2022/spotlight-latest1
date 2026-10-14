package top5events

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// PromoPatch carries optional promo edits; nil fields are left unchanged.
type PromoPatch struct {
	Code          *string    `json:"code"`
	PercentOff    *int       `json:"percent_off"`
	AmountOffKobo *int64     `json:"amount_off_kobo"`
	TierID        *string    `json:"tier_id"`
	StartsAt      *time.Time `json:"starts_at"`
	EndsAt        *time.Time `json:"ends_at"`
	PerUserLimit  *int       `json:"per_user_limit"`
	MaxUses       *int       `json:"max_uses"`
	Active        *bool      `json:"active"`
}

const promoCols = `id, event_id, code, version, percent_off, max_uses, used, active, tier_id::text, amount_off_kobo, starts_at, ends_at, per_user_limit`

func scanPromo(row pgx.Row, p *PromoCode) error {
	return row.Scan(&p.ID, &p.EventID, &p.Code, &p.Version, &p.PercentOff, &p.MaxUses, &p.Used, &p.Active,
		&p.TierID, &p.AmountOffKobo, &p.StartsAt, &p.EndsAt, &p.PerUserLimit)
}

// UpdatePromo edits a promo (owner or MANAGER). While used==0 every field is
// editable (the value stays exactly-one-of percent/amount: setting one kind
// replaces the other). Once redeemed, only deactivation and RAISING max_uses
// are allowed; anything else is ErrPromoLocked and nothing is written.
func (s *Service) UpdatePromo(ctx context.Context, callerID, eventID, promoID string, patch PromoPatch) (*PromoCode, error) {
	if _, err := s.authorizeManage(ctx, callerID, eventID); err != nil {
		return nil, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("events: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var cur PromoCode
	if err := scanPromo(tx.QueryRow(ctx, `SELECT `+promoCols+` FROM event_promo_codes WHERE id=$1 AND event_id=$2 FOR UPDATE`, promoID, eventID), &cur); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("events: fetch promo: %w", err)
	}

	// A code is part of the (event_id, code, version) supersede identity; editing it
	// could leave two active rows sharing a code. Change a code by deactivating this
	// promo and creating a new one.
	if patch.Code != nil && *patch.Code != cur.Code {
		return nil, fmt.Errorf("%w: code cannot be edited; deactivate and create a new promo", ErrPromoLocked)
	}

	if cur.Used > 0 {
		if patch.PercentOff != nil || patch.AmountOffKobo != nil || patch.TierID != nil ||
			patch.StartsAt != nil || patch.EndsAt != nil || patch.PerUserLimit != nil {
			return nil, fmt.Errorf("%w: only active and a higher max_uses can change after use", ErrPromoLocked)
		}
		// max_uses 0 means unlimited: capping an unlimited promo or lowering a cap is a restriction.
		if patch.MaxUses != nil && *patch.MaxUses != cur.MaxUses {
			if cur.MaxUses == 0 || (*patch.MaxUses != 0 && *patch.MaxUses < cur.MaxUses) {
				return nil, fmt.Errorf("%w: max_uses can only be raised after use", ErrPromoLocked)
			}
		}
	}

	// Resulting value must remain exactly-one-of.
	valueChanged := patch.PercentOff != nil || patch.AmountOffKobo != nil
	pct, amt := cur.PercentOff, cur.AmountOffKobo
	if valueChanged {
		if patch.PercentOff != nil {
			pct = *patch.PercentOff
			if patch.AmountOffKobo == nil {
				amt = nil
			}
		}
		if patch.AmountOffKobo != nil {
			amt = patch.AmountOffKobo
			if patch.PercentOff == nil {
				pct = 0
			}
		}
		if err := validatePromoValue(pct, amt); err != nil {
			return nil, err
		}
	}
	if patch.PerUserLimit != nil && *patch.PerUserLimit < 0 {
		return nil, fmt.Errorf("%w: events: per_user_limit must be non-negative", ErrValidation)
	}
	if patch.MaxUses != nil && *patch.MaxUses < 0 {
		return nil, fmt.Errorf("%w: events: max_uses must be non-negative", ErrValidation)
	}
	start, end := cur.StartsAt, cur.EndsAt
	if patch.StartsAt != nil {
		start = patch.StartsAt
	}
	if patch.EndsAt != nil {
		end = patch.EndsAt
	}
	if (patch.StartsAt != nil || patch.EndsAt != nil) && start != nil && end != nil && !start.Before(*end) {
		return nil, ErrInvalidWindow
	}
	if patch.TierID != nil {
		var ok bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM event_ticket_tiers WHERE id=$1 AND event_id=$2)`, *patch.TierID, eventID).Scan(&ok); err != nil {
			return nil, fmt.Errorf("events: tier lookup: %w", err)
		}
		if !ok {
			return nil, fmt.Errorf("%w: events: promo tier does not belong to this event", ErrValidation)
		}
	}

	var sets []string
	args := []any{promoID}
	changed := map[string]any{}
	add := func(col string, v any) {
		args = append(args, v)
		sets = append(sets, fmt.Sprintf("%s=$%d", col, len(args)))
		changed[col] = v
	}
	if valueChanged {
		add("percent_off", pct)
		add("amount_off_kobo", amt)
	}
	if patch.TierID != nil {
		add("tier_id", *patch.TierID)
	}
	if patch.StartsAt != nil {
		add("starts_at", *patch.StartsAt)
	}
	if patch.EndsAt != nil {
		add("ends_at", *patch.EndsAt)
	}
	if patch.PerUserLimit != nil {
		add("per_user_limit", *patch.PerUserLimit)
	}
	if patch.MaxUses != nil {
		add("max_uses", *patch.MaxUses)
	}
	if patch.Active != nil {
		add("active", *patch.Active)
	}
	if len(sets) > 0 {
		if _, err := tx.Exec(ctx, "UPDATE event_promo_codes SET "+strings.Join(sets, ", ")+" WHERE id=$1", args...); err != nil {
			return nil, fmt.Errorf("events: update promo: %w", err)
		}
	}
	var out PromoCode
	if err := scanPromo(tx.QueryRow(ctx, `SELECT `+promoCols+` FROM event_promo_codes WHERE id=$1`, promoID), &out); err != nil {
		return nil, fmt.Errorf("events: refetch promo: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("events: commit: %w", err)
	}
	for col, v := range changed {
		s.log(callerID, "events.promo.update", eventID, map[string]any{"promo_id": promoID, "field": col, "new": v})
	}
	return &out, nil
}
