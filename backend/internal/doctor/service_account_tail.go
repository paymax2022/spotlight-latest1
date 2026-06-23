package doctor

import (
	"context"
	"encoding/json"
	"time"
)

// service_account_tail.go — business logic + DTOs/projections for the Wave-2
// "account tail" endpoints. Style mirrors service_account.go:
//   * reads delegate straight to the repository, scoped to the doctor;
//   * mutations on tables with a UNIQUE idempotency_key require the
//     Idempotency-Key header (ErrIdempotencyRequired) and rely on the
//     repository's ON CONFLICT replay;
//   * NONE of these post to the money ledger. The payout endpoints here are
//     READS (list/get/report/account) or REQUEST rows (dispute) — the actual
//     payout money path is Service.RequestPayout, which is left untouched.

// ── DTOs / request bodies ────────────────────────────────────────────────────

// BankAccountRequest is the body for POST /profile/bank-account.
type BankAccountRequest struct {
	BankName      *string         `json:"bankName,omitempty"`
	BankCode      *string         `json:"bankCode,omitempty"`
	AccountNumber *string         `json:"accountNumber,omitempty"`
	AccountName   *string         `json:"accountName,omitempty"`
	IsDefault     *bool           `json:"isDefault,omitempty"`
	TaxInfo       json.RawMessage `json:"taxInfo,omitempty"`
}

// PayoutAccountRequest is the body for PUT /payout-account (set/update default).
type PayoutAccountRequest struct {
	AccountID     *string `json:"accountId,omitempty"`
	BankName      *string `json:"bankName,omitempty"`
	BankCode      *string `json:"bankCode,omitempty"`
	AccountNumber *string `json:"accountNumber,omitempty"`
	AccountName   *string `json:"accountName,omitempty"`
}

// ProfileDocumentRequest is the body for POST /profile/documents.
type ProfileDocumentRequest struct {
	DocType   string  `json:"docType" binding:"required"`
	Label     *string `json:"label,omitempty"`
	FileName  *string `json:"fileName,omitempty"`
	FileURL   *string `json:"fileUrl,omitempty"`
	MimeType  *string `json:"mimeType,omitempty"`
	SizeBytes *int64  `json:"sizeBytes,omitempty"`
	Required  *bool   `json:"required,omitempty"`
}

// ProfilePhotoRequest is the body for POST /profile/photo.
type ProfilePhotoRequest struct {
	PhotoURL string `json:"photoUrl" binding:"required"`
}

// SettlementDisputeRequest is the body for POST /payouts/:payoutId/dispute.
type SettlementDisputeRequest struct {
	Reason *string         `json:"reason,omitempty"`
	Detail json.RawMessage `json:"detail,omitempty"`
}

// TechnicalSupportRequest is the body for POST /support/technical.
type TechnicalSupportRequest struct {
	Subject string `json:"subject,omitempty"`
	Body    string `json:"body" binding:"required"`
}

// PresenceRequest is the body for PUT /presence.
type PresenceRequest struct {
	Presence string `json:"presence" binding:"required"`
}

// EmergencyScheduleRequest is the body for PUT /schedule/emergency.
type EmergencyScheduleRequest struct {
	Enabled  *bool           `json:"enabled,omitempty"`
	Schedule json.RawMessage `json:"schedule,omitempty"`
}

// ── Models / projections ─────────────────────────────────────────────────────

// BankAccount mirrors public.doctor_bank_accounts. AccountNumber is masked to the
// last 4 digits before the row leaves the service (never returns the full PAN).
type BankAccount struct {
	ID            string          `json:"id"`
	UserID        string          `json:"userId"`
	BankName      *string         `json:"bankName,omitempty"`
	BankCode      *string         `json:"bankCode,omitempty"`
	AccountNumber *string         `json:"accountNumber,omitempty"` // masked: ******1234
	AccountName   *string         `json:"accountName,omitempty"`
	IsVerified    bool            `json:"isVerified"`
	IsDefault     bool            `json:"isDefault"`
	TaxInfo       json.RawMessage `json:"taxInfo,omitempty"`
	CreatedAt     time.Time       `json:"createdAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`
}

// SettlementDispute mirrors public.doctor_settlement_disputes.
type SettlementDispute struct {
	ID        string          `json:"id"`
	UserID    string          `json:"userId"`
	PayoutID  *string         `json:"payoutId,omitempty"`
	Status    string          `json:"status"`
	Reason    *string         `json:"reason,omitempty"`
	Detail    json.RawMessage `json:"detail,omitempty"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

// PayoutReportBucket is one status bucket in the payout report. Money is int64 kobo.
type PayoutReportBucket struct {
	Status    string `json:"status"`
	TotalKobo int64  `json:"totalKobo"`
	Count     int64  `json:"count"`
}

// PayoutReport is the aggregate projection for GET /payout-report. All money is
// int64 minor units (kobo); no floats anywhere on the money path.
type PayoutReport struct {
	Currency    string               `json:"currency"`
	TotalKobo   int64                `json:"totalKobo"`
	PaidKobo    int64                `json:"paidKobo"`
	PendingKobo int64                `json:"pendingKobo"`
	TotalCount  int64                `json:"totalCount"`
	ByStatus    []PayoutReportBucket `json:"byStatus"`
}

// ComplianceStatus is the read-only projection for GET /compliance.
type ComplianceStatus struct {
	PoliciesAcknowledged []string `json:"policiesAcknowledged"`
	TrainingTotal        int64    `json:"trainingTotal"`
	TrainingCompleted    int64    `json:"trainingCompleted"`
	TrainingComplete     bool     `json:"trainingComplete"`
}

// ReputationSummary is the read-only projection for GET /reputation.
type ReputationSummary struct {
	AverageRating float64 `json:"averageRating"`
	ReviewCount   int64   `json:"reviewCount"`
	QualityScore  float64 `json:"qualityScore"`
}

// PatientFullProfile is the composed projection for GET /patients/:patientId/full-profile.
type PatientFullProfile struct {
	PatientID    string          `json:"patientId"`
	Patient      json.RawMessage `json:"patient,omitempty"`
	Appointments []Appointment   `json:"appointments,omitempty"`
	Notes        []ClinicalNote  `json:"notes,omitempty"`
}

// PatientRecordHub is the records-dashboard projection for
// GET /patients/:patientId/record-hub (shares/restrictions/access-log scoped to patient).
type PatientRecordHub struct {
	PatientID    string              `json:"patientId"`
	Shares       []RecordShare       `json:"shares"`
	Restrictions []RecordRestriction `json:"restrictions"`
	AccessLog    []RecordAccessEntry `json:"accessLog"`
}

// maskAccountNumber returns the last-4 representation of a stored account number,
// e.g. "0123456789" → "******6789". nil/short values are returned as-is.
func maskAccountNumber(b *BankAccount) {
	if b == nil || b.AccountNumber == nil {
		return
	}
	an := *b.AccountNumber
	if len(an) <= 4 {
		return
	}
	masked := "******" + an[len(an)-4:]
	b.AccountNumber = &masked
}

// ── Profile ──────────────────────────────────────────────────────────────────

// CreateBankAccount upserts a bank account (idempotent) and masks the account
// number in the response.
func (s *Service) CreateBankAccount(ctx context.Context, userID, idemKey string, req BankAccountRequest) (*BankAccount, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	acct, err := s.repo.UpsertBankAccount(ctx, userID, idemKey, req)
	if err != nil {
		return nil, err
	}
	maskAccountNumber(acct)
	return acct, nil
}

// UploadProfileDocument inserts a verification/profile document. The table has no
// idempotency_key column, so no Idempotency-Key is required.
func (s *Service) UploadProfileDocument(ctx context.Context, userID string, req ProfileDocumentRequest) (*VerificationDocument, error) {
	return s.repo.InsertProfileDocument(ctx, userID, req)
}

// SetProfilePhoto sets the doctor's avatar_url on doctor_profiles.
func (s *Service) SetProfilePhoto(ctx context.Context, userID string, req ProfilePhotoRequest) (*Profile, error) {
	return s.repo.SetProfilePhoto(ctx, userID, req.PhotoURL)
}

// UpdateTaxInfo patch-merges tax_info on the doctor's default bank account.
func (s *Service) UpdateTaxInfo(ctx context.Context, userID string, patch json.RawMessage) (*BankAccount, error) {
	acct, err := s.repo.UpdateBankAccountTaxInfo(ctx, userID, patch)
	if err != nil {
		return nil, err
	}
	maskAccountNumber(acct)
	return acct, nil
}

// ── Payouts (reads + dispute request) ────────────────────────────────────────

func (s *Service) ListPayouts(ctx context.Context, userID string) ([]Payout, error) {
	return s.repo.ListPayouts(ctx, userID)
}

func (s *Service) GetPayout(ctx context.Context, userID, id string) (*Payout, error) {
	return s.repo.GetPayout(ctx, userID, id)
}

func (s *Service) GetPayoutReport(ctx context.Context, userID string) (*PayoutReport, error) {
	return s.repo.GetPayoutReport(ctx, userID)
}

// UpdatePayoutAccount sets/updates the default payout bank account and masks the
// account number in the response. This is NOT a ledger posting.
func (s *Service) UpdatePayoutAccount(ctx context.Context, userID string, req PayoutAccountRequest) (*BankAccount, error) {
	acct, err := s.repo.SetDefaultBankAccount(ctx, userID, req)
	if err != nil {
		return nil, err
	}
	maskAccountNumber(acct)
	return acct, nil
}

// DisputePayout records a settlement dispute (request row, not a ledger posting).
func (s *Service) DisputePayout(ctx context.Context, userID, payoutID, idemKey string, req SettlementDisputeRequest) (*SettlementDispute, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.InsertSettlementDispute(ctx, userID, payoutID, idemKey, req)
}

// ── Privacy ──────────────────────────────────────────────────────────────────

func (s *Service) RequestPrivacyExport(ctx context.Context, userID string) (*DataPrivacySettings, error) {
	return s.repo.RequestPrivacyExport(ctx, userID)
}

func (s *Service) RequestPrivacyDelete(ctx context.Context, userID string) (*DataPrivacySettings, error) {
	return s.repo.RequestPrivacyDelete(ctx, userID)
}

// ── Security ─────────────────────────────────────────────────────────────────

// ChangePassword records a password-change *request* in the compliance audit.
// Passwords live in Supabase Auth — nothing here stores or verifies a password.
func (s *Service) ChangePassword(ctx context.Context, userID, idemKey string) error {
	if idemKey == "" {
		return ErrIdempotencyRequired
	}
	return s.repo.InsertAudit(ctx, userID, "security.password_change_requested", "auth", userID, idemKey, nil)
}

// ── Compliance ───────────────────────────────────────────────────────────────

func (s *Service) GetCompliance(ctx context.Context, userID string) (*ComplianceStatus, error) {
	return s.repo.GetComplianceStatus(ctx, userID)
}

// AckPolicy records a policy acknowledgement as a compliance-audit row.
func (s *Service) AckPolicy(ctx context.Context, userID, policyKey, idemKey string) (*ComplianceStatus, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	if err := s.repo.InsertAudit(ctx, userID, "policy.ack", "policy", policyKey, idemKey, nil); err != nil {
		return nil, err
	}
	return s.repo.GetComplianceStatus(ctx, userID)
}

// ── Onboarding (legal) ───────────────────────────────────────────────────────

// GetLegalOnboarding returns the legal/consent documents the doctor must accept.
// Read-only thin projection over the existing ListConsents read.
func (s *Service) GetLegalOnboarding(ctx context.Context, userID string) ([]LegalConsent, error) {
	return s.repo.ListConsents(ctx, userID)
}

// ── Reputation ───────────────────────────────────────────────────────────────

func (s *Service) GetReputation(ctx context.Context, userID string) (*ReputationSummary, error) {
	return s.repo.GetReputation(ctx, userID)
}

// ── Patients (composed projections) ──────────────────────────────────────────

// GetPatientFullProfile composes the base patient record with the doctor's recent
// clinical notes for that patient. Reuses GetPatientRecord (patient + appointments)
// and ListNotes; if a slice is thin it returns what exists.
func (s *Service) GetPatientFullProfile(ctx context.Context, userID, patientID string) (*PatientFullProfile, error) {
	rec, err := s.repo.GetPatientRecord(ctx, userID, patientID)
	if err != nil {
		return nil, err
	}
	out := &PatientFullProfile{
		PatientID:    rec.PatientID,
		Patient:      rec.Patient,
		Appointments: rec.Appointments,
		Notes:        []ClinicalNote{},
	}
	// Recent notes across this patient's appointments (best effort per appointment).
	for _, a := range rec.Appointments {
		notes, err := s.repo.ListNotes(ctx, userID, a.ID)
		if err != nil {
			return nil, err
		}
		out.Notes = append(out.Notes, notes...)
	}
	return out, nil
}

// GetPatientRecordHub builds a records-dashboard projection for one patient by
// reusing record shares (filtered to the patient), restrictions and access log.
func (s *Service) GetPatientRecordHub(ctx context.Context, userID, patientID string) (*PatientRecordHub, error) {
	restrictions, err := s.repo.ListRecordRestrictions(ctx, userID, patientID)
	if err != nil {
		return nil, err
	}
	accessLog, err := s.repo.ListRecordAccessLog(ctx, userID, patientID)
	if err != nil {
		return nil, err
	}
	allShares, err := s.repo.ListRecordShares(ctx, userID)
	if err != nil {
		return nil, err
	}
	shares := []RecordShare{}
	for _, sh := range allShares {
		if sh.PatientID != nil && *sh.PatientID == patientID {
			shares = append(shares, sh)
		}
	}
	return &PatientRecordHub{
		PatientID:    patientID,
		Shares:       shares,
		Restrictions: restrictions,
		AccessLog:    accessLog,
	}, nil
}

// ── Misc ─────────────────────────────────────────────────────────────────────

// SetPresence updates the doctor's presence on doctor_profiles.
func (s *Service) SetPresence(ctx context.Context, userID string, req PresenceRequest) error {
	return s.repo.SetPresence(ctx, userID, req.Presence)
}

// Logout is stateless (Supabase JWT) — record an audit breadcrumb, best effort.
func (s *Service) Logout(ctx context.Context, userID string) error {
	// Idempotency optional here; pass empty key (column is nullable on the audit table).
	_ = s.repo.InsertAudit(ctx, userID, "auth.logout", "auth", userID, "", nil)
	return nil
}

// DismissAnnouncement records a dismissal in the compliance audit (no doctor
// announcements table exists in this module).
func (s *Service) DismissAnnouncement(ctx context.Context, userID, announcementID string) error {
	_ = s.repo.InsertAudit(ctx, userID, "announcement.dismiss", "announcement", announcementID, "", nil)
	return nil
}

// CreateTechnicalSupport opens a technical support ticket (category='technical').
func (s *Service) CreateTechnicalSupport(ctx context.Context, userID, idemKey string, req TechnicalSupportRequest) (*SupportTicket, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.InsertTechnicalSupportTicket(ctx, userID, idemKey, req)
}

// SetEmergencySchedule stores the doctor's emergency availability window.
func (s *Service) SetEmergencySchedule(ctx context.Context, userID string, req EmergencyScheduleRequest) error {
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	return s.repo.SetEmergencySchedule(ctx, userID, enabled, req.Schedule)
}
