package healthconsult

import (
	"context"
	"fmt"
	"strings"
)

// TM-006 — only participants may read a consult's clinical notes.
//
// Notes contain the patient's PHI. Reading them back must be gated to the consult's
// participants — the patient and the provider clinician — plus an admin (break-glass
// / support), and no one else. The gate is fail-closed: an empty/unknown requester
// is denied, never defaulted through.

// authorizeConsultAccess reports whether requesterID may read a consult's notes:
// the patient, the provider owner (clinician), or an admin. Fail-closed — an empty
// requester is always denied (never a silent pass), mirroring the lab order-access
// gate.
func authorizeConsultAccess(requesterID, patientID, providerOwnerID string, isAdmin bool) bool {
	if strings.TrimSpace(requesterID) == "" {
		return false
	}
	if isAdmin {
		return true
	}
	return requesterID == patientID || (providerOwnerID != "" && requesterID == providerOwnerID)
}

// Notes returns a consult's clinical notes, participant-gated (TM-006). Only the
// patient, the provider owner, or an admin may read; anyone else is forbidden. The
// notes are append-only + immutable at the DB level (TM-005).
func (s *Service) Notes(ctx context.Context, requesterID, consultID string, isAdmin bool) ([]ClinicalNote, error) {
	c, providerOwner, err := s.load(ctx, consultID)
	if err != nil {
		return nil, err
	}
	if !authorizeConsultAccess(requesterID, c.PatientID, providerOwner, isAdmin) {
		return nil, fmt.Errorf("consult: forbidden")
	}
	return s.loadNotes(ctx, consultID)
}

// loadNotes reads the consult's clinical notes in chronological order.
func (s *Service) loadNotes(ctx context.Context, consultID string) ([]ClinicalNote, error) {
	const q = `SELECT id, consult_id, author_id, subjective, objective, assessment, plan, created_at
	           FROM health_clinical_notes WHERE consult_id=$1 ORDER BY created_at ASC`
	rows, err := s.db.Query(ctx, q, consultID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ClinicalNote
	for rows.Next() {
		var n ClinicalNote
		if err := rows.Scan(&n.ID, &n.ConsultID, &n.AuthorID, &n.Subjective, &n.Objective, &n.Assessment, &n.Plan, &n.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}
