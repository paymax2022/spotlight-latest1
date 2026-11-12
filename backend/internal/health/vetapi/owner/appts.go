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
	"spotlight/backend/internal/escrow"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/health/consultengine"
	healthvet "spotlight/backend/internal/health/vet"
)

// slotLength is the length of every bookable slot (matches healthvet's availability).
const slotLength = 30 * time.Minute

type apptRow struct {
	ID, ProviderID, PatientID, Visit, State string
	SlotStart, CreatedAt                    time.Time
	PetID                                   string
	Total                                   int64
	PayState                                string
	ConsultID                               *string
	PetName, VetName, Reason, Location      string
	ConsultState                            *string
	RxID                                    *string
}

// apptSelect joins the scheduling row, the vet payment leg, the pet, the vet and the
// booking details. $1 = the caller, $2 = an optional appointment id, $3 = whether the
// vet's owner may also read (single-appointment reads only; lists are owner-scoped).
const apptSelect = `
	SELECT ap.id::text, ap.provider_id::text, ap.patient_id::text, ap.visit_type, ap.state,
	       ap.slot_start, ap.created_at,
	       vp.pet_id::text, vp.total_kobo, vp.pay_state, vp.consult_id::text,
	       p.name, hp.display_name, COALESCE(d.reason,''), COALESCE(d.location,''),
	       c.state,
	       (SELECT rx.id::text FROM health_prescriptions rx WHERE rx.consult_id = vp.consult_id
	         ORDER BY rx.created_at DESC LIMIT 1)
	FROM health_appointments ap
	JOIN vet_appointment_payments vp ON vp.appointment_id = ap.id
	JOIN pets p ON p.id = vp.pet_id
	JOIN health_providers hp ON hp.id = ap.provider_id
	LEFT JOIN vet_appointment_details d ON d.appointment_id = ap.id
	LEFT JOIN health_consults c ON c.id = vp.consult_id
	WHERE ($2::uuid IS NULL OR ap.id = $2::uuid)
	  AND (ap.patient_id = $1::uuid OR ($3::bool AND hp.owner_user_id = $1::uuid))
	ORDER BY ap.created_at DESC
	LIMIT 200`

func (h *Handler) loadAppointments(ctx context.Context, uid, apptID string, vetMayRead bool) ([]wireAppointment, error) {
	rows, err := h.db.Query(ctx, apptSelect, uid, nullable(apptID), vetMayRead)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []wireAppointment{}
	for rows.Next() {
		var r apptRow
		if err := rows.Scan(&r.ID, &r.ProviderID, &r.PatientID, &r.Visit, &r.State, &r.SlotStart, &r.CreatedAt,
			&r.PetID, &r.Total, &r.PayState, &r.ConsultID, &r.PetName, &r.VetName, &r.Reason, &r.Location,
			&r.ConsultState, &r.RxID); err != nil {
			return nil, err
		}
		out = append(out, toWireAppointment(r))
	}
	return out, rows.Err()
}

func toWireAppointment(r apptRow) wireAppointment {
	fee, home := feeSplit(r.Visit, r.Total)
	a := wireAppointment{
		ID: r.ID, PetID: r.PetID, PetName: r.PetName, VetID: r.ProviderID, VetName: r.VetName,
		Type: visitWire(r.Visit), Status: r.State, ScheduledFor: rfc(r.SlotStart), Reason: r.Reason,
		FeeKobo: fee, HomeVisitFeeKobo: home, TotalKobo: r.Total, PaymentHeld: r.PayState == "HELD",
		CreatedAt: rfc(r.CreatedAt), Location: strPtr(r.Location), ConsultID: r.ConsultID, PrescriptionID: r.RxID,
	}
	if r.ConsultID != nil && r.ConsultState != nil && *r.ConsultState == "COMPLETED" {
		a.SummaryID = r.ConsultID
	}
	return a
}

// ListAppointments — GET /appointments (the caller's own, newest first).
func (h *Handler) ListAppointments(c *gin.Context) {
	uid, ok := caller(c)
	if !ok {
		return
	}
	out, err := h.loadAppointments(c.Request.Context(), uid, "", false)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "appointments": out})
}

// GetAppointment — GET /appointments/:id. The pet owner or the vet's owner may read;
// anyone else gets the same 404 a missing appointment returns.
func (h *Handler) GetAppointment(c *gin.Context) {
	uid, ok := caller(c)
	if !ok {
		return
	}
	id, ok := pathUUID(c, "appointment id")
	if !ok {
		return
	}
	a, err := h.oneAppointment(c.Request.Context(), uid, id)
	if err != nil {
		h.apptErr(c, err)
		return
	}
	c.JSON(http.StatusOK, a)
}

var errApptNotFound = errors.New("appointment not found")

func (h *Handler) oneAppointment(ctx context.Context, uid, id string) (*wireAppointment, error) {
	rows, err := h.loadAppointments(ctx, uid, id, true)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, errApptNotFound
	}
	return &rows[0], nil
}

func (h *Handler) apptErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, errApptNotFound), errors.Is(err, healthvet.ErrAppointmentNotFound):
		fail(c, http.StatusNotFound, "appointment not found")
	default:
		fail(c, http.StatusInternalServerError, err.Error())
	}
}

// bookRequest is the app's CreateAppointmentInput. The fee fields are accepted but
// IGNORED: the price is always the vet's own service price, read server-side.
type bookRequest struct {
	PetID            string   `json:"petId"`
	VetID            string   `json:"vetId"`
	Type             string   `json:"type"`
	ScheduledFor     string   `json:"scheduledFor"`
	Reason           string   `json:"reason"`
	Location         string   `json:"location"`
	DestLat          *float64 `json:"destLat"`
	DestLng          *float64 `json:"destLng"`
	IntakeResponseID *string  `json:"intakeResponseId"`
	IdempotencyKey   string   `json:"idempotencyKey"`
	// Tele-consult pricing. packageId selects one of the vet's published timed
	// packages; consultMode is the requested mode for a legacy (service-priced)
	// tele booking; expectedTotalKobo is the total the app showed the owner.
	PackageID         string `json:"packageId"`
	ConsultMode       string `json:"consultMode"`
	ExpectedTotalKobo int64  `json:"expectedTotalKobo"`
}

// validateBook checks the request and returns the parsed slot start and visit type.
func validateBook(r *bookRequest) (time.Time, string, string) {
	if _, err := uuid.Parse(r.PetID); err != nil {
		return time.Time{}, "", "petId must be a uuid"
	}
	if _, err := uuid.Parse(r.VetID); err != nil {
		return time.Time{}, "", "vetId must be a uuid"
	}
	visit, ok := wireToVisit[strings.ToLower(r.Type)]
	if !ok {
		return time.Time{}, "", "type must be tele, home or clinic"
	}
	start, err := time.Parse(time.RFC3339, r.ScheduledFor)
	if err != nil {
		return time.Time{}, "", "scheduledFor must be an RFC3339 time"
	}
	r.Reason = strings.TrimSpace(r.Reason)
	r.Location = strings.TrimSpace(r.Location)
	if len([]rune(r.Reason)) > 1000 {
		return time.Time{}, "", "reason is too long"
	}
	if visit == "HOME" && r.Location == "" {
		return time.Time{}, "", "a home visit needs an address"
	}
	if (r.DestLat == nil) != (r.DestLng == nil) {
		return time.Time{}, "", "destLat and destLng must be given together"
	}
	if r.DestLat != nil && (*r.DestLat < -90 || *r.DestLat > 90 || *r.DestLng < -180 || *r.DestLng > 180) {
		return time.Time{}, "", "destLat/destLng out of range"
	}
	if r.IntakeResponseID != nil && *r.IntakeResponseID != "" {
		if _, err := uuid.Parse(*r.IntakeResponseID); err != nil {
			return time.Time{}, "", "intakeResponseId must be a uuid"
		}
	}
	return start, visit, ""
}

// slotIsOpen reports whether start is an open slot of the given visit type in the
// vet's computed availability (weekly hours minus existing bookings).
func (h *Handler) slotIsOpen(ctx context.Context, vetID string, start time.Time, visit string) (bool, error) {
	days, err := h.svc.VetAvailability(ctx, vetID, healthvet.AvailabilityDaysMax, h.now())
	if err != nil {
		return false, err
	}
	for _, d := range days {
		for _, s := range d.Slots {
			t, perr := time.Parse(time.RFC3339, s.Start)
			if perr != nil || !t.Equal(start) {
				continue
			}
			if s.Available && strings.EqualFold(s.Type, visitWire(visit)) {
				return true, nil
			}
		}
	}
	return false, nil
}

// BookAppointment — POST /appointments (app shape). Payment is HELD by healthvet.Book
// (escrow), priced from the vet's active service for the visit type.
func (h *Handler) BookAppointment(c *gin.Context) {
	uid, ok := caller(c)
	if !ok {
		return
	}
	var req bookRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	start, visit, msg := validateBook(&req)
	if msg != "" {
		ginutil.FailOK(c, http.StatusBadRequest, msg)
		return
	}
	idem := ginutil.IdempotencyKey(c)
	if idem == "" {
		idem = strings.TrimSpace(req.IdempotencyKey)
	}
	if idem == "" {
		ginutil.FailOK(c, http.StatusBadRequest, "Idempotency-Key required")
		return
	}
	ctx := c.Request.Context()

	var serviceID string
	if strings.TrimSpace(req.PackageID) == "" {
		err := h.db.QueryRow(ctx, `
			SELECT id::text FROM vet_services
			WHERE provider_id = $1::uuid AND visit_type = $2 AND active
			ORDER BY price_kobo ASC, created_at ASC LIMIT 1`, req.VetID, visit).Scan(&serviceID)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			// A tele vet may sell timed packages instead of a visit service.
			// Leave the id empty and let healthvet.Book distinguish
			// ErrPackageRequired from "this vet does not offer TELE".
			if visit != "TELE" {
				fail(c, http.StatusUnprocessableEntity, "this vet does not offer "+visitWire(visit)+" visits")
				return
			}
		case err != nil:
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
	}

	if open, aerr := h.slotIsOpen(ctx, req.VetID, start, visit); aerr != nil {
		if errors.Is(aerr, healthvet.ErrVetNotFound) {
			fail(c, http.StatusNotFound, "vet not found")
			return
		}
		fail(c, http.StatusInternalServerError, aerr.Error())
		return
	} else if !open {
		fail(c, http.StatusUnprocessableEntity, "that time is no longer available")
		return
	}

	a, err := h.svc.Book(ctx, uid, healthvet.BookInput{
		ProviderID: req.VetID, PetID: req.PetID, ServiceID: serviceID,
		PackageID: req.PackageID, ConsultMode: req.ConsultMode,
		ExpectedTotalKobo: req.ExpectedTotalKobo,
		VisitType:         healthvet.VisitType(visit), SlotStart: start, SlotEnd: start.Add(slotLength),
		IdempotencyKey: idem,
	})
	if err != nil {
		switch {
		case errors.Is(err, tiers.ErrWalletDisabled), errors.Is(err, tiers.ErrDailyLimitExceeded):
			fail(c, http.StatusForbidden, err.Error())
		case errors.Is(err, escrow.ErrTierGateUnwired):
			fail(c, http.StatusServiceUnavailable, err.Error())
		case errors.Is(err, healthvet.ErrPackageRequired), errors.Is(err, healthvet.ErrPackageInvalid),
			errors.Is(err, healthvet.ErrConsultModeInvalid), errors.Is(err, healthvet.ErrQuoteMismatch):
			fail(c, http.StatusUnprocessableEntity, err.Error())
		default:
			fail(c, http.StatusUnprocessableEntity, err.Error())
		}
		return
	}

	// The booking is committed (hold + appointment). The reason/address are the
	// owner's own words for the vet; a failure to store them must not fail the booking.
	_, _ = h.db.Exec(ctx, `
		INSERT INTO vet_appointment_details (appointment_id, owner_id, reason, location, intake_response_id)
		VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid)
		ON CONFLICT (appointment_id) DO NOTHING`,
		a.ID, uid, req.Reason, req.Location, nullableStr(req.IntakeResponseID))
	if visit == "HOME" && req.DestLat != nil && req.DestLng != nil {
		_, _ = h.db.Exec(ctx, `
			UPDATE vet_appointment_payments SET dest_lat = $2, dest_lng = $3
			WHERE appointment_id = $1::uuid`, a.ID, *req.DestLat, *req.DestLng)
	}

	out, err := h.oneAppointment(ctx, uid, a.ID)
	if err != nil {
		h.apptErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, out)
}

func nullableStr(p *string) any {
	if p == nil || *p == "" {
		return nil
	}
	return *p
}

// OpenConsultSession — POST /appointments/:id/consult-session. Either the pet
// owner or the vet's owner may open the room; a stranger gets the same 404 a
// missing appointment returns, so existence is never confirmed.
func (h *Handler) OpenConsultSession(c *gin.Context) {
	uid, ok := caller(c)
	if !ok {
		return
	}
	id, ok := pathUUID(c, "appointment id")
	if !ok {
		return
	}
	sess, err := h.svc.OpenConsultSession(c.Request.Context(), uid, id)
	if err != nil {
		switch {
		case errors.Is(err, healthvet.ErrAppointmentNotFound):
			fail(c, http.StatusNotFound, "appointment not found")
		case errors.Is(err, healthvet.ErrConsultNotOpenable):
			fail(c, http.StatusConflict, err.Error())
		case errors.Is(err, healthvet.ErrConsultUnavailable),
			errors.Is(err, consultengine.ErrMediaUnavailable),
			errors.Is(err, consultengine.ErrEscrowUnavailable):
			fail(c, http.StatusServiceUnavailable, err.Error())
		case errors.Is(err, consultengine.ErrInvalid), errors.Is(err, consultengine.ErrState):
			fail(c, http.StatusConflict, err.Error())
		default:
			fail(c, http.StatusInternalServerError, err.Error())
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "session": sess})
}

// CancelAppointment — POST /appointments/:id/cancel. healthvet.Cancel moves the
// appointment to CANCELLED and refunds the held payment (idempotent on the hold).
func (h *Handler) CancelAppointment(c *gin.Context) {
	uid, ok := caller(c)
	if !ok {
		return
	}
	id, ok := pathUUID(c, "appointment id")
	if !ok {
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&body)
	if _, err := h.svc.Cancel(c.Request.Context(), uid, id, strings.TrimSpace(body.Reason)); err != nil {
		if errors.Is(err, healthvet.ErrAppointmentNotFound) {
			fail(c, http.StatusNotFound, "appointment not found")
			return
		}
		fail(c, http.StatusConflict, err.Error())
		return
	}
	out, err := h.oneAppointment(c.Request.Context(), uid, id)
	if err != nil {
		h.apptErr(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// RescheduleAppointment — POST /appointments/:id/reschedule {appointmentId, scheduledFor}.
// Only the pet owner moves it, only while it is CONFIRMED (the scheduling engine's
// graph: CONFIRMED → RESCHEDULED → CONFIRMED), and only onto an open slot of the same
// visit type. The price is unchanged, so no money moves.
func (h *Handler) RescheduleAppointment(c *gin.Context) {
	uid, ok := caller(c)
	if !ok {
		return
	}
	id, ok := pathUUID(c, "appointment id")
	if !ok {
		return
	}
	var req struct {
		ScheduledFor string `json:"scheduledFor"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	start, err := time.Parse(time.RFC3339, req.ScheduledFor)
	if err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "scheduledFor must be an RFC3339 time")
		return
	}
	ctx := c.Request.Context()

	var provider, visit, state string
	err = h.db.QueryRow(ctx, `
		SELECT provider_id::text, visit_type, state FROM health_appointments
		WHERE id = $1::uuid AND patient_id = $2::uuid AND subject_type = 'PET'`, id, uid).Scan(&provider, &visit, &state)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(c, http.StatusNotFound, "appointment not found")
		return
	}
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	if state != "CONFIRMED" {
		fail(c, http.StatusConflict, "only a confirmed appointment can be rescheduled")
		return
	}
	if open, aerr := h.slotIsOpen(ctx, provider, start, visit); aerr != nil {
		fail(c, http.StatusInternalServerError, aerr.Error())
		return
	} else if !open {
		fail(c, http.StatusUnprocessableEntity, "that time is no longer available")
		return
	}
	if _, err := h.sched.Reschedule(ctx, uid, id, start, start.Add(slotLength)); err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	out, err := h.oneAppointment(ctx, uid, id)
	if err != nil {
		h.apptErr(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// HomeVisitTracking — GET /appointments/:id/tracking (owner only, HOME visits).
func (h *Handler) HomeVisitTracking(c *gin.Context) {
	uid, ok := caller(c)
	if !ok {
		return
	}
	id, ok := pathUUID(c, "appointment id")
	if !ok {
		return
	}
	var (
		vetName, state, visit, address string
		deliveryRef                    *string
		vetLat, vetLng                 *float64
	)
	err := h.db.QueryRow(c.Request.Context(), `
		SELECT hp.display_name, ap.state, ap.visit_type, COALESCE(d.location,''), vp.delivery_ref,
		       ST_Y(hp.geo::geometry), ST_X(hp.geo::geometry)
		FROM health_appointments ap
		JOIN vet_appointment_payments vp ON vp.appointment_id = ap.id
		JOIN health_providers hp ON hp.id = ap.provider_id
		LEFT JOIN vet_appointment_details d ON d.appointment_id = ap.id
		WHERE ap.id = $1::uuid AND ap.patient_id = $2::uuid`, id, uid).
		Scan(&vetName, &state, &visit, &address, &deliveryRef, &vetLat, &vetLng)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(c, http.StatusNotFound, "appointment not found")
		return
	}
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	if !strings.EqualFold(visit, "HOME") {
		fail(c, http.StatusNotFound, "this appointment is not a home visit")
		return
	}
	t := wireTracking{
		AppointmentID: id, VetName: vetName, Address: address,
		Stage: homeVisitStage(state, deliveryRef != nil && *deliveryRef != ""),
	}
	if vetLat != nil {
		t.VetLat = *vetLat
	}
	if vetLng != nil {
		t.VetLng = *vetLng
	}
	c.JSON(http.StatusOK, t)
}
