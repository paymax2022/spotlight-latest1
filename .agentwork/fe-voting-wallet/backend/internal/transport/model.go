package transport

import "time"

// DriverStatus tracks driver availability.
type DriverStatus string

const (
	DriverOnline  DriverStatus = "online"
	DriverOffline DriverStatus = "offline"
	DriverOnTrip  DriverStatus = "on_trip"
)

// TripStatus tracks a ride through its lifecycle.
type TripStatus string

const (
	TripRequested TripStatus = "requested"
	TripAccepted  TripStatus = "accepted"
	TripPickedUp  TripStatus = "picked_up"
	TripCompleted TripStatus = "completed"
	TripCancelled TripStatus = "cancelled"
)

// BaseFareKobo is the minimum fare for any trip.
const BaseFareKobo int64 = 150000 // ₦1,500

// Driver is a registered ride-hailing driver.
type Driver struct {
	ID         string       `json:"id"`
	UserID     string       `json:"user_id"`
	Name       string       `json:"name"`
	VehicleReg string       `json:"vehicle_reg"`
	VehicleType string      `json:"vehicle_type"` // car | bike | tricycle
	Status     DriverStatus `json:"status"`
	Rating     float64      `json:"rating"`
	CreatedAt  time.Time    `json:"created_at"`
}

// Trip is a ride from pickup to destination.
type Trip struct {
	ID              string     `json:"id"`
	RiderID         string     `json:"rider_id"`
	DriverID        *string    `json:"driver_id,omitempty"`
	PickupAddress   string     `json:"pickup_address"`
	DestAddress     string     `json:"dest_address"`
	FareKobo        int64      `json:"fare_kobo"`
	Status          TripStatus `json:"status"`
	IdempotencyKey  string     `json:"idempotency_key"`
	SettlementID    string     `json:"settlement_id"`
	CreatedAt       time.Time  `json:"created_at"`
}

// RegisterDriverRequest is the body for POST /transport/drivers.
type RegisterDriverRequest struct {
	Name        string `json:"name" binding:"required,min=2,max=200"`
	VehicleReg  string `json:"vehicle_reg" binding:"required"`
	VehicleType string `json:"vehicle_type" binding:"required,oneof=car bike tricycle"`
}

// RequestTripRequest is the body for POST /transport/trips.
type RequestTripRequest struct {
	PickupAddress  string `json:"pickup_address" binding:"required"`
	DestAddress    string `json:"dest_address" binding:"required"`
	FareKobo       int64  `json:"fare_kobo" binding:"required,min=1"`
	IdempotencyKey string `json:"idempotency_key" binding:"required"`
}
