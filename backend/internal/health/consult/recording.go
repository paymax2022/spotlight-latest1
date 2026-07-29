package healthconsult

import (
	"context"
	"errors"
	"fmt"
)

// TM-003 — consult recording requires consent.
//
// A tele-consult may only be recorded with explicit consent. Recording captures the
// patient's PHI (their face, voice, disclosed history), so the conservative,
// fail-closed rule is TWO-PARTY consent: recording cannot be enabled until BOTH the
// patient and the provider clinician have consented, and if either party withdraws,
// recording is turned off immediately. `recording_enabled` starts false and can only
// become true through this gate.

var (
	// ErrRecordingConsentMissing — recording was requested without consent from both
	// the patient and the provider (TM-003). Fail-closed: recording stays off.
	ErrRecordingConsentMissing = errors.New("consult: recording requires consent from both the patient and the provider (TM-003)")
	// ErrConsultRecordingClosed — recording consent cannot change once the consult is
	// completed (the session is over).
	ErrConsultRecordingClosed = errors.New("consult: recording consent cannot change on a completed consult")
)

// recordingConsentComplete reports whether BOTH required parties — the patient and
// the provider clinician — appear in the set of user ids that have consented to
// recording. Fail-closed: empty party ids, or either party absent, means not
// complete (recording must not be enabled).
func recordingConsentComplete(consentedUserIDs []string, patientID, providerOwnerID string) bool {
	if patientID == "" || providerOwnerID == "" {
		return false
	}
	var patient, provider bool
	for _, id := range consentedUserIDs {
		if id == patientID {
			patient = true
		}
		if id == providerOwnerID {
			provider = true
		}
	}
	return patient && provider
}

// RecordRecordingConsent records one participant's consent to recording the consult
// (TM-003). Only a participant — the patient or the provider owner — may consent, and
// only while the consult is not yet completed. Consent is idempotent per participant.
func (s *Service) RecordRecordingConsent(ctx context.Context, actorID, consultID string) error {
	c, providerOwner, err := s.load(ctx, consultID)
	if err != nil {
		return err
	}
	role := ""
	switch actorID {
	case c.PatientID:
		role = "PATIENT"
	case providerOwner:
		role = "PROVIDER"
	default:
		return fmt.Errorf("consult: forbidden")
	}
	if c.State == StateCompleted {
		return ErrConsultRecordingClosed
	}
	const ins = `INSERT INTO health_consult_recording_consents (id, consult_id, user_id, role)
	             VALUES (gen_random_uuid(),$1,$2,$3)
	             ON CONFLICT (consult_id, user_id) DO UPDATE SET consented_at=now()`
	if _, err := s.db.Exec(ctx, ins, consultID, actorID, role); err != nil {
		return fmt.Errorf("consult: record recording consent: %w", err)
	}
	s.audited(actorID, c.PatientID, "health.consult.recording.consent", consultID, nil, map[string]any{"role": role})
	return nil
}

// EnableRecording turns recording on for a consult — but ONLY when both the patient
// and the provider have consented (TM-003). The provider clinician (who runs the
// session) performs the enable; the gate is the two-party consent check, evaluated
// fail-closed against the durable consent rows. Missing consent blocks with
// ErrRecordingConsentMissing and recording stays off.
func (s *Service) EnableRecording(ctx context.Context, providerOwnerID, consultID string) (*Consult, error) {
	c, providerOwner, err := s.load(ctx, consultID)
	if err != nil {
		return nil, err
	}
	if providerOwnerID != providerOwner {
		return nil, fmt.Errorf("consult: forbidden")
	}
	if c.State == StateCompleted {
		return nil, ErrConsultRecordingClosed
	}
	consented, err := s.recordingConsentUserIDs(ctx, consultID)
	if err != nil {
		return nil, err
	}
	if !recordingConsentComplete(consented, c.PatientID, providerOwner) {
		return nil, ErrRecordingConsentMissing
	}
	if _, err := s.db.Exec(ctx, `UPDATE health_consults SET recording_enabled=true, updated_at=now() WHERE id=$1`, consultID); err != nil {
		return nil, fmt.Errorf("consult: enable recording: %w", err)
	}
	s.audited(providerOwnerID, c.PatientID, "health.consult.recording.enable", consultID,
		map[string]any{"recording_enabled": false}, map[string]any{"recording_enabled": true})
	c.RecordingEnabled = true
	return c, nil
}

// WithdrawRecordingConsent lets a participant withdraw consent to recording. Because
// two-party consent is required, withdrawing one party's consent turns recording OFF
// immediately (TM-003 — recording must stop the moment consent lapses).
func (s *Service) WithdrawRecordingConsent(ctx context.Context, actorID, consultID string) error {
	c, providerOwner, err := s.load(ctx, consultID)
	if err != nil {
		return err
	}
	if actorID != c.PatientID && actorID != providerOwner {
		return fmt.Errorf("consult: forbidden")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("consult: begin: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM health_consult_recording_consents WHERE consult_id=$1 AND user_id=$2`, consultID, actorID); err != nil {
		return fmt.Errorf("consult: withdraw recording consent: %w", err)
	}
	// Consent is no longer unanimous → recording must stop.
	if _, err := tx.Exec(ctx, `UPDATE health_consults SET recording_enabled=false, updated_at=now() WHERE id=$1`, consultID); err != nil {
		return fmt.Errorf("consult: stop recording: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("consult: commit: %w", err)
	}
	s.audited(actorID, c.PatientID, "health.consult.recording.withdraw", consultID,
		map[string]any{"recording_enabled": true}, map[string]any{"recording_enabled": false})
	return nil
}

// recordingConsentUserIDs returns the user ids that have consented to recording the
// consult — the set the two-party gate is evaluated against.
func (s *Service) recordingConsentUserIDs(ctx context.Context, consultID string) ([]string, error) {
	rows, err := s.db.Query(ctx, `SELECT user_id FROM health_consult_recording_consents WHERE consult_id=$1`, consultID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
