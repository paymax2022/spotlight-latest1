// Package hail implements ride-hailing: request -> driver match (Redlock) ->
// complete -> ledger settlement, with demand-based surge pricing.
// All money is integer kobo; no floats touch an amount.
package hail

import (
	"context"
	"errors"
	"time"
)

type TripStatus string

const (
	StatusRequested TripStatus = "requested"
	StatusMatched   TripStatus = "matched"
	StatusCompleted TripStatus = "completed"
	StatusCancelled TripStatus = "cancelled"
)

type DriverStatus string

const (
	DriverOffline   DriverStatus = "offline"
	DriverAvailable DriverStatus = "available"
	DriverBusy      DriverStatus = "busy"
)

const (
	// DefaultBaseFareKobo is NGN 1,500.
	DefaultBaseFareKobo int64 = 150000
	// BPSOne is 1.0x in basis points.
	BPSOne      int64 = 10000
	MaxSurgeBPS int64 = 20000
	// DriverPct is the driver's share of the fare; the platform takes the rest.
	DriverPct int64 = 70
)

var (
	ErrNotFound          = errors.New("transport: not found")
	ErrInvalidInput      = errors.New("transport: invalid input")
	ErrNotRequested      = errors.New("transport: trip is not awaiting a driver")
	ErrNotMatched        = errors.New("transport: trip is not matched")
	ErrDriverUnavailable = errors.New("transport: driver unavailable")
	ErrLockContended     = errors.New("transport: trip or driver is being matched by another request")
	ErrForbidden         = errors.New("transport: not permitted")
	ErrInsufficientFunds = errors.New("transport: rider has insufficient funds")
	ErrIdempotencyKey    = errors.New("transport: Idempotency-Key required")
	// ErrTierGateUnwired: no wallet gate injected. RequestTrip fails closed
	// rather than accepting a trip nobody verified the rider can pay for.
	ErrTierGateUnwired = errors.New("transport: wallet/tier gate not wired")
)

// WalletGate is the booking-time rider check. It must return the tier
// sentinels (tiers.ErrWalletDisabled / ErrDailyLimitExceeded /
// ErrCheckoutAllowanceExceeded) unwrapped, and ErrInsufficientFunds when the
// available balance is below fare. It is advisory at booking; the authoritative
// in-tx guard runs again at settlement.
type WalletGate interface {
	CheckRider(ctx context.Context, riderID string, fareKobo int64) error
}

// Auditor is the nil-safe seam into the shared durable audit sink
// (services.AuditService satisfies LogAction). Fire-and-forget by contract.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// Audit action names emitted by this module.
const (
	AuditTripRequested     = "transport.trip.requested"
	AuditTripSettled       = "transport.trip.settled"
	AuditSettlementReverse = "transport.settlement.reversed"
)

type Trip struct {
	ID                string     `json:"id"`
	RiderID           string     `json:"rider_id"`
	DriverID          *string    `json:"driver_id,omitempty"`
	PickupLat         float64    `json:"pickup_lat"`
	PickupLon         float64    `json:"pickup_lon"`
	DropoffLat        float64    `json:"dropoff_lat"`
	DropoffLon        float64    `json:"dropoff_lon"`
	Status            TripStatus `json:"status"`
	BaseFareKobo      int64      `json:"base_fare_kobo"`
	SurgeBPS          int64      `json:"surge_bps"`
	FareKobo          int64      `json:"fare_kobo"`
	DriverShareKobo   *int64     `json:"driver_share_kobo,omitempty"`
	PlatformShareKobo *int64     `json:"platform_share_kobo,omitempty"`
	IdempotencyKey    string     `json:"-"`
	CreatedAt         time.Time  `json:"created_at"`
	MatchedAt         *time.Time `json:"matched_at,omitempty"`
	CompletedAt       *time.Time `json:"completed_at,omitempty"`
}

type Driver struct {
	ID     string       `json:"id"`
	UserID string       `json:"user_id"`
	Status DriverStatus `json:"status"`
}

// Repository is the persistence port. AssignDriver and CompleteTrip must be
// atomic and conditional on the current status.
type Repository interface {
	// CreateTrip inserts t; if (rider, idempotency key) already exists it
	// returns the existing trip with created=false.
	CreateTrip(ctx context.Context, t *Trip) (trip *Trip, created bool, err error)
	GetTrip(ctx context.Context, id string) (*Trip, error)
	DriverByUser(ctx context.Context, userID string) (*Driver, error)
	// DemandSupply returns open trips (requested+matched) and available drivers.
	DemandSupply(ctx context.Context) (activeTrips, availableDrivers int64, err error)
	// AssignDriver moves requested->matched and driver available->busy atomically.
	// Returns ErrNotRequested / ErrDriverUnavailable when the guards fail.
	AssignDriver(ctx context.Context, tripID, driverID string) (*Trip, error)
	// CompleteTrip moves matched->completed, records the split, frees the driver.
	CompleteTrip(ctx context.Context, tripID string, driverShare, platformShare int64) (*Trip, error)
}

// Locker is the distributed-lock port (Redis-backed in production).
type Locker interface {
	// Acquire returns (token, true) on success, ("", false) if held elsewhere.
	Acquire(ctx context.Context, key string, ttl time.Duration) (string, bool, error)
	Release(ctx context.Context, key, token string) error
}

// Ledger is the settlement port. Settle must be idempotent on key and post
// balanced entries: rider -> driver (driverShare) and rider -> platform
// (platformShare), with driverShare+platformShare == fare.
type Ledger interface {
	Settle(ctx context.Context, key, tripID, riderID, driverUserID string, fare, driverShare, platformShare int64) error
}
