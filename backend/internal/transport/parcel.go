package transport

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/go-common/fsm"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/finance/settlement"
)

// State machine:
//   created → courier_assigned → pickup_pin_verified → picked_up
//          → in_transit → dropoff_verified → delivered
// Escrow: book → Escrow(sender, "parcel:<id>", idemKey, "transport", fare).
// Release with Settle(courier split) only on dropoff PIN + proof verification.
// Cancel → Refund.

// parcelTransitions is the guarded state machine for parcels.
var parcelTransitions = fsm.Table[string]{
	"created":             {"courier_assigned": true, "cancelled": true},
	"courier_assigned":    {"pickup_pin_verified": true, "cancelled": true, "failed": true},
	"pickup_pin_verified": {"picked_up": true, "cancelled": true, "failed": true},
	"picked_up":           {"in_transit": true, "dropoff_verified": true, "failed": true, "disputed": true},
	"in_transit":          {"dropoff_verified": true, "failed": true, "disputed": true},
	"dropoff_verified":    {"delivered": true},
}

func canTransitionParcel(from, to string) bool {
	return parcelTransitions.Can(from, to)
}

// parcelSizeMultiplier scales fare by declared package size.
func parcelSizeMultiplier(size string) float64 {
	switch size {
	case "small":
		return 1.0
	case "medium":
		return 1.4
	case "large":
		return 2.0
	default:
		return 1.0
	}
}

// parcelSpeedMultiplier scales fare by requested delivery speed.
func parcelSpeedMultiplier(speed string) float64 {
	switch speed {
	case "express":
		return 1.5
	case "same_day": // shown as "Priority" in the app: ASAP, dedicated courier
		return 2.2
	case "scheduled":
		return 0.9
	default: // standard
		return 1.0
	}
}

// parcelRow is the internal projection of a parcel.
type parcelRow struct {
	ID                string
	SenderID          string
	CourierID         *string
	Status            string
	FareKobo          int64
	InsuranceKobo     int64 // indicative estimate shown before booking, not a charge
	DeclaredValueKobo int64
	PickupAddress     string
	DropoffAddress    string
	Category          string
	InsurancePolicyID *string
	PickupPin         *string
	DropoffPin        *string
	SettlementID      *string
	DistanceM         *int
	// Prepaid insurance (parcel_insurance_prepaid.go).
	InsuranceOpted    bool
	InsurancePaidKobo int64
	InsuranceStatus   string
	IdempotencyKey    string // the booking key; keys the premium hold and its refund
}

func (s *Service) loadParcel(ctx context.Context, id string, p *parcelRow) error {
	const q = `SELECT id, sender_id, courier_id, status, fare_kobo, insurance_kobo, declared_value_kobo,
	                  pickup_address, dropoff_address, category, insurance_policy_id,
	                  pickup_pin, dropoff_pin, settlement_id, distance_m,
	                  insurance_opted, insurance_paid_kobo, insurance_status, COALESCE(idempotency_key, '')
	           FROM parcels WHERE id=$1`
	return s.db.QueryRow(ctx, q, id).Scan(
		&p.ID, &p.SenderID, &p.CourierID, &p.Status, &p.FareKobo, &p.InsuranceKobo, &p.DeclaredValueKobo,
		&p.PickupAddress, &p.DropoffAddress, &p.Category, &p.InsurancePolicyID,
		&p.PickupPin, &p.DropoffPin, &p.SettlementID, &p.DistanceM,
		&p.InsuranceOpted, &p.InsurancePaidKobo, &p.InsuranceStatus, &p.IdempotencyKey,
	)
}

// ParcelEstimateRequest is POST /mobility/parcels/estimate.
type ParcelEstimateRequest struct {
	Pickup            Place  `json:"pickup" binding:"required"`
	Dropoff           Place  `json:"dropoff" binding:"required"`
	Category          string `json:"category"`
	Size              string `json:"size"`
	Speed             string `json:"speed"`
	DeclaredValueKobo int64  `json:"declared_value_kobo"`
}

// ParcelBookRequest is POST /mobility/parcels.
type ParcelBookRequest struct {
	Pickup        Place  `json:"pickup" binding:"required"`
	Dropoff       Place  `json:"dropoff" binding:"required"`
	ReceiverName  string `json:"receiver_name" binding:"required"`
	ReceiverPhone string `json:"receiver_phone" binding:"required"`
	// ReceiverEmail is optional: the receiver is emailed the drop-off PIN after
	// pickup (FEATURE_PARCEL_RECEIVER_PIN_NOTIFY). Malformed = 400 invalid_input.
	ReceiverEmail     string `json:"receiver_email,omitempty"`
	Category          string `json:"category"`
	Size              string `json:"size"`
	Speed             string `json:"speed"`
	DeclaredValueKobo int64  `json:"declared_value_kobo"`
	ProhibitedAck     bool   `json:"prohibited_ack"`
	IdempotencyKey    string `json:"idempotency_key"`
	// ExpectedFareKobo is the fare the customer confirmed on the estimate
	// (fareKobo, not totalKobo). Wallet path only: a mismatch with the live fare
	// is refused (409 FARE_CHANGED) before any money moves. Nil = legacy
	// behaviour (older app builds, scheduled dispatch). See checkExpectedParcelFare.
	ExpectedFareKobo *int64 `json:"expected_fare_kobo,omitempty"`
	// RouteToken is the estimate's routeToken: wallet bookings price from its
	// signed route (live config). Ignored unless it verifies. See parcel_route_token.go.
	RouteToken string `json:"route_token,omitempty"`
	// Insure buys Goods-in-Transit cover, paid now with the fare
	// (FEATURE_PARCEL_PREPAID_INSURANCE). ExpectedInsuranceKobo is the premium
	// the customer saw; a mismatch is FARE_CHANGED. See parcel_insurance_prepaid.go.
	Insure                bool   `json:"insure,omitempty"`
	ExpectedInsuranceKobo *int64 `json:"expected_insurance_kobo,omitempty"`
}

// ParcelPickedUpRequest carries the parcel photo confirmation.
type ParcelPickedUpRequest struct {
	PhotoURL string `json:"photo_url"`
}

// ParcelVerifyDropoffRequest is POST /driver/parcels/:id/verify-dropoff.
type ParcelVerifyDropoffRequest struct {
	Pin string `json:"pin" binding:"required"`
	// Not binding:"required": a missing proof is the service's 422 PROOF_REQUIRED,
	// not a 400 carrying the validator's internal field path.
	ProofURL string `json:"proof_url"`
}

// ParcelEstimate is the estimate response.
type ParcelEstimate struct {
	DistanceM       int     `json:"distanceM"`
	DurationS       int     `json:"durationS"`
	FareKobo        int64   `json:"fareKobo"`
	InsuranceKobo   int64   `json:"insuranceKobo"`
	TotalKobo       int64   `json:"totalKobo"`
	SizeMultiplier  float64 `json:"sizeMultiplier"`
	SpeedMultiplier float64 `json:"speedMultiplier"`
	// RouteToken signs this estimate's route for the wallet booking to price
	// from (route_token). Empty when route tokens are off.
	RouteToken string `json:"routeToken,omitempty"`
	// Options prices every size × speed on this route, so each choice can show
	// its own price.
	Options []ParcelPriceOption `json:"options"`
	// Insurance names the cover the declared value buys. Nil when insurance is
	// not wired on this server.
	Insurance *ParcelInsuranceInfo `json:"insurance,omitempty"`
}

// parcelFare computes the fare: (base + per_km*km) * size * speed, floored at min.
func parcelFare(distanceM, durationS int, size, speed string, cfg *PricingConfig) int64 {
	km := float64(distanceM) / 1000.0
	mins := float64(durationS) / 60.0
	raw := float64(cfg.BaseFareKobo) + km*float64(cfg.PerKMKobo) + mins*float64(cfg.PerMinKobo)
	raw *= parcelSizeMultiplier(size) * parcelSpeedMultiplier(speed)
	fare := max(int64(math.Round(raw)), cfg.MinFareKobo)
	return fare
}

// parcelInsurance computes the insurance premium owed on a declared value, in
// kobo, rounded to the nearest kobo. A zero (or unset) declared value —
// meaning the sender declined cover — always yields zero premium; it is never
// defaulted to a floor. A misconfigured negative rate can never yield a
// negative premium (which would look like a refund baked into a quote).
func parcelInsurance(declaredValueKobo int64, cfg *PricingConfig) int64 {
	if declaredValueKobo <= 0 || cfg.InsuranceRateBps <= 0 {
		return 0
	}
	return int64(math.Round(float64(declaredValueKobo) * float64(cfg.InsuranceRateBps) / 10000.0))
}

// EstimateParcel returns a fare estimate from distance × size × speed, plus
// the insurance premium on any declared value and their combined total.
func (s *Service) EstimateParcel(ctx context.Context, req ParcelEstimateRequest) (*ParcelEstimate, error) {
	cfg, err := s.loadPricingConfig(ctx, "default", "parcel")
	if err != nil {
		return nil, err
	}
	route, err := s.maps.Route(ctx,
		LatLng{Lat: req.Pickup.Lat, Lng: req.Pickup.Lng},
		LatLng{Lat: req.Dropoff.Lat, Lng: req.Dropoff.Lng},
	)
	if err != nil {
		return nil, err
	}
	card, err := s.loadParcelRateCard(ctx, "default")
	if err != nil {
		return nil, err
	}
	size, speed, _, err := normalizeParcelOptions(req.Size, req.Speed, req.Category)
	if err != nil {
		return nil, err
	}
	fare, _ := parcelFareFor(route.DistanceM, route.DurationS, size, speed, cfg, card)
	insurance := s.parcelIndicativeInsurance(ctx, req.DeclaredValueKobo, cfg)
	return &ParcelEstimate{
		DistanceM:       route.DistanceM,
		DurationS:       route.DurationS,
		FareKobo:        fare,
		InsuranceKobo:   insurance,
		TotalKobo:       fare + insurance,
		SizeMultiplier:  parcelSizeMultiplier(size),
		SpeedMultiplier: parcelSpeedMultiplier(speed),
		Options:         parcelPriceOptions(route.DistanceM, route.DurationS, cfg, card),
		Insurance:       s.parcelInsuranceInfo(ctx),
		RouteToken:      signParcelRoute(s.parcelRouteSecret, req.Pickup, req.Dropoff, route, time.Now()),
	}, nil
}

// parcelPricing is the server-side price of a parcel booking request. The
// escrowed/charged amount is `fare` ONLY — `insurance` is indicative display,
// never charged here (see bookParcel).
type parcelPricing struct {
	fare, insurance int64
	route           RouteResult
	cfg             *PricingConfig
	rate            *parcelRate // the rate-card cell priced from; nil = legacy multipliers
	size, speed     string
	category        string
}

// priceParcel computes the price of a booking request from server config and
// the routing adapter only — no client-supplied amount can reach it. Shared by
// the wallet path, QuoteParcelBooking and the card-direct booking, so the
// number a card is charged is by construction the number the booking
// recomputes.
func (s *Service) priceParcel(ctx context.Context, req ParcelBookRequest) (*parcelPricing, error) {
	cfg, err := s.loadPricingConfig(ctx, "default", "parcel")
	if err != nil {
		return nil, err
	}
	// The estimate's signed route when the request carries a valid token
	// (server-computed, so not client-controlled), else a live routing call.
	route, err := s.parcelRouteForBooking(ctx, req)
	if err != nil {
		return nil, err
	}
	card, err := s.loadParcelRateCard(ctx, "default")
	if err != nil {
		return nil, err
	}
	return s.priceParcelWith(ctx, req, cfg, route, card)
}

// priceParcelWith is the pure pricing step shared by live and frozen pricing:
// given a config and a route it applies size/speed defaults and computes the
// fare (the ONLY charged amount) and the indicative insurance (display only).
func (s *Service) priceParcelWith(ctx context.Context, req ParcelBookRequest, cfg *PricingConfig, route RouteResult, card parcelRateCard) (*parcelPricing, error) {
	size, speed, category, err := normalizeParcelOptions(req.Size, req.Speed, req.Category)
	if err != nil {
		return nil, err
	}
	fare, rate := parcelFareFor(route.DistanceM, route.DurationS, size, speed, cfg, card)
	return &parcelPricing{
		fare:      fare,
		insurance: s.parcelIndicativeInsurance(ctx, req.DeclaredValueKobo, cfg),
		route:     route, cfg: cfg, rate: rate, size: size, speed: speed, category: category,
	}, nil
}

// parcelFrozenPricing is the priced input set frozen at card-direct initiate
// and replayed at confirm: the route's distance/duration and the full pricing
// config row the quote used. Pricing from THIS (not a fresh routing call /
// config read) is what keeps a traffic-aware re-query or a config edit between
// charge and booking from producing a spurious amount mismatch.
type parcelFrozenPricing struct {
	DistanceM int           `json:"distanceM"`
	DurationS int           `json:"durationS"`
	Config    PricingConfig `json:"config"`
	// Rate is the rate-card cell the quote used; nil means legacy multipliers
	// (the card was off, had no such cell, or the intent predates the card).
	Rate *parcelRate `json:"rate,omitempty"`
	// InsuranceKobo is the prepaid insurance premium the card was charged for
	// (insure ticked); 0 = no premium. Frozen like the fare: the booking holds
	// exactly this, never a premium re-priced from the live catalog rate.
	InsuranceKobo int64 `json:"insuranceKobo,omitempty"`
}

// priceParcelFrozen is priceParcel over frozen inputs; a nil frozen falls back
// to live pricing (wallet path, legacy intents without a frozen snapshot).
func (s *Service) priceParcelFrozen(ctx context.Context, req ParcelBookRequest, frozen *parcelFrozenPricing) (*parcelPricing, error) {
	if frozen == nil {
		return s.priceParcel(ctx, req)
	}
	cfg := frozen.Config // copy: never alias the caller's snapshot
	// Replay exactly the cell that was quoted; never re-read the live card.
	var card parcelRateCard
	if frozen.Rate != nil {
		size, speed, _, err := normalizeParcelOptions(req.Size, req.Speed, req.Category)
		if err != nil {
			return nil, err
		}
		card = parcelRateCard{rateCardKey(size, speed): *frozen.Rate}
	}
	return s.priceParcelWith(ctx, req, &cfg, RouteResult{DistanceM: frozen.DistanceM, DurationS: frozen.DurationS}, card)
}

// BookParcel books + escrows a parcel from the sender's WALLET (KYC-tier
// gated); generates pickup_pin + dropoff_pin.
func (s *Service) BookParcel(ctx context.Context, senderID string, req ParcelBookRequest, idempotencyKey string) (map[string]any, error) {
	if idempotencyKey == "" {
		idempotencyKey = req.IdempotencyKey
	}
	if IsReservedIdempotencyKey(idempotencyKey) {
		return nil, codedErr(http.StatusBadRequest, "INVALID_IDEMPOTENCY_KEY", "this idempotency key format is reserved")
	}
	id, err := s.bookParcel(ctx, senderID, req, idempotencyKey, false, 0, nil)
	if err != nil {
		return nil, err
	}
	return s.ParcelDetail(ctx, id, senderID)
}

// QuoteParcelBooking returns the EXACT amount (kobo) a card-direct parcel
// booking will be charged: the fare, plus the prepaid insurance premium when
// insure is ticked — see bookParcel. Pure read. Never trusted as final:
// BookParcelPaystackFunded independently recomputes it. No sender, so the
// sender-profile check is left to the booking (QuoteParcelBookingFrozenFor
// runs it at initiate).
func (s *Service) QuoteParcelBooking(ctx context.Context, req ParcelBookRequest) (int64, error) {
	amount, _, err := s.QuoteParcelBookingFrozenFor(ctx, "", req)
	return amount, err
}

// QuoteParcelBookingFrozen is QuoteParcelBooking plus the frozen priced inputs
// (JSON) the card-direct engine stores in the intent and hands back to
// BookParcelPaystackFundedFrozen.
func (s *Service) QuoteParcelBookingFrozen(ctx context.Context, req ParcelBookRequest) (int64, json.RawMessage, error) {
	return s.QuoteParcelBookingFrozenFor(ctx, "", req)
}

// QuoteParcelBookingFrozenFor is the card-direct initiate quote for senderID.
// With insure ticked (FEATURE_PARCEL_PREPAID_INSURANCE) the amount is fare +
// the estimate's premium and the premium is frozen next to the fare; a parcel
// that could never be covered is refused here, before anything is charged
// (the wallet-balance check does not apply: the card pays). senderID "" skips
// the profile check only — the booking re-runs every eligibility check.
func (s *Service) QuoteParcelBookingFrozenFor(ctx context.Context, senderID string, req ParcelBookRequest) (int64, json.RawMessage, error) {
	req.RouteToken = "" // card-direct prices a live route; route tokens are wallet-only
	if !req.ProhibitedAck {
		return 0, nil, codedErr(http.StatusUnprocessableEntity, "PROHIBITED_ACK_REQUIRED", "prohibited items acknowledgement required")
	}
	if _, err := receiverEmailParam(req); err != nil {
		return 0, nil, err
	}
	pr, err := s.priceParcel(ctx, req)
	if err != nil {
		return 0, nil, err
	}
	fp := parcelFrozenPricing{DistanceM: pr.route.DistanceM, DurationS: pr.route.DurationS, Config: *pr.cfg, Rate: pr.rate}
	amount := pr.fare
	if s.prepaidInsurance(req) {
		if err := s.checkPrepaidInsuranceEligible(ctx, senderID, req, pr.insurance); err != nil {
			return 0, nil, err
		}
		fp.InsuranceKobo = pr.insurance
		amount += pr.insurance
	}
	frozen, err := json.Marshal(fp)
	if err != nil {
		return 0, nil, fmt.Errorf("transport: freeze parcel pricing: %w", err)
	}
	return amount, frozen, nil
}

// FindParcelByIdempotencyKey returns the parcel already booked under
// idempotencyKey for senderID, if any (card-direct replay / ambiguous-failure
// resolution).
func (s *Service) FindParcelByIdempotencyKey(ctx context.Context, senderID, idempotencyKey string) (string, bool, error) {
	var id string
	err := s.db.QueryRow(ctx, `SELECT id FROM parcels WHERE idempotency_key=$1 AND sender_id=$2`, idempotencyKey, senderID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return id, true, nil
}

// BookParcelPaystackFunded books a parcel funded by an ALREADY-VERIFIED
// external Paystack charge of exactly verifiedAmountKobo — never a wallet
// debit, so the KYC-tier gate does not (and must not) run. The caller
// (transport/paystackcheckout) has verified the charge with the gateway; this
// function trusts that unconditionally but independently RECOMPUTES the fare
// and refuses (CodeAmountMismatch, before any write) unless it equals
// verifiedAmountKobo. Idempotent on idempotencyKey: a repeat returns the
// existing parcel. On a failure after the escrow was posted the escrow is
// reversed ledger-side (RefundExternal) so the caller's gateway refund leaves
// the books balanced. Must only ever be called from a server-initiated
// confirm flow — never from a handler that lets request input choose it.
func (s *Service) BookParcelPaystackFunded(ctx context.Context, senderID string, req ParcelBookRequest, idempotencyKey string, verifiedAmountKobo int64) (string, error) {
	if idempotencyKey == "" {
		return "", codedErr(http.StatusBadRequest, "MISSING_IDEMPOTENCY_KEY", "idempotency key required")
	}
	return s.bookParcel(ctx, senderID, req, idempotencyKey, true, verifiedAmountKobo, nil)
}

// BookParcelPaystackFundedFrozen is BookParcelPaystackFunded priced from the
// frozen inputs captured at quote time (nil/empty ⇒ live pricing).
func (s *Service) BookParcelPaystackFundedFrozen(ctx context.Context, senderID string, req ParcelBookRequest, idempotencyKey string, verifiedAmountKobo int64, frozenPricing json.RawMessage) (string, error) {
	if idempotencyKey == "" {
		return "", codedErr(http.StatusBadRequest, "MISSING_IDEMPOTENCY_KEY", "idempotency key required")
	}
	return s.bookParcel(ctx, senderID, req, idempotencyKey, true, verifiedAmountKobo, frozenPricing)
}

// externalParcelID is the parcel id of a card-direct booking, derived from the
// namespaced idempotency key so every retry of one charge targets ONE id (and
// one settlement reference "parcel:<id>").
func externalParcelID(idempotencyKey string) string {
	return uuid.NewSHA1(externalParcelNamespace, []byte(idempotencyKey)).String()
}

// externalParcelNamespace is the fixed UUIDv5 namespace for externalParcelID.
// NEVER change it: it is what makes a retry after a crash land on the same id.
var externalParcelNamespace = uuid.MustParse("6f1d7a0e-3c52-5b8e-9a41-0d2c7e9b4f10")

// resolveExternalInsertFailure decides what to do after the parcel INSERT
// failed while an external escrow exists for the key.
//
//	found      → a concurrent confirm won the unique(idempotency_key): that parcel
//	             OWNS the escrow. Return its id; never reverse.
//	find error → cannot prove no parcel owns the escrow. LEAVE it, return the
//	             error (the engine keeps the claim and retries; reversing on a
//	             guess would orphan a live parcel from its money).
//	not found  → provably orphaned: reverse it ledger-side so the engine's
//	             gateway refund leaves the books balanced.
func resolveExternalInsertFailure(find func() (string, bool, error), reverse func() error) (existingID string, reversed bool, err error) {
	id, found, ferr := find()
	switch {
	case ferr != nil:
		return "", false, fmt.Errorf("transport: parcel insert failed and the owner lookup failed — external escrow left in place: %w", ferr)
	case found:
		return id, false, nil
	}
	if rerr := reverse(); rerr != nil {
		return "", false, fmt.Errorf("transport: orphan external escrow reversal failed: %w", rerr)
	}
	return "", true, nil
}

// receiverEmailParam validates the optional receiver_email: nil when absent,
// the normalised address when valid, 400 invalid_input when malformed.
func receiverEmailParam(req ParcelBookRequest) (*string, error) {
	if strings.TrimSpace(req.ReceiverEmail) == "" {
		return nil, nil
	}
	e := normaliseReceiverEmail(req.ReceiverEmail)
	if e == "" {
		return nil, codedErr(http.StatusBadRequest, "invalid_input", "receiver_email is not a valid email address")
	}
	return &e, nil
}

// bookParcel is the shared body of BookParcel (wallet) and
// BookParcelPaystackFunded (card-direct); `external`/`verifiedAmountKobo` are
// never client-settable.
func (s *Service) bookParcel(ctx context.Context, senderID string, req ParcelBookRequest, idempotencyKey string, external bool, verifiedAmountKobo int64, frozenPricing json.RawMessage) (string, error) {
	if idempotencyKey == "" {
		return "", codedErr(http.StatusBadRequest, "MISSING_IDEMPOTENCY_KEY", "idempotency key required")
	}
	if !req.ProhibitedAck {
		return "", codedErr(http.StatusUnprocessableEntity, "PROHIBITED_ACK_REQUIRED", "prohibited items acknowledgement required")
	}
	receiverEmail, err := receiverEmailParam(req)
	if err != nil {
		return "", err
	}
	// Replay: a repeat of an already-booked key (card-funded, or a wallet retry
	// whose response was lost) returns that parcel untouched — no second escrow,
	// no second row, no second tier check, and never a FARE_CHANGED for a
	// booking that was already charged. The wallet path used to reach the
	// INSERT and 500 on UNIQUE(idempotency_key).
	if external {
		// Card-direct is pinned by its own frozen quote; tokens are wallet-only.
		req.RouteToken = ""
	}
	if id, found, err := s.findParcelReplay(ctx, senderID, idempotencyKey, req, !external); err != nil {
		return "", err
	} else if found {
		return id, nil
	}
	var pr *parcelPricing
	var frozenPremium int64
	if external && len(frozenPricing) > 0 {
		// Price from the inputs frozen at quote time, NOT a fresh routing call:
		// the customer was charged for exactly that number.
		var frozen parcelFrozenPricing
		if jerr := json.Unmarshal(frozenPricing, &frozen); jerr != nil {
			return "", fmt.Errorf("transport: frozen parcel pricing unreadable: %w", jerr)
		}
		frozenPremium = frozen.InsuranceKobo
		pr, err = s.priceParcelFrozen(ctx, req, &frozen)
	} else {
		pr, err = s.priceParcel(ctx, req)
	}
	if err != nil {
		return "", err
	}
	fare, insurance, route := pr.fare, pr.insurance, pr.route
	// Insurance paid at booking (parcel_insurance_prepaid.go): ticked, the
	// estimate's premium is charged with the fare but held apart from it, so it
	// never reaches the courier settlement. Refused up front when the parcel
	// could never be covered.
	insured := s.prepaidInsurance(req)
	if external && len(frozenPricing) > 0 {
		// Card: insured-ness is what the card was CHARGED for (the frozen
		// premium), not the live flag — a flag flip between initiate and confirm
		// must not turn a correctly-charged order into a refund.
		insured = req.Insure && frozenPremium > 0
	}
	var premium int64
	var expectedPremium *int64
	if insured && external {
		// Card: the premium the card was charged for, frozen at initiate (a
		// catalog rate change since must not turn the charge into a mismatch).
		// Re-checked here because the money is already collected: a parcel that
		// can no longer be covered is refused, and the engine refunds the charge.
		if frozenPremium > 0 {
			premium = frozenPremium
		} else {
			premium = insurance
		}
		insurance = premium
		if err := s.checkPrepaidInsuranceEligible(ctx, senderID, req, premium); err != nil {
			return "", err
		}
	} else if insured {
		premium, expectedPremium = insurance, req.ExpectedInsuranceKobo
		if err := s.checkPrepaidInsurance(ctx, senderID, idempotencyKey, req, fare, premium); err != nil {
			return "", err
		}
	} else if s.prepaidInsuranceOn {
		insurance = 0 // not ticked: no cover, nothing owed or shown for it
	}
	// Indicative only — DISPLAY, never charged here. Real cover (if any) is
	// quoted and bound for its real premium once a courier + vehicle are known,
	// see AcceptParcel/bindParcelInsurance. The escrow below is fare-only: the
	// courier settlement split must never include a third-party insurance
	// premium, which belongs entirely to a separate wallet-debit saga.

	if external {
		// Cross-check BEFORE anything writes: pricing config can move between
		// the quote that set the charge and this call; never trust the quote,
		// only what was actually collected.
		// The charge must be exactly fare + premium (premium 0 uninsured).
		if fare+premium != verifiedAmountKobo {
			return "", codedErr(http.StatusConflict, CodeAmountMismatch, "verified payment amount no longer matches the parcel fare")
		}
	} else if err := checkExpectedParcelFare(req.ExpectedFareKobo, fare); err != nil {
		// The wallet path prices live at book time, so pricing config or the
		// rate card can move between the estimate the customer confirmed and
		// this call. Refuse BEFORE the tier gate and the escrow: nothing moves,
		// and the app re-confirms the new price. (A key that already booked
		// never gets here: the replay check above returned it.)
		return "", err
	} else if err := checkExpectedParcelInsurance(expectedPremium, premium); err != nil {
		return "", err
	} else if err := s.enforceTierLimit(ctx, senderID, fare+premium); err != nil {
		// Fail-closed tier/spending-limit gate BEFORE any wallet escrow (same
		// contract as RequestRide): a Tier0/over-limit sender cannot move
		// money. Skipped ONLY for card-direct: no wallet debit exists there.
		return "", err
	}

	parcelID := uuid.New().String()
	if external {
		// Deterministic per charge: every retry escrows under ONE reference
		// ("parcel:<id>") and targets ONE parcel row.
		parcelID = externalParcelID(idempotencyKey)
	}
	ref := "parcel:" + parcelID
	// escrowKey: an insured CARD charge funds two things (fare + premium), so
	// its fare is one PIECE of the charge ("<ref>:fare") and is refunded to the
	// card for exactly its own amount — never the whole charge.
	escrowKey := idempotencyKey
	if insured {
		// Premium first: if the fare escrow then fails, a same-key retry reuses
		// it, or it is unwound/refunded (see the error branch below).
		if external {
			escrowKey = idempotencyKey + ":fare"
			err = s.holdParcelPremiumCard(ctx, senderID, idempotencyKey, premium)
		} else {
			err = s.holdParcelPremium(ctx, senderID, idempotencyKey, premium)
		}
		if err != nil {
			return "", err
		}
	}
	var sett *settlement.Settlement
	if external {
		sett, err = s.settlement.EscrowExternal(ctx, senderID, ref, escrowKey, "transport", fare)
	} else {
		sett, err = s.escrowCheckout(ctx, senderID, ref, idempotencyKey, fare)
	}
	if err != nil {
		// A held premium is NOT refunded here: a same-key retry reuses it, and if
		// the booking is never retried the orphan sweep (ReconcileParcelInsurance)
		// refunds it after a grace period — or, for a card charge, the engine
		// unwinds it (UnwindParcelPremiumHold) before refunding the charge.
		// Refunding now would turn the retry into a key conflict.
		return "", fmt.Errorf("transport: escrow parcel fare: %w", err)
	}
	if external {
		// EscrowExternal returns the EXISTING row on a replay. Only a live
		// (escrowed) external escrow held for THIS sender may back a new parcel;
		// a refunded / settled / foreign / wallet-funded row would deliver a
		// parcel for money that already went back (or never was this charge).
		if sett.Status != settlement.StatusEscrowed || sett.PayerID != senderID || sett.FundingSource != "external" {
			return "", fmt.Errorf("transport: external escrow replay for %s is not a live escrow of this sender's charge (status=%s payer_match=%t funding=%s) — refusing to book",
				idempotencyKey, sett.Status, sett.PayerID == senderID, sett.FundingSource)
		}
		if sett.TotalKobo != fare {
			// Escrow replay resolved to a row holding a different amount — fail
			// closed (see settlement.Escrow's re-read comment).
			return "", fmt.Errorf("transport: external escrow replay amount %d != fare %d", sett.TotalKobo, fare)
		}
	}
	pickupPin := generatePin()
	dropoffPin := generatePin()

	// Best-effort NDPA consent for the real insurer, so a later real bind
	// (AcceptParcel) doesn't need a separate UI moment: the sender already
	// opted in by entering a declared value on a field explicitly labelled
	// "for insurance". A failure here is NOT fatal to booking — it just means
	// the later bind attempt will find consent missing and skip cover cleanly.
	if req.DeclaredValueKobo > 0 && s.insurance != nil {
		if cErr := s.insurance.GrantConsent(ctx, senderID, parcelInsuranceProductCode); cErr != nil {
			log.Printf("[transport] parcel insurance consent grant failed at booking (non-fatal): %v", cErr)
		}
	}

	const q = `
		INSERT INTO parcels
			(id, sender_id, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng,
			 receiver_name, receiver_phone, category, size, declared_value_kobo, speed, prohibited_ack,
			 fare_kobo, insurance_kobo, status, pickup_pin, dropoff_pin, distance_m, settlement_id, idempotency_key,
			 insurance_opted, insurance_paid_kobo, insurance_status, receiver_email)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'created',$18,$19,$20,$21,$22,$23,$24,$25,$26)`
	insuranceStatus := s.bookingInsuranceStatus(insured, req)
	if _, err := s.db.Exec(ctx, q,
		parcelID, senderID, req.Pickup.Address, req.Pickup.Lat, req.Pickup.Lng,
		req.Dropoff.Address, req.Dropoff.Lat, req.Dropoff.Lng,
		req.ReceiverName, req.ReceiverPhone, pr.category, pr.size, req.DeclaredValueKobo, pr.speed, req.ProhibitedAck,
		fare, insurance, pickupPin, dropoffPin, route.DistanceM, sett.ID, idempotencyKey,
		insured, premium, insuranceStatus, receiverEmail,
	); err != nil {
		if external {
			// The booking ctx may be the very thing that failed (deadline /
			// cancel), so the compensation runs on a detached, bounded one.
			cctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
			defer cancel()
			id, _, cerr := resolveExternalInsertFailure(
				func() (string, bool, error) { return s.FindParcelByIdempotencyKey(cctx, senderID, idempotencyKey) },
				func() error { return s.settlement.RefundExternal(cctx, sett.ID, "parcel_insert_failed") },
			)
			if cerr != nil {
				log.Printf("[transport] external escrow settlement=%s after parcel insert failure (%v) — %v — needs manual reconciliation", sett.ID, err, cerr)
				return "", fmt.Errorf("transport: insert parcel: %w (compensation: %v)", err, cerr)
			}
			if id != "" { // a concurrent confirm owns the escrow
				return id, nil
			}
		} else if id, found, ferr := s.findParcelReplay(ctx, senderID, idempotencyKey, req, true); ferr == nil && found {
			// A concurrent same-key wallet request won the INSERT. Its escrow is
			// the only one (the escrow is idempotent on the key), so hand back its
			// parcel rather than a 500.
			return id, nil
		}
		// A held premium (and the fare escrow) stay for a same-key retry; the
		// orphan sweep refunds the premium if none comes.
		return "", fmt.Errorf("transport: insert parcel: %w", err)
	}
	if insured {
		s.markCoverIfPremiumRefunded(ctx, parcelID, idempotencyKey)
	}
	meta := map[string]any{"fare_kobo": fare, "insurance_kobo": insurance, "settlement_id": sett.ID, "insurance_paid_kobo": premium}
	if external {
		meta["funding"] = "external"
		meta["verified_amount_kobo"] = verifiedAmountKobo
	}
	s.recordModeEvent(ctx, senderID, "parcel.created", "parcel", parcelID, "", "created", meta)
	return parcelID, nil
}

// ParcelDetail returns a parcel; sender sees PINs, courier does not.
func (s *Service) ParcelDetail(ctx context.Context, id, callerID string) (map[string]any, error) {
	const q = `
		SELECT id, sender_id, courier_id, pickup_address, dropoff_address, receiver_name, receiver_phone,
		       category, size, speed, declared_value_kobo, fare_kobo, insurance_kobo, insurance_policy_id,
		       status, pickup_pin, dropoff_pin, photo_url, proof_url, distance_m, created_at,
		       insurance_opted, insurance_paid_kobo, insurance_status,
		       pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
		       (SELECT st.status FROM settlements st WHERE st.id = parcels.settlement_id),
		       EXISTS (SELECT 1 FROM mode_ratings r WHERE r.mode='parcel' AND r.job_id=parcels.id::text AND r.rater_id=parcels.sender_id),
		       receiver_notified_at, receiver_email, COALESCE(receiver_notified_via, '{}')
		FROM parcels WHERE id=$1`
	var (
		pid, senderID, pickup, dropoff, receiver, rphone, category, size, speed, status string
		courierID, photoURL, proofURL, pickupPin, dropoffPin, insurancePolicyID         *string
		declared, fare, insurance                                                       int64
		distM                                                                           *int
		createdAt                                                                       time.Time
		insuranceOpted                                                                  bool
		insurancePaid                                                                   int64
		insuranceStatus                                                                 string
		pickupLat, pickupLng, dropoffLat, dropoffLng                                    *float64
		paymentStatus                                                                   *string
		rated                                                                           bool
		receiverNotifiedAt                                                              *time.Time
		receiverEmail                                                                   *string
		receiverNotifiedVia                                                             []string
	)
	if err := s.db.QueryRow(ctx, q, id).Scan(
		&pid, &senderID, &courierID, &pickup, &dropoff, &receiver, &rphone,
		&category, &size, &speed, &declared, &fare, &insurance, &insurancePolicyID,
		&status, &pickupPin, &dropoffPin, &photoURL, &proofURL, &distM, &createdAt,
		&insuranceOpted, &insurancePaid, &insuranceStatus,
		&pickupLat, &pickupLng, &dropoffLat, &dropoffLng, &paymentStatus, &rated, &receiverNotifiedAt, &receiverEmail, &receiverNotifiedVia,
	); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "parcel not found")
	}
	// Object-level authz: sender, or the assigned courier (via driver user_id).
	isSender := callerID == senderID
	if !isSender {
		if courierID == nil {
			return nil, codedErr(http.StatusForbidden, CodeForbidden, "not permitted")
		}
		var ownerUser string
		_ = s.db.QueryRow(ctx, `SELECT user_id FROM drivers WHERE id=$1`, *courierID).Scan(&ownerUser)
		if ownerUser != callerID {
			return nil, codedErr(http.StatusForbidden, CodeForbidden, "not permitted")
		}
	}
	out := map[string]any{
		"id": pid, "senderId": senderID, "courierId": courierID,
		"pickupAddress": pickup, "dropoffAddress": dropoff,
		"receiverName": receiver, "receiverPhone": rphone,
		"category": category, "size": size, "speed": speed,
		"declaredValueKobo": declared, "fareKobo": fare, "insuranceKobo": insurance,
		"insurancePolicyId": insurancePolicyID, // null until AcceptParcel successfully binds real cover
		"totalKobo":         fare + insurance, "status": status,
		"photoUrl": photoURL, "proofUrl": proofURL, "distanceM": distM, "createdAt": createdAt,
		// Prepaid insurance: what the sender paid at booking and where it is
		// (held → bound, or refunded). See parcel_insurance_prepaid.go.
		"insuranceOpted": insuranceOpted, "insurancePaidKobo": insurancePaid, "insuranceStatus": insuranceStatus,
		// What the apps render (contract ParcelDetail): places with coordinates,
		// the courier as the sender sees them, and where the fare escrow is.
		"pickup": parcelPlace(pickup, pickupLat, pickupLng), "dropoff": parcelPlace(dropoff, dropoffLat, dropoffLng),
		"courier": s.parcelCourierView(ctx, courierID), "paymentStatus": paymentStatus, "rated": rated,
		"deliveredAt": nil,
	}
	if status == "delivered" {
		out["deliveredAt"] = s.parcelDeliveredAt(ctx, pid)
	}
	// Only the sender may read the PINs (courier verifies, never reads), and
	// only while the parcel is live: a finished parcel has nothing to unlock.
	if isSender {
		// When the receiver was texted the drop-off PIN; null = tell them yourself.
		out["receiverNotifiedAt"] = nil
		if receiverNotifiedAt != nil {
			out["receiverNotifiedAt"] = *receiverNotifiedAt
		}
		out["receiverNotifiedVia"] = receiverNotifiedVia
		out["receiverEmail"] = nil
		if receiverEmail != nil {
			out["receiverEmail"] = *receiverEmail
		}
	}
	if isSender && status != "delivered" && status != "cancelled" && status != "failed" {
		out["pickupPin"] = pickupPin
		out["dropoffPin"] = dropoffPin
	}
	return out, nil
}

// ListParcels returns the sender's parcels.
func (s *Service) ListParcels(ctx context.Context, senderID string) ([]map[string]any, error) {
	const q = `
		SELECT id, pickup_address, dropoff_address, category, size, fare_kobo, status, created_at
		FROM parcels WHERE sender_id=$1 ORDER BY created_at DESC LIMIT 100`
	rows, err := s.db.Query(ctx, q, senderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, pickup, dropoff, category, size, status string
		var fare int64
		var createdAt time.Time
		if err := rows.Scan(&id, &pickup, &dropoff, &category, &size, &fare, &status, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "pickupAddress": pickup, "dropoffAddress": dropoff,
			"category": category, "size": size, "fareKobo": fare, "status": status, "createdAt": createdAt,
		})
	}
	return out, nil
}

// CancelParcel refunds escrow and moves the parcel to cancelled (sender only).
// See CancelParcelWithRefund for the refund_status the HTTP endpoint reports.
func (s *Service) CancelParcel(ctx context.Context, id, senderID, reason string) error {
	_, err := s.CancelParcelWithRefund(ctx, id, senderID, reason)
	return err
}

// CancelParcelWithRefund cancels a parcel and reports whether the sender's money
// is actually back. A card-funded parcel whose domain has no refunder wired is
// refused BEFORE the status flips (503 refund_unavailable).
func (s *Service) CancelParcelWithRefund(ctx context.Context, id, senderID, reason string) (*CancelResult, error) {
	reason = capCancelReason(reason)
	var p parcelRow
	if err := s.loadParcel(ctx, id, &p); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "parcel not found")
	}
	if p.SenderID != senderID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not your parcel")
	}
	if p.Status == "cancelled" {
		// Idempotent re-cancel. Only meaningful for a card-funded parcel whose
		// first refund attempt failed after the status flip: finish the refund
		// (escrowed OR disputed). Anything else is a plain 409.
		if res, handled, err := s.finishCancelledRefund(ctx, RefundDomainParcel, id, p.SettlementID, "parcel_cancelled_retry:"+reason); handled {
			return res, err
		}
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "cannot cancel from status "+p.Status)
	}
	if !canTransitionParcel(p.Status, "cancelled") {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "cannot cancel from status "+p.Status)
	}
	external, err := s.requireRefundRail(ctx, RefundDomainParcel, p.SettlementID)
	if err != nil {
		return nil, err
	}
	if err := s.parcelSetStatus(ctx, id, p.Status, "cancelled"); err != nil {
		return nil, err
	}
	res := &CancelResult{RefundStatus: RefundStatusNone}
	if p.SettlementID != nil {
		// One refund choke point: card-funded (EscrowExternal) money goes back
		// through the gateway, wallet-funded money back to the wallet — chosen
		// from settlements.funding_source, never guessed. A failure is logged and
		// reported as refund_status, not returned: the parcel IS cancelled;
		// re-POSTing cancel (or the reconciler sweep) finishes a card refund
		// that failed here.
		rerr := s.refundSettlement(ctx, RefundDomainParcel, id, *p.SettlementID, "parcel_cancelled:"+reason)
		if rerr != nil {
			log.Printf("[transport] parcel %s cancelled but refund of settlement=%s failed: %v", id, *p.SettlementID, rerr)
		}
		res.RefundStatus = refundStatusFor(rerr, external)
	}
	if p.CourierID != nil {
		_, _ = s.db.Exec(ctx, `UPDATE drivers SET status='online', cancelled_trips=cancelled_trips+1, updated_at=NOW() WHERE id=$1`, *p.CourierID)
	}
	// A premium paid at booking is refunded (and bound cover cancelled). Re-read
	// the insurance status AFTER the cancel flip: a bind finishing concurrently
	// writes 'bound' before it reads the parcel status, and this side writes
	// 'cancelled' before it reads the insurance status, so one of the two always
	// sees the other (and the bound→refunded claim lets only one act).
	// Detached: the parcel is already cancelled, so a dropped request here must
	// not leave its premium held (the sweep also catches held + cancelled).
	{
		dctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
		if err := s.db.QueryRow(dctx, `SELECT insurance_status, insurance_policy_id FROM parcels WHERE id=$1`, id).
			Scan(&p.InsuranceStatus, &p.InsurancePolicyID); err == nil {
			s.refundPrepaidOnCancel(dctx, &p)
		}
		cancel()
	}
	// Legacy cover (bound and debited at accept): best-effort cancel, never
	// blocks the parcel cancellation — see cancelParcelInsurance.
	if p.InsuranceStatus == insuranceStatusNone && p.InsurancePolicyID != nil && *p.InsurancePolicyID != "" {
		s.cancelParcelInsurance(ctx, senderID, *p.InsurancePolicyID)
	}
	s.recordModeEvent(ctx, senderID, "parcel.cancelled", "parcel", id, p.Status, "cancelled", map[string]any{"reason": reason, "refund_status": res.RefundStatus})
	return res, nil
}

// parcelSetStatus performs a guarded status update (rejects illegal transitions).
func (s *Service) parcelSetStatus(ctx context.Context, id, from, to string) error {
	if !canTransitionParcel(from, to) {
		return codedErr(http.StatusConflict, CodeInvalidState, fmt.Sprintf("illegal parcel transition %s → %s", from, to))
	}
	tag, err := s.db.Exec(ctx, `UPDATE parcels SET status=$1, updated_at=NOW() WHERE id=$2 AND status=$3`, to, id, from)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return codedErr(http.StatusConflict, CodeInvalidState, "parcel status changed concurrently")
	}
	return nil
}

// OpenParcelRequests returns unassigned, created parcels for couriers.
func (s *Service) OpenParcelRequests(ctx context.Context, driverUserID string) ([]map[string]any, error) {
	courierID, err := s.driverGate(ctx, driverUserID)
	if err != nil {
		return nil, err
	}
	const q = `
		SELECT id, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng,
		       category, size, speed, fare_kobo, distance_m, created_at
		FROM parcels WHERE courier_id IS NULL AND status='created' ORDER BY created_at DESC LIMIT 50`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	netOf := s.courierNetFunc(ctx, courierID)
	out := []map[string]any{}
	for rows.Next() {
		var id, pickup, dropoff, category, size, speed string
		var pLat, pLng, dLat, dLng *float64
		var fare int64
		var distM *int
		var createdAt time.Time
		if err := rows.Scan(&id, &pickup, &pLat, &pLng, &dropoff, &dLat, &dLng, &category, &size, &speed, &fare, &distM, &createdAt); err != nil {
			return nil, err
		}
		// No receiver details before acceptance.
		out = append(out, map[string]any{
			"id": id, "pickupAddress": pickup, "dropoffAddress": dropoff,
			"pickup": parcelPlace(pickup, pLat, pLng), "dropoff": parcelPlace(dropoff, dLat, dLng),
			"category": category, "size": size, "speed": speed,
			"fareKobo": fare, "estCourierNetKobo": netOf(fare),
			"distanceM": distM, "createdAt": createdAt,
		})
	}
	return out, rows.Err()
}

// AcceptParcel assigns an approved courier to a created parcel.
func (s *Service) AcceptParcel(ctx context.Context, id, driverUserID string) (map[string]any, error) {
	courierID, err := s.driverGate(ctx, driverUserID)
	if err != nil {
		return nil, err
	}
	var p parcelRow
	if err := s.loadParcel(ctx, id, &p); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "parcel not found")
	}
	if p.Status != "created" {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "parcel not open for acceptance")
	}
	tag, err := s.db.Exec(ctx,
		`UPDATE parcels SET courier_id=$1, status='courier_assigned', updated_at=NOW() WHERE id=$2 AND courier_id IS NULL AND status='created'`,
		courierID, id)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "parcel already taken")
	}
	_, _ = s.db.Exec(ctx, `UPDATE drivers SET status='on_trip', updated_at=NOW() WHERE id=$1`, courierID)
	s.recordModeEvent(ctx, driverUserID, "parcel.courier_assigned", "parcel", id, "created", "courier_assigned",
		map[string]any{"courier_id": courierID})

	// Cover, if any: a premium paid at booking is bound now (or refunded); a
	// parcel booked before prepaid insurance keeps the legacy bind-and-debit.
	// Never blocks courier assignment. See parcel_insurance_prepaid.go.
	if p.InsuranceStatus == insuranceStatusHeld || (p.InsuranceStatus == insuranceStatusNone && p.DeclaredValueKobo > 0) {
		s.insureParcelAtAccept(ctx, &p, s.loadParcelSenderProfile(ctx, p.SenderID), s.loadParcelDriverVehicle(ctx, courierID), driverUserID)
	}

	return s.ParcelDetail(ctx, id, driverUserID)
}

// VerifyParcelPickupPin: courier_assigned → pickup_pin_verified (PIN must match).
func (s *Service) VerifyParcelPickupPin(ctx context.Context, id, driverUserID, pin string) error {
	p, err := s.courierOwnedParcel(ctx, id, driverUserID)
	if err != nil {
		return err
	}
	if p.Status != "courier_assigned" {
		return codedErr(http.StatusConflict, CodeInvalidState, "parcel not awaiting pickup PIN")
	}
	if err := s.checkPin(ctx, "parcel", id, "pickup", derefStr(p.PickupPin), pin, driverUserID); err != nil {
		return err
	}
	if err := s.parcelSetStatus(ctx, id, "courier_assigned", "pickup_pin_verified"); err != nil {
		return err
	}
	s.recordModeEvent(ctx, driverUserID, "parcel.pickup_pin_verified", "parcel", id, "courier_assigned", "pickup_pin_verified", nil)
	return nil
}

// MarkParcelPickedUp: pickup_pin_verified → picked_up → in_transit (+ photo).
func (s *Service) MarkParcelPickedUp(ctx context.Context, id, driverUserID, photoURL string) error {
	p, err := s.courierOwnedParcel(ctx, id, driverUserID)
	if err != nil {
		return err
	}
	if p.Status != "pickup_pin_verified" {
		return codedErr(http.StatusConflict, CodeInvalidState, "parcel not pickup-verified")
	}
	if err := s.parcelSetStatus(ctx, id, "pickup_pin_verified", "picked_up"); err != nil {
		return err
	}
	if photoURL != "" {
		_, _ = s.db.Exec(ctx, `UPDATE parcels SET photo_url=$1, updated_at=NOW() WHERE id=$2`, photoURL, id)
	}
	s.recordModeEvent(ctx, driverUserID, "parcel.picked_up", "parcel", id, "pickup_pin_verified", "picked_up",
		map[string]any{"photo_url": photoURL})
	if err := s.parcelSetStatus(ctx, id, "picked_up", "in_transit"); err != nil {
		return err
	}
	s.recordModeEvent(ctx, driverUserID, "parcel.in_transit", "parcel", id, "picked_up", "in_transit", nil)
	// The receiver must hand the courier the drop-off PIN: text it to them now
	// (best-effort, at most once, off the request path).
	s.notifyReceiverAfterPickup(ctx, id)
	return nil
}

// VerifyParcelDropoff: in_transit/picked_up → dropoff_verified → delivered + settle.
func (s *Service) VerifyParcelDropoff(ctx context.Context, id, driverUserID, pin, proofURL string) error {
	p, err := s.courierOwnedParcel(ctx, id, driverUserID)
	if err != nil {
		return err
	}
	if p.Status != "in_transit" && p.Status != "picked_up" {
		return codedErr(http.StatusConflict, CodeInvalidState, "parcel not in transit")
	}
	// Proof first: a request that can never succeed must not double as a PIN
	// oracle, nor burn one of the limited PIN guesses (checkPin).
	if proofURL == "" {
		return codedErr(http.StatusUnprocessableEntity, "PROOF_REQUIRED", "proof of delivery required")
	}
	if err := s.checkPin(ctx, "parcel", id, "dropoff", derefStr(p.DropoffPin), pin, driverUserID); err != nil {
		return err
	}
	if err := s.parcelSetStatus(ctx, id, p.Status, "dropoff_verified"); err != nil {
		return err
	}
	_, _ = s.db.Exec(ctx, `UPDATE parcels SET proof_url=$1, updated_at=NOW() WHERE id=$2`, proofURL, id)
	s.recordModeEvent(ctx, driverUserID, "parcel.dropoff_verified", "parcel", id, p.Status, "dropoff_verified",
		map[string]any{"proof_url": proofURL})

	// Release escrow → settle courier split, then mark delivered. The escrow is
	// fare-only (serviceFeeKobo=0): a real insurance premium, when one was
	// bound, was ALREADY paid separately via the insurance module's own wallet-
	// debit saga at courier-assignment time (see AcceptParcel/bindParcelInsurance)
	// — it must never also be carved out of this courier settlement, which would
	// charge the sender for it twice.
	if p.SettlementID != nil && p.CourierID != nil {
		if err := s.settleModeProvider(ctx, *p.SettlementID, *p.CourierID, 0); err != nil {
			return fmt.Errorf("transport: settle parcel: %w", err)
		}
		// Record realized Spotlight profit (best-effort + idempotent; parcel id as
		// source ref + idempotency key). gross = the full delivery fare the sender
		// paid. A recorder failure is logged and swallowed — it must NEVER affect the
		// courier settlement above (earning-row only; no ledger re-post).
		senderID := p.SenderID
		s.recordCommissionSafe(ctx, "Lifestyle", "Delivery - Rider", "", p.FareKobo, id, &senderID)
	}
	if err := s.parcelSetStatus(ctx, id, "dropoff_verified", "delivered"); err != nil {
		return err
	}
	if p.CourierID != nil {
		_, _ = s.db.Exec(ctx, `UPDATE drivers SET status='online', completed_trips=completed_trips+1, updated_at=NOW() WHERE id=$1`, *p.CourierID)
	}
	s.recordModeEvent(ctx, driverUserID, "parcel.delivered", "parcel", id, "dropoff_verified", "delivered", nil)
	return nil
}

// courierOwnedParcel loads a parcel and asserts the caller is the assigned courier.
func (s *Service) courierOwnedParcel(ctx context.Context, id, driverUserID string) (*parcelRow, error) {
	driverID, err := s.driverGate(ctx, driverUserID)
	if err != nil {
		return nil, err
	}
	var p parcelRow
	if err := s.loadParcel(ctx, id, &p); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "parcel not found")
	}
	if p.CourierID == nil || *p.CourierID != driverID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not the assigned courier")
	}
	return &p, nil
}

// ParcelEstimate returns a parcel fare estimate.
func (h *Handler) ParcelEstimate(c *gin.Context) {
	var req ParcelEstimateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	est, err := h.svc.EstimateParcel(c.Request.Context(), req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, est)
}

// ParcelBook books + escrows a parcel.
func (h *Handler) ParcelBook(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req ParcelBookRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	p, err := h.svc.BookParcel(c.Request.Context(), userID, req, ginutil.IdempotencyKey(c))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, p)
}

// ParcelGet returns a parcel detail.
func (h *Handler) ParcelGet(c *gin.Context) {
	userID := ginutil.UserID(c)
	p, err := h.svc.ParcelDetail(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

// ParcelList returns the sender's parcels.
func (h *Handler) ParcelList(c *gin.Context) {
	userID := ginutil.UserID(c)
	ps, err := h.svc.ListParcels(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"parcels": ps})
}

// ParcelCancel refunds + cancels a parcel.
func (h *Handler) ParcelCancel(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req CancelRequest
	_ = c.ShouldBindJSON(&req)
	res, err := h.svc.CancelParcelWithRefund(c.Request.Context(), c.Param("id"), userID, req.Reason)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "cancelled", "refund_status": res.RefundStatus})
}

// ParcelRequests returns open courier requests.
func (h *Handler) ParcelRequests(c *gin.Context) {
	userID := ginutil.UserID(c)
	reqs, err := h.svc.OpenParcelRequests(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"requests": reqs})
}

// ParcelAccept assigns the courier.
func (h *Handler) ParcelAccept(c *gin.Context) {
	userID := ginutil.UserID(c)
	p, err := h.svc.AcceptParcel(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

// ParcelVerifyPickupPin verifies the pickup PIN.
func (h *Handler) ParcelVerifyPickupPin(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req VerifyPinRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if err := h.svc.VerifyParcelPickupPin(c.Request.Context(), c.Param("id"), userID, req.Pin); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "pickup_pin_verified"})
}

// ParcelPickedUp confirms pickup with a photo.
func (h *Handler) ParcelPickedUp(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req ParcelPickedUpRequest
	_ = c.ShouldBindJSON(&req)
	if err := h.svc.MarkParcelPickedUp(c.Request.Context(), c.Param("id"), userID, req.PhotoURL); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "in_transit"})
}

// ParcelVerifyDropoff verifies dropoff PIN + proof, settles courier.
func (h *Handler) ParcelVerifyDropoff(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req ParcelVerifyDropoffRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if err := h.svc.VerifyParcelDropoff(c.Request.Context(), c.Param("id"), userID, req.Pin, req.ProofURL); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "delivered"})
}

// checkExpectedParcelFare refuses a wallet booking whose live fare differs from
// the fare the customer confirmed. Exact integer-kobo equality: a fare that
// went DOWN is refused too, so the customer always sees the amount escrowed.
// A nil expectation is the legacy path and always passes.
func checkExpectedParcelFare(expectedKobo *int64, fareKobo int64) error {
	if expectedKobo == nil || *expectedKobo == fareKobo {
		return nil
	}
	ce := codedErr(http.StatusConflict, CodeFareChanged, "the delivery price changed since your estimate; please review the new price")
	ce.Details = map[string]any{"fare_kobo": fareKobo, "expected_fare_kobo": *expectedKobo}
	return ce
}

// findParcelReplay returns the parcel this sender already booked under key.
// With checkBody (the wallet path) a reused key must carry the SAME booking —
// route, receiver, size and speed — or it is a 409 IDEMPOTENCY_KEY_CONFLICT,
// never a silent hand-back of a parcel the customer did not ask for. The
// card-direct path skips the check: its body is pinned by the intent store.
func (s *Service) findParcelReplay(ctx context.Context, senderID, key string, req ParcelBookRequest, checkBody bool) (string, bool, error) {
	var (
		id                         string
		pLat, pLng, dLat, dLng     float64
		receiverPhone, size, speed string
		opted                      bool
	)
	err := s.db.QueryRow(ctx, `
		SELECT id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, receiver_phone, size, speed, insurance_opted
		FROM parcels WHERE idempotency_key=$1 AND sender_id=$2`, key, senderID).
		Scan(&id, &pLat, &pLng, &dLat, &dLng, &receiverPhone, &size, &speed, &opted)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	if checkBody && (pLat != req.Pickup.Lat || pLng != req.Pickup.Lng || dLat != req.Dropoff.Lat || dLng != req.Dropoff.Lng ||
		receiverPhone != req.ReceiverPhone || size != replaySize(req.Size) || speed != normalizeParcelSpeed(req.Speed) ||
		opted != s.prepaidInsurance(req)) {
		return "", false, codedErr(http.StatusConflict, CodeKeyConflict, "this idempotency key was already used for a different parcel booking; retry with a new key")
	}
	return id, true, nil
}

// replaySize applies the default a booking's size is stored with (speed uses
// normalizeParcelSpeed), so a retry of the same request compares equal.
func replaySize(size string) string {
	if size = strings.ToLower(strings.TrimSpace(size)); size == "" {
		return "small"
	}
	return size
}
