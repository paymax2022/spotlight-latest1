package paystackcheckout

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"spotlight/backend/internal/transport"
)

// Car-hire card-direct — a thin adapter over the shared Engine (see parcel.go).
//
// ONE card charge = fare + deposit. Book escrows it as TWO external settlements
// ("<ref>:fare", "<ref>:deposit"), so every later money event is "refund one
// settlement's exact total to the card" through the engine's PIECE-refund path
// (partial_refund.go): cancel before activation refunds both pieces, completion
// settles the fare to the driver and refunds the deposit. The intent stays
// 'confirmed' while pieces are refunded.
//
// Deliberately NOT card-direct (they stay wallet-only; see the ADR): extensions
// (a second charge — refused with 409 for card bookings), late-fee / damage
// deductions (no settlement primitive, nothing to collect from a card beyond the
// deposit), and cancel-after-activation with a fare refund.

// CarHireDomainName is the stable domain id: intents.domain and the
// SetDomainExternalRefunder key. transport files car-hire refunds under
// transport.RefundDomainCarHire — the two MUST be equal.
const CarHireDomainName = "carhire"

// CarHireReferencePrefix: "carhireorder:" + Idempotency-Key.
const CarHireReferencePrefix = "carhireorder:"

// CarHireBooker is the slice of transport.Service the car-hire adapter uses.
type CarHireBooker interface {
	// QuoteCarHireBookingFrozen returns fare + deposit as ONE charge, and the
	// frozen priced inputs that produced it.
	QuoteCarHireBookingFrozen(ctx context.Context, req transport.CarHireBookRequest) (int64, json.RawMessage, error)
	FindCarHireByIdempotencyKey(ctx context.Context, userID, idempotencyKey string) (string, bool, error)
	// BookCarHirePaystackFundedFrozen books priced from `pricing`, never from a
	// fresh config read, and escrows the two legs as external settlements.
	BookCarHirePaystackFundedFrozen(ctx context.Context, userID string, req transport.CarHireBookRequest, idempotencyKey string, verifiedAmountKobo int64, pricing json.RawMessage) (string, error)
}

// CarHireDomain adapts transport car-hire booking to Domain.
type CarHireDomain struct{ hires CarHireBooker }

func NewCarHireDomain(h CarHireBooker) *CarHireDomain { return &CarHireDomain{hires: h} }

func (CarHireDomain) Name() string            { return CarHireDomainName }
func (CarHireDomain) ReferencePrefix() string { return CarHireReferencePrefix }
func (CarHireDomain) RoutePrefix() string     { return "/car-hire/paystack" }
func (CarHireDomain) EntityIDKey() string     { return "bookingId" }

func decodeCarHire(raw json.RawMessage) (transport.CarHireBookRequest, error) {
	var req transport.CarHireBookRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		return req, transport.NewCodedError(http.StatusBadRequest, "invalid_input", "invalid car-hire request")
	}
	return req, nil
}

func (d CarHireDomain) Quote(ctx context.Context, _ string, raw json.RawMessage) (Quoted, error) {
	req, err := decodeCarHire(raw)
	if err != nil {
		return Quoted{}, err
	}
	// The strict pre-flight runs inside QuoteCarHireBookingFrozen as well; running
	// it here too keeps a malformed request from ever reaching a booker that does
	// not (a fake, a future wrapper).
	if err := transport.ValidateCarHireBookRequest(req); err != nil {
		return Quoted{}, err
	}
	amt, pricing, err := d.hires.QuoteCarHireBookingFrozen(ctx, req)
	return Quoted{AmountKobo: amt, Pricing: pricing}, err
}

func (d CarHireDomain) Find(ctx context.Context, payerID, idemKey string) (string, bool, error) {
	return d.hires.FindCarHireByIdempotencyKey(ctx, payerID, idemKey)
}

func (d CarHireDomain) Book(ctx context.Context, payerID string, raw json.RawMessage, pricing json.RawMessage, idemKey string, verifiedAmountKobo int64) (string, error) {
	req, err := decodeCarHire(raw)
	if err != nil {
		return "", err
	}
	return d.hires.BookCarHirePaystackFundedFrozen(ctx, payerID, req, idemKey, verifiedAmountKobo, pricing)
}

// SweepCancelledRefunds implements CancelledRefundSweeper: it drives the card
// refunds of cancelled bookings (fare and/or deposit still escrowed) AND the
// deposit refund of completed bookings. The booker is asked through an optional
// interface so adapters over a narrower fake simply have nothing to sweep.
func (d CarHireDomain) SweepCancelledRefunds(ctx context.Context, minAge time.Duration, limit int) (CancelSweepResult, error) {
	sw, ok := d.hires.(cancelledRefundSweepBooker)
	if !ok {
		return CancelSweepResult{}, nil
	}
	res, err := sw.SweepCancelledCardRefunds(ctx, transport.RefundDomainCarHire, minAge, limit)
	return CancelSweepResult{Completed: res.Completed, Failed: res.Failed}, err
}
