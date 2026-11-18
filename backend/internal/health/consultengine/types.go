// Package consultengine owns paid, timed consult sessions shared by telemedicine,
// veterinary, pharmacy and lab. It knows nothing about any vertical's own tables:
// a session points at its origin through SourceRef, and the module keeps its
// appointment, base escrow hold and records.
package consultengine

import (
	"errors"
	"time"
)

type Mode string

const (
	ModeChat  Mode = "chat"
	ModeVoice Mode = "voice"
	ModeVideo Mode = "video"
)

type Vertical string

const (
	VerticalTelemedicine Vertical = "telemedicine"
	VerticalVet          Vertical = "vet"
	VerticalPharmacy     Vertical = "pharmacy"
	VerticalLab          Vertical = "lab"
)

type State string

const (
	StateScheduled State = "scheduled"
	StateLive      State = "live"
	StateEnded     State = "ended"
	StateCancelled State = "cancelled"
)

type ExtensionStatus string

const (
	ExtPending         ExtensionStatus = "pending_approval"
	ExtAwaitingPayment ExtensionStatus = "approved_awaiting_payment"
	ExtPaid            ExtensionStatus = "paid"
	ExtDeclined        ExtensionStatus = "declined"
	ExtExpired         ExtensionStatus = "expired"
	ExtCancelled       ExtensionStatus = "cancelled"
)

type MediaRole string

const (
	MediaPeer      MediaRole = "peer"
	MediaPeerAdmin MediaRole = "peer_admin"
)

type OwnerKind string

const (
	OwnerDoctor         OwnerKind = "doctor"
	OwnerHealthProvider OwnerKind = "health_provider"
)

var (
	ErrNotFound            = errors.New("consult: not found")
	ErrInvalid             = errors.New("consult: invalid input")
	ErrState               = errors.New("consult: invalid session state")
	ErrMediaUnavailable    = errors.New("consult: media unavailable")
	ErrExtensionNotPayable = errors.New("consult: extension is not awaiting payment")
	ErrPaymentExpired      = errors.New("consult: extension payment window expired")
	ErrEscrowUnavailable   = errors.New("consult: escrow unavailable")
)

const (
	MinDurationMinutes     = 5
	MaxDurationMinutes     = 480
	MaxExtensionMinutes    = 240
	MaxSessionWindow       = 4 * time.Hour
	ExtensionPaymentWindow = 5 * time.Minute
	WarningCap             = 5 * time.Minute
	DefaultJoinTTL         = 10 * time.Minute
	EarlyJoinWindow        = 10 * time.Minute
)

// MaxPriceKobo is the ceiling for a session price (and a price snapshot).
const MaxPriceKobo int64 = 100_000_000

type Package struct {
	ID              string    `json:"id"`
	OwnerKind       OwnerKind `json:"owner_kind"`
	OwnerID         string    `json:"owner_id"`
	Vertical        Vertical  `json:"vertical"`
	Mode            Mode      `json:"mode"`
	DurationMinutes int       `json:"duration_minutes"`
	PriceKobo       int64     `json:"price_kobo"`
	Active          bool      `json:"active"`
	CreatedAt       time.Time `json:"created_at"`
}

// PriceSnapshot pins the price a module already charged or escrowed, for a
// session with no published package behind it (an appointment booked before the
// provider priced timed sessions). The module computes it from its own committed
// money row; the engine records that number instead of inventing one.
type PriceSnapshot struct {
	DurationMinutes int
	PriceKobo       int64
}

type Session struct {
	ID                string     `json:"id"`
	Vertical          Vertical   `json:"vertical"`
	Mode              Mode       `json:"mode"`
	PatientID         string     `json:"patient_id"`
	ProviderUserID    string     `json:"provider_user_id"`
	SourceRef         string     `json:"source_ref"`
	PackageID         *string    `json:"package_id,omitempty"`
	DurationMinutes   int        `json:"duration_minutes"`
	PriceKobo         int64      `json:"price_kobo"`
	BookedStart       time.Time  `json:"booked_start"`
	EndsAt            time.Time  `json:"ends_at"`
	WarnAt            time.Time  `json:"warn_at"`
	WarningSentAt     *time.Time `json:"warning_sent_at,omitempty"`
	State             State      `json:"state"`
	RoomName          string     `json:"room_name"`
	BaseHoldID        *string    `json:"base_hold_id,omitempty"`
	EndedAt           *time.Time `json:"ended_at,omitempty"`
	ServerNow         time.Time  `json:"server_now"`
	Extendable        bool       `json:"extendable"`
	ProviderOwnerKind OwnerKind  `json:"provider_owner_kind"`
	ProviderOwnerID   string     `json:"provider_owner_id"`
}

type Extension struct {
	ID               string          `json:"id"`
	SessionID        string          `json:"session_id"`
	RequestedBy      string          `json:"requested_by"`
	AddedMinutes     int             `json:"added_minutes"`
	PriceKobo        int64           `json:"price_kobo"`
	Status           ExtensionStatus `json:"status"`
	ApprovedAt       *time.Time      `json:"approved_at,omitempty"`
	PaymentExpiresAt *time.Time      `json:"payment_expires_at,omitempty"`
	PaidAt           *time.Time      `json:"paid_at,omitempty"`
	EscrowID         *string         `json:"escrow_id,omitempty"`
	DecidedBy        *string         `json:"decided_by,omitempty"`
	DeclineReason    *string         `json:"decline_reason,omitempty"`
	CreatedAt        time.Time       `json:"created_at"`
}

type Message struct {
	ID        string    `json:"id"`
	SessionID string    `json:"session_id"`
	SenderID  string    `json:"sender_id"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"created_at"`
}

type BookRequest struct {
	Vertical          Vertical
	Mode              Mode
	PatientID         string
	ProviderOwnerKind OwnerKind
	ProviderOwnerID   string
	ProviderUserID    string
	SourceRef         string
	// PackageID is the price point the patient picked. Empty is allowed only
	// when Snapshot is set (legacy appointment pricing).
	PackageID  string
	Snapshot   *PriceSnapshot
	BaseHoldID string
	Start      time.Time // zero => now
}

type RTC struct {
	Provider string `json:"provider"`
	URL      string `json:"url"`
	Room     string `json:"room"`
}

type Join struct {
	Token   string  `json:"token"`
	RTC     RTC     `json:"rtc"`
	Session Session `json:"session"`
}
