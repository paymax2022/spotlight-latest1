package estate

import (
	"context"
	"fmt"
	"strings"
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

const propertyCols = `id, estate_id, unit_label, property_type, COALESCE(floor,''), COALESCE(block,''), occupancy_status, landlord_id, tenant_id, archived, capacity, created_at`

func scanProperty(row interface {
	Scan(dest ...any) error
}) (*EstateProperty, error) {
	var p EstateProperty
	if err := row.Scan(&p.ID, &p.EstateID, &p.UnitLabel, &p.PropertyType, &p.Floor, &p.Block,
		&p.OccupancyStatus, &p.LandlordID, &p.TenantID, &p.Archived, &p.Capacity, &p.CreatedAt); err != nil {
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
		return nil, ErrUnitNotFound
	}
	return p, nil
}

// UpdateProperty applies a partial update to a property (estate admin only).
func (s *Service) UpdateProperty(ctx context.Context, estateID, adminID, propertyID string, req UpdatePropertyRequest) (*EstateProperty, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	// The column carries a CHECK, so an out-of-domain type would otherwise reach the caller as a
	// database violation instead of as the caller's mistake (ESTA-D032).
	if req.PropertyType != nil {
		trimmed := strings.TrimSpace(*req.PropertyType)
		if !PropertyTypes[trimmed] {
			return nil, ErrInvalidPropertyType
		}
		req.PropertyType = &trimmed
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
		return nil, ErrUnitNotFound
	}
	_ = s.audit(ctx, estateID, adminID, "PROPERTY_UPDATE", "property", propertyID, nil)
	return p, nil
}

// AssignLandlord records a member as this unit's owner (estate admin only).
func (s *Service) AssignLandlord(ctx context.Context, estateID, adminID, propertyID, landlordUserID string) (*EstateProperty, error) {
	return s.assignOccupancy(ctx, estateID, adminID, propertyID, landlordUserID, OccupancyHomeowner)
}

// AssignTenant records a member as this unit's tenant (estate admin only).
func (s *Service) AssignTenant(ctx context.Context, estateID, adminID, propertyID, tenantUserID string) (*EstateProperty, error) {
	return s.assignOccupancy(ctx, estateID, adminID, propertyID, tenantUserID, OccupancyTenant)
}

// assignOccupancy is the admin's direct assignment path. It used to be a single UPDATE of one UUID
// column, which is exactly how a unit could read 'occupied' with nobody admitted, how a second owner
// could be written over the first with no record of the change, and how the two party columns could
// disagree with the residency that gates what the person may do. Every assignment now goes through
// estate_occupancy_admit(), so capacity, the one-owner/one-tenant overlap, the archived-unit rule and
// the "membership must still be active" rule are the same ones a tenancy approval passes.
func (s *Service) assignOccupancy(ctx context.Context, estateID, adminID, propertyID, userID, kind string) (*EstateProperty, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	if strings.TrimSpace(userID) == "" {
		return nil, ErrInvalidOccupantUser
	}
	if _, err := s.AdmitOccupant(ctx, estateID, adminID, propertyID, AdmitOccupantRequest{
		UserID: userID, OccupancyType: kind,
	}); err != nil {
		return nil, err
	}
	row := s.db.QueryRow(ctx, `SELECT `+propertyCols+` FROM estate_properties WHERE id=$1 AND estate_id=$2`,
		propertyID, estateID)
	p, err := scanProperty(row)
	if err != nil {
		return nil, ErrUnitNotFound
	}
	return p, nil
}

// SetOccupancyStatus sets a property's occupancy status (estate admin only). The register outranks the
// flag: an admin cannot declare a unit vacant while people are still recorded in it, because every
// billing and access rule that reads 'vacant' would then start exempting a populated unit.
func (s *Service) SetOccupancyStatus(ctx context.Context, estateID, adminID, propertyID, status string) (*EstateProperty, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	if !validOccupancyStatus(status) {
		return nil, fmt.Errorf("%w: %q", ErrInvalidOccupancyStatus, status)
	}
	if status != "occupied" {
		var live int
		if err := s.db.QueryRow(ctx,
			`SELECT COUNT(*) FROM estate_unit_occupants WHERE property_id=$1 AND estate_id=$2 AND ended_at IS NULL`,
			propertyID, estateID).Scan(&live); err != nil {
			return nil, fmt.Errorf("estate: count occupants: %w", err)
		}
		if live > 0 {
			return nil, fmt.Errorf("%w: %d recorded", ErrUnitHasLiveOccupants, live)
		}
	}
	row := s.db.QueryRow(ctx,
		`UPDATE estate_properties SET occupancy_status=$3 WHERE id=$1 AND estate_id=$2 RETURNING `+propertyCols,
		propertyID, estateID, status)
	p, err := scanProperty(row)
	if err != nil {
		return nil, ErrUnitNotFound
	}
	_ = s.audit(ctx, estateID, adminID, "PROPERTY_OCCUPANCY", "property", propertyID, map[string]any{keyStatus: status})
	return p, nil
}

// ArchiveProperty soft-retires a property (estate admin only). History is kept.
// Dependency gate (EST-UAT-0052): a unit with an occupant or an open dues
// invoice cannot be archived — archiving would orphan the liability.
func (s *Service) ArchiveProperty(ctx context.Context, estateID, adminID, propertyID string) error {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return err
	}
	var occupancy string
	var tenantID, landlordID *string
	if err := s.db.QueryRow(ctx,
		`SELECT occupancy_status, tenant_id::TEXT, landlord_id::TEXT FROM estate_properties WHERE id=$1 AND estate_id=$2 AND archived=FALSE`,
		propertyID, estateID,
	).Scan(&occupancy, &tenantID, &landlordID); err != nil {
		return ErrUnitNotFound
	}
	// The register is the authoritative count from Phase 2.4 on; the flag and the two party columns are
	// still read because a unit recorded before the registry existed has no rows to count, and an
	// owner-on-the-deed with nobody renting is still a unit somebody owns.
	var live int
	if err := s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM estate_unit_occupants WHERE property_id=$1 AND estate_id=$2 AND ended_at IS NULL`,
		propertyID, estateID).Scan(&live); err != nil {
		return fmt.Errorf("estate: check property occupants: %w", err)
	}
	if live > 0 || occupancy == "occupied" || tenantID != nil {
		return fmt.Errorf("%w: %d recorded — end every occupancy first", ErrUnitHasLiveOccupants, live)
	}
	if landlordID != nil {
		return ErrUnitHasDeedOwner
	}
	var openInvoices int
	if err := s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM estate_dues_invoices WHERE property_id=$1 AND estate_id=$2 AND status IN ('pending','overdue')`,
		propertyID, estateID,
	).Scan(&openInvoices); err != nil {
		return fmt.Errorf("estate: check property liabilities: %w", err)
	}
	if openInvoices > 0 {
		return fmt.Errorf("%w: %d pending or overdue", ErrUnitHasOpenInvoices, openInvoices)
	}
	ct, err := s.db.Exec(ctx, `UPDATE estate_properties SET archived=TRUE WHERE id=$1 AND estate_id=$2`, propertyID, estateID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrUnitNotFound
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
		return nil, fmt.Errorf("%w: %q", ErrInvalidTransferType, body.TransferType)
	}
	// Property must belong to this estate.
	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM estate_properties WHERE id=$1 AND estate_id=$2)`, propertyID, estateID).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrUnitNotFound
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
//
// Approval used to write the destination user straight into the unit's landlord_id/tenant_id column and
// stop there: no occupancy registration, so the new owner was invisible to the capacity count, the
// resident card still called them a resident, and the person they displaced kept a live registration on
// a unit they no longer own. Approval now admits through the same writer every other occupancy change
// uses, ending the displaced party's registration first where the transfer is a tenancy (an ownership
// displacement is what the writer's replace-owner flag is for).
func (s *Service) ReviewPropertyTransfer(ctx context.Context, estateID, adminID, requestID, decision string) (*PropertyTransferRequest, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	if !validTransferDecision(decision) {
		return nil, ErrInvalidReviewDecision
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var r PropertyTransferRequest
	const load = `SELECT id, estate_id, property_id, requested_by, to_user_id, transfer_type, COALESCE(reason,''), status
		FROM property_transfer_requests WHERE id=$1 AND estate_id=$2 FOR UPDATE`
	if err := tx.QueryRow(ctx, load, requestID, estateID).Scan(
		&r.ID, &r.EstateID, &r.PropertyID, &r.RequestedBy, &r.ToUserID, &r.TransferType, &r.Reason, &r.Status,
	); err != nil {
		return nil, ErrPropertyTransferNotFound
	}
	if r.Status != "pending" {
		return nil, fmt.Errorf("%w: %s", ErrTransferAlreadyReviewed, r.Status)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE property_transfer_requests SET status=$1, reviewed_by=$2, reviewed_at=NOW() WHERE id=$3`,
		decision, adminID, requestID,
	); err != nil {
		return nil, err
	}
	if decision == "approved" {
		kind := OccupancyTenant
		if r.TransferType == "ownership" {
			kind = OccupancyHomeowner
		}
		if kind == OccupancyTenant {
			// One current tenant per unit is the overlap rule (EST-UAT-0044), so the person being
			// transferred out has to be released before the incoming one can be admitted. Through the
			// releasing writer rather than an UPDATE, so the history survives and the unit's status is
			// recomputed by the same code every other move-out uses.
			var previous *string
			if err := tx.QueryRow(ctx,
				`SELECT tenant_id FROM estate_properties WHERE id=$1 AND estate_id=$2`, r.PropertyID, estateID,
			).Scan(&previous); err != nil {
				return nil, fmt.Errorf("estate: read current tenant: %w", err)
			}
			if previous != nil && *previous != "" && *previous != r.ToUserID {
				if _, err := releaseOccupancy(ctx, tx, occupancyRelease{
					estateID: estateID, propertyID: r.PropertyID, userID: *previous,
					actorID: adminID, reason: "tenancy transferred to another resident",
				}); err != nil {
					return nil, err
				}
			}
		}
		if _, err := admitOccupancy(ctx, tx, occupancyAdmission{
			estateID: estateID, propertyID: r.PropertyID, userID: r.ToUserID,
			actorID: adminID, kind: kind,
			note:         "transfer request " + r.ID,
			replaceOwner: kind == OccupancyHomeowner,
		}); err != nil {
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
	s.notify(ctx, estateID, r.RequestedBy, NotifAdminApprovalRequired, "Property transfer "+decision,
		"Your property transfer request was "+decision+".", map[string]any{"request_id": requestID})
	if decision == "approved" {
		s.notify(ctx, estateID, r.ToUserID, NotifEstateOccupancyAdmitted, "A unit has been transferred to you",
			"Your occupancy of this unit is now on record.", map[string]any{"property_id": r.PropertyID})
	}
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
		return nil, ErrUnitNotFound
	}
	return a, nil
}
