package provider

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/go-common/ginutil"
)

// vetProvider is the caller's VET provider row.
type vetProvider struct {
	ID          string
	DisplayName string
	Status      string // PENDING | APPROVED | SUSPENDED
}

func (p *vetProvider) approved() bool { return p != nil && p.Status == "APPROVED" }

// providerFor resolves the VET provider owned by uid, or nil when the user has not
// started vet onboarding.
func (h *Handler) providerFor(ctx context.Context, uid string) (*vetProvider, error) {
	var p vetProvider
	const q = `SELECT id::text, display_name, status
	           FROM health_providers
	           WHERE owner_user_id=$1 AND domain='VET' AND provider_type='vet'
	           ORDER BY created_at LIMIT 1`
	if err := h.db.QueryRow(ctx, q, uid).Scan(&p.ID, &p.DisplayName, &p.Status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &p, nil
}

// requireVet authenticates the caller and resolves their vet provider. approvedOnly
// is the HL-2 gate: every write and every read of owner data needs a live VCN
// approval, so a vet suspended mid-flight loses access at once.
func (h *Handler) requireVet(c *gin.Context, approvedOnly bool) (string, *vetProvider, bool) {
	uid := ginutil.UserID(c)
	if uid == "" {
		unauthenticated(c)
		return "", nil, false
	}
	p, err := h.providerFor(c.Request.Context(), uid)
	if err != nil {
		fail(c, http.StatusInternalServerError, "could not resolve your vet profile")
		return "", nil, false
	}
	if p == nil {
		fail(c, http.StatusForbidden, "this account is not a veterinary provider")
		return "", nil, false
	}
	if approvedOnly && !p.approved() {
		fail(c, http.StatusForbidden, "VCN verification is required before using the vet workspace (HL-2)")
		return "", nil, false
	}
	return uid, p, true
}

// apptRef is the slice of an appointment the provider routes need.
type apptRef struct {
	ID        string
	OwnerID   string
	PetID     string
	VisitType string
	State     string
	SlotStart time.Time
	SlotEnd   time.Time
	ConsultID *string
	PayState  string
	TotalKobo int64
}

// ownAppointment loads a PET appointment that belongs to provider. A foreign or
// missing id is the same not-found: no existence oracle across vets.
func (h *Handler) ownAppointment(ctx context.Context, providerID, apptID string) (*apptRef, error) {
	var a apptRef
	const q = `
		SELECT a.id::text, a.patient_id::text, vp.pet_id::text, a.visit_type, a.state,
		       a.slot_start, a.slot_end, vp.consult_id::text, vp.pay_state, vp.total_kobo
		FROM health_appointments a
		JOIN vet_appointment_payments vp ON vp.appointment_id = a.id
		WHERE a.id = $1 AND a.provider_id = $2 AND a.subject_type = 'PET'`
	err := h.db.QueryRow(ctx, q, apptID, providerID).Scan(
		&a.ID, &a.OwnerID, &a.PetID, &a.VisitType, &a.State, &a.SlotStart, &a.SlotEnd,
		&a.ConsultID, &a.PayState, &a.TotalKobo)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errNotFound
		}
		return nil, err
	}
	return &a, nil
}

var errNotFound = errors.New("not found")

// uuidish is a cheap guard so a malformed id is a clean 400, not a driver error.
func uuidish(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, r := range s {
		switch i {
		case 8, 13, 18, 23:
			if r != '-' {
				return false
			}
		default:
			if !(r >= '0' && r <= '9' || r >= 'a' && r <= 'f' || r >= 'A' && r <= 'F') {
				return false
			}
		}
	}
	return true
}

// pathID reads and validates a uuid path parameter.
func pathID(c *gin.Context, name string) (string, bool) {
	id := strings.TrimSpace(c.Param(name))
	if !uuidish(id) {
		fail(c, http.StatusBadRequest, name+" must be a uuid")
		return "", false
	}
	return id, true
}
