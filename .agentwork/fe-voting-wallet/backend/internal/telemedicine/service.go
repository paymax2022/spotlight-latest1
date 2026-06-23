package telemedicine

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"spotlight/backend/internal/finance/settlement"
)

// Service manages doctors, appointments, prescriptions, and consultation payments.
type Service struct {
	db         *pgxpool.Pool
	settlement *settlement.Service
}

func NewService(db *pgxpool.Pool, settlement *settlement.Service) *Service {
	return &Service{db: db, settlement: settlement}
}

// RegisterDoctor creates a doctor profile for an authenticated user.
func (s *Service) RegisterDoctor(ctx context.Context, userID string, req RegisterDoctorRequest) (*Doctor, error) {
	d := &Doctor{
		ID:             uuid.New().String(),
		UserID:         userID,
		Name:           req.Name,
		Specialty:      req.Specialty,
		Bio:            req.Bio,
		ConsultFeeKobo: req.ConsultFeeKobo,
		AvatarURL:      req.AvatarURL,
		IsAvailable:    true,
		CreatedAt:      time.Now(),
	}
	const q = `INSERT INTO doctors (id, user_id, name, specialty, bio, consult_fee_kobo, avatar_url, is_available) VALUES ($1,$2,$3,$4,$5,$6,$7,true)`
	_, err := s.db.Exec(ctx, q, d.ID, d.UserID, d.Name, string(d.Specialty), d.Bio, d.ConsultFeeKobo, d.AvatarURL)
	return d, err
}

// ListDoctors lists available doctors, optionally filtered by specialty.
func (s *Service) ListDoctors(ctx context.Context, specialty string, limit, offset int) ([]Doctor, error) {
	args := []any{limit, offset}
	filter := ""
	if specialty != "" {
		filter = " AND specialty=$3"
		args = append(args, specialty)
	}
	q := `SELECT id, user_id, name, specialty, bio, consult_fee_kobo, avatar_url, is_available, created_at FROM doctors WHERE is_available=true` + filter + ` ORDER BY name LIMIT $1 OFFSET $2`
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Doctor
	for rows.Next() {
		var d Doctor
		if err := rows.Scan(&d.ID, &d.UserID, &d.Name, &d.Specialty, &d.Bio, &d.ConsultFeeKobo, &d.AvatarURL, &d.IsAvailable, &d.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// BookAppointment escrows the consultation fee and creates an appointment.
func (s *Service) BookAppointment(ctx context.Context, patientID string, req BookAppointmentRequest) (*Appointment, error) {
	// Fetch doctor fee.
	var doctor Doctor
	const qD = `SELECT id, user_id, consult_fee_kobo, is_available FROM doctors WHERE id=$1`
	if err := s.db.QueryRow(ctx, qD, req.DoctorID).Scan(&doctor.ID, &doctor.UserID, &doctor.ConsultFeeKobo, &doctor.IsAvailable); err != nil {
		return nil, fmt.Errorf("telemedicine: doctor not found")
	}
	if !doctor.IsAvailable {
		return nil, fmt.Errorf("telemedicine: doctor is not currently available")
	}

	apptID := uuid.New().String()
	ref := "appointment:" + apptID
	sett, err := s.settlement.Escrow(ctx, patientID, ref, req.IdempotencyKey, "telemedicine", doctor.ConsultFeeKobo)
	if err != nil {
		return nil, fmt.Errorf("telemedicine: escrow fee: %w", err)
	}

	appt := &Appointment{
		ID:             apptID,
		PatientID:      patientID,
		DoctorID:       req.DoctorID,
		ScheduledAt:    req.ScheduledAt,
		Status:         ApptBooked,
		Notes:          req.Notes,
		FeeKobo:        doctor.ConsultFeeKobo,
		IdempotencyKey: req.IdempotencyKey,
		SettlementID:   sett.ID,
		CreatedAt:      time.Now(),
	}
	const q = `
		INSERT INTO appointments (id, patient_id, doctor_id, scheduled_at, status, notes, fee_kobo, idempotency_key, settlement_id)
		VALUES ($1,$2,$3,$4,'booked',$5,$6,$7,$8)`
	if _, err := s.db.Exec(ctx, q,
		appt.ID, appt.PatientID, appt.DoctorID, appt.ScheduledAt,
		appt.Notes, appt.FeeKobo, appt.IdempotencyKey, appt.SettlementID,
	); err != nil {
		return nil, fmt.Errorf("telemedicine: insert appointment: %w", err)
	}
	return appt, nil
}

// CompleteAppointment marks an appointment as completed and settles the fee.
// 85% to doctor, 15% platform.
func (s *Service) CompleteAppointment(ctx context.Context, appointmentID, doctorUserID string) error {
	var appt Appointment
	const q = `SELECT id, doctor_id, status, settlement_id FROM appointments WHERE id=$1`
	if err := s.db.QueryRow(ctx, q, appointmentID).Scan(&appt.ID, &appt.DoctorID, &appt.Status, &appt.SettlementID); err != nil {
		return fmt.Errorf("telemedicine: appointment not found")
	}
	if appt.Status != ApptBooked && appt.Status != ApptConfirmed {
		return fmt.Errorf("telemedicine: appointment is not in a completable state")
	}
	// Verify actor is the doctor.
	var dbDoctorUserID string
	if err := s.db.QueryRow(ctx, `SELECT user_id FROM doctors WHERE id=$1`, appt.DoctorID).Scan(&dbDoctorUserID); err != nil {
		return fmt.Errorf("telemedicine: doctor record not found")
	}
	if dbDoctorUserID != doctorUserID {
		return fmt.Errorf("telemedicine: only the assigned doctor can complete this appointment")
	}

	split := settlement.Split{
		ProviderID:  doctorUserID,
		ProviderPct: 0.85,
		PlatformPct: 0.15,
	}
	if err := s.settlement.Settle(ctx, appt.SettlementID, split); err != nil {
		return fmt.Errorf("telemedicine: settle fee: %w", err)
	}
	_, err := s.db.Exec(ctx, `UPDATE appointments SET status='completed' WHERE id=$1`, appointmentID)
	return err
}

// CancelAppointment refunds the patient if the appointment has not been completed.
func (s *Service) CancelAppointment(ctx context.Context, appointmentID, actorID string) error {
	var patientID, status, settlementID string
	if err := s.db.QueryRow(ctx, `SELECT patient_id, status, settlement_id FROM appointments WHERE id=$1`, appointmentID).
		Scan(&patientID, &status, &settlementID); err != nil {
		return fmt.Errorf("telemedicine: appointment not found")
	}
	if status == string(ApptCompleted) {
		return fmt.Errorf("telemedicine: cannot cancel a completed appointment")
	}
	if err := s.settlement.Refund(ctx, settlementID, "appointment_cancelled"); err != nil {
		return fmt.Errorf("telemedicine: refund fee: %w", err)
	}
	_, err := s.db.Exec(ctx, `UPDATE appointments SET status='cancelled' WHERE id=$1`, appointmentID)
	return err
}

// IssuePrescription creates a prescription for a completed appointment.
func (s *Service) IssuePrescription(ctx context.Context, appointmentID, doctorUserID string, req IssuePrescriptionRequest) (*Prescription, error) {
	var patientID, doctorID string
	var status string
	if err := s.db.QueryRow(ctx, `SELECT patient_id, doctor_id, status FROM appointments WHERE id=$1`, appointmentID).
		Scan(&patientID, &doctorID, &status); err != nil {
		return nil, fmt.Errorf("telemedicine: appointment not found")
	}
	if status != string(ApptCompleted) {
		return nil, fmt.Errorf("telemedicine: prescriptions can only be issued for completed appointments")
	}
	var dbDoctorUserID string
	if err := s.db.QueryRow(ctx, `SELECT user_id FROM doctors WHERE id=$1`, doctorID).Scan(&dbDoctorUserID); err != nil {
		return nil, fmt.Errorf("telemedicine: doctor not found")
	}
	if dbDoctorUserID != doctorUserID {
		return nil, fmt.Errorf("telemedicine: only the assigned doctor can issue prescriptions")
	}

	p := &Prescription{
		ID:            uuid.New().String(),
		AppointmentID: appointmentID,
		DoctorID:      doctorID,
		PatientID:     patientID,
		Medications:   req.Medications,
		Instructions:  req.Instructions,
		IssuedAt:      time.Now(),
	}
	const q = `INSERT INTO prescriptions (id, appointment_id, doctor_id, patient_id, medications, instructions) VALUES ($1,$2,$3,$4,$5,$6)`
	_, err := s.db.Exec(ctx, q, p.ID, p.AppointmentID, p.DoctorID, p.PatientID, p.Medications, p.Instructions)
	return p, err
}
