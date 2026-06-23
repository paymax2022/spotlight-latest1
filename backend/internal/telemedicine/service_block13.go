package telemedicine

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// ─── Block 13: Availability ──────────────────────────────────────────────────

// defaultSlotTimes are the standard daily consultation windows offered when a
// doctor has not published a bespoke availability calendar.
var defaultSlotTimes = []string{
	"09:00 AM", "10:30 AM", "12:00 PM", "01:30 PM", "03:00 PM", "04:30 PM", "06:00 PM",
}

// GetAvailability returns a doctor's bookable slots for the next 5 days.
// If the doctor has published rows in doctor_availability they are returned as-is;
// otherwise a deterministic default calendar is synthesised so the booking UI is
// always populated. Booked slots are reported with available=false.
func (s *Service) GetAvailability(ctx context.Context, doctorID string) ([]Slot, error) {
	// Verify doctor exists.
	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM doctors WHERE id=$1)`, doctorID).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, fmt.Errorf("telemedicine: doctor not found")
	}

	rows, err := s.db.Query(ctx, `
		SELECT id, slot_date, slot_time, is_available
		FROM doctor_availability
		WHERE doctor_id = $1 AND slot_date >= CURRENT_DATE
		ORDER BY slot_date, slot_time`, doctorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var published []Slot
	for rows.Next() {
		var sl Slot
		var date time.Time
		if err := rows.Scan(&sl.ID, &date, &sl.Time, &sl.Available); err != nil {
			return nil, err
		}
		sl.DoctorID = doctorID
		sl.Date = date.Format("2006-01-02")
		published = append(published, sl)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(published) > 0 {
		return published, nil
	}

	return synthSlots(doctorID), nil
}

// synthSlots builds a deterministic 5-day x 7-slot calendar (mirrors the mobile
// demo generator) so the picker is never empty for an un-scheduled doctor.
func synthSlots(doctorID string) []Slot {
	out := make([]Slot, 0, 5*len(defaultSlotTimes))
	today := time.Now()
	for d := 0; d < 5; d++ {
		date := today.AddDate(0, 0, d).Format("2006-01-02")
		for i, tm := range defaultSlotTimes {
			out = append(out, Slot{
				ID:        fmt.Sprintf("%s-%s-%d", doctorID, date, i),
				DoctorID:  doctorID,
				Date:      date,
				Time:      tm,
				Available: (d+i)%3 != 0,
			})
		}
	}
	return out
}

// ─── Block 13: Confirm / Reschedule ──────────────────────────────────────────

// ConfirmAppointment moves a booked appointment to confirmed. The patient who
// booked it or the assigned doctor may confirm.
func (s *Service) ConfirmAppointment(ctx context.Context, appointmentID, userID string) error {
	var patientID, status string
	if err := s.db.QueryRow(ctx,
		`SELECT patient_id, status FROM appointments WHERE id=$1`, appointmentID).
		Scan(&patientID, &status); err != nil {
		return fmt.Errorf("telemedicine: appointment not found")
	}
	if !s.isParticipant(ctx, appointmentID, userID, patientID) {
		return fmt.Errorf("telemedicine: not authorised for this appointment")
	}
	if status != string(ApptBooked) {
		return fmt.Errorf("telemedicine: only booked appointments can be confirmed")
	}
	_, err := s.db.Exec(ctx, `UPDATE appointments SET status='confirmed' WHERE id=$1`, appointmentID)
	return err
}

// RescheduleAppointment moves an appointment to a new time. Completed or
// cancelled appointments cannot be rescheduled. No money moves (the escrow and
// settlement_id are preserved).
func (s *Service) RescheduleAppointment(ctx context.Context, appointmentID, userID string, req RescheduleRequest) error {
	var patientID, status string
	if err := s.db.QueryRow(ctx,
		`SELECT patient_id, status FROM appointments WHERE id=$1`, appointmentID).
		Scan(&patientID, &status); err != nil {
		return fmt.Errorf("telemedicine: appointment not found")
	}
	if !s.isParticipant(ctx, appointmentID, userID, patientID) {
		return fmt.Errorf("telemedicine: not authorised for this appointment")
	}
	if status == string(ApptCompleted) || status == string(ApptCancelled) {
		return fmt.Errorf("telemedicine: cannot reschedule a %s appointment", status)
	}
	_, err := s.db.Exec(ctx,
		`UPDATE appointments SET scheduled_at=$1 WHERE id=$2`, req.ScheduledAt, appointmentID)
	return err
}

// ─── Block 13: Reviews ───────────────────────────────────────────────────────

// AddReview records a patient's rating for a completed appointment and refreshes
// the doctor's aggregate rating/review_count projection. Reviews are immutable —
// a second review for the same appointment is rejected by the UNIQUE constraint.
func (s *Service) AddReview(ctx context.Context, appointmentID, patientID string, req SubmitReviewRequest) (*Review, error) {
	if req.Rating < 1 || req.Rating > 5 {
		return nil, fmt.Errorf("telemedicine: rating must be between 1 and 5")
	}
	var dbPatientID, doctorID, status string
	if err := s.db.QueryRow(ctx,
		`SELECT patient_id, doctor_id, status FROM appointments WHERE id=$1`, appointmentID).
		Scan(&dbPatientID, &doctorID, &status); err != nil {
		return nil, fmt.Errorf("telemedicine: appointment not found")
	}
	if dbPatientID != patientID {
		return nil, fmt.Errorf("telemedicine: only the patient can review this appointment")
	}
	if status != string(ApptCompleted) {
		return nil, fmt.Errorf("telemedicine: reviews are only allowed for completed appointments")
	}

	r := &Review{
		ID:            uuid.New().String(),
		AppointmentID: appointmentID,
		DoctorID:      doctorID,
		PatientID:     patientID,
		Rating:        req.Rating,
		Comment:       req.Comment,
		CreatedAt:     time.Now(),
	}
	const ins = `
		INSERT INTO telemedicine_reviews (id, appointment_id, doctor_id, patient_id, rating, comment)
		VALUES ($1,$2,$3,$4,$5,$6)`
	if _, err := s.db.Exec(ctx, ins, r.ID, r.AppointmentID, r.DoctorID, r.PatientID, r.Rating, r.Comment); err != nil {
		return nil, fmt.Errorf("telemedicine: save review: %w", err)
	}

	// Refresh the doctor's rating projection from the reviews table (source of truth).
	if _, err := s.db.Exec(ctx, `
		UPDATE doctors d SET
		    review_count = sub.cnt,
		    rating       = ROUND(sub.avg, 2)
		FROM (
		    SELECT COUNT(*) AS cnt, COALESCE(AVG(rating), 0) AS avg
		    FROM telemedicine_reviews WHERE doctor_id = $1 AND is_hidden = FALSE
		) sub
		WHERE d.id = $1`, doctorID); err != nil {
		return nil, fmt.Errorf("telemedicine: refresh doctor rating: %w", err)
	}
	return r, nil
}

// ListDoctorReviews returns visible reviews for a doctor (newest first).
func (s *Service) ListDoctorReviews(ctx context.Context, doctorID string, limit int) ([]Review, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := s.db.Query(ctx, `
		SELECT id, appointment_id, doctor_id, patient_id, rating, comment, is_hidden, created_at
		FROM telemedicine_reviews
		WHERE doctor_id = $1 AND is_hidden = FALSE
		ORDER BY created_at DESC LIMIT $2`, doctorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Review
	for rows.Next() {
		var r Review
		if err := rows.Scan(&r.ID, &r.AppointmentID, &r.DoctorID, &r.PatientID, &r.Rating, &r.Comment, &r.IsHidden, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ─── Block 13: Visit summary ─────────────────────────────────────────────────

// GetVisitSummary returns the patient-facing summary for an appointment. If no
// explicit summary row exists, it is derived from the doctor's SOAP note.
func (s *Service) GetVisitSummary(ctx context.Context, appointmentID, userID string) (*VisitSummary, error) {
	var patientID string
	if err := s.db.QueryRow(ctx,
		`SELECT patient_id FROM appointments WHERE id=$1`, appointmentID).Scan(&patientID); err != nil {
		return nil, fmt.Errorf("telemedicine: appointment not found")
	}
	if !s.isParticipant(ctx, appointmentID, userID, patientID) {
		return nil, fmt.Errorf("telemedicine: not authorised for this appointment")
	}

	var vs VisitSummary
	err := s.db.QueryRow(ctx, `
		SELECT id, appointment_id, doctor_id, patient_id, diagnosis, notes, follow_up, created_at
		FROM visit_summaries WHERE appointment_id=$1`, appointmentID).
		Scan(&vs.ID, &vs.AppointmentID, &vs.DoctorID, &vs.PatientID, &vs.Diagnosis, &vs.Notes, &vs.FollowUp, &vs.CreatedAt)
	if err == nil {
		return &vs, nil
	}

	// Fall back to deriving from the SOAP note (assessment -> diagnosis, plan -> follow-up).
	var doctorID, assessment, objective, plan string
	derr := s.db.QueryRow(ctx, `
		SELECT doctor_id, assessment, objective, plan
		FROM doctor_soap_notes WHERE appointment_id=$1`, appointmentID).
		Scan(&doctorID, &assessment, &objective, &plan)
	if derr != nil {
		return nil, fmt.Errorf("telemedicine: no visit summary available")
	}
	return &VisitSummary{
		AppointmentID: appointmentID,
		DoctorID:      doctorID,
		PatientID:     patientID,
		Diagnosis:     assessment,
		Notes:         objective,
		FollowUp:      plan,
	}, nil
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// isParticipant returns true if userID is the appointment's patient or its doctor.
func (s *Service) isParticipant(ctx context.Context, appointmentID, userID, patientID string) bool {
	if userID == patientID {
		return true
	}
	var isDoctor bool
	_ = s.db.QueryRow(ctx, `
		SELECT EXISTS(
		    SELECT 1 FROM appointments a
		    JOIN doctors d ON d.id = a.doctor_id
		    WHERE a.id = $1 AND d.user_id = $2
		)`, appointmentID, userID).Scan(&isDoctor)
	return isDoctor
}
