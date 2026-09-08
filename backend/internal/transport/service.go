package transport

import (
	"context"
	"crypto/rand"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/finance/tiers"
)

// tierLimiter is the minimal seam the transport money-path depends on for the
// fail-closed KYC-tier / daily-spend gate. *tiers.Service satisfies it in
// production; unit tests inject a fake to prove the enforceTierLimit decision
// (deny-on-over-limit, deny-on-dep-error) WITHOUT a database. Keeping the seam
// this small means the wiring in NewService is unchanged and idiomatic.
type tierLimiter interface {
	EnforceWalletDebitLimit(ctx context.Context, userID string, amountKobo int64) error
	// Rider fares are consumer purchases, so they use the checkout gate: identical
	// for Tier 1+, capped-but-permitted for Tier 0 (ADR-043).
	EnforceCheckoutDebitLimit(ctx context.Context, userID string, amountKobo int64) error
}

// Service manages driver registration, trip lifecycle, fare negotiation, and settlement.
type Service struct {
	db         *pgxpool.Pool
	settlement *settlement.Service
	tiers      tierLimiter // fail-closed KYC-tier / daily-spend gate on rider money moves
	maps       MapsAdapter
	commission CommissionRecorder // optional; nil ⇒ realized-profit recording is a no-op
	insurance  InsuranceBinder    // optional; nil ⇒ parcels book/deliver with no real cover
}

// NewService wires the transport service. A MockMaps adapter is used when none
// is supplied, so business logic always has a deterministic geo backend.
//
// The tier-limit gate is constructed from the same pool (tiers.NewService needs
// only the DB), so no extra wiring is required at the call site. If a future
// refactor centralises the tiers service, inject it here and drop this line.
func NewService(db *pgxpool.Pool, settlement *settlement.Service) *Service {
	return &Service{db: db, settlement: settlement, tiers: tiers.NewService(db), maps: NewMockMaps()}
}

// WithTiers injects a pre-configured tier gate, taking the refactor the comment
// above invited. Routes pass the shared, flag-configured service so a rider fare
// honours the Tier-0 checkout allowance (ADR-043) rather than the strict default
// this service builds for itself.
//
// Optional and fail-safe: without it the self-built gate applies, which refuses
// Tier 0 exactly as before. An unwired call site is stricter, never looser.
func (s *Service) WithTiers(t tierLimiter) *Service {
	if t != nil {
		s.tiers = t
	}
	return s
}

// enforceTierLimit is a fail-closed guard applied before any rider-funded wallet
// escrow. It delegates to the shared tiers service (KYC tier + daily debit limit)
// so a Tier0/over-limit rider cannot move money. Any error (including DB errors)
// blocks the escrow — money-path code must fail closed. amountKobo is the wallet
// debit about to be attempted (the fare, delta, or tip in minor units).
func (s *Service) enforceTierLimit(ctx context.Context, riderID string, amountKobo int64) error {
	if s.tiers == nil { // defensive: gate is always wired by NewService
		return codedErr(http.StatusForbidden, CodeForbidden, "tier limit gate unavailable")
	}
	if amountKobo <= 0 {
		return nil
	}
	if err := s.tiers.EnforceCheckoutDebitLimit(ctx, riderID, amountKobo); err != nil {
		// Surface as a client-visible forbidden — the rider must complete KYC or is
		// over their daily limit. Do NOT let money move.
		return codedErr(http.StatusForbidden, CodeForbidden, err.Error())
	}
	return nil
}

// WithMaps swaps the maps adapter (e.g. a live provider in production).
func (s *Service) WithMaps(m MapsAdapter) *Service {
	s.maps = m
	return s
}

// CommissionRecorder is the nil-safe seam into the central Commission & Profit
// module (§ profit registry). app-wiring injects a thin adapter over the finance
// commission service; when the commission feature is off (or no recorder is wired)
// the field is nil and recording is a silent no-op. Modeled as a LOCAL interface so
// transport never imports the commission package at compile time (mirrors the
// tierLimiter / MapsAdapter seams) — the adapter, which lives in app-wiring, discards
// the returned earning row and surfaces only the error.
//
// This records realized profit ONLY; it never moves money. Transport's own money
// movements (the settlement split into the provider/platform wallets) are unchanged,
// and the injected recorder is deliberately constructed WITHOUT a ledger so RecordFor
// never re-posts to the ledger (no double count of the commission revenue account) —
// it appends the immutable earning row used by profit reports.
type CommissionRecorder interface {
	RecordFor(ctx context.Context, category, service, subtype string, grossKobo int64,
		sourceModule, sourceRef string, userID *string, idempotencyKey string) error
}

// SetCommissionRecorder injects the central profit-recording seam (app-wiring,
// post-construction). Nil is accepted and disables recording.
func (s *Service) SetCommissionRecorder(cr CommissionRecorder) { s.commission = cr }

// recordCommissionSafe records realized Spotlight profit for a completed transport
// settlement. It is best-effort and MUST NEVER affect the caller's outcome: a nil
// recorder is a no-op, and any error is logged and swallowed so a profit-registry
// failure can never fail or reverse the fare split / payout. The recorded breakdown
// is resolved server-side from the central rate card; the source ref (the trip /
// booking id) doubles as the idempotency key so retries and reconciliation sweeps
// never double-count.
func (s *Service) recordCommissionSafe(ctx context.Context, category, service, subtype string, grossKobo int64,
	sourceRef string, userID *string) {
	if s.commission == nil || grossKobo <= 0 {
		return
	}
	if err := s.commission.RecordFor(ctx, category, service, subtype, grossKobo,
		"transport", sourceRef, userID, sourceRef); err != nil {
		log.Printf("[transport] commission record (source=%s gross=%d) failed, continuing: %v", sourceRef, grossKobo, err)
	}
}

// ─── Legacy driver/trip methods (kept for back-compat) ───────────────────────

// RegisterDriver creates a driver profile.
func (s *Service) RegisterDriver(ctx context.Context, userID string, req RegisterDriverRequest) (*Driver, error) {
	d := &Driver{
		ID:          uuid.New().String(),
		UserID:      userID,
		Name:        req.Name,
		VehicleReg:  req.VehicleReg,
		VehicleType: req.VehicleType,
		Status:      DriverOffline,
		Rating:      5.0,
		CreatedAt:   time.Now(),
	}
	const q = `INSERT INTO drivers (id, user_id, name, vehicle_reg, vehicle_type, status, rating) VALUES ($1,$2,$3,$4,$5,'offline',5.0)`
	_, err := s.db.Exec(ctx, q, d.ID, d.UserID, d.Name, d.VehicleReg, d.VehicleType)
	return d, err
}

// SetDriverStatus updates a driver's availability (legacy, no geo).
func (s *Service) SetDriverStatus(ctx context.Context, userID string, status DriverStatus) error {
	const q = `UPDATE drivers SET status=$1, updated_at=NOW() WHERE user_id=$2`
	tag, err := s.db.Exec(ctx, q, string(status), userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("transport: driver not found")
	}
	return nil
}

// RequestTrip is the legacy flat-fare trip request (kept for back-compat).
func (s *Service) RequestTrip(ctx context.Context, riderID string, req RequestTripRequest) (*Trip, error) {
	if req.FareKobo < BaseFareKobo {
		return nil, fmt.Errorf("transport: fare must be at least ₦1,500 (%d kobo)", BaseFareKobo)
	}
	// Fail-closed tier/spending-limit gate BEFORE any wallet escrow. This legacy
	// path is no longer routed (its HTTP route was removed) but is gated for
	// defense-in-depth so any internal caller cannot bypass the tier limit.
	if err := s.enforceTierLimit(ctx, riderID, req.FareKobo); err != nil {
		return nil, err
	}
	tripID := uuid.New().String()
	ref := "trip:" + tripID
	sett, err := s.settlement.Escrow(ctx, riderID, ref, req.IdempotencyKey, "transport", req.FareKobo)
	if err != nil {
		return nil, fmt.Errorf("transport: escrow fare: %w", err)
	}
	trip := &Trip{
		ID:             tripID,
		RiderID:        riderID,
		PickupAddress:  req.PickupAddress,
		DestAddress:    req.DestAddress,
		FareKobo:       req.FareKobo,
		Status:         TripRequested,
		IdempotencyKey: req.IdempotencyKey,
		SettlementID:   sett.ID,
		CreatedAt:      time.Now(),
	}
	const q = `
		INSERT INTO trips (id, rider_id, pickup_address, dest_address, fare_kobo, status, phase, idempotency_key, settlement_id, fare_estimate_kobo)
		VALUES ($1,$2,$3,$4,$5,'requested','requested',$6,$7,$5)`
	if _, err := s.db.Exec(ctx, q,
		trip.ID, trip.RiderID, trip.PickupAddress, trip.DestAddress,
		trip.FareKobo, trip.IdempotencyKey, trip.SettlementID,
	); err != nil {
		return nil, fmt.Errorf("transport: insert trip: %w", err)
	}
	return trip, nil
}

// AcceptTrip assigns a driver to a requested trip (legacy).
func (s *Service) AcceptTrip(ctx context.Context, tripID, driverUserID string) error {
	var driverID string
	if err := s.db.QueryRow(ctx, `SELECT id FROM drivers WHERE user_id=$1 AND status='online' AND verification_status='approved'`, driverUserID).Scan(&driverID); err != nil {
		return fmt.Errorf("transport: driver not found, not online, or not approved")
	}
	const q = `UPDATE trips SET status='accepted', phase='driver_assigned', driver_id=$1 WHERE id=$2 AND status='requested'`
	tag, err := s.db.Exec(ctx, q, driverID, tripID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("transport: trip not available for acceptance")
	}
	s.db.Exec(ctx, `UPDATE drivers SET status='on_trip', updated_at=NOW() WHERE id=$1`, driverID)
	s.recordEvent(ctx, tripID, "driver_assigned", driverUserID, PhaseRequested, PhaseDriverAssigned, nil)
	return nil
}

// UpdateTripStatus advances the coarse trip status (legacy, DEPRECATED).
//
// SECURITY: this method is no longer routed — its HTTP route was removed because
// it had no object-level authz or phase-transition guard. It is retained only for
// back-compat with the legacy RequestTrip/AcceptTrip flow and any internal caller.
// Defense-in-depth guards are added below so that even if it is ever re-wired it
// fails closed: (1) the caller must be the trip's rider or assigned driver, and
// (2) the coarse status move must be legal for the current phase. Prefer the
// guarded /mobility + /driver state machine (CompleteTrip/CancelRide) instead.
func (s *Service) UpdateTripStatus(ctx context.Context, tripID, actorUserID string, newStatus TripStatus) error {
	var trip tripRow
	if err := s.loadTrip(ctx, tripID, &trip); err != nil {
		return codedErr(http.StatusNotFound, CodeNotFound, "trip not found")
	}
	// Object-level authz: only the rider or the assigned driver may mutate the trip.
	if actorUserID != trip.RiderID {
		if trip.DriverID == nil {
			return codedErr(http.StatusForbidden, CodeForbidden, "not permitted")
		}
		var ownerUser string
		s.db.QueryRow(ctx, `SELECT user_id FROM drivers WHERE id=$1`, *trip.DriverID).Scan(&ownerUser)
		if !tripActorAllowed(actorUserID, trip.RiderID, &ownerUser) {
			return codedErr(http.StatusForbidden, CodeForbidden, "not permitted")
		}
	}
	// Phase-transition guard: map the requested coarse status onto the fine-grained
	// state machine and reject moves that are illegal from the current phase.
	var targetPhase TripPhase
	switch newStatus {
	case TripCompleted:
		targetPhase = PhaseCompleted
	case TripCancelled:
		targetPhase = PhaseCancelled
	case TripPickedUp:
		targetPhase = PhaseInProgress
	case TripAccepted:
		targetPhase = PhaseDriverAssigned
	default:
		return codedErr(http.StatusConflict, CodeInvalidState, "unsupported status transition")
	}
	if trip.Phase != targetPhase && !canTransition(trip.Phase, targetPhase) {
		return codedErr(http.StatusConflict, CodeInvalidState,
			fmt.Sprintf("cannot move trip from phase %s to %s", trip.Phase, targetPhase))
	}
	if _, err := s.db.Exec(ctx, `UPDATE trips SET status=$1, updated_at=NOW() WHERE id=$2`, string(newStatus), tripID); err != nil {
		return err
	}
	if newStatus == TripCompleted && trip.DriverID != nil {
		if err := s.settleTrip(ctx, &trip); err != nil {
			// Same crash-safety contract as CompleteTrip: do not swallow a settlement
			// failure after the trip is marked completed — flag it for reconciliation.
			s.markSettlementPending(ctx, &trip, err)
			return fmt.Errorf("transport: trip completed but settlement failed (marked pending for reconciliation): %w", err)
		}
		s.db.Exec(ctx, `UPDATE drivers SET status='online', completed_trips=completed_trips+1, updated_at=NOW() WHERE id=$1`, *trip.DriverID)
	}
	if newStatus == TripCancelled {
		if err := s.settlement.Refund(ctx, trip.SettlementID, "trip_cancelled"); err != nil {
			return fmt.Errorf("transport: refund fare: %w", err)
		}
		if trip.DriverID != nil {
			s.db.Exec(ctx, `UPDATE drivers SET status='online', cancelled_trips=cancelled_trips+1, updated_at=NOW() WHERE id=$1`, *trip.DriverID)
		}
	}
	return nil
}

// ─── tripRow: full internal projection of a trip ─────────────────────────────

type tripRow struct {
	ID             string
	RiderID        string
	DriverID       *string
	Phase          TripPhase
	Status         string
	ServiceType    string
	PricingMode    string
	FareEstimate   *int64
	FinalFare      *int64
	SettlementID   string
	TripPin        *string
	PickupLat      *float64
	PickupLng      *float64
	DestLat        *float64
	DestLng        *float64
	SafetyStatus   string
	IdempotencyKey string
}

func (s *Service) loadTrip(ctx context.Context, tripID string, t *tripRow) error {
	const q = `
		SELECT id, rider_id, driver_id, phase, status, service_type, pricing_mode,
		       fare_estimate_kobo, final_fare_kobo, settlement_id, trip_pin,
		       pickup_lat, pickup_lng, dest_lat, dest_lng, safety_status, idempotency_key
		FROM trips WHERE id=$1`
	return s.db.QueryRow(ctx, q, tripID).Scan(
		&t.ID, &t.RiderID, &t.DriverID, &t.Phase, &t.Status, &t.ServiceType, &t.PricingMode,
		&t.FareEstimate, &t.FinalFare, &t.SettlementID, &t.TripPin,
		&t.PickupLat, &t.PickupLng, &t.DestLat, &t.DestLng, &t.SafetyStatus, &t.IdempotencyKey,
	)
}

// transitionPhase performs a guarded phase change, writes a trip_events row, and
// optionally mirrors the coarse status. Returns 409 on illegal transition.
func (s *Service) transitionPhase(ctx context.Context, tx pgx.Tx, tripID, actorID string, from, to TripPhase, coarse string, meta map[string]any) error {
	if !canTransition(from, to) {
		return codedErr(http.StatusConflict, CodeInvalidState,
			fmt.Sprintf("illegal trip transition %s → %s", from, to))
	}
	if coarse != "" {
		_, err := tx.Exec(ctx, `UPDATE trips SET phase=$1, status=$2, updated_at=NOW() WHERE id=$3 AND phase=$4`, string(to), coarse, tripID, string(from))
		if err != nil {
			return err
		}
	} else {
		_, err := tx.Exec(ctx, `UPDATE trips SET phase=$1, updated_at=NOW() WHERE id=$2 AND phase=$3`, string(to), tripID, string(from))
		if err != nil {
			return err
		}
	}
	return s.recordEventTx(ctx, tx, tripID, string(to), actorID, from, to, meta)
}

// settleTrip releases all escrow settlements for a trip with the driver's
// commission split.
func (s *Service) settleTrip(ctx context.Context, t *tripRow) error {
	var driverUserID, tier string
	if t.DriverID != nil {
		s.db.QueryRow(ctx, `SELECT user_id, commission_tier FROM drivers WHERE id=$1`, *t.DriverID).Scan(&driverUserID, &tier)
	}
	comm, err := s.commissionForTier(ctx, tier)
	if err != nil {
		return err
	}
	split := settlement.Split{
		ProviderID:  driverUserID,
		ProviderPct: comm.ProviderPct,
		PlatformPct: comm.PlatformPct,
	}
	// Settle every escrowed settlement linked to this trip (base + deltas).
	rows, err := s.db.Query(ctx, `SELECT id FROM settlements WHERE reference LIKE $1 AND status='escrowed'`, "trip:"+t.ID+"%")
	if err != nil {
		return fmt.Errorf("transport: load settlements: %w", err)
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	rows.Close()
	for _, id := range ids {
		if err := s.settlement.Settle(ctx, id, split); err != nil {
			return fmt.Errorf("transport: settle %s: %w", id, err)
		}
	}
	// Record realized Spotlight profit into the central Commission & Profit registry.
	// This is the ride-hailing settlement point (shared by CompleteTrip, the legacy
	// UpdateTripStatus path, and the reconciler re-drive). Best-effort + idempotent:
	// the trip id doubles as source ref + idempotency key, so retries / reconciliation
	// never double-count. gross = the full fare the rider paid (final fare when
	// materialized, else the estimate). A recorder failure is logged and swallowed —
	// it must NEVER fail the fare split above (transport's own settlement already
	// posted the platform cut to the ledger; this appends the earning row only).
	gross := int64(0)
	if t.FinalFare != nil {
		gross = *t.FinalFare
	} else if t.FareEstimate != nil {
		gross = *t.FareEstimate
	}
	riderID := t.RiderID
	s.recordCommissionSafe(ctx, "Lifestyle", "Taxi - Ride Hailing", "", gross, t.ID, &riderID)
	return nil
}

// markSettlementPending records a durable marker when settlement fails AFTER a
// trip has been marked completed. It is deliberately best-effort on writes (a
// failing marker write must not mask the original settlement error) but it MUST
// log at ERROR so operators/alerting see stranded escrow, and it leaves a
// trip_events row + a settlement_status flag for the reconciliation job to pick
// up. Money never leaves escrow here — this only flags that Settle must be retried.
//
// RECONCILIATION REQUIREMENT: a background worker must periodically re-drive
// settleTrip for trips whose settlement_status='pending'; settleTrip is
// idempotent (each Settle no-ops once its settlement row is 'settled').
// settlementPendingStatus is the queryable marker written to trips.settlement_status
// when settlement fails after completion. It MUST match the value permitted by the
// trips.settlement_status CHECK constraint (migration 20260710000000:
// 'settled' | 'settlement_pending' | 'settlement_failed'); previously this was the
// bare string "pending", which violated the CHECK — so the mirror UPDATE silently
// affected 0 rows and the reconciler's flag index was never populated. The
// authoritative recovery signal is still the settlements table (see reconciler.go),
// but the flag must be a legal value so the mirror + partial index work.
const settlementPendingStatus = "settlement_pending"

// settlementPendingEvent is the immutable trip_events event_type for the same.
const settlementPendingEvent = "settlement_pending"

// settlementPendingMarker builds the durable-marker payload recorded when a trip
// was marked completed but settlement failed. Extracted as a pure function so the
// go-live invariant — "the completion-failure path records settlement_pending
// rather than silently succeeding" — is provable in a unit test. It MUST carry the
// settlement id (so reconciliation knows what to re-drive) and the cause.
func settlementPendingMarker(t *tripRow, cause error) map[string]any {
	return map[string]any{
		"settlement_id": t.SettlementID,
		"error":         cause.Error(),
	}
}

func (s *Service) markSettlementPending(ctx context.Context, t *tripRow, cause error) {
	log.Printf("ERROR transport: settlement_pending trip=%s settlement=%s: %v", t.ID, t.SettlementID, cause)
	// Durable audit marker (immutable trip_events row).
	s.recordEvent(ctx, t.ID, settlementPendingEvent, "", "", "", settlementPendingMarker(t, cause))
	// Mirror a queryable flag on the trip. settlement_status is an additive column;
	// if the migrations agent has not yet added it this UPDATE affects 0 rows and is
	// a harmless no-op (the trip_events marker above is still durable). NEEDED COLUMN:
	// trips.settlement_status TEXT DEFAULT 'settled' (see cross-agent note).
	s.db.Exec(ctx, `UPDATE trips SET settlement_status=$2, updated_at=NOW() WHERE id=$1`, t.ID, settlementPendingStatus)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// generatePin returns a deterministic-length random 4-digit trip PIN.
func generatePin() string {
	n, _ := rand.Int(rand.Reader, big.NewInt(10000))
	return fmt.Sprintf("%04d", n.Int64())
}

// tripActorAllowed is the PURE object-level authz decision for a trip mutation:
// the actor is permitted iff they are the trip's rider, or the user who owns the
// assigned driver row. driverUserID is nil when no driver is assigned yet (only
// the rider may act). Extracted as a pure function so the cross-user guard —
// "rider A cannot cancel/rate rider B's trip; a non-assigned driver cannot advance
// it" — is provable in a unit test without a database.
func tripActorAllowed(actorUserID, riderID string, driverUserID *string) bool {
	if actorUserID == riderID {
		return true
	}
	if driverUserID == nil {
		return false
	}
	return actorUserID == *driverUserID
}

// resolveDriverID maps a driver's auth user_id to their driver row id.
func (s *Service) resolveDriverID(ctx context.Context, userID string) (string, error) {
	var id string
	if err := s.db.QueryRow(ctx, `SELECT id FROM drivers WHERE user_id=$1`, userID).Scan(&id); err != nil {
		return "", codedErr(http.StatusForbidden, CodeForbidden, "not a registered driver")
	}
	return id, nil
}
