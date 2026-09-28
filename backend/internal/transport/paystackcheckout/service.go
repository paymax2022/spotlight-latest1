package paystackcheckout

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"

	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/transport"
)

// ReferencePrefix identifies a Paystack reference as belonging to this
// package (mirrors restaurant/paystackcheckout.ReferencePrefix's "foodorder:"
// idiom). The shared webhook pipeline dispatches charge.success events
// carrying this prefix here instead of the wallet/VA path.
const ReferencePrefix = "rideorder:"

func referenceFor(idempotencyKey string) string { return ReferencePrefix + idempotencyKey }

// Gateway is the slice of the Paystack provider this adapter uses — see
// restaurant/paystackcheckout.Gateway for why RefundPayment is not part of
// the broader provider.PaymentProvider interface.
type Gateway interface {
	InitializePayment(ctx context.Context, req provider.InitializePaymentRequest) (*provider.InitializePaymentResponse, error)
	VerifyPayment(ctx context.Context, reference string) (*provider.PaymentStatus, error)
	RefundPayment(ctx context.Context, reference string, amountKobo int64) (*provider.RefundResult, error)
}

// SettlementReverser is the slice of settlement.Service this adapter needs to
// unwind the LEDGER side of a Paystack-funded ride when refunding — see
// RefundExternalSettlement / transport.ExternalRefunder.
type SettlementReverser interface {
	RefundExternal(ctx context.Context, settlementID, reason string) error
}

// RidePlacer is the slice of transport.Service this adapter uses.
type RidePlacer interface {
	// QuoteRide computes the exact instant-mode fare from current pricing
	// config — used ONLY to decide the amount to ask Paystack for. Never
	// trusted as final: RequestRidePaystackFunded independently recomputes
	// and cross-checks it at confirmation time.
	QuoteRide(ctx context.Context, req transport.RequestRideRequest) (int64, error)
	// RequestRidePaystackFunded books the ride funded by an already-verified
	// external charge of exactly verifiedAmountKobo.
	RequestRidePaystackFunded(ctx context.Context, riderID string, req transport.RequestRideRequest, idempotencyKey string, verifiedAmountKobo int64) (*transport.TripDetailView, error)
}

// IntentStore persists the thin pending-intent mapping over
// public.transport_ride_paystack_intents.
type IntentStore interface {
	PutIntent(ctx context.Context, in intentRecord) (existing *intentRecord, inserted bool, err error)
	GetByReference(ctx context.Context, reference string) (*intentRecord, error)
	// GetByTripID resolves the intent that booked tripID — used only by
	// RefundExternalSettlement to find the Paystack reference to reverse
	// when a caller (refundTrip/UpdateTripStatus) only has the trip id.
	GetByTripID(ctx context.Context, tripID string) (*intentRecord, error)
	ClaimForProcessing(ctx context.Context, reference string) (claimed bool, err error)
	MarkStatus(ctx context.Context, reference, status string, tripID, refundReference *string) error
}

// Service is the ride-hailing Paystack-checkout adapter. Same shape as
// restaurant/paystackcheckout.Service — see that package for the fully
// commented reference implementation this mirrors line-for-line.
type Service struct {
	gateway    Gateway
	rides      RidePlacer
	intents    IntentStore
	settlement SettlementReverser
}

func NewService(gateway Gateway, rides RidePlacer, intents IntentStore, settlement SettlementReverser) *Service {
	return &Service{gateway: gateway, rides: rides, intents: intents, settlement: settlement}
}

func (s *Service) InitiateCheckout(ctx context.Context, riderID string, req transport.RequestRideRequest, email, callbackURL string) (*CheckoutIntent, error) {
	if riderID == "" {
		return nil, ErrUnauthenticated
	}
	if strings.TrimSpace(req.IdempotencyKey) == "" {
		return nil, ErrIdempotencyRequired
	}

	reference := referenceFor(req.IdempotencyKey)

	amountKobo, err := s.rides.QuoteRide(ctx, req)
	if err != nil {
		return nil, err
	}

	reqJSON, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("paystackcheckout: encode ride request: %w", err)
	}

	existing, inserted, err := s.intents.PutIntent(ctx, intentRecord{
		Reference:      reference,
		RiderID:        riderID,
		RequestJSON:    reqJSON,
		AmountKobo:     amountKobo,
		IdempotencyKey: req.IdempotencyKey,
		Status:         "pending",
	})
	if err != nil {
		return nil, err
	}
	if !inserted && existing != nil {
		reference = existing.Reference
		amountKobo = existing.AmountKobo
	}

	resp, err := s.gateway.InitializePayment(ctx, provider.InitializePaymentRequest{
		Email:          email,
		AmountKobo:     amountKobo,
		Reference:      reference,
		CallbackURL:    callbackURL,
		IdempotencyKey: req.IdempotencyKey,
	})
	if err != nil {
		return nil, err
	}

	out := &CheckoutIntent{
		Reference:        reference,
		AuthorizationURL: resp.AuthorizationURL,
		AccessCode:       resp.AccessCode,
		AmountKobo:       amountKobo,
	}
	if resp.Reference != "" {
		out.Reference = resp.Reference
	}
	return out, nil
}

// OnChargeSuccess mirrors restaurant/paystackcheckout.Service.OnChargeSuccess
// exactly — see that method's doc comment for the full flow description.
func (s *Service) OnChargeSuccess(ctx context.Context, reference, gatewayRef string) (*ConfirmResult, error) {
	rec, err := s.intents.GetByReference(ctx, reference)
	if err != nil {
		return nil, ErrUnknownReference
	}
	if rec.Status != "pending" {
		return &ConfirmResult{Reference: reference, Status: rec.Status, TripID: rec.TripID}, nil
	}

	status, err := s.gateway.VerifyPayment(ctx, reference)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrVerifyUnavailable, err)
	}
	if status == nil || strings.ToLower(status.Status) != "success" {
		return nil, ErrChargeNotSuccessful
	}

	claimed, err := s.intents.ClaimForProcessing(ctx, reference)
	if err != nil {
		return nil, err
	}
	if !claimed {
		if cur, cerr := s.intents.GetByReference(ctx, reference); cerr == nil && cur != nil {
			return &ConfirmResult{Reference: reference, Status: cur.Status, TripID: cur.TripID}, nil
		}
		return &ConfirmResult{Reference: reference, Status: "processing"}, nil
	}

	if status.AmountKobo != rec.AmountKobo {
		s.refundAndMark(ctx, rec, status.AmountKobo, "amount_mismatch")
		return nil, ErrAmountMismatch
	}

	req, err := rec.decodeRequest()
	if err != nil {
		s.refundAndMark(ctx, rec, status.AmountKobo, "order_failed")
		return nil, fmt.Errorf("paystackcheckout: decode frozen ride request: %w", err)
	}

	trip, err := s.rides.RequestRidePaystackFunded(ctx, rec.RiderID, req, rec.IdempotencyKey, status.AmountKobo)
	if err != nil {
		s.refundAndMark(ctx, rec, status.AmountKobo, "order_failed")
		return nil, fmt.Errorf("paystackcheckout: book ride: %w", err)
	}
	tripID, _ := trip.Trip["id"].(string)

	if merr := s.intents.MarkStatus(ctx, reference, "confirmed", &tripID, nil); merr != nil {
		log.Printf("[transport/paystackcheckout] mark confirmed failed for %s (trip=%s): %v", reference, tripID, merr)
	}
	return &ConfirmResult{Reference: reference, Status: "confirmed", TripID: &tripID, AmountKobo: status.AmountKobo}, nil
}

func (s *Service) refundAndMark(ctx context.Context, rec *intentRecord, amountKobo int64, failStatus string) {
	finalStatus := failStatus
	var refundRef *string
	if res, rerr := s.gateway.RefundPayment(ctx, rec.Reference, amountKobo); rerr == nil {
		ref := res.Reference
		refundRef = &ref
		finalStatus = "refunded"
	} else {
		log.Printf("[transport/paystackcheckout] REFUND FAILED for %s (amount=%d kobo, reason=%s): %v — needs manual reconciliation", rec.Reference, amountKobo, failStatus, rerr)
	}
	if merr := s.intents.MarkStatus(ctx, rec.Reference, finalStatus, nil, refundRef); merr != nil {
		log.Printf("[transport/paystackcheckout] mark %s failed for %s: %v", finalStatus, rec.Reference, merr)
	}
}

// CheckStatus mirrors restaurant/paystackcheckout.Service.CheckStatus — see
// that method for why this self-heal exists (Paystack cannot webhook a
// localhost callback URL).
func (s *Service) CheckStatus(ctx context.Context, reference string) (*ConfirmResult, error) {
	rec, err := s.intents.GetByReference(ctx, reference)
	if err != nil {
		return nil, ErrUnknownReference
	}
	if rec.Status != "pending" {
		return &ConfirmResult{Reference: reference, Status: rec.Status, TripID: rec.TripID}, nil
	}
	res, err := s.OnChargeSuccess(ctx, reference, reference)
	if errors.Is(err, ErrChargeNotSuccessful) || errors.Is(err, ErrVerifyUnavailable) {
		return &ConfirmResult{Reference: reference, Status: "pending"}, nil
	}
	return res, err
}

// OwnerCustomerID resolves which rider a checkout reference belongs to — see
// restaurant/paystackcheckout.Service.OwnerCustomerID's doc comment; same
// reasoning applies verbatim.
func (s *Service) OwnerCustomerID(ctx context.Context, reference string) (string, error) {
	rec, err := s.intents.GetByReference(ctx, reference)
	if err != nil {
		return "", ErrUnknownReference
	}
	return rec.RiderID, nil
}

// RefundExternalSettlement implements transport.ExternalRefunder. It is the
// ONLY place transport's ordinary refund paths (refundTrip, UpdateTripStatus)
// are allowed to reach for a Paystack-funded ride — see that interface's doc
// comment on transport.Service for why settlement.Refund (a wallet credit)
// must never be used for these. It does BOTH halves of a real refund: the
// actual Paystack reversal (customer-facing) and the internal ledger
// reversal (settlement.RefundExternal, so Spotlight's own books balance and
// the settlements row reaches a terminal state) — in that order, so a
// gateway failure never leaves the settlement wrongly marked refunded.
func (s *Service) RefundExternalSettlement(ctx context.Context, tripID, settlementID, reason string) error {
	rec, err := s.intents.GetByTripID(ctx, tripID)
	if err != nil {
		return fmt.Errorf("paystackcheckout: no intent found for trip %s: %w", tripID, err)
	}
	res, err := s.gateway.RefundPayment(ctx, rec.Reference, rec.AmountKobo)
	if err != nil {
		return fmt.Errorf("paystackcheckout: gateway refund for trip %s: %w", tripID, err)
	}
	if err := s.settlement.RefundExternal(ctx, settlementID, reason); err != nil {
		return fmt.Errorf("paystackcheckout: ledger reversal for trip %s: %w", tripID, err)
	}
	refundRef := res.Reference
	if merr := s.intents.MarkStatus(ctx, rec.Reference, "refunded", nil, &refundRef); merr != nil {
		log.Printf("[transport/paystackcheckout] mark refunded failed for %s (trip=%s): %v", rec.Reference, tripID, merr)
	}
	return nil
}
