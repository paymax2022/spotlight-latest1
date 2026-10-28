package hail

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"
)

const lockTTL = 30 * time.Second

type Service struct {
	repo     Repository
	lock     Locker
	ledger   Ledger
	baseFare int64
}

func NewService(repo Repository, lock Locker, ledger Ledger) *Service {
	return &Service{repo: repo, lock: lock, ledger: ledger, baseFare: DefaultBaseFareKobo}
}

func validCoord(lat, lon float64) bool {
	return !math.IsNaN(lat) && !math.IsNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
}

// RequestTrip creates a trip priced with current surge. Replays of the same
// (rider, idempotencyKey) return the original trip without re-pricing.
func (s *Service) RequestTrip(ctx context.Context, riderID string, pLat, pLon, dLat, dLon float64, idemKey string) (*Trip, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyKey
	}
	if riderID == "" || !validCoord(pLat, pLon) || !validCoord(dLat, dLon) {
		return nil, ErrInvalidInput
	}
	active, avail, err := s.repo.DemandSupply(ctx)
	if err != nil {
		return nil, fmt.Errorf("transport: demand: %w", err)
	}
	bps := SurgeBPS(active, avail)
	t := &Trip{
		RiderID: riderID, PickupLat: pLat, PickupLon: pLon, DropoffLat: dLat, DropoffLon: dLon,
		Status: StatusRequested, BaseFareKobo: s.baseFare, SurgeBPS: bps,
		FareKobo: Fare(s.baseFare, bps), IdempotencyKey: idemKey,
	}
	got, _, err := s.repo.CreateTrip(ctx, t)
	return got, err
}

// ConfirmDriver matches the calling driver to a trip under a distributed lock.
// Two locks are taken (trip, then driver) so a trip cannot be double-won and a
// driver cannot be double-booked. Contention returns ErrLockContended.
func (s *Service) ConfirmDriver(ctx context.Context, tripID, driverUserID, idemKey string) (*Trip, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyKey
	}
	drv, err := s.repo.DriverByUser(ctx, driverUserID)
	if err != nil {
		return nil, ErrForbidden
	}
	tripKey, drvKey := "transport:trip:"+tripID, "transport:driver:"+drv.ID
	tTok, ok, err := s.lock.Acquire(ctx, tripKey, lockTTL)
	if err != nil {
		return nil, fmt.Errorf("transport: lock: %w", err)
	}
	if !ok {
		return nil, ErrLockContended
	}
	defer func() { _ = s.lock.Release(context.WithoutCancel(ctx), tripKey, tTok) }()
	dTok, ok, err := s.lock.Acquire(ctx, drvKey, lockTTL)
	if err != nil {
		return nil, fmt.Errorf("transport: lock: %w", err)
	}
	if !ok {
		return nil, ErrLockContended
	}
	defer func() { _ = s.lock.Release(context.WithoutCancel(ctx), drvKey, dTok) }()

	cur, err := s.repo.GetTrip(ctx, tripID)
	if err != nil {
		return nil, err
	}
	// Idempotent replay: this driver already holds the trip.
	if cur.Status == StatusMatched && cur.DriverID != nil && *cur.DriverID == drv.ID {
		return cur, nil
	}
	if cur.Status != StatusRequested {
		return nil, ErrNotRequested
	}
	return s.repo.AssignDriver(ctx, tripID, drv.ID)
}

// CompleteTrip settles the fare (70% driver / 30% platform) and closes the trip.
// Only the assigned driver may complete. Ledger posting is idempotent per trip,
// so a crash between posting and the status update is safe to retry.
func (s *Service) CompleteTrip(ctx context.Context, tripID, driverUserID, idemKey string) (*Trip, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyKey
	}
	drv, err := s.repo.DriverByUser(ctx, driverUserID)
	if err != nil {
		return nil, ErrForbidden
	}
	t, err := s.repo.GetTrip(ctx, tripID)
	if err != nil {
		return nil, err
	}
	if t.DriverID == nil || *t.DriverID != drv.ID {
		return nil, ErrForbidden
	}
	if t.Status == StatusCompleted {
		return t, nil
	}
	if t.Status != StatusMatched {
		return nil, ErrNotMatched
	}
	dShare, pShare := Split(t.FareKobo)
	if err := s.ledger.Settle(ctx, "transport:trip:"+t.ID+":settle", t.ID, t.RiderID, driverUserID, t.FareKobo, dShare, pShare); err != nil {
		if errors.Is(err, ErrInsufficientFunds) {
			return nil, err
		}
		return nil, fmt.Errorf("transport: settle: %w", err)
	}
	return s.repo.CompleteTrip(ctx, t.ID, dShare, pShare)
}

// GetTrip is owner-scoped: only the rider or the assigned driver may read it.
// Anyone else gets ErrNotFound (no existence leak).
func (s *Service) GetTrip(ctx context.Context, tripID, userID string) (*Trip, error) {
	t, err := s.repo.GetTrip(ctx, tripID)
	if err != nil {
		return nil, err
	}
	if t.RiderID == userID {
		return t, nil
	}
	if t.DriverID != nil {
		if d, err := s.repo.DriverByUser(ctx, userID); err == nil && d.ID == *t.DriverID {
			return t, nil
		}
	}
	return nil, ErrNotFound
}
