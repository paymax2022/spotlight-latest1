package transport

import "time"

// DriverStatus tracks driver availability.
type DriverStatus string

const (
	DriverOnline  DriverStatus = "online"
	DriverOffline DriverStatus = "offline"
	DriverOnTrip  DriverStatus = "on_trip"
)

// TripStatus tracks a ride through its coarse lifecycle (kept for back-compat).
type TripStatus string

const (
	TripRequested TripStatus = "requested"
	TripAccepted  TripStatus = "accepted"
	TripPickedUp  TripStatus = "picked_up"
	TripCompleted TripStatus = "completed"
	TripCancelled TripStatus = "cancelled"
)

// TripPhase is the fine-grained ride-hailing state machine (trips.phase).
type TripPhase string

const (
	PhaseRequested       TripPhase = "requested"
	PhaseFareNegotiating TripPhase = "fare_negotiating"
	PhaseDriverAssigned  TripPhase = "driver_assigned"
	PhaseDriverArriving  TripPhase = "driver_arriving"
	PhasePinVerified     TripPhase = "pin_verified"
	PhaseInProgress      TripPhase = "in_progress"
	PhaseCompleted       TripPhase = "completed"
	PhaseCancelled       TripPhase = "cancelled"
	PhaseNoShow          TripPhase = "no_show"
	PhaseSafetyHold      TripPhase = "safety_hold"
)

// allowedTransitions defines the legal phase moves. Any transition not listed
// is rejected with HTTP 409 (invalid state transition).
var allowedTransitions = map[TripPhase]map[TripPhase]bool{
	PhaseRequested:       {PhaseFareNegotiating: true, PhaseDriverAssigned: true, PhaseCancelled: true, PhaseNoShow: true, PhaseSafetyHold: true},
	PhaseFareNegotiating: {PhaseFareNegotiating: true, PhaseDriverAssigned: true, PhaseCancelled: true, PhaseNoShow: true, PhaseSafetyHold: true},
	PhaseDriverAssigned:  {PhaseDriverArriving: true, PhaseCancelled: true, PhaseNoShow: true, PhaseSafetyHold: true},
	PhaseDriverArriving:  {PhasePinVerified: true, PhaseCancelled: true, PhaseNoShow: true, PhaseSafetyHold: true},
	PhasePinVerified:     {PhaseInProgress: true, PhaseCancelled: true, PhaseSafetyHold: true},
	PhaseInProgress:      {PhaseCompleted: true, PhaseSafetyHold: true},
	PhaseSafetyHold:      {PhaseCancelled: true, PhaseInProgress: true, PhaseCompleted: true},
}

// canTransition reports whether moving from->to is permitted.
func canTransition(from, to TripPhase) bool {
	if from == to {
		return false
	}
	m, ok := allowedTransitions[from]
	if !ok {
		return false
	}
	return m[to]
}

// Error codes returned to clients (BUILD-CONTRACT error conventions).
const (
	CodeFareBelowFloor   = "FARE_BELOW_FLOOR"
	CodeFareAboveCeiling = "FARE_ABOVE_CEILING"
	CodeFareBelowSystem  = "FARE_BELOW_FLOOR" // offer below fare-floor pct also surfaces as below-floor
	CodeProfitFloor      = "FARE_BELOW_FLOOR" // accepted fare net of commission < driver profit floor
	CodeInvalidState     = "INVALID_STATE"
	CodeNotFound         = "NOT_FOUND"
	CodeForbidden        = "FORBIDDEN"
	CodeNotApproved      = "DRIVER_NOT_APPROVED"
	CodePinMismatch      = "PIN_MISMATCH"
)

// CodedError carries an HTTP status + machine-readable code alongside a message.
type CodedError struct {
	Status  int
	Code    string
	Message string
}

func (e *CodedError) Error() string { return e.Message }

func codedErr(status int, code, msg string) *CodedError {
	return &CodedError{Status: status, Code: code, Message: msg}
}

// BaseFareKobo is the minimum fare for any trip (legacy fallback).
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

// RequestTripRequest is the body for POST /transport/trips (legacy).
type RequestTripRequest struct {
	PickupAddress  string `json:"pickup_address" binding:"required"`
	DestAddress    string `json:"dest_address" binding:"required"`
	FareKobo       int64  `json:"fare_kobo" binding:"required,min=1"`
	IdempotencyKey string `json:"idempotency_key" binding:"required"`
}

// ─── Mobility domain structs ─────────────────────────────────────────────────

// MobilityProfile is the rider's trust + saved data layer.
type MobilityProfile struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	TrustLevel     string    `json:"trust_level"`
	DefaultPayment string    `json:"default_payment"`
	HomeAddress    *string   `json:"home_address,omitempty"`
	WorkAddress    *string   `json:"work_address,omitempty"`
	Rating         float64   `json:"rating"`
	CompletedTrips int       `json:"completed_trips"`
	Status         string    `json:"status"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// Vehicle is a driver's registered vehicle + compliance record.
type Vehicle struct {
	ID               string    `json:"id"`
	DriverID         string    `json:"driver_id"`
	PlateNumber      string    `json:"plate_number"`
	Make             *string   `json:"make,omitempty"`
	Model            *string   `json:"model,omitempty"`
	Year             *int      `json:"year,omitempty"`
	Color            *string   `json:"color,omitempty"`
	Category         string    `json:"category"`
	Capacity         int       `json:"capacity"`
	InspectionStatus string    `json:"inspection_status"`
	InsuranceStatus  string    `json:"insurance_status"`
	Status           string    `json:"status"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// DriverDocument is an uploaded onboarding document with expiry tracking.
type DriverDocument struct {
	ID         string     `json:"id"`
	DriverID   string     `json:"driver_id"`
	DocType    string     `json:"doc_type"`
	FileURL    string     `json:"file_url"`
	Status     string     `json:"status"`
	ExpiryDate *time.Time `json:"expiry_date,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

// PricingConfig drives system-fare and negotiation bounds per zone+service_type.
type PricingConfig struct {
	ID                    string  `json:"id"`
	Zone                  string  `json:"zone"`
	ServiceType           string  `json:"service_type"`
	Currency              string  `json:"currency"`
	BaseFareKobo          int64   `json:"base_fare_kobo"`
	PerKMKobo             int64   `json:"per_km_kobo"`
	PerMinKobo            int64   `json:"per_min_kobo"`
	MinFareKobo           int64   `json:"min_fare_kobo"`
	FareFloorPct          float64 `json:"fare_floor_pct"`
	FareCeilingPct        float64 `json:"fare_ceiling_pct"`
	DriverProfitFloorKobo int64   `json:"driver_profit_floor_kobo"`
	SurgeMultiplier       float64 `json:"surge_multiplier"`
	CancellationFeeKobo   int64   `json:"cancellation_fee_kobo"`
	WaitingFeePerMinKobo  int64   `json:"waiting_fee_per_min_kobo"`
	Active                bool    `json:"active"`
}

// CommissionConfig is a commission tier split.
type CommissionConfig struct {
	Tier        string  `json:"tier"`
	ProviderPct float64 `json:"provider_pct"`
	PlatformPct float64 `json:"platform_pct"`
	Active      bool    `json:"active"`
}

// FareOffer is a single hybrid-negotiation record.
type FareOffer struct {
	ID                string     `json:"id"`
	TripID            string     `json:"trip_id"`
	SystemFareKobo    int64      `json:"system_fare_kobo"`
	RiderOfferKobo    *int64     `json:"rider_offer_kobo,omitempty"`
	DriverCounterKobo *int64     `json:"driver_counter_kobo,omitempty"`
	AcceptedFareKobo  *int64     `json:"accepted_fare_kobo,omitempty"`
	Status            string     `json:"status"`
	ExpiresAt         *time.Time `json:"expires_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
}

// SafetyIncident is a routed safety case.
type SafetyIncident struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	TripID         *string   `json:"trip_id,omitempty"`
	Type           string    `json:"type"`
	Severity       string    `json:"severity"`
	Lat            *float64  `json:"lat,omitempty"`
	Lng            *float64  `json:"lng,omitempty"`
	Description    *string   `json:"description,omitempty"`
	Status         string    `json:"status"`
	AssignedAdmin  *string   `json:"assigned_admin,omitempty"`
	ResolutionNote *string   `json:"resolution_note,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
}

// TrustedContact is an emergency contact for a rider.
type TrustedContact struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Name      string    `json:"name"`
	Phone     string    `json:"phone"`
	CreatedAt time.Time `json:"created_at"`
}

// TripRating is a bidirectional rating + optional tip.
type TripRating struct {
	ID       string `json:"id"`
	TripID   string `json:"trip_id"`
	RaterID  string `json:"rater_id"`
	RateeID  string `json:"ratee_id"`
	Role     string `json:"role"`
	Stars    int    `json:"stars"`
	Comment  string `json:"comment,omitempty"`
	TipKobo  int64  `json:"tip_kobo"`
}

// FareEstimate is returned by the estimate endpoint.
type FareEstimate struct {
	DistanceM      int    `json:"distance_m"`
	DurationS      int    `json:"duration_s"`
	SystemFareKobo int64  `json:"system_fare_kobo"`
	OfferMinKobo   int64  `json:"offer_min_kobo"`
	OfferMaxKobo   int64  `json:"offer_max_kobo"`
	Polyline       string `json:"polyline"`
}

// ─── Request bodies ──────────────────────────────────────────────────────────

// Place is a pickup/destination with coordinates + address.
type Place struct {
	Lat     float64 `json:"lat" binding:"required"`
	Lng     float64 `json:"lng" binding:"required"`
	Address string  `json:"address"`
}

// EstimateRequest is POST /mobility/rides/estimate.
type EstimateRequest struct {
	Pickup      Place  `json:"pickup" binding:"required"`
	Dest        Place  `json:"dest" binding:"required"`
	ServiceType string `json:"service_type"`
}

// RequestRideRequest is POST /mobility/rides/request.
type RequestRideRequest struct {
	Pickup         Place  `json:"pickup" binding:"required"`
	Dest           Place  `json:"dest" binding:"required"`
	ServiceType    string `json:"service_type"`
	PricingMode    string `json:"pricing_mode" binding:"required,oneof=instant offer"`
	OfferKobo      int64  `json:"offer_kobo"`
	PaymentMethod  string `json:"payment_method"`
	IdempotencyKey string `json:"idempotency_key"`
}

// OfferRequest is POST /mobility/rides/:id/offer.
type OfferRequest struct {
	OfferKobo int64 `json:"offer_kobo" binding:"required,min=1"`
}

// CounterRequest is POST /driver/requests/:id/counter.
type CounterRequest struct {
	CounterKobo int64 `json:"counter_kobo" binding:"required,min=1"`
}

// CancelRequest carries a cancellation reason.
type CancelRequest struct {
	Reason string `json:"reason"`
}

// SOSRequest creates a safety incident.
type SOSRequest struct {
	TripID      *string  `json:"trip_id,omitempty"`
	Lat         *float64 `json:"lat,omitempty"`
	Lng         *float64 `json:"lng,omitempty"`
	Description  string   `json:"description,omitempty"`
}

// RateRequest is POST /mobility/rides/:id/rate.
type RateRequest struct {
	Stars   int    `json:"stars" binding:"required,min=1,max=5"`
	Comment string `json:"comment"`
	TipKobo int64  `json:"tip_kobo"`
}

// VerifyPinRequest is POST /driver/trips/:id/verify-pin.
type VerifyPinRequest struct {
	Pin string `json:"pin" binding:"required"`
}

// UpsertProfileRequest is PUT /mobility/profile.
type UpsertProfileRequest struct {
	TrustLevel     string  `json:"trust_level"`
	DefaultPayment string  `json:"default_payment"`
	HomeAddress    *string `json:"home_address"`
	WorkAddress    *string `json:"work_address"`
}

// TrustedContactRequest is POST /mobility/trusted-contacts.
type TrustedContactRequest struct {
	Name  string `json:"name" binding:"required"`
	Phone string `json:"phone" binding:"required"`
}

// OnboardingSubmitRequest is POST /driver/onboarding/submit.
type OnboardingSubmitRequest struct {
	Phone             string   `json:"phone" binding:"required"`
	Email             string   `json:"email" binding:"required,email"`
	PhotoURL          string   `json:"photo_url"`
	ServiceCategories []string `json:"service_categories"`
}

// DocumentRequest is POST /driver/documents.
type DocumentRequest struct {
	DocType    string  `json:"doc_type" binding:"required"`
	FileURL    string  `json:"file_url" binding:"required"`
	ExpiryDate *string `json:"expiry_date,omitempty"`
}

// VehicleRequest is POST /driver/vehicle.
type VehicleRequest struct {
	PlateNumber string `json:"plate_number" binding:"required"`
	Make        string `json:"make"`
	Model       string `json:"model"`
	Year        int    `json:"year"`
	Color       string `json:"color"`
	Category    string `json:"category"`
	Capacity    int    `json:"capacity"`
}

// DriverStatusRequest is PATCH /driver/status.
type DriverStatusRequest struct {
	Status string   `json:"status" binding:"required,oneof=online offline"`
	Lat    *float64 `json:"lat,omitempty"`
	Lng    *float64 `json:"lng,omitempty"`
}

// VerificationRequest is admin PATCH /drivers/:id/verification.
type VerificationRequest struct {
	Status string `json:"status" binding:"required,oneof=approved rejected suspended under_review"`
	Reason string `json:"reason"`
}

// VehicleStatusRequest is admin PATCH /vehicles/:id/status.
type VehicleStatusRequest struct {
	Status           string `json:"status"`
	InspectionStatus string `json:"inspection_status"`
	InsuranceStatus  string `json:"insurance_status"`
	Reason           string `json:"reason"`
}

// AssignRequest is admin POST /dispatch/:trip_id/assign.
type AssignRequest struct {
	DriverID string `json:"driver_id" binding:"required"`
}

// PricingPatchRequest updates pricing config (admin). Pointers = optional fields.
type PricingPatchRequest struct {
	Zone                  string   `json:"zone"`
	ServiceType           string   `json:"service_type"`
	BaseFareKobo          *int64   `json:"base_fare_kobo"`
	PerKMKobo             *int64   `json:"per_km_kobo"`
	PerMinKobo            *int64   `json:"per_min_kobo"`
	MinFareKobo           *int64   `json:"min_fare_kobo"`
	FareFloorPct          *float64 `json:"fare_floor_pct"`
	FareCeilingPct        *float64 `json:"fare_ceiling_pct"`
	DriverProfitFloorKobo *int64   `json:"driver_profit_floor_kobo"`
	SurgeMultiplier       *float64 `json:"surge_multiplier"`
	CancellationFeeKobo   *int64   `json:"cancellation_fee_kobo"`
	WaitingFeePerMinKobo  *int64   `json:"waiting_fee_per_min_kobo"`
	Active                *bool    `json:"active"`
	Reason                string   `json:"reason"`
}

// CommissionPatchRequest updates a commission tier (admin).
type CommissionPatchRequest struct {
	ProviderPct *float64 `json:"provider_pct"`
	PlatformPct *float64 `json:"platform_pct"`
	Active      *bool    `json:"active"`
	Reason      string   `json:"reason"`
}

// SafetyIncidentPatchRequest updates a safety case (admin).
type SafetyIncidentPatchRequest struct {
	Status         string `json:"status"`
	AssignedAdmin  string `json:"assigned_admin"`
	ResolutionNote string `json:"resolution_note"`
}
