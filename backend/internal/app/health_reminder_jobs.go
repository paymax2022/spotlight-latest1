package app

// Durable handlers for the two health reminder job types producers enqueue:
//   - "health.appointment.reminder"    (scheduling: 1h before slot_start)
//   - "health.vet.vaccination.reminder" (vet: 24h before due_at)
// Each handler re-reads its entity at fire time — the appointment may have
// been cancelled or the vaccination administered between scheduling and
// firing — then delivers through the platform notifications queue. A gone or
// finished entity is consumed quietly; a delivery failure returns the error
// so the run retries (a transient queue outage must not eat the reminder).

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/notifications"
	"spotlight/backend/internal/platform/queue"
	"spotlight/backend/internal/scheduler"
)

// healthReminderNotifier builds the platform notifications service for the
// reminder handlers. cfg.RedisURL == "" leaves a nil-client service — Send
// then fails observably (logged + metered) so the run retries instead of
// silently dropping the reminder.
func healthReminderNotifier(redisURL string) *notifications.Service {
	if redisURL == "" {
		return notifications.NewService(nil)
	}
	if qc, qerr := queue.NewClient(redisURL); qerr == nil {
		return notifications.NewService(qc)
	}
	return notifications.NewService(nil)
}

// deliverToUser resolves the member's registered Expo push tokens and enqueues
// one notification per device — the same fan-out the estate notifier uses
// (finance_routes.go). ChannelInApp is not platform-deliverable (there is no
// in-app task type — domains persist their own feed rows and health has none),
// so push is the only real channel. Zero tokens means undeliverable: consumed
// with a log — a retry cannot mint a device registration within the run's
// retry window.
func deliverToUser(ctx context.Context, pool *pgxpool.Pool, notif *notifications.Service, n notifications.Notification) error {
	rows, err := pool.Query(ctx, `SELECT token FROM device_push_tokens WHERE user_id=$1`, n.UserID)
	if err != nil {
		return fmt.Errorf("reminder %s: resolve push tokens: %w", n.Event, err)
	}
	var tokens []string
	for rows.Next() {
		var tok string
		if rows.Scan(&tok) == nil {
			tokens = append(tokens, tok)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("reminder %s: scan push tokens: %w", n.Event, err)
	}
	if len(tokens) == 0 {
		log.Printf("[scheduler] reminder %s user=%s: no device_push_tokens — consumed undeliverable", n.Event, n.UserID)
		return nil
	}
	n.Channels = []notifications.Channel{notifications.ChannelPush}
	var errs []error
	for _, tok := range tokens {
		n.PushToken = tok
		if err := notif.Send(ctx, n); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// appointmentReminderHandler delivers the 1-hour-early appointment reminder to
// the patient. Terminal/no-longer-upcoming states are consumed as no-ops.
func appointmentReminderHandler(pool *pgxpool.Pool, notif *notifications.Service) scheduler.HandlerFunc {
	return func(hctx scheduler.HandlerCtx) error {
		ctx := hctx.Context()
		apptID := hctx.Job().EntityRef()
		var state, visitType, patientID string
		var slotStart time.Time
		err := pool.QueryRow(ctx, `
			SELECT state, visit_type, patient_id::text, slot_start
			FROM public.health_appointments WHERE id = $1`, apptID).
			Scan(&state, &visitType, &patientID, &slotStart)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Printf("[scheduler] appointment reminder job=%s appt=%s: row gone — consumed", hctx.Job().ID(), apptID)
				return nil
			}
			return fmt.Errorf("appointment reminder: load %s: %w", apptID, err)
		}
		switch state {
		case "CANCELLED", "NO_SHOW", "COMPLETED", "IN_PROGRESS":
			log.Printf("[scheduler] appointment reminder job=%s appt=%s: state=%s — skipping", hctx.Job().ID(), apptID, state)
			return nil
		}
		kind := map[string]string{"TELE": "tele-consult", "HOME": "home visit", "CLINIC": "clinic visit"}[visitType]
		if kind == "" {
			kind = "appointment"
		}
		return deliverToUser(ctx, pool, notif, notifications.Notification{
			UserID: patientID,
			Event:  notifications.EventAppointmentReminder,
			Title:  "Appointment in 1 hour",
			Body: fmt.Sprintf("Your %s starts at %s.",
				kind, slotStart.Format("15:04 on Mon 2 Jan")),
			Data: map[string]any{"appointment_id": apptID},
		})
	}
}

// vaccinationReminderHandler delivers the 24-hour-early vaccination reminder
// to the pet owner. An already-administered or deleted schedule is a no-op.
func vaccinationReminderHandler(pool *pgxpool.Pool, notif *notifications.Service) scheduler.HandlerFunc {
	return func(hctx scheduler.HandlerCtx) error {
		ctx := hctx.Context()
		vaccID := hctx.Job().EntityRef()
		var vaccine, petName, ownerID string
		var dueAt time.Time
		var administeredAt *time.Time
		err := pool.QueryRow(ctx, `
			SELECT v.vaccine, v.due_at, v.administered_at, v.owner_user_id::text, p.name
			FROM public.vaccination_schedules v
			JOIN public.pets p ON p.id = v.pet_id
			WHERE v.id = $1`, vaccID).
			Scan(&vaccine, &dueAt, &administeredAt, &ownerID, &petName)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Printf("[scheduler] vaccination reminder job=%s vacc=%s: row gone — consumed", hctx.Job().ID(), vaccID)
				return nil
			}
			return fmt.Errorf("vaccination reminder: load %s: %w", vaccID, err)
		}
		if administeredAt != nil {
			log.Printf("[scheduler] vaccination reminder job=%s vacc=%s: already administered — skipping", hctx.Job().ID(), vaccID)
			return nil
		}
		return deliverToUser(ctx, pool, notif, notifications.Notification{
			UserID: ownerID,
			Event:  notifications.EventVaccinationReminder,
			Title:  "Vaccination due tomorrow",
			Body: fmt.Sprintf("%s is due for %s on %s.",
				petName, vaccine, dueAt.Format("Mon 2 Jan")),
			Data: map[string]any{"vaccination_id": vaccID},
		})
	}
}

// registerHealthReminderJobs wires the durable handlers the stub table in
// scheduler_poller.go references — real registrations land during route
// wiring, so the stub's HasHandler guard skips them; when a health module is
// flag-off the stub still consumes any stragglers with a loud log line.
func registerHealthReminderJobs(sched *scheduler.Service, pool *pgxpool.Pool, redisURL string) {
	notif := healthReminderNotifier(redisURL)
	sched.RegisterJobType("health.appointment.reminder", appointmentReminderHandler(pool, notif))
	sched.RegisterJobType("health.vet.vaccination.reminder", vaccinationReminderHandler(pool, notif))
}
