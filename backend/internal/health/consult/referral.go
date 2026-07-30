package healthconsult

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// TM-007 — a consult can generate a referral to a specialist or an in-person visit.
//
// During or after a tele-consult the clinician may refer the patient onward: to a
// named specialty (optionally a specific provider) or for an in-person visit. The
// referral is a record tied to the consult, authored by the provider clinician, and
// readable by the consult's participants (reusing the TM-006 access gate). It
// carries where it is routed (type + specialty/target) so a downstream booker can
// act on it (follow-up scheduling is TM-008).

const (
	ReferralSpecialty = "SPECIALTY"
	ReferralInPerson  = "IN_PERSON"
)

var (
	// ErrInvalidReferralType — referral type must be SPECIALTY or IN_PERSON.
	ErrInvalidReferralType = errors.New("consult: referral type must be SPECIALTY or IN_PERSON")
	// ErrReferralReasonRequired — a referral must carry a clinical reason.
	ErrReferralReasonRequired = errors.New("consult: a referral reason is required")
	// ErrReferralTargetRequired — a specialty referral must name a specialty or a
	// specific target provider so it can be routed.
	ErrReferralTargetRequired = errors.New("consult: a specialty referral must name a specialty or target provider")
)

// ReferralInput is a clinician's onward-referral request.
type ReferralInput struct {
	Type             string  // SPECIALTY | IN_PERSON
	Specialty        string  // e.g. "Cardiology" — required for a SPECIALTY referral (unless a target provider is named)
	TargetProviderID *string // optional specific provider to route to
	Reason           string  // clinical reason for the referral
}

// Referral is a consult-generated onward referral.
type Referral struct {
	ID               string    `json:"id"`
	ConsultID        string    `json:"consult_id"`
	PatientID        string    `json:"patient_id"`
	ReferredBy       string    `json:"referred_by"`
	Type             string    `json:"referral_type"`
	Specialty        string    `json:"specialty,omitempty"`
	TargetProviderID *string   `json:"target_provider_id,omitempty"`
	Reason           string    `json:"reason"`
	CreatedAt        time.Time `json:"created_at"`
}

// validReferralType reports whether t is a recognised referral type.
func validReferralType(t string) bool {
	return t == ReferralSpecialty || t == ReferralInPerson
}

// validateReferral checks a referral is well-formed and routable (pure): a valid
// type, a clinical reason, and — for a specialty referral — either a named specialty
// or a specific target provider so it has somewhere to route.
func validateReferral(in ReferralInput) error {
	if !validReferralType(in.Type) {
		return ErrInvalidReferralType
	}
	if strings.TrimSpace(in.Reason) == "" {
		return ErrReferralReasonRequired
	}
	if in.Type == ReferralSpecialty && strings.TrimSpace(in.Specialty) == "" && in.TargetProviderID == nil {
		return ErrReferralTargetRequired
	}
	return nil
}

// CreateReferral records an onward referral generated from a consult (TM-007). Only
// the provider clinician (the consult's provider owner) may issue a referral. The
// input is validated (type/reason/routable) before any write.
func (s *Service) CreateReferral(ctx context.Context, providerOwnerID, consultID string, in ReferralInput) (*Referral, error) {
	if err := validateReferral(in); err != nil {
		return nil, err
	}
	c, providerOwner, err := s.load(ctx, consultID)
	if err != nil {
		return nil, err
	}
	if providerOwnerID != providerOwner {
		return nil, fmt.Errorf("consult: only the provider may issue a referral")
	}
	r := &Referral{
		ID:               uuid.New().String(),
		ConsultID:        consultID,
		PatientID:        c.PatientID,
		ReferredBy:       providerOwnerID,
		Type:             in.Type,
		Specialty:        strings.TrimSpace(in.Specialty),
		TargetProviderID: in.TargetProviderID,
		Reason:           in.Reason,
		CreatedAt:        time.Now(),
	}
	const ins = `INSERT INTO health_consult_referrals
	               (id, consult_id, patient_id, referred_by, referral_type, specialty, target_provider_id, reason)
	             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`
	if _, err := s.db.Exec(ctx, ins, r.ID, consultID, c.PatientID, providerOwnerID, r.Type, r.Specialty, r.TargetProviderID, r.Reason); err != nil {
		return nil, fmt.Errorf("consult: insert referral: %w", err)
	}
	s.audited(providerOwnerID, c.PatientID, "health.consult.referral.create", r.ID,
		nil, map[string]any{"consult_id": consultID, "type": r.Type})
	return r, nil
}

// Referrals returns a consult's referrals, participant-gated (TM-006): only the
// patient, the provider owner, or an admin may read.
func (s *Service) Referrals(ctx context.Context, requesterID, consultID string, isAdmin bool) ([]Referral, error) {
	c, providerOwner, err := s.load(ctx, consultID)
	if err != nil {
		return nil, err
	}
	if !authorizeConsultAccess(requesterID, c.PatientID, providerOwner, isAdmin) {
		return nil, fmt.Errorf("consult: forbidden")
	}
	const q = `SELECT id, consult_id, patient_id, referred_by, referral_type, specialty, target_provider_id, reason, created_at
	           FROM health_consult_referrals WHERE consult_id=$1 ORDER BY created_at ASC`
	rows, err := s.db.Query(ctx, q, consultID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Referral
	for rows.Next() {
		var r Referral
		if err := rows.Scan(&r.ID, &r.ConsultID, &r.PatientID, &r.ReferredBy, &r.Type, &r.Specialty, &r.TargetProviderID, &r.Reason, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
