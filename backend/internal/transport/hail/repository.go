package hail

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PGRepository is the pgx-backed Repository (money-path pool).
type PGRepository struct{ pool *pgxpool.Pool }

func NewPGRepository(pool *pgxpool.Pool) *PGRepository { return &PGRepository{pool: pool} }

const tripCols = `id, rider_id, driver_id, pickup_lat, pickup_lon, dropoff_lat, dropoff_lon,
 status, base_fare_kobo, surge_bps, fare_kobo, driver_share_kobo, platform_share_kobo,
 idempotency_key, created_at, matched_at, completed_at`

type rowScanner interface{ Scan(dest ...any) error }

func scanTrip(r rowScanner) (*Trip, error) {
	var t Trip
	var st string
	if err := r.Scan(&t.ID, &t.RiderID, &t.DriverID, &t.PickupLat, &t.PickupLon, &t.DropoffLat, &t.DropoffLon,
		&st, &t.BaseFareKobo, &t.SurgeBPS, &t.FareKobo, &t.DriverShareKobo, &t.PlatformShareKobo,
		&t.IdempotencyKey, &t.CreatedAt, &t.MatchedAt, &t.CompletedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	t.Status = TripStatus(st)
	return &t, nil
}

func (r *PGRepository) CreateTrip(ctx context.Context, t *Trip) (*Trip, bool, error) {
	row := r.pool.QueryRow(ctx, `
INSERT INTO transport_trips (rider_id, pickup_lat, pickup_lon, dropoff_lat, dropoff_lon,
  status, base_fare_kobo, surge_bps, fare_kobo, idempotency_key)
VALUES ($1,$2,$3,$4,$5,'requested',$6,$7,$8,$9)
ON CONFLICT (rider_id, idempotency_key) DO NOTHING
RETURNING `+tripCols,
		t.RiderID, t.PickupLat, t.PickupLon, t.DropoffLat, t.DropoffLon,
		t.BaseFareKobo, t.SurgeBPS, t.FareKobo, t.IdempotencyKey)
	got, err := scanTrip(row)
	if err == nil {
		return got, true, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return nil, false, err
	}
	got, err = scanTrip(r.pool.QueryRow(ctx,
		`SELECT `+tripCols+` FROM transport_trips WHERE rider_id=$1 AND idempotency_key=$2`,
		t.RiderID, t.IdempotencyKey))
	return got, false, err
}

func (r *PGRepository) GetTrip(ctx context.Context, id string) (*Trip, error) {
	return scanTrip(r.pool.QueryRow(ctx, `SELECT `+tripCols+` FROM transport_trips WHERE id=$1`, id))
}

func (r *PGRepository) DriverByUser(ctx context.Context, userID string) (*Driver, error) {
	var d Driver
	var st string
	err := r.pool.QueryRow(ctx, `SELECT id, user_id, status FROM transport_drivers WHERE user_id=$1`, userID).
		Scan(&d.ID, &d.UserID, &st)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	d.Status = DriverStatus(st)
	return &d, err
}

func (r *PGRepository) DemandSupply(ctx context.Context) (int64, int64, error) {
	var active, avail int64
	err := r.pool.QueryRow(ctx, `
SELECT (SELECT count(*) FROM transport_trips WHERE status IN ('requested','matched')),
       (SELECT count(*) FROM transport_drivers WHERE status='available')`).Scan(&active, &avail)
	return active, avail, err
}

func (r *PGRepository) AssignDriver(ctx context.Context, tripID, driverID string) (*Trip, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	tag, err := tx.Exec(ctx,
		`UPDATE transport_drivers SET status='busy', updated_at=now() WHERE id=$1 AND status='available'`, driverID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrDriverUnavailable
	}
	t, err := scanTrip(tx.QueryRow(ctx, `
UPDATE transport_trips SET status='matched', driver_id=$2, matched_at=now()
WHERE id=$1 AND status='requested' RETURNING `+tripCols, tripID, driverID))
	if errors.Is(err, ErrNotFound) {
		return nil, ErrNotRequested
	}
	if err != nil {
		return nil, err
	}
	return t, tx.Commit(ctx)
}

func (r *PGRepository) CompleteTrip(ctx context.Context, tripID string, driverShare, platformShare int64) (*Trip, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	t, err := scanTrip(tx.QueryRow(ctx, `
UPDATE transport_trips SET status='completed', completed_at=now(),
  driver_share_kobo=$2, platform_share_kobo=$3
WHERE id=$1 AND status='matched' RETURNING `+tripCols, tripID, driverShare, platformShare))
	if errors.Is(err, ErrNotFound) {
		return nil, ErrNotMatched
	}
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE transport_drivers SET status='available', updated_at=now() WHERE id=$1`, *t.DriverID); err != nil {
		return nil, err
	}
	return t, tx.Commit(ctx)
}
