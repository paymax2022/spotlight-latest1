package telemedicine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// Admin appointment detail + cancel (with escrow refund) + reassign. Every
// mutation requires an Idempotency-Key, writes a doctor_compliance_audit row
// (action admin.telemedicine.appointment.*) and replays the stored result when
// the key repeats. The refund goes through settlement.Refund — the same path a
// patient cancellation uses — so it is a balanced reversal of the escrow legs.

const (
	AdminActionCancel   = "admin.telemedicine.appointment.cancel"
	AdminActionReassign = "admin.telemedicine.appointment.reassign"
)

var (
	ErrAdminNotFound  = errors.New("telemedicine: appointment not found")
	ErrAdminConflict  = errors.New("telemedicine: appointment state does not allow this action")
	ErrAdminIdemKey   = errors.New("telemedicine: Idempotency-Key header is required")
	ErrAdminKeyReuse  = errors.New("telemedicine: Idempotency-Key already used for a different request")
	ErrAdminBadReason = errors.New("telemedicine: reason is required (max 1000 chars)")
)

type AdminAuditEntry struct {
	Action  string         `json:"action"`
	ActorID string         `json:"actor_id"`
	At      time.Time      `json:"at"`
	Detail  map[string]any `json:"detail"`
}

type AdminAppointmentDetail struct {
	AdminAppointment
	Ref              string            `json:"ref"`
	Notes            string            `json:"notes"`
	DoctorUserID     string            `json:"doctor_user_id"`
	SettlementID     string            `json:"settlement_id"`
	SettlementStatus string            `json:"settlement_status"`
	Audit            []AdminAuditEntry `json:"audit"`
}

type AdminActionResult struct {
	Action        string    `json:"action"`
	AppointmentID string    `json:"appointment_id"`
	Status        string    `json:"status"`
	Refunded      bool      `json:"refunded"`
	DoctorID      string    `json:"doctor_id,omitempty"`
	At            time.Time `json:"at"`
	Replayed      bool      `json:"replayed"`
}

type AdminCancelRequest struct {
	Reason string `json:"reason"`
}

type AdminReassignRequest struct {
	DoctorID string `json:"doctor_id"`
	Reason   string `json:"reason"`
}

func validAdminKey(k string) bool { return len(k) >= 8 && len(k) <= 200 }

func cleanReason(r string) (string, error) {
	r = strings.TrimSpace(r)
	if r == "" || len(r) > 1000 {
		return "", ErrAdminBadReason
	}
	return r, nil
}

// GetAdminAppointment returns one appointment with its settlement state and admin audit trail.
func (s *Service) GetAdminAppointment(ctx context.Context, id string) (*AdminAppointmentDetail, error) {
	var d AdminAppointmentDetail
	err := s.db.QueryRow(ctx, `
		SELECT a.id, a.patient_id, a.doctor_id, COALESCE(d.name, ''), a.scheduled_at,
		       a.status, a.fee_kobo, COALESCE(a.platform_fee_kobo, 0),
		       COALESCE(NULLIF(a.total_kobo, 0), a.fee_kobo), a.created_at,
		       COALESCE(NULLIF(a.doctor_specialty, ''), d.specialty, ''),
		       EXISTS (SELECT 1 FROM prescriptions p WHERE p.appointment_id = a.id),
		       a.consultation_type, COALESCE(a.ref, ''), COALESCE(a.notes, ''),
		       COALESCE(d.user_id::text, ''), COALESCE(a.settlement_id::text, ''), COALESCE(st.status, '')
		FROM appointments a
		LEFT JOIN doctors d ON d.id = a.doctor_id
		LEFT JOIN settlements st ON st.id = a.settlement_id
		WHERE a.id = $1::uuid`, id).Scan(
		&d.ID, &d.PatientID, &d.DoctorID, &d.DoctorName, &d.ScheduledAt,
		&d.Status, &d.FeeKobo, &d.PlatformFeeKobo, &d.TotalKobo, &d.CreatedAt,
		&d.Specialty, &d.PrescriptionIssued, &d.ConsultationType, &d.Ref, &d.Notes,
		&d.DoctorUserID, &d.SettlementID, &d.SettlementStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrAdminNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("telemedicine: admin appointment detail: %w", err)
	}
	rows, err := s.db.Query(ctx, `
		SELECT action, COALESCE(detail->>'actor', ''), created_at, detail::text
		FROM doctor_compliance_audit
		WHERE entity_type = 'appointment' AND entity_id = $1 AND action LIKE 'admin.telemedicine.%'
		ORDER BY created_at DESC LIMIT 50`, id)
	if err != nil {
		return nil, fmt.Errorf("telemedicine: admin appointment audit: %w", err)
	}
	defer rows.Close()
	d.Audit = []AdminAuditEntry{}
	for rows.Next() {
		var e AdminAuditEntry
		var raw string
		if err := rows.Scan(&e.Action, &e.ActorID, &e.At, &raw); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(raw), &e.Detail)
		delete(e.Detail, "result")
		d.Audit = append(d.Audit, e)
	}
	return &d, rows.Err()
}

type adminQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// adminReplay returns the stored result for key, ErrAdminKeyReuse when the key
// belongs to another action/entity, or (nil, nil) when the key is new.
func adminReplay(ctx context.Context, q adminQuerier, key, action, entityID string) (*AdminActionResult, error) {
	var prevAction, prevEntity, raw string
	err := q.QueryRow(ctx, `
		SELECT action, COALESCE(entity_id, ''), COALESCE(detail->>'result', '')
		FROM doctor_compliance_audit
		WHERE idempotency_key = $1 AND action LIKE 'admin.telemedicine.%'
		ORDER BY created_at LIMIT 1`, key).Scan(&prevAction, &prevEntity, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("telemedicine: idempotency lookup: %w", err)
	}
	if prevAction != action || prevEntity != entityID {
		return nil, ErrAdminKeyReuse
	}
	var out AdminActionResult
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil, fmt.Errorf("telemedicine: decode replay: %w", err)
	}
	out.Replayed = true
	return &out, nil
}

// writeAdminAudit inserts the audit row unless one already exists for key.
func writeAdminAudit(ctx context.Context, exec func(ctx context.Context, sql string, args ...any) error,
	subjectUserID, action, entityID, key string, detail map[string]any, res AdminActionResult,
) error {
	b, _ := json.Marshal(res)
	detail["result"] = string(b)
	raw, err := json.Marshal(detail)
	if err != nil {
		return err
	}
	return exec(ctx, `
		INSERT INTO doctor_compliance_audit (user_id, action, entity_type, entity_id, detail, idempotency_key)
		SELECT $1::uuid, $2, 'appointment', $3, $4::jsonb, $5
		WHERE NOT EXISTS (SELECT 1 FROM doctor_compliance_audit WHERE idempotency_key = $5 AND action = $2)`,
		subjectUserID, action, entityID, string(raw), key)
}

// AdminCancelAppointment cancels a booked/confirmed appointment and refunds the
// patient's escrow. Safe to retry: a crash between refund and status flip is
// finished by the next call (the settlement is then already refunded).
func (s *Service) AdminCancelAppointment(ctx context.Context, adminID, id, key string, req AdminCancelRequest) (*AdminActionResult, error) {
	if !validAdminKey(key) {
		return nil, ErrAdminIdemKey
	}
	reason, err := cleanReason(req.Reason)
	if err != nil {
		return nil, err
	}
	if prev, err := adminReplay(ctx, s.db, key, AdminActionCancel, id); err != nil || prev != nil {
		return prev, err
	}
	var patientID, status, settlementID, settStatus string
	err = s.db.QueryRow(ctx, `
		SELECT a.patient_id::text, a.status, COALESCE(a.settlement_id::text, ''), COALESCE(st.status, '')
		FROM appointments a LEFT JOIN settlements st ON st.id = a.settlement_id
		WHERE a.id = $1::uuid`, id).Scan(&patientID, &status, &settlementID, &settStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrAdminNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("telemedicine: admin cancel lookup: %w", err)
	}
	switch {
	case status == string(ApptCompleted):
		return nil, fmt.Errorf("%w: completed appointments are settled to the doctor and cannot be refunded here", ErrAdminConflict)
	case settlementID == "":
		return nil, fmt.Errorf("%w: appointment has no escrow to refund", ErrAdminConflict)
	case status == string(ApptCancelled) && settStatus == "refunded":
		return nil, fmt.Errorf("%w: appointment is already cancelled and refunded", ErrAdminConflict)
	}
	refunded := false
	if settStatus == "escrowed" || settStatus == "disputed" {
		if err := s.settlement.Refund(ctx, settlementID, "admin_appointment_cancelled"); err != nil {
			// A concurrent refund of the same escrow wins the row lock; treat its
			// completed refund as ours rather than failing the retry.
			var now string
			if qerr := s.db.QueryRow(ctx, `SELECT status FROM settlements WHERE id = $1::uuid`, settlementID).Scan(&now); qerr != nil || now != "refunded" {
				return nil, fmt.Errorf("telemedicine: admin refund: %w", err)
			}
		}
		refunded = true
	} else if settStatus != "refunded" {
		return nil, fmt.Errorf("%w: escrow is %s", ErrAdminConflict, settStatus)
	} else {
		refunded = true
	}
	if _, err := s.db.Exec(ctx, `UPDATE appointments SET status = 'cancelled'
		WHERE id = $1::uuid AND status IN ('booked', 'confirmed', 'cancelled')`, id); err != nil {
		return nil, fmt.Errorf("telemedicine: admin cancel: %w", err)
	}
	res := AdminActionResult{Action: AdminActionCancel, AppointmentID: id, Status: string(ApptCancelled),
		Refunded: refunded, At: time.Now().UTC()}
	err = writeAdminAudit(ctx, func(ctx context.Context, sql string, args ...any) error {
		_, e := s.db.Exec(ctx, sql, args...)
		return e
	}, patientID, AdminActionCancel, id, key, map[string]any{
		"actor": adminID, "reason": reason, "previous_status": status, "settlement_id": settlementID,
	}, res)
	if err != nil {
		return nil, fmt.Errorf("telemedicine: admin cancel audit: %w", err)
	}
	return &res, nil
}

// AdminReassignAppointment moves a booked/confirmed appointment to another
// available doctor at the same slot. No money moves: the escrow is not bound to
// a doctor, the provider is named only when the consult is completed.
func (s *Service) AdminReassignAppointment(ctx context.Context, adminID, id, key string, req AdminReassignRequest) (*AdminActionResult, error) {
	if !validAdminKey(key) {
		return nil, ErrAdminIdemKey
	}
	reason, err := cleanReason(req.Reason)
	if err != nil {
		return nil, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, "telemed-admin-appt:"+key); err != nil {
		return nil, err
	}
	if prev, err := adminReplay(ctx, tx, key, AdminActionReassign, id); err != nil || prev != nil {
		return prev, err
	}
	var patientID, status, fromDoctor string
	var scheduledAt time.Time
	err = tx.QueryRow(ctx, `SELECT patient_id::text, status, doctor_id::text, scheduled_at
		FROM appointments WHERE id = $1::uuid FOR UPDATE`, id).Scan(&patientID, &status, &fromDoctor, &scheduledAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrAdminNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("telemedicine: admin reassign lookup: %w", err)
	}
	if status != string(ApptBooked) && status != string(ApptConfirmed) {
		return nil, fmt.Errorf("%w: only booked or confirmed appointments can be reassigned", ErrAdminConflict)
	}
	if req.DoctorID == fromDoctor {
		return nil, fmt.Errorf("%w: appointment is already with that doctor", ErrAdminConflict)
	}
	var name, specialty string
	var available bool
	err = tx.QueryRow(ctx, `SELECT name, COALESCE(specialty, ''), is_available FROM doctors WHERE id = $1::uuid`,
		req.DoctorID).Scan(&name, &specialty, &available)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: target doctor not found", ErrAdminNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("telemedicine: admin reassign doctor: %w", err)
	}
	if !available {
		return nil, fmt.Errorf("%w: target doctor is not available", ErrAdminConflict)
	}
	var taken bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM appointments
		WHERE doctor_id = $1::uuid AND scheduled_at = $2 AND status NOT IN ('cancelled', 'completed'))`,
		req.DoctorID, scheduledAt).Scan(&taken); err != nil {
		return nil, err
	}
	if taken {
		return nil, fmt.Errorf("%w: target doctor already has a booking at that time", ErrAdminConflict)
	}
	if _, err := tx.Exec(ctx, `UPDATE appointments
		SET doctor_id = $2::uuid, doctor_name = $3, doctor_specialty = $4 WHERE id = $1::uuid`,
		id, req.DoctorID, name, specialty); err != nil {
		return nil, fmt.Errorf("telemedicine: admin reassign: %w", err)
	}
	res := AdminActionResult{Action: AdminActionReassign, AppointmentID: id, Status: status,
		DoctorID: req.DoctorID, At: time.Now().UTC()}
	err = writeAdminAudit(ctx, func(ctx context.Context, sql string, args ...any) error {
		_, e := tx.Exec(ctx, sql, args...)
		return e
	}, patientID, AdminActionReassign, id, key, map[string]any{
		"actor": adminID, "reason": reason, "from_doctor_id": fromDoctor, "to_doctor_id": req.DoctorID,
	}, res)
	if err != nil {
		return nil, fmt.Errorf("telemedicine: admin reassign audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &res, nil
}

func adminActionFail(c *gin.Context, err error) {
	code := http.StatusInternalServerError
	switch {
	case errors.Is(err, ErrAdminIdemKey), errors.Is(err, ErrAdminBadReason), errors.Is(err, errBadAdminID):
		code = http.StatusBadRequest
	case errors.Is(err, ErrAdminNotFound):
		code = http.StatusNotFound
	case errors.Is(err, ErrAdminConflict):
		code = http.StatusConflict
	case errors.Is(err, ErrAdminKeyReuse):
		code = http.StatusUnprocessableEntity
	}
	msg := httperr.Msg(c, code, err)
	if code != http.StatusInternalServerError {
		msg = err.Error()
	}
	c.JSON(code, gin.H{keyError: msg})
}

var errBadAdminID = errors.New("telemedicine: id must be a uuid")

func adminUUID(v string) bool {
	if len(v) != 36 {
		return false
	}
	for i, r := range v {
		switch {
		case i == 8 || i == 13 || i == 18 || i == 23:
			if r != '-' {
				return false
			}
		case (r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F'):
		default:
			return false
		}
	}
	return true
}

// AdminGetAppointment handles GET /api/v1/telemedicine/admin/appointments/:id.
func (h *Handler) AdminGetAppointment(c *gin.Context) {
	if !adminUUID(c.Param("id")) {
		adminActionFail(c, errBadAdminID)
		return
	}
	d, err := h.svc.GetAdminAppointment(c.Request.Context(), c.Param("id"))
	if err != nil {
		adminActionFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": d})
}

// AdminCancelAppointment handles POST /api/v1/telemedicine/admin/appointments/:id/cancel.
func (h *Handler) AdminCancelAppointment(c *gin.Context) {
	if !adminUUID(c.Param("id")) {
		adminActionFail(c, errBadAdminID)
		return
	}
	var req AdminCancelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		adminActionFail(c, ErrAdminBadReason)
		return
	}
	out, err := h.svc.AdminCancelAppointment(c.Request.Context(), ginutil.UserID(c), c.Param("id"),
		strings.TrimSpace(c.GetHeader("Idempotency-Key")), req)
	if err != nil {
		adminActionFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AdminReassignAppointment handles POST /api/v1/telemedicine/admin/appointments/:id/reassign.
func (h *Handler) AdminReassignAppointment(c *gin.Context) {
	var req AdminReassignRequest
	if !adminUUID(c.Param("id")) || c.ShouldBindJSON(&req) != nil || !adminUUID(req.DoctorID) {
		adminActionFail(c, errBadAdminID)
		return
	}
	out, err := h.svc.AdminReassignAppointment(c.Request.Context(), ginutil.UserID(c), c.Param("id"),
		strings.TrimSpace(c.GetHeader("Idempotency-Key")), req)
	if err != nil {
		adminActionFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}
