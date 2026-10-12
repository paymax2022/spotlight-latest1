package top5events

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// TierPatch carries optional tier edits; nil fields are left unchanged.
type TierPatch struct {
	Name         *string    `json:"name"`
	Description  *string    `json:"description"`
	PriceKobo    *int64     `json:"price_kobo"`
	Capacity     *int       `json:"capacity"`
	Active       *bool      `json:"active"`
	InviteOnly   *bool      `json:"invite_only"`
	SalesStartAt *time.Time `json:"sales_start_at"`
	SalesEndAt   *time.Time `json:"sales_end_at"`
}

const tierCols = `id, event_id, name, price_kobo, capacity, sold, active, description, sales_start_at, sales_end_at, invite_only`

// UpdateTier edits a tier (owner or MANAGER). price_kobo is locked once any
// ticket is sold; capacity may not drop below sold; the sales window must be
// ordered when both ends are set.
func (s *Service) UpdateTier(ctx context.Context, callerID, eventID, tierID string, patch TierPatch) (*TicketTier, error) {
	if _, err := s.authorizeManage(ctx, callerID, eventID); err != nil {
		return nil, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("events: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var cur TicketTier
	if err := tx.QueryRow(ctx, `SELECT `+tierCols+` FROM event_ticket_tiers WHERE id=$1 AND event_id=$2 FOR UPDATE`, tierID, eventID).
		Scan(&cur.ID, &cur.EventID, &cur.Name, &cur.PriceKobo, &cur.Capacity, &cur.Sold, &cur.Active,
			&cur.Description, &cur.SalesStartAt, &cur.SalesEndAt, &cur.InviteOnly); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("events: fetch tier: %w", err)
	}

	if patch.PriceKobo != nil {
		if *patch.PriceKobo < 0 {
			return nil, errors.New("events: tier price must be non-negative")
		}
		if *patch.PriceKobo != cur.PriceKobo && cur.Sold > 0 {
			return nil, fmt.Errorf("%w: price cannot change after tickets are sold", ErrTierLocked)
		}
	}
	if patch.Capacity != nil && *patch.Capacity < cur.Sold {
		return nil, fmt.Errorf("%w: capacity cannot be below tickets sold (%d)", ErrTierLocked, cur.Sold)
	}
	start, end := cur.SalesStartAt, cur.SalesEndAt
	if patch.SalesStartAt != nil {
		start = patch.SalesStartAt
	}
	if patch.SalesEndAt != nil {
		end = patch.SalesEndAt
	}
	if (patch.SalesStartAt != nil || patch.SalesEndAt != nil) && start != nil && end != nil && !start.Before(*end) {
		return nil, ErrInvalidWindow
	}

	var sets []string
	args := []any{tierID}
	changed := map[string]any{}
	add := func(col string, v any) {
		args = append(args, v)
		sets = append(sets, fmt.Sprintf("%s=$%d", col, len(args)))
		changed[col] = v
	}
	if patch.Name != nil {
		add("name", *patch.Name)
	}
	if patch.Description != nil {
		add("description", *patch.Description)
	}
	if patch.PriceKobo != nil {
		add("price_kobo", *patch.PriceKobo)
	}
	if patch.Capacity != nil {
		add("capacity", *patch.Capacity)
	}
	if patch.Active != nil {
		add("active", *patch.Active)
	}
	if patch.InviteOnly != nil {
		add("invite_only", *patch.InviteOnly)
	}
	if patch.SalesStartAt != nil {
		add("sales_start_at", *patch.SalesStartAt)
	}
	if patch.SalesEndAt != nil {
		add("sales_end_at", *patch.SalesEndAt)
	}
	if len(sets) > 0 {
		if _, err := tx.Exec(ctx, "UPDATE event_ticket_tiers SET "+strings.Join(sets, ", ")+" WHERE id=$1", args...); err != nil {
			return nil, fmt.Errorf("events: update tier: %w", err)
		}
	}
	var out TicketTier
	if err := tx.QueryRow(ctx, `SELECT `+tierCols+` FROM event_ticket_tiers WHERE id=$1`, tierID).
		Scan(&out.ID, &out.EventID, &out.Name, &out.PriceKobo, &out.Capacity, &out.Sold, &out.Active,
			&out.Description, &out.SalesStartAt, &out.SalesEndAt, &out.InviteOnly); err != nil {
		return nil, fmt.Errorf("events: refetch tier: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("events: commit: %w", err)
	}
	for col, v := range changed {
		s.log(callerID, "events.tier.update", eventID, map[string]any{"tier_id": tierID, "field": col, "new": v})
	}
	return &out, nil
}
