package healthvet

import "time"

// ─── Appointment state machine (HEALTH-BUILD §5) ─────────────────────────────
//
// The authoritative appointment lifecycle + guarded transitions are owned by the
// shared healthscheduling engine (REUSE — never rebuilt). The vet vertical books
// a PET appointment on health_appointments (subject_type='PET') via that engine
// and layers the HL-9 escrow money path on top via vet_appointment_payments.
//
//	REQUESTED → ACCEPTED → CONFIRMED → IN_PROGRESS → COMPLETED
//	(any) → CANCELLED | NO_SHOW ; CONFIRMED → RESCHEDULED → CONFIRMED
//
// payment (HL-9): HELD on booking (escrow.Hold at REQUESTED) → RELEASED on
// COMPLETED (escrow.Release) → REFUNDED on CANCELLED (escrow.Refund). The mirror
// state strings below are the local projection used for payment guards; the
// scheduling engine remains the single source of truth for the transition graph.
type ApptState string

const (
	StateRequested   ApptState = "REQUESTED"
	StateAccepted    ApptState = "ACCEPTED"
	StateConfirmed   ApptState = "CONFIRMED"
	StateInProgress  ApptState = "IN_PROGRESS"
	StateCompleted   ApptState = "COMPLETED"
	StateCancelled   ApptState = "CANCELLED"
	StateNoShow      ApptState = "NO_SHOW"
	StateRescheduled ApptState = "RESCHEDULED"
)

// PayState is the escrow money-leg lifecycle pinned to an appointment (HL-9).
type PayState string

const (
	PayHeld     PayState = "HELD"     // funds captured on booking
	PayReleased PayState = "RELEASED" // funds released to vet on COMPLETED
	PayRefunded PayState = "REFUNDED" // funds returned to owner on CANCELLED
)

// VisitType is the appointment delivery mode.
type VisitType string

const (
	VisitTele   VisitType = "TELE"   // tele-consult (healthconsult engine)
	VisitHome   VisitType = "HOME"   // home visit (transport last-mile dispatch)
	VisitClinic VisitType = "CLINIC" // in-clinic attendance
)

func validVisit(v VisitType) bool {
	return v == VisitTele || v == VisitHome || v == VisitClinic
}

// ─── Pet ─────────────────────────────────────────────────────────────────────

// Pet is an owner-scoped animal profile. The owner (auth.users) is the data
// subject anchor for object-level authZ (HL-8: an owner reads only their own
// pets). Clinical pet history lives in the shared records vault under
// subject_type='PET' with pet_ref=<pet id> (REUSE — never a parallel store).
type Pet struct {
	ID          string    `json:"id"`
	OwnerUserID string    `json:"owner_user_id"`
	Name        string    `json:"name"`
	Species     string    `json:"species"` // e.g. DOG, CAT
	Breed       string    `json:"breed"`
	Sex         string    `json:"sex"`
	BirthDate   *string   `json:"birth_date,omitempty"`
	WeightKg    *float64  `json:"weight_kg,omitempty"`
	Notes       string    `json:"notes"`
	CreatedAt   time.Time `json:"created_at"`
}

// ─── Vet discovery ───────────────────────────────────────────────────────────

// VetResult is a discoverable, verified (VCN) vet returned by map/list discovery.
// Only APPROVED + discoverable health_providers in the VET domain surface (HL-2).
// DistanceM is populated for geo (map) queries via PostGIS ST_Distance.
type VetResult struct {
	ProviderID  string   `json:"provider_id"`
	DisplayName string   `json:"display_name"`
	OwnerUserID string   `json:"owner_user_id"`
	Lat         *float64 `json:"lat,omitempty"`
	Lng         *float64 `json:"lng,omitempty"`
	DistanceM   *float64 `json:"distance_m,omitempty"`
}

// ─── Services / fees (governance) ────────────────────────────────────────────

// VetService is a priced service a verified vet offers (e.g. tele-consult,
// vaccination, home visit). price_kobo is minor units (NL-8). The appointment
// total is computed server-side from the pinned service price (never client-set).
type VetService struct {
	ID         string    `json:"id"`
	ProviderID string    `json:"provider_id"`
	Code       string    `json:"code"`
	Name       string    `json:"name"`
	VisitType  VisitType `json:"visit_type"`
	PriceKobo  int64     `json:"price_kobo"`
	Active     bool      `json:"active"`
	CreatedAt  time.Time `json:"created_at"`
}

// ─── Appointment (local projection over health_appointments) ─────────────────

// Appointment is the vet-vertical projection of a health_appointments row plus the
// HL-9 escrow money leg. State mirrors the scheduling engine; PayState tracks the
// escrow hold. EscrowID is the funds-hold reference (no balance column — HL-9).
type Appointment struct {
	ID          string    `json:"id"`
	ProviderID  string    `json:"provider_id"`
	OwnerID     string    `json:"owner_id"` // patient/owner (auth.users)
	PetID       string    `json:"pet_id"`   // subject (PET)
	ServiceID   string    `json:"service_id"`
	VisitType   VisitType `json:"visit_type"`
	State       ApptState `json:"state"`
	PayState    PayState  `json:"pay_state"`
	TotalKobo   int64     `json:"total_kobo"`
	EscrowID    *string   `json:"escrow_id,omitempty"`
	ConsultID   *string   `json:"consult_id,omitempty"`
	DeliveryRef *string   `json:"delivery_ref,omitempty"` // home-visit dispatch (transport)
	SlotStart   time.Time `json:"slot_start"`
	SlotEnd     time.Time `json:"slot_end"`
	CreatedAt   time.Time `json:"created_at"`
}

// ─── Vaccination schedule ────────────────────────────────────────────────────

// Vaccination is a scheduled/administered vaccine for a pet. DueAt drives the
// reminder fired on the shared scheduler (REUSE). ReminderJobID pins the
// scheduler job so it can be paused/cancelled with the schedule.
type Vaccination struct {
	ID             string     `json:"id"`
	PetID          string     `json:"pet_id"`
	OwnerUserID    string     `json:"owner_user_id"`
	Vaccine        string     `json:"vaccine"`
	DueAt          time.Time  `json:"due_at"`
	AdministeredAt *time.Time `json:"administered_at,omitempty"`
	ReminderJobID  *string    `json:"reminder_job_id,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
}
