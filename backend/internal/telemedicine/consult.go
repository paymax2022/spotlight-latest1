package telemedicine

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

// ConsultEngine is the slice of the shared consult engine this module needs:
// opening the one session pinned to an appointment, and ending it when the
// appointment completes. An interface keeps the module free of the engine's
// concrete wiring.
type ConsultEngine interface {
	EnsureSession(ctx context.Context, req consultengine.BookRequest) (consultengine.Session, error)
	CompleteBySource(ctx context.Context, vertical consultengine.Vertical, sourceRef, callerID string) error
}

// WithConsultEngine wires the shared engine. Nil is valid: the module keeps
// its legacy behaviour and OpenConsultSession answers 503.
func (s *Service) WithConsultEngine(c ConsultEngine) *Service {
	s.consult = c
	return s
}

var (
	// ErrPackageInvalid means the chosen package is not this doctor's, is not
	// a telemedicine package, or is no longer active.
	ErrPackageInvalid = errors.New("telemedicine: consultation package is not available")
	// ErrPackageRequired means the doctor sells timed sessions for the requested
	// mode, so the legacy fee is no longer a valid price.
	ErrPackageRequired = errors.New("telemedicine: choose a consultation package")
	// ErrConsultModeInvalid means the appointment type is not chat/voice/video.
	ErrConsultModeInvalid = errors.New("telemedicine: unknown consultation type")
	// ErrAppointmentNotFound also covers a caller who is neither the patient nor
	// the assigned doctor: existence is never confirmed to a stranger.
	ErrAppointmentNotFound = errors.New("telemedicine: appointment not found")
	// ErrSessionNotOpenable means the appointment is cancelled or completed.
	ErrSessionNotOpenable = errors.New("telemedicine: appointment is not open for a consultation")
	// ErrConsultUnavailable means no media engine is wired.
	ErrConsultUnavailable = errors.New("telemedicine: consult media is not available")
)

// normalizeConsultMode maps the module's consultation_type onto the engine's
// three modes. Telemedicine has always spelled a voice consult "audio".
func normalizeConsultMode(consultationType string) (consultengine.Mode, error) {
	switch strings.ToLower(strings.TrimSpace(consultationType)) {
	case "", "video":
		return consultengine.ModeVideo, nil
	case "audio", "voice":
		return consultengine.ModeVoice, nil
	case "chat":
		return consultengine.ModeChat, nil
	}
	return "", ErrConsultModeInvalid
}

// moduleConsultType renders an engine mode in the module's spelling, so the
// existing screens keep receiving "audio" for a voice consult.
func moduleConsultType(m consultengine.Mode) string {
	if m == consultengine.ModeVoice {
		return "audio"
	}
	return string(m)
}

// consultPackage is the priced option a booking pinned.
type consultPackage struct {
	ID              string
	Mode            consultengine.Mode
	DurationMinutes int
	PriceKobo       int64
}

// legacyConsultMinutes is the duration an appointment without a package runs,
// unchanged from the module's pre-LiveKit behaviour.
const legacyConsultMinutes = 20

// resolveConsultPackage validates the picker's choice. With a package, the
// package's mode and price win — the patient explicitly chose that price
// point. Without one, the legacy path is allowed only when the doctor has not
// published a package for the requested mode.
func (s *Service) resolveConsultPackage(ctx context.Context, doctorUserID, packageID, consultationType string) (consultPackage, bool, error) {
	if strings.TrimSpace(packageID) == "" {
		mode, err := normalizeConsultMode(consultationType)
		if err != nil {
			return consultPackage{}, false, err
		}
		const q = `SELECT EXISTS (
			SELECT 1 FROM consult_session_packages
			WHERE owner_kind='doctor' AND owner_id=$1::uuid
			  AND vertical='telemedicine' AND mode=$2 AND active=TRUE)`
		var sells bool
		if err := s.db.QueryRow(ctx, q, doctorUserID, mode).Scan(&sells); err != nil {
			return consultPackage{}, false, fmt.Errorf("telemedicine: check packages: %w", err)
		}
		if sells {
			return consultPackage{}, false, ErrPackageRequired
		}
		return consultPackage{Mode: mode, DurationMinutes: legacyConsultMinutes}, false, nil
	}

	if _, err := uuid.Parse(packageID); err != nil {
		return consultPackage{}, false, ErrPackageInvalid
	}
	var pkg consultPackage
	var mode string
	const q = `SELECT id::text, mode, duration_minutes, price_kobo
	           FROM consult_session_packages
	           WHERE id=$1::uuid AND owner_kind='doctor' AND owner_id=$2::uuid
	             AND vertical='telemedicine' AND active=TRUE`
	err := s.db.QueryRow(ctx, q, packageID, doctorUserID).
		Scan(&pkg.ID, &mode, &pkg.DurationMinutes, &pkg.PriceKobo)
	if errors.Is(err, pgx.ErrNoRows) {
		return consultPackage{}, false, ErrPackageInvalid
	}
	if err != nil {
		return consultPackage{}, false, fmt.Errorf("telemedicine: load package: %w", err)
	}
	pkg.Mode = consultengine.Mode(mode)
	return pkg, true, nil
}

// listDoctorPackages returns the doctor's active telemedicine price points,
// each with the same quote the booking endpoint will escrow.
func (s *Service) listDoctorPackages(ctx context.Context, doctorUserID string) ([]DoctorPackage, error) {
	const q = `SELECT id::text, mode, duration_minutes, price_kobo
	           FROM consult_session_packages
	           WHERE owner_kind='doctor' AND owner_id=$1::uuid
	             AND vertical='telemedicine' AND active=TRUE
	           ORDER BY mode, price_kobo, duration_minutes`
	rows, err := s.db.Query(ctx, q, doctorUserID)
	if err != nil {
		return nil, fmt.Errorf("telemedicine: list packages: %w", err)
	}
	defer rows.Close()
	out := []DoctorPackage{}
	for rows.Next() {
		var p DoctorPackage
		if err := rows.Scan(&p.ID, &p.Mode, &p.DurationMinutes, &p.PriceKobo); err != nil {
			return nil, err
		}
		p.Booking = s.quote(p.PriceKobo)
		out = append(out, p)
	}
	return out, rows.Err()
}

// OpenConsultSession returns the single session pinned to an appointment,
// creating it on first open. Both participants may open it; a stranger gets
// the same not-found as a missing appointment. The request always carries a
// price snapshot from the committed appointment row: the patient paid that
// number, even if the provider edited the package price afterwards.
func (s *Service) OpenConsultSession(ctx context.Context, appointmentID, callerID string) (consultengine.Session, error) {
	if s.consult == nil {
		return consultengine.Session{}, ErrConsultUnavailable
	}
	if _, err := uuid.Parse(appointmentID); err != nil {
		return consultengine.Session{}, ErrAppointmentNotFound
	}
	const q = `
		SELECT a.patient_id::text, a.status, a.scheduled_at,
		       d.user_id::text, COALESCE(a.settlement_id::text, ''),
		       COALESCE(a.consult_package_id::text, ''),
		       COALESCE(a.consult_mode, 'video'),
		       a.fee_kobo,
		       COALESCE(a.consult_duration_minutes, 20)
		FROM appointments a
		JOIN doctors d ON d.id = a.doctor_id
		WHERE a.id = $1::uuid`
	var patientID, status, doctorUserID, holdID, packageID, mode string
	var scheduledAt time.Time
	var feeKobo int64
	var durationMinutes int
	err := s.db.QueryRow(ctx, q, appointmentID).Scan(&patientID, &status, &scheduledAt,
		&doctorUserID, &holdID, &packageID, &mode, &feeKobo, &durationMinutes)
	if errors.Is(err, pgx.ErrNoRows) {
		return consultengine.Session{}, ErrAppointmentNotFound
	}
	if err != nil {
		return consultengine.Session{}, fmt.Errorf("telemedicine: load appointment: %w", err)
	}
	if callerID != patientID && callerID != doctorUserID {
		return consultengine.Session{}, ErrAppointmentNotFound
	}
	if status != string(ApptBooked) && status != string(ApptConfirmed) {
		return consultengine.Session{}, ErrSessionNotOpenable
	}
	// An appointment opened more than five minutes late starts now, so the
	// patient still receives the full duration they paid for. The engine itself
	// refuses a start older than five minutes.
	start := scheduledAt
	if time.Now().After(scheduledAt.Add(5 * time.Minute)) {
		start = time.Time{}
	}
	return s.consult.EnsureSession(ctx, consultengine.BookRequest{
		Vertical:          consultengine.VerticalTelemedicine,
		Mode:              consultengine.Mode(mode),
		PatientID:         patientID,
		ProviderOwnerKind: consultengine.OwnerDoctor,
		ProviderOwnerID:   doctorUserID,
		ProviderUserID:    doctorUserID,
		SourceRef:         "appointment:" + appointmentID,
		PackageID:         packageID,
		BaseHoldID:        holdID,
		Start:             start,
		// Extension price derives from this snapshot, so fee_kobo stays the paid
		// consult fee alone; platform_fee_kobo is a separate column.
		Snapshot: &consultengine.PriceSnapshot{
			DurationMinutes: durationMinutes,
			PriceKobo:       feeKobo,
		},
	})
}
