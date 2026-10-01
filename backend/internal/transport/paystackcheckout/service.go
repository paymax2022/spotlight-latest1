// Package paystackcheckout implements a Paystack-funded (card / bank-transfer)
// checkout path for ride-hailing that never touches the rider's wallet and
// therefore never runs the KYC-tier daily-wallet-debit gate — the money is
// collected directly by Paystack, verified server-side, and escrowed via
// settlement.EscrowExternal (DR provider-clearing / CR escrow), not via a
// wallet debit.
// Structurally identical to restaurant/paystackcheckout (same rejected-and-
// redesigned history applies — see that package's doc comment for the full
// account of why a wallet-credit-based "funding" approach was rejected).
// Ported here for ride-hailing rather than food delivery because transport
// shares the exact same settlement.Escrow/EscrowExternal shape restaurant
// does. Two differences worth knowing:
//   - Only INSTANT pricing is supported (no offer-mode negotiation) — a ride's
//     fare must be fixed before Paystack collects it, and offer-mode fares can
//     change AFTER booking (RiderOffer/AcceptCounter), which has no external-
//     funding counterpart. See transport.RequestRidePaystackFunded.
//   - Refunding an externally-funded ride (cancellation, a stranded booking)
//     goes through transport.ExternalRefunder → settlement.RefundExternal +
//     this package's own gateway refund — never settlement.Refund, which
//     would wallet-credit the rider. See refundExternalAdapter.
package paystackcheckout

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/transport"
)

// intentRecord is the stored pending-intent row (public.transport_ride_paystack_intents).
type intentRecord struct {
	Reference      string
	RiderID        string
	RequestJSON    json.RawMessage
	AmountKobo     int64
	IdempotencyKey string
	Status         string
	TripID         *string
}

func (r *intentRecord) decodeRequest() (transport.RequestRideRequest, error) {
	var req transport.RequestRideRequest
	err := json.Unmarshal(r.RequestJSON, &req)
	return req, err
}

// CheckoutIntent is the result of InitiateCheckout handed back to the client.
type CheckoutIntent struct {
	Reference        string `json:"reference"`
	AuthorizationURL string `json:"authorizationUrl"`
	AccessCode       string `json:"accessCode,omitempty"`
	AmountKobo       int64  `json:"amountKobo"`
}

// ConfirmResult is the outcome of OnChargeSuccess / CheckStatus.
type ConfirmResult struct {
	Reference  string  `json:"reference"`
	Status     string  `json:"status"` // pending | processing | confirmed | amount_mismatch | order_failed | refunded
	TripID     *string `json:"tripId,omitempty"`
	AmountKobo int64   `json:"amountKobo,omitempty"`
}

var (
	ErrUnauthenticated     = errors.New("unauthenticated")
	ErrIdempotencyRequired = errors.New("idempotency_key_required")
	ErrChargeNotSuccessful = errors.New("charge_not_successful")
	// ErrVerifyUnavailable wraps a failure to REACH Paystack's verify
	// endpoint (network error, timeout, transient 5xx) — distinct from
	// ErrChargeNotSuccessful, which means Paystack was reached and explicitly
	// said the charge did not succeed. CheckStatus treats this the same as
	// "still pending" (keep polling) rather than a hard failure: the WebView
	// SDK's own onSuccess already told the client the card charge went
	// through, so a transient hiccup calling Paystack back MUST NOT surface
	// as a customer-facing "payment unavailable" — found 2026-09-25, a real
	// payment stuck oscillating between "processing" and "unavailable" on
	// every self-heal poll that happened to race a momentary verify failure.
	ErrVerifyUnavailable = errors.New("verify_unavailable")
	ErrAmountMismatch    = errors.New("amount_mismatch")
	ErrUnknownReference  = errors.New("unknown_reference")
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

// IntentRepository is the pgx-backed IntentStore over
// public.transport_ride_paystack_intents. Lives in this package because
// IntentStore's method set references the unexported intentRecord type.
type IntentRepository struct{ db *pgxpool.Pool }

func NewIntentStore(pool *pgxpool.Pool) *IntentRepository { return &IntentRepository{db: pool} }

const intentCols = `reference, rider_id, request_json, amount_kobo, idempotency_key, status, trip_id`

func scanIntent(row pgx.Row) (*intentRecord, error) {
	var r intentRecord
	if err := row.Scan(
		&r.Reference, &r.RiderID, &r.RequestJSON,
		&r.AmountKobo, &r.IdempotencyKey, &r.Status, &r.TripID,
	); err != nil {
		return nil, err
	}
	return &r, nil
}

func (s *IntentRepository) PutIntent(ctx context.Context, in intentRecord) (*intentRecord, bool, error) {
	const ins = `INSERT INTO public.transport_ride_paystack_intents
	  (reference, rider_id, request_json, amount_kobo, idempotency_key, status)
	  VALUES ($1,$2,$3,$4,$5,'pending')
	  ON CONFLICT (idempotency_key) DO NOTHING
	  RETURNING ` + intentCols
	if _, err := scanIntent(s.db.QueryRow(ctx, ins,
		in.Reference, in.RiderID, in.RequestJSON, in.AmountKobo, in.IdempotencyKey,
	)); err == nil {
		return nil, true, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, false, err
	}
	const sel = `SELECT ` + intentCols + ` FROM public.transport_ride_paystack_intents WHERE idempotency_key = $1`
	existing, err := scanIntent(s.db.QueryRow(ctx, sel, in.IdempotencyKey))
	if err != nil {
		return nil, false, err
	}
	return existing, false, nil
}

func (s *IntentRepository) GetByReference(ctx context.Context, reference string) (*intentRecord, error) {
	const q = `SELECT ` + intentCols + ` FROM public.transport_ride_paystack_intents WHERE reference = $1`
	rec, err := scanIntent(s.db.QueryRow(ctx, q, reference))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUnknownReference
	}
	return rec, err
}

// GetByTripID resolves the intent that booked tripID. Used only by
// RefundExternalSettlement, called from transport with a trip id (not a
// gateway reference) — see IntentStore's doc comment.
func (s *IntentRepository) GetByTripID(ctx context.Context, tripID string) (*intentRecord, error) {
	const q = `SELECT ` + intentCols + ` FROM public.transport_ride_paystack_intents WHERE trip_id = $1`
	rec, err := scanIntent(s.db.QueryRow(ctx, q, tripID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUnknownReference
	}
	return rec, err
}

func (s *IntentRepository) ClaimForProcessing(ctx context.Context, reference string) (bool, error) {
	tag, err := s.db.Exec(ctx,
		`UPDATE public.transport_ride_paystack_intents SET status = 'processing' WHERE reference = $1 AND status = 'pending'`,
		reference,
	)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func (s *IntentRepository) MarkStatus(ctx context.Context, reference, status string, tripID, refundReference *string) error {
	_, err := s.db.Exec(ctx,
		`UPDATE public.transport_ride_paystack_intents
		 SET status = $2, trip_id = COALESCE($3, trip_id), refund_reference = COALESCE($4, refund_reference),
		     confirmed_at = CASE WHEN $2 = 'confirmed' THEN now() ELSE confirmed_at END
		 WHERE reference = $1`,
		reference, status, tripID, refundReference,
	)
	return err
}

// Handler exposes the checkout-initiate + status-poll routes over Gin.
// Confirmation (OnChargeSuccess) is driven by the shared Paystack webhook
// pipeline in production; Status also self-heals via CheckStatus for
// environments Paystack cannot webhook (localhost).
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) fail(c *gin.Context, err error) {
	if ce, ok := errors.AsType[*transport.CodedError](err); ok {
		c.JSON(ce.Status, gin.H{"error": ce.Message, "code": ce.Code})
		return
	}
	switch {
	case errors.Is(err, ErrUnauthenticated):
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated", "message": err.Error()})
	case errors.Is(err, ErrIdempotencyRequired):
		c.JSON(http.StatusBadRequest, gin.H{"error": "idempotency_key_required", "message": err.Error()})
	case errors.Is(err, ErrUnknownReference):
		c.JSON(http.StatusNotFound, gin.H{"error": "unknown_reference", "message": err.Error()})
	case errors.Is(err, ErrChargeNotSuccessful):
		c.JSON(http.StatusConflict, gin.H{"error": "charge_not_successful", "message": err.Error()})
	case errors.Is(err, ErrAmountMismatch):
		c.JSON(http.StatusConflict, gin.H{"error": "amount_mismatch", "message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
	}
}

// RegisterTransportPaystackCheckout wires the two customer-facing routes onto
// the mobility member group.
//
//	group: POST /rides/paystack/initiate            start a checkout session (Idempotency-Key required)
//	       GET  /rides/paystack/:reference/status    poll + self-heal (see Service.CheckStatus)
//
// >>> INTEGRATION NOTE (confirmation) <<<
// No POST /rides/paystack/webhook route here. Service.OnChargeSuccess MUST be
// invoked from the EXISTING shared Paystack webhook pipeline
// (webhooks.PaystackHandler.handleChargeSuccess) — the integration task routes
// a charge.success whose reference carries ReferencePrefix ("rideorder:") to
// svc.OnChargeSuccess(reference, gatewayRef).
func RegisterTransportPaystackCheckout(group *gin.RouterGroup, svc *Service) *Handler {
	h := NewHandler(svc)
	if group != nil {
		group.POST("/rides/paystack/initiate", h.Initiate)
		group.GET("/rides/paystack/:reference/status", h.Status)
	}
	return h
}

// initiateRequest bundles transport.RequestRideRequest with the gateway
// fields InitiateCheckout needs, bound in ONE pass (the request body can only
// be read once) — mirrors restaurant/paystackcheckout's identical pattern.
type initiateRequest struct {
	transport.RequestRideRequest

	Email       string `json:"email"`
	CallbackURL string `json:"callback_url"`
}

func (h *Handler) Initiate(c *gin.Context) {
	u, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	var req initiateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	if hk := ginutil.IdempotencyKey(c); hk != "" {
		req.IdempotencyKey = hk
	}
	if req.IdempotencyKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "idempotency_key_required", "message": "Idempotency-Key is required"})
		return
	}
	// Paystack-funded rides only support instant pricing — mirrors
	// transport.requestRide's own guard, checked again here so a caller gets a
	// clear 400 before ever quoting/charging anything.
	if req.PricingMode == "offer" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": "Paystack-funded rides must use instant pricing, not offer mode"})
		return
	}

	out, err := h.svc.InitiateCheckout(c.Request.Context(), u, req.RequestRideRequest, req.Email, req.CallbackURL)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) Status(c *gin.Context) {
	u, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	reference := c.Param("reference")
	owner, err := h.svc.OwnerCustomerID(c.Request.Context(), reference)
	if err != nil {
		h.fail(c, err)
		return
	}
	if owner != u {
		c.JSON(http.StatusNotFound, gin.H{"error": "unknown_reference"})
		return
	}
	out, err := h.svc.CheckStatus(c.Request.Context(), reference)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}
