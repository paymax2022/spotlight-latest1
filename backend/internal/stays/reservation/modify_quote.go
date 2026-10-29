package reservation

import (
	"context"
	"fmt"
	"time"

	"spotlight/backend/internal/stays/gateway"
)

// ModifyQuote is the price of moving a confirmed stay to new dates. Nothing is held,
// charged or written: it is the read-only preview of what Modify would do.
// DeltaKobo is positive when the guest pays more, negative when they are refunded.
type ModifyQuote struct {
	OldTotalKobo int64 `json:"old_total_kobo"`
	NewTotalKobo int64 `json:"new_total_kobo"`
	DeltaKobo    int64 `json:"delta_kobo"`
	// Unavailable is set when the new dates cannot be sold. It is an answer, not an
	// error, so the screen can say so and keep the guest on the page.
	Unavailable bool `json:"unavailable"`
}

// QuoteModify re-prices a confirmed reservation for new dates using the same gateway
// re-check and pricing that Modify uses, but stops before any supplier call that
// changes state or any money movement.
func (s *Service) QuoteModify(ctx context.Context, userID, reservationID string, newCheckIn, newCheckOut time.Time) (ModifyQuote, error) {
	res, err := s.Get(ctx, userID, reservationID)
	if err != nil {
		return ModifyQuote{}, err
	}
	if res.State != StateConfirmed {
		return ModifyQuote{}, fmt.Errorf("%w: modify requires CONFIRMED, got %s", ErrBadState, res.State)
	}
	if !newCheckOut.After(newCheckIn) {
		return ModifyQuote{}, fmt.Errorf("%w: modify requires check_out after check_in", ErrBadState)
	}

	gw, rErr := s.router.Resolve(ctx, res.SourceRail, res.SupplierCode)
	if rErr != nil {
		return ModifyQuote{}, rErr
	}
	pre, pErr := gw.Prebook(ctx, gateway.PrebookRequest{
		Rail:                res.SourceRail,
		SupplierCode:        res.SupplierCode,
		SupplierPropertyRef: res.PropertyID,
		SupplierRoomTypeRef: res.RoomTypeID,
		SupplierRatePlanRef: res.RatePlanID,
		CheckIn:             newCheckIn,
		CheckOut:            newCheckOut,
		Rooms:               res.Rooms,
		Occupancy:           toGatewayOccupancy(res.Occupancy),
		Currency:            res.Currency,
	})
	if pErr != nil {
		return ModifyQuote{}, fmt.Errorf("reservation: modify quote: %w", pErr)
	}
	q := ModifyQuote{OldTotalKobo: res.GrossAmountKobo}
	if pre.SoldOut || pre.BookToken == "" {
		q.Unavailable = true
		return q, nil
	}

	offer := gateway.PropertyOffer{
		Rail:         res.SourceRail,
		SupplierCode: res.SupplierCode,
		NetRateKobo:  pre.NetRateKobo,
		TaxKobo:      pre.TaxKobo,
		Currency:     pre.Currency,
	}
	bd, priceErr := s.pricing.Price(offer, "", 0)
	if priceErr != nil {
		return ModifyQuote{}, fmt.Errorf("reservation: modify quote price: %w", priceErr)
	}
	q.NewTotalKobo = bd.GrossKobo
	q.DeltaKobo = q.NewTotalKobo - q.OldTotalKobo
	return q, nil
}
