package estate

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// admin.go — Block 41 admin panel & configuration: dashboard, resident
// management (ban/restore), estate rules + subscription config, and audit-log read.

// AdminDashboard is the at-a-glance operator summary.
type AdminDashboard struct {
	EstateID            string `json:"estate_id"`
	Residents           int    `json:"residents"`
	BannedResidents     int    `json:"banned_residents"`
	OpenRepairs         int    `json:"open_repairs"`
	OpenIncidents       int    `json:"open_incidents"`
	Defaulters          int    `json:"defaulters"`
	OutstandingDuesKobo int64  `json:"outstanding_dues_kobo"`
	VerifiedVendors     int    `json:"verified_vendors"`
	PendingTransfers    int    `json:"pending_transfers"`
}

// AdminResident is a resident row for the admin list.
type AdminResident struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Unit      string    `json:"unit"`
	Role      string    `json:"role"`
	Banned    bool      `json:"banned"`
	Deleted   bool      `json:"deleted"`
	CreatedAt time.Time `json:"created_at"`
}

// EstateConfig holds estate-wide rules + subscription plan.
type EstateConfig struct {
	EstateID         string          `json:"estate_id"`
	Rules            json.RawMessage `json:"rules"`
	SubscriptionPlan json.RawMessage `json:"subscription_plan"`
	UpdatedAt        *time.Time      `json:"updated_at,omitempty"`
}

// AuditEntry is one immutable audit-log row.
type AuditEntry struct {
	ID          string          `json:"id"`
	ActorID     *string         `json:"actor_id,omitempty"`
	Action      string          `json:"action"`
	SubjectType string          `json:"subject_type,omitempty"`
	SubjectID   string          `json:"subject_id,omitempty"`
	Metadata    json.RawMessage `json:"metadata,omitempty"`
	CreatedAt   time.Time       `json:"created_at"`
}

// GetAdminDashboard returns operator KPIs in one round-trip (estate admin only).
func (s *Service) GetAdminDashboard(ctx context.Context, estateID, adminID string) (*AdminDashboard, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	d := &AdminDashboard{EstateID: estateID}
	const q = `
SELECT
  (SELECT count(*) FROM estate_residents WHERE estate_id=$1 AND deleted_at IS NULL),
  (SELECT count(*) FROM estate_residents WHERE estate_id=$1 AND banned_at IS NOT NULL),
  (SELECT count(*) FROM estate_repair_requests WHERE estate_id=$1 AND status NOT IN ('completed','cancelled')),
  (SELECT count(*) FROM estate_emergency_alerts WHERE estate_id=$1 AND status <> 'resolved'),
  (SELECT count(DISTINCT resident_id) FROM estate_dues_invoices WHERE estate_id=$1 AND status IN ('pending','overdue')),
  (SELECT COALESCE(sum(amount_kobo),0) FROM estate_dues_invoices WHERE estate_id=$1 AND status IN ('pending','overdue')),
  (SELECT count(*) FROM estate_vendors WHERE estate_id=$1 AND status='verified'),
  (SELECT count(*) FROM property_transfer_requests WHERE estate_id=$1 AND status='pending')`
	if err := s.db.QueryRow(ctx, q, estateID).Scan(
		&d.Residents, &d.BannedResidents, &d.OpenRepairs, &d.OpenIncidents,
		&d.Defaulters, &d.OutstandingDuesKobo, &d.VerifiedVendors, &d.PendingTransfers,
	); err != nil {
		return nil, fmt.Errorf("estate: admin dashboard: %w", err)
	}
	return d, nil
}

// ListResidents returns the estate's residents (estate admin only).
func (s *Service) ListResidents(ctx context.Context, estateID, adminID, role string) ([]AdminResident, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	q := `SELECT id, user_id, COALESCE(unit,''), role, banned_at IS NOT NULL, deleted_at IS NOT NULL, created_at
		FROM estate_residents WHERE estate_id=$1`
	args := []any{estateID}
	if role != "" {
		q += " AND role=$2"
		args = append(args, role)
	}
	q += " ORDER BY created_at DESC LIMIT 500"
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AdminResident
	for rows.Next() {
		var r AdminResident
		if err := rows.Scan(&r.ID, &r.UserID, &r.Unit, &r.Role, &r.Banned, &r.Deleted, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// BanResident bars a resident from the estate (estate admin only).
func (s *Service) BanResident(ctx context.Context, estateID, adminID, targetUserID, reason string) error {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return err
	}
	if targetUserID == adminID {
		return fmt.Errorf("estate: cannot ban yourself")
	}
	ct, err := s.db.Exec(ctx,
		`UPDATE estate_residents SET banned_at=NOW(), ban_reason=$3 WHERE estate_id=$1 AND user_id=$2 AND deleted_at IS NULL`,
		estateID, targetUserID, reason)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("estate: resident not found in this estate")
	}
	_ = s.audit(ctx, estateID, adminID, "RESIDENT_BAN", "resident", targetUserID, map[string]any{"reason": reason})
	s.notify(ctx, estateID, targetUserID, NotifAdminApprovalRequired, "Account banned",
		"Your access to this estate has been suspended by an administrator.", map[string]any{"reason": reason})
	return nil
}

// RestoreResident lifts a resident's ban (estate admin only).
func (s *Service) RestoreResident(ctx context.Context, estateID, adminID, targetUserID string) error {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return err
	}
	ct, err := s.db.Exec(ctx,
		`UPDATE estate_residents SET banned_at=NULL, ban_reason=NULL WHERE estate_id=$1 AND user_id=$2`,
		estateID, targetUserID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("estate: resident not found in this estate")
	}
	_ = s.audit(ctx, estateID, adminID, "RESIDENT_RESTORE", "resident", targetUserID, nil)
	s.notify(ctx, estateID, targetUserID, NotifAdminApprovalRequired, "Access restored",
		"Your access to this estate has been restored.", nil)
	return nil
}

// SetEstateRules upserts the estate's rules config (estate admin only).
func (s *Service) SetEstateRules(ctx context.Context, estateID, adminID string, rules json.RawMessage) (*EstateConfig, error) {
	return s.upsertConfig(ctx, estateID, adminID, "rules", rules)
}

// ConfigureSubscriptionPlan upserts the estate's subscription plan (admin only).
func (s *Service) ConfigureSubscriptionPlan(ctx context.Context, estateID, adminID string, plan json.RawMessage) (*EstateConfig, error) {
	return s.upsertConfig(ctx, estateID, adminID, "subscription_plan", plan)
}

func (s *Service) upsertConfig(ctx context.Context, estateID, adminID, col string, val json.RawMessage) (*EstateConfig, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	if len(val) == 0 {
		val = json.RawMessage("{}")
	}
	// col is a trusted internal literal ("rules" | "subscription_plan").
	q := `INSERT INTO estate_config (estate_id, ` + col + `, updated_by) VALUES ($1,$2,$3)
		ON CONFLICT (estate_id) DO UPDATE SET ` + col + `=EXCLUDED.` + col + `, updated_by=EXCLUDED.updated_by, updated_at=NOW()`
	if _, err := s.db.Exec(ctx, q, estateID, val, adminID); err != nil {
		return nil, fmt.Errorf("estate: set %s: %w", col, err)
	}
	_ = s.audit(ctx, estateID, adminID, "ESTATE_CONFIG_SET", "config", col, nil)
	return s.GetEstateConfig(ctx, estateID, adminID)
}

// GetEstateConfig returns the estate's rules + subscription plan (admin only).
func (s *Service) GetEstateConfig(ctx context.Context, estateID, adminID string) (*EstateConfig, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	cfg := &EstateConfig{EstateID: estateID, Rules: json.RawMessage("{}"), SubscriptionPlan: json.RawMessage("{}")}
	const q = `SELECT rules, subscription_plan, updated_at FROM estate_config WHERE estate_id=$1`
	err := s.db.QueryRow(ctx, q, estateID).Scan(&cfg.Rules, &cfg.SubscriptionPlan, &cfg.UpdatedAt)
	if err == pgx.ErrNoRows {
		return cfg, nil
	}
	if err != nil {
		return nil, err
	}
	return cfg, nil
}

// GetAuditLog returns recent audit entries for the estate (estate admin only).
func (s *Service) GetAuditLog(ctx context.Context, estateID, adminID string, limit, offset int) ([]AuditEntry, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	const q = `SELECT id, actor_id, action, COALESCE(subject_type,''), COALESCE(subject_id,''), metadata, created_at
		FROM estate_audit_log WHERE estate_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`
	rows, err := s.db.Query(ctx, q, estateID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AuditEntry
	for rows.Next() {
		var e AuditEntry
		if err := rows.Scan(&e.ID, &e.ActorID, &e.Action, &e.SubjectType, &e.SubjectID, &e.Metadata, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
