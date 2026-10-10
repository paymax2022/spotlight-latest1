package transport

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/go-common/dbutil"
	"spotlight/backend/go-common/fsm"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/finance/settlement"
)

// State machine:
//   requested → operator_accepted → operator_en_route → pin_verified
//            → in_progress → completed   (cancelled)
// Escrow: book → Escrow(user, "towing:<id>", idemKey, "transport", fare).
// Settle operator split on complete. Cancel → Refund.

var towingTransitions = fsm.Table[string]{
	"requested":         {"operator_accepted": true, "cancelled": true},
	"operator_accepted": {"operator_en_route": true, "cancelled": true},
	"operator_en_route": {"pin_verified": true, "cancelled": true},
	"pin_verified":      {"in_progress": true, "cancelled": true},
	"in_progress":       {"completed": true},
}

func canTransitionTowing(from, to string) bool {
	return towingTransitions.Can(from, to)
}

// TowingEstimateRequest is POST /mobility/towing/estimate.
type TowingEstimateRequest struct {
	ServiceType string `json:"service_type"`
	Pickup      Place  `json:"pickup" binding:"required"`
	Dest        *Place `json:"dest"`
}

// TowingBookRequest is POST /mobility/towing.
type TowingBookRequest struct {
	ServiceType    string `json:"service_type"`
	VehicleType    string `json:"vehicle_type"`
	IssueType      string `json:"issue_type"`
	Pickup         Place  `json:"pickup" binding:"required"`
	Dest           *Place `json:"dest"`
	IdempotencyKey string `json:"idempotency_key"`
}

// TowingEstimate is the estimate response.
type TowingEstimate struct {
	DistanceM   int   `json:"distanceM"`
	CalloutKobo int64 `json:"calloutKobo"`
	FareKobo    int64 `json:"fareKobo"`
}

// towingRow is the internal projection of a towing job.
type towingRow struct {
	ID           string
	UserID       string
	OperatorID   *string
	Status       string
	FareKobo     int64
	Pin          *string
	SettlementID *string
}

func (s *Service) loadTowing(ctx context.Context, id string, t *towingRow) error {
	const q = `SELECT id, user_id, operator_id, status, fare_kobo, pin, settlement_id FROM towing_jobs WHERE id=$1`
	return s.db.QueryRow(ctx, q, id).Scan(
		&t.ID, &t.UserID, &t.OperatorID, &t.Status, &t.FareKobo, &t.Pin, &t.SettlementID,
	)
}

// towingFare = callout (base) + per_km*km. per_min ignored (towing per_min=0).
func towingFare(distanceM int, cfg *PricingConfig) int64 {
	km := float64(distanceM) / 1000.0
	raw := float64(cfg.BaseFareKobo) + km*float64(cfg.PerKMKobo)
	fare := max(int64(math.Round(raw)), cfg.MinFareKobo)
	return fare
}

// EstimateTowing returns callout + distance fare.
func (s *Service) EstimateTowing(ctx context.Context, req TowingEstimateRequest) (*TowingEstimate, error) {
	cfg, err := s.loadPricingConfig(ctx, "default", "towing")
	if err != nil {
		return nil, err
	}
	distanceM := 0
	if req.Dest != nil {
		route, err := s.maps.Route(ctx,
			LatLng{Lat: req.Pickup.Lat, Lng: req.Pickup.Lng},
			LatLng{Lat: req.Dest.Lat, Lng: req.Dest.Lng},
		)
		if err != nil {
			return nil, err
		}
		distanceM = max(route.DistanceM, 0) // a corrupt router answer must never discount the fare (L-d)
	}
	fare := towingFare(distanceM, cfg)
	return &TowingEstimate{DistanceM: distanceM, CalloutKobo: cfg.BaseFareKobo, FareKobo: fare}, nil
}

// towingPricing is the server-side price of a towing booking request. The
// escrowed/charged amount is `fare`.
type towingPricing struct {
	fare      int64
	distanceM int
	cfg       *PricingConfig
}

// towingFrozenPricing is the priced input set frozen at card-direct initiate
// and replayed at confirm: the route distance and the full pricing config row
// the quote used. Pricing from THIS (not a fresh routing call / config read)
// keeps a re-route or a config edit between charge and booking from producing
// a spurious amount mismatch (ADR-PR522-mobility-card-direct H8).
type towingFrozenPricing struct {
	DistanceM int           `json:"distanceM"`
	Config    PricingConfig `json:"config"`
}

// priceTowing prices a request from server config + the routing adapter only —
// no client-supplied amount can reach it. A request without a destination
// (roadside) never routes: distance 0 ⇒ callout only. Shared by the wallet
// path, the quotes and the card-direct booking.
func (s *Service) priceTowing(ctx context.Context, req TowingBookRequest) (*towingPricing, error) {
	cfg, err := s.loadPricingConfig(ctx, "default", "towing")
	if err != nil {
		return nil, err
	}
	distanceM := 0
	if req.Dest != nil {
		route, err := s.maps.Route(ctx,
			LatLng{Lat: req.Pickup.Lat, Lng: req.Pickup.Lng},
			LatLng{Lat: req.Dest.Lat, Lng: req.Dest.Lng},
		)
		if err != nil {
			return nil, err
		}
		distanceM = max(route.DistanceM, 0) // a corrupt router answer must never discount the fare (L-d)
	}
	return &towingPricing{fare: towingFare(distanceM, cfg), distanceM: distanceM, cfg: cfg}, nil
}

// towingPricingFromFrozen is the pure pricing step over a frozen snapshot. The
// config is copied, never aliased to the caller's snapshot.
func towingPricingFromFrozen(frozen *towingFrozenPricing) *towingPricing {
	cfg := frozen.Config
	return &towingPricing{fare: towingFare(frozen.DistanceM, &cfg), distanceM: frozen.DistanceM, cfg: &cfg}
}

// decodeTowingFrozen parses a frozen snapshot. Empty ⇒ (nil, nil) = live
// pricing; unreadable ⇒ error (never a silent re-price of a paid order).
func decodeTowingFrozen(raw json.RawMessage) (*towingFrozenPricing, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var f towingFrozenPricing
	if err := json.Unmarshal(raw, &f); err != nil {
		return nil, fmt.Errorf("transport: frozen towing pricing unreadable: %w", err)
	}
	return &f, nil
}

// towingServiceTypes mirrors the towing_jobs.service_type CHECK constraint.
// A value outside it would pass pricing and the charge and then fail the
// INSERT, so the card-direct paths refuse it BEFORE any money moves.
var towingServiceTypes = map[string]bool{
	"tow": true, "flatbed": true, "jumpstart": true, "tire_change": true,
	"fuel": true, "battery": true, "unlock": true, "mechanic": true,
}

// towingNeedsDestination: the two tow-truck services move the vehicle, so a
// destination is part of what is being bought. Roadside services stay put.
var towingNeedsDestination = map[string]bool{"tow": true, "flatbed": true}

func validCoord(p Place) bool {
	return p.Lat >= -90 && p.Lat <= 90 && p.Lng >= -180 && p.Lng <= 180 && !(p.Lat == 0 && p.Lng == 0)
}

// validateTowingBookRequest is the card-direct pre-flight: nothing is priced,
// escrowed or sent to Paystack for a request the booking cannot satisfy.
// (The wallet path is deliberately unchanged.)
func validateTowingBookRequest(req TowingBookRequest) error {
	st := req.ServiceType
	if st == "" {
		st = "tow"
	}
	if !towingServiceTypes[st] {
		return codedErr(http.StatusBadRequest, "invalid_input", "unsupported towing service_type")
	}
	if req.Pickup.Address == "" || !validCoord(req.Pickup) {
		return codedErr(http.StatusBadRequest, "invalid_input", "a valid pickup location is required")
	}
	if req.Dest != nil && !validCoord(*req.Dest) {
		return codedErr(http.StatusBadRequest, "invalid_input", "invalid destination")
	}
	if towingNeedsDestination[st] && req.Dest == nil {
		return codedErr(http.StatusBadRequest, "invalid_input", "a tow destination is required")
	}
	return nil
}

// ValidateTowingBookRequest exposes the card-direct pre-flight to the
// paystackcheckout adapter so a malformed request is refused (400) before the
// engine prices it or freezes an intent.
func ValidateTowingBookRequest(req TowingBookRequest) error { return validateTowingBookRequest(req) }

// BookTowing books + escrows a towing job from the user's WALLET (KYC-tier
// gated) and generates an operator PIN.
func (s *Service) BookTowing(ctx context.Context, userID string, req TowingBookRequest, idempotencyKey string) (map[string]any, error) {
	if idempotencyKey == "" {
		idempotencyKey = req.IdempotencyKey
	}
	if idempotencyKey == "" {
		return nil, codedErr(http.StatusBadRequest, "MISSING_IDEMPOTENCY_KEY", "idempotency key required")
	}
	if IsReservedIdempotencyKey(idempotencyKey) {
		return nil, codedErr(http.StatusBadRequest, "INVALID_IDEMPOTENCY_KEY", "this idempotency key format is reserved")
	}
	jobID, err := s.bookTowing(ctx, userID, req, idempotencyKey, false, 0, nil)
	if err != nil {
		return nil, err
	}
	return s.TowingDetail(ctx, jobID, userID)
}

// QuoteTowingBooking returns the EXACT amount (kobo) a card-direct towing
// booking will be charged. Pure read; never trusted as final:
// BookTowingPaystackFunded independently recomputes it.
func (s *Service) QuoteTowingBooking(ctx context.Context, req TowingBookRequest) (int64, error) {
	if err := validateTowingBookRequest(req); err != nil {
		return 0, err
	}
	p, err := s.priceTowing(ctx, req)
	if err != nil {
		return 0, err
	}
	return p.fare, nil
}

// QuoteTowingBookingFrozen is QuoteTowingBooking plus the frozen priced inputs
// (JSON) the card-direct engine stores in the intent and hands back to
// BookTowingPaystackFundedFrozen.
func (s *Service) QuoteTowingBookingFrozen(ctx context.Context, req TowingBookRequest) (int64, json.RawMessage, error) {
	if err := validateTowingBookRequest(req); err != nil {
		return 0, nil, err
	}
	p, err := s.priceTowing(ctx, req)
	if err != nil {
		return 0, nil, err
	}
	frozen, err := json.Marshal(towingFrozenPricing{DistanceM: p.distanceM, Config: *p.cfg})
	if err != nil {
		return 0, nil, fmt.Errorf("transport: freeze towing pricing: %w", err)
	}
	return p.fare, frozen, nil
}

// FindTowingByIdempotencyKey returns the job already booked under
// idempotencyKey for userID, if any (card-direct replay / ambiguous-failure
// resolution).
func (s *Service) FindTowingByIdempotencyKey(ctx context.Context, userID, idempotencyKey string) (string, bool, error) {
	var id string
	err := s.db.QueryRow(ctx, `SELECT id FROM towing_jobs WHERE idempotency_key=$1 AND user_id=$2`, idempotencyKey, userID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return id, true, nil
}

// BookTowingPaystackFunded books a towing job funded by an ALREADY-VERIFIED
// external Paystack charge of exactly verifiedAmountKobo — never a wallet
// debit, so the KYC-tier gate does not (and must not) run. See
// BookParcelPaystackFunded for the full contract; identical here. Must only
// ever be called from a server-initiated confirm flow.
func (s *Service) BookTowingPaystackFunded(ctx context.Context, userID string, req TowingBookRequest, idempotencyKey string, verifiedAmountKobo int64) (string, error) {
	return s.BookTowingPaystackFundedFrozen(ctx, userID, req, idempotencyKey, verifiedAmountKobo, nil)
}

// BookTowingPaystackFundedFrozen is BookTowingPaystackFunded priced from the
// frozen inputs captured at quote time (nil/empty ⇒ live pricing).
func (s *Service) BookTowingPaystackFundedFrozen(ctx context.Context, userID string, req TowingBookRequest, idempotencyKey string, verifiedAmountKobo int64, frozenPricing json.RawMessage) (string, error) {
	if idempotencyKey == "" {
		return "", codedErr(http.StatusBadRequest, "MISSING_IDEMPOTENCY_KEY", "idempotency key required")
	}
	return s.bookTowing(ctx, userID, req, idempotencyKey, true, verifiedAmountKobo, frozenPricing)
}

// externalTowingID is the job id of a card-direct booking, derived from the
// namespaced idempotency key so every retry of one charge targets ONE id (and
// one settlement reference "towing:<id>").
func externalTowingID(idempotencyKey string) string {
	return uuid.NewSHA1(externalTowingNamespace, []byte(idempotencyKey)).String()
}

// externalTowingNamespace is the fixed UUIDv5 namespace for externalTowingID.
// NEVER change it: it is what makes a retry after a crash land on the same id.
var externalTowingNamespace = uuid.MustParse("b7e24c1a-58d3-5f06-8c19-3a6d90e4b2f7")

// bookTowing is the shared body of BookTowing (wallet) and
// BookTowingPaystackFunded (card-direct); `external`/`verifiedAmountKobo` are
// never client-settable. Returns the job id.
func (s *Service) bookTowing(ctx context.Context, userID string, req TowingBookRequest, idempotencyKey string, external bool, verifiedAmountKobo int64, frozenPricing json.RawMessage) (string, error) {
	if idempotencyKey == "" {
		return "", codedErr(http.StatusBadRequest, "MISSING_IDEMPOTENCY_KEY", "idempotency key required")
	}
	// H-A: refuse a request the INSERT cannot satisfy BEFORE any money moves, on
	// BOTH rails. The wallet path used to skip this, so wheel_lift / heavy_duty /
	// roadside debited the wallet and THEN violated the towing_jobs.service_type
	// CHECK with the escrow orphaned.
	if err := validateTowingBookRequest(req); err != nil {
		return "", err
	}
	if external {
		if verifiedAmountKobo <= 0 {
			return "", codedErr(http.StatusConflict, CodeAmountMismatch, "verified payment amount is not a positive charge")
		}
		// Replay: a repeat of an already-booked card-funded job returns it
		// untouched — no second escrow, no second row.
		if id, found, err := s.FindTowingByIdempotencyKey(ctx, userID, idempotencyKey); err != nil {
			return "", err
		} else if found {
			return id, nil
		}
	}
	var pr *towingPricing
	if external {
		frozen, ferr := decodeTowingFrozen(frozenPricing)
		if ferr != nil {
			return "", ferr
		}
		if frozen != nil {
			// Price from the inputs frozen at quote time, NOT a fresh routing
			// call: the customer was charged for exactly that number.
			pr = towingPricingFromFrozen(frozen)
		}
	}
	if pr == nil {
		var err error
		if pr, err = s.priceTowing(ctx, req); err != nil {
			return "", err
		}
	}
	fare := pr.fare
	serviceType := req.ServiceType
	if serviceType == "" {
		serviceType = "tow"
	}

	if external {
		// Cross-check BEFORE anything writes: pricing config can move between
		// the quote that set the charge and this call; never trust the quote,
		// only what was actually collected.
		if fare != verifiedAmountKobo {
			return "", codedErr(http.StatusConflict, CodeAmountMismatch, "verified payment amount no longer matches the towing fare")
		}
	} else if err := s.enforceTierLimit(ctx, userID, fare); err != nil {
		// Fail-closed tier/spending-limit gate BEFORE any wallet escrow (same
		// contract as RequestRide): a Tier0/over-limit user cannot move money.
		// Skipped ONLY for card-direct: no wallet debit exists there.
		return "", err
	}

	jobID := uuid.New().String()
	if external {
		// Deterministic per charge: every retry escrows under ONE reference
		// ("towing:<id>") and targets ONE job row.
		jobID = externalTowingID(idempotencyKey)
	}
	ref := "towing:" + jobID
	var sett *settlement.Settlement
	var err error
	if external {
		sett, err = s.settlement.EscrowExternal(ctx, userID, ref, idempotencyKey, "transport", fare)
	} else {
		sett, err = s.escrowCheckout(ctx, userID, ref, idempotencyKey, fare)
	}
	if err != nil {
		return "", fmt.Errorf("transport: escrow towing fare: %w", err)
	}
	if !external {
		// Escrow also returns the EXISTING row on a replay. A row that was
		// already reversed (an earlier attempt's INSERT failed and was refunded
		// to the wallet) or that holds a different amount must never back a new
		// job — the retry would otherwise book a tow for money that went back.
		if sett.Status != settlement.StatusEscrowed || sett.TotalKobo != fare {
			return "", fmt.Errorf("transport: escrow replay for %s is not a live escrow of this fare (status=%s total=%d fare=%d) — refusing to book; retry with a new idempotency key",
				idempotencyKey, sett.Status, sett.TotalKobo, fare)
		}
	}
	if external {
		// EscrowExternal returns the EXISTING row on a replay. Only a live
		// (escrowed) external escrow held for THIS user may back a new job; a
		// refunded / settled / foreign / wallet-funded row would deliver a tow
		// for money that already went back (or never was this charge).
		if sett.Status != settlement.StatusEscrowed || sett.PayerID != userID || sett.FundingSource != "external" {
			return "", fmt.Errorf("transport: external escrow replay for %s is not a live escrow of this user's charge (status=%s payer_match=%t funding=%s) — refusing to book",
				idempotencyKey, sett.Status, sett.PayerID == userID, sett.FundingSource)
		}
		if sett.TotalKobo != fare {
			return "", fmt.Errorf("transport: external escrow replay amount %d != fare %d", sett.TotalKobo, fare)
		}
	}
	pin := generatePin()
	var destAddr any
	if req.Dest != nil {
		destAddr = req.Dest.Address
	}
	const q = `
		INSERT INTO towing_jobs
			(id, user_id, service_type, vehicle_type, issue_type, pickup_address, pickup_lat, pickup_lng,
			 dest_address, fare_kobo, status, pin, settlement_id, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'requested',$11,$12,$13)`
	if _, err := s.db.Exec(ctx, q,
		jobID, userID, serviceType, dbutil.NullStr(req.VehicleType), dbutil.NullStr(req.IssueType),
		req.Pickup.Address, req.Pickup.Lat, req.Pickup.Lng, destAddr,
		fare, pin, sett.ID, idempotencyKey,
	); err != nil {
		// The booking ctx may be the very thing that failed (deadline / cancel),
		// so the compensation runs on a detached, bounded one. BOTH rails: a
		// failed INSERT after the escrow posted must never leave the money
		// orphaned (H-A) — card money is reversed ledger-side for the engine's
		// gateway refund, wallet money goes straight back to the wallet. Either
		// way ONLY when Find proves no job owns the escrow (H5).
		cctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
		defer cancel()
		id, _, cerr := resolveExternalInsertFailure(
			func() (string, bool, error) { return s.FindTowingByIdempotencyKey(cctx, userID, idempotencyKey) },
			func() error {
				if external {
					return s.settlement.RefundExternal(cctx, sett.ID, "towing_insert_failed")
				}
				return s.settlement.Refund(cctx, sett.ID, "towing_insert_failed")
			},
		)
		if cerr != nil {
			log.Printf("[transport] escrow settlement=%s (external=%t) after towing insert failure (%v) — %v — needs manual reconciliation", sett.ID, external, err, cerr)
			return "", fmt.Errorf("transport: insert towing job: %w (compensation: %v)", err, cerr)
		}
		if id != "" { // a concurrent booking of the same key owns the escrow
			return id, nil
		}
		return "", fmt.Errorf("transport: insert towing job: %w", err)
	}
	meta := map[string]any{"fare_kobo": fare, "service_type": serviceType, "settlement_id": sett.ID}
	if external {
		meta["funding"] = "external"
		meta["verified_amount_kobo"] = verifiedAmountKobo
	}
	s.recordModeEvent(ctx, userID, "towing.requested", "towing_job", jobID, "", "requested", meta)
	return jobID, nil
}

// TowingDetail returns a towing job; user sees the PIN, operator does not.
func (s *Service) TowingDetail(ctx context.Context, id, callerID string) (map[string]any, error) {
	const q = `
		SELECT id, user_id, operator_id, service_type, vehicle_type, issue_type,
		       pickup_address, dest_address, fare_kobo, status, pin, created_at
		FROM towing_jobs WHERE id=$1`
	var (
		jid, uid, serviceType, pickup, status string
		operatorID, vtype, issue, dest, pin   *string
		fare                                  int64
		createdAt                             time.Time
	)
	if err := s.db.QueryRow(ctx, q, id).Scan(
		&jid, &uid, &operatorID, &serviceType, &vtype, &issue,
		&pickup, &dest, &fare, &status, &pin, &createdAt,
	); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "towing job not found")
	}
	isUser := callerID == uid
	if !isUser {
		if operatorID == nil {
			return nil, codedErr(http.StatusForbidden, CodeForbidden, "not permitted")
		}
		var ownerUser string
		_ = s.db.QueryRow(ctx, `SELECT user_id FROM drivers WHERE id=$1`, *operatorID).Scan(&ownerUser)
		if ownerUser != callerID {
			return nil, codedErr(http.StatusForbidden, CodeForbidden, "not permitted")
		}
	}
	out := map[string]any{
		"id": jid, "userId": uid, "operatorId": operatorID, "serviceType": serviceType,
		"vehicleType": vtype, "issueType": issue, "pickupAddress": pickup, "destAddress": dest,
		"fareKobo": fare, "status": status, "createdAt": createdAt,
	}
	if isUser {
		out["pin"] = pin
	}
	return out, nil
}

// ListTowing returns the user's towing jobs.
func (s *Service) ListTowing(ctx context.Context, userID string) ([]map[string]any, error) {
	const q = `
		SELECT id, service_type, pickup_address, dest_address, fare_kobo, status, created_at
		FROM towing_jobs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, serviceType, pickup, status string
		var dest *string
		var fare int64
		var createdAt time.Time
		if err := rows.Scan(&id, &serviceType, &pickup, &dest, &fare, &status, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "serviceType": serviceType, "pickupAddress": pickup, "destAddress": dest,
			"fareKobo": fare, "status": status, "createdAt": createdAt,
		})
	}
	return out, nil
}

// CancelTowing refunds + cancels a job (user only). See CancelTowingWithRefund
// for the refund_status the HTTP endpoint reports.
func (s *Service) CancelTowing(ctx context.Context, id, userID, reason string) error {
	_, err := s.CancelTowingWithRefund(ctx, id, userID, reason)
	return err
}

// CancelTowingWithRefund cancels a job and reports whether the customer's money
// is actually back (refund_status). A card-funded job whose domain has no
// refunder wired is refused BEFORE the status flips (503 refund_unavailable).
func (s *Service) CancelTowingWithRefund(ctx context.Context, id, userID, reason string) (*CancelResult, error) {
	reason = capCancelReason(reason)
	var t towingRow
	if err := s.loadTowing(ctx, id, &t); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "towing job not found")
	}
	if t.UserID != userID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not your job")
	}
	if t.Status == "cancelled" {
		// Idempotent re-cancel. Only meaningful for a card-funded job whose
		// first refund attempt failed after the status flip: finish the refund
		// (escrowed OR disputed). Anything else is a plain 409.
		if res, handled, err := s.finishCancelledRefund(ctx, RefundDomainTowing, id, t.SettlementID, "towing_cancelled_retry:"+reason); handled {
			return res, err
		}
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "cannot cancel from status "+t.Status)
	}
	if !canTransitionTowing(t.Status, "cancelled") {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "cannot cancel from status "+t.Status)
	}
	external, err := s.requireRefundRail(ctx, RefundDomainTowing, t.SettlementID)
	if err != nil {
		return nil, err
	}
	if err := s.towingSetStatus(ctx, id, t.Status, "cancelled"); err != nil {
		return nil, err
	}
	res := &CancelResult{RefundStatus: RefundStatusNone}
	if t.SettlementID != nil {
		// One refund choke point: card-funded (EscrowExternal) money goes back
		// through the gateway, wallet-funded money back to the wallet — chosen
		// from settlements.funding_source, never guessed. A failure is logged and
		// reported as refund_status, not returned: the job IS cancelled; re-POSTing
		// cancel (or the reconciler sweep) finishes a card refund that failed here.
		rerr := s.refundSettlement(ctx, RefundDomainTowing, id, *t.SettlementID, "towing_cancelled:"+reason)
		if rerr != nil {
			log.Printf("[transport] towing %s cancelled but refund of settlement=%s failed: %v", id, *t.SettlementID, rerr)
		}
		res.RefundStatus = refundStatusFor(rerr, external)
	}
	if t.OperatorID != nil {
		_, _ = s.db.Exec(ctx, `UPDATE drivers SET status='online', cancelled_trips=cancelled_trips+1, updated_at=NOW() WHERE id=$1`, *t.OperatorID)
	}
	s.recordModeEvent(ctx, userID, "towing.cancelled", "towing_job", id, t.Status, "cancelled", map[string]any{"reason": reason, "refund_status": res.RefundStatus})
	return res, nil
}

// towingSetStatus performs a guarded status update.
func (s *Service) towingSetStatus(ctx context.Context, id, from, to string) error {
	if !canTransitionTowing(from, to) {
		return codedErr(http.StatusConflict, CodeInvalidState, fmt.Sprintf("illegal towing transition %s → %s", from, to))
	}
	tag, err := s.db.Exec(ctx, `UPDATE towing_jobs SET status=$1, updated_at=NOW() WHERE id=$2 AND status=$3`, to, id, from)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return codedErr(http.StatusConflict, CodeInvalidState, "towing status changed concurrently")
	}
	return nil
}

// OpenTowingRequests returns unassigned, requested jobs for operators.
func (s *Service) OpenTowingRequests(ctx context.Context, driverUserID string) ([]map[string]any, error) {
	if _, err := s.driverGate(ctx, driverUserID); err != nil {
		return nil, err
	}
	const q = `
		SELECT id, service_type, vehicle_type, issue_type, pickup_address, fare_kobo, created_at
		FROM towing_jobs WHERE operator_id IS NULL AND status='requested' ORDER BY created_at DESC LIMIT 50`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, serviceType, pickup string
		var vtype, issue *string
		var fare int64
		var createdAt time.Time
		if err := rows.Scan(&id, &serviceType, &vtype, &issue, &pickup, &fare, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "serviceType": serviceType, "vehicleType": vtype, "issueType": issue,
			"pickupAddress": pickup, "fareKobo": fare, "createdAt": createdAt,
		})
	}
	return out, nil
}

// AcceptTowing assigns an approved operator → operator_accepted.
func (s *Service) AcceptTowing(ctx context.Context, id, driverUserID string) (map[string]any, error) {
	operatorID, err := s.driverGate(ctx, driverUserID)
	if err != nil {
		return nil, err
	}
	var t towingRow
	if err := s.loadTowing(ctx, id, &t); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "towing job not found")
	}
	if t.Status != "requested" {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "job not open for acceptance")
	}
	tag, err := s.db.Exec(ctx,
		`UPDATE towing_jobs SET operator_id=$1, status='operator_accepted', updated_at=NOW() WHERE id=$2 AND operator_id IS NULL AND status='requested'`,
		operatorID, id)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "job already taken")
	}
	_, _ = s.db.Exec(ctx, `UPDATE drivers SET status='on_trip', updated_at=NOW() WHERE id=$1`, operatorID)
	s.recordModeEvent(ctx, driverUserID, "towing.operator_accepted", "towing_job", id, "requested", "operator_accepted",
		map[string]any{"operator_id": operatorID})
	return s.TowingDetail(ctx, id, driverUserID)
}

// TowingEnRoute: operator_accepted → operator_en_route.
func (s *Service) TowingEnRoute(ctx context.Context, id, driverUserID string) error {
	return s.towingOperatorTransition(ctx, id, driverUserID, "operator_accepted", "operator_en_route", "towing.operator_en_route")
}

// VerifyTowingPin: operator_en_route → pin_verified (PIN must match).
func (s *Service) VerifyTowingPin(ctx context.Context, id, driverUserID, pin string) error {
	t, err := s.operatorOwnedTowing(ctx, id, driverUserID)
	if err != nil {
		return err
	}
	if t.Status != "operator_en_route" {
		return codedErr(http.StatusConflict, CodeInvalidState, "job not awaiting PIN")
	}
	if t.Pin == nil || *t.Pin != pin {
		return codedErr(http.StatusUnprocessableEntity, CodePinMismatch, "PIN does not match")
	}
	if err := s.towingSetStatus(ctx, id, "operator_en_route", "pin_verified"); err != nil {
		return err
	}
	s.recordModeEvent(ctx, driverUserID, "towing.pin_verified", "towing_job", id, "operator_en_route", "pin_verified", nil)
	return nil
}

// StartTowing: pin_verified → in_progress.
func (s *Service) StartTowing(ctx context.Context, id, driverUserID string) error {
	return s.towingOperatorTransition(ctx, id, driverUserID, "pin_verified", "in_progress", "towing.in_progress")
}

// CompleteTowing: in_progress → completed + settle operator.
func (s *Service) CompleteTowing(ctx context.Context, id, driverUserID string) error {
	t, err := s.operatorOwnedTowing(ctx, id, driverUserID)
	if err != nil {
		return err
	}
	if t.Status != "in_progress" {
		return codedErr(http.StatusConflict, CodeInvalidState, "job not in progress")
	}
	if err := s.towingSetStatus(ctx, id, "in_progress", "completed"); err != nil {
		return err
	}
	if t.SettlementID != nil && t.OperatorID != nil {
		if err := s.settleModeProvider(ctx, *t.SettlementID, *t.OperatorID, 0); err != nil {
			return fmt.Errorf("transport: settle towing: %w", err)
		}
	}
	if t.OperatorID != nil {
		_, _ = s.db.Exec(ctx, `UPDATE drivers SET status='online', completed_trips=completed_trips+1, updated_at=NOW() WHERE id=$1`, *t.OperatorID)
	}
	s.recordModeEvent(ctx, driverUserID, "towing.completed", "towing_job", id, "in_progress", "completed", nil)
	return nil
}

// towingOperatorTransition is a guarded operator-initiated transition with authz.
func (s *Service) towingOperatorTransition(ctx context.Context, id, driverUserID, from, to, action string) error {
	t, err := s.operatorOwnedTowing(ctx, id, driverUserID)
	if err != nil {
		return err
	}
	if t.Status != from {
		return codedErr(http.StatusConflict, CodeInvalidState, "job not in expected status "+from)
	}
	if err := s.towingSetStatus(ctx, id, from, to); err != nil {
		return err
	}
	s.recordModeEvent(ctx, driverUserID, action, "towing_job", id, from, to, nil)
	return nil
}

// operatorOwnedTowing loads a job and asserts the caller is the assigned operator.
func (s *Service) operatorOwnedTowing(ctx context.Context, id, driverUserID string) (*towingRow, error) {
	driverID, err := s.driverGate(ctx, driverUserID)
	if err != nil {
		return nil, err
	}
	var t towingRow
	if err := s.loadTowing(ctx, id, &t); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "towing job not found")
	}
	if t.OperatorID == nil || *t.OperatorID != driverID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not the assigned operator")
	}
	return &t, nil
}

// TowingEstimate returns callout + distance fare.
func (h *Handler) TowingEstimate(c *gin.Context) {
	var req TowingEstimateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	est, err := h.svc.EstimateTowing(c.Request.Context(), req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, est)
}

// TowingBook books + escrows a towing job.
func (h *Handler) TowingBook(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req TowingBookRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	j, err := h.svc.BookTowing(c.Request.Context(), userID, req, ginutil.IdempotencyKey(c))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, j)
}

// TowingGet returns a job detail.
func (h *Handler) TowingGet(c *gin.Context) {
	userID := ginutil.UserID(c)
	j, err := h.svc.TowingDetail(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, j)
}

// TowingList returns the user's jobs.
func (h *Handler) TowingList(c *gin.Context) {
	userID := ginutil.UserID(c)
	js, err := h.svc.ListTowing(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"jobs": js})
}

// TowingCancel refunds + cancels a job.
func (h *Handler) TowingCancel(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req CancelRequest
	_ = c.ShouldBindJSON(&req)
	res, err := h.svc.CancelTowingWithRefund(c.Request.Context(), c.Param("id"), userID, req.Reason)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "cancelled", "refund_status": res.RefundStatus})
}

// TowingRequests returns open operator requests.
func (h *Handler) TowingRequests(c *gin.Context) {
	userID := ginutil.UserID(c)
	reqs, err := h.svc.OpenTowingRequests(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"requests": reqs})
}

// TowingAccept assigns the operator.
func (h *Handler) TowingAccept(c *gin.Context) {
	userID := ginutil.UserID(c)
	j, err := h.svc.AcceptTowing(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, j)
}

// TowingEnRoute marks the operator en route.
func (h *Handler) TowingEnRoute(c *gin.Context) {
	userID := ginutil.UserID(c)
	if err := h.svc.TowingEnRoute(c.Request.Context(), c.Param("id"), userID); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "operator_en_route"})
}

// TowingVerifyPin verifies the operator PIN.
func (h *Handler) TowingVerifyPin(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req VerifyPinRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if err := h.svc.VerifyTowingPin(c.Request.Context(), c.Param("id"), userID, req.Pin); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "pin_verified"})
}

// TowingStart starts the job.
func (h *Handler) TowingStart(c *gin.Context) {
	userID := ginutil.UserID(c)
	if err := h.svc.StartTowing(c.Request.Context(), c.Param("id"), userID); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "in_progress"})
}

// TowingComplete completes + settles the job.
func (h *Handler) TowingComplete(c *gin.Context) {
	userID := ginutil.UserID(c)
	if err := h.svc.CompleteTowing(c.Request.Context(), c.Param("id"), userID); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "completed"})
}
