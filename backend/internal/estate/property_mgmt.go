package estate

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// property_mgmt.go — Block 29 estate property management: detail, update,
// landlord/tenant assignment, occupancy, archive, transfer requests, analytics.

// validOccupancyStatus reports whether s is a permitted occupancy status. Pure.
func validOccupancyStatus(s string) bool {
	switch s {
	case "vacant", "occupied", "reserved":
		return true
	default:
		return false
	}
}

// validTransferType reports whether t is a permitted transfer type. Pure.
func validTransferType(t string) bool { return t == "ownership" || t == "tenancy" }

// validTransferDecision reports whether d is a permitted review decision. Pure.
func validTransferDecision(d string) bool { return d == "approved" || d == "rejected" }

const propertyCols = `id, estate_id, unit_label, property_type, COALESCE(floor,''), COALESCE(block,''), occupancy_status, landlord_id, tenant_id, archived, created_at`

func scanProperty(row interface {
	Scan(dest ...any) error
}) (*EstateProperty, error) {
	var p EstateProperty
	if err := row.Scan(&p.ID, &p.EstateID, &p.UnitLabel, &p.PropertyType, &p.Floor, &p.Block,
		&p.OccupancyStatus, &p.LandlordID, &p.TenantID, &p.Archived, &p.CreatedAt); err != nil {
		return nil, err
	}
	return &p, nil
}

// GetProperty returns a single property, scoped to the estate (members only).
func (s *Service) GetProperty(ctx context.Context, estateID, memberID, propertyID string) (*EstateProperty, error) {
	if err := s.assertResident(ctx, estateID, memberID); err != nil {
		return nil, err
	}
	row := s.db.QueryRow(ctx, `SELECT `+propertyCols+` FROM estate_properties WHERE id=$1 AND estate_id=$2`, propertyID, estateID)
	p, err := scanProperty(row)
	if err != nil {
		return nil, fmt.Errorf("estate: property not found in this estate")
	}
	return p, nil
}

// UpdateProperty applies a partial update to a property (estate admin only).
func (s *Service) UpdateProperty(ctx context.Context, estateID, adminID, propertyID string, req UpdatePropertyRequest) (*EstateProperty, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	const q = `
		UPDATE estate_properties SET
			unit_label    = COALESCE($3, unit_label),
			property_type = COALESCE($4, property_type),
			floor         = COALESCE($5, floor),
			block         = COALESCE($6, block)
		WHERE id=$1 AND estate_id=$2
		RETURNING ` + propertyCols
	row := s.db.QueryRow(ctx, q, propertyID, estateID, req.UnitLabel, req.PropertyType, req.Floor, req.Block)
	p, err := scanProperty(row)
	if err != nil {
		return nil, fmt.Errorf("estate: property not found in this estate")
	}
	_ = s.audit(ctx, estateID, adminID, "PROPERTY_UPDATE", "property", propertyID, nil)
	return p, nil
}

// AssignLandlord sets a property's landlord (estate admin only).
func (s *Service) AssignLandlord(ctx context.Context, estateID, adminID, propertyID, landlordUserID string) (*EstateProperty, error) {
	return s.assignParty(ctx, estateID, adminID, propertyID, "landlord_id", landlordUserID, "")
}

// AssignTenant sets a property's tenant and marks it occupied (estate admin only).
func (s *Service) AssignTenant(ctx context.Context, estateID, adminID, propertyID, tenantUserID string) (*EstateProperty, error) {
	return s.assignParty(ctx, estateID, adminID, propertyID, "tenant_id", tenantUserID, "occupied")
}

// assignParty sets landlord_id or tenant_id (column is a trusted internal literal,
// never user input), optionally forcing an occupancy status.
func (s *Service) assignParty(ctx context.Context, estateID, adminID, propertyID, column, userID, forceOccupancy string) (*EstateProperty, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	if userID == "" {
		return nil, fmt.Errorf("estate: user id is required")
	}
	q := `UPDATE estate_properties SET ` + column + `=$3`
	if forceOccupancy != "" {
		q += `, occupancy_status='` + forceOccupancy + `'`
	}
	q += ` WHERE id=$1 AND estate_id=$2 RETURNING ` + propertyCols
	row := s.db.QueryRow(ctx, q, propertyID, estateID, userID)
	p, err := scanProperty(row)
	if err != nil {
		return nil, fmt.Errorf("estate: property not found in this estate")
	}
	_ = s.audit(ctx, estateID, adminID, "PROPERTY_ASSIGN", "property", propertyID, map[string]any{"column": column, "user_id": userID})
	return p, nil
}

// SetOccupancyStatus sets a property's occupancy status (estate admin only).
func (s *Service) SetOccupancyStatus(ctx context.Context, estateID, adminID, propertyID, status string) (*EstateProperty, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	if !validOccupancyStatus(status) {
		return nil, fmt.Errorf("estate: invalid occupancy status %q", status)
	}
	row := s.db.QueryRow(ctx,
		`UPDATE estate_properties SET occupancy_status=$3 WHERE id=$1 AND estate_id=$2 RETURNING `+propertyCols,
		propertyID, estateID, status)
	p, err := scanProperty(row)
	if err != nil {
		return nil, fmt.Errorf("estate: property not found in this estate")
	}
	_ = s.audit(ctx, estateID, adminID, "PROPERTY_OCCUPANCY", "property", propertyID, map[string]any{"status": status})
	return p, nil
}

// ArchiveProperty soft-retires a property (estate admin only). History is kept.
func (s *Service) ArchiveProperty(ctx context.Context, estateID, adminID, propertyID string) error {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return err
	}
	ct, err := s.db.Exec(ctx, `UPDATE estate_properties SET archived=TRUE WHERE id=$1 AND estate_id=$2`, propertyID, estateID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("estate: property not found in this estate")
	}
	_ = s.audit(ctx, estateID, adminID, "PROPERTY_ARCHIVE", "property", propertyID, nil)
	return nil
}

// RequestPropertyTransfer files a request to change a property's owner/tenant
// (any estate member may file; an admin reviews it).
func (s *Service) RequestPropertyTransfer(ctx context.Context, estateID, requesterID, propertyID string, body RequestPropertyTransferBody) (*PropertyTransferRequest, error) {
	if err := s.assertResident(ctx, estateID, requesterID); err != nil {
		return nil, err
	}
	if !validTransferType(body.TransferType) {
		return nil, fmt.Errorf("estate: invalid transfer type %q", body.TransferType)
	}
	// Property must belong to this estate.
	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM estate_properties WHERE id=$1 AND estate_id=$2)`, propertyID, estateID).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, fmt.Errorf("estate: property not found in this estate")
	}
	r := &PropertyTransferRequest{
		ID: uuid.New().String(), EstateID: estateID, PropertyID: propertyID,
		RequestedBy: requesterID, ToUserID: body.ToUserID, TransferType: body.TransferType,
		Reason: body.Reason, Status: "pending", CreatedAt: time.Now(),
	}
	const q = `INSERT INTO property_transfer_requests (id, estate_id, property_id, requested_by, to_user_id, transfer_type, reason, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')`
	if _, err := s.db.Exec(ctx, q, r.ID, estateID, propertyID, requesterID, body.ToUserID, body.TransferType, body.Reason); err != nil {
		return nil, fmt.Errorf("estate: insert transfer request: %w", err)
	}
	_ = s.audit(ctx, estateID, requesterID, "PROPERTY_TRANSFER_REQUEST", "property", propertyID, map[string]any{"to": body.ToUserID, "type": body.TransferType})
	// Notify admins that an approval is required (Block 43).
	s.notifyMembers(ctx, estateID, NotifAdminApprovalRequired, "Property transfer request",
		"A property transfer request needs review.", map[string]any{"request_id": r.ID, "property_id": propertyID}, "estate_admin")
	return r, nil
}

// ListTransferRequests returns transfer requests for the estate (admin only).
func (s *Service) ListTransferRequests(ctx context.Context, estateID, adminID, status string) ([]PropertyTransferRequest, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	q := `SELECT id, estate_id, property_id, requested_by, to_user_id, transfer_type, COALESCE(reason,''), status, reviewed_by, reviewed_at, created_at
		FROM property_transfer_requests WHERE estate_id=$1`
	args := []any{estateID}
	if status != "" {
		q += " AND status=$2"
		args = append(args, status)
	}
	q += " ORDER BY created_at DESC LIMIT 200"
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PropertyTransferRequest
	for rows.Next() {
		var r PropertyTransferRequest
		if err := rows.Scan(&r.ID, &r.EstateID, &r.PropertyID, &r.RequestedBy, &r.ToUserID, &r.TransferType, &r.Reason, &r.Status, &r.ReviewedBy, &r.ReviewedAt, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ReviewPropertyTransfer approves/rejects a transfer request (estate admin only).
// On approval the property's landlord (ownership) or tenant (tenancy) is updated
// in the same transaction.
func (s *Service) ReviewPropertyTransfer(ctx context.Context, estateID, adminID, requestID, decision string) (*PropertyTransferRequest, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	if !validTransferDecision(decision) {
		return nil, fmt.Errorf("estate: invalid decision %q", decision)
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var r PropertyTransferRequest
	const load = `SELECT id, estate_id, property_id, requested_by, to_user_id, transfer_type, COALESCE(reason,''), status
		FROM property_transfer_requests WHERE id=$1 AND estate_id=$2 FOR UPDATE`
	if err := tx.QueryRow(ctx, load, requestID, estateID).Scan(
		&r.ID, &r.EstateID, &r.PropertyID, &r.RequestedBy, &r.ToUserID, &r.TransferType, &r.Reason, &r.Status,
	); err != nil {
		return nil, fmt.Errorf("estate: transfer request not found in this estate")
	}
	if r.Status != "pending" {
		return nil, fmt.Errorf("estate: transfer request already %s", r.Status)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE property_transfer_requests SET status=$1, reviewed_by=$2, reviewed_at=NOW() WHERE id=$3`,
		decision, adminID, requestID,
	); err != nil {
		return nil, err
	}
	if decision == "approved" {
		col := "tenant_id"
		if r.TransferType == "ownership" {
			col = "landlord_id"
		}
		if _, err := tx.Exec(ctx,
			`UPDATE estate_properties SET `+col+`=$1 WHERE id=$2 AND estate_id=$3`,
			r.ToUserID, r.PropertyID, estateID,
		); err != nil {
			return nil, err
		}
	}
	if err := s.auditTx(ctx, tx, estateID, adminID, "PROPERTY_TRANSFER_REVIEW", "property", r.PropertyID, map[string]any{"request_id": requestID, "decision": decision}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	r.Status = decision
	r.ReviewedBy = &adminID
	// Notify the requester of the outcome.
	s.notify(ctx, estateID, r.RequestedBy, NotifAdminApprovalRequired, "Property transfer "+decision,
		"Your property transfer request was "+decision+".", map[string]any{"request_id": requestID})
	return &r, nil
}

// GetPropertyAnalytics returns a per-property summary (estate admin only).
func (s *Service) GetPropertyAnalytics(ctx context.Context, estateID, adminID, propertyID string) (*PropertyAnalytics, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	a := &PropertyAnalytics{PropertyID: propertyID}
	const q = `
SELECT
  COALESCE((SELECT occupancy_status FROM estate_properties WHERE id=$1 AND estate_id=$2),''),
  (SELECT COUNT(*) FROM estate_repair_requests WHERE property_id=$1 AND status NOT IN ('completed','cancelled')),
  (SELECT COUNT(*) FROM estate_repair_requests WHERE property_id=$1),
  COALESCE((SELECT SUM(amount_kobo) FROM estate_dues_invoices WHERE property_id=$1),0),
  COALESCE((SELECT SUM(amount_kobo) FROM estate_dues_invoices WHERE property_id=$1 AND status='paid'),0),
  COALESCE((SELECT SUM(amount_kobo) FROM estate_dues_invoices WHERE property_id=$1 AND status IN ('pending','overdue')),0),
  (SELECT COUNT(*) FROM property_transfer_requests WHERE property_id=$1 AND status='pending')`
	if err := s.db.QueryRow(ctx, q, propertyID, estateID).Scan(
		&a.OccupancyStatus, &a.OpenRepairs, &a.TotalRepairs,
		&a.InvoicedKobo, &a.CollectedKobo, &a.OutstandingKobo, &a.OpenTransferReqs,
	); err != nil {
		return nil, fmt.Errorf("estate: property analytics: %w", err)
	}
	if a.OccupancyStatus == "" {
		return nil, fmt.Errorf("estate: property not found in this estate")
	}
	return a, nil
}
