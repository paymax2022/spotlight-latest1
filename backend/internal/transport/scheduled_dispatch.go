package transport

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"
)

// ─── Scheduler dispatch + sweeps ─────────────────────────────────────────────
//
// These methods are the worker-facing surface (backend/cmd/transport-scheduler).
// They are all idempotent and safe to run every 60s:
//   - DispatchScheduled: guarded materialize+escrow of ONE booking (deterministic
//     idem key sched:<id>:dispatch), FSM-guarded, no stranded escrow on failure.
//   - DueForDispatch:    selects bookings whose lead window has arrived.
//   - ExpireStale:       safety-net expiry of past-due, never-dispatched bookings.
//   - SendDueReminders:  idempotent 24h/1h reminders (reminder_*_sent_at guards).

// maxDispatchAttempts is the number of materialization attempts before a booking
// is parked in failed_no_driver for the ops board to handle. Each worker tick
// makes at most one attempt per due booking.
const maxDispatchAttempts = 3

// DueForDispatch returns bookings still in 'scheduled' whose dispatch window has
// arrived: scheduled_pickup_at - lead_time_minutes ≤ now(). Ordered by pickup
// time so the most imminent movements dispatch first. limit caps the batch.
func (s *Service) DueForDispatch(ctx context.Context, limit int) ([]*ScheduledBooking, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	q := `SELECT ` + scheduledCols + `
		FROM transport_scheduled_bookings
		WHERE status='scheduled'
		  AND scheduled_pickup_at - make_interval(mins => lead_time_minutes) <= now()
		ORDER BY scheduled_pickup_at ASC
		LIMIT $1`
	rows, err := s.db.Query(ctx, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*ScheduledBooking
	for rows.Next() {
		b, err := scanScheduled(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// DispatchScheduled materializes ONE scheduled booking into the real
// trip/parcel/bus artifact, escrowing at dispatch via the existing per-mode
// service. It is the single guarded, idempotent entry point the worker calls.
//
// Flow:
//  1. Load + guard: must be in 'scheduled' or already 'dispatch_pending' (retry).
//  2. Flip scheduled → dispatch_pending (guarded, optimistic).
//  3. Materialize by mode via RequestRide / BookParcel / bus confirm, with a
//     DETERMINISTIC idempotency key sched:<id>:dispatch so a retry never
//     double-charges (the underlying settlement.Escrow is idempotent on the key).
//  4. On success: set materialized_ref/kind, settlement_id, dispatched_at,
//     status=dispatched.
//  5. On failure: increment attempts; if exhausted → failed_no_driver +
//     last_dispatch_error and REFUND any escrow that was taken (no stranded funds).
func (s *Service) DispatchScheduled(ctx context.Context, bookingID string) (*ScheduledBooking, error) {
	b, err := s.getScheduledRow(ctx, bookingID)
	if err != nil {
		return nil, err
	}
	// Idempotency: already dispatched/terminal → no-op return.
	switch b.Status {
	case SchedDispatched, SchedCompleted, SchedCancelled, SchedFailedNoDriver, SchedExpired:
		return b, nil
	case SchedScheduled:
		// Flip to dispatch_pending (guarded, optimistic on current status).
		if err := guardScheduled(SchedScheduled, SchedDispatchPending); err != nil {
			return nil, err
		}
		const flip = `UPDATE transport_scheduled_bookings
			SET status='dispatch_pending', updated_at=NOW()
			WHERE id=$1 AND status='scheduled' RETURNING ` + scheduledCols
		nb, ferr := scanScheduled(s.db.QueryRow(ctx, flip, bookingID))
		if ferr != nil {
			// Lost the race (another worker took it) — reload and continue.
			if b, err = s.getScheduledRow(ctx, bookingID); err != nil {
				return nil, err
			}
			if b.Status != SchedDispatchPending {
				return b, nil
			}
		} else {
			b = nb
		}
	case SchedDispatchPending:
		// Retry from a prior partial attempt — fall through to materialize.
	default:
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "booking not dispatchable from status "+string(b.Status))
	}

	// Deterministic dispatch idempotency key: the underlying escrow is keyed on
	// this, so retries converge to exactly one charge.
	idemKey := fmt.Sprintf("sched:%s:dispatch", b.ID)

	ref, kind, settlementID, matErr := s.materialize(ctx, b, idemKey)
	if matErr != nil {
		return s.onDispatchFailure(ctx, b, matErr, settlementID)
	}

	// Success: record materialization + flip to dispatched.
	const done = `
		UPDATE transport_scheduled_bookings
		SET status='dispatched', materialized_ref=$2, materialized_kind=$3,
		    settlement_id=$4, dispatched_at=NOW(), last_dispatch_error=NULL,
		    dispatch_attempts=dispatch_attempts+1, updated_at=NOW()
		WHERE id=$1 AND status='dispatch_pending'
		RETURNING ` + scheduledCols
	nb, err := scanScheduled(s.db.QueryRow(ctx, done, b.ID, ref, kind, nullStr(settlementID)))
	if err != nil {
		// Status changed under us (e.g. cancelled). The materialized artifact and
		// its escrow now belong to that terminal path; surface for reconciliation.
		s.recordModeEvent(ctx, b.UserID, "scheduled.dispatch_race", "scheduled_booking", b.ID,
			string(SchedDispatchPending), "", map[string]any{"materialized_ref": ref, "settlement_id": settlementID})
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "booking changed during dispatch")
	}
	s.recordModeEvent(ctx, b.UserID, "scheduled.dispatched", "scheduled_booking", b.ID,
		string(SchedDispatchPending), string(SchedDispatched),
		map[string]any{"materialized_ref": ref, "materialized_kind": kind, "settlement_id": settlementID})
	return nb, nil
}

// materialize creates the underlying trip/parcel/bus artifact for a booking via
// the existing per-mode service (which performs the escrow). It returns the new
// artifact's ref, its kind, and the escrow settlement id. Escrow happens INSIDE
// these existing paths (charge-at-dispatch).
func (s *Service) materialize(ctx context.Context, b *ScheduledBooking, idemKey string) (ref, kind, settlementID string, err error) {
	switch materializationKind(b.Mode) {
	case "trip":
		req := RequestRideRequest{
			Pickup:        placeFromBooking(b.PickupLabel, b.ModePayload, "pickup"),
			Dest:          placeFromBooking(b.DropoffLabel, b.ModePayload, "dropoff"),
			ServiceType:   rideServiceType(b.Mode),
			PricingMode:   "instant",
			PaymentMethod: b.PaymentMethod,
		}
		if pm := strFromPayload(b.ModePayload, "pricing_mode"); pm != "" {
			req.PricingMode = pm
			req.OfferKobo = int64(intFromPayload(b.ModePayload, "offer_kobo"))
		}
		td, rerr := s.RequestRide(ctx, b.UserID, req, idemKey)
		if rerr != nil {
			return "", "", "", rerr
		}
		tripID, _ := td.Trip["id"].(string)
		return tripID, "trip", settlementForRef(ctx, s, "trip:"+tripID), nil

	case "parcel":
		req := ParcelBookRequest{
			Pickup:        placeFromBooking(b.PickupLabel, b.ModePayload, "pickup"),
			Dropoff:       placeFromBooking(b.DropoffLabel, b.ModePayload, "dropoff"),
			ReceiverName:  strFromPayload(b.ModePayload, "receiver_name"),
			ReceiverPhone: strFromPayload(b.ModePayload, "receiver_phone"),
			Category:      strFromPayload(b.ModePayload, "category"),
			Size:          strFromPayload(b.ModePayload, "size"),
			Speed:         strFromPayload(b.ModePayload, "speed"),
			ProhibitedAck: true, // acknowledged at scheduling time
		}
		out, perr := s.BookParcel(ctx, b.UserID, req, idemKey)
		if perr != nil {
			return "", "", "", perr
		}
		parcelID, _ := out["id"].(string)
		return parcelID, "parcel", settlementForRef(ctx, s, "parcel:"+parcelID), nil

	case "bus":
		// Bus "scheduling" = the seat is booked in advance via the existing bus
		// flow. If the caller pre-booked a ticket at scheduling time (ticket_id in
		// payload) we validate it exists; otherwise we materialize the booking now.
		schedID := strFromPayload(b.ModePayload, "schedule_id")
		seat := intFromPayload(b.ModePayload, "seat_number")
		if schedID == "" || seat <= 0 {
			return "", "", "", codedErr(http.StatusUnprocessableEntity, "MISSING_BUS_PAYLOAD", "mode_payload.schedule_id and seat_number required for bus")
		}
		if ticketID := strFromPayload(b.ModePayload, "ticket_id"); ticketID != "" {
			// Pre-booked: confirm the ticket still exists + is owned by this user.
			var uid, status string
			var settID *string
			if qerr := s.db.QueryRow(ctx,
				`SELECT user_id, status, settlement_id FROM bus_tickets WHERE id=$1`, ticketID).
				Scan(&uid, &status, &settID); qerr != nil {
				return "", "", "", codedErr(http.StatusNotFound, CodeNotFound, "pre-booked bus ticket not found")
			}
			if uid != b.UserID {
				return "", "", "", codedErr(http.StatusForbidden, CodeForbidden, "bus ticket not owned by booking user")
			}
			sid := ""
			if settID != nil {
				sid = *settID
			}
			return ticketID, "bus_ticket", sid, nil
		}
		req := BusBookRequest{
			ScheduleID:    schedID,
			SeatNumber:    seat,
			PassengerName: strFromPayload(b.ModePayload, "passenger_name"),
		}
		out, berr := s.BookBusTicket(ctx, b.UserID, req, idemKey)
		if berr != nil {
			return "", "", "", berr
		}
		ticketID, _ := out["id"].(string)
		return ticketID, "bus_ticket", settlementForRef(ctx, s, "bus:"+ticketID), nil
	}
	return "", "", "", codedErr(http.StatusUnprocessableEntity, "INVALID_MODE", "unsupported scheduling mode")
}

// onDispatchFailure records a materialization failure. It increments the attempt
// counter; while attempts remain it returns the booking to 'scheduled' for a
// later retry, and once exhausted parks it in failed_no_driver. In BOTH cases it
// refunds any escrow that the failed materialization may have taken so funds are
// never stranded (settlementID is the ref, if the mode path got that far).
func (s *Service) onDispatchFailure(ctx context.Context, b *ScheduledBooking, cause error, settlementID string) (*ScheduledBooking, error) {
	// Always refund any escrow taken before/at the point of failure.
	if settlementID != "" {
		if rerr := s.settlement.Refund(ctx, settlementID, "scheduled_dispatch_failed"); rerr != nil {
			log.Printf("ERROR transport: scheduled dispatch refund failed booking=%s settlement=%s: %v", b.ID, settlementID, rerr)
		}
	}
	nextAttempts := b.DispatchAttempts + 1
	if nextAttempts >= maxDispatchAttempts {
		// Exhausted → terminal failed_no_driver (FSM: dispatch_pending → failed_no_driver).
		if err := guardScheduled(SchedDispatchPending, SchedFailedNoDriver); err != nil {
			return nil, err
		}
		const fail = `
			UPDATE transport_scheduled_bookings
			SET status='failed_no_driver', dispatch_attempts=$2, last_dispatch_error=$3, settlement_id=NULL, updated_at=NOW()
			WHERE id=$1 AND status='dispatch_pending'
			RETURNING ` + scheduledCols
		nb, err := scanScheduled(s.db.QueryRow(ctx, fail, b.ID, nextAttempts, cause.Error()))
		if err != nil {
			return nil, codedErr(http.StatusConflict, CodeInvalidState, "booking changed during dispatch")
		}
		s.recordModeEvent(ctx, b.UserID, "scheduled.failed_no_driver", "scheduled_booking", b.ID,
			string(SchedDispatchPending), string(SchedFailedNoDriver),
			map[string]any{"attempts": nextAttempts, "error": cause.Error()})
		s.notifyUser(ctx, b.UserID, "scheduled.failed_no_driver", b.ID,
			"We couldn't dispatch your scheduled "+b.Mode+" movement. Our team has been notified.")
		return nb, cause
	}
	// Attempts remain → return to 'scheduled' so the next tick retries.
	const retry = `
		UPDATE transport_scheduled_bookings
		SET status='scheduled', dispatch_attempts=$2, last_dispatch_error=$3, settlement_id=NULL, updated_at=NOW()
		WHERE id=$1 AND status='dispatch_pending'
		RETURNING ` + scheduledCols
	nb, err := scanScheduled(s.db.QueryRow(ctx, retry, b.ID, nextAttempts, cause.Error()))
	if err != nil {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "booking changed during dispatch")
	}
	s.recordModeEvent(ctx, b.UserID, "scheduled.dispatch_retry", "scheduled_booking", b.ID,
		string(SchedDispatchPending), string(SchedScheduled),
		map[string]any{"attempts": nextAttempts, "error": cause.Error()})
	return nb, cause
}

// ExpireStale is the safety net: bookings still in 'scheduled' whose pickup time
// has already passed (with a grace margin) are expired so they never sit forever
// as un-dispatched. These never escrowed, so there is nothing to refund.
func (s *Service) ExpireStale(ctx context.Context) (int, error) {
	const grace = 15 * time.Minute
	const q = `
		UPDATE transport_scheduled_bookings
		SET status='expired', updated_at=NOW()
		WHERE status='scheduled' AND scheduled_pickup_at < now() - $1::interval
		RETURNING id, user_id`
	rows, err := s.db.Query(ctx, q, grace)
	if err != nil {
		return 0, err
	}
	type ex struct{ id, uid string }
	var out []ex
	for rows.Next() {
		var e ex
		if err := rows.Scan(&e.id, &e.uid); err != nil {
			rows.Close()
			return 0, err
		}
		out = append(out, e)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	for _, e := range out {
		s.recordModeEvent(ctx, e.uid, "scheduled.expired", "scheduled_booking", e.id,
			string(SchedScheduled), string(SchedExpired), nil)
	}
	return len(out), nil
}

// SendDueReminders sends 24h + 1h pre-pickup reminders. Each reminder is
// idempotent: it only fires for bookings whose reminder_*_sent_at is NULL and
// whose pickup falls inside the window, and the send is guarded by stamping the
// timestamp in the SAME UPDATE (so a concurrent worker can't double-send).
func (s *Service) SendDueReminders(ctx context.Context) (sent int, err error) {
	sent += s.sendReminderWave(ctx, "reminder_24h_sent_at", 24*time.Hour, "24h")
	sent += s.sendReminderWave(ctx, "reminder_1h_sent_at", 1*time.Hour, "1h")
	return sent, nil
}

// sendReminderWave stamps + emits one reminder wave. The UPDATE ... RETURNING
// atomically claims each booking (sets the sent_at column) so the notification
// fires exactly once even across concurrent workers. window is how far ahead of
// pickup the reminder fires; we fire when pickup is within [now, now+window] for
// active (scheduled/dispatch_pending/dispatched) bookings.
func (s *Service) sendReminderWave(ctx context.Context, col string, window time.Duration, label string) int {
	q := fmt.Sprintf(`
		UPDATE transport_scheduled_bookings
		SET %s = NOW(), updated_at = NOW()
		WHERE %s IS NULL
		  AND status IN ('scheduled','dispatch_pending','dispatched')
		  AND scheduled_pickup_at > now()
		  AND scheduled_pickup_at <= now() + $1::interval
		RETURNING id, user_id, mode, scheduled_pickup_at`, col, col)
	rows, err := s.db.Query(ctx, q, window)
	if err != nil {
		log.Printf("ERROR transport: scheduled reminder wave %s: %v", label, err)
		return 0
	}
	type rem struct {
		id, uid, mode string
		at            time.Time
	}
	var out []rem
	for rows.Next() {
		var r rem
		if err := rows.Scan(&r.id, &r.uid, &r.mode, &r.at); err != nil {
			rows.Close()
			log.Printf("ERROR transport: scheduled reminder scan %s: %v", label, err)
			return len(out)
		}
		out = append(out, r)
	}
	rows.Close()
	for _, r := range out {
		s.notifyUser(ctx, r.uid, "scheduled.reminder", r.id,
			fmt.Sprintf("Reminder: your scheduled %s movement is due in %s (%s).", r.mode, label, r.at.Format(time.RFC1123)))
		s.recordModeEvent(ctx, r.uid, "scheduled.reminder_sent", "scheduled_booking", r.id, "", "",
			map[string]any{"window": label})
	}
	return len(out)
}

// notifyUser is the scheduling module's notification seam. The transport Service
// has no wired notifications.Service (it takes only a pool + settlement), so this
// is a log-and-audit outbox: the audit event above is the durable record and the
// reminder_*_sent_at / status columns are the idempotency guard. A later wiring
// can replace the body with notifications.Service.Send without changing callers.
//
// TODO(notifications): inject *notifications.Service into the transport Service
// (asynq push/email/SMS) and route these through it. Until then this is
// intentionally best-effort + idempotent at the DB layer.
func (s *Service) notifyUser(ctx context.Context, userID, event, bookingID, message string) {
	log.Printf("[transport-scheduler] notify user=%s event=%s booking=%s: %s", userID, event, bookingID, message)
}

// placeFromBooking builds a Place from a label + optional lat/lng carried in the
// booking payload (keys "<which>_lat"/"<which>_lng", e.g. "pickup_lat"). The geo
// columns are PostGIS; we carry the numeric coords in mode_payload so the mode
// services (which want lat/lng) can consume them without a geo round-trip.
func placeFromBooking(label *string, payload map[string]any, which string) Place {
	p := Place{}
	if label != nil {
		p.Address = *label
	}
	p.Lat = floatFromPayload(payload, which+"_lat")
	p.Lng = floatFromPayload(payload, which+"_lng")
	return p
}

func floatFromPayload(m map[string]any, key string) float64 {
	if m == nil {
		return 0
	}
	switch v := m[key].(type) {
	case float64:
		return v
	case int:
		return float64(v)
	case int64:
		return float64(v)
	}
	return 0
}

// settlementForRef looks up the escrow settlement id created for a given trip/
// parcel/bus reference so the scheduler can record it on the booking (for later
// refund/settle). Returns "" if none is found (never errors the dispatch).
func settlementForRef(ctx context.Context, s *Service, reference string) string {
	var id string
	// The base escrow row uses reference == "<kind>:<id>"; deltas use a suffix.
	if err := s.db.QueryRow(ctx,
		`SELECT id FROM settlements WHERE reference=$1 ORDER BY escrowed_at ASC LIMIT 1`, reference).Scan(&id); err != nil {
		return ""
	}
	return id
}
