package estate

import (
	"context"
	"fmt"
	"time"
)

// settings.go — Block 45 settings & account: per-member notification/privacy/
// security preferences and account soft-delete (PII anonymisation).
//
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
