package owner

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/go-common/ginutil"
)

// ---- reviews ----

// ListReviews — GET /vets/:id/reviews. Visible reviews of a vet, newest first. The
// reviewer is shown as "Pet owner": a review never carries the owner's identity.
func (h *Handler) ListReviews(c *gin.Context) {
	if _, ok := caller(c); !ok {
		return
	}
	vetID, ok := pathUUID(c, "vet id")
	if !ok {
		return
	}
	rows, err := h.db.Query(c.Request.Context(), `
		SELECT id::text, rating, body, created_at FROM vet_reviews
		WHERE provider_id = $1::uuid AND NOT is_hidden
		ORDER BY created_at DESC LIMIT 100`, vetID)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	out := []wireReview{}
	for rows.Next() {
		var r wireReview
		var rating int16
		var at time.Time
		if err := rows.Scan(&r.ID, &rating, &r.Body, &at); err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		r.Rating, r.Author, r.At = int(rating), "Pet owner", rfc(at)
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, out)
}

// SubmitReview — POST /reviews {appointmentId, vetId, rating, body}. One review per
// completed appointment, by the pet owner who had it; a replay returns the first.
func (h *Handler) SubmitReview(c *gin.Context) {
	uid, ok := caller(c)
	if !ok {
		return
	}
	var req struct {
		AppointmentID string `json:"appointmentId"`
		VetID         string `json:"vetId"`
		Rating        int    `json:"rating"`
		Body          string `json:"body"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	if _, err := uuid.Parse(req.AppointmentID); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "appointmentId must be a uuid")
		return
	}
	if _, err := uuid.Parse(req.VetID); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "vetId must be a uuid")
		return
	}
	req.Body = strings.TrimSpace(req.Body)
	if req.Rating < 1 || req.Rating > 5 {
		ginutil.FailOK(c, http.StatusBadRequest, "rating must be between 1 and 5")
		return
	}
	if len([]rune(req.Body)) > 1000 {
		ginutil.FailOK(c, http.StatusBadRequest, "review is too long")
		return
	}
	ctx := c.Request.Context()
	var state string
	err := h.db.QueryRow(ctx, `
		SELECT state FROM health_appointments
		WHERE id = $1::uuid AND patient_id = $2::uuid AND provider_id = $3::uuid AND subject_type = 'PET'`,
		req.AppointmentID, uid, req.VetID).Scan(&state)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(c, http.StatusNotFound, "appointment not found")
		return
	}
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	if state != "COMPLETED" {
		fail(c, http.StatusConflict, "you can review a vet once the appointment is completed")
		return
	}
	var id string
	var at time.Time
	var rating int16
	var body string
	err = h.db.QueryRow(ctx, `
		WITH ins AS (
		  INSERT INTO vet_reviews (appointment_id, provider_id, owner_id, rating, body)
		  VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)
		  ON CONFLICT (appointment_id) DO NOTHING
		  RETURNING id, rating, body, created_at)
		SELECT id::text, rating, body, created_at FROM ins
		UNION ALL
		SELECT id::text, rating, body, created_at FROM vet_reviews
		WHERE appointment_id = $1::uuid AND owner_id = $3::uuid
		LIMIT 1`, req.AppointmentID, req.VetID, uid, int16(req.Rating), req.Body).Scan(&id, &rating, &body, &at)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusCreated, wireReview{ID: id, Author: "You", Rating: int(rating), Body: body, At: rfc(at)})
}

// ---- consult room ----

type consultRow struct {
	ApptID, ProviderID, PatientID, VetOwnerID, PetID string
	ApptState                                        string
	SlotStart                                        time.Time
	PetName, VetName                                 string
	ConsultID, ConsultState                          *string
}

// loadConsult resolves :id as either the consult id or the appointment id (the app
// opens the lobby by appointment before the vet has started the consult) and checks
// the caller is the pet owner or the vet's owner.
func (h *Handler) loadConsult(ctx context.Context, uid, id string) (*consultRow, error) {
	var r consultRow
	err := h.db.QueryRow(ctx, `
		SELECT ap.id::text, ap.provider_id::text, ap.patient_id::text, hp.owner_user_id::text, vp.pet_id::text,
		       ap.state, ap.slot_start, p.name, hp.display_name, vp.consult_id::text, c.state
		FROM health_appointments ap
		JOIN vet_appointment_payments vp ON vp.appointment_id = ap.id
		JOIN pets p ON p.id = vp.pet_id
		JOIN health_providers hp ON hp.id = ap.provider_id
		LEFT JOIN health_consults c ON c.id = vp.consult_id
		WHERE (ap.id = $1::uuid OR vp.consult_id = $1::uuid)
		  AND (ap.patient_id = $2::uuid OR hp.owner_user_id = $2::uuid)
		LIMIT 1`, id, uid).Scan(&r.ApptID, &r.ProviderID, &r.PatientID, &r.VetOwnerID, &r.PetID,
		&r.ApptState, &r.SlotStart, &r.PetName, &r.VetName, &r.ConsultID, &r.ConsultState)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errApptNotFound
	}
	return &r, err
}

func (h *Handler) consultMessages(ctx context.Context, uid string, r *consultRow) ([]wireConsultMessage, error) {
	rows, err := h.db.Query(ctx, `
		SELECT id::text, author_user_id::text, from_provider, body, created_at
		FROM vet_consult_messages WHERE appointment_id = $1::uuid
		ORDER BY created_at ASC LIMIT 500`, r.ApptID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []wireConsultMessage{}
	for rows.Next() {
		var m wireConsultMessage
		var author string
		var at time.Time
		if err := rows.Scan(&m.ID, &author, &m.FromProvider, &m.Body, &at); err != nil {
			return nil, err
		}
		m.SentAt = rfc(at)
		switch {
		case m.FromProvider:
			m.AuthorName = r.VetName
		case author == uid:
			m.AuthorName = "You"
		default:
			m.AuthorName = "Pet owner"
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func toWireConsult(r *consultRow, msgs []wireConsultMessage) wireConsult {
	id := r.ApptID
	if r.ConsultID != nil {
		id = *r.ConsultID
	}
	state := ""
	switch {
	case r.ConsultState != nil:
		state = *r.ConsultState
	case r.ApptState == "IN_PROGRESS":
		state = "IN_PROGRESS"
	case r.ApptState == "COMPLETED":
		state = "COMPLETED"
	}
	status := consultStatus(state)
	return wireConsult{
		ID: id, AppointmentID: r.ApptID, VetID: r.ProviderID, VetName: r.VetName, PetID: r.PetID, PetName: r.PetName,
		Mode: "video", Status: status, ScheduledAt: rfc(r.SlotStart), ProviderReady: status == "in_progress",
		Messages: msgs,
	}
}

// GetConsult — GET /consults/:id.
func (h *Handler) GetConsult(c *gin.Context) {
	uid, ok := caller(c)
	if !ok {
		return
	}
	id, ok := pathUUID(c, "consult id")
	if !ok {
		return
	}
	r, err := h.loadConsult(c.Request.Context(), uid, id)
	if err != nil {
		h.apptErr(c, err)
		return
	}
	msgs, err := h.consultMessages(c.Request.Context(), uid, r)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, toWireConsult(r, msgs))
}

// SendConsultMessage — POST /consults/:id/messages {body}. Either party of a live
// appointment (not cancelled, completed or a no-show) may post.
func (h *Handler) SendConsultMessage(c *gin.Context) {
	uid, ok := caller(c)
	if !ok {
		return
	}
	id, ok := pathUUID(c, "consult id")
	if !ok {
		return
	}
	var req struct {
		Body string `json:"body"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	req.Body = strings.TrimSpace(req.Body)
	if req.Body == "" || len([]rune(req.Body)) > 2000 {
		ginutil.FailOK(c, http.StatusBadRequest, "message must be 1 to 2000 characters")
		return
	}
	ctx := c.Request.Context()
	r, err := h.loadConsult(ctx, uid, id)
	if err != nil {
		h.apptErr(c, err)
		return
	}
	switch r.ApptState {
	case "CANCELLED", "COMPLETED", "NO_SHOW":
		fail(c, http.StatusConflict, "this consultation is closed")
		return
	}
	fromProvider := uid == r.VetOwnerID && uid != r.PatientID
	var mid string
	var at time.Time
	if err := h.db.QueryRow(ctx, `
		INSERT INTO vet_consult_messages (appointment_id, author_user_id, from_provider, body)
		VALUES ($1::uuid, $2::uuid, $3, $4) RETURNING id::text, created_at`,
		r.ApptID, uid, fromProvider, req.Body).Scan(&mid, &at); err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	name := "You"
	if fromProvider {
		name = r.VetName
	}
	c.JSON(http.StatusCreated, wireConsultMessage{ID: mid, AuthorName: name, FromProvider: fromProvider, Body: req.Body, SentAt: rfc(at)})
}

// GetSummary — GET /summaries/:id. :id is the consult id of a COMPLETED consult.
func (h *Handler) GetSummary(c *gin.Context) {
	uid, ok := caller(c)
	if !ok {
		return
	}
	id, ok := pathUUID(c, "summary id")
	if !ok {
		return
	}
	var s wireSummary
	var completed *time.Time
	var diagnosis, followNote string
	err := h.db.QueryRow(c.Request.Context(), `
		SELECT c.id::text, ap.id::text, vp.pet_id::text, p.name, ap.provider_id::text, hp.display_name, c.completed_at,
		       COALESCE(n.subjective,''), COALESCE(n.objective,''), COALESCE(n.assessment,''), COALESCE(n.plan,''),
		       COALESCE(x.diagnosis,''), COALESCE(x.follow_up_recommended,false), COALESCE(x.follow_up_note,''),
		       (SELECT r.id::text FROM health_prescriptions r WHERE r.consult_id = c.id ORDER BY r.created_at DESC LIMIT 1),
		       COALESCE((SELECT l.id::text FROM vet_lab_orders l WHERE l.appointment_id = ap.id ORDER BY l.created_at DESC LIMIT 1),
		        (SELECT l.id::text FROM vet_lab_referrals l WHERE l.appointment_id = ap.id ORDER BY l.created_at DESC LIMIT 1))
		FROM health_consults c
		JOIN vet_appointment_payments vp ON vp.consult_id = c.id
		JOIN health_appointments ap ON ap.id = vp.appointment_id
		JOIN pets p ON p.id = vp.pet_id
		JOIN health_providers hp ON hp.id = ap.provider_id
		LEFT JOIN LATERAL (SELECT * FROM health_clinical_notes WHERE consult_id = c.id ORDER BY created_at DESC LIMIT 1) n ON true
		LEFT JOIN vet_consult_summary_extras x ON x.consult_id = c.id
		WHERE c.id = $1::uuid AND c.state = 'COMPLETED'
		  AND (ap.patient_id = $2::uuid OR hp.owner_user_id = $2::uuid)`, id, uid).
		Scan(&s.ID, &s.AppointmentID, &s.PetID, &s.PetName, &s.VetID, &s.VetName, &completed,
			&s.Soap.Subjective, &s.Soap.Objective, &s.Soap.Assessment, &s.Soap.Plan,
			&diagnosis, &s.FollowUpRecommended, &followNote, &s.PrescriptionID, &s.LabOrderID)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(c, http.StatusNotFound, "summary not found")
		return
	}
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	if completed != nil {
		s.CompletedAt = rfc(*completed)
	}
	s.Diagnosis = diagnosis
	if s.Diagnosis == "" {
		s.Diagnosis = s.Soap.Assessment
	}
	s.FollowUpNote = strPtr(followNote)
	c.JSON(http.StatusOK, s)
}
