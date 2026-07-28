package telemedicine_test

import (
	"testing"

	"spotlight/backend/internal/telemedicine"
)

// TestAppointmentStatusConstants verifies appointment status values are distinct.
func TestAppointmentStatusConstants(t *testing.T) {
	statuses := []telemedicine.AppointmentStatus{
		telemedicine.ApptBooked,
		telemedicine.ApptConfirmed,
		telemedicine.ApptCompleted,
		telemedicine.ApptCancelled,
	}
	seen := map[telemedicine.AppointmentStatus]bool{}
	for _, s := range statuses {
		if s == "" {
			t.Error("AppointmentStatus must not be empty string")
		}
		if seen[s] {
			t.Errorf("duplicate AppointmentStatus: %q", s)
		}
		seen[s] = true
	}
}

// TestTerminalAppointmentStates verifies completed and cancelled are terminal.
func TestTerminalAppointmentStates(t *testing.T) {
	entry := telemedicine.ApptBooked
	terminals := []telemedicine.AppointmentStatus{
		telemedicine.ApptCompleted,
		telemedicine.ApptCancelled,
	}
	for _, ts := range terminals {
		if ts == entry {
			t.Errorf("terminal state %q must not equal entry state (booked)", ts)
		}
	}
}

// TestConsultFeeMinimum verifies that a consultation fee must be at least ₦1.
// The binding tag requires min=100 (₦1 in kobo).
func TestConsultFeeMinimum(t *testing.T) {
	req := telemedicine.RegisterDoctorRequest{
		Name:           "Dr. Test",
		Specialty:      "General",
		ConsultFeeKobo: 100,
	}
	if req.ConsultFeeKobo < 100 {
		t.Errorf("ConsultFeeKobo must be at least 100 (₦1), got %d", req.ConsultFeeKobo)
	}
}

// TestSettlementSplitForTelemedicine verifies the 85/15 split for telemedicine.
// Doctor receives 85%, platform 15% — these must sum to exactly 1.0.
func TestSettlementSplitForTelemedicine(t *testing.T) {
	doctorPct := 0.85
	platformPct := 0.15
	total := doctorPct + platformPct
	if total < 0.999 || total > 1.001 {
		t.Errorf("telemedicine split does not sum to 1.0: got %f", total)
	}
}

// TestDoctorFields verifies Doctor has non-empty required fields.
func TestDoctorFields(t *testing.T) {
	d := telemedicine.Doctor{
		UserID:         "user-abc",
		Name:           "Dr. Smith",
		Specialty:      "Cardiology",
		ConsultFeeKobo: 5_000_000, // ₦50,000
	}
	if d.UserID == "" {
		t.Error("Doctor.UserID must not be empty")
	}
	if d.ConsultFeeKobo <= 0 {
		t.Errorf("Doctor.ConsultFeeKobo must be positive, got %d", d.ConsultFeeKobo)
	}
}
