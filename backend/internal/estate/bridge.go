package estate

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// SystemPassRequest is the input for IssueSystemVisitorPass. It carries the guest
// details and the validity window of an externally-originated stay (e.g. a realtor
// shortlet/hotel booking confirmation). Unlike IssueVisitorPass it does NOT require
// the caller to be an estate resident — issuance is performed on behalf of the
// system, attributed to the estate's own admin as the issuer of record.
type SystemPassRequest struct {
	EstateID    string
	VisitorName string
	Purpose     string
	ValidFrom   time.Time
	ValidUntil  time.Time
	// Source identifies the originating flow for the audit trail, e.g.
	// "realtor.shortlet". SourceRef is the originating entity id (booking id).
	Source    string
	SourceRef string
}

// IssueSystemVisitorPass issues a visitor pass for a guest who is NOT a resident,
// on behalf of the platform (the stay→gate-pass bridge — cross-cutting flow #4).
//
// This is the seam the realtor module calls when a booking for a unit that sits
// inside a managed estate is confirmed: it reuses the same visitor_passes storage
// and QR semantics as IssueVisitorPass so guard scan/check-in works unchanged, but
// it skips the resident assertion (the guest has no estate membership) and records
// the estate admin as issued_by (a valid auth.users id, satisfying the FK). An
// audit event is written so the cross-module issuance is traceable.
//
// Returns ErrEstateNotFound semantics via a wrapped error if the estate has no
// admin (cannot attribute issuance); callers should treat that as "skip".
func (s *Service) IssueSystemVisitorPass(ctx context.Context, req SystemPassRequest) (*VisitorPass, error) {
	if req.EstateID == "" {
		return nil, fmt.Errorf("estate: system pass requires estate_id")
	}
	if req.ValidUntil.Before(req.ValidFrom) {
		return nil, fmt.Errorf("estate: valid_until must be after valid_from")
	}
	if req.VisitorName == "" {
		req.VisitorName = "Guest"
	}

	// Attribute issuance to the estate's admin (a real auth.users id) so the
	// issued_by FK holds and the pass is visible in the estate's issued list.
	var adminID string
	if err := s.db.QueryRow(ctx, `SELECT admin_id FROM estates WHERE id=$1`, req.EstateID).Scan(&adminID); err != nil {
		return nil, fmt.Errorf("estate: resolve admin for system pass: %w", err)
	}

	p := &VisitorPass{
		ID:          uuid.New().String(),
		EstateID:    req.EstateID,
		IssuedBy:    adminID,
		VisitorName: req.VisitorName,
		Purpose:     req.Purpose,
		QRCode:      uuid.New().String(),
		ValidFrom:   req.ValidFrom,
		ValidUntil:  req.ValidUntil,
		Status:      "active",
		CreatedAt:   time.Now(),
	}
	const q = `
		INSERT INTO visitor_passes (id, estate_id, issued_by, visitor_name, purpose, qr_code, valid_from, valid_until, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')`
	if _, err := s.db.Exec(ctx, q, p.ID, p.EstateID, p.IssuedBy, p.VisitorName, p.Purpose, p.QRCode, p.ValidFrom, p.ValidUntil); err != nil {
		return nil, fmt.Errorf("estate: insert system pass: %w", err)
	}

	// Best-effort audit (non-fatal): the pass is already persisted.
	_ = s.audit(ctx, req.EstateID, adminID, "visitor_pass.system_issued", "visitor_pass", p.ID, map[string]any{
		"source":     req.Source,
		"source_ref": req.SourceRef,
		"visitor":    req.VisitorName,
	})

	return p, nil
}

// GetVisitorPass returns a single visitor pass by id, scoped to an estate. Used by
// the realtor stays gate-pass read endpoint to return the auto-issued pass.
func (s *Service) GetVisitorPass(ctx context.Context, estateID, passID string) (*VisitorPass, error) {
	const q = `
		SELECT id, estate_id, issued_by, visitor_name, COALESCE(purpose,''), qr_code::TEXT,
		       valid_from, valid_until, used_at, status, created_at
		FROM visitor_passes WHERE id=$1 AND estate_id=$2`
	p := &VisitorPass{}
	if err := s.db.QueryRow(ctx, q, passID, estateID).Scan(
		&p.ID, &p.EstateID, &p.IssuedBy, &p.VisitorName, &p.Purpose, &p.QRCode,
		&p.ValidFrom, &p.ValidUntil, &p.UsedAt, &p.Status, &p.CreatedAt,
	); err != nil {
		return nil, err
	}
	return p, nil
}
