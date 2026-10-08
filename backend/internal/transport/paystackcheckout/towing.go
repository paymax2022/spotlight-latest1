package paystackcheckout

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"spotlight/backend/internal/transport"
)

// Towing card-direct — a thin adapter over the shared Engine, same shape as
// parcel (see parcel.go).
//
// Lifecycle (why this is safe): a tow/roadside job is priced up front
// (callout + per-km × route distance, floored at the minimum fare; the fare
// never changes afterwards), escrowed, and released to the operator only on
// completion (PIN-verified). The only post-booking money event is
// cancellation, which refunds the whole escrow — exactly the shape of a
// parcel / instant ride. No tips, no extensions, no partial refunds.

// TowingDomainName is the stable domain id: intents.domain and the
// SetDomainExternalRefunder key. transport.Service files towing refunds under
// the same string (CancelTowing → refundSettlement(ctx, "towing", …)).
const TowingDomainName = "towing"

// TowingReferencePrefix: "towingorder:" + Idempotency-Key. Registered with the
// shared Paystack webhook by prefix; also a reserved wallet-path key prefix
// (transport.IsReservedIdempotencyKey).
const TowingReferencePrefix = "towingorder:"

// TowingBooker is the slice of transport.Service the towing adapter uses.
type TowingBooker interface {
	// QuoteTowingBookingFrozen returns the exact fare AND the frozen priced
	// inputs (route distance + pricing config) that produced it.
	QuoteTowingBookingFrozen(ctx context.Context, req transport.TowingBookRequest) (int64, json.RawMessage, error)
	FindTowingByIdempotencyKey(ctx context.Context, userID, idempotencyKey string) (string, bool, error)
	// BookTowingPaystackFundedFrozen books priced from `pricing` (the frozen
	// inputs), never from a fresh routing call.
	BookTowingPaystackFundedFrozen(ctx context.Context, userID string, req transport.TowingBookRequest, idempotencyKey string, verifiedAmountKobo int64, pricing json.RawMessage) (string, error)
}

// TowingDomain adapts transport towing booking to Domain.
type TowingDomain struct{ towing TowingBooker }

func NewTowingDomain(t TowingBooker) *TowingDomain { return &TowingDomain{towing: t} }

func (TowingDomain) Name() string            { return TowingDomainName }
func (TowingDomain) ReferencePrefix() string { return TowingReferencePrefix }
func (TowingDomain) RoutePrefix() string     { return "/towing/paystack" }
func (TowingDomain) EntityIDKey() string     { return "towingJobId" }

func decodeTowing(raw json.RawMessage) (transport.TowingBookRequest, error) {
	var req transport.TowingBookRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		return req, transport.NewCodedError(http.StatusBadRequest, "invalid_input", "invalid towing request")
	}
	if err := transport.ValidateTowingBookRequest(req); err != nil {
		return req, err
	}
	return req, nil
}

func (d TowingDomain) Quote(ctx context.Context, _ string, raw json.RawMessage) (Quoted, error) {
	req, err := decodeTowing(raw)
	if err != nil {
		return Quoted{}, err
	}
	amt, pricing, err := d.towing.QuoteTowingBookingFrozen(ctx, req)
	return Quoted{AmountKobo: amt, Pricing: pricing}, err
}

func (d TowingDomain) Find(ctx context.Context, payerID, idemKey string) (string, bool, error) {
	return d.towing.FindTowingByIdempotencyKey(ctx, payerID, idemKey)
}

func (d TowingDomain) Book(ctx context.Context, payerID string, raw json.RawMessage, pricing json.RawMessage, idemKey string, verifiedAmountKobo int64) (string, error) {
	req, err := decodeTowing(raw)
	if err != nil {
		return "", err
	}
	return d.towing.BookTowingPaystackFundedFrozen(ctx, payerID, req, idemKey, verifiedAmountKobo, pricing)
}

// SweepCancelledRefunds implements CancelledRefundSweeper (M2): it drives the
// card refund of cancelled bookings whose settlement is still escrowed. The
// booker is asked through an optional interface so adapters over a narrower fake
// simply have nothing to sweep.
func (d TowingDomain) SweepCancelledRefunds(ctx context.Context, minAge time.Duration, limit int) (CancelSweepResult, error) {
	sw, ok := d.towing.(cancelledRefundSweepBooker)
	if !ok {
		return CancelSweepResult{}, nil
	}
	res, err := sw.SweepCancelledCardRefunds(ctx, transport.RefundDomainTowing, minAge, limit)
	return CancelSweepResult{Completed: res.Completed, Failed: res.Failed}, err
}
