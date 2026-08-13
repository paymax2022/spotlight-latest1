package restaurant

import (
	"context"
	"fmt"
	"time"
)

// EarningsLine is one settled order's contribution to a restaurant's earnings (PY-008).
type EarningsLine struct {
	OrderID      string    `json:"order_id"`
	GrossKobo    int64     `json:"gross_kobo"`    // order total escrowed, net of any rider tip
	ProviderKobo int64     `json:"provider_kobo"` // the restaurant's settled share
	FeeKobo      int64     `json:"fee_kobo"`      // platform commission on this order
	SettledAt    time.Time `json:"settled_at"`
}

// EarningsStatement is a restaurant's earnings over a period, exportable (PY-008).
type EarningsStatement struct {
	RestaurantID      string         `json:"restaurant_id"`
	From              string         `json:"from"`
	To                string         `json:"to"`
	Lines             []EarningsLine `json:"lines"`
	TotalGrossKobo    int64          `json:"total_gross_kobo"`
	TotalProviderKobo int64          `json:"total_provider_kobo"`
	TotalFeeKobo      int64          `json:"total_fee_kobo"`
	OrderCount        int            `json:"order_count"`
}

// EarningsStatement returns a restaurant's settled-earnings statement for [from,to]
// (owner only). Derived from the immutable settled `settlements` — a read, it moves no
// money. Totals are summed server-side so the exported figures are authoritative.
func (s *Service) EarningsStatement(ctx context.Context, restaurantID, userID string, from, to time.Time) (*EarningsStatement, error) {
	if err := s.assertOwner(ctx, restaurantID, userID); err != nil {
		return nil, err
	}
	if to.Before(from) {
		return nil, fmt.Errorf("restaurant: `to` must be on or after `from`")
	}
	// Gross is reported NET of any rider tip: the tip is escrowed in st.total_kobo but
	// paid straight through to the rider, and the percentages that produced
	// provider_kobo/fee_kobo priced total − tip. Including it would inflate the
	// merchant's gross by money that was never theirs, and the statement would stop
	// tying out against the restaurant's own share + the platform cut.
	const q = `
		SELECT o.id, st.total_kobo - COALESCE(o.tip_kobo,0), st.provider_kobo, st.fee_kobo, st.settled_at
		FROM settlements st
		JOIN orders o ON o.id = replace(st.reference, 'order:', '')::uuid
		WHERE st.module_type = 'food_delivery'
		  AND st.status = 'settled'
		  AND o.restaurant_id = $1
		  AND st.settled_at >= $2 AND st.settled_at < ($3::timestamptz + interval '1 day')
		ORDER BY st.settled_at DESC`
	rows, err := s.db.Query(ctx, q, restaurantID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	stmt := &EarningsStatement{
		RestaurantID: restaurantID,
		From:         from.Format("2006-01-02"),
		To:           to.Format("2006-01-02"),
		Lines:        []EarningsLine{},
	}
	for rows.Next() {
		var l EarningsLine
		var settledAt *time.Time
		if err := rows.Scan(&l.OrderID, &l.GrossKobo, &l.ProviderKobo, &l.FeeKobo, &settledAt); err != nil {
			return nil, err
		}
		if settledAt != nil {
			l.SettledAt = *settledAt
		}
		stmt.Lines = append(stmt.Lines, l)
		stmt.TotalGrossKobo += l.GrossKobo
		stmt.TotalProviderKobo += l.ProviderKobo
		stmt.TotalFeeKobo += l.FeeKobo
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	stmt.OrderCount = len(stmt.Lines)
	return stmt, nil
}
