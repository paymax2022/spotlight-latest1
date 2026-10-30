package owner

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	healthvet "spotlight/backend/internal/health/vet"
)

const (
	maxLabTests     = 20
	maxLabTestName  = 120
	maxLabNoteChars = 1000
)

type labRequestBody struct {
	AppointmentID string   `json:"appointmentId"`
	PetID         string   `json:"petId"`
	TestNames     []string `json:"testNames"`
	Note          string   `json:"note"`
}

// RequestLab — POST /lab-requests → {ok, labOrderId}. The pet OWNER asks for lab
// tests on their own confirmed appointment. It writes the same vet_lab_orders row
// the vet-side /provider/lab-orders does (ordered_by = the owner); the lab vertical
// still owns booking and payment, so no money moves here.
func (h *Handler) RequestLab(c *gin.Context) {
	uid, ok := caller(c)
	if !ok {
		return
	}
	var body labRequestBody
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	if _, err := uuid.Parse(body.AppointmentID); err != nil {
		fail(c, http.StatusBadRequest, "appointmentId must be a uuid")
		return
	}
	tests := make([]string, 0, len(body.TestNames))
	for _, t := range body.TestNames {
		if t = strings.TrimSpace(t); t != "" {
			if len(t) > maxLabTestName {
				fail(c, http.StatusBadRequest, "a test name is too long")
				return
			}
			tests = append(tests, t)
		}
	}
	if len(tests) == 0 || len(tests) > maxLabTests {
		fail(c, http.StatusBadRequest, "choose between 1 and 20 tests")
		return
	}
	note := strings.TrimSpace(body.Note)
	if len([]rune(note)) > maxLabNoteChars {
		fail(c, http.StatusBadRequest, "note is too long")
		return
	}

	ctx := c.Request.Context()
	var petID, providerID, state string
	err := h.db.QueryRow(ctx, `
		SELECT vp.pet_id::text, vp.provider_id::text, ap.state
		FROM vet_appointment_payments vp JOIN health_appointments ap ON ap.id = vp.appointment_id
		WHERE vp.appointment_id = $1 AND vp.owner_id = $2`, body.AppointmentID, uid).Scan(&petID, &providerID, &state)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(c, http.StatusNotFound, "appointment not found")
		return
	} else if err != nil {
		fail(c, http.StatusInternalServerError, "could not load the appointment")
		return
	}
	if body.PetID != "" && body.PetID != petID {
		fail(c, http.StatusBadRequest, "petId does not match this appointment")
		return
	}
	if st := healthvet.ApptState(state); st != healthvet.StateConfirmed && st != healthvet.StateInProgress && st != healthvet.StateCompleted {
		fail(c, http.StatusConflict, "lab tests can be requested once the appointment is confirmed")
		return
	}
	id := uuid.New().String()
	if _, err := h.db.Exec(ctx, `
		INSERT INTO vet_lab_orders (id, appointment_id, pet_id, owner_id, provider_id, test_names, note, ordered_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$4)`,
		id, body.AppointmentID, petID, uid, providerID, tests, note); err != nil {
		fail(c, http.StatusInternalServerError, "could not place the lab request")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"ok": true, "labOrderId": id})
}
