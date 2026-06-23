package transport

import (
	"context"
	"crypto/rand"
	"fmt"
	"math/big"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"spotlight/backend/internal/finance/settlement"
)

// Service manages driver registration, trip lifecycle, fare negotiation, and settlement.
type Service struct {
	db         *pgxpool.Pool
	settlement *settlement.Service
	maps       MapsAdapter
}

// NewService wires the transport service. A MockMaps adapter is used when none
// is supplied, so business logic always has a deterministic geo backend.
func NewService(db *pgxpool.Pool, settlement *settlement.Service) *Service {
	return &Service{db: db, settlement: settlement, maps: NewMockMaps()}
}

// WithMaps swaps the maps adapter (e.g. a live provider in production).
func (s *Service) WithMaps(m MapsAdapter) *Service {
	s.maps = m
	return s
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

// UpdateTripStatus advances the coarse trip status (legacy). Completing settles.
func (s *Service) UpdateTripStatus(ctx context.Context, tripID, actorUserID string, newStatus TripStatus) error {
	var trip tripRow
	if err := s.loadTrip(ctx, tripID, &trip); err != nil {
		return fmt.Errorf("transport: trip not found")
	}
	if _, err := s.db.Exec(ctx, `UPDATE trips SET status=$1, updated_at=NOW() WHERE id=$2`, string(newStatus), tripID); err != nil {
		return err
	}
	if newStatus == TripCompleted && trip.DriverID != nil {
		if err := s.settleTrip(ctx, &trip); err != nil {
			return err
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
	return nil
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// generatePin returns a deterministic-length random 4-digit trip PIN.
func generatePin() string {
	n, _ := rand.Int(rand.Reader, big.NewInt(10000))
	return fmt.Sprintf("%04d", n.Int64())
}

// resolveDriverID maps a driver's auth user_id to their driver row id.
func (s *Service) resolveDriverID(ctx context.Context, userID string) (string, error) {
	var id string
	if err := s.db.QueryRow(ctx, `SELECT id FROM drivers WHERE user_id=$1`, userID).Scan(&id); err != nil {
		return "", codedErr(http.StatusForbidden, CodeForbidden, "not a registered driver")
	}
	return id, nil
}
