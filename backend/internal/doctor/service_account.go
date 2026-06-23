package doctor

import (
	"context"
	"encoding/json"
	"errors"
)

// service_account.go — Wave 2 (account / provider / admin) business logic.
//
// Mirrors the MVP service style: reads delegate straight to the repository scoped
// to the authenticated doctor; mutations that target a table with a UNIQUE
// idempotency_key require the Idempotency-Key header (ErrIdempotencyRequired) and
// rely on the repository's ON CONFLICT replay. None of these touch the money
// ledger — they are account/provider/admin records, not value movements.

// ErrNotEligible is returned when a profile cannot be published (verification not
// approved) or a provider gate fails. Mapped to HTTP 403 by the handler.
var ErrNotEligible = errors.New("doctor: provider not eligible for this action")

// ── Onboarding ───────────────────────────────────────────────────────────────

func (s *Service) ListConsents(ctx context.Context, userID string) ([]LegalConsent, error) {
	return s.repo.ListConsents(ctx, userID)
}

func (s *Service) AcceptConsent(ctx context.Context, userID string, req AcceptConsentRequest) (*LegalConsent, error) {
	return s.repo.UpsertConsent(ctx, userID, req)
}

func (s *Service) ListPermissions(ctx context.Context, userID string) ([]AppPermission, error) {
	return s.repo.ListPermissions(ctx, userID)
}

func (s *Service) RecordPermission(ctx context.Context, userID string, req RecordPermissionRequest) (*AppPermission, error) {
	return s.repo.UpsertPermission(ctx, userID, req)
}

func (s *Service) GetMerchantUpgrade(ctx context.Context, userID string) (*MerchantUpgrade, error) {
	return s.repo.GetMerchantUpgrade(ctx, userID)
}

func (s *Service) RequestMerchantUpgrade(ctx context.Context, userID, idemKey string, detail json.RawMessage) (*MerchantUpgrade, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.InsertMerchantUpgrade(ctx, userID, idemKey, detail)
}

// SetProviderType patch-merges the chosen provider type into the profile draft.
// (The canonical provider_type column flips at publish; the wizard records intent here.)
func (s *Service) SetProviderType(ctx context.Context, userID, idemKey string, req SetProviderTypeRequest) (*Profile, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	patch, _ := json.Marshal(map[string]any{"providerType": req.ProviderType})
	return s.repo.SaveProfileDraft(ctx, userID, patch)
}

// ── Profile builder ──────────────────────────────────────────────────────────

func (s *Service) GetProfileDraft(ctx context.Context, userID string) (*Profile, error) {
	return s.repo.GetProfileDraft(ctx, userID)
}

func (s *Service) SaveProfileDraft(ctx context.Context, userID, idemKey string, patch json.RawMessage) (*Profile, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.SaveProfileDraft(ctx, userID, patch)
}

func (s *Service) ListProfileDocuments(ctx context.Context, userID string) ([]VerificationDocument, error) {
	return s.repo.ListVerificationDocuments(ctx, userID)
}

func (s *Service) PublishProfile(ctx context.Context, userID, idemKey string) (*Profile, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.PublishProfile(ctx, userID)
}

// GetLicenceExpiry derives an expiry/renewal warning from the latest verification.
func (s *Service) GetLicenceExpiry(ctx context.Context, userID string) (*Verification, error) {
	return s.repo.GetLatestVerification(ctx, userID)
}

// RenewLicence re-enters verification by submitting a fresh 'renewal' verification.
func (s *Service) RenewLicence(ctx context.Context, userID, idemKey string, req SubmitVerificationRequest) (*Verification, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	if req.Kind == "" {
		req.Kind = "renewal"
	}
	return s.repo.InsertVerification(ctx, userID, req)
}

// ── Notifications ────────────────────────────────────────────────────────────

func (s *Service) ListNotificationGroups(ctx context.Context, userID string) ([]NotificationGroup, error) {
	return s.repo.ListNotificationGroups(ctx, userID)
}

func (s *Service) ListNotificationPreferences(ctx context.Context, userID string) ([]NotificationPreference, error) {
	return s.repo.ListNotificationPreferences(ctx, userID)
}

func (s *Service) UpdateNotificationPreference(ctx context.Context, userID, idemKey string, req UpdateNotificationPreferenceRequest) (*NotificationPreference, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.UpsertNotificationPreference(ctx, userID, req)
}

func (s *Service) MarkAllNotificationsRead(ctx context.Context, userID string) (int64, error) {
	return s.repo.MarkAllNotificationsRead(ctx, userID)
}

// ── Support ──────────────────────────────────────────────────────────────────

func (s *Service) ListSupportTickets(ctx context.Context, userID string) ([]SupportTicket, error) {
	return s.repo.ListSupportTickets(ctx, userID)
}

func (s *Service) CreateSupportTicket(ctx context.Context, userID, idemKey string, req CreateSupportTicketRequest) (*SupportTicket, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.InsertSupportTicket(ctx, userID, idemKey, req)
}

func (s *Service) ListSupportDisputes(ctx context.Context, userID string) ([]SupportDispute, error) {
	return s.repo.ListSupportDisputes(ctx, userID)
}

func (s *Service) GetSupportDispute(ctx context.Context, userID, id string) (*SupportDispute, error) {
	return s.repo.GetSupportDispute(ctx, userID, id)
}

func (s *Service) CreateSupportDispute(ctx context.Context, userID, idemKey string, req CreateDisputeRequest) (*SupportDispute, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.InsertSupportDispute(ctx, userID, idemKey, req)
}

func (s *Service) AddDisputeEvidence(ctx context.Context, userID, disputeID, idemKey string, req AddEvidenceRequest) (*SupportDispute, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.AppendDisputeEvidence(ctx, userID, disputeID, req.Evidence)
}

func (s *Service) ListSupportMessages(ctx context.Context, userID, threadID string) ([]SupportMessage, error) {
	return s.repo.ListSupportMessages(ctx, userID, threadID)
}

func (s *Service) SendSupportMessage(ctx context.Context, userID, threadID, idemKey string, req SendSupportMessageRequest) (*SupportMessage, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.InsertSupportMessage(ctx, userID, threadID, idemKey, req)
}

// ── Compliance ───────────────────────────────────────────────────────────────

func (s *Service) ListAuditTrail(ctx context.Context, userID string) ([]AuditEntry, error) {
	return s.repo.ListAuditTrail(ctx, userID)
}

func (s *Service) ListTraining(ctx context.Context, userID string) ([]TrainingModule, error) {
	return s.repo.ListTraining(ctx, userID)
}

func (s *Service) CompleteTraining(ctx context.Context, userID, moduleID, idemKey string, detail json.RawMessage) (*TrainingModule, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.CompleteTraining(ctx, userID, moduleID, idemKey, detail)
}

func (s *Service) ListSafetyIssues(ctx context.Context, userID string) ([]SafetyIssue, error) {
	return s.repo.ListSafetyIssues(ctx, userID)
}

func (s *Service) ReportSafetyIssue(ctx context.Context, userID, idemKey string, req ReportSafetyIssueRequest) (*SafetyIssue, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.InsertSafetyIssue(ctx, userID, idemKey, req)
}

func (s *Service) GetPrivacySettings(ctx context.Context, userID string) (*DataPrivacySettings, error) {
	return s.repo.GetPrivacySettings(ctx, userID)
}

func (s *Service) UpdatePrivacySettings(ctx context.Context, userID, idemKey string, patch json.RawMessage) (*DataPrivacySettings, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.UpdatePrivacySettings(ctx, userID, patch)
}

// ── Security / devices ───────────────────────────────────────────────────────

func (s *Service) ListDevices(ctx context.Context, userID string) ([]Device, error) {
	return s.repo.ListDevices(ctx, userID)
}

func (s *Service) RevokeDevice(ctx context.Context, userID, deviceID, idemKey string) error {
	if idemKey == "" {
		return ErrIdempotencyRequired
	}
	return s.repo.RevokeDevice(ctx, userID, deviceID)
}

// GetSecurity surfaces the security-relevant flags from the settings row.
func (s *Service) GetSecurity(ctx context.Context, userID string) (*Settings, error) {
	return s.repo.GetSettings(ctx, userID)
}

// SetSecurityFlags applies biometric / two-factor toggles via the existing
// settings upsert (PATCH-like; only the supplied flags change).
func (s *Service) SetSecurityFlags(ctx context.Context, userID, idemKey string, req UpdateSettingsRequest) (*Settings, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.UpsertSettings(ctx, userID, req)
}

// GetAppPreferences / UpdateAppPreferences read & patch the app_preferences JSONB
// on the settings row (reusing the settings upsert with only that field set).
func (s *Service) GetAppPreferences(ctx context.Context, userID string) (*Settings, error) {
	return s.repo.GetSettings(ctx, userID)
}

func (s *Service) UpdateAppPreferences(ctx context.Context, userID, idemKey string, prefs json.RawMessage) (*Settings, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.UpsertSettings(ctx, userID, UpdateSettingsRequest{AppPreferences: prefs})
}

// ── Reputation / reviews ─────────────────────────────────────────────────────

func (s *Service) GetQualityScore(ctx context.Context, userID string) (*QualityScore, error) {
	return s.repo.GetLatestQualityScore(ctx, userID)
}

func (s *Service) ListConsultationFeedback(ctx context.Context, userID string) ([]ConsultationFeedback, error) {
	return s.repo.ListConsultationFeedback(ctx, userID)
}

func (s *Service) ListReviewDisputes(ctx context.Context, userID string) ([]ReviewDispute, error) {
	return s.repo.ListReviewDisputes(ctx, userID)
}

// DisputeReview records a 'dispute' against a review (idempotent).
func (s *Service) DisputeReview(ctx context.Context, userID, reviewID, idemKey string, req ReviewActionRequest) (*ReviewDispute, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.InsertReviewDispute(ctx, userID, reviewID, "dispute", idemKey, req)
}

// ReportReview records a 'report' against a review (idempotent) and flips the
// review's reported flag where the review belongs to the doctor.
func (s *Service) ReportReview(ctx context.Context, userID, reviewID, idemKey string, req ReviewActionRequest) (*ReviewDispute, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	d, err := s.repo.InsertReviewDispute(ctx, userID, reviewID, "report", idemKey, req)
	if err != nil {
		return nil, err
	}
	// Best-effort flag flip; absence of a matching owned review is not fatal to the report.
	if mErr := s.repo.MarkReviewReported(ctx, userID, reviewID); mErr != nil && !errors.Is(mErr, ErrNotFound) {
		return nil, mErr
	}
	return d, nil
}
