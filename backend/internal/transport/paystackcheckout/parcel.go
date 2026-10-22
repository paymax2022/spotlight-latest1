package paystackcheckout

import (
	"context"
	"encoding/json"
	"fmt"
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
// Charged amount = the parcel FARE, plus the prepaid insurance premium when the
// sender ticked insure (FEATURE_PARCEL_PREPAID_INSURANCE; frozen with the fare).
// Then the charge funds two things: the fare escrow — a PIECE of the charge,
// settlement key "<ref>:fare", refunded on cancel through the piece path — and
// the premium in the insurance hold, refunded to the card as the ledgerless
// piece transport.ParcelInsurancePieceKey. A Book that fails after holding the
// premium is unwound by UnwindUnbooked before the engine refunds the charge.

// ParcelDomainName is the stable domain id: intents.domain and the
// SetDomainExternalRefunder key. transport.Service files parcel refunds under
// the same string.
const ParcelDomainName = "parcel"

// ParcelReferencePrefix: "parcelorder:" + Idempotency-Key. Registered with
// the shared Paystack webhook by prefix.
const ParcelReferencePrefix = "parcelorder-"

// ParcelBooker is the slice of transport.Service the parcel adapter uses.
type ParcelBooker interface {
	// QuoteParcelBookingFrozenFor returns the exact amount (fare, + premium when
	// insured) AND the frozen priced inputs that produced it, for senderID (the
	// insured quote checks the sender can be covered).
	QuoteParcelBookingFrozenFor(ctx context.Context, senderID string, req transport.ParcelBookRequest) (int64, json.RawMessage, error)
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

func (d ParcelDomain) Quote(ctx context.Context, payerID string, raw json.RawMessage) (Quoted, error) {
	req, err := decodeParcel(raw)
	if err != nil {
		return Quoted{}, err
	}
	amt, pricing, err := d.parcels.QuoteParcelBookingFrozenFor(ctx, payerID, req)
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

// parcelPremiumUnwinder is the optional slice of transport.Service that
// reverses a card premium hold of an unbooked charge.
type parcelPremiumUnwinder interface {
	UnwindParcelPremiumHold(ctx context.Context, payerID, idempotencyKey string) error
}

// UnwindUnbooked implements LedgerUnwinder: the premium Book may have held
// before it failed goes back to provider_clearing ledger-side, so the engine's
// whole-charge gateway refund leaves the books balanced. A booker without the
// method (a fake) holds nothing.
func (d ParcelDomain) UnwindUnbooked(ctx context.Context, payerID, reference string) error {
	u, ok := d.parcels.(parcelPremiumUnwinder)
	if !ok {
		// Fail CLOSED: a booker that cannot unwind may have held a premium the
		// whole-charge refund would leave stranded in the hold.
		return fmt.Errorf("paystackcheckout: parcel booker cannot unwind a premium hold for %s — refund blocked", reference)
	}
	return u.UnwindParcelPremiumHold(ctx, payerID, reference)
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
