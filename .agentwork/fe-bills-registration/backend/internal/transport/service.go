package transport

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"spotlight/backend/internal/finance/settlement"
)

// Service manages driver registration, trip lifecycle, and fare settlement.
type Service struct {
	db         *pgxpool.Pool
	settlement *settlement.Service
}

func NewService(db *pgxpool.Pool, settlement *settlement.Service) *Service {
	return &Service{db: db, settlement: settlement}
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

// SetDriverStatus updates a driver's availability.
func (s *Service) SetDriverStatus(ctx context.Context, userID string, status DriverStatus) error {
	const q = `UPDATE drivers SET status=$1 WHERE user_id=$2`
	tag, err := s.db.Exec(ctx, q, string(status), userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("transport: driver not found")
	}
	return nil
}

// RequestTrip escrows the fare and creates a trip in requested state.
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
		INSERT INTO trips (id, rider_id, pickup_address, dest_address, fare_kobo, status, idempotency_key, settlement_id)
		VALUES ($1,$2,$3,$4,$5,'requested',$6,$7)`
	if _, err := s.db.Exec(ctx, q,
		trip.ID, trip.RiderID, trip.PickupAddress, trip.DestAddress,
		trip.FareKobo, trip.IdempotencyKey, trip.SettlementID,
	); err != nil {
		return nil, fmt.Errorf("transport: insert trip: %w", err)
	}
	return trip, nil
}

// AcceptTrip assigns a driver to a requested trip.
func (s *Service) AcceptTrip(ctx context.Context, tripID, driverUserID string) error {
	var driverID string
	if err := s.db.QueryRow(ctx, `SELECT id FROM drivers WHERE user_id=$1 AND status='online'`, driverUserID).Scan(&driverID); err != nil {
		return fmt.Errorf("transport: driver not found or not online")
	}
	const q = `UPDATE trips SET status='accepted', driver_id=$1 WHERE id=$2 AND status='requested'`
	tag, err := s.db.Exec(ctx, q, driverID, tripID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("transport: trip not available for acceptance")
	}
	s.db.Exec(ctx, `UPDATE drivers SET status='on_trip' WHERE id=$1`, driverID)
	return nil
}

// UpdateTripStatus advances the trip status. Completing a trip triggers settlement.
// Split: 80% driver, 10% platform, 10% reserved (0% rider surcharge model).
func (s *Service) UpdateTripStatus(ctx context.Context, tripID, actorUserID string, newStatus TripStatus) error {
	var trip Trip
	if err := s.db.QueryRow(ctx, `SELECT id, rider_id, driver_id, status, settlement_id FROM trips WHERE id=$1`,
		tripID).Scan(&trip.ID, &trip.RiderID, &trip.DriverID, &trip.Status, &trip.SettlementID); err != nil {
		return fmt.Errorf("transport: trip not found")
	}

	if _, err := s.db.Exec(ctx, `UPDATE trips SET status=$1 WHERE id=$2`, string(newStatus), tripID); err != nil {
		return err
	}

	if newStatus == TripCompleted && trip.DriverID != nil {
		// Resolve driver user ID for settlement.
		var driverUserID string
		s.db.QueryRow(ctx, `SELECT user_id FROM drivers WHERE id=$1`, *trip.DriverID).Scan(&driverUserID)
		split := settlement.Split{
			ProviderID:  driverUserID,
			ProviderPct: 0.80,
			PlatformPct: 0.20,
		}
		if err := s.settlement.Settle(ctx, trip.SettlementID, split); err != nil {
			return fmt.Errorf("transport: settle fare: %w", err)
		}
		s.db.Exec(ctx, `UPDATE drivers SET status='online' WHERE id=$1`, *trip.DriverID)
	}

	if newStatus == TripCancelled {
		if err := s.settlement.Refund(ctx, trip.SettlementID, "trip_cancelled"); err != nil {
			return fmt.Errorf("transport: refund fare: %w", err)
		}
		if trip.DriverID != nil {
			s.db.Exec(ctx, `UPDATE drivers SET status='online' WHERE id=$1`, *trip.DriverID)
		}
	}
	return nil
}
