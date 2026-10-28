package provider

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/internal/health/clinicalsafety"
	healthrx "spotlight/backend/internal/health/rx"
	healthvet "spotlight/backend/internal/health/vet"
)

const (
	maxNoteLen    = 8000
	maxRxItems    = 20
	maxLabTests   = 20
	rxValidity    = 30 * 24 * time.Hour
	maxShortField = 200
)

type soapBody struct {
	PetID string `json:"petId"`
	Soap  struct {
		Subjective string `json:"subjective"`
		Objective  string `json:"objective"`
		Assessment string `json:"assessment"`
		Plan       string `json:"plan"`
	} `json:"soap"`
	Diagnosis           string `json:"diagnosis"`
	FollowUpRecommended bool   `json:"followUpRecommended"`
	FollowUpNote        string `json:"followUpNote"`
}

func validateSoap(b *soapBody) string {
	for _, f := range []string{b.Soap.Subjective, b.Soap.Objective, b.Soap.Assessment, b.Soap.Plan, b.Diagnosis, b.FollowUpNote} {
		if len(f) > maxNoteLen {
			return "a note field is too long"
		}
	}
	if strings.TrimSpace(b.Soap.Subjective) == "" && strings.TrimSpace(b.Soap.Assessment) == "" &&
		strings.TrimSpace(b.Soap.Plan) == "" && strings.TrimSpace(b.Diagnosis) == "" {
		return "add at least a finding, assessment, plan or diagnosis"
	}
	return ""
}

// SaveSoap — POST /provider/appointments/:id/soap → {ok, summaryId}.
// Saving the note is what finishes the visit: it starts the consult if it has not
// been started, completes it (SOAP note persisted by the consult engine), and
// RELEASES the owner's held payment to the vet — all inside health/vet.Service so
// the escrow, KYC (HL-10) and commission wiring are the single, audited path. The
// diagnosis and follow-up the engine has no column for are stored in
// vet_consult_summary_extras. The summary id is the consult id (what the owner's
// GET /summaries/:id reads), and replays return it unchanged.
func (h *Handler) SaveSoap(c *gin.Context) {
	uid, p, ok := h.requireVet(c, true)
	if !ok {
		return
	}
	apptID, ok := pathID(c, "id")
	if !ok {
		return
	}
	var body soapBody
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	if msg := validateSoap(&body); msg != "" {
		fail(c, http.StatusBadRequest, msg)
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
	if body.PetID != "" && body.PetID != a.PetID {
		fail(c, http.StatusBadRequest, "petId does not match this appointment")
		return
	}

	// Replay: the note for this consult was already saved.
	if a.ConsultID != nil {
		if saved, err := h.hasSummary(ctx, *a.ConsultID); err != nil {
			fail(c, http.StatusInternalServerError, "could not save the note")
			return
		} else if saved {
			c.JSON(http.StatusOK, gin.H{"ok": true, "summaryId": *a.ConsultID})
			return
		}
	}

	switch a.State {
	case "COMPLETED":
		// Completed elsewhere — only the summary is missing, and it needs a consult.
		if a.ConsultID == nil {
			fail(c, http.StatusConflict, "this visit was completed without a consult record")
			return
		}
	case "CONFIRMED", "IN_PROGRESS":
		if a.State == "CONFIRMED" {
			if _, err := h.vet.StartConsult(ctx, uid, a.ID); err != nil {
				h.actionErr(c, err)
				return
			}
		}
		in := healthvet.CompleteInput{
			Subjective: body.Soap.Subjective, Objective: body.Soap.Objective,
			Assessment: body.Soap.Assessment, Plan: body.Soap.Plan,
		}
		if _, err := h.vet.CompleteConsult(ctx, uid, a.ID, in); err != nil {
			h.actionErr(c, err)
			return
		}
		if a, err = h.ownAppointment(ctx, p.ID, apptID); err != nil || a.ConsultID == nil {
			fail(c, http.StatusInternalServerError, "the visit completed but its record could not be read — retry to finish")
			return
		}
	default:
		fail(c, http.StatusConflict, "accept and confirm this appointment before writing the visit note")
		return
	}

	const ins = `
		INSERT INTO vet_consult_summary_extras (consult_id, diagnosis, follow_up_recommended, follow_up_note)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (consult_id) DO NOTHING`
	if _, err := h.db.Exec(ctx, ins, *a.ConsultID, strings.TrimSpace(body.Diagnosis),
		body.FollowUpRecommended, strings.TrimSpace(body.FollowUpNote)); err != nil {
		fail(c, http.StatusInternalServerError, "the visit completed but the summary could not be saved — retry to finish")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "summaryId": *a.ConsultID})
}

func (h *Handler) hasSummary(ctx context.Context, consultID string) (bool, error) {
	var id string
	err := h.db.QueryRow(ctx, `SELECT consult_id::text FROM vet_consult_summary_extras WHERE consult_id=$1`, consultID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

type rxItemBody struct {
	DrugName     string `json:"drugName"`
	Form         string `json:"form"`
	Dosage       string `json:"dosage"`
	Frequency    string `json:"frequency"`
	DurationDays int    `json:"durationDays"`
	Quantity     int    `json:"quantity"`
	POM          bool   `json:"pom"`
	Instructions string `json:"instructions"`
}

type rxBody struct {
	AppointmentID string       `json:"appointmentId"`
	PetID         string       `json:"petId"`
	Items         []rxItemBody `json:"items"`
	Notes         string       `json:"notes"`
}

var doseMgRe = regexp.MustCompile(`(?i)(\d+(?:\.\d+)?)\s*mg\b`)

// doseMg pulls a single-dose amount out of a free-text sig ("250 mg") so the
// engine's dose-range screen (RX-004) can run; 0 means "not provided".
func doseMg(dosage string) float64 {
	m := doseMgRe.FindStringSubmatch(dosage)
	if m == nil {
		return 0
	}
	v, err := strconv.ParseFloat(m[1], 64)
	if err != nil || v < 0 {
		return 0
	}
	return v
}

func validateRx(b *rxBody) string {
	if len(b.Items) == 0 || len(b.Items) > maxRxItems {
		return "a prescription needs between 1 and 20 medicines"
	}
	if len(b.Notes) > maxNoteLen {
		return "notes are too long"
	}
	for _, it := range b.Items {
		switch {
		case strings.TrimSpace(it.DrugName) == "" || len(it.DrugName) > maxShortField:
			return "each medicine needs a name"
		case strings.TrimSpace(it.Dosage) == "":
			return "each medicine needs a dosage"
		case it.Quantity < 1 || it.Quantity > 10000:
			return "quantity must be a positive whole number"
		case it.DurationDays < 0 || it.DurationDays > 365:
			return "duration must be between 0 and 365 days"
		case len(it.Dosage) > maxShortField || len(it.Frequency) > maxShortField ||
			len(it.Form) > maxShortField || len(it.Instructions) > 1000:
			return "a medicine field is too long"
		}
	}
	return ""
}

// IssuePrescription — POST /provider/prescriptions → EPrescription.
// The e-Rx engine owns issuance (HL-3 dispense-once, HL-4 no controlled drugs,
// species-aware safety hard stops). The vet-only extras the engine has no column
// for (form, frequency, duration, notes, expiry) are stored beside it.
func (h *Handler) IssuePrescription(c *gin.Context) {
	uid, p, ok := h.requireVet(c, true)
	if !ok {
		return
	}
	var body rxBody
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	if !uuidish(body.AppointmentID) {
		fail(c, http.StatusBadRequest, "appointmentId must be a uuid")
		return
	}
	if msg := validateRx(&body); msg != "" {
		fail(c, http.StatusBadRequest, msg)
		return
	}
	ctx := c.Request.Context()
	a, err := h.ownAppointment(ctx, p.ID, body.AppointmentID)
	if err != nil {
		h.apptErr(c, err)
		return
	}
	if body.PetID != "" && body.PetID != a.PetID {
		fail(c, http.StatusBadRequest, "petId does not match this appointment")
		return
	}
	if a.ConsultID == nil || (a.State != "IN_PROGRESS" && a.State != "COMPLETED") {
		fail(c, http.StatusConflict, "start the consult before prescribing")
		return
	}

	var petName, species string
	var weight *float64
	var dob *time.Time
	if err := h.db.QueryRow(ctx, `SELECT name, species, weight_kg, birth_date FROM pets WHERE id=$1`, a.PetID).
		Scan(&petName, &species, &weight, &dob); err != nil {
		fail(c, http.StatusInternalServerError, "could not load the pet")
		return
	}
	pc := clinicalsafety.PatientContext{Species: strings.ToLower(species)}
	if weight != nil {
		pc.WeightKg = *weight
	}
	if dob != nil {
		pc.AgeYears = time.Since(*dob).Hours() / (24 * 365)
	}

	items := make([]healthrx.Item, 0, len(body.Items))
	for _, it := range body.Items {
		items = append(items, healthrx.Item{
			DrugName: strings.TrimSpace(it.DrugName),
			IsPOM:    it.POM,
			Dosage:   strings.TrimSpace(it.Dosage),
			DoseMg:   doseMg(it.Dosage),
			Quantity: it.Quantity,
		})
	}
	consultRef := *a.ConsultID
	rx, err := h.rx.IssueChecked(ctx, uid, a.OwnerID, &consultRef, items, &pc, "")
	if err != nil {
		var block *healthrx.SafetyBlockError
		if errors.As(err, &block) {
			fail(c, http.StatusUnprocessableEntity, err.Error())
			return
		}
		fail(c, http.StatusConflict, err.Error())
		return
	}

	issued := time.Now()
	expires := issued.Add(rxValidity)
	tx, err := h.db.Begin(ctx)
	if err != nil {
		fail(c, http.StatusInternalServerError, "the prescription was issued but could not be completed")
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `
		INSERT INTO vet_prescription_meta (prescription_id, appointment_id, pet_id, provider_id, notes, expires_at)
		VALUES ($1,$2,$3,$4,$5,$6)`, rx.ID, a.ID, a.PetID, p.ID, strings.TrimSpace(body.Notes), expires); err != nil {
		fail(c, http.StatusInternalServerError, "the prescription was issued but could not be completed")
		return
	}
	for i, it := range rx.Items {
		src := body.Items[i]
		if _, err := tx.Exec(ctx, `
			INSERT INTO vet_rx_item_details (item_id, form, frequency, duration_days, instructions)
			VALUES ($1,$2,$3,$4,$5)`, it.ID, strings.TrimSpace(src.Form), strings.TrimSpace(src.Frequency),
			src.DurationDays, strings.TrimSpace(src.Instructions)); err != nil {
			fail(c, http.StatusInternalServerError, "the prescription was issued but could not be completed")
			return
		}
	}
	if err := tx.Commit(ctx); err != nil {
		fail(c, http.StatusInternalServerError, "the prescription was issued but could not be completed")
		return
	}

	cred, _ := h.credential(ctx, uid, p)
	out := wireRx{
		ID: rx.ID, AppointmentID: a.ID, PetID: a.PetID, PetName: petName,
		VetID: p.ID, VetName: p.DisplayName, VetCredential: cred,
		Status: "ISSUED", IssuedAt: rfc3339(issued), ExpiresAt: rfc3339(expires),
		Notes: strings.TrimSpace(body.Notes), Sensitive: true, Items: make([]wireRxItem, 0, len(rx.Items)),
	}
	for i, it := range rx.Items {
		src := body.Items[i]
		out.Items = append(out.Items, wireRxItem{
			ID: it.ID, DrugName: it.DrugName, Form: strings.TrimSpace(src.Form), Dosage: it.Dosage,
			Frequency: strings.TrimSpace(src.Frequency), DurationDays: src.DurationDays,
			Quantity: it.Quantity, POM: it.IsPOM, Instructions: strings.TrimSpace(src.Instructions),
		})
	}
	c.JSON(http.StatusCreated, out)
}

type labBody struct {
	AppointmentID string   `json:"appointmentId"`
	PetID         string   `json:"petId"`
	TestNames     []string `json:"testNames"`
	Note          string   `json:"note"`
}

// OrderLab — POST /provider/lab-orders → {ok, labOrderId}. Recorded by test name:
// the owner completes the booking at a lab, which owns its own payment.
func (h *Handler) OrderLab(c *gin.Context) {
	uid, p, ok := h.requireVet(c, true)
	if !ok {
		return
	}
	var body labBody
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	if !uuidish(body.AppointmentID) {
		fail(c, http.StatusBadRequest, "appointmentId must be a uuid")
		return
	}
	tests := make([]string, 0, len(body.TestNames))
	for _, t := range body.TestNames {
		if t = strings.TrimSpace(t); t != "" {
			if len(t) > maxShortField {
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
	if len(body.Note) > maxNoteLen {
		fail(c, http.StatusBadRequest, "note is too long")
		return
	}
	ctx := c.Request.Context()
	a, err := h.ownAppointment(ctx, p.ID, body.AppointmentID)
	if err != nil {
		h.apptErr(c, err)
		return
	}
	if body.PetID != "" && body.PetID != a.PetID {
		fail(c, http.StatusBadRequest, "petId does not match this appointment")
		return
	}
	switch a.State {
	case "CONFIRMED", "IN_PROGRESS", "COMPLETED":
	default:
		fail(c, http.StatusConflict, "confirm this appointment before ordering tests")
		return
	}
	id := uuid.New().String()
	if _, err := h.db.Exec(ctx, `
		INSERT INTO vet_lab_orders (id, appointment_id, pet_id, owner_id, provider_id, test_names, note, ordered_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		id, a.ID, a.PetID, a.OwnerID, p.ID, tests, strings.TrimSpace(body.Note), uid); err != nil {
		fail(c, http.StatusInternalServerError, "could not place the lab order")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"ok": true, "labOrderId": id})
}

type referralBody struct {
	AppointmentID string `json:"appointmentId"`
	PetID         string `json:"petId"`
	Specialty     string `json:"specialty"`
	ToVetName     string `json:"toVetName"`
	Reason        string `json:"reason"`
}

// Refer — POST /provider/referrals → {ok}.
func (h *Handler) Refer(c *gin.Context) {
	_, p, ok := h.requireVet(c, true)
	if !ok {
		return
	}
	var body referralBody
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	body.Specialty, body.ToVetName, body.Reason =
		strings.TrimSpace(body.Specialty), strings.TrimSpace(body.ToVetName), strings.TrimSpace(body.Reason)
	switch {
	case !uuidish(body.AppointmentID):
		fail(c, http.StatusBadRequest, "appointmentId must be a uuid")
		return
	case body.Specialty == "" || len(body.Specialty) > maxShortField:
		fail(c, http.StatusBadRequest, "choose a specialty")
		return
	case body.ToVetName == "" || len(body.ToVetName) > maxShortField:
		fail(c, http.StatusBadRequest, "name the vet you are referring to")
		return
	case len(body.Reason) > maxNoteLen:
		fail(c, http.StatusBadRequest, "reason is too long")
		return
	}
	ctx := c.Request.Context()
	a, err := h.ownAppointment(ctx, p.ID, body.AppointmentID)
	if err != nil {
		h.apptErr(c, err)
		return
	}
	if body.PetID != "" && body.PetID != a.PetID {
		fail(c, http.StatusBadRequest, "petId does not match this appointment")
		return
	}
	if a.State == "CANCELLED" || a.State == "REQUESTED" || a.State == "NO_SHOW" {
		fail(c, http.StatusConflict, "this appointment cannot be referred from")
		return
	}
	if _, err := h.db.Exec(ctx, `
		INSERT INTO vet_referrals (appointment_id, pet_id, owner_id, from_provider_id, specialty, to_vet_name, reason)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`, a.ID, a.PetID, a.OwnerID, p.ID, body.Specialty, body.ToVetName, body.Reason); err != nil {
		fail(c, http.StatusInternalServerError, "could not save the referral")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"ok": true})
}
