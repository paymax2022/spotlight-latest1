package telemedicine

import (
	"context"
	"fmt"
	"log"
	"time"
)

// Booking lifecycle notifications. Delivery goes through the platform
// notifications service (wired in app/finance_routes.go); this package only
// decides who hears what. Sending is best-effort and off the request path: a
// queue outage must never fail or slow a booking whose money already moved.

const (
	NotifyEventBooked    = "telemedicine.appointment.booked"
	NotifyEventCancelled = "telemedicine.appointment.cancelled"
)

// Notifier delivers one message to one user.
type Notifier interface {
	NotifyUser(ctx context.Context, userID, event, title, body string, data map[string]any) error
}

// NotifierFunc adapts a function to Notifier.
type NotifierFunc func(ctx context.Context, userID, event, title, body string, data map[string]any) error

func (f NotifierFunc) NotifyUser(ctx context.Context, userID, event, title, body string, data map[string]any) error {
	return f(ctx, userID, event, title, body, data)
}

// WithNotifier wires booking/cancellation notifications. Nil disables them.
func (s *Service) WithNotifier(n Notifier) *Service {
	s.notify = n
	return s
}

type notice struct {
	userID, event, title, body string
	data                       map[string]any
}

// wat is Nigeria's fixed UTC+1 offset; a fixed zone avoids depending on tzdata in the image.
var wat = time.FixedZone("WAT", 3600)

func slotText(t time.Time) string { return t.In(wat).Format("Mon 2 Jan, 3:04 PM") + " WAT" }

func bookedNotices(a *Appointment, doctorUserID string) []notice {
	data := map[string]any{"appointment_id": a.ID, "scheduled_at": a.ScheduledAt.UTC().Format(time.RFC3339)}
	out := []notice{{
		userID: a.PatientID, event: NotifyEventBooked, data: data,
		title: "Appointment booked",
		body:  fmt.Sprintf("Your %s consultation with %s is booked for %s.", a.ConsultationType, a.DoctorName, slotText(a.ScheduledAt)),
	}}
	if doctorUserID != "" {
		out = append(out, notice{
			userID: doctorUserID, event: NotifyEventBooked, data: data,
			title: "New consultation booked",
			body:  fmt.Sprintf("A patient booked a %s consultation for %s.", a.ConsultationType, slotText(a.ScheduledAt)),
		})
	}
	return out
}

func cancelledNotices(apptID, patientID, doctorUserID, doctorName string, at time.Time) []notice {
	data := map[string]any{"appointment_id": apptID}
	out := []notice{{
		userID: patientID, event: NotifyEventCancelled, data: data,
		title: "Appointment cancelled",
		body:  fmt.Sprintf("Your consultation with %s on %s was cancelled. Your payment has been refunded to your wallet.", doctorName, slotText(at)),
	}}
	if doctorUserID != "" {
		out = append(out, notice{
			userID: doctorUserID, event: NotifyEventCancelled, data: data,
			title: "Consultation cancelled",
			body:  fmt.Sprintf("The consultation on %s was cancelled.", slotText(at)),
		})
	}
	return out
}

// dispatch sends in the background with its own deadline, detached from the
// request context so a client disconnect does not drop the notice.
func (s *Service) dispatch(ctx context.Context, notices []notice) {
	if s.notify == nil || len(notices) == 0 {
		return
	}
	n := s.notify
	bg := context.WithoutCancel(ctx)
	go func() {
		ctx, cancel := context.WithTimeout(bg, 15*time.Second)
		defer cancel()
		for _, m := range notices {
			if err := n.NotifyUser(ctx, m.userID, m.event, m.title, m.body, m.data); err != nil {
				log.Printf("[telemedicine] notify %s user=%s failed: %v", m.event, m.userID, err)
			}
		}
	}()
}

// notifyCancelled resolves the parties of a just-cancelled appointment and notifies them.
func (s *Service) notifyCancelled(ctx context.Context, appointmentID string) {
	if s.notify == nil {
		return
	}
	var patientID, doctorUserID, doctorName string
	var at time.Time
	err := s.db.QueryRow(ctx, `
		SELECT a.patient_id::text, COALESCE(d.user_id::text, ''), COALESCE(NULLIF(a.doctor_name, ''), d.name, 'your doctor'), a.scheduled_at
		FROM appointments a LEFT JOIN doctors d ON d.id = a.doctor_id
		WHERE a.id = $1`, appointmentID).Scan(&patientID, &doctorUserID, &doctorName, &at)
	if err != nil {
		log.Printf("[telemedicine] notify cancel %s: resolve parties: %v", appointmentID, err)
		return
	}
	s.dispatch(ctx, cancelledNotices(appointmentID, patientID, doctorUserID, doctorName, at))
}
