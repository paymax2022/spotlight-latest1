package provider

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

// Chart — GET /provider/pets/:petId/chart → PetChart.
//
// HL-8 (NDPA) gating, in two layers:
//  1. Treating relationship: the vet must hold an active appointment for this pet.
//     Anything else is the uniform not-found (no existence oracle for pet ids).
//  2. Consent: the pet's basic details and vaccination schedule go with the
//     relationship; medical history written by OTHER providers or uploaded by the
//     owner (vault records, other vets' notes and prescriptions) needs the owner's
//     active RECORDS consent. The vet's own earlier notes and prescriptions are
//     always visible to them.
//
// Every vault record handed out under consent is access-logged.
func (h *Handler) Chart(c *gin.Context) {
	uid, p, ok := h.requireVet(c, true)
	if !ok {
		return
	}
	petID, ok := pathID(c, "petId")
	if !ok {
		return
	}
	ctx := c.Request.Context()

	var treating bool
	const rel = `
		SELECT EXISTS (
		  SELECT 1 FROM vet_appointment_payments vp
		  JOIN health_appointments a ON a.id = vp.appointment_id
		  WHERE vp.pet_id = $1 AND vp.provider_id = $2
		    AND a.state IN ('ACCEPTED','CONFIRMED','IN_PROGRESS','COMPLETED','RESCHEDULED'))`
	if err := h.db.QueryRow(ctx, rel, petID, p.ID).Scan(&treating); err != nil {
		fail(c, http.StatusInternalServerError, "could not load the chart")
		return
	}
	if !treating {
		fail(c, http.StatusNotFound, "pet not found")
		return
	}

	var (
		pet      wirePet
		species  string
		sex      string
		dob      *time.Time
		weight   *float64
		notes    string
		ownerID  string
		ownerRaw string
		updated  time.Time
	)
	const petQ = `
		SELECT pt.id::text, pt.name, pt.species, pt.breed, pt.sex, pt.birth_date, pt.weight_kg, pt.notes,
		       pt.owner_user_id::text, COALESCE(up.full_name, ''), pt.updated_at
		FROM pets pt LEFT JOIN user_profiles up ON up.id = pt.owner_user_id
		WHERE pt.id = $1`
	if err := h.db.QueryRow(ctx, petQ, petID).Scan(&pet.ID, &pet.Name, &species, &pet.Breed, &sex, &dob, &weight, &notes,
		&ownerID, &ownerRaw, &updated); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			fail(c, http.StatusNotFound, "pet not found")
			return
		}
		fail(c, http.StatusInternalServerError, "could not load the chart")
		return
	}
	now := time.Now()
	pet.Species = speciesToWire(species)
	pet.Sex = sexToWire(sex)
	pet.Notes = notes
	pet.WeightKg = weight
	pet.AgeLabel = ageLabel(dob, now)
	pet.AvatarColor = petColor(pet.ID)
	if dob != nil {
		pet.Dob = dob.Format("2006-01-02")
	}

	consentID, hasConsent, err := h.activeConsent(ctx, uid, ownerID)
	if err != nil {
		fail(c, http.StatusInternalServerError, "could not check owner consent")
		return
	}

	chart := wireChart{
		Pet:          pet,
		OwnerName:    shortName(ownerRaw, "Pet owner"),
		Vaccinations: []wireVaccination{},
		Records:      []wireRecord{},
		WeightSeries: []wireWeightPoint{},
	}
	if weight != nil {
		chart.WeightSeries = append(chart.WeightSeries, wireWeightPoint{At: rfc3339(updated), Kg: *weight})
	}

	if chart.Vaccinations, err = h.vaccinations(ctx, petID, now); err != nil {
		fail(c, http.StatusInternalServerError, "could not load vaccinations")
		return
	}
	if chart.Records, err = h.chartRecords(ctx, uid, p.ID, petID, consentID, hasConsent); err != nil {
		fail(c, http.StatusInternalServerError, "could not load the medical history")
		return
	}
	// RFC3339 UTC strings sort chronologically as text; newest first.
	sort.Slice(chart.Records, func(i, j int) bool { return chart.Records[i].At > chart.Records[j].At })
	c.JSON(http.StatusOK, chart)
}

// activeConsent returns the owner's active RECORDS grant to this vet, if any.
func (h *Handler) activeConsent(ctx context.Context, granteeID, ownerID string) (string, bool, error) {
	var id string
	const q = `
		SELECT id::text FROM health_consents
		WHERE grantee_id = $1 AND subject_owner_id = $2 AND scope = 'RECORDS' AND state = 'ACTIVE'
		  AND (expires_at IS NULL OR expires_at > now())
		ORDER BY granted_at DESC LIMIT 1`
	if err := h.db.QueryRow(ctx, q, granteeID, ownerID).Scan(&id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", false, nil
		}
		return "", false, err
	}
	return id, true, nil
}

func vaccinationStatus(administered, scheduledFor *time.Time, due, now time.Time) string {
	switch {
	case administered != nil:
		return "up_to_date"
	case scheduledFor != nil && scheduledFor.After(now):
		return "scheduled"
	case due.Before(now):
		return "overdue"
	case due.Before(now.AddDate(0, 0, 30)):
		return "due_soon"
	}
	return "scheduled"
}

func (h *Handler) vaccinations(ctx context.Context, petID string, now time.Time) ([]wireVaccination, error) {
	const q = `
		SELECT id::text, vaccine, due_at, administered_at, scheduled_for, notes
		FROM vaccination_schedules WHERE pet_id = $1 ORDER BY due_at DESC LIMIT 100`
	rows, err := h.db.Query(ctx, q, petID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []wireVaccination{}
	for rows.Next() {
		var v wireVaccination
		var due time.Time
		var given, sched *time.Time
		if err := rows.Scan(&v.ID, &v.Vaccine, &due, &given, &sched, &v.Notes); err != nil {
			return nil, err
		}
		v.PetID = petID
		v.DueAt = rfc3339(due)
		v.Status = vaccinationStatus(given, sched, due, now)
		if given != nil {
			v.LastGivenAt = rfc3339(*given)
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// recordKind folds the vault's free-form record_type into the app's kinds.
func recordKind(t string) string {
	t = strings.ToLower(t)
	switch {
	case strings.Contains(t, "vacc"):
		return "vaccination"
	case strings.Contains(t, "lab"):
		return "lab_result"
	case strings.Contains(t, "weight"):
		return "weight"
	case strings.Contains(t, "presc") || strings.Contains(t, "rx"):
		return "prescription"
	case strings.Contains(t, "consult") || strings.Contains(t, "note") || strings.Contains(t, "soap"):
		return "consult_note"
	}
	return "document"
}

func (h *Handler) chartRecords(ctx context.Context, uid, providerID, petID, consentID string, hasConsent bool) ([]wireRecord, error) {
	out := []wireRecord{}

	// This vet's own consult notes and prescriptions — always theirs to see (found
	// through the consult each visit was recorded on).
	// Other providers' entries need the owner's consent (HL-8).
	const sum = `
		SELECT c.id::text, COALESCE(NULLIF(x.diagnosis, ''), n.assessment, ''), COALESCE(c.completed_at, c.created_at),
		       hp.display_name, vp.provider_id = $2
		FROM vet_appointment_payments vp
		JOIN health_consults c ON c.id = vp.consult_id AND c.state = 'COMPLETED'
		JOIN health_providers hp ON hp.id = vp.provider_id
		LEFT JOIN vet_consult_summary_extras x ON x.consult_id = c.id
		LEFT JOIN LATERAL (SELECT assessment FROM health_clinical_notes WHERE consult_id = c.id ORDER BY created_at DESC LIMIT 1) n ON true
		WHERE vp.pet_id = $1
		ORDER BY COALESCE(c.completed_at, c.created_at) DESC LIMIT 50`
	rows, err := h.db.Query(ctx, sum, petID, providerID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var r wireRecord
		var at time.Time
		var mine bool
		if err := rows.Scan(&r.ID, &r.Summary, &at, &r.ProviderName, &mine); err != nil {
			rows.Close()
			return nil, err
		}
		if !mine && !hasConsent {
			continue
		}
		r.PetID, r.Kind, r.Title, r.At, r.Sensitive = petID, "consult_note", "Consultation", rfc3339(at), true
		out = append(out, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Prescriptions are tied to the pet through their consult.
	const rx = `
		SELECT rx.id::text, rx.created_at, hp.display_name, vp.provider_id = $2,
		       COALESCE(string_agg(i.drug_name, ', ' ORDER BY i.created_at), '')
		FROM health_prescriptions rx
		JOIN vet_appointment_payments vp ON vp.consult_id = rx.consult_id
		JOIN health_providers hp ON hp.id = vp.provider_id
		LEFT JOIN health_prescription_items i ON i.prescription_id = rx.id
		WHERE vp.pet_id = $1
		GROUP BY rx.id, rx.created_at, hp.display_name, vp.provider_id
		ORDER BY rx.created_at DESC LIMIT 50`
	rows, err = h.db.Query(ctx, rx, petID, providerID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var r wireRecord
		var at time.Time
		var mine bool
		if err := rows.Scan(&r.ID, &at, &r.ProviderName, &mine, &r.Summary); err != nil {
			rows.Close()
			return nil, err
		}
		if !mine && !hasConsent {
			continue
		}
		r.PetID, r.Kind, r.Title, r.At, r.Sensitive = petID, "prescription", "Prescription", rfc3339(at), true
		out = append(out, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Owner-uploaded vault records: consent only.
	if hasConsent {
		const vault = `
			SELECT id::text, record_type, title, body, created_at
			FROM health_records
			WHERE subject_type = 'PET' AND pet_ref = $1 AND NOT erased
			ORDER BY created_at DESC LIMIT 100`
		rows, err = h.db.Query(ctx, vault, petID)
		if err != nil {
			return nil, err
		}
		var logged []string
		for rows.Next() {
			var r wireRecord
			var typ string
			var at time.Time
			if err := rows.Scan(&r.ID, &typ, &r.Title, &r.Summary, &at); err != nil {
				rows.Close()
				return nil, err
			}
			r.PetID, r.Kind, r.At, r.Sensitive = petID, recordKind(typ), rfc3339(at), true
			out = append(out, r)
			logged = append(logged, r.ID)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
		// Immutable access log, one row per record handed out (HL-8).
		for _, id := range logged {
			if _, err := h.db.Exec(ctx,
				`INSERT INTO health_record_access_log (record_id, accessor_id, access_basis, consent_id)
				 VALUES ($1,$2,'CONSENT',$3)`, id, uid, consentID); err != nil {
				return nil, err
			}
		}
	}
	return out, nil
}
