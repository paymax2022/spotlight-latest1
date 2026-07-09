package reservation

import (
	"context"
	"fmt"
)

// agent_support.go — repository helpers for the agent-assisted booking channel
// (internal/stays/agent). These are ADDITIVE to the reservation repository: the
// core self-service saga never touches the agent_* columns, and the agent channel
// reuses the SAME Book saga then tags the row here. No new money primitive.

// AgentReservationTag is the walk-in-customer + booking-agent metadata written onto
// a reservation booked through the agent channel.
type AgentReservationTag struct {
	AgentUserID     string
	CustomerName    string
	CustomerContact string
}

// TagAgentBooking stamps the agent_user_id + walk-in customer contact onto a
// reservation the agent booked. Called AFTER the standard Book saga confirms; it
// only annotates provenance and does NOT move money or change state. Idempotent:
// re-tagging with the same agent is a no-op-safe UPDATE.
func (r *Repository) TagAgentBooking(ctx context.Context, reservationID string, tag AgentReservationTag) error {
	_, err := r.db.Exec(ctx, `
		UPDATE public.stays_reservation
		SET agent_user_id = $2, customer_name = $3, customer_contact = $4, updated_at = now()
		WHERE id = $1`,
		reservationID, tag.AgentUserID, tag.CustomerName, tag.CustomerContact)
	if err != nil {
		return fmt.Errorf("reservation: tag agent booking: %w", err)
	}
	return nil
}

// ListByAgent returns reservations this agent booked, newest-first.
func (r *Repository) ListByAgent(ctx context.Context, agentUserID string, limit, offset int) ([]Reservation, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := r.db.Query(ctx, `
		SELECT `+resCols+` FROM public.stays_reservation
		WHERE agent_user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, agentUserID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Reservation
	for rows.Next() {
		res, err := scanReservation(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *res)
	}
	return out, rows.Err()
}

// AgentCommissionTotals is the aggregate commission an agent has earned across
// booked+settled reservations (CONFIRMED or terminally-completed, not released/void).
type AgentCommissionTotals struct {
	BookingsCount  int   `json:"bookings_count"`
	GrossSalesKobo int64 `json:"gross_sales_kobo"`
	CommissionKobo int64 `json:"commission_kobo"`
}

// SumAgentCommission sums the agent's commission over reservations that actually
// booked+settled (states where the escrow split posted the commission). Released /
// void / failed bookings contribute nothing (their commission never settled).
func (r *Repository) SumAgentCommission(ctx context.Context, agentUserID string) (AgentCommissionTotals, error) {
	var t AgentCommissionTotals
	// commission_kobo is the pre-computed DirectCommission split persisted at
	// prebook; only booked-and-settled states have posted it to AccountCommission.
	row := r.db.QueryRow(ctx, `
		SELECT COUNT(*),
		       COALESCE(SUM(gross_amount_kobo), 0),
		       COALESCE(SUM(commission_kobo), 0)
		FROM public.stays_reservation
		WHERE agent_user_id = $1
		  AND state IN ('CONFIRMED','COMPLETED')`, agentUserID)
	if err := row.Scan(&t.BookingsCount, &t.GrossSalesKobo, &t.CommissionKobo); err != nil {
		return AgentCommissionTotals{}, err
	}
	return t, nil
}
