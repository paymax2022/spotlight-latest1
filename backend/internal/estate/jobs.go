package estate

import (
	"context"
	"fmt"
)

// jobs.go — Block 47 background maintenance jobs. Each job is idempotent and can
// be run repeatedly (by a scheduler or admin trigger) without double-effect:
//
//   - MarkOverdueInvoices:      pending dues past due_date → 'overdue'
//   - AutoApplyOverdueRestrictions: residents with overdue dues get a soft
//                                   restriction (skipped if already restricted)
//   - ExpireAccessCodes:        active visitor codes past valid_until → 'expired'
//
// RunEstateMaintenance runs all three for one estate (admin-triggered);
// RunMaintenanceAllEstates runs them platform-wide (scheduler entry point).

// MarkOverdueInvoices flips pending, past-due invoices to 'overdue'. Returns the
// number updated. estateID == "" applies platform-wide.
func (s *Service) MarkOverdueInvoices(ctx context.Context, estateID string) (int64, error) {
	q := `UPDATE estate_dues_invoices SET status='overdue' WHERE status='pending' AND due_date < NOW()`
	args := []any{}
	if estateID != "" {
		q += ` AND estate_id=$1`
		args = append(args, estateID)
	}
	ct, err := s.db.Exec(ctx, q, args...)
	if err != nil {
		return 0, fmt.Errorf("estate: mark overdue: %w", err)
	}
	return ct.RowsAffected(), nil
}

// AutoApplyOverdueRestrictions applies a soft dues restriction to every resident
// with at least one overdue invoice who is not already actively restricted.
// Idempotent via the (estate_id, resident_id) WHERE active partial unique index.
func (s *Service) AutoApplyOverdueRestrictions(ctx context.Context, estateID string) (int64, error) {
	q := `
		INSERT INTO estate_dues_restrictions (id, estate_id, resident_id, level, reason, active, applied_by)
		SELECT gen_random_uuid(), i.estate_id, i.resident_id, 'soft', 'auto: overdue dues', TRUE, NULL
		FROM (SELECT DISTINCT estate_id, resident_id FROM estate_dues_invoices WHERE status='overdue'`
	args := []any{}
	if estateID != "" {
		q += ` AND estate_id=$1`
		args = append(args, estateID)
	}
	q += `) i
		ON CONFLICT (estate_id, resident_id) WHERE active DO NOTHING`
	ct, err := s.db.Exec(ctx, q, args...)
	if err != nil {
		return 0, fmt.Errorf("estate: auto-restrict: %w", err)
	}
	return ct.RowsAffected(), nil
}

// ExpireAccessCodes marks active visitor codes whose window has closed 'expired'.
func (s *Service) ExpireAccessCodes(ctx context.Context, estateID string) (int64, error) {
	q := `UPDATE visitor_access_codes SET status='expired' WHERE status='active' AND valid_until < NOW()`
	args := []any{}
	if estateID != "" {
		q += ` AND estate_id=$1`
		args = append(args, estateID)
	}
	ct, err := s.db.Exec(ctx, q, args...)
	if err != nil {
		return 0, fmt.Errorf("estate: expire codes: %w", err)
	}
	return ct.RowsAffected(), nil
}

// runMaintenance executes all jobs for the given scope ("" = platform-wide).
func (s *Service) runMaintenance(ctx context.Context, estateID string) (map[string]int64, error) {
	out := map[string]int64{}
	n, err := s.MarkOverdueInvoices(ctx, estateID)
	if err != nil {
		return out, err
	}
	out["invoices_marked_overdue"] = n
	n, err = s.AutoApplyOverdueRestrictions(ctx, estateID)
	if err != nil {
		return out, err
	}
	out["restrictions_applied"] = n
	n, err = s.ExpireAccessCodes(ctx, estateID)
	if err != nil {
		return out, err
	}
	out["access_codes_expired"] = n
	return out, nil
}

// RunEstateMaintenance runs the maintenance jobs for one estate (estate admin
// only) and returns per-job counts.
func (s *Service) RunEstateMaintenance(ctx context.Context, estateID, adminID string) (map[string]int64, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	res, err := s.runMaintenance(ctx, estateID)
	if err != nil {
		return nil, err
	}
	_ = s.audit(ctx, estateID, adminID, "MAINTENANCE_RUN", "estate", estateID, map[string]any{
		"invoices_marked_overdue": res["invoices_marked_overdue"],
		"restrictions_applied":    res["restrictions_applied"],
		"access_codes_expired":    res["access_codes_expired"],
	})
	return res, nil
}

// RunMaintenanceAllEstates runs the maintenance jobs platform-wide. Intended as
// the entry point for a scheduled worker (e.g. hourly). No auth — call only from
// trusted server-side schedulers.
func (s *Service) RunMaintenanceAllEstates(ctx context.Context) (map[string]int64, error) {
	return s.runMaintenance(ctx, "")
}
