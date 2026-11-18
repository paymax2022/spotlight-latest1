package healthvet

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/internal/health/consultengine"
)

// ConsultRoomEngine is the slice of the shared consult engine the vet vertical
// needs. The legacy `consult` field on Service is the older SOAP/clinical-note
// engine and must not be confused with it: that one is anchored to
// health_consults, this one owns the LiveKit room and its timer.
type ConsultRoomEngine interface {
	EnsureSession(ctx context.Context, req consultengine.BookRequest) (consultengine.Session, error)
	CompleteBySource(ctx context.Context, vertical consultengine.Vertical, sourceRef, callerID string) error
}

// WithConsultRoomEngine wires the shared LiveKit consult engine. Nil is valid:
// tele booking and the legacy SOAP path keep working, and the room endpoint
// answers ErrConsultUnavailable.
func (s *Service) WithConsultRoomEngine(c ConsultRoomEngine) *Service {
	s.rooms = c
	return s
}

var (
	// ErrPackageInvalid means the package is not this vet's, is not a vet
	// package, or is no longer active.
	ErrPackageInvalid = errors.New("vet: consultation package is not available")
	// ErrPackageRequired means the vet sells timed sessions for the requested
	// mode, so a service price is no longer a valid price for it.
	ErrPackageRequired = errors.New("vet: choose a consultation package")
	// ErrConsultModeInvalid means the requested mode is not chat/voice/video.
	ErrConsultModeInvalid = errors.New("vet: unknown consultation mode")
	// ErrQuoteMismatch means the client-quoted total disagrees with the
	// server-computed price. Money has not moved when this is returned.
	ErrQuoteMismatch = errors.New("vet: the quoted total no longer matches this vet's price")
	// ErrConsultNotOpenable means the appointment is not a confirmed tele
	// consult (home/clinic visits, cancelled and completed rows never open).
	ErrConsultNotOpenable = errors.New("vet: this appointment is not an open tele-consult")
	// ErrConsultUnavailable means no media engine is wired.
	ErrConsultUnavailable = errors.New("vet: consult media is not available")
)

// legacyVetConsultMinutes is the duration of a tele appointment booked from a
// visit service rather than a package — unchanged from the pre-LiveKit vet flow.
const legacyVetConsultMinutes = 30

// normalizeVetConsultMode maps the app's mode spelling onto the engine's three
// modes. The pet flow historically says "tele" for a video consult.
func normalizeVetConsultMode(raw string) (consultengine.Mode, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "video", "tele":
		return consultengine.ModeVideo, nil
	case "audio", "voice":
		return consultengine.ModeVoice, nil
	case "chat":
		return consultengine.ModeChat, nil
	}
	return "", ErrConsultModeInvalid
}

// vetConsultPackage is the priced option a tele booking pinned.
type vetConsultPackage struct {
	ID              string
	Mode            consultengine.Mode
	DurationMinutes int
	PriceKobo       int64
}

// loadConsultPackage validates the picker's choice against the vet's own active
// package list. A package from another vet, another vertical, or an inactive
// row is the same refusal.
func (s *Service) loadConsultPackage(ctx context.Context, providerID, packageID string) (vetConsultPackage, error) {
	if _, err := uuid.Parse(packageID); err != nil {
		return vetConsultPackage{}, ErrPackageInvalid
	}
	var pkg vetConsultPackage
	var mode string
	const q = `SELECT id::text, mode, duration_minutes, price_kobo
	           FROM consult_session_packages
	           WHERE id=$1::uuid AND owner_kind='health_provider' AND owner_id=$2::uuid
	             AND vertical='vet' AND active=TRUE`
	err := s.db.QueryRow(ctx, q, packageID, providerID).
		Scan(&pkg.ID, &mode, &pkg.DurationMinutes, &pkg.PriceKobo)
	if errors.Is(err, pgx.ErrNoRows) {
		return vetConsultPackage{}, ErrPackageInvalid
	}
	if err != nil {
		return vetConsultPackage{}, fmt.Errorf("vet: load consult package: %w", err)
	}
	pkg.Mode = consultengine.Mode(mode)
	return pkg, nil
}

// providerSellsMode reports whether the vet publishes a timed package for a
// mode — which is what makes the legacy service price invalid for it.
func (s *Service) providerSellsMode(ctx context.Context, providerID string, m consultengine.Mode) (bool, error) {
	var sells bool
	const q = `SELECT EXISTS (
		SELECT 1 FROM consult_session_packages
		WHERE owner_kind='health_provider' AND owner_id=$1::uuid
		  AND vertical='vet' AND mode=$2 AND active=TRUE)`
	if err := s.db.QueryRow(ctx, q, providerID, m).Scan(&sells); err != nil {
		return false, fmt.Errorf("vet: check consult packages: %w", err)
	}
	return sells, nil
}

// OpenConsultSession returns the single session pinned to a tele appointment,
// creating it on first open. Either the pet owner or the vet's owner may open
// it; a stranger gets the same not-found as a missing appointment.
//
// When the vet opens a CONFIRMED appointment that has no legacy consult row
// yet, this starts that row first. CompleteConsult (SOAP note, e-Rx, escrow
// release) is anchored on it, so opening the room must not leave the vet
// unable to finish the visit.
func (s *Service) OpenConsultSession(ctx context.Context, callerID, apptID string) (consultengine.Session, error) {
	if s.rooms == nil {
		return consultengine.Session{}, ErrConsultUnavailable
	}
	if _, err := uuid.Parse(apptID); err != nil {
		return consultengine.Session{}, ErrAppointmentNotFound
	}
	const q = `
		SELECT ap.patient_id::text, ap.provider_id::text, ap.visit_type, ap.state, ap.slot_start,
		       hp.owner_user_id::text, COALESCE(vp.escrow_id::text, ''),
		       COALESCE(vp.consult_package_id::text, ''),
		       COALESCE(vp.consult_mode, 'video'),
		       vp.total_kobo,
		       COALESCE(vp.consult_duration_minutes, 30),
		       vp.consult_id::text
		FROM health_appointments ap
		JOIN vet_appointment_payments vp ON vp.appointment_id = ap.id
		JOIN health_providers hp ON hp.id = ap.provider_id
		WHERE ap.id = $1::uuid`
	var patientID, providerID, visit, state, vetOwner, holdID, packageID, mode string
	var slotStart time.Time
	var totalKobo int64
	var durationMinutes int
	var consultID *string
	err := s.db.QueryRow(ctx, q, apptID).Scan(&patientID, &providerID, &visit, &state, &slotStart,
		&vetOwner, &holdID, &packageID, &mode, &totalKobo, &durationMinutes, &consultID)
	if errors.Is(err, pgx.ErrNoRows) {
		return consultengine.Session{}, ErrAppointmentNotFound
	}
	if err != nil {
		return consultengine.Session{}, fmt.Errorf("vet: load consultation: %w", err)
	}
	if callerID != patientID && callerID != vetOwner {
		return consultengine.Session{}, ErrAppointmentNotFound
	}
	if visit != string(VisitTele) || (state != string(StateConfirmed) && state != string(StateInProgress)) {
		return consultengine.Session{}, ErrConsultNotOpenable
	}
	if callerID == vetOwner && consultID == nil && state == string(StateConfirmed) {
		// Fail closed: without the legacy row the vet cannot complete the visit
		// or release the payment, so do not hand out a room we cannot close.
		if _, serr := s.StartConsult(ctx, callerID, apptID); serr != nil {
			return consultengine.Session{}, fmt.Errorf("vet: start consult: %w", serr)
		}
	}
	// An appointment opened more than five minutes late starts now, so the
	// owner still receives the full duration they paid for.
	start := slotStart
	if time.Now().After(slotStart.Add(5 * time.Minute)) {
		start = time.Time{}
	}
	return s.rooms.EnsureSession(ctx, consultengine.BookRequest{
		Vertical:          consultengine.VerticalVet,
		Mode:              consultengine.Mode(mode),
		PatientID:         patientID,
		ProviderOwnerKind: consultengine.OwnerHealthProvider,
		ProviderOwnerID:   providerID,
		ProviderUserID:    vetOwner,
		SourceRef:         "vet:" + apptID,
		PackageID:         packageID,
		BaseHoldID:        holdID,
		Start:             start,
		// Extension price derives from this snapshot, so total_kobo stays the
		// amount the owner paid for the consult. Spotlight's commission is
		// recorded separately in the profit registry; nothing is added here.
		Snapshot: &consultengine.PriceSnapshot{
			DurationMinutes: durationMinutes,
			PriceKobo:       totalKobo,
		},
	})
}
