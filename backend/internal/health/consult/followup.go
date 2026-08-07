package healthconsult

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// TM-008 — schedule a follow-up from a consult.
//
// During or after a consult the clinician can schedule a follow-up: a NEW consult
// linked back to the one it follows (parent_consult_id), optionally fulfilling a
// referral generated on that consult (TM-007). The link is what makes it a
// "follow-up" rather than an unrelated booking, so a patient's care thread can be
// followed end to end.

// ErrFollowUpTooEarly — a follow-up can only be scheduled once the originating
// consult is under way or done (IN_PROGRESS / COMPLETED), not before it starts.
var ErrFollowUpTooEarly = errors.New("consult: a follow-up can only be scheduled from an in-progress or completed consult")

// ErrReferralNotOnConsult — the referral named for a follow-up does not belong to
// the parent consult, so it cannot be the reason for this follow-up.
var ErrReferralNotOnConsult = errors.New("consult: referral does not belong to this consult")

// FollowUpInput are the optional links for a follow-up consult.
type FollowUpInput struct {
	ReferralID    *string // optional: the referral (from the parent consult) this follow-up fulfils
	AppointmentID *string // optional: a booked appointment slot for the follow-up
}

// canScheduleFollowUp reports whether a follow-up may be scheduled from a consult in
// the given state — only once the consult is under way or done. Pure/deterministic.
func canScheduleFollowUp(parentState State) bool {
	return parentState == StateInProgress || parentState == StateCompleted
}

// ScheduleFollowUp creates a new SCHEDULED consult linked to parentConsultID (TM-008),
// carrying the same patient + provider. Only the provider clinician may schedule it,
// and only once the parent consult is under way / completed. If a referral is named
// it must belong to the parent consult.
func (s *Service) ScheduleFollowUp(ctx context.Context, providerOwnerID, parentConsultID string, in FollowUpInput) (*Consult, error) {
	parent, providerOwner, err := s.load(ctx, parentConsultID)
	if err != nil {
		return nil, err
	}
	if providerOwnerID != providerOwner {
		return nil, fmt.Errorf("consult: only the provider may schedule a follow-up")
	}
	if !canScheduleFollowUp(parent.State) {
		return nil, ErrFollowUpTooEarly
	}
	if in.ReferralID != nil {
		var belongs bool
		if err := s.db.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM health_consult_referrals WHERE id=$1 AND consult_id=$2)`,
			*in.ReferralID, parentConsultID).Scan(&belongs); err != nil {
			return nil, fmt.Errorf("consult: check referral: %w", err)
		}
		if !belongs {
			return nil, ErrReferralNotOnConsult
		}
	}

	fu := &Consult{
		ID:              uuid.New().String(),
		AppointmentID:   in.AppointmentID,
		ProviderID:      parent.ProviderID,
		PatientID:       parent.PatientID,
		State:           StateScheduled,
		ParentConsultID: &parentConsultID,
		ReferralID:      in.ReferralID,
		CreatedAt:       time.Now(),
	}
	const ins = `INSERT INTO health_consults
	               (id, appointment_id, provider_id, patient_id, state, recording_enabled, parent_consult_id, referral_id)
	             VALUES ($1,$2,$3,$4,'SCHEDULED',false,$5,$6)`
	if _, err := s.db.Exec(ctx, ins, fu.ID, in.AppointmentID, parent.ProviderID, parent.PatientID, parentConsultID, in.ReferralID); err != nil {
		return nil, fmt.Errorf("consult: insert follow-up: %w", err)
	}
	s.audited(providerOwnerID, parent.PatientID, "health.consult.followup.schedule", fu.ID,
		nil, map[string]any{"parent_consult_id": parentConsultID})
	return fu, nil
}
