package transport

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
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
//   requested → quoted → confirmed → active → (extended) → completed
// Quote returns fare + deposit from the car_hire pricing config.
// Book escrows fare + deposit (two settlements under one reference prefix).
// Extend escrows the delta. Complete settles the driver split (fare + extends)
// and refunds the deposit. Cancel refunds everything.

var carHireTransitions = fsm.Table[string]{
	"requested": {"quoted": true, "confirmed": true, "cancelled": true},
	"quoted":    {"confirmed": true, "cancelled": true},
	"confirmed": {"active": true, "cancelled": true},
	"active":    {"extended": true, "completed": true, "cancelled": true},
	"extended":  {"extended": true, "completed": true, "cancelled": true},
}

func canTransitionCarHire(from, to string) bool {
	if from == to {
		// Allow extended → extended (repeat extensions).
		return from == "extended" && to == "extended"
	}
	return carHireTransitions.Can(from, to)
}

// CarHireQuoteRequest is POST /mobility/car-hire/quote.
type CarHireQuoteRequest struct {
	HireType      string `json:"hire_type"`
	VehicleClass  string `json:"vehicle_class"`
	StartAt       string `json:"start_at" binding:"required"` // RFC3339
	DurationHours int    `json:"duration_hours" binding:"required,min=1"`
	Chauffeur     bool   `json:"chauffeur"`
	PickupAddress string `json:"pickup_address"`
}

// CarHireBookRequest is POST /mobility/car-hire/book.
type CarHireBookRequest struct {
	HireType       string `json:"hire_type"`
	VehicleClass   string `json:"vehicle_class"`
	StartAt        string `json:"start_at" binding:"required"`
	DurationHours  int    `json:"duration_hours" binding:"required,min=1"`
	Chauffeur      bool   `json:"chauffeur"`
	PickupAddress  string `json:"pickup_address"`
	SpecialRequest string `json:"special_request"`
	IdempotencyKey string `json:"idempotency_key"`
}

// CarHireExtendRequest is POST /mobility/car-hire/:id/extend.
type CarHireExtendRequest struct {
	ExtraHours     int    `json:"extra_hours" binding:"required,min=1"`
	IdempotencyKey string `json:"idempotency_key"`
}

// CarHireQuote is the quote response.
type CarHireQuote struct {
	FareKobo    int64 `json:"fareKobo"`
	DepositKobo int64 `json:"depositKobo"`
	TotalKobo   int64 `json:"totalKobo"`
}

// carHireRow is the internal projection of a car-hire booking.
type carHireRow struct {
	ID            string
	UserID        string
	DriverID      *string
	Status        string
	FareKobo      int64
	DepositKobo   int64
	DurationHours int
	SettlementID  *string
	StartAt       time.Time
}

func (s *Service) loadCarHire(ctx context.Context, id string, b *carHireRow) error {
	const q = `SELECT id, user_id, driver_id, status, fare_kobo, deposit_kobo, duration_hours, settlement_id, start_at
	           FROM car_hire_bookings WHERE id=$1`
	return s.db.QueryRow(ctx, q, id).Scan(
		&b.ID, &b.UserID, &b.DriverID, &b.Status, &b.FareKobo, &b.DepositKobo, &b.DurationHours, &b.SettlementID, &b.StartAt,
	)
}

// carHireFare computes fare (base + per_hour) and deposit (one period base).
// per_km_kobo is reused as the per-hour rate for the car_hire service_type.
func carHireFare(durationHours int, cfg *PricingConfig) (fare, deposit int64) {
	fare = max(cfg.BaseFareKobo+int64(durationHours)*cfg.PerKMKobo, cfg.MinFareKobo)
	// Deposit = one base period (refundable security hold).
	deposit = cfg.BaseFareKobo
	return fare, deposit
}

// carHireFareChecked is carHireFare for the CARD-DIRECT paths, where the result
// becomes a charge: a negative config value or an overflowing product is an
// error, never a (negative / wrapped) charge.
func carHireFareChecked(durationHours int, cfg *PricingConfig) (fare, deposit int64, err error) {
	const maxI = int64(^uint64(0) >> 1)
	if durationHours < 1 || cfg.BaseFareKobo < 0 || cfg.PerKMKobo < 0 || cfg.MinFareKobo < 0 {
		return 0, 0, codedErr(http.StatusUnprocessableEntity, "INVALID_PRICING", "car-hire pricing is not usable")
	}
	if cfg.PerKMKobo > 0 && int64(durationHours) > (maxI-cfg.BaseFareKobo)/cfg.PerKMKobo {
		return 0, 0, codedErr(http.StatusUnprocessableEntity, "INVALID_PRICING", "car-hire fare overflows")
	}
	fare, deposit = carHireFare(durationHours, cfg)
	return fare, deposit, nil
}

// carHireTotals validates the two legs of one charge and returns the total:
// the fare must be positive, the deposit non-negative, and their sum must not
// overflow. Everything is integer kobo — there is no rounding anywhere.
func carHireTotals(fare, deposit int64) (int64, int64, error) {
	const maxI = int64(^uint64(0) >> 1)
	if fare <= 0 || deposit < 0 {
		return 0, 0, codedErr(http.StatusUnprocessableEntity, "INVALID_PRICING", "car-hire fare must be positive and the deposit non-negative")
	}
	if fare > maxI-deposit {
		return 0, 0, codedErr(http.StatusUnprocessableEntity, "INVALID_PRICING", "car-hire total overflows")
	}
	return fare, fare + deposit, nil
}

// maxCarHireHours bounds a card-direct hire (30 days): the charge is real money.
const maxCarHireHours = 720

// carHireTypes mirrors the car_hire_bookings.hire_type CHECK constraint. A
// value outside it would pass pricing and the charge and then fail the INSERT.
var carHireTypes = map[string]bool{"hourly": true, "daily": true, "airport": true, "event": true, "executive": true}

// validateCarHireBookRequest is the pre-flight: nothing is priced, escrowed or
// sent to Paystack for a request the booking cannot satisfy.
//
//	strict=true  — quote time on the card rail: also bounds start_at (not more
//	               than a day ago — a "today" pick is midnight UTC — nor more
//	               than a year ahead), duration and the free-text lengths.
//	strict=false — hire_type + start_at parse only. Used at confirm time and on
//	               the wallet rail: a CHARGED booking must never be refused over
//	               its date, and the wallet rail keeps its historical bounds.
func validateCarHireBookRequest(req CarHireBookRequest, strict bool, now time.Time) error {
	hireType := req.HireType
	if hireType == "" {
		hireType = "daily"
	}
	if !carHireTypes[hireType] {
		return codedErr(http.StatusBadRequest, "invalid_input", "unsupported hire_type")
	}
	startAt, err := time.Parse(time.RFC3339, req.StartAt)
	if err != nil {
		return codedErr(http.StatusBadRequest, "INVALID_TIME", "start_at must be RFC3339")
	}
	if !strict {
		return nil
	}
	if startAt.Before(now.Add(-24*time.Hour)) || startAt.After(now.Add(366*24*time.Hour)) {
		return codedErr(http.StatusBadRequest, "invalid_input", "start_at must be within the next year")
	}
	if req.DurationHours < 1 || req.DurationHours > maxCarHireHours {
		return codedErr(http.StatusBadRequest, "invalid_input", fmt.Sprintf("duration_hours must be between 1 and %d", maxCarHireHours))
	}
	if len(req.VehicleClass) > 40 || len(req.PickupAddress) > 500 || len(req.SpecialRequest) > 1000 {
		return codedErr(http.StatusBadRequest, "invalid_input", "a field is too long")
	}
	return nil
}

// ValidateCarHireBookRequest exposes the card-direct (strict) pre-flight to the
// paystackcheckout adapter so a malformed request is refused (400) before the
// engine prices it or freezes an intent.
func ValidateCarHireBookRequest(req CarHireBookRequest) error {
	return validateCarHireBookRequest(req, true, time.Now())
}

// carHireFrozenPricing is the priced input set frozen at card-direct initiate
// and replayed at confirm: the pricing config row and the legs it produced.
// Booking from THIS (not a fresh config read) keeps a config edit between
// charge and confirm from turning a correctly-charged hire into a mismatch
// (ADR-PR522-mobility-card-direct H8).
type carHireFrozenPricing struct {
	DurationHours int           `json:"durationHours"`
	FareKobo      int64         `json:"fareKobo"`
	DepositKobo   int64         `json:"depositKobo"`
	Config        PricingConfig `json:"config"`
}

// QuoteCarHire returns the fare + deposit for a hire.
func (s *Service) QuoteCarHire(ctx context.Context, req CarHireQuoteRequest) (*CarHireQuote, error) {
	cfg, err := s.loadPricingConfig(ctx, "default", "car_hire")
	if err != nil {
		return nil, err
	}
	fare, deposit := carHireFare(req.DurationHours, cfg)
	return &CarHireQuote{FareKobo: fare, DepositKobo: deposit, TotalKobo: fare + deposit}, nil
}

// QuoteCarHireBookingFrozen returns the EXACT amount (kobo) a card-direct hire
// will be charged — fare + deposit as ONE charge — plus the frozen priced inputs
// the engine stores in the intent and hands back to
// BookCarHirePaystackFundedFrozen. Pure read; never trusted as final.
func (s *Service) QuoteCarHireBookingFrozen(ctx context.Context, req CarHireBookRequest) (int64, json.RawMessage, error) {
	if err := validateCarHireBookRequest(req, true, time.Now()); err != nil {
		return 0, nil, err
	}
	cfg, err := s.loadPricingConfig(ctx, "default", "car_hire")
	if err != nil {
		return 0, nil, err
	}
	fare, deposit, err := carHireFareChecked(req.DurationHours, cfg)
	if err != nil {
		return 0, nil, err
	}
	_, total, err := carHireTotals(fare, deposit)
	if err != nil {
		return 0, nil, err
	}
	frozen, err := json.Marshal(carHireFrozenPricing{DurationHours: req.DurationHours, FareKobo: fare, DepositKobo: deposit, Config: *cfg})
	if err != nil {
		return 0, nil, fmt.Errorf("transport: freeze car-hire pricing: %w", err)
	}
	return total, frozen, nil
}

// FindCarHireByIdempotencyKey returns the booking already made under
// idempotencyKey for userID, if any (card-direct replay / ambiguous-failure
// resolution). Scoped to the payer.
func (s *Service) FindCarHireByIdempotencyKey(ctx context.Context, userID, idempotencyKey string) (string, bool, error) {
	var id string
	err := s.db.QueryRow(ctx, `SELECT id::text FROM car_hire_bookings WHERE idempotency_key=$1 AND user_id=$2`, idempotencyKey, userID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return id, true, nil
}

// externalCarHireNamespace is the fixed UUIDv5 namespace for externalCarHireID.
// NEVER change it: it is what makes a retry after a crash land on the same id.
var externalCarHireNamespace = uuid.MustParse("5c9d2e71-3a48-5b6f-9e0d-7f14c2a8b363")

// externalCarHireID is the booking id of a card-direct hire, derived from the
// namespaced idempotency key so every retry of one charge targets ONE id and
// therefore ONE pair of settlement references ("carhire:<id>", "...:deposit").
func externalCarHireID(idempotencyKey string) string {
	return uuid.NewSHA1(externalCarHireNamespace, []byte(idempotencyKey)).String()
}

// BookCarHire escrows fare + deposit FROM THE WALLET and creates a confirmed
// booking (KYC-tier gated). The card rail is BookCarHirePaystackFundedFrozen.
func (s *Service) BookCarHire(ctx context.Context, userID string, req CarHireBookRequest, idempotencyKey string) (map[string]any, error) {
	if idempotencyKey == "" {
		idempotencyKey = req.IdempotencyKey
	}
	if idempotencyKey == "" {
		return nil, codedErr(http.StatusBadRequest, "MISSING_IDEMPOTENCY_KEY", "idempotency key required")
	}
	if IsReservedIdempotencyKey(idempotencyKey) {
		return nil, codedErr(http.StatusBadRequest, "INVALID_IDEMPOTENCY_KEY", "this idempotency key format is reserved")
	}
	id, err := s.bookCarHire(ctx, userID, req, idempotencyKey, false, 0, nil)
	if err != nil {
		return nil, err
	}
	return s.CarHireDetail(ctx, id, userID)
}

// BookCarHirePaystackFundedFrozen books a hire funded by an ALREADY-VERIFIED
// external Paystack charge of exactly verifiedAmountKobo (= fare + deposit),
// priced from the frozen inputs captured at quote time. Never a wallet debit,
// so the KYC-tier gate does not (and must not) run. Escrows TWO external
// settlements — "<key>:fare" and "<key>:deposit" — from the one charge. Must
// only ever be called from a server-initiated confirm flow.
func (s *Service) BookCarHirePaystackFundedFrozen(ctx context.Context, userID string, req CarHireBookRequest, idempotencyKey string, verifiedAmountKobo int64, frozenPricing json.RawMessage) (string, error) {
	if idempotencyKey == "" {
		return "", codedErr(http.StatusBadRequest, "MISSING_IDEMPOTENCY_KEY", "idempotency key required")
	}
	return s.bookCarHire(ctx, userID, req, idempotencyKey, true, verifiedAmountKobo, frozenPricing)
}

// checkLiveExternalEscrow: EscrowExternal returns the EXISTING row on a replay.
// Only a live (escrowed) external escrow held for THIS payer, of exactly the
// expected amount, may back a booking (H2) — a refunded / settled / foreign /
// wallet-funded row would deliver a hire for money that already went back.
func checkLiveExternalEscrow(sett *settlement.Settlement, userID, leg string, want int64) error {
	if sett.Status != settlement.StatusEscrowed || sett.PayerID != userID || sett.FundingSource != "external" {
		return fmt.Errorf("transport: external %s escrow replay is not a live escrow of this user's charge (status=%s payer_match=%t funding=%s) — refusing to book",
			leg, sett.Status, sett.PayerID == userID, sett.FundingSource)
	}
	if sett.TotalKobo != want {
		return fmt.Errorf("transport: external %s escrow replay amount %d != %d", leg, sett.TotalKobo, want)
	}
	return nil
}

// bookCarHire is the shared body of BookCarHire (wallet) and
// BookCarHirePaystackFundedFrozen (card-direct); `external`/`verifiedAmountKobo`
// are never client-settable. Returns the booking id.
func (s *Service) bookCarHire(ctx context.Context, userID string, req CarHireBookRequest, idempotencyKey string, external bool, verifiedAmountKobo int64, frozenPricing json.RawMessage) (string, error) {
	if idempotencyKey == "" {
		return "", codedErr(http.StatusBadRequest, "MISSING_IDEMPOTENCY_KEY", "idempotency key required")
	}
	// Strictness: the card rail only needs the structural check here (quote already
	// bounded it; a charged booking must never be refused over its date). The
	// wallet rail gets the hire_type CHECK mirror too — before this, a bad
	// hire_type debited the wallet and THEN failed the INSERT.
	if err := validateCarHireBookRequest(req, false, time.Now()); err != nil {
		return "", err
	}
	startAt, _ := time.Parse(time.RFC3339, req.StartAt) // validated above
	if external {
		if verifiedAmountKobo <= 0 {
			return "", codedErr(http.StatusConflict, CodeAmountMismatch, "verified payment amount is not a positive charge")
		}
		// Replay: a repeat of an already-booked card-funded hire returns it
		// untouched — no second escrow, no second row.
		if id, found, err := s.FindCarHireByIdempotencyKey(ctx, userID, idempotencyKey); err != nil {
			return "", err
		} else if found {
			return id, nil
		}
	}

	var fare, deposit int64
	if external && len(frozenPricing) > 0 {
		var f carHireFrozenPricing
		if err := json.Unmarshal(frozenPricing, &f); err != nil {
			return "", fmt.Errorf("transport: frozen car-hire pricing unreadable: %w", err)
		}
		cfg := f.Config
		cf, cd, err := carHireFareChecked(req.DurationHours, &cfg)
		if err != nil {
			return "", err
		}
		// The snapshot must be self-consistent: its stated legs are what its own
		// config yields for THIS request's duration. Never trust a half-edited row.
		if f.DurationHours != req.DurationHours || cf != f.FareKobo || cd != f.DepositKobo {
			return "", fmt.Errorf("transport: frozen car-hire pricing is inconsistent with its config/request — refusing to book")
		}
		fare, deposit = cf, cd
	} else {
		cfg, err := s.loadPricingConfig(ctx, "default", "car_hire")
		if err != nil {
			return "", err
		}
		if external {
			if fare, deposit, err = carHireFareChecked(req.DurationHours, cfg); err != nil {
				return "", err
			}
		} else {
			fare, deposit = carHireFare(req.DurationHours, cfg)
		}
	}
	hireType := req.HireType
	if hireType == "" {
		hireType = "daily"
	}
	vehicleClass := req.VehicleClass
	if vehicleClass == "" {
		vehicleClass = "economy"
	}

	if external {
		_, total, err := carHireTotals(fare, deposit)
		if err != nil {
			return "", codedErr(http.StatusConflict, CodeAmountMismatch, "car-hire price is not a valid charge")
		}
		// Cross-check BEFORE anything writes: never trust the quote, only what was
		// actually collected.
		if total != verifiedAmountKobo {
			return "", codedErr(http.StatusConflict, CodeAmountMismatch, "verified payment amount no longer matches the car-hire fare + deposit")
		}
	} else if err := s.enforceTierLimit(ctx, userID, fare+deposit); err != nil {
		// Fail-closed tier/spending-limit gate BEFORE any wallet escrow (same
		// contract as RequestRide). The gate covers the FULL wallet debit about to be
		// attempted (fare + deposit), not just the fare. Skipped ONLY for card-direct:
		// no wallet debit exists there.
		return "", err
	}

	bookingID := uuid.New().String()
	if external {
		bookingID = externalCarHireID(idempotencyKey)
	}
	// Escrow fare and deposit as two separate settlements under one prefix.
	fareRef, depRef := "carhire:"+bookingID, "carhire:"+bookingID+":deposit"
	escrow := func(ref, key string, amt int64) (*settlement.Settlement, error) {
		if external {
			return s.settlement.EscrowExternal(ctx, userID, ref, key, "transport", amt)
		}
		return s.escrowCheckout(ctx, userID, ref, key, amt)
	}
	fareSett, err := escrow(fareRef, idempotencyKey+":fare", fare)
	if err != nil {
		return "", fmt.Errorf("transport: escrow car-hire fare: %w", err)
	}
	var depositSett *settlement.Settlement
	// ours: the settlements this call may reverse ledger-side if the booking
	// cannot be completed (only rows that PASSED the live-escrow check).
	var ours []string
	if external {
		if err := checkLiveExternalEscrow(fareSett, userID, "fare", fare); err != nil {
			return "", err
		}
		ours = append(ours, fareSett.ID)
	}
	// compensate runs on a detached, bounded ctx (the booking ctx may be the very
	// thing that failed) and reverses ONLY provably orphaned escrow: Find must
	// prove no booking owns it (H5); a Find error leaves the escrow in place.
	compensate := func(cause error, reason string) (string, error) {
		cctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
		defer cancel()
		id, _, cerr := resolveExternalInsertFailure(
			func() (string, bool, error) { return s.FindCarHireByIdempotencyKey(cctx, userID, idempotencyKey) },
			func() error {
				var first error
				for _, sid := range ours {
					if rerr := s.settlement.RefundExternal(cctx, sid, reason); rerr != nil && first == nil {
						first = rerr
					}
				}
				return first
			},
		)
		if cerr != nil {
			log.Printf("[transport] car-hire escrow %v after failure (%v) — %v — needs manual reconciliation", ours, cause, cerr)
			return "", fmt.Errorf("%w (compensation: %v)", cause, cerr)
		}
		return id, nil
	}
	if deposit > 0 {
		var derr error
		depositSett, derr = escrow(depRef, idempotencyKey+":deposit", deposit)
		if derr == nil && external {
			derr = checkLiveExternalEscrow(depositSett, userID, "deposit", deposit)
		}
		if derr != nil {
			cause := fmt.Errorf("transport: escrow car-hire deposit: %w", derr)
			if !external {
				return "", cause
			}
			id, cerr := compensate(cause, "carhire_deposit_escrow_failed")
			if cerr != nil {
				return "", cerr
			}
			if id != "" { // a concurrent booking of the same key owns the escrow
				return id, nil
			}
			return "", cause
		}
		if external {
			ours = append(ours, depositSett.ID)
		}
	}
	const q = `
		INSERT INTO car_hire_bookings
			(id, user_id, hire_type, vehicle_class, chauffeur, start_at, duration_hours, pickup_address,
			 special_request, deposit_kobo, fare_kobo, status, settlement_id, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'confirmed',$12,$13)`
	if _, err := s.db.Exec(ctx, q,
		bookingID, userID, hireType, vehicleClass, req.Chauffeur, startAt, req.DurationHours,
		dbutil.NullStr(req.PickupAddress), dbutil.NullStr(req.SpecialRequest), deposit, fare, fareSett.ID, idempotencyKey,
	); err != nil {
		cause := fmt.Errorf("transport: insert car-hire booking: %w", err)
		if !external {
			return "", cause
		}
		id, cerr := compensate(cause, "carhire_insert_failed")
		if cerr != nil {
			return "", cerr
		}
		if id != "" {
			return id, nil
		}
		return "", cause
	}
	meta := map[string]any{"fare_kobo": fare, "deposit_kobo": deposit}
	if external {
		meta["funding"] = "external"
		meta["verified_amount_kobo"] = verifiedAmountKobo
	}
	s.recordModeEvent(ctx, userID, "carhire.confirmed", "car_hire_booking", bookingID, "", "confirmed", meta)
	return bookingID, nil
}

// CarHireDetail returns a booking (owner or assigned driver).
func (s *Service) CarHireDetail(ctx context.Context, id, callerID string) (map[string]any, error) {
	const q = `
		SELECT id, user_id, driver_id, hire_type, vehicle_class, chauffeur, start_at, duration_hours,
		       pickup_address, special_request, deposit_kobo, fare_kobo, status, created_at
		FROM car_hire_bookings WHERE id=$1`
	var (
		bid, uid, hireType, vehicleClass, status string
		driverID, pickup, special                *string
		chauffeur                                bool
		startAt                                  time.Time
		duration                                 int
		deposit, fare                            int64
		createdAt                                time.Time
	)
	if err := s.db.QueryRow(ctx, q, id).Scan(
		&bid, &uid, &driverID, &hireType, &vehicleClass, &chauffeur, &startAt, &duration,
		&pickup, &special, &deposit, &fare, &status, &createdAt,
	); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "booking not found")
	}
	if callerID != uid {
		if driverID == nil {
			return nil, codedErr(http.StatusForbidden, CodeForbidden, "not permitted")
		}
		var ownerUser string
		_ = s.db.QueryRow(ctx, `SELECT user_id FROM drivers WHERE id=$1`, *driverID).Scan(&ownerUser)
		if ownerUser != callerID {
			return nil, codedErr(http.StatusForbidden, CodeForbidden, "not permitted")
		}
	}
	rail, depositStatus, refundStatus := s.carHireMoneyState(ctx, bid, status)
	return map[string]any{
		"id": bid, "userId": uid, "driverId": driverID, "hireType": hireType,
		"vehicleClass": vehicleClass, "chauffeur": chauffeur, "startAt": startAt,
		"durationHours": duration, "pickupAddress": pickup, "specialRequest": special,
		"depositKobo": deposit, "fareKobo": fare, "status": status, "createdAt": createdAt,
		"fundingRail": rail, "depositStatus": depositStatus, "refundStatus": refundStatus,
	}, nil
}

// carHireMoneyState derives, from the booking's own settlements, the three facts
// a client needs to tell the truth about the money:
//
//	rail          "card" (EscrowExternal) | "wallet"
//	depositStatus none | held | returning (the booking is over but the deposit is
//	              still escrowed — a card refund is owed / in flight) | returned
//	refundStatus  none | pending | refunded | failed — only for a CANCELLED
//	              booking: whether the cancel's refunds have all completed
//
// "returned"/"refunded" mean the refund was ACCEPTED (card: by the gateway; the
// bank may still take days) — clients must word it that way.
func (s *Service) carHireMoneyState(ctx context.Context, id, bookingStatus string) (rail, depositStatus, refundStatus string) {
	rail, depositStatus, refundStatus = "wallet", "none", "none"
	rows, err := s.db.Query(ctx,
		`SELECT reference, funding_source, status FROM settlements WHERE reference=$1 OR starts_with(reference, $2)`,
		"carhire:"+id, "carhire:"+id+":")
	if err != nil {
		return
	}
	defer rows.Close()
	open := false
	for rows.Next() {
		var ref, funding, st string
		if rows.Scan(&ref, &funding, &st) != nil {
			continue
		}
		if ref == "carhire:"+id {
			if funding == "external" {
				rail = "card"
			}
		}
		held := st == "escrowed" || st == "disputed"
		if held {
			open = true
		}
		if ref == "carhire:"+id+":deposit" {
			switch {
			case st == "refunded":
				depositStatus = "returned"
			case held && (bookingStatus == "completed" || bookingStatus == "cancelled"):
				depositStatus = "returning"
			case held:
				depositStatus = "held"
			default:
				depositStatus = "returned" // settled/other terminal: nothing is held
			}
		}
	}
	if bookingStatus == "cancelled" {
		switch {
		case !open:
			refundStatus = "refunded"
		case rail == "card":
			refundStatus = "pending"
		default:
			refundStatus = "failed"
		}
	}
	return
}

// ExtendCarHire escrows the delta for extra hours and marks the booking extended.
func (s *Service) ExtendCarHire(ctx context.Context, id, userID string, extraHours int, idempotencyKey string) (map[string]any, error) {
	if idempotencyKey == "" {
		return nil, codedErr(http.StatusBadRequest, "MISSING_IDEMPOTENCY_KEY", "idempotency key required")
	}
	// Wallet extension keys may never fall in a card-direct namespace (settlement keys
	// of the card rail are namespaced references; the wallet rail must not collide).
	if IsReservedIdempotencyKey(idempotencyKey) {
		return nil, codedErr(http.StatusBadRequest, "INVALID_IDEMPOTENCY_KEY", "this idempotency key format is reserved")
	}
	var b carHireRow
	if err := s.loadCarHire(ctx, id, &b); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "booking not found")
	}
	if b.UserID != userID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not your booking")
	}
	// A card-funded hire has no second charge: an extension would debit the WALLET
	// (the tier gate a card customer chose card to avoid, or a mixed-funding
	// booking). Refuse before anything moves. The rail is read from the fare
	// settlement, never guessed; a failed read refuses too.
	if b.SettlementID != nil {
		ext, err := s.settlementFundedExternally(ctx, *b.SettlementID)
		if err != nil {
			return nil, err
		}
		if ext {
			return nil, codedErr(http.StatusConflict, "EXTENSION_NOT_AVAILABLE_FOR_CARD",
				"A hire paid by card cannot be extended. Book a new hire for the extra time.")
		}
	}
	if b.Status != "active" && b.Status != "extended" {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "booking not active")
	}
	cfg, err := s.loadPricingConfig(ctx, "default", "car_hire")
	if err != nil {
		return nil, err
	}
	delta := int64(extraHours) * cfg.PerKMKobo
	if delta <= 0 {
		return nil, codedErr(http.StatusUnprocessableEntity, "INVALID_EXTENSION", "extension amount must be positive")
	}
	// Fail-closed tier/spending-limit gate BEFORE the extension escrow (same contract
	// as adjustEscrow's delta gate): an over-limit user cannot extend on wallet.
	if err := s.enforceTierLimit(ctx, userID, delta); err != nil {
		return nil, err
	}
	extRef := fmt.Sprintf("carhire:%s:ext:%d", id, time.Now().UnixNano())
	if _, err := s.escrowCheckout(ctx, userID, extRef, idempotencyKey, delta); err != nil {
		return nil, fmt.Errorf("transport: escrow car-hire extension: %w", err)
	}
	// active → extended, or extended → extended (repeat).
	from := b.Status
	if _, err := s.db.Exec(ctx,
		`UPDATE car_hire_bookings SET status='extended', duration_hours=duration_hours+$1, fare_kobo=fare_kobo+$2, updated_at=NOW() WHERE id=$3`,
		extraHours, delta, id); err != nil {
		return nil, err
	}
	s.recordModeEvent(ctx, userID, "carhire.extended", "car_hire_booking", id, from, "extended",
		map[string]any{"extra_hours": extraHours, "delta_kobo": delta})
	return s.CarHireDetail(ctx, id, userID)
}

// ActivateCarHire moves a confirmed booking → active (customer or system).
func (s *Service) ActivateCarHire(ctx context.Context, id, userID string) error {
	var b carHireRow
	if err := s.loadCarHire(ctx, id, &b); err != nil {
		return codedErr(http.StatusNotFound, CodeNotFound, "booking not found")
	}
	if b.UserID != userID {
		return codedErr(http.StatusForbidden, CodeForbidden, "not your booking")
	}
	if b.Status != "confirmed" {
		return codedErr(http.StatusConflict, CodeInvalidState, "booking not confirmed")
	}
	// INTERIM (until driver assignment exists): a CARD-funded hire may not start without
	// a driver — it could then be neither completed (no provider to pay) nor cancelled
	// (started), stranding the customer's money. Read from the fare settlement; a failed
	// read refuses (never guess the rail). Wallet bookings keep their historical behaviour.
	if b.SettlementID != nil {
		ext, err := s.settlementFundedExternally(ctx, *b.SettlementID)
		if err != nil {
			return err
		}
		if ext && s.carHireDriverUser(ctx, b.DriverID) == "" {
			return codedErr(http.StatusConflict, "CARD_HIRE_NO_DRIVER",
				"No driver is assigned to this hire yet, so it cannot start. Contact support.")
		}
	}
	if err := s.carHireSetStatus(ctx, id, "confirmed", "active"); err != nil {
		return err
	}
	s.recordModeEvent(ctx, userID, "carhire.active", "car_hire_booking", id, "confirmed", "active", nil)
	return nil
}

// CompleteResult is what the complete endpoint reports beyond "the status flipped".
type CompleteResult struct {
	// DepositRefundStatus: none (no deposit) | refunded | pending (a CARD deposit
	// refund not yet complete; retried by re-POSTing complete and by the
	// reconciler) | failed (a WALLET deposit refund failed; manual).
	DepositRefundStatus string `json:"deposit_refund_status"`
}

// CompleteCarHire settles the driver split (fare + extensions) and refunds the
// deposit. Owner or assigned driver may complete. See CompleteCarHireWithRefund
// for the deposit_refund_status the HTTP endpoint reports.
func (s *Service) CompleteCarHire(ctx context.Context, id, callerID string) error {
	_, err := s.CompleteCarHireWithRefund(ctx, id, callerID)
	return err
}

// carHireDriverUser resolves the assigned driver's USER id ("" when none).
func (s *Service) carHireDriverUser(ctx context.Context, driverID *string) string {
	if driverID == nil {
		return ""
	}
	var u string
	_ = s.db.QueryRow(ctx, `SELECT user_id::text FROM drivers WHERE id=$1`, *driverID).Scan(&u)
	return u
}

// CompleteCarHireWithRefund completes a hire and reports whether the deposit is
// actually back. The WALLET rail is the historical path, unchanged. A CARD-funded
// booking: the fare settles to the driver, the FULL deposit is refunded to the
// card through the gateway (never the wallet), and the call is re-entrant — a
// re-POST on an already-completed card booking finishes a fare payout or deposit
// refund that failed after the status flip. A card booking with no driver is
// refused (409 CARD_HIRE_NO_DRIVER) BEFORE anything changes: its fare could not
// be paid out and the status would be stuck "completed".
func (s *Service) CompleteCarHireWithRefund(ctx context.Context, id, callerID string) (*CompleteResult, error) {
	var b carHireRow
	if err := s.loadCarHire(ctx, id, &b); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "booking not found")
	}
	// Object-level authz: owner or assigned driver.
	if b.UserID != callerID {
		if b.DriverID == nil {
			return nil, codedErr(http.StatusForbidden, CodeForbidden, "not permitted")
		}
		var ownerUser string
		_ = s.db.QueryRow(ctx, `SELECT user_id FROM drivers WHERE id=$1`, *b.DriverID).Scan(&ownerUser)
		if ownerUser != callerID {
			return nil, codedErr(http.StatusForbidden, CodeForbidden, "not permitted")
		}
	}
	external := false
	if b.SettlementID != nil {
		ext, err := s.settlementFundedExternally(ctx, *b.SettlementID)
		if err != nil {
			return nil, err // never pick a rail on a guess
		}
		external = ext
	}
	if !external {
		if err := s.completeCarHireWallet(ctx, &b, id, callerID); err != nil {
			return nil, err
		}
		return &CompleteResult{DepositRefundStatus: s.walletDepositRefundStatus(ctx, id)}, nil
	}

	// ── card-funded ──
	if _, err := s.requireRefundRail(ctx, RefundDomainCarHire, b.SettlementID); err != nil {
		return nil, err // 503 refund_unavailable: nothing flipped
	}
	from := b.Status
	flipped := false
	switch from {
	case "completed":
		// re-entrant: finish whatever money step is still outstanding
	case "active", "extended":
		// A card hire is completed only once it has STARTED. From 'confirmed' the right
		// action is cancel (full refund while it has not begun).
		if s.carHireDriverUser(ctx, b.DriverID) == "" {
			return nil, codedErr(http.StatusConflict, "CARD_HIRE_NO_DRIVER",
				"No driver is assigned to this hire yet, so it cannot be completed. Contact support.")
		}
		if err := s.carHireSetStatus(ctx, id, from, "completed"); err != nil {
			return nil, err
		}
		flipped = true
	default:
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "booking not completable from "+from)
	}
	res, err := s.completeCarHireCardMoney(ctx, &b, id)
	if flipped {
		if b.DriverID != nil {
			_, _ = s.db.Exec(ctx, `UPDATE drivers SET status='online', completed_trips=completed_trips+1, updated_at=NOW() WHERE id=$1`, *b.DriverID)
		}
		s.recordModeEvent(ctx, callerID, "carhire.completed", "car_hire_booking", id, from, "completed",
			map[string]any{"deposit_refund_status": res.DepositRefundStatus})
	}
	return res, err
}

// completeCarHireCardMoney runs the two independent money steps of completing a
// CARD booking and is safe to repeat (each step acts only on a settlement that is
// still escrowed): (1) settle the fare to the driver, (2) refund the FULL
// deposit to the card. The deposit is the renter's money, so a failed fare payout
// never blocks it; the fare error is returned AFTER the deposit was attempted.
func (s *Service) completeCarHireCardMoney(ctx context.Context, b *carHireRow, id string) (*CompleteResult, error) {
	res := &CompleteResult{DepositRefundStatus: RefundStatusNone}
	var firstErr error

	if b.SettlementID != nil {
		var fareStatus string
		if err := s.db.QueryRow(ctx, `SELECT status FROM settlements WHERE id=$1`, *b.SettlementID).Scan(&fareStatus); err != nil {
			firstErr = err
		} else if fareStatus == "escrowed" {
			// Never Settle a settlement the card-refund engine has begun refunding (any
			// piece row, whatever its status): the customer would be refunded AND the
			// driver paid. A failed lookup refuses too.
			var hasPiece bool
			if perr := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM public.transport_paystack_intent_refunds WHERE settlement_id=$1)`, *b.SettlementID).Scan(&hasPiece); perr != nil {
				firstErr = fmt.Errorf("transport: cannot verify the fare is not being refunded: %w", perr)
			} else if hasPiece {
				log.Printf("[transport] car-hire %s: fare settlement=%s has a card-refund piece row — NOT settling it to the driver (manual)", id, *b.SettlementID)
				firstErr = fmt.Errorf("transport: fare settlement %s is being refunded to the card — refusing to settle it", *b.SettlementID)
			} else if driverUser := s.carHireDriverUser(ctx, b.DriverID); driverUser == "" {
				log.Printf("[transport] car-hire %s completed with the fare still escrowed: no driver assigned — manual", id)
			} else {
				comm, _ := s.commissionForTier(ctx, s.driverTier(ctx, b.DriverID))
				if serr := s.settlement.Settle(ctx, *b.SettlementID, settlementSplit(driverUser, comm, 0)); serr != nil {
					firstErr = fmt.Errorf("transport: settle car-hire fare %s: %w", *b.SettlementID, serr)
				} else {
					fareStatus = "settled"
				}
			}
		}
		if fareStatus == "settled" {
			// Realized Spotlight profit (best-effort + idempotent on the booking id).
			ownerID := b.UserID
			s.recordCommissionSafe(ctx, "Lifestyle", "Car Hire", "", b.FareKobo, id, &ownerID)
		}
	}

	var depositSettID, depositStatus string
	err := s.db.QueryRow(ctx, `SELECT id::text, status FROM settlements WHERE reference=$1`, "carhire:"+id+":deposit").Scan(&depositSettID, &depositStatus)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		// no deposit
	case err != nil:
		res.DepositRefundStatus = RefundStatusPending
		if firstErr == nil {
			firstErr = err
		}
	case depositStatus == "refunded":
		res.DepositRefundStatus = RefundStatusRefunded
	case depositStatus == "escrowed":
		rerr := s.refundSettlement(ctx, RefundDomainCarHire, id, depositSettID, "car_hire_deposit_released")
		s.recordCarHireRefundLeg(ctx, b.UserID, id, depositSettID, true, rerr)
		if rerr != nil {
			log.Printf("[transport] car-hire %s completed but the deposit refund of settlement=%s failed: %v", id, depositSettID, rerr)
			res.DepositRefundStatus = RefundStatusPending
		} else {
			res.DepositRefundStatus = RefundStatusRefunded
		}
	case depositStatus == "disputed":
		// admin paths only (see refundCarHireSettlements)
		res.DepositRefundStatus = RefundStatusPending
	}
	return res, firstErr
}

// walletDepositRefundStatus reports the outcome of a WALLET completion's
// (best-effort) deposit release from the deposit settlement itself.
func (s *Service) walletDepositRefundStatus(ctx context.Context, id string) string {
	var st string
	if err := s.db.QueryRow(ctx, `SELECT status FROM settlements WHERE reference=$1`, "carhire:"+id+":deposit").Scan(&st); err != nil {
		return RefundStatusNone
	}
	if st == "refunded" {
		return RefundStatusRefunded
	}
	return RefundStatusFailed
}

// completeCarHireWallet is the historical WALLET completion, unchanged.
func (s *Service) completeCarHireWallet(ctx context.Context, bp *carHireRow, id, callerID string) error {
	b := *bp
	if b.Status != "active" && b.Status != "extended" && b.Status != "confirmed" {
		return codedErr(http.StatusConflict, CodeInvalidState, "booking not completable from "+b.Status)
	}
	from := b.Status
	if err := s.carHireSetStatus(ctx, id, from, "completed"); err != nil {
		return err
	}

	// Settle fare + every extension settlement to the driver; refund the deposit.
	comm, _ := s.commissionForTier(ctx, s.driverTier(ctx, b.DriverID))
	var driverUserID string
	if b.DriverID != nil {
		_ = s.db.QueryRow(ctx, `SELECT user_id FROM drivers WHERE id=$1`, *b.DriverID).Scan(&driverUserID)
	}
	split := settlementSplit(driverUserID, comm, 0)
	// Fare + extensions: reference 'carhire:<id>' and 'carhire:<id>:ext:%' (NOT deposit).
	rows, err := s.db.Query(ctx,
		`SELECT id FROM settlements WHERE status='escrowed' AND (reference=$1 OR reference LIKE $2)`,
		"carhire:"+id, "carhire:"+id+":ext:%")
	if err != nil {
		return fmt.Errorf("transport: load car-hire settlements: %w", err)
	}
	var settleIDs []string
	for rows.Next() {
		var sid string
		if err := rows.Scan(&sid); err != nil {
			rows.Close()
			return err
		}
		settleIDs = append(settleIDs, sid)
	}
	rows.Close()
	for _, sid := range settleIDs {
		if err := s.settlement.Settle(ctx, sid, split); err != nil {
			return fmt.Errorf("transport: settle car-hire %s: %w", sid, err)
		}
	}
	// Record realized Spotlight profit (best-effort + idempotent; booking id as source
	// ref + idempotency key). gross = the full hire fare (base + extensions; the
	// separately-escrowed deposit is refunded, not charged). A recorder failure is
	// logged and swallowed — it must NEVER affect the settlement above (earning-row
	// only; no ledger re-post).
	ownerID := b.UserID
	s.recordCommissionSafe(ctx, "Lifestyle", "Car Hire", "", b.FareKobo, id, &ownerID)
	var depositSettID string
	if err := s.db.QueryRow(ctx,
		`SELECT id FROM settlements WHERE reference=$1 AND status='escrowed' LIMIT 1`,
		"carhire:"+id+":deposit").Scan(&depositSettID); err == nil {
		if rerr := s.settlement.Refund(ctx, depositSettID, "car_hire_deposit_released"); rerr != nil {
			log.Printf("[transport] car-hire %s completed but the WALLET deposit release of settlement=%s failed: %v — needs manual reconciliation", id, depositSettID, rerr)
		}
	}
	if b.DriverID != nil {
		_, _ = s.db.Exec(ctx, `UPDATE drivers SET status='online', completed_trips=completed_trips+1, updated_at=NOW() WHERE id=$1`, *b.DriverID)
	}
	s.recordModeEvent(ctx, callerID, "carhire.completed", "car_hire_booking", id, from, "completed", nil)
	return nil
}

// driverTier returns a driver's commission tier (default "standard").
func (s *Service) driverTier(ctx context.Context, driverID *string) string {
	tier := "standard"
	if driverID != nil {
		_ = s.db.QueryRow(ctx, `SELECT commission_tier FROM drivers WHERE id=$1`, *driverID).Scan(&tier)
	}
	return tier
}

// CancelCarHire refunds all escrowed amounts (fare, deposit, extensions). See
// CancelCarHireWithRefund for the refund_status the HTTP endpoint reports.
func (s *Service) CancelCarHire(ctx context.Context, id, userID, reason string) error {
	_, err := s.CancelCarHireWithRefund(ctx, id, userID, reason)
	return err
}

// refundCarHireSettlements refunds every settlement of the booking that is still
// escrowed/disputed (fare first, then deposit, then any wallet extensions)
// through the single refund choke point: card money to the card, wallet money to
// the wallet — chosen per settlement from funding_source, never guessed. It
// returns the honest refund_status; a failure never aborts the remaining legs.
func (s *Service) refundCarHireSettlements(ctx context.Context, actor, id, reason string, external bool) string {
	rows, err := s.db.Query(ctx,
		`SELECT id::text, status FROM settlements WHERE reference=$1 OR starts_with(reference, $2) ORDER BY reference`,
		"carhire:"+id, "carhire:"+id+":")
	if err != nil {
		log.Printf("[transport] car-hire %s refund: load settlements: %v", id, err)
		return refundStatusFor(err, external)
	}
	type leg struct{ id, status string }
	var legs []leg
	for rows.Next() {
		var l leg
		if rows.Scan(&l.id, &l.status) == nil {
			legs = append(legs, l)
		}
	}
	rows.Close()
	if len(legs) == 0 {
		return RefundStatusNone
	}
	var firstErr error
	for _, l := range legs {
		switch l.status {
		case "escrowed":
		case "disputed":
			// A DISPUTED settlement is for the admin paths only: a customer cancel (or the
			// sweeper) must not release money someone has contested. Not refunded, so the
			// refund is reported as not complete.
			log.Printf("[transport] car-hire %s: settlement=%s is disputed — not refunded by the customer path", id, l.id)
			if firstErr == nil {
				firstErr = fmt.Errorf("settlement %s is disputed", l.id)
			}
			continue
		default:
			continue
		}
		rerr := s.refundSettlement(ctx, RefundDomainCarHire, id, l.id, reason)
		s.recordCarHireRefundLeg(ctx, actor, id, l.id, external, rerr)
		if rerr != nil {
			log.Printf("[transport] car-hire %s cancelled but refund of settlement=%s failed: %v", id, l.id, rerr)
			if firstErr == nil {
				firstErr = rerr
			}
		}
	}
	return refundStatusFor(firstErr, external)
}

// recordCarHireRefundLeg writes one audit event per refund leg attempted by the
// customer paths (same sink as the cancel/complete events), so a card refund that
// is pending or failed is visible in transport_audit_log with its settlement id.
func (s *Service) recordCarHireRefundLeg(ctx context.Context, actor, bookingID, settlementID string, external bool, rerr error) {
	meta := map[string]any{"settlement_id": settlementID, "rail": "wallet", "ok": rerr == nil}
	if external {
		meta["rail"] = "card"
	}
	if rerr != nil {
		meta["error"] = rerr.Error()
	}
	s.recordModeEvent(ctx, actor, "carhire.refund_leg", "car_hire_booking", bookingID, "", "", meta)
}

// CancelCarHireWithRefund cancels a booking and reports whether the customer's
// money is actually back (refund_status). A card-funded booking can only be
// cancelled BEFORE activation (409 CARD_HIRE_ACTIVE_USE_RETURN afterwards: the
// car was used — complete the hire to get the deposit back), is refused up front
// (503 refund_unavailable) when no refunder is wired, refunds BOTH settlements to
// the card, and is re-POSTable to finish a refund that failed after the flip.
// The wallet rail keeps its historical behaviour (cancel from active allowed,
// full wallet refund) — except that refund failures are now reported, not
// swallowed.
func (s *Service) CancelCarHireWithRefund(ctx context.Context, id, userID, reason string) (*CancelResult, error) {
	reason = capCancelReason(reason)
	var b carHireRow
	if err := s.loadCarHire(ctx, id, &b); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "booking not found")
	}
	if b.UserID != userID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not your booking")
	}
	if b.Status == "cancelled" {
		// Idempotent re-cancel. Only meaningful for a card-funded booking whose
		// refunds did not all complete after the status flip.
		if b.SettlementID != nil {
			if ext, eerr := s.settlementFundedExternally(ctx, *b.SettlementID); eerr == nil && ext {
				if _, rerr := s.requireRefundRail(ctx, RefundDomainCarHire, b.SettlementID); rerr != nil {
					return nil, rerr
				}
				return &CancelResult{RefundStatus: s.refundCarHireSettlements(ctx, b.UserID, id, "car_hire_cancelled_retry:"+reason, true)}, nil
			}
		}
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "cannot cancel from status "+b.Status)
	}
	if !canTransitionCarHire(b.Status, "cancelled") {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "cannot cancel from status "+b.Status)
	}
	external, err := s.requireRefundRail(ctx, RefundDomainCarHire, b.SettlementID)
	if err != nil {
		return nil, err
	}
	if external && (b.Status == "active" || b.Status == "extended") {
		return nil, codedErr(http.StatusConflict, "CARD_HIRE_ACTIVE_USE_RETURN",
			"This hire has started, so it can't be cancelled. Complete the hire to get your deposit back.")
	}
	// INTERIM: a card hire whose start time has passed may already have been used (it
	// need not have been activated in the app), so the full refund of a cancel is no
	// longer safe. Support decides (an admin path).
	if external && !time.Now().Before(b.StartAt) {
		return nil, codedErr(http.StatusConflict, "CARD_HIRE_STARTED",
			"The start time of this hire has passed, so it can't be cancelled in the app. Please contact support.")
	}
	if err := s.carHireSetStatus(ctx, id, b.Status, "cancelled"); err != nil {
		return nil, err
	}
	res := &CancelResult{RefundStatus: s.refundCarHireSettlements(ctx, userID, id, "car_hire_cancelled:"+reason, external)}
	if b.DriverID != nil {
		_, _ = s.db.Exec(ctx, `UPDATE drivers SET status='online', cancelled_trips=cancelled_trips+1, updated_at=NOW() WHERE id=$1`, *b.DriverID)
	}
	s.recordModeEvent(ctx, userID, "carhire.cancelled", "car_hire_booking", id, b.Status, "cancelled",
		map[string]any{"reason": reason, "refund_status": res.RefundStatus})
	return res, nil
}

// carHireSetStatus performs a guarded status update.
func (s *Service) carHireSetStatus(ctx context.Context, id, from, to string) error {
	if to != "cancelled" && to != "completed" && !canTransitionCarHire(from, to) {
		return codedErr(http.StatusConflict, CodeInvalidState, fmt.Sprintf("illegal car-hire transition %s → %s", from, to))
	}
	if to == "cancelled" && !canTransitionCarHire(from, "cancelled") {
		return codedErr(http.StatusConflict, CodeInvalidState, "cannot cancel from "+from)
	}
	if to == "completed" {
		ok := from == "active" || from == "extended" || from == "confirmed"
		if !ok {
			return codedErr(http.StatusConflict, CodeInvalidState, "cannot complete from "+from)
		}
	}
	tag, err := s.db.Exec(ctx, `UPDATE car_hire_bookings SET status=$1, updated_at=NOW() WHERE id=$2 AND status=$3`, to, id, from)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return codedErr(http.StatusConflict, CodeInvalidState, "car-hire status changed concurrently")
	}
	return nil
}

// ListCarHire returns the user's bookings.
func (s *Service) ListCarHire(ctx context.Context, userID string) ([]map[string]any, error) {
	const q = `
		SELECT id, hire_type, vehicle_class, start_at, duration_hours, fare_kobo, deposit_kobo, status, created_at
		FROM car_hire_bookings WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, hireType, vehicleClass, status string
		var startAt, createdAt time.Time
		var duration int
		var fare, deposit int64
		if err := rows.Scan(&id, &hireType, &vehicleClass, &startAt, &duration, &fare, &deposit, &status, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "hireType": hireType, "vehicleClass": vehicleClass, "startAt": startAt,
			"durationHours": duration, "fareKobo": fare, "depositKobo": deposit,
			"status": status, "createdAt": createdAt,
		})
	}
	return out, nil
}

// CarHireQuote returns fare + deposit.
func (h *Handler) CarHireQuote(c *gin.Context) {
	var req CarHireQuoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	q, err := h.svc.QuoteCarHire(c.Request.Context(), req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, q)
}

// CarHireBook escrows fare + deposit.
func (h *Handler) CarHireBook(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req CarHireBookRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	b, err := h.svc.BookCarHire(c.Request.Context(), userID, req, ginutil.IdempotencyKey(c))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, b)
}

// CarHireGet returns a booking detail.
func (h *Handler) CarHireGet(c *gin.Context) {
	userID := ginutil.UserID(c)
	b, err := h.svc.CarHireDetail(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, b)
}

// CarHireList returns the user's bookings.
func (h *Handler) CarHireList(c *gin.Context) {
	userID := ginutil.UserID(c)
	bs, err := h.svc.ListCarHire(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"bookings": bs})
}

// CarHireActivate moves a confirmed booking to active.
func (h *Handler) CarHireActivate(c *gin.Context) {
	userID := ginutil.UserID(c)
	if err := h.svc.ActivateCarHire(c.Request.Context(), c.Param("id"), userID); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "active"})
}

// CarHireExtend escrows the delta for extra hours.
func (h *Handler) CarHireExtend(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req CarHireExtendRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	key := ginutil.IdempotencyKey(c)
	if key == "" {
		key = req.IdempotencyKey
	}
	b, err := h.svc.ExtendCarHire(c.Request.Context(), c.Param("id"), userID, req.ExtraHours, key)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, b)
}

// CarHireComplete settles driver split + releases deposit.
func (h *Handler) CarHireComplete(c *gin.Context) {
	userID := ginutil.UserID(c)
	res, err := h.svc.CompleteCarHireWithRefund(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "completed", "deposit_refund_status": res.DepositRefundStatus})
}

// CarHireCancel refunds all escrow.
func (h *Handler) CarHireCancel(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req CancelRequest
	_ = c.ShouldBindJSON(&req)
	res, err := h.svc.CancelCarHireWithRefund(c.Request.Context(), c.Param("id"), userID, req.Reason)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "cancelled", "refund_status": res.RefundStatus})
}

// sweepCarHireCardRefunds is the reconciler hook for car hire (see
// SweepCancelledCardRefunds). Two stranded shapes, both CARD-funded only:
//
//  1. a CANCELLED booking whose fare and/or deposit settlement is still
//     escrowed/disputed (the cancel flipped the status but a gateway refund
//     failed, or no refunder was wired, and the customer never re-POSTed);
//  2. a COMPLETED booking whose deposit is still escrowed (the completion flipped
//     the status but the deposit refund — or the fare payout — did not finish).
//
// Both run through the same choke points a customer re-POST uses, so the sweep
// can never double-refund; minAge keeps it clear of a call still in flight.
// Wallet-funded bookings are never touched.
func (s *Service) sweepCarHireCardRefunds(ctx context.Context, minAge time.Duration, limit int) (CancelSweepResult, error) {
	if limit <= 0 {
		limit = 100
	}
	var out CancelSweepResult

	rows, err := s.db.Query(ctx, `
		SELECT b.id::text, st.id::text, b.user_id::text
		  FROM car_hire_bookings b
		  JOIN settlements st ON (st.reference = 'carhire:' || b.id::text OR starts_with(st.reference, 'carhire:' || b.id::text || ':'))
		 WHERE b.status='cancelled' AND st.funding_source='external' AND st.status = 'escrowed' -- 'disputed' is for admin paths only
		   AND b.updated_at < now() - make_interval(secs => $1)
		 ORDER BY b.updated_at, st.reference LIMIT $2`, minAge.Seconds(), limit)
	if err != nil {
		return out, err
	}
	type leg struct{ booking, settlement, user string }
	var legs []leg
	for rows.Next() {
		var l leg
		if err := rows.Scan(&l.booking, &l.settlement, &l.user); err != nil {
			rows.Close()
			return out, err
		}
		legs = append(legs, l)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return out, err
	}
	for _, l := range legs {
		rerr := s.refundSettlement(ctx, RefundDomainCarHire, l.booking, l.settlement, "carhire_cancelled_sweep")
		s.recordCarHireRefundLeg(ctx, l.user, l.booking, l.settlement, true, rerr)
		if rerr != nil {
			out.Failed++
			log.Printf("[transport] car-hire cancelled-refund sweep: booking=%s settlement=%s: %v", l.booking, l.settlement, rerr)
			continue
		}
		out.Completed++
	}

	rows, err = s.db.Query(ctx, `
		SELECT DISTINCT ON (b.updated_at, b.id) b.id::text
		  FROM car_hire_bookings b
		  JOIN settlements st ON (st.reference = 'carhire:' || b.id::text OR starts_with(st.reference, 'carhire:' || b.id::text || ':'))
		 WHERE b.status='completed' AND st.funding_source='external' AND st.status = 'escrowed' -- fare OR deposit still held
		   AND b.updated_at < now() - make_interval(secs => $1)
		 ORDER BY b.updated_at, b.id LIMIT $2`, minAge.Seconds(), limit)
	if err != nil {
		return out, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return out, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return out, err
	}
	for _, id := range ids {
		var b carHireRow
		if err := s.loadCarHire(ctx, id, &b); err != nil {
			out.Failed++
			continue
		}
		res, merr := s.completeCarHireCardMoney(ctx, &b, id)
		if merr != nil || (res.DepositRefundStatus != RefundStatusRefunded && res.DepositRefundStatus != RefundStatusNone) {
			out.Failed++
			log.Printf("[transport] car-hire completed-deposit sweep: booking=%s: deposit=%s err=%v", id, res.DepositRefundStatus, merr)
			continue
		}
		out.Completed++
	}
	return out, nil
}
