package transport

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"math/big"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/dbutil"
	"spotlight/backend/go-common/jsonx"
	"spotlight/backend/go-common/timeutil"
	"spotlight/backend/internal/finance/ledger"
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
	db               *pgxpool.Pool
	settlement       *settlement.Service
	tiers            tierLimiter // fail-closed KYC-tier / daily-spend gate on rider money moves
	maps             MapsAdapter
	commission       CommissionRecorder // optional; nil ⇒ realized-profit recording is a no-op
	insurance        InsuranceBinder    // optional; nil ⇒ parcels book/deliver with no real cover
	ledger           *ledger.Service    // required for cash-ride driver-wallet fee debits (WithLedger)
	externalRefunder ExternalRefunder   // optional; nil ⇒ an externally-funded refund logs for manual reconciliation instead of running
}

// ExternalRefunder is the nil-safe seam transport.Service uses to correctly
// unwind a Paystack-funded (EscrowExternal) settlement — the ACTUAL external
// refund plus the matching ledger-side reversal — wherever transport would
// otherwise call settlement.Refund. Refund's only mechanism is a ledger
// CREDIT to the payer's WALLET, which is correct for a wallet-funded escrow
// but WRONG here: money that never left the rider's wallet must never be
// credited INTO it, or a Tier-0 rider ends up with real spendable balance
// funded by an external charge — exactly the hazard EscrowExternal exists to
// avoid. The concrete adapter (transport/paystackcheckout, wired at the
// composition root only when its feature flag is on) resolves the Paystack
// reference for the settlement, calls the gateway's real refund, and then
// settlement.Service.RefundExternal to reverse the internal ledger entry.
// Modeled as a local interface (mirrors CommissionRecorder / InsuranceBinder)
// so transport never imports paystackcheckout or any provider package.
type ExternalRefunder interface {
	// RefundExternalSettlement reverses settlementID, which MUST be an
	// EscrowExternal-funded row (the caller — refundTrip/UpdateTripStatus —
	// checks the trip's payment method before calling this). tripID lets the
	// adapter resolve the Paystack reference it needs for the real gateway
	// refund (the intents table is keyed by trip, not by settlement id).
	// reason is a short machine tag for logging/audit, mirroring
	// settlement.Refund's own reason parameter.
	RefundExternalSettlement(ctx context.Context, tripID, settlementID, reason string) error
}

// SetExternalRefunder injects the Paystack-refund seam (app-wiring,
// post-construction). Nil is accepted: a nil seam means an externally-funded
// refund is logged loudly for manual reconciliation rather than silently
// wallet-crediting the rider (see refundTrip).
func (s *Service) SetExternalRefunder(r ExternalRefunder) { s.externalRefunder = r }

// NewService wires the transport service. A MockMaps adapter is used when none
// is supplied, so business logic always has a deterministic geo backend.
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
// Optional and fail-safe: without it the self-built gate applies, which refuses
// Tier 0 exactly as before. An unwired call site is stricter, never looser.
func (s *Service) WithTiers(t tierLimiter) *Service {
	if t != nil {
		s.tiers = t
	}
	return s
}

// WithLedger injects the shared ledger service used to debit a driver's own
// wallet for the platform's commission on a cash-paid trip (no escrow exists
// to split for those — the rider paid the driver directly). Without this, cash
// trips fail closed: see driverCanCoverCashFee / settleCashTrip.
func (s *Service) WithLedger(l *ledger.Service) *Service {
	if l != nil {
		s.ledger = l
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
		return errors.New("transport: driver not found")
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
		return errors.New("transport: driver not found, not online, or not approved")
	}
	const q = `UPDATE trips SET status='accepted', phase='driver_assigned', driver_id=$1 WHERE id=$2 AND status='requested'`
	tag, err := s.db.Exec(ctx, q, driverID, tripID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("transport: trip not available for acceptance")
	}
	_, _ = s.db.Exec(ctx, `UPDATE drivers SET status='on_trip', updated_at=NOW() WHERE id=$1`, driverID)
	s.recordEvent(ctx, tripID, "driver_assigned", driverUserID, PhaseRequested, PhaseDriverAssigned, nil)
	return nil
}

// UpdateTripStatus advances the coarse trip status (legacy, DEPRECATED).
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
		_ = s.db.QueryRow(ctx, `SELECT user_id FROM drivers WHERE id=$1`, *trip.DriverID).Scan(&ownerUser)
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
		_, _ = s.db.Exec(ctx, `UPDATE drivers SET status='online', completed_trips=completed_trips+1, updated_at=NOW() WHERE id=$1`, *trip.DriverID)
	}
	if newStatus == TripCancelled {
		// Defense-in-depth, matching refundTrip: never wallet-credit a refund for
		// a Paystack-funded trip (see ExternalRefunder's doc comment).
		if isPaystackFunded(trip.PaymentMethod) {
			if s.externalRefunder == nil {
				log.Printf("[transport] cannot refund Paystack-funded settlement=%s trip=%s: no ExternalRefunder wired — needs manual reconciliation", trip.SettlementID, trip.ID)
			} else if err := s.externalRefunder.RefundExternalSettlement(ctx, trip.ID, trip.SettlementID, "trip_cancelled"); err != nil {
				return fmt.Errorf("transport: external refund fare: %w", err)
			}
		} else if err := s.settlement.Refund(ctx, trip.SettlementID, "trip_cancelled"); err != nil {
			return fmt.Errorf("transport: refund fare: %w", err)
		}
		if trip.DriverID != nil {
			_, _ = s.db.Exec(ctx, `UPDATE drivers SET status='online', cancelled_trips=cancelled_trips+1, updated_at=NOW() WHERE id=$1`, *trip.DriverID)
		}
	}
	return nil
}

type tripRow struct {
	ID             string
	RiderID        string
	DriverID       *string
	Phase          TripPhase
	Status         string
	ServiceType    string
	PricingMode    string
	PaymentMethod  string
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
		SELECT id, rider_id, driver_id, phase, status, service_type, pricing_mode, payment_method,
		       fare_estimate_kobo, final_fare_kobo, COALESCE(settlement_id::text,''), trip_pin,
		       pickup_lat, pickup_lng, dest_lat, dest_lng, safety_status, idempotency_key
		FROM trips WHERE id=$1`
	return s.db.QueryRow(ctx, q, tripID).Scan(
		&t.ID, &t.RiderID, &t.DriverID, &t.Phase, &t.Status, &t.ServiceType, &t.PricingMode, &t.PaymentMethod,
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
	var tag pgconn.CommandTag
	var err error
	if coarse != "" {
		tag, err = tx.Exec(ctx, `UPDATE trips SET phase=$1, status=$2, updated_at=NOW() WHERE id=$3 AND phase=$4`, string(to), coarse, tripID, string(from))
	} else {
		tag, err = tx.Exec(ctx, `UPDATE trips SET phase=$1, updated_at=NOW() WHERE id=$2 AND phase=$3`, string(to), tripID, string(from))
	}
	if err != nil {
		return err
	}
	// A stale `from` phase yields a 0-row UPDATE — e.g. the rider's cancel
	// committed between the caller's loadTrip and this write. Committing
	// anyway would post the settlement leg anyway (the escrow is still
	// 'escrowed' until Refund flips it) AND record a phantom event; fail the
	// tx so the caller rolls back instead.
	if tag.RowsAffected() == 0 {
		return codedErr(http.StatusConflict, CodeInvalidState,
			fmt.Sprintf("trip %s no longer in phase %s", tripID, from))
	}
	return s.recordEventTx(ctx, tx, tripID, string(to), actorID, from, to, meta)
}

// settleTrip releases all escrow settlements for a trip with the driver's
// commission split.
func (s *Service) settleTrip(ctx context.Context, t *tripRow) error {
	var driverUserID, tier string
	if t.DriverID != nil {
		_ = s.db.QueryRow(ctx, `SELECT user_id, commission_tier FROM drivers WHERE id=$1`, *t.DriverID).Scan(&driverUserID, &tier)
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
	// Cash trips have no escrow (the ids loop above is empty for them) — the
	// platform's commission instead comes straight out of the driver's own
	// wallet, since the rider already paid the driver directly, out of band.
	if isCashPayment(t.PaymentMethod) {
		if err := s.settleCashTrip(ctx, t); err != nil {
			return fmt.Errorf("transport: settle cash fee: %w", err)
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
// RECONCILIATION REQUIREMENT: a background worker must periodically re-drive
// settleTrip for trips whose settlement_status='pending'; settleTrip is
// idempotent (each Settle no-ops once its settlement row is 'settled').
// settlementPendingStatus is the queryable marker written to trips.settlement_status
// when settlement fails after completion. It MUST match the value permitted by the
// trips.settlement_status CHECK constraint (migration 20260710000000:
// 'settled' | 'settlement_pending' | 'settlement_failed') — any other value makes
// the mirror UPDATE silently affect 0 rows. The authoritative recovery signal is
// still the settlements table (see reconciler.go), but the flag must be a legal
// value so the mirror + partial index work.
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
	// if the migration has not yet added it this UPDATE affects 0 rows and is a
	// harmless no-op (the trip_events marker above is still durable). Expected
	// column: trips.settlement_status TEXT DEFAULT 'settled'.
	_, _ = s.db.Exec(ctx, `UPDATE trips SET settlement_status=$2, updated_at=NOW() WHERE id=$1`, t.ID, settlementPendingStatus)
}

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

// recordEvent inserts an immutable trip_events row outside a transaction.
func (s *Service) recordEvent(ctx context.Context, tripID, eventType, actorID string, from, to TripPhase, meta map[string]any) {
	var metaJSON []byte
	if meta != nil {
		metaJSON = jsonx.Marshal(meta)
	}
	const q = `
		INSERT INTO trip_events (trip_id, event_type, actor_id, from_phase, to_phase, metadata)
		VALUES ($1,$2,$3,$4,$5,$6)`
	_, _ = s.db.Exec(ctx, q, tripID, eventType, dbutil.NullStr(actorID), nullPhase(from), nullPhase(to), metaJSON)
}

// recordEventTx inserts a trip_events row inside a transaction (atomic with the transition).
func (s *Service) recordEventTx(ctx context.Context, tx pgx.Tx, tripID, eventType, actorID string, from, to TripPhase, meta map[string]any) error {
	var metaJSON []byte
	if meta != nil {
		metaJSON = jsonx.Marshal(meta)
	}
	const q = `
		INSERT INTO trip_events (trip_id, event_type, actor_id, from_phase, to_phase, metadata)
		VALUES ($1,$2,$3,$4,$5,$6)`
	_, err := tx.Exec(ctx, q, tripID, eventType, dbutil.NullStr(actorID), nullPhase(from), nullPhase(to), metaJSON)
	return err
}

func nullPhase(p TripPhase) any {
	if p == "" {
		return nil
	}
	return string(p)
}

// writeAudit inserts a row into transport_audit_log. Every admin mutation must
// call this. old/new are JSON-serialised; nil values are stored as SQL NULL.
func writeAudit(ctx context.Context, db *pgxpool.Pool, adminID, action, entityType, entityID string, oldVal, newVal any, reason string) error {
	var oldJSON, newJSON []byte
	if oldVal != nil {
		oldJSON = jsonx.Marshal(oldVal)
	}
	if newVal != nil {
		newJSON = jsonx.Marshal(newVal)
	}
	const q = `
		INSERT INTO transport_audit_log (admin_id, action, entity_type, entity_id, old_value, new_value, reason)
		VALUES ($1,$2,$3,$4,$5,$6,NULLIF($7,''))`
	_, err := db.Exec(ctx, q, adminID, action, entityType, dbutil.NullStr(entityID), oldJSON, newJSON, reason)
	return err
}

// stuckTripSelect is the authoritative crash-recovery predicate for ride-hailing
// settlement. CompleteTrip commits the trip as phase='completed' FIRST and only
// THEN drives settleTrip (which opens the settlement engine's own tx on a separate
// connection). A crash — or a settleTrip error — between the completion commit and
// the escrow release leaves a completed trip with escrow still held. The
// settlements table is the money source of truth: a completed trip that still has
// ANY linked settlement in status='escrowed' is stranded, regardless of whether
// the best-effort trips.settlement_status mirror was written (that mirror UPDATE is
// intentionally non-fatal). We therefore select on the settlements table directly
// so the sweep is correct even when the flag mirror was skipped.
// The grace window ($1, a Postgres interval literal) excludes trips completed too
// recently to have finished settling, so the sweep never races an in-flight
// CompleteTrip that is mid-settle. DISTINCT because settleTrip settles base + delta
// escrows for one trip, which can produce multiple escrowed rows per trip.
const stuckTripSelect = `
	SELECT DISTINCT t.id
	FROM trips t
	JOIN settlements s ON s.reference LIKE 'trip:' || t.id || '%'
	WHERE t.phase = 'completed'
	  AND s.status = 'escrowed'
	  AND s.module_type = 'transport'
	  AND t.updated_at < NOW() - $1::interval
	ORDER BY t.id
	LIMIT 200`

// ReconcileStuckSettlements is the reconciliation worker documented in
// service.go / dispatch.go: it re-drives settleTrip for completed trips whose
// escrow never released after a crash. It reuses the SAME settleTrip path as the
// live CompleteTrip flow, so it is idempotent — settleTrip re-queries only the
// still-'escrowed' rows and calls settlement.Settle, which is guarded WHERE the
// row is 'escrowed' (already-settled rows no-op) and posts every ledger leg with
// ON CONFLICT (idempotency_key) DO NOTHING. Overlapping sweeps (or a sweep racing
// a client retry) converge to exactly one payout via the FOR UPDATE lock inside
// Settle. On success it flips the trips.settlement_status mirror back to 'settled'.
// Returns the count of trips fully reconciled.
func (s *Service) ReconcileStuckSettlements(ctx context.Context, graceInterval time.Duration) (int, error) {
	grace := timeutil.IntervalSeconds(graceInterval)
	rows, err := s.db.Query(ctx, stuckTripSelect, grace)
	if err != nil {
		return 0, err
	}
	var tripIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		tripIDs = append(tripIDs, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	reconciled := 0
	for _, id := range tripIDs {
		var t tripRow
		if err := s.loadTrip(ctx, id, &t); err != nil {
			log.Printf("[transport] reconcile load trip=%s failed: %v", id, err)
			continue
		}
		if err := s.settleTrip(ctx, &t); err != nil {
			// One stuck trip must not abort the whole sweep — log and move on.
			log.Printf("[transport] reconcile settle trip=%s failed: %v", id, err)
			continue
		}
		reconciled++
		// Clear the crash-safety mirror now that escrow is released. Best-effort:
		// the settlements table already reflects the truth. A legal CHECK value.
		_, _ = s.db.Exec(ctx, `UPDATE trips SET settlement_status='settled', updated_at=NOW() WHERE id=$1`, id)
		log.Printf("[transport] reconcile settled stranded escrow trip=%s", id)
	}
	return reconciled, nil
}

// formatInterval renders a duration as a whole-second Postgres interval literal
// (e.g. "300 seconds"). Extracted as a pure function so the grace-window predicate
// is unit-testable without a database. Non-positive clamps to 0 (all completed
// trips with escrow are eligible).
func formatInterval(d time.Duration) string {
	return timeutil.IntervalSeconds(d)
}

// StartStuckSettlementReconciler runs ReconcileStuckSettlements on a ticker until
// ctx is cancelled. Mirrors top5events.StartPendingOrderReconciler /
// restaurant.StartStuckSettlementReconciler. interval is the tick cadence; grace
// is how long a completed trip may hold escrow before it is swept (kept longer
// than a live settleTrip takes so the sweep never races an in-flight completion).
// Wired from RegisterFinance under the transport feature flag.
func StartStuckSettlementReconciler(ctx context.Context, svc *Service, interval, grace time.Duration) {
	if svc == nil || svc.db == nil {
		return
	}
	if interval <= 0 {
		interval = 5 * time.Minute
	}
	if grace <= 0 {
		grace = 10 * time.Minute
	}
	run := func() {
		cctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
		defer cancel()
		n, err := svc.ReconcileStuckSettlements(cctx, grace)
		if err != nil {
			log.Printf("[transport] stuck-settlement sweep error: %v", err)
			return
		}
		if n > 0 {
			log.Printf("[transport] stuck-settlement sweep: reconciled=%d", n)
		}
	}
	go func() {
		run()
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				run()
			}
		}
	}()
	log.Printf("[transport] stuck-settlement reconciler started (interval %s, grace %s)", interval, grace)
}

// ShareLink is the openable live-share response for a trip.
type ShareLink struct {
	ShareToken string    `json:"shareToken"`
	URL        string    `json:"url"`
	ExpiresAt  time.Time `json:"expiresAt"`
}

// shareLinkTTL is how long a live-share link stays resolvable.
const shareLinkTTL = 2 * time.Hour

// shareBaseURL is the public base for a share link. TODO(config): move to
// PricingConfig/app config once a public web base URL is threaded through.
const shareBaseURL = "https://spotlight.app/track"

// sosRequiresDriver is the pure authz decision for a standalone safety
// incident: a trip-bound SOS is already gated by trip participation, but an
// SOS with no trip has no object to authz against, so it must carry the same
// registered-driver gate every sibling /driver/* route enforces
// (resolveDriverID). Without it any authenticated user could flood
// safety_incidents with fake criticals (prod probe, w9-transport).
func sosRequiresDriver(tripID *string) bool { return tripID == nil }

// CreateIncident records a safety case. SOS-type incidents from a rider/driver
// also flag the trip's safety_status and move it to safety_hold when active.
func (s *Service) CreateIncident(ctx context.Context, userID string, incType string, tripID *string, lat, lng *float64, description, severity string) (*SafetyIncident, error) {
	if severity == "" {
		severity = "high"
	}
	if sosRequiresDriver(tripID) {
		if _, err := s.resolveDriverID(ctx, userID); err != nil {
			return nil, err
		}
	}
	// An SOS tied to a trip requires the caller to be a trip participant —
	// unrestricted, it let ANY signed-in user write incidents against and
	// force ANY trip into safety_hold, and safety_hold → cancelled refunds
	// the escrow, so it doubled as a payment-evasion / trip-griefing vector.
	if tripID != nil && incType == "sos" {
		riderID, driverUserID, err := s.tripParties(ctx, *tripID)
		if err != nil {
			return nil, err
		}
		if userID != riderID && (driverUserID == "" || userID != driverUserID) {
			return nil, codedErr(http.StatusForbidden, CodeForbidden, "not a participant of this trip")
		}
	}
	inc := &SafetyIncident{
		ID:       uuid.New().String(),
		UserID:   userID,
		TripID:   tripID,
		Type:     incType,
		Severity: severity,
		Lat:      lat,
		Lng:      lng,
		Status:   "open",
	}
	const q = `
		INSERT INTO safety_incidents (id, user_id, trip_id, type, severity, lat, lng, description, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,NULLIF($8,''),'open')
		RETURNING created_at`
	if err := s.db.QueryRow(ctx, q, inc.ID, userID, tripID, incType, severity, lat, lng, description).Scan(&inc.CreatedAt); err != nil {
		return nil, err
	}
	if description != "" {
		inc.Description = &description
	}

	// For an active trip, raise the trip's safety_status and hold it.
	if tripID != nil && incType == "sos" {
		var t tripRow
		if err := s.loadTrip(ctx, *tripID, &t); err == nil {
			_, _ = s.db.Exec(ctx, `UPDATE trips SET safety_status='sos' WHERE id=$1`, *tripID)
			if canTransition(t.Phase, PhaseSafetyHold) {
				_, _ = s.db.Exec(ctx, `UPDATE trips SET phase='safety_hold', updated_at=NOW() WHERE id=$1`, *tripID)
				s.recordEvent(ctx, *tripID, "safety_hold", userID, t.Phase, PhaseSafetyHold, map[string]any{"incident_id": inc.ID})
			}
		}
	}
	return inc, nil
}

// ShareToken issues a live-share link for a trip (object-authz: rider only) and
// PERSISTS it so the link is actually openable later via ResolveShare.
// Persistence: we store the token in a trip_events row (event_type='share_link'),
// which is an existing durable table — no new column/table is required. The token
// + its expiry live in the row's metadata JSONB. ResolveShare looks the token up
// there. NOTE for the migrations agent: a dedicated trip_shares table
// (token PK, trip_id, expires_at, revoked_at) would be cleaner and allow
// revocation + indexed lookups; if/when added, switch ShareToken/ResolveShare to
// it. For now the trip_events approach is additive-only and works.
func (s *Service) ShareToken(ctx context.Context, tripID, riderID string) (*ShareLink, error) {
	var owner string
	if err := s.db.QueryRow(ctx, `SELECT rider_id FROM trips WHERE id=$1`, tripID).Scan(&owner); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "trip not found")
	}
	if owner != riderID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not your trip")
	}
	token := "share_" + uuid.New().String()
	expiresAt := time.Now().Add(shareLinkTTL)
	// Durable, immutable audit row that doubles as the token store.
	s.recordEvent(ctx, tripID, "share_link", riderID, "", "", map[string]any{
		"share_token": token,
		"expires_at":  expiresAt.Format(time.RFC3339),
	})
	return &ShareLink{
		ShareToken: token,
		URL:        shareBaseURL + "/" + token,
		ExpiresAt:  expiresAt,
	}, nil
}

// ResolveShare resolves a live-share token to the trip it tracks, enforcing the
// TTL. It is intentionally unauthenticated (a share link must be openable by
// someone without an account) but returns only non-sensitive tracking fields —
// never the trip PIN. Returns the trip id + a minimal public view.
func (s *Service) ResolveShare(ctx context.Context, token string) (map[string]any, error) {
	const q = `
		SELECT trip_id, metadata
		FROM trip_events
		WHERE event_type='share_link' AND metadata->>'share_token' = $1
		ORDER BY created_at DESC LIMIT 1`
	var tripID string
	var metaRaw []byte
	if err := s.db.QueryRow(ctx, q, token).Scan(&tripID, &metaRaw); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "share link not found")
	}
	var meta map[string]any
	_ = json.Unmarshal(metaRaw, &meta)
	if exp, ok := meta["expires_at"].(string); ok {
		if t, err := time.Parse(time.RFC3339, exp); err == nil && time.Now().After(t) {
			return nil, codedErr(http.StatusGone, CodeInvalidState, "share link expired")
		}
	}
	// Minimal public tracking view (no PIN, no phone/PII).
	const tq = `
		SELECT id, phase, status, pickup_address, dest_address,
		       pickup_lat, pickup_lng, dest_lat, dest_lng, route_polyline, safety_status
		FROM trips WHERE id=$1`
	var (
		id, phase, status, pickup, dest, safety string
		polyline                                *string
		plat, plng, dlat, dlng                  *float64
	)
	if err := s.db.QueryRow(ctx, tq, tripID).Scan(
		&id, &phase, &status, &pickup, &dest, &plat, &plng, &dlat, &dlng, &polyline, &safety,
	); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "trip not found")
	}
	return map[string]any{
		"tripId":        id,
		"phase":         phase,
		"status":        status,
		"pickupAddress": pickup,
		"destAddress":   dest,
		"pickup":        map[string]any{"lat": plat, "lng": plng},
		"dest":          map[string]any{"lat": dlat, "lng": dlng},
		"routePolyline": polyline,
		"safetyStatus":  safety,
	}, nil
}

func (s *Service) ListTrustedContacts(ctx context.Context, userID string) ([]TrustedContact, error) {
	rows, err := s.db.Query(ctx, `SELECT id, user_id, name, phone, created_at FROM trusted_contacts WHERE user_id=$1 ORDER BY created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TrustedContact
	for rows.Next() {
		var c TrustedContact
		if err := rows.Scan(&c.ID, &c.UserID, &c.Name, &c.Phone, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, nil
}

func (s *Service) AddTrustedContact(ctx context.Context, userID, name, phone string) (*TrustedContact, error) {
	c := &TrustedContact{ID: uuid.New().String(), UserID: userID, Name: name, Phone: phone}
	if err := s.db.QueryRow(ctx,
		`INSERT INTO trusted_contacts (id, user_id, name, phone) VALUES ($1,$2,$3,$4) RETURNING created_at`,
		c.ID, userID, name, phone).Scan(&c.CreatedAt); err != nil {
		return nil, err
	}
	return c, nil
}

func (s *Service) DeleteTrustedContact(ctx context.Context, userID, id string) error {
	// trusted_contacts.id is uuid — a malformed id can never match a row, so
	// answer not-found (same as a missing id) rather than letting Postgres's
	// 22P02 syntax error surface as a 500.
	if _, err := uuid.Parse(id); err != nil {
		return codedErr(http.StatusNotFound, CodeNotFound, "contact not found")
	}
	tag, err := s.db.Exec(ctx, `DELETE FROM trusted_contacts WHERE id=$1 AND user_id=$2`, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return codedErr(http.StatusNotFound, CodeNotFound, "contact not found")
	}
	return nil
}

// isCashPayment reports whether a trip's payment_method is the cash rail —
// the rider pays the driver directly, out of band, so no fare is ever
// escrowed through the app. Instead the platform collects its commission by
// debiting the driver's own wallet once the trip completes (settleCashTrip),
// and a driver who can't cover that fee never sees or can accept the ride
// (see driverCanCoverCashFee).
func isCashPayment(paymentMethod string) bool {
	return paymentMethod == "cash"
}

// paymentMethodPaystackExternal marks a trip as funded by the Paystack-checkout
// rail (RequestRidePaystackFunded / settlement.EscrowExternal) — never client-
// settable (see RequestRideRequest's binding tag, which does not include it;
// this value is only ever set internally by transport/paystackcheckout).
// Distinct from the legacy "card" value, which today behaves identically to
// "wallet" (a real wallet escrow) — repurposing it here would have silently
// changed behavior for any existing "card" trip.
// isPaystackFunded gates adjustEscrow: a trip funded this way has no wallet
// debit and no open card session to charge more from, so a later fare RAISE
// (RiderOffer/AcceptCounter) cannot be honoured by escrowing more — see
// adjustEscrow.
const paymentMethodPaystackExternal = "paystack"

func isPaystackFunded(paymentMethod string) bool {
	return paymentMethod == paymentMethodPaystackExternal
}

// platformFeeKobo computes the platform's commission on a cash trip's fare
// using the SAME commission split (commissionForTier) instant/wallet trips
// settle with, so a cash rider and a wallet rider on the same driver tier
// cost the platform — and thus the driver — an identical percentage.
func (s *Service) platformFeeKobo(ctx context.Context, driverTier string, fareKobo int64) (int64, error) {
	comm, err := s.commissionForTier(ctx, driverTier)
	if err != nil {
		return 0, err
	}
	return int64(math.Round(float64(fareKobo) * comm.PlatformPct)), nil
}

// driverCanCoverCashFee reports whether driverUserID's own wallet balance
// covers the platform fee a cash trip at fareKobo would owe at THEIR
// commission tier. Fails closed: any lookup error is treated as "cannot
// afford" so a driver is never let onto (or kept on) a cash ride they can't
// pay the platform's cut for. This is the gate applied to the open-requests
// feed (OpenRequests) and re-checked at accept time (DriverAccept).
func (s *Service) driverCanCoverCashFee(ctx context.Context, driverUserID string, fareKobo int64) (bool, error) {
	if s.ledger == nil {
		return false, errors.New("transport: ledger not wired")
	}
	var tier string
	if err := s.db.QueryRow(ctx, `SELECT commission_tier FROM drivers WHERE user_id=$1`, driverUserID).Scan(&tier); err != nil {
		return false, fmt.Errorf("transport: resolve driver tier: %w", err)
	}
	fee, err := s.platformFeeKobo(ctx, tier, fareKobo)
	if err != nil {
		return false, err
	}
	if fee <= 0 {
		return true, nil
	}
	balance, err := s.ledger.GetBalance(ctx, driverUserID)
	if err != nil {
		return false, fmt.Errorf("transport: driver balance: %w", err)
	}
	return balance >= fee, nil
}

// CompletionSummary returns what a driver's app needs to show after
// CompleteTrip: the fare, payment method, and — for cash trips only — the
// platform fee that was just debited from the driver's own wallet (so the UI
// can say "you collected ₦X in cash, ₦Y was deducted as the platform fee"
// instead of the wallet/card-trip "your share has been added to your
// wallet" copy, which is wrong for cash).
func (s *Service) CompletionSummary(ctx context.Context, tripID string) (map[string]any, error) {
	var driverID *string
	var paymentMethod string
	var fareKobo int64
	var finalFare *int64
	if err := s.db.QueryRow(ctx, `SELECT driver_id, payment_method, fare_kobo, final_fare_kobo FROM trips WHERE id=$1`, tripID).
		Scan(&driverID, &paymentMethod, &fareKobo, &finalFare); err != nil {
		return nil, fmt.Errorf("transport: load trip for summary: %w", err)
	}
	if finalFare != nil {
		fareKobo = *finalFare
	}
	out := map[string]any{"paymentMethod": paymentMethod, "fareKobo": fareKobo}
	if isCashPayment(paymentMethod) && driverID != nil {
		var tier string
		_ = s.db.QueryRow(ctx, `SELECT commission_tier FROM drivers WHERE id=$1`, *driverID).Scan(&tier)
		if fee, err := s.platformFeeKobo(ctx, tier, fareKobo); err == nil {
			out["platformFeeKobo"] = fee
		}
	}
	return out, nil
}

// settleCashTrip collects the platform's commission on a cash-paid, completed
// trip by debiting the driver's own wallet directly and crediting the
// standing platform-revenue account — there is no escrow to split, since the
// rider paid the driver in cash, out of band. Idempotent (keyed on the trip
// id, safe to re-drive). A failure here (e.g. the driver's balance dropped
// between accept and completion, despite the accept-time gate) is treated by
// the caller (settleTrip / CompleteTrip) exactly like an escrow-settlement
// failure: the trip stays completed and the debt is flagged for
// reconciliation rather than blocking a ride that has already happened.
func (s *Service) settleCashTrip(ctx context.Context, t *tripRow) error {
	if s.ledger == nil {
		return errors.New("transport: ledger not wired")
	}
	if t.DriverID == nil {
		return nil // no driver was ever assigned — nothing owed
	}
	var driverUserID, tier string
	if err := s.db.QueryRow(ctx, `SELECT user_id, commission_tier FROM drivers WHERE id=$1`, *t.DriverID).Scan(&driverUserID, &tier); err != nil {
		return fmt.Errorf("transport: resolve driver: %w", err)
	}
	fare := int64(0)
	if t.FinalFare != nil {
		fare = *t.FinalFare
	} else if t.FareEstimate != nil {
		fare = *t.FareEstimate
	}
	fee, err := s.platformFeeKobo(ctx, tier, fare)
	if err != nil {
		return err
	}
	if fee <= 0 {
		return nil
	}
	revAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		return fmt.Errorf("transport: resolve platform revenue account: %w", err)
	}
	ref := "trip:" + t.ID + ":cash_fee"
	idem := "cash_fee:" + t.ID
	if err := s.ledger.Debit(ctx, driverUserID, ref, idem, revAcc.ID, fee); err != nil {
		return fmt.Errorf("transport: debit driver cash fee: %w", err)
	}
	return nil
}
