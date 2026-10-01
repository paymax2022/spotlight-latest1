// Package estate — service_extras.go — secondary service surfaces: the notification taxonomy +
// fan-out (Block 43/37), per-member settings & account (Block 45), background
// maintenance jobs (Block 47) and the system-issued visitor-pass bridge.
package estate

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Block 43 estate notification taxonomy + Block 37 push delivery.
// Each estate event emits a notification that is (a) persisted to estate_notifications
// for the in-app feed and (b) enqueued for push via the platform notifications queue
// (the Notifier adapter resolves the recipient's device push tokens). Delivery is
// fire-and-forget: a notification failure never fails the underlying operation
// (mirrors the project's email policy).

// The 18 estate notification types (Block 43).
const (
	NotifVisitorArrived           = "visitor_arrived"
	NotifVisitorDenied            = "visitor_denied"
	NotifVisitorOverstayed        = "visitor_overstayed"
	NotifPaymentDue               = "payment_due"
	NotifPaymentOverdue           = "payment_overdue"
	NotifRestrictionApplied       = "restriction_applied"
	NotifRestrictionLifted        = "restriction_lifted"
	NotifMeetingReminder          = "meeting_reminder"
	NotifTaskAssigned             = "task_assigned"
	NotifTaskOverdue              = "task_overdue"
	NotifRepairUpdate             = "repair_update"
	NotifVendorAssigned           = "vendor_assigned"
	NotifElectionReminder         = "election_reminder"
	NotifElectionResult           = "election_result"
	NotifAnnouncement             = "announcement"
	NotifEmergencyAlert           = "emergency_alert"
	NotifFacilityBookingConfirmed = "facility_booking_confirmed"
	NotifAdminApprovalRequired    = "admin_approval_required"
)

// EstateNotificationTypes is the full taxonomy (used for validation/tests).
var EstateNotificationTypes = []string{
	NotifVisitorArrived, NotifVisitorDenied, NotifVisitorOverstayed,
	NotifPaymentDue, NotifPaymentOverdue, NotifRestrictionApplied, NotifRestrictionLifted,
	NotifMeetingReminder, NotifTaskAssigned, NotifTaskOverdue, NotifRepairUpdate,
	NotifVendorAssigned, NotifElectionReminder, NotifElectionResult, NotifAnnouncement,
	NotifEmergencyAlert, NotifFacilityBookingConfirmed, NotifAdminApprovalRequired,
}

// EstateNotification is the payload handed to the Notifier for push delivery.
type EstateNotification struct {
	EstateID string
	UserID   string
	Type     string
	Title    string
	Body     string
	DeepLink string
	Data     map[string]any
}

// Notifier dispatches an estate notification for push delivery. Kept as a narrow
// interface so the estate package stays decoupled from the platform notifications
// queue; the wiring layer adapts it (resolving device push tokens and enqueuing).
type Notifier interface {
	Notify(ctx context.Context, n EstateNotification) error
}

// NotifierFunc adapts a plain function to the Notifier interface.
type NotifierFunc func(ctx context.Context, n EstateNotification) error

func (f NotifierFunc) Notify(ctx context.Context, n EstateNotification) error { return f(ctx, n) }

// WithNotifier wires the push notifier. When unset, notifications are still
// persisted to the in-app feed; only push delivery is skipped.
func (s *Service) WithNotifier(n Notifier) *Service {
	s.notifier = n
	return s
}

// notifCategory maps a notification type to the estate_notifications.category
// CHECK domain (general|payment|meeting|election|security|maintenance|facility|
// announcement|system). Pure (no DB) for unit testing.
func notifCategory(notifType string) string {
	switch notifType {
	case NotifPaymentDue, NotifPaymentOverdue, NotifRestrictionApplied, NotifRestrictionLifted:
		return "payment"
	case NotifMeetingReminder:
		return "meeting"
	case NotifElectionReminder, NotifElectionResult:
		return "election"
	case NotifVisitorArrived, NotifVisitorDenied, NotifVisitorOverstayed, NotifEmergencyAlert:
		return "security"
	case NotifRepairUpdate, NotifVendorAssigned:
		return "maintenance"
	case NotifFacilityBookingConfirmed:
		return "facility"
	case NotifAnnouncement:
		return "announcement"
	case NotifAdminApprovalRequired:
		return "system"
	default: // task_assigned, task_overdue, and any future type
		return "general"
	}
}

// notifDeepLink returns the mobile route a notification should open. Pure.
func notifDeepLink(notifType string) string {
	switch notifCategory(notifType) {
	case "payment":
		return "/dues"
	case "meeting":
		return "/meetings"
	case "election":
		return "/election"
	case "security":
		return "/emergencies"
	case "maintenance":
		return "/repairs"
	case "facility":
		return "/facilities"
	case "announcement":
		return "/announcements"
	default:
		return "/estate-notifications"
	}
}

// notify persists one in-app notification and enqueues a push to the recipient.
// Fire-and-forget: errors are swallowed so a notification failure never breaks
// the calling operation.
func (s *Service) notify(ctx context.Context, estateID, userID, notifType, title, body string, data map[string]any) {
	if userID == "" {
		return
	}
	deepLink := notifDeepLink(notifType)
	_, _ = s.db.Exec(ctx,
		`INSERT INTO estate_notifications (id, estate_id, user_id, category, title, body, deep_link)
		 VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6)`,
		estateID, userID, notifCategory(notifType), title, body, deepLink)
	if s.notifier != nil {
		_ = s.notifier.Notify(ctx, EstateNotification{
			EstateID: estateID, UserID: userID, Type: notifType,
			Title: title, Body: body, DeepLink: deepLink, Data: data,
		})
	}
}

// notifyMembers fans a notification out to estate members. When roles is empty
// every member is targeted; otherwise only members with one of the given roles
// (e.g. estate_admin, estate_security). Fire-and-forget.
func (s *Service) notifyMembers(ctx context.Context, estateID, notifType, title, body string, data map[string]any, roles ...string) {
	q := `SELECT user_id FROM estate_residents WHERE estate_id=$1`
	args := []any{estateID}
	if len(roles) > 0 {
		q += ` AND role = ANY($2)`
		args = append(args, roles)
	}
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return
	}
	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	for _, id := range ids {
		s.notify(ctx, estateID, id, notifType, title, body, data)
	}
}

// Block 45 settings & account: per-member notification/privacy/
// security preferences and account soft-delete (PII anonymisation).
// Password changes are intentionally NOT handled here: auth is Supabase-managed,
// so the client calls the auth provider directly (supabase.auth.updateUser).

// MemberSettings is a resident's per-estate preferences.
type MemberSettings struct {
	EstateID            string    `json:"estate_id"`
	UserID              string    `json:"user_id"`
	PushEnabled         bool      `json:"push_enabled"`
	EmailEnabled        bool      `json:"email_enabled"`
	NotifyPayments      bool      `json:"notify_payments"`
	NotifyMeetings      bool      `json:"notify_meetings"`
	NotifyElections     bool      `json:"notify_elections"`
	NotifySecurity      bool      `json:"notify_security"`
	NotifyMaintenance   bool      `json:"notify_maintenance"`
	NotifyAnnouncements bool      `json:"notify_announcements"`
	PrivacyShowUnit     bool      `json:"privacy_show_unit"`
	PrivacyShowVehicle  bool      `json:"privacy_show_vehicle"`
	PrivacyShowProfile  bool      `json:"privacy_show_profile"`
	BiometricEnabled    bool      `json:"biometric_enabled"`
	TwoFactorEnabled    bool      `json:"two_factor_enabled"`
	DefaultVisitorHours int       `json:"default_visitor_hours"`
	DefaultCodeType     string    `json:"default_code_type"`
	Language            string    `json:"language"`
	UpdatedAt           time.Time `json:"updated_at"`
}

// UpdateMemberSettingsRequest is a partial update — only non-nil fields apply.
type UpdateMemberSettingsRequest struct {
	PushEnabled         *bool   `json:"push_enabled"`
	EmailEnabled        *bool   `json:"email_enabled"`
	NotifyPayments      *bool   `json:"notify_payments"`
	NotifyMeetings      *bool   `json:"notify_meetings"`
	NotifyElections     *bool   `json:"notify_elections"`
	NotifySecurity      *bool   `json:"notify_security"`
	NotifyMaintenance   *bool   `json:"notify_maintenance"`
	NotifyAnnouncements *bool   `json:"notify_announcements"`
	PrivacyShowUnit     *bool   `json:"privacy_show_unit"`
	PrivacyShowVehicle  *bool   `json:"privacy_show_vehicle"`
	PrivacyShowProfile  *bool   `json:"privacy_show_profile"`
	BiometricEnabled    *bool   `json:"biometric_enabled"`
	TwoFactorEnabled    *bool   `json:"two_factor_enabled"`
	DefaultVisitorHours *int    `json:"default_visitor_hours"`
	DefaultCodeType     *string `json:"default_code_type"`
	Language            *string `json:"language"`
}

const settingsCols = `estate_id, user_id, push_enabled, email_enabled, notify_payments, notify_meetings,
	notify_elections, notify_security, notify_maintenance, notify_announcements,
	privacy_show_unit, privacy_show_vehicle, privacy_show_profile, biometric_enabled,
	two_factor_enabled, default_visitor_hours, default_code_type, COALESCE(language,'en'), updated_at`

func scanSettings(row interface{ Scan(...any) error }) (*MemberSettings, error) {
	var m MemberSettings
	if err := row.Scan(&m.EstateID, &m.UserID, &m.PushEnabled, &m.EmailEnabled, &m.NotifyPayments,
		&m.NotifyMeetings, &m.NotifyElections, &m.NotifySecurity, &m.NotifyMaintenance, &m.NotifyAnnouncements,
		&m.PrivacyShowUnit, &m.PrivacyShowVehicle, &m.PrivacyShowProfile, &m.BiometricEnabled,
		&m.TwoFactorEnabled, &m.DefaultVisitorHours, &m.DefaultCodeType, &m.Language, &m.UpdatedAt); err != nil {
		return nil, err
	}
	return &m, nil
}

// GetMemberSettings returns the caller's settings, creating a default row if none
// exists (members only).
func (s *Service) GetMemberSettings(ctx context.Context, estateID, userID string) (*MemberSettings, error) {
	if err := s.assertResident(ctx, estateID, userID); err != nil {
		return nil, err
	}
	if _, err := s.db.Exec(ctx,
		`INSERT INTO estate_member_settings (estate_id, user_id) VALUES ($1,$2) ON CONFLICT (estate_id, user_id) DO NOTHING`,
		estateID, userID); err != nil {
		return nil, fmt.Errorf("estate: ensure settings: %w", err)
	}
	row := s.db.QueryRow(ctx, `SELECT `+settingsCols+` FROM estate_member_settings WHERE estate_id=$1 AND user_id=$2`, estateID, userID)
	return scanSettings(row)
}

// UpdateMemberSettings applies a partial update and returns the merged row.
func (s *Service) UpdateMemberSettings(ctx context.Context, estateID, userID string, req UpdateMemberSettingsRequest) (*MemberSettings, error) {
	if _, err := s.GetMemberSettings(ctx, estateID, userID); err != nil { // ensures row + membership
		return nil, err
	}
	const q = `
		UPDATE estate_member_settings SET
			push_enabled         = COALESCE($3,  push_enabled),
			email_enabled        = COALESCE($4,  email_enabled),
			notify_payments      = COALESCE($5,  notify_payments),
			notify_meetings      = COALESCE($6,  notify_meetings),
			notify_elections     = COALESCE($7,  notify_elections),
			notify_security      = COALESCE($8,  notify_security),
			notify_maintenance   = COALESCE($9,  notify_maintenance),
			notify_announcements = COALESCE($10, notify_announcements),
			privacy_show_unit    = COALESCE($11, privacy_show_unit),
			privacy_show_vehicle = COALESCE($12, privacy_show_vehicle),
			privacy_show_profile = COALESCE($13, privacy_show_profile),
			biometric_enabled    = COALESCE($14, biometric_enabled),
			two_factor_enabled   = COALESCE($15, two_factor_enabled),
			default_visitor_hours= COALESCE($16, default_visitor_hours),
			default_code_type    = COALESCE($17, default_code_type),
			language             = COALESCE($18, language),
			updated_at           = NOW()
		WHERE estate_id=$1 AND user_id=$2
		RETURNING ` + settingsCols
	row := s.db.QueryRow(ctx, q, estateID, userID,
		req.PushEnabled, req.EmailEnabled, req.NotifyPayments, req.NotifyMeetings, req.NotifyElections,
		req.NotifySecurity, req.NotifyMaintenance, req.NotifyAnnouncements, req.PrivacyShowUnit,
		req.PrivacyShowVehicle, req.PrivacyShowProfile, req.BiometricEnabled, req.TwoFactorEnabled,
		req.DefaultVisitorHours, req.DefaultCodeType, req.Language)
	return scanSettings(row)
}

// SoftDeleteAccount anonymises the caller's PII within the estate and marks the
// membership deleted. Membership history is retained (soft delete); personal data
// is scrubbed. Audited.
func (s *Service) SoftDeleteAccount(ctx context.Context, estateID, userID string) error {
	resID, err := s.getResidentID(ctx, estateID, userID)
	if err != nil {
		return err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Scrub the extended profile (no-op if none exists).
	if _, err := tx.Exec(ctx, `
		UPDATE resident_profiles SET
			bio='', profile_photo_url='', phone='', alt_phone='',
			emergency_contact='{}'::jsonb, next_of_kin='{}'::jsonb,
			agreement_url='', ownership_doc_url='', visibility='admin_only', updated_at=NOW()
		WHERE resident_id=$1`, resID); err != nil {
		return fmt.Errorf("estate: scrub profile: %w", err)
	}
	// Remove dependent PII records.
	for _, t := range []string{"household_members", "domestic_staff", "resident_vehicles"} {
		if _, err := tx.Exec(ctx, `DELETE FROM `+t+` WHERE resident_id=$1`, resID); err != nil {
			return fmt.Errorf("estate: scrub %s: %w", t, err)
		}
	}
	// Mark membership soft-deleted.
	if _, err := tx.Exec(ctx, `UPDATE estate_residents SET deleted_at=NOW() WHERE id=$1`, resID); err != nil {
		return fmt.Errorf("estate: mark deleted: %w", err)
	}
	if err := s.auditTx(ctx, tx, estateID, userID, "ACCOUNT_SOFT_DELETE", "resident", resID, nil); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Block 47 background maintenance jobs. Each job is idempotent and can
// be run repeatedly (by a scheduler or admin trigger) without double-effect:
//   - MarkOverdueInvoices:      pending dues past due_date → 'overdue'
//   - AutoApplyOverdueRestrictions: residents with overdue dues get a soft
//                                   restriction (skipped if already restricted)
//   - ExpireAccessCodes:        active visitor codes past valid_until → 'expired'
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
// This is the seam the realtor module calls when a booking for a unit that sits
// inside a managed estate is confirmed: it reuses the same visitor_passes storage
// and QR semantics as IssueVisitorPass so guard scan/check-in works unchanged, but
// it skips the resident assertion (the guest has no estate membership) and records
// the estate admin as issued_by (a valid auth.users id, satisfying the FK). An
// audit event is written so the cross-module issuance is traceable.
// Returns ErrEstateNotFound semantics via a wrapped error if the estate has no
// admin (cannot attribute issuance); callers should treat that as "skip".
func (s *Service) IssueSystemVisitorPass(ctx context.Context, req SystemPassRequest) (*VisitorPass, error) {
	if req.EstateID == "" {
		return nil, errors.New("estate: system pass requires estate_id")
	}
	if req.ValidUntil.Before(req.ValidFrom) {
		return nil, errors.New("estate: valid_until must be after valid_from")
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
