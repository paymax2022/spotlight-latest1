package doctor

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// repository_ops.go — pgx data access for the Wave 4 (operational) endpoint groups:
// chat persistence, call sessions, schedule management, appointment queue, HMO claim
// submission/dispute, and the multi-clinic portfolio.
//
// Every read is scoped to the owning doctor's user_id (defence-in-depth on top of RLS).
// Mutations on tables carrying a UNIQUE idempotency_key (doctor_chat_messages,
// doctor_hmo_claims) create rows with ON CONFLICT (idempotency_key) DO NOTHING + replay
// (mirroring InsertPharmacyMessage / InsertReviewDispute). State-transition mutations on
// pre-existing rows (call session start/end, appointment request accept/reject) and the
// schedule-settings UPSERTs are scoped, status-guarded and naturally idempotent. None of
// these post ledger entries — they are CRUD / state transitions / aggregation.

// ══ CHAT ════════════════════════════════════════════════════════════════════

func (r *Repository) ListChatThreads(ctx context.Context, userID string) ([]ChatThread, error) {
	const q = `
		SELECT id, user_id, appointment_id, patient, consult_type, status,
		       last_message, last_message_at, unread_count, created_at, updated_at
		FROM doctor_chat_threads WHERE user_id = $1 ORDER BY COALESCE(last_message_at, created_at) DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ChatThread{}
	for rows.Next() {
		t := ChatThread{}
		if err := rows.Scan(&t.ID, &t.UserID, &t.AppointmentID, &t.Patient, &t.ConsultType,
			&t.Status, &t.LastMessage, &t.LastMessageAt, &t.UnreadCount, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// getChatThread confirms the thread belongs to the doctor (scoping guard for messages).
func (r *Repository) getChatThread(ctx context.Context, userID, threadID string) (*ChatThread, error) {
	const q = `
		SELECT id, user_id, appointment_id, patient, consult_type, status,
		       last_message, last_message_at, unread_count, created_at, updated_at
		FROM doctor_chat_threads WHERE id = $1 AND user_id = $2`
	t := &ChatThread{}
	err := r.db.QueryRow(ctx, q, threadID, userID).Scan(&t.ID, &t.UserID, &t.AppointmentID, &t.Patient,
		&t.ConsultType, &t.Status, &t.LastMessage, &t.LastMessageAt, &t.UnreadCount, &t.CreatedAt, &t.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return t, err
}

func (r *Repository) ListChatMessages(ctx context.Context, userID, threadID string) ([]ChatMessage, error) {
	if _, err := r.getChatThread(ctx, userID, threadID); err != nil {
		return nil, err
	}
	const q = `
		SELECT id, thread_id, user_id, author, body, message_kind, attachment_url, attachment_name, created_at
		FROM doctor_chat_messages WHERE thread_id = $1 AND user_id = $2 ORDER BY created_at ASC`
	rows, err := r.db.Query(ctx, q, threadID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ChatMessage{}
	for rows.Next() {
		m := ChatMessage{}
		if err := rows.Scan(&m.ID, &m.ThreadID, &m.UserID, &m.Author, &m.Body, &m.MessageKind,
			&m.AttachmentURL, &m.AttachmentName, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// InsertChatMessage persists a doctor message idempotently (UNIQUE idempotency_key) and
// rolls the thread's last_message / last_message_at forward. Scoped to the thread owner.
func (r *Repository) InsertChatMessage(ctx context.Context, userID, threadID string, req SendChatMessageRequest, idemKey string) (*ChatMessage, error) {
	if _, err := r.getChatThread(ctx, userID, threadID); err != nil {
		return nil, err
	}
	id := uuid.New().String()
	kind := "text"
	if req.AttachmentURL != nil && *req.AttachmentURL != "" {
		kind = "attachment"
	}
	const q = `
		INSERT INTO doctor_chat_messages (id, thread_id, user_id, author, body, message_kind, attachment_url, attachment_name, idempotency_key)
		VALUES ($1,$2,$3,'doctor',$4,$5,$6,$7,$8)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := r.db.Exec(ctx, q, id, threadID, userID, req.Body, kind, req.AttachmentURL, req.AttachmentName, idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return r.getChatMessageByIdem(ctx, userID, idemKey)
	}
	// Roll the thread summary forward (best-effort, scoped). TODO(integration): realtime
	// WS push to the patient is out of scope for this wave — only persistence is wired.
	_, _ = r.db.Exec(ctx,
		`UPDATE doctor_chat_threads SET last_message = $3, last_message_at = now(), updated_at = now()
		 WHERE id = $1 AND user_id = $2`, threadID, userID, req.Body)
	return r.getChatMessageByID(ctx, userID, id)
}

func (r *Repository) getChatMessageByID(ctx context.Context, userID, id string) (*ChatMessage, error) {
	const q = `
		SELECT id, thread_id, user_id, author, body, message_kind, attachment_url, attachment_name, created_at
		FROM doctor_chat_messages WHERE id = $1 AND user_id = $2`
	m := &ChatMessage{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&m.ID, &m.ThreadID, &m.UserID, &m.Author, &m.Body,
		&m.MessageKind, &m.AttachmentURL, &m.AttachmentName, &m.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return m, err
}

func (r *Repository) getChatMessageByIdem(ctx context.Context, userID, idemKey string) (*ChatMessage, error) {
	const q = `
		SELECT id, thread_id, user_id, author, body, message_kind, attachment_url, attachment_name, created_at
		FROM doctor_chat_messages WHERE user_id = $1 AND idempotency_key = $2`
	m := &ChatMessage{}
	err := r.db.QueryRow(ctx, q, userID, idemKey).Scan(&m.ID, &m.ThreadID, &m.UserID, &m.Author, &m.Body,
		&m.MessageKind, &m.AttachmentURL, &m.AttachmentName, &m.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return m, err
}

// ══ CALL SESSIONS ═══════════════════════════════════════════════════════════

// GetCallSessionForAppointment returns the latest call session for an appointment (scoped).
func (r *Repository) GetCallSessionForAppointment(ctx context.Context, userID, appointmentID string) (*CallSession, error) {
	const q = `
		SELECT id, user_id, appointment_id, patient, mode, status, provider, room_token,
		       started_at, ended_at, duration_secs, detail, created_at, updated_at
		FROM doctor_call_sessions WHERE appointment_id = $1 AND user_id = $2
		ORDER BY created_at DESC LIMIT 1`
	s := &CallSession{}
	err := r.db.QueryRow(ctx, q, appointmentID, userID).Scan(&s.ID, &s.UserID, &s.AppointmentID, &s.Patient,
		&s.Mode, &s.Status, &s.Provider, &s.RoomToken, &s.StartedAt, &s.EndedAt, &s.DurationSecs,
		&s.Detail, &s.CreatedAt, &s.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return s, err
}

func (r *Repository) getCallSessionByID(ctx context.Context, userID, id string) (*CallSession, error) {
	const q = `
		SELECT id, user_id, appointment_id, patient, mode, status, provider, room_token,
		       started_at, ended_at, duration_secs, detail, created_at, updated_at
		FROM doctor_call_sessions WHERE id = $1 AND user_id = $2`
	s := &CallSession{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&s.ID, &s.UserID, &s.AppointmentID, &s.Patient,
		&s.Mode, &s.Status, &s.Provider, &s.RoomToken, &s.StartedAt, &s.EndedAt, &s.DurationSecs,
		&s.Detail, &s.CreatedAt, &s.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return s, err
}

// StartCallSession creates (or replays) a 'live' session for an appointment.
// Idempotent on (appointment + an already-live session): a live session is reused
// rather than duplicated. roomToken is the placeholder provider token (see service).
func (r *Repository) StartCallSession(ctx context.Context, userID, appointmentID, mode, provider, roomToken string, detail []byte) (*CallSession, error) {
	// Replay: if a non-ended session already exists for this appointment, return it.
	if existing, err := r.GetCallSessionForAppointment(ctx, userID, appointmentID); err == nil {
		if existing.Status != "ended" && existing.Status != "failed" {
			return existing, nil
		}
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	id := uuid.New().String()
	const q = `
		INSERT INTO doctor_call_sessions (id, user_id, appointment_id, mode, status, provider, room_token, started_at, detail)
		VALUES ($1,$2,$3,$4,'live',$5,$6,now(),$7)`
	if _, err := r.db.Exec(ctx, q, id, userID, appointmentID, mode, provider, roomToken, jsonOrEmptyObject(detail)); err != nil {
		return nil, err
	}
	return r.getCallSessionByID(ctx, userID, id)
}

// EndCallSession transitions a session to 'ended' and stamps ended_at / duration.
// Scoped, status-guarded → naturally idempotent (ending an ended session is a no-op replay).
func (r *Repository) EndCallSession(ctx context.Context, userID, sessionID, status string, detail []byte) (*CallSession, error) {
	if status == "" {
		status = "ended"
	}
	const q = `
		UPDATE doctor_call_sessions
		SET status = $3,
		    ended_at = COALESCE(ended_at, now()),
		    duration_secs = CASE WHEN started_at IS NOT NULL
		                         THEN GREATEST(0, EXTRACT(EPOCH FROM (now() - started_at))::int)
		                         ELSE duration_secs END,
		    detail = detail || $4::jsonb,
		    updated_at = now()
		WHERE id = $1 AND user_id = $2`
	tag, err := r.db.Exec(ctx, q, sessionID, userID, status, jsonOrEmptyObject(detail))
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.getCallSessionByID(ctx, userID, sessionID)
}

// ══ SCHEDULE MANAGEMENT (Section E) ═════════════════════════════════════════

// ── Blocked dates ────────────────────────────────────────────────────────────

func (r *Repository) ListBlockedDates(ctx context.Context, userID string) ([]BlockedDate, error) {
	const q = `
		SELECT id, user_id, blocked_date, reason, all_day, start_time, end_time, created_at
		FROM doctor_blocked_dates WHERE user_id = $1 ORDER BY blocked_date DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []BlockedDate{}
	for rows.Next() {
		b := BlockedDate{}
		if err := rows.Scan(&b.ID, &b.UserID, &b.BlockedDate, &b.Reason, &b.AllDay,
			&b.StartTime, &b.EndTime, &b.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// InsertBlockedDate adds a blocked date. doctor_blocked_dates has no idempotency_key
// column, so this is a plain scoped insert (additive).
func (r *Repository) InsertBlockedDate(ctx context.Context, userID string, blockedDate time.Time, reason *string, allDay bool, startTime, endTime *string) (*BlockedDate, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO doctor_blocked_dates (id, user_id, blocked_date, reason, all_day, start_time, end_time)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`
	if _, err := r.db.Exec(ctx, q, id, userID, blockedDate, reason, allDay, startTime, endTime); err != nil {
		return nil, err
	}
	return &BlockedDate{ID: id, UserID: userID, BlockedDate: blockedDate, Reason: reason,
		AllDay: allDay, StartTime: startTime, EndTime: endTime, CreatedAt: time.Now()}, nil
}

// ── Vacation ─────────────────────────────────────────────────────────────────

// GetVacation returns the doctor's current (most recent) vacation, or ErrNotFound.
func (r *Repository) GetVacation(ctx context.Context, userID string) (*Vacation, error) {
	const q = `
		SELECT id, user_id, start_date, end_date, note, active, created_at, updated_at
		FROM doctor_vacations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`
	v := &Vacation{}
	err := r.db.QueryRow(ctx, q, userID).Scan(&v.ID, &v.UserID, &v.StartDate, &v.EndDate,
		&v.Note, &v.Active, &v.CreatedAt, &v.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return v, err
}

// SetVacation upserts the doctor's vacation period (one logical vacation per doctor).
// Idempotent: re-setting overwrites the same row's window/note/active flag.
func (r *Repository) SetVacation(ctx context.Context, userID string, startDate, endDate time.Time, note *string, active bool) (*Vacation, error) {
	existing, err := r.GetVacation(ctx, userID)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	if existing != nil {
		const upd = `
			UPDATE doctor_vacations
			SET start_date = $2, end_date = $3, note = $4, active = $5, updated_at = now()
			WHERE id = $1`
		if _, err := r.db.Exec(ctx, upd, existing.ID, startDate, endDate, note, active); err != nil {
			return nil, err
		}
		return r.GetVacation(ctx, userID)
	}
	id := uuid.New().String()
	const ins = `
		INSERT INTO doctor_vacations (id, user_id, start_date, end_date, note, active)
		VALUES ($1,$2,$3,$4,$5,$6)`
	if _, err := r.db.Exec(ctx, ins, id, userID, startDate, endDate, note, active); err != nil {
		return nil, err
	}
	return r.GetVacation(ctx, userID)
}

// ── Recurring rules ──────────────────────────────────────────────────────────

func (r *Repository) ListRecurringRules(ctx context.Context, userID string) ([]RecurringRule, error) {
	const q = `
		SELECT id, user_id, rule, active, created_at, updated_at
		FROM doctor_recurring_rules WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RecurringRule{}
	for rows.Next() {
		rr := RecurringRule{}
		if err := rows.Scan(&rr.ID, &rr.UserID, &rr.Rule, &rr.Active, &rr.CreatedAt, &rr.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, rr)
	}
	return out, rows.Err()
}

// SaveRecurringRule inserts a new recurring rule (rule body stored as JSONB).
func (r *Repository) SaveRecurringRule(ctx context.Context, userID string, rule []byte) (*RecurringRule, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO doctor_recurring_rules (id, user_id, rule)
		VALUES ($1,$2,$3)`
	if _, err := r.db.Exec(ctx, q, id, userID, jsonOrEmptyObject(rule)); err != nil {
		return nil, err
	}
	return r.getRecurringRuleByID(ctx, userID, id)
}

func (r *Repository) getRecurringRuleByID(ctx context.Context, userID, id string) (*RecurringRule, error) {
	const q = `
		SELECT id, user_id, rule, active, created_at, updated_at
		FROM doctor_recurring_rules WHERE id = $1 AND user_id = $2`
	rr := &RecurringRule{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&rr.ID, &rr.UserID, &rr.Rule, &rr.Active, &rr.CreatedAt, &rr.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return rr, err
}

// ── Reminders ────────────────────────────────────────────────────────────────

func (r *Repository) ListReminders(ctx context.Context, userID string) ([]Reminder, error) {
	const q = `
		SELECT id, user_id, reminder_type, settings, enabled, created_at, updated_at
		FROM doctor_reminders WHERE user_id = $1 ORDER BY created_at ASC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Reminder{}
	for rows.Next() {
		rm := Reminder{}
		if err := rows.Scan(&rm.ID, &rm.UserID, &rm.ReminderType, &rm.Settings, &rm.Enabled,
			&rm.CreatedAt, &rm.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, rm)
	}
	return out, rows.Err()
}

// SaveReminder upserts a reminder of the given type (one row per type per doctor).
// Idempotent: re-saving the same type overwrites settings/enabled.
func (r *Repository) SaveReminder(ctx context.Context, userID, reminderType string, settings []byte, enabled bool) (*Reminder, error) {
	if reminderType == "" {
		reminderType = "appointment"
	}
	var existingID string
	err := r.db.QueryRow(ctx,
		`SELECT id FROM doctor_reminders WHERE user_id = $1 AND reminder_type = $2 LIMIT 1`,
		userID, reminderType).Scan(&existingID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if existingID != "" {
		const upd = `
			UPDATE doctor_reminders SET settings = $2, enabled = $3, updated_at = now()
			WHERE id = $1`
		if _, err := r.db.Exec(ctx, upd, existingID, jsonOrEmptyObject(settings), enabled); err != nil {
			return nil, err
		}
		return r.getReminderByID(ctx, userID, existingID)
	}
	id := uuid.New().String()
	const ins = `
		INSERT INTO doctor_reminders (id, user_id, reminder_type, settings, enabled)
		VALUES ($1,$2,$3,$4,$5)`
	if _, err := r.db.Exec(ctx, ins, id, userID, reminderType, jsonOrEmptyObject(settings), enabled); err != nil {
		return nil, err
	}
	return r.getReminderByID(ctx, userID, id)
}

func (r *Repository) getReminderByID(ctx context.Context, userID, id string) (*Reminder, error) {
	const q = `
		SELECT id, user_id, reminder_type, settings, enabled, created_at, updated_at
		FROM doctor_reminders WHERE id = $1 AND user_id = $2`
	rm := &Reminder{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&rm.ID, &rm.UserID, &rm.ReminderType, &rm.Settings,
		&rm.Enabled, &rm.CreatedAt, &rm.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return rm, err
}

// ── Timezone / schedule settings (doctor_profiles) ───────────────────────────

// SetTimezone updates the doctor's timezone (scoped). Idempotent overwrite.
func (r *Repository) SetTimezone(ctx context.Context, userID, tz string) (*Profile, error) {
	const q = `UPDATE doctor_profiles SET timezone = $2, updated_at = now() WHERE user_id = $1`
	tag, err := r.db.Exec(ctx, q, userID, tz)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.GetProfile(ctx, userID)
}

// ══ APPOINTMENT QUEUE (Section F) ═══════════════════════════════════════════

func (r *Repository) ListConsultQueue(ctx context.Context, userID string) ([]ConsultQueueEntry, error) {
	const q = `
		SELECT id, user_id, appointment_id, position, status, detail, created_at, updated_at
		FROM doctor_consult_queue WHERE user_id = $1 ORDER BY position ASC, created_at ASC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ConsultQueueEntry{}
	for rows.Next() {
		e := ConsultQueueEntry{}
		if err := rows.Scan(&e.ID, &e.UserID, &e.AppointmentID, &e.Position, &e.Status,
			&e.Detail, &e.CreatedAt, &e.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (r *Repository) ListAppointmentRequests(ctx context.Context, userID string) ([]AppointmentRequest, error) {
	const q = `
		SELECT id, user_id, appointment_id, patient, consult_type, status, requested_slot, detail, created_at, updated_at
		FROM doctor_appointment_requests WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AppointmentRequest{}
	for rows.Next() {
		ar := AppointmentRequest{}
		if err := rows.Scan(&ar.ID, &ar.UserID, &ar.AppointmentID, &ar.Patient, &ar.ConsultType,
			&ar.Status, &ar.RequestedSlot, &ar.Detail, &ar.CreatedAt, &ar.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, ar)
	}
	return out, rows.Err()
}

func (r *Repository) GetAppointmentRequest(ctx context.Context, userID, id string) (*AppointmentRequest, error) {
	const q = `
		SELECT id, user_id, appointment_id, patient, consult_type, status, requested_slot, detail, created_at, updated_at
		FROM doctor_appointment_requests WHERE id = $1 AND user_id = $2`
	ar := &AppointmentRequest{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&ar.ID, &ar.UserID, &ar.AppointmentID, &ar.Patient,
		&ar.ConsultType, &ar.Status, &ar.RequestedSlot, &ar.Detail, &ar.CreatedAt, &ar.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return ar, err
}

// TransitionAppointment moves the underlying appointment to a new status (accept→confirmed,
// reject→cancelled, reschedule→rescheduled) and mirrors the decision onto its request row
// when one exists. Scoped + status-set → naturally idempotent. Returns the appointment.
func (r *Repository) TransitionAppointment(ctx context.Context, userID, appointmentID, status string, requestedSlot *string, detail []byte) (*Appointment, error) {
	const q = `
		UPDATE doctor_appointments SET status = $3, updated_at = now()
		WHERE id = $1 AND user_id = $2`
	tag, err := r.db.Exec(ctx, q, appointmentID, userID, status)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	// Mirror onto the linked request row (best-effort, scoped). Appointment status uses
	// the ConsultStatus vocabulary (confirmed|cancelled|upcoming); the request row uses
	// the AppointmentRequestStatus vocabulary (accepted|rejected|reschedule_requested).
	var reqStatus string
	switch status {
	case "confirmed":
		reqStatus = "accepted"
	case "cancelled":
		reqStatus = "rejected"
	case "upcoming":
		reqStatus = "reschedule_requested"
	default:
		reqStatus = status
	}
	_, _ = r.db.Exec(ctx,
		`UPDATE doctor_appointment_requests
		 SET status = $3, requested_slot = COALESCE($4, requested_slot), detail = detail || $5::jsonb, updated_at = now()
		 WHERE appointment_id = $1 AND user_id = $2`,
		appointmentID, userID, reqStatus, requestedSlot, jsonOrEmptyObject(detail))
	return r.GetAppointment(ctx, userID, appointmentID)
}

// ══ HMO CLAIMS (submit / dispute) ═══════════════════════════════════════════

// InsertHMOClaim submits a claim idempotently (UNIQUE idempotency_key). amountKobo is
// an int64 minor-unit field carried for reporting only — NO ledger posting (claims settle
// out-of-band via the HMO, not the doctor wallet).
func (r *Repository) InsertHMOClaim(ctx context.Context, userID string, ref, patientID, appointmentID *string, amountKobo int64, detail []byte, idemKey string) (*HMOClaim, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO doctor_hmo_claims (id, user_id, ref, patient_id, appointment_id, status, amount_kobo, detail, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,'submitted',$6,$7,$8)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := r.db.Exec(ctx, q, id, userID, ref, patientID, appointmentID, amountKobo, jsonOrEmptyObject(detail), idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return r.getHMOClaimByIdem(ctx, userID, idemKey)
	}
	return r.GetHMOClaim(ctx, userID, id)
}

func (r *Repository) getHMOClaimByIdem(ctx context.Context, userID, idemKey string) (*HMOClaim, error) {
	const q = `
		SELECT id, user_id, ref, patient_id, appointment_id, status, amount_kobo, detail, created_at, updated_at
		FROM doctor_hmo_claims WHERE user_id = $1 AND idempotency_key = $2`
	c := &HMOClaim{}
	err := r.db.QueryRow(ctx, q, userID, idemKey).Scan(&c.ID, &c.UserID, &c.Ref, &c.PatientID, &c.AppointmentID,
		&c.Status, &c.AmountKobo, &c.Detail, &c.CreatedAt, &c.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return c, err
}

// DisputeHMOClaim transitions a claim to 'disputed' (scoped, status-set → idempotent),
// recording the reason in the detail JSONB.
func (r *Repository) DisputeHMOClaim(ctx context.Context, userID, claimID string, detail []byte) (*HMOClaim, error) {
	const q = `
		UPDATE doctor_hmo_claims
		SET status = 'disputed', detail = detail || $3::jsonb, updated_at = now()
		WHERE id = $1 AND user_id = $2`
	tag, err := r.db.Exec(ctx, q, claimID, userID, jsonOrEmptyObject(detail))
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.GetHMOClaim(ctx, userID, claimID)
}

// ══ MULTI-CLINIC PORTFOLIO (doctor_profiles) ════════════════════════════════

// GetClinicPortfolio returns the doctor's clinic memberships (profile_draft->'clinics')
// and the active clinic id. There is no clinics table — they live in the profile builder.
func (r *Repository) GetClinicPortfolio(ctx context.Context, userID string) (*ClinicPortfolio, error) {
	const q = `
		SELECT active_clinic_id::text, COALESCE(profile_draft->'clinics', '[]'::jsonb)
		FROM doctor_profiles WHERE user_id = $1`
	p := &ClinicPortfolio{}
	err := r.db.QueryRow(ctx, q, userID).Scan(&p.ActiveClinicID, &p.Memberships)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

// SetActiveClinic updates active_clinic_id (scoped). Idempotent overwrite.
func (r *Repository) SetActiveClinic(ctx context.Context, userID, clinicID string) (*ClinicPortfolio, error) {
	const q = `UPDATE doctor_profiles SET active_clinic_id = $2::uuid, updated_at = now() WHERE user_id = $1`
	tag, err := r.db.Exec(ctx, q, userID, clinicID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.GetClinicPortfolio(ctx, userID)
}

// UpdateClinicSchedule patch-merges a clinic's schedule into the clinics array entry
// stored in profile_draft. The whole clinics object is jsonb-merged under a per-clinic key
// so callers can patch freely (mirrors SaveProfileDraft). Idempotent merge.
func (r *Repository) UpdateClinicSchedule(ctx context.Context, userID, clinicID string, schedule []byte) (*ClinicPortfolio, error) {
	// Store the patch under profile_draft->'clinicSchedules'->clinicID so the
	// additive jsonb-merge never clobbers sibling clinics (no DROP, no narrowing).
	const q = `
		UPDATE doctor_profiles
		SET profile_draft = jsonb_set(
		        profile_draft,
		        ARRAY['clinicSchedules', $2],
		        $3::jsonb,
		        true),
		    updated_at = now()
		WHERE user_id = $1`
	tag, err := r.db.Exec(ctx, q, userID, clinicID, jsonOrEmptyObject(schedule))
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.GetClinicPortfolio(ctx, userID)
}
