package provider

import (
	"errors"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	healthvet "spotlight/backend/internal/health/vet"
)

// ListAppointments — GET /provider/appointments → ProviderAppointmentRow[].
// Only the caller's own appointments; the owner is shown as "First L.".
func (h *Handler) ListAppointments(c *gin.Context) {
	_, p, ok := h.requireVet(c, true)
	if !ok {
		return
	}
	const q = `
		SELECT a.id::text, COALESCE(up.full_name, ''), pt.name, pt.species, a.visit_type, a.state,
		       a.slot_start, COALESCE(d.reason, '')
		FROM health_appointments a
		JOIN vet_appointment_payments vp ON vp.appointment_id = a.id
		JOIN pets pt ON pt.id = vp.pet_id
		LEFT JOIN vet_appointment_details d ON d.appointment_id = a.id
		LEFT JOIN user_profiles up ON up.id = a.patient_id
		WHERE a.provider_id = $1 AND a.subject_type = 'PET'
		ORDER BY a.slot_start DESC
		LIMIT 200`
	rows, err := h.db.Query(c.Request.Context(), q, p.ID)
	if err != nil {
		fail(c, http.StatusInternalServerError, "could not load your appointments")
		return
	}
	defer rows.Close()
	out := make([]wireApptRow, 0)
	for rows.Next() {
		var r wireApptRow
		var owner, species, visit string
		var start time.Time
		if err := rows.Scan(&r.AppointmentID, &owner, &r.PetName, &species, &visit, &r.Status, &start, &r.Reason); err != nil {
			fail(c, http.StatusInternalServerError, "could not read your appointments")
			return
		}
		r.OwnerName = shortName(owner, "Pet owner")
		r.Species = speciesToWire(species)
		r.Type = strings.ToLower(visit)
		r.ScheduledFor = rfc3339(start)
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		fail(c, http.StatusInternalServerError, "could not read your appointments")
		return
	}
	c.JSON(http.StatusOK, out)
}

type decisionBody struct {
	Decision     string `json:"decision"`
	ScheduledFor string `json:"scheduledFor"`
}

// Decide — POST /provider/appointments/:id/decision {decision, scheduledFor?}
//
//	accept     REQUESTED → ACCEPTED → CONFIRMED (the owner already chose this slot
//	           and paid into escrow, so accepting is also the vet's confirmation;
//	           nothing else in the app confirms, and a consult can only start from
//	           CONFIRMED)
//	decline    → CANCELLED and the held payment is refunded (HL-9)
//	reschedule → moves the slot to scheduledFor, ending CONFIRMED
func (h *Handler) Decide(c *gin.Context) {
	uid, p, ok := h.requireVet(c, true)
	if !ok {
		return
	}
	apptID, ok := pathID(c, "id")
	if !ok {
		return
	}
	var body decisionBody
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	body.Decision = strings.ToLower(strings.TrimSpace(body.Decision))
	switch body.Decision {
	case "accept", "decline", "reschedule":
	default:
		fail(c, http.StatusBadRequest, "decision must be accept, decline or reschedule")
		return
	}
	if h.vet == nil {
		fail(c, http.StatusServiceUnavailable, "vet service unavailable")
		return
	}

	ctx := c.Request.Context()
	a, err := h.ownAppointment(ctx, p.ID, apptID)
	if err != nil {
		h.apptErr(c, err)
		return
	}

	switch body.Decision {
	case "accept":
		state, err := h.advanceToConfirmed(c, uid, a)
		if err != nil {
			h.actionErr(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "status": state})

	case "decline":
		switch a.State {
		case "REQUESTED", "ACCEPTED", "CONFIRMED", "RESCHEDULED":
		default:
			fail(c, http.StatusConflict, fmt.Sprintf("an appointment that is %s cannot be declined", strings.ToLower(a.State)))
			return
		}
		if _, err := h.vet.Cancel(ctx, uid, a.ID, "Declined by vet"); err != nil {
			h.actionErr(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "status": "CANCELLED"})

	case "reschedule":
		when, err := time.Parse(time.RFC3339, strings.TrimSpace(body.ScheduledFor))
		if err != nil {
			fail(c, http.StatusBadRequest, "scheduledFor must be an RFC3339 time")
			return
		}
		if !when.After(time.Now()) {
			fail(c, http.StatusBadRequest, "scheduledFor must be in the future")
			return
		}
		end := when.Add(a.SlotEnd.Sub(a.SlotStart))
		clash, err := h.overlaps(c, p.ID, a.ID, when, end)
		if err != nil {
			fail(c, http.StatusInternalServerError, "could not check your calendar")
			return
		}
		if clash {
			fail(c, http.StatusConflict, "that time overlaps another booking")
			return
		}
		if a.State == "RESCHEDULED" {
			if _, err := h.sched.Transition(ctx, uid, a.ID, "CONFIRMED"); err != nil {
				h.actionErr(c, err)
				return
			}
			a.State = "CONFIRMED"
		} else if _, err := h.advanceToConfirmed(c, uid, a); err != nil {
			h.actionErr(c, err)
			return
		}
		moved, err := h.sched.Reschedule(ctx, uid, a.ID, when, end)
		if err != nil {
			h.actionErr(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "status": string(moved.State)})
	}
}

// advanceToConfirmed walks REQUESTED/ACCEPTED forward to CONFIRMED through the
// shared state machine and returns the resulting state. CONFIRMED is a no-op so a
// retried tap is harmless.
func (h *Handler) advanceToConfirmed(c *gin.Context, uid string, a *apptRef) (string, error) {
	ctx := c.Request.Context()
	switch a.State {
	case "REQUESTED":
		if _, err := h.vet.Accept(ctx, uid, a.ID); err != nil {
			return "", err
		}
		fallthrough
	case "ACCEPTED":
		if _, err := h.vet.Confirm(ctx, uid, a.ID); err != nil {
			return "", err
		}
		a.State = "CONFIRMED"
		return "CONFIRMED", nil
	case "CONFIRMED":
		return "CONFIRMED", nil
	}
	return "", fmt.Errorf("an appointment that is %s cannot be accepted", strings.ToLower(a.State))
}

func (h *Handler) overlaps(c *gin.Context, providerID, selfID string, start, end time.Time) (bool, error) {
	var n int
	const q = `
		SELECT count(*) FROM health_appointments
		WHERE provider_id = $1 AND id <> $2
		  AND state IN ('REQUESTED','ACCEPTED','CONFIRMED','IN_PROGRESS','RESCHEDULED')
		  AND slot_start < $4 AND slot_end > $3`
	if err := h.db.QueryRow(c.Request.Context(), q, providerID, selfID, start, end).Scan(&n); err != nil {
		return false, err
	}
	return n > 0, nil
}

func (h *Handler) apptErr(c *gin.Context, err error) {
	if errors.Is(err, errNotFound) {
		fail(c, http.StatusNotFound, "appointment not found")
		return
	}
	fail(c, http.StatusInternalServerError, "could not load the appointment")
}

// actionErr maps a shared-engine refusal to a client error. The service returns
// the uniform not-found for a foreign actor; every other refusal is a domain
// conflict (wrong state, slot taken, payout gate) and 409 carries its message.
func (h *Handler) actionErr(c *gin.Context, err error) {
	if errors.Is(err, healthvet.ErrAppointmentNotFound) {
		fail(c, http.StatusNotFound, "appointment not found")
		return
	}
	fail(c, http.StatusConflict, err.Error())
}

// Nav — GET /provider/appointments/:id/nav → ProviderHomeNav. A home visit's
// destination, the owner's contact number and a straight-line distance/ETA. The
// phone is only released for the vet's own HOME appointment that is still live.
func (h *Handler) Nav(c *gin.Context) {
	_, p, ok := h.requireVet(c, true)
	if !ok {
		return
	}
	apptID, ok := pathID(c, "id")
	if !ok {
		return
	}
	a, err := h.ownAppointment(c.Request.Context(), p.ID, apptID)
	if err != nil {
		h.apptErr(c, err)
		return
	}
	if a.VisitType != "HOME" {
		fail(c, http.StatusConflict, "navigation only applies to home visits")
		return
	}
	switch a.State {
	case "ACCEPTED", "CONFIRMED", "IN_PROGRESS", "RESCHEDULED":
	default:
		fail(c, http.StatusConflict, "this home visit is not active")
		return
	}

	var (
		owner, phone, petName, location string
		destLat, destLng                *float64
		vetLat, vetLng                  *float64
	)
	const q = `
		SELECT COALESCE(up.full_name, ''), COALESCE(up.phone, ''), pt.name, COALESCE(d.location, ''),
		       vp.dest_lat, vp.dest_lng, ST_Y(hp.geo::geometry), ST_X(hp.geo::geometry)
		FROM vet_appointment_payments vp
		JOIN pets pt ON pt.id = vp.pet_id
		JOIN health_providers hp ON hp.id = vp.provider_id
		LEFT JOIN vet_appointment_details d ON d.appointment_id = vp.appointment_id
		LEFT JOIN user_profiles up ON up.id = vp.owner_id
		WHERE vp.appointment_id = $1`
	if err := h.db.QueryRow(c.Request.Context(), q, a.ID).Scan(
		&owner, &phone, &petName, &location, &destLat, &destLng, &vetLat, &vetLng); err != nil {
		fail(c, http.StatusInternalServerError, "could not load the visit")
		return
	}
	out := wireNav{
		AppointmentID: a.ID, OwnerName: shortName(owner, "Pet owner"), PetName: petName,
		Address: location, Phone: phone,
	}
	if destLat != nil && destLng != nil {
		out.DestLat, out.DestLng = *destLat, *destLng
	}
	if vetLat != nil && vetLng != nil {
		out.VetLat, out.VetLng = *vetLat, *vetLng
	}
	if destLat != nil && destLng != nil && vetLat != nil && vetLng != nil {
		km := haversineKm(*vetLat, *vetLng, *destLat, *destLng)
		out.DistanceLabel = fmt.Sprintf("%.1f km", km)
		out.EtaLabel = etaLabel(km)
	}
	c.JSON(http.StatusOK, out)
}

const avgCityKmh = 30.0

// etaLabel is a straight-line estimate at city speed, rounded up to whole minutes.
func etaLabel(km float64) string {
	mins := int(math.Ceil(km / avgCityKmh * 60))
	if mins < 1 {
		mins = 1
	}
	return fmt.Sprintf("%d min", mins)
}

func haversineKm(lat1, lng1, lat2, lng2 float64) float64 {
	const r = 6371.0
	rad := func(d float64) float64 { return d * math.Pi / 180 }
	dLat, dLng := rad(lat2-lat1), rad(lng2-lng1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(rad(lat1))*math.Cos(rad(lat2))*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * r * math.Asin(math.Sqrt(a))
}
