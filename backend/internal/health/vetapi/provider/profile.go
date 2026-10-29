package provider

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/internal/health/clinicloc"
)

const (
	maxBioLen  = 2000
	maxFeeKobo = 100_000_000 // ₦1,000,000 per visit — a sanity ceiling, not a price rule
)

var visitFromWire = map[string]string{"tele": "TELE", "home": "HOME", "clinic": "CLINIC"}

// vetDraft is the slice of doctor_vet_profiles.profile_draft the workspace shows
// (the same document the public listing reads).
type vetDraft struct {
	Draft struct {
		PersonalInfo struct {
			Address string `json:"address"`
			City    string `json:"city"`
			State   string `json:"state"`
		} `json:"personalInfo"`
		Bio            string   `json:"bio"`
		SpeciesTreated []string `json:"speciesTreated"`
		Affiliations   []struct {
			Name      string `json:"name"`
			IsPrimary bool   `json:"isPrimary"`
		} `json:"affiliations"`
	} `json:"draft"`
}

func (d vetDraft) primaryClinic() string {
	for _, a := range d.Draft.Affiliations {
		if a.IsPrimary && strings.TrimSpace(a.Name) != "" {
			return strings.TrimSpace(a.Name)
		}
	}
	for _, a := range d.Draft.Affiliations {
		if strings.TrimSpace(a.Name) != "" {
			return strings.TrimSpace(a.Name)
		}
	}
	return ""
}

func applicationStatus(state string) string {
	switch state {
	case "DRAFT":
		return "draft"
	case "SUBMITTED":
		return "submitted"
	case "UNDER_REVIEW":
		return "under_review"
	case "APPROVED":
		return "approved"
	}
	return "needs_info"
}

// credential builds the vet's public-safe VCN credential from the verification
// record (never the register match detail).
func (h *Handler) credential(ctx context.Context, uid string, p *vetProvider) (wireCredential, error) {
	cred := wireCredential{Authority: "VCN", Status: "pending"}
	var reg, status string
	var expiry *time.Time
	const q = `
		SELECT vr.reg_number, vr.status, vr.licence_expiry
		FROM health_verification_records vr
		JOIN health_provider_applications pa ON pa.id = vr.provider_application_id
		WHERE pa.owner_user_id = $1 AND pa.domain = 'VET'
		ORDER BY vr.created_at DESC LIMIT 1`
	err := h.db.QueryRow(ctx, q, uid).Scan(&reg, &status, &expiry)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return cred, err
	}
	if err == nil {
		cred.LicenseNo = reg
		if status == "VERIFIED" {
			cred.Status = "verified"
		}
		if expiry != nil {
			cred.ExpiresAt = expiry.Format("2006-01-02")
			if expiry.Before(time.Now()) {
				cred.Status = "expired"
			}
		}
	}
	if cred.LicenseNo == "" {
		_ = h.db.QueryRow(ctx, `SELECT COALESCE(licence_number,'') FROM doctor_vet_profiles WHERE user_id=$1`, uid).Scan(&cred.LicenseNo)
	}
	if p != nil && p.approved() && cred.Status == "pending" && errors.Is(err, pgx.ErrNoRows) {
		cred.Status = "verified"
	}
	return cred, nil
}

func (h *Handler) buildProfile(ctx context.Context, uid string, p *vetProvider) (wireProfile, error) {
	out := wireProfile{Types: []string{}, Species: []string{}, Status: "draft"}

	var appID, appState, appName string
	err := h.db.QueryRow(ctx, `
		SELECT id::text, state, display_name FROM health_provider_applications
		WHERE owner_user_id = $1 AND domain = 'VET' ORDER BY created_at DESC LIMIT 1`, uid).Scan(&appID, &appState, &appName)
	switch {
	case err == nil:
		out.ApplicationID, out.DisplayName, out.Status = appID, appName, applicationStatus(appState)
	case !errors.Is(err, pgx.ErrNoRows):
		return out, err
	}
	if p != nil {
		if out.DisplayName == "" {
			out.DisplayName = p.DisplayName
		}
		if p.approved() {
			out.Status = "approved"
		}
	}

	var draftRaw string
	err = h.db.QueryRow(ctx, `SELECT COALESCE(profile_draft::text, '{}') FROM doctor_vet_profiles WHERE user_id=$1`, uid).Scan(&draftRaw)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return out, err
	}
	var d vetDraft
	_ = json.Unmarshal([]byte(draftRaw), &d) // a malformed draft shows as blank, never a 500
	out.Bio = strings.TrimSpace(d.Draft.Bio)
	out.ClinicName = d.primaryClinic()
	out.Species = lowerAll(d.Draft.SpeciesTreated)
	out.ClinicAddress = strings.TrimSpace(d.Draft.PersonalInfo.Address)
	out.ClinicCity = strings.TrimSpace(d.Draft.PersonalInfo.City)
	out.ClinicState = strings.TrimSpace(d.Draft.PersonalInfo.State)
	if p != nil {
		var lat, lng *float64
		if err := h.db.QueryRow(ctx, `
			SELECT ST_Y(geo::geometry), ST_X(geo::geometry) FROM health_providers WHERE id = $1`, p.ID).Scan(&lat, &lng); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return out, err
		}
		out.ClinicLat, out.ClinicLng = lat, lng
	}

	cred, err := h.credential(ctx, uid, p)
	if err != nil {
		return out, err
	}
	out.Credential = cred
	out.VcnLicenseNo = cred.LicenseNo

	if p != nil {
		rows, err := h.db.Query(ctx, `
			SELECT visit_type, MIN(price_kobo) FROM vet_services
			WHERE provider_id = $1 AND active = true GROUP BY visit_type`, p.ID)
		if err != nil {
			return out, err
		}
		defer rows.Close()
		for rows.Next() {
			var vt string
			var price int64
			if err := rows.Scan(&vt, &price); err != nil {
				return out, err
			}
			out.Types = append(out.Types, strings.ToLower(vt))
			switch vt {
			case "TELE":
				out.ConsultFeeKobo = price
			case "CLINIC":
				if out.ConsultFeeKobo == 0 {
					out.ConsultFeeKobo = price
				}
			case "HOME":
				out.HomeVisitFeeKobo = price
			}
		}
		if err := rows.Err(); err != nil {
			return out, err
		}
		sort.Strings(out.Types)
	}
	return out, nil
}

// GetProfile — GET /provider/profile → ProviderProfile (the caller's own).
func (h *Handler) GetProfile(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		unauthenticated(c)
		return
	}
	p, err := h.providerFor(c.Request.Context(), uid)
	if err != nil {
		fail(c, http.StatusInternalServerError, "could not load your profile")
		return
	}
	out, err := h.buildProfile(c.Request.Context(), uid, p)
	if err != nil {
		fail(c, http.StatusInternalServerError, "could not load your profile")
		return
	}
	c.JSON(http.StatusOK, out)
}

type profileBody struct {
	Bio              *string   `json:"bio"`
	ConsultFeeKobo   *int64    `json:"consultFeeKobo"`
	HomeVisitFeeKobo *int64    `json:"homeVisitFeeKobo"`
	Types            *[]string `json:"types"`

	ClinicAddress *string  `json:"clinicAddress"`
	ClinicCity    *string  `json:"clinicCity"`
	ClinicState   *string  `json:"clinicState"`
	ClinicLat     *float64 `json:"clinicLat"`
	ClinicLng     *float64 `json:"clinicLng"`
}

// clinicInput maps the request body onto the shared clinic-location rules.
func clinicInput(b profileBody) clinicloc.Input {
	return clinicloc.Input{Address: b.ClinicAddress, City: b.ClinicCity, State: b.ClinicState, Lat: b.ClinicLat, Lng: b.ClinicLng}
}

// validateClinic checks the optional clinic-location fields. It returns the
// message to show the caller, or "" when the body is acceptable.
func validateClinic(b profileBody) string { return clinicloc.Validate(clinicInput(b)) }

// clinicDraftPatch is the personalInfo keys the caller actually sent, so a save
// that omits a field never blanks it.
func clinicDraftPatch(b profileBody) map[string]string { return clinicloc.DraftPatch(clinicInput(b)) }

// PutProfile — PUT /provider/profile {bio?, consultFeeKobo?, homeVisitFeeKobo?, types?}
// → ProviderProfile. Only an APPROVED vet may list services and fees (HL-2). Fees
// are positive integer kobo. Each enabled visit type becomes (or stays) an active
// vet_services row at its fee; a type left out is deactivated, never deleted, so
// existing appointments keep their pinned service.
func (h *Handler) PutProfile(c *gin.Context) {
	uid, p, ok := h.requireVet(c, true)
	if !ok {
		return
	}
	var body profileBody
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	if body.Bio != nil && len(*body.Bio) > maxBioLen {
		fail(c, http.StatusBadRequest, "bio must be 2000 characters or fewer")
		return
	}
	if msg := validateClinic(body); msg != "" {
		fail(c, http.StatusBadRequest, msg)
		return
	}
	for _, f := range []*int64{body.ConsultFeeKobo, body.HomeVisitFeeKobo} {
		if f != nil && (*f < 0 || *f > maxFeeKobo) {
			fail(c, http.StatusBadRequest, "fees must be a non-negative amount in kobo")
			return
		}
	}
	var wantTypes map[string]bool
	if body.Types != nil {
		wantTypes = map[string]bool{}
		for _, t := range *body.Types {
			vt, ok := visitFromWire[strings.ToLower(strings.TrimSpace(t))]
			if !ok {
				fail(c, http.StatusBadRequest, "types may only be tele, home or clinic")
				return
			}
			wantTypes[vt] = true
		}
	}

	ctx := c.Request.Context()
	cur, err := h.buildProfile(ctx, uid, p)
	if err != nil {
		fail(c, http.StatusInternalServerError, "could not load your profile")
		return
	}
	consult, home := cur.ConsultFeeKobo, cur.HomeVisitFeeKobo
	if body.ConsultFeeKobo != nil {
		consult = *body.ConsultFeeKobo
	}
	if body.HomeVisitFeeKobo != nil {
		home = *body.HomeVisitFeeKobo
	}
	enabled := wantTypes
	if enabled == nil {
		enabled = map[string]bool{}
		for _, t := range cur.Types {
			enabled[strings.ToUpper(t)] = true
		}
	}
	if (enabled["TELE"] || enabled["CLINIC"]) && consult <= 0 {
		fail(c, http.StatusBadRequest, "set a consultation fee for tele and clinic visits")
		return
	}
	if enabled["HOME"] && home <= 0 {
		fail(c, http.StatusBadRequest, "set a home-visit fee before enabling home visits")
		return
	}

	tx, err := h.db.Begin(ctx)
	if err != nil {
		fail(c, http.StatusInternalServerError, "could not save your profile")
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if body.Bio != nil {
		bio := strings.TrimSpace(*body.Bio)
		const upsert = `
			INSERT INTO doctor_vet_profiles (user_id, profile_draft)
			VALUES ($1, jsonb_build_object('draft', jsonb_build_object('bio', $2::text)))
			ON CONFLICT (user_id) DO UPDATE SET
			  profile_draft = jsonb_set(
			    COALESCE(doctor_vet_profiles.profile_draft, '{}'::jsonb)
			      || jsonb_build_object('draft', COALESCE(doctor_vet_profiles.profile_draft->'draft', '{}'::jsonb)),
			    '{draft,bio}', to_jsonb($2::text), true),
			  updated_at = now()`
		if _, err := tx.Exec(ctx, upsert, uid, bio); err != nil {
			fail(c, http.StatusInternalServerError, "could not save your profile")
			return
		}
	}

	if err := clinicloc.MergeDraft(ctx, tx, uid, clinicDraftPatch(body)); err != nil {
		fail(c, http.StatusInternalServerError, "could not save your clinic address")
		return
	}
	if body.ClinicLat != nil && body.ClinicLng != nil {
		if _, err := tx.Exec(ctx, `
			UPDATE health_providers
			SET geo = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, updated_at = now()
			WHERE id = $1`, p.ID, *body.ClinicLng, *body.ClinicLat); err != nil {
			fail(c, http.StatusInternalServerError, "could not save your clinic location")
			return
		}
	}

	if body.ConsultFeeKobo != nil || body.HomeVisitFeeKobo != nil || body.Types != nil {
		names := map[string]string{"TELE": "Video consultation", "CLINIC": "Clinic visit", "HOME": "Home visit"}
		for _, vt := range []string{"TELE", "CLINIC", "HOME"} {
			price := consult
			if vt == "HOME" {
				price = home
			}
			if enabled[vt] {
				// Update the existing service for this visit type; create it if there is none.
				tag, err := tx.Exec(ctx, `
					UPDATE vet_services SET price_kobo=$3, active=true, updated_at=now()
					WHERE provider_id=$1 AND visit_type=$2`, p.ID, vt, price)
				if err != nil {
					fail(c, http.StatusInternalServerError, "could not save your fees")
					return
				}
				if tag.RowsAffected() == 0 {
					if _, err := tx.Exec(ctx, `
						INSERT INTO vet_services (id, provider_id, code, name, visit_type, price_kobo, active)
						VALUES ($1,$2,$3,$4,$5,$6,true)`,
						uuid.New().String(), p.ID, strings.ToLower(vt), names[vt], vt, price); err != nil {
						fail(c, http.StatusInternalServerError, "could not save your fees")
						return
					}
				}
			} else if body.Types != nil {
				if _, err := tx.Exec(ctx, `
					UPDATE vet_services SET active=false, updated_at=now()
					WHERE provider_id=$1 AND visit_type=$2 AND active`, p.ID, vt); err != nil {
					fail(c, http.StatusInternalServerError, "could not save your fees")
					return
				}
			}
		}
	}
	if err := tx.Commit(ctx); err != nil {
		fail(c, http.StatusInternalServerError, "could not save your profile")
		return
	}

	out, err := h.buildProfile(ctx, uid, p)
	if err != nil {
		fail(c, http.StatusInternalServerError, "saved, but could not reload your profile")
		return
	}
	c.JSON(http.StatusOK, out)
}
