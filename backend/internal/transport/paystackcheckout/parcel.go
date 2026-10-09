package paystackcheckout

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"spotlight/backend/internal/transport"
)

// Parcel card-direct — the reference adapter for the shared Engine.
//
// Lifecycle (why this is safe): a parcel is booked and fully priced up front
// (distance × size × speed, fixed at booking; the fare never changes
// afterwards), escrowed, and released to the courier only on dropoff PIN +
// proof. The only post-booking money event is cancellation, which refunds the
// whole escrow — exactly the shape of an instant ride.
//
// Charged amount = the parcel FARE only. The insurance premium on the quote
// screen is indicative and is never charged at booking (see
// transport.Service.bookParcel); real cover is bound separately later.

// ParcelDomainName is the stable domain id: intents.domain and the
// SetDomainExternalRefunder key. transport.Service files parcel refunds under
// the same string.
const ParcelDomainName = "parcel"

// ParcelReferencePrefix: "parcelorder:" + Idempotency-Key. Registered with
// the shared Paystack webhook by prefix.
const ParcelReferencePrefix = "parcelorder:"

// ParcelBooker is the slice of transport.Service the parcel adapter uses.
type ParcelBooker interface {
	// QuoteParcelBookingFrozen returns the exact fare AND the frozen priced
	// inputs (route distance/duration + pricing config) that produced it.
	QuoteParcelBookingFrozen(ctx context.Context, req transport.ParcelBookRequest) (int64, json.RawMessage, error)
	FindParcelByIdempotencyKey(ctx context.Context, senderID, idempotencyKey string) (string, bool, error)
	// BookParcelPaystackFundedFrozen books priced from `pricing` (the frozen
	// inputs), never from a fresh routing call.
	BookParcelPaystackFundedFrozen(ctx context.Context, senderID string, req transport.ParcelBookRequest, idempotencyKey string, verifiedAmountKobo int64, pricing json.RawMessage) (string, error)
}

// ParcelDomain adapts transport parcel booking to Domain.
type ParcelDomain struct{ parcels ParcelBooker }

func NewParcelDomain(p ParcelBooker) *ParcelDomain { return &ParcelDomain{parcels: p} }

func (ParcelDomain) Name() string            { return ParcelDomainName }
func (ParcelDomain) ReferencePrefix() string { return ParcelReferencePrefix }
func (ParcelDomain) RoutePrefix() string     { return "/parcels/paystack" }
func (ParcelDomain) EntityIDKey() string     { return "parcelId" }

func decodeParcel(raw json.RawMessage) (transport.ParcelBookRequest, error) {
	var req transport.ParcelBookRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		return req, transport.NewCodedError(http.StatusBadRequest, "invalid_input", "invalid parcel request")
	}
	if req.ReceiverName == "" || req.ReceiverPhone == "" {
		return req, transport.NewCodedError(http.StatusBadRequest, "invalid_input", "receiver_name and receiver_phone are required")
	}
	return req, nil
}

func (d ParcelDomain) Quote(ctx context.Context, _ string, raw json.RawMessage) (Quoted, error) {
	req, err := decodeParcel(raw)
	if err != nil {
		return Quoted{}, err
	}
	amt, pricing, err := d.parcels.QuoteParcelBookingFrozen(ctx, req)
	return Quoted{AmountKobo: amt, Pricing: pricing}, err
}

func (d ParcelDomain) Find(ctx context.Context, payerID, idemKey string) (string, bool, error) {
	return d.parcels.FindParcelByIdempotencyKey(ctx, payerID, idemKey)
}

func (d ParcelDomain) Book(ctx context.Context, payerID string, raw json.RawMessage, pricing json.RawMessage, idemKey string, verifiedAmountKobo int64) (string, error) {
	req, err := decodeParcel(raw)
	if err != nil {
		return "", err
	}
	return d.parcels.BookParcelPaystackFundedFrozen(ctx, payerID, req, idemKey, verifiedAmountKobo, pricing)
}

// SweepCancelledRefunds implements CancelledRefundSweeper (M2): it drives the
// card refund of cancelled bookings whose settlement is still escrowed. The
// booker is asked through an optional interface so adapters over a narrower fake
// simply have nothing to sweep.
func (d ParcelDomain) SweepCancelledRefunds(ctx context.Context, minAge time.Duration, limit int) (CancelSweepResult, error) {
	sw, ok := d.parcels.(cancelledRefundSweepBooker)
	if !ok {
		return CancelSweepResult{}, nil
	}
	res, err := sw.SweepCancelledCardRefunds(ctx, transport.RefundDomainParcel, minAge, limit)
	return CancelSweepResult{Completed: res.Completed, Failed: res.Failed}, err
}
