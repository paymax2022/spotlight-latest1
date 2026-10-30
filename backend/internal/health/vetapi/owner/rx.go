package owner

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	healthrx "spotlight/backend/internal/health/rx"
)

type rxRow struct {
	ID, ApptID, PetID, PetName, VetID, VetName, VetStatus, State string
	Created                                                      time.Time
}

const rxSelect = `
	SELECT rx.id::text, vp.appointment_id::text, vp.pet_id::text, p.name, hp.id::text, hp.display_name,
	       hp.status, rx.state, rx.created_at
	FROM health_prescriptions rx
	JOIN vet_appointment_payments vp ON vp.consult_id = rx.consult_id
	JOIN pets p ON p.id = vp.pet_id
	JOIN health_providers hp ON hp.id = vp.provider_id
	WHERE rx.patient_id = $1::uuid
	  AND ($2::uuid IS NULL OR vp.pet_id = $2::uuid)
	  AND ($3::uuid IS NULL OR rx.id = $3::uuid)
	ORDER BY rx.created_at DESC
	LIMIT 200`

// loadPrescriptions returns the caller's pet prescriptions with their items. petID and
// rxID are optional filters.
func (h *Handler) loadPrescriptions(ctx context.Context, uid, petID, rxID string) ([]wirePrescription, error) {
	rows, err := h.db.Query(ctx, rxSelect, uid, nullable(petID), nullable(rxID))
	if err != nil {
		return nil, err
	}
	var heads []rxRow
	for rows.Next() {
		var r rxRow
		if err := rows.Scan(&r.ID, &r.ApptID, &r.PetID, &r.PetName, &r.VetID, &r.VetName, &r.VetStatus, &r.State, &r.Created); err != nil {
			rows.Close()
			return nil, err
		}
		heads = append(heads, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]wirePrescription, 0, len(heads))
	if len(heads) == 0 {
		return out, nil
	}
	ids := make([]string, 0, len(heads))
	for _, r := range heads {
		ids = append(ids, r.ID)
	}
	items, err := h.loadRxItems(ctx, ids)
	if err != nil {
		return nil, err
	}
	now := h.now()
	for _, r := range heads {
		appt := r.ApptID
		credStatus := "pending"
		if r.VetStatus == "APPROVED" {
			credStatus = "verified"
		}
		list := items[r.ID]
		if list == nil {
			list = []wireRxItem{}
		}
		out = append(out, wirePrescription{
			ID: r.ID, AppointmentID: &appt, PetID: r.PetID, PetName: r.PetName, VetID: r.VetID, VetName: r.VetName,
			VetCredential: wireCredential{Authority: "VCN", Status: credStatus},
			Status:        rxStatus(r.State, r.Created, now), IssuedAt: rfc(r.Created), ExpiresAt: rfc(rxExpiry(r.Created)),
			Items: list, Sensitive: true,
		})
	}
	return out, nil
}

func (h *Handler) loadRxItems(ctx context.Context, rxIDs []string) (map[string][]wireRxItem, error) {
	rows, err := h.db.Query(ctx, `
		SELECT i.prescription_id::text, i.id::text, i.drug_name, i.dosage, i.quantity, i.is_pom,
		       COALESCE(d.form,''), COALESCE(d.frequency,''), COALESCE(d.duration_days,0), COALESCE(d.instructions,'')
		FROM health_prescription_items i
		LEFT JOIN vet_rx_item_details d ON d.item_id = i.id
		WHERE i.prescription_id = ANY($1::uuid[])
		ORDER BY i.created_at, i.id`, rxIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]wireRxItem{}
	for rows.Next() {
		var rxID, instr string
		var it wireRxItem
		if err := rows.Scan(&rxID, &it.ID, &it.DrugName, &it.Dosage, &it.Quantity, &it.POM,
			&it.Form, &it.Frequency, &it.DurationDays, &instr); err != nil {
			return nil, err
		}
		it.Instructions = strPtr(instr)
		out[rxID] = append(out[rxID], it)
	}
	return out, rows.Err()
}

// ListPrescriptions — GET /prescriptions?petId=.
func (h *Handler) ListPrescriptions(c *gin.Context) {
	uid, ok := caller(c)
	if !ok {
		return
	}
	petID, ok := queryUUID(c, "petId")
	if !ok {
		return
	}
	out, err := h.loadPrescriptions(c.Request.Context(), uid, petID, "")
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, out)
}

// GetPrescription — GET /prescriptions/:id (the patient's own).
func (h *Handler) GetPrescription(c *gin.Context) {
	uid, ok := caller(c)
	if !ok {
		return
	}
	id, ok := pathUUID(c, "prescription id")
	if !ok {
		return
	}
	out, err := h.loadPrescriptions(c.Request.Context(), uid, "", id)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	if len(out) == 0 {
		fail(c, http.StatusNotFound, "prescription not found")
		return
	}
	c.JSON(http.StatusOK, out[0])
}

// SendToPharmacy — POST /prescriptions/:id/send-to-pharmacy {pharmacyProviderId?}.
// The rx engine owns the state change (ISSUED → SENT_TO_PHARMACY) and the dispense-once
// rule (HL-3); the patient is an allowed sender. The app does not yet let the owner
// choose a pharmacy, so without one in the body the oldest approved, discoverable
// pharmacy is used. No money moves here.
func (h *Handler) SendToPharmacy(c *gin.Context) {
	uid, ok := caller(c)
	if !ok {
		return
	}
	id, ok := pathUUID(c, "prescription id")
	if !ok {
		return
	}
	var body struct {
		PharmacyProviderID string `json:"pharmacyProviderId"`
	}
	_ = c.ShouldBindJSON(&body)
	ctx := c.Request.Context()

	cur, err := h.loadPrescriptions(ctx, uid, "", id)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	if len(cur) == 0 {
		fail(c, http.StatusNotFound, "prescription not found")
		return
	}
	if cur[0].Status == "SENT_TO_PHARMACY" || cur[0].Status == "DISPENSED" {
		c.JSON(http.StatusOK, cur[0]) // already handed over — idempotent
		return
	}
	if cur[0].Status != "ISSUED" {
		fail(c, http.StatusConflict, "this prescription can no longer be sent")
		return
	}
	pharmacy := body.PharmacyProviderID
	if pharmacy == "" {
		err = h.db.QueryRow(ctx, `
			SELECT id::text FROM health_providers
			WHERE domain = 'PHARMACY' AND provider_type = 'pharmacy' AND status = 'APPROVED' AND discoverable
			ORDER BY created_at ASC LIMIT 1`).Scan(&pharmacy)
		if errors.Is(err, pgx.ErrNoRows) {
			fail(c, http.StatusUnprocessableEntity, "no pharmacy is available right now")
			return
		}
		if err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
	}
	if _, err := h.rx.SendToPharmacy(ctx, uid, id, pharmacy); err != nil {
		if errors.Is(err, healthrx.ErrPrescriptionNotFound) {
			fail(c, http.StatusNotFound, "prescription not found")
			return
		}
		fail(c, http.StatusConflict, err.Error())
		return
	}
	out, err := h.loadPrescriptions(ctx, uid, "", id)
	if err != nil || len(out) == 0 {
		fail(c, http.StatusInternalServerError, "could not reload the prescription")
		return
	}
	c.JSON(http.StatusOK, out[0])
}

// medRow is one prescribed item with the counters the medication list needs.
type medRow struct {
	ItemID, RxID, PetID, PetName, Drug, Dosage, Frequency, State string
	Duration                                                     int
	Created                                                      time.Time
	Dispensed                                                    *time.Time
	RefillsAuthorized, RefillsUsed                               int
}

func toWireMedication(m medRow, now time.Time) wireMedication {
	days := m.Duration
	if days <= 0 {
		days = 30
	}
	base := m.Created
	if m.Dispensed != nil {
		base = *m.Dispensed
	}
	next := base.AddDate(0, 0, days)
	remaining := m.RefillsAuthorized - m.RefillsUsed
	if remaining < 0 {
		remaining = 0
	}
	rx := m.RxID
	active := m.State != "REJECTED" && (remaining > 0 || now.Before(next.AddDate(0, 0, 7)))
	return wireMedication{
		ID: m.ItemID, PetID: m.PetID, PetName: m.PetName, DrugName: m.Drug, Dosage: m.Dosage,
		Frequency: m.Frequency, NextRefillAt: rfc(next), RefillsRemaining: remaining, PrescriptionID: &rx, Active: active,
	}
}

// ListMedications — GET /medications?petId=. The caller's pets' prescribed medicines.
func (h *Handler) ListMedications(c *gin.Context) {
	uid, ok := caller(c)
	if !ok {
		return
	}
	petID, ok := queryUUID(c, "petId")
	if !ok {
		return
	}
	rows, err := h.db.Query(c.Request.Context(), `
		SELECT i.id::text, rx.id::text, vp.pet_id::text, p.name, i.drug_name, i.dosage,
		       COALESCE(d.frequency,''), rx.state, COALESCE(d.duration_days,0), rx.created_at, rx.dispensed_at,
		       rx.refills_authorized, rx.refills_used
		FROM health_prescription_items i
		JOIN health_prescriptions rx ON rx.id = i.prescription_id
		JOIN vet_appointment_payments vp ON vp.consult_id = rx.consult_id
		JOIN pets p ON p.id = vp.pet_id
		LEFT JOIN vet_rx_item_details d ON d.item_id = i.id
		WHERE rx.patient_id = $1::uuid AND ($2::uuid IS NULL OR vp.pet_id = $2::uuid)
		ORDER BY rx.created_at DESC, i.created_at LIMIT 200`, uid, nullable(petID))
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	out := []wireMedication{}
	now := h.now()
	for rows.Next() {
		var m medRow
		if err := rows.Scan(&m.ItemID, &m.RxID, &m.PetID, &m.PetName, &m.Drug, &m.Dosage, &m.Frequency, &m.State,
			&m.Duration, &m.Created, &m.Dispensed, &m.RefillsAuthorized, &m.RefillsUsed); err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		out = append(out, toWireMedication(m, now))
	}
	if err := rows.Err(); err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, out)
}

// RequestRefill — POST /medications/:id/refill. :id is the prescription item. Allowed
// once the prescription has been dispensed and the vet authorised refills that remain
// (DP-004). It records a request for the vet / pharmacy; no payment is taken.
func (h *Handler) RequestRefill(c *gin.Context) {
	uid, ok := caller(c)
	if !ok {
		return
	}
	id, ok := pathUUID(c, "medication id")
	if !ok {
		return
	}
	ctx := c.Request.Context()
	var rxID, state string
	var authorised, used int
	err := h.db.QueryRow(ctx, `
		SELECT rx.id::text, rx.state, rx.refills_authorized, rx.refills_used
		FROM health_prescription_items i JOIN health_prescriptions rx ON rx.id = i.prescription_id
		WHERE i.id = $1::uuid AND rx.patient_id = $2::uuid`, id, uid).Scan(&rxID, &state, &authorised, &used)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(c, http.StatusNotFound, "medication not found")
		return
	}
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	if state != "DISPENSED" && state != "FULFILLED" {
		fail(c, http.StatusConflict, "this medicine must be dispensed once before it can be refilled")
		return
	}
	if used >= authorised {
		fail(c, http.StatusConflict, "no refills remain on this prescription")
		return
	}
	if _, err := h.db.Exec(ctx, `
		INSERT INTO vet_refill_requests (item_id, prescription_id, owner_id)
		VALUES ($1::uuid, $2::uuid, $3::uuid)
		ON CONFLICT (item_id, owner_id) WHERE status = 'requested' DO NOTHING`, id, rxID, uid); err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// EmergencyVets — GET /emergency?lat=&lng=. Verified vets who see animals in person
// (home or clinic), nearest first when coordinates are given. Tele-only vets are
// excluded: a video call is not emergency care (HL-11).
func (h *Handler) EmergencyVets(c *gin.Context) {
	if _, ok := caller(c); !ok {
		return
	}
	var lat, lng *float64
	if v, err := strconv.ParseFloat(c.Query("lat"), 64); err == nil {
		lat = &v
	}
	if v, err := strconv.ParseFloat(c.Query("lng"), 64); err == nil {
		lng = &v
	}
	rows, err := h.db.Query(c.Request.Context(), `
		SELECT hp.id::text, hp.display_name, COALESCE(dvp.profile_draft::text, '{}'),
		       ST_Y(hp.geo::geometry), ST_X(hp.geo::geometry),
		       CASE WHEN $1::float8 IS NULL OR $2::float8 IS NULL OR hp.geo IS NULL THEN NULL
		            ELSE ST_Distance(hp.geo, ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geography) END
		FROM health_providers hp
		JOIN doctor_vet_profiles dvp ON dvp.user_id = hp.owner_user_id
		WHERE hp.domain = 'VET' AND hp.provider_type = 'vet' AND hp.status = 'APPROVED' AND hp.discoverable
		  AND dvp.is_published AND dvp.verification = 'approved'
		  AND EXISTS (SELECT 1 FROM vet_services s
		              WHERE s.provider_id = hp.id AND s.active AND s.visit_type IN ('HOME','CLINIC'))
		ORDER BY 6 ASC NULLS LAST, hp.display_name ASC
		LIMIT 20`, lat, lng)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	out := []wireEmergencyVet{}
	for rows.Next() {
		var v wireEmergencyVet
		var draft string
		var la, lo, dist *float64
		if err := rows.Scan(&v.ID, &v.Name, &draft, &la, &lo, &dist); err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		v.Address = draftAddress(draft)
		if la != nil {
			v.Lat = *la
		}
		if lo != nil {
			v.Lng = *lo
		}
		if dist != nil {
			v.DistanceLabel = formatDistance(*dist)
		}
		out = append(out, v)
	}
	if err := rows.Err(); err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, out)
}

// draftAddress reads the street address and city from a vet's saved profile draft.
func draftAddress(draft string) string {
	var d struct {
		Draft struct {
			PersonalInfo struct {
				Address string `json:"address"`
				City    string `json:"city"`
			} `json:"personalInfo"`
		} `json:"draft"`
	}
	if json.Unmarshal([]byte(draft), &d) != nil {
		return ""
	}
	a, c := d.Draft.PersonalInfo.Address, d.Draft.PersonalInfo.City
	switch {
	case a != "" && c != "":
		return a + ", " + c
	case a != "":
		return a
	default:
		return c
	}
}

func formatDistance(metres float64) string {
	if metres < 1000 {
		return strconv.Itoa(int(metres+0.5)) + " m"
	}
	return strconv.FormatFloat(metres/1000, 'f', 1, 64) + " km"
}
