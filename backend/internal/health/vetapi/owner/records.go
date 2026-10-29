package owner

import (
	"errors"
	"net/http"
	"sort"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/go-common/ginutil"
)

// PetRecords — GET /pets/:id/records. A timeline of the pet's vault records, consult
// notes, prescriptions and administered vaccinations, newest first. Owner only: a pet
// that is not the caller's reads as 404.
func (h *Handler) PetRecords(c *gin.Context) {
	uid, ok := caller(c)
	if !ok {
		return
	}
	petID, ok := pathUUID(c, "pet id")
	if !ok {
		return
	}
	ctx := c.Request.Context()

	var owned bool
	if err := h.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pets WHERE id=$1::uuid AND owner_user_id=$2::uuid)`,
		petID, uid).Scan(&owned); err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	if !owned {
		fail(c, http.StatusNotFound, "pet not found")
		return
	}

	out := []wireRecord{}

	// 1) vault records (the pet profile seed row is not a health event)
	rows, err := h.db.Query(ctx, `
		SELECT id::text, record_type, title, body, created_at FROM health_records
		WHERE subject_type = 'PET' AND pet_ref = $1::uuid AND owner_user_id = $2::uuid
		  AND NOT erased AND record_type <> 'PET_PROFILE'`, petID, uid)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	for rows.Next() {
		var id, rtype, title, body string
		var at time.Time
		if err := rows.Scan(&id, &rtype, &title, &body, &at); err != nil {
			rows.Close()
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		out = append(out, wireRecord{ID: id, PetID: petID, Kind: recordKind(rtype), Title: title,
			Summary: snippet(body, 160), At: rfc(at), Sensitive: true})
	}
	rows.Close()

	// 2) consult notes
	rows, err = h.db.Query(ctx, `
		SELECT n.id::text, n.assessment, n.created_at, hp.display_name
		FROM health_clinical_notes n
		JOIN vet_appointment_payments vp ON vp.consult_id = n.consult_id
		JOIN health_providers hp ON hp.id = vp.provider_id
		WHERE vp.pet_id = $1::uuid AND vp.owner_id = $2::uuid`, petID, uid)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	for rows.Next() {
		var id, assessment, vet string
		var at time.Time
		if err := rows.Scan(&id, &assessment, &at, &vet); err != nil {
			rows.Close()
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		out = append(out, wireRecord{ID: id, PetID: petID, Kind: "consult_note", Title: "Consultation note",
			Summary: snippet(assessment, 160), At: rfc(at), ProviderName: strPtr(vet), Sensitive: true})
	}
	rows.Close()

	// 3) prescriptions
	rows, err = h.db.Query(ctx, `
		SELECT rx.id::text, rx.created_at, hp.display_name,
		       COALESCE((SELECT string_agg(i.drug_name, ', ' ORDER BY i.created_at)
		                 FROM health_prescription_items i WHERE i.prescription_id = rx.id), '')
		FROM health_prescriptions rx
		JOIN vet_appointment_payments vp ON vp.consult_id = rx.consult_id
		JOIN health_providers hp ON hp.id = vp.provider_id
		WHERE vp.pet_id = $1::uuid AND vp.owner_id = $2::uuid`, petID, uid)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	for rows.Next() {
		var id, vet, drugs string
		var at time.Time
		if err := rows.Scan(&id, &at, &vet, &drugs); err != nil {
			rows.Close()
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		out = append(out, wireRecord{ID: id, PetID: petID, Kind: "prescription", Title: "E-prescription",
			Summary: snippet(drugs, 160), At: rfc(at), ProviderName: strPtr(vet), Sensitive: true})
	}
	rows.Close()

	// 4) vaccinations already given
	rows, err = h.db.Query(ctx, `
		SELECT id::text, vaccine, administered_at FROM vaccination_schedules
		WHERE pet_id = $1::uuid AND owner_user_id = $2::uuid AND administered_at IS NOT NULL`, petID, uid)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	for rows.Next() {
		var id, vaccine string
		var at time.Time
		if err := rows.Scan(&id, &vaccine, &at); err != nil {
			rows.Close()
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		out = append(out, wireRecord{ID: id, PetID: petID, Kind: "vaccination", Title: vaccine + " vaccination",
			Summary: "Vaccine administered", At: rfc(at)})
	}
	rows.Close()

	sort.SliceStable(out, func(i, j int) bool { return out[i].At > out[j].At })
	c.JSON(http.StatusOK, out)
}

// ListVaccinations — GET /vaccinations?petId=. Dose schedules of the caller's pets.
func (h *Handler) ListVaccinations(c *gin.Context) {
	uid, ok := caller(c)
	if !ok {
		return
	}
	petID, ok := queryUUID(c, "petId")
	if !ok {
		return
	}
	rows, err := h.db.Query(c.Request.Context(), `
		SELECT v.id::text, v.pet_id::text, v.vaccine, v.due_at, v.administered_at, v.scheduled_for, v.notes
		FROM vaccination_schedules v
		JOIN pets p ON p.id = v.pet_id
		WHERE p.owner_user_id = $1::uuid AND ($2::uuid IS NULL OR v.pet_id = $2::uuid)
		ORDER BY v.due_at ASC LIMIT 500`, uid, nullable(petID))
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	out := []wireVaccination{}
	now := h.now()
	for rows.Next() {
		var id, pet, vaccine, notes string
		var due time.Time
		var given, sched *time.Time
		if err := rows.Scan(&id, &pet, &vaccine, &due, &given, &sched, &notes); err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		out = append(out, toWireVaccination(now, id, pet, vaccine, notes, due, given, sched))
	}
	if err := rows.Err(); err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, out)
}

func toWireVaccination(now time.Time, id, pet, vaccine, notes string, due time.Time, given, sched *time.Time) wireVaccination {
	status, shown := vaccinationStatus(now, due, given, sched)
	v := wireVaccination{ID: id, PetID: pet, Vaccine: vaccine, Status: status, DueAt: rfc(shown), Notes: strPtr(notes)}
	if given != nil {
		s := rfc(*given)
		v.LastGivenAt = &s
	}
	return v
}

// ScheduleVaccination — POST /vaccinations/:id/schedule {dueAt}. The owner books the
// date a pending dose will be given. A dose already given cannot be rescheduled.
func (h *Handler) ScheduleVaccination(c *gin.Context) {
	uid, ok := caller(c)
	if !ok {
		return
	}
	id, ok := pathUUID(c, "vaccination id")
	if !ok {
		return
	}
	var req struct {
		DueAt string `json:"dueAt"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	when, err := time.Parse(time.RFC3339, req.DueAt)
	if err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "dueAt must be an RFC3339 time")
		return
	}
	if !when.After(h.now()) {
		ginutil.FailOK(c, http.StatusUnprocessableEntity, "choose a date in the future")
		return
	}
	var pet, vaccine, notes string
	var due time.Time
	var given, sched *time.Time
	err = h.db.QueryRow(c.Request.Context(), `
		UPDATE vaccination_schedules v SET scheduled_for = $3
		FROM pets p
		WHERE v.id = $1::uuid AND p.id = v.pet_id AND p.owner_user_id = $2::uuid AND v.administered_at IS NULL
		RETURNING v.pet_id::text, v.vaccine, v.due_at, v.administered_at, v.scheduled_for, v.notes`,
		id, uid, when).Scan(&pet, &vaccine, &due, &given, &sched, &notes)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(c, http.StatusNotFound, "vaccination not found")
		return
	}
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, toWireVaccination(h.now(), id, pet, vaccine, notes, due, given, sched))
}

// AcknowledgeConsent — POST /records/:id/consent (HL-8). :id is the client's reference
// to what is being unlocked — a pet ("pet_<uuid>"), a prescription, a consult note or a
// vault record — and must belong to the caller. The acknowledgement is stored once per
// (owner, reference).
func (h *Handler) AcknowledgeConsent(c *gin.Context) {
	uid, ok := caller(c)
	if !ok {
		return
	}
	ref := normaliseRecordRef(c.Param("id"))
	if _, err := uuid.Parse(ref); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "record id must be a uuid")
		return
	}
	var owned bool
	if err := h.db.QueryRow(c.Request.Context(), `
		SELECT EXISTS (SELECT 1 FROM pets WHERE id = $1::uuid AND owner_user_id = $2::uuid)
		    OR EXISTS (SELECT 1 FROM health_prescriptions WHERE id = $1::uuid AND patient_id = $2::uuid)
		    OR EXISTS (SELECT 1 FROM health_records WHERE id = $1::uuid AND owner_user_id = $2::uuid)
		    OR EXISTS (SELECT 1 FROM health_consults WHERE id = $1::uuid AND patient_id = $2::uuid)
		    OR EXISTS (SELECT 1 FROM health_clinical_notes n JOIN health_consults c ON c.id = n.consult_id
		               WHERE n.id = $1::uuid AND c.patient_id = $2::uuid)`, ref, uid).Scan(&owned); err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	if !owned {
		fail(c, http.StatusNotFound, "record not found")
		return
	}
	if _, err := h.db.Exec(c.Request.Context(), `
		INSERT INTO vet_record_consents (owner_id, record_ref) VALUES ($1::uuid, $2)
		ON CONFLICT (owner_id, record_ref) DO NOTHING`, uid, ref); err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"acknowledged": true})
}
