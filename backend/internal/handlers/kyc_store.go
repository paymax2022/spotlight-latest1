package handlers

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// KYCStore provides data access for KYC operations.
type KYCStore struct {
	db *pgxpool.Pool
}

// NewKYCStore creates a new KYC store.
func NewKYCStore(db *pgxpool.Pool) *KYCStore {
	return &KYCStore{db: db}
}

// KYCProfile represents a user's KYC verification status.
type KYCProfile struct {
	UserID              string `json:"userId"`
	Tier                int    `json:"tier"`
	Status              string `json:"status"`
	BVN                 string `json:"bvn"`
	NIN                 string `json:"nin"`
	DateOfBirth         string `json:"dateOfBirth"`
	VerificationStatus  string `json:"verificationStatus"` // "pending", "approved", "rejected"
	VerifiedAt          sql.NullString `json:"verifiedAt"`
	RejectionReason     string `json:"rejectionReason"`
	CreatedAt           string `json:"createdAt"`
	UpdatedAt           string `json:"updatedAt"`
}

// GetKYCStatus retrieves user's KYC verification status.
func (s *KYCStore) GetKYCStatus(ctx context.Context, userID string) (*KYCProfile, error) {
	row := s.db.QueryRow(ctx, `
		SELECT
			user_id, tier, COALESCE(status, 'unverified') as status,
			COALESCE(bvn, '') as bvn, COALESCE(nin, '') as nin,
			COALESCE(date_of_birth::text, '') as date_of_birth,
			COALESCE(verification_status, 'pending') as verification_status,
			verified_at::text,
			COALESCE(rejection_reason, '') as rejection_reason,
			created_at::text, updated_at::text
		FROM kyc_profiles
		WHERE user_id = $1
	`, userID)

	var profile KYCProfile
	err := row.Scan(&profile.UserID, &profile.Tier, &profile.Status,
		&profile.BVN, &profile.NIN, &profile.DateOfBirth,
		&profile.VerificationStatus, &profile.VerifiedAt, &profile.RejectionReason,
		&profile.CreatedAt, &profile.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		// New user: return Tier 0 (unverified)
		return &KYCProfile{
			UserID:             userID,
			Tier:               0,
			Status:             "unverified",
			VerificationStatus: "pending",
		}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query kyc status: %w", err)
	}

	return &profile, nil
}

// TierLimit represents spending limits for a KYC tier.
type TierLimit struct {
	Tier                int   `json:"tier"`
	Label               string `json:"label"`
	DailyLimitKobo      int64 `json:"dailyLimitKobo"`
	MonthlyLimitKobo    int64 `json:"monthlyLimitKobo"`
	TransactionLimitKobo int64 `json:"transactionLimitKobo"`
	RequiredDocuments   []string `json:"requiredDocuments"`
}

// GetTierLimits retrieves KYC tier ladder.
func (s *KYCStore) GetTierLimits(ctx context.Context) ([]TierLimit, error) {
	// Hardcoded tier limits (can be moved to config table)
	limits := []TierLimit{
		{
			Tier:                0,
			Label:               "Tier 0 (No KYC)",
			DailyLimitKobo:      100_000,
			MonthlyLimitKobo:    1_000_000,
			TransactionLimitKobo: 50_000,
			RequiredDocuments:   []string{},
		},
		{
			Tier:                1,
			Label:               "Tier 1",
			DailyLimitKobo:      500_000,
			MonthlyLimitKobo:    10_000_000,
			TransactionLimitKobo: 500_000,
			RequiredDocuments:   []string{"BVN"},
		},
		{
			Tier:                2,
			Label:               "Tier 2",
			DailyLimitKobo:      2_000_000,
			MonthlyLimitKobo:    50_000_000,
			TransactionLimitKobo: 5_000_000,
			RequiredDocuments:   []string{"BVN", "NIN"},
		},
		{
			Tier:                3,
			Label:               "Tier 3",
			DailyLimitKobo:      10_000_000,
			MonthlyLimitKobo:    500_000_000,
			TransactionLimitKobo: 50_000_000,
			RequiredDocuments:   []string{"BVN", "NIN", "GovernmentID"},
		},
	}
	return limits, nil
}

// SubmitTier1 records Tier 1 KYC submission.
func (s *KYCStore) SubmitTier1(ctx context.Context, userID string, bvn string, idemKey string) (*KYCProfile, error) {
	row := s.db.QueryRow(ctx, `
		INSERT INTO kyc_profiles (
			user_id, tier, status, bvn, verification_status,
			idempotency_key, created_at, updated_at
		) VALUES (
			$1, 1, 'tier1_pending', $2, 'pending', $3, NOW(), NOW()
		)
		ON CONFLICT (user_id) DO UPDATE SET
			tier = GREATEST(kyc_profiles.tier, 1),
			bvn = $2,
			updated_at = NOW()
		RETURNING user_id, tier, status, bvn, COALESCE(nin, '') as nin,
		          COALESCE(date_of_birth::text, '') as date_of_birth,
		          verification_status, verified_at::text,
		          COALESCE(rejection_reason, '') as rejection_reason,
		          created_at::text, updated_at::text
	`, userID, bvn, idemKey)

	var profile KYCProfile
	err := row.Scan(&profile.UserID, &profile.Tier, &profile.Status,
		&profile.BVN, &profile.NIN, &profile.DateOfBirth,
		&profile.VerificationStatus, &profile.VerifiedAt, &profile.RejectionReason,
		&profile.CreatedAt, &profile.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("submit tier1: %w", err)
	}

	return &profile, nil
}

// SubmitTier2 records Tier 2 KYC submission.
func (s *KYCStore) SubmitTier2(ctx context.Context, userID string, bvn string, nin string, idemKey string) (*KYCProfile, error) {
	row := s.db.QueryRow(ctx, `
		INSERT INTO kyc_profiles (
			user_id, tier, status, bvn, nin, verification_status,
			idempotency_key, created_at, updated_at
		) VALUES (
			$1, 2, 'tier2_pending', $2, $3, 'pending', $4, NOW(), NOW()
		)
		ON CONFLICT (user_id) DO UPDATE SET
			tier = GREATEST(kyc_profiles.tier, 2),
			bvn = $2,
			nin = $3,
			updated_at = NOW()
		RETURNING user_id, tier, status, bvn, nin,
		          COALESCE(date_of_birth::text, '') as date_of_birth,
		          verification_status, verified_at::text,
		          COALESCE(rejection_reason, '') as rejection_reason,
		          created_at::text, updated_at::text
	`, userID, bvn, nin, idemKey)

	var profile KYCProfile
	err := row.Scan(&profile.UserID, &profile.Tier, &profile.Status,
		&profile.BVN, &profile.NIN, &profile.DateOfBirth,
		&profile.VerificationStatus, &profile.VerifiedAt, &profile.RejectionReason,
		&profile.CreatedAt, &profile.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("submit tier2: %w", err)
	}

	return &profile, nil
}

// SubmitTier3 records Tier 3 KYC submission.
func (s *KYCStore) SubmitTier3(ctx context.Context, userID string, bvn string, nin string, governmentID string, idemKey string) (*KYCProfile, error) {
	row := s.db.QueryRow(ctx, `
		INSERT INTO kyc_profiles (
			user_id, tier, status, bvn, nin, government_id, verification_status,
			idempotency_key, created_at, updated_at
		) VALUES (
			$1, 3, 'tier3_pending', $2, $3, $4, 'pending', $5, NOW(), NOW()
		)
		ON CONFLICT (user_id) DO UPDATE SET
			tier = GREATEST(kyc_profiles.tier, 3),
			bvn = $2,
			nin = $3,
			government_id = $4,
			updated_at = NOW()
		RETURNING user_id, tier, status, bvn, nin,
		          COALESCE(date_of_birth::text, '') as date_of_birth,
		          verification_status, verified_at::text,
		          COALESCE(rejection_reason, '') as rejection_reason,
		          created_at::text, updated_at::text
	`, userID, bvn, nin, governmentID, idemKey)

	var profile KYCProfile
	err := row.Scan(&profile.UserID, &profile.Tier, &profile.Status,
		&profile.BVN, &profile.NIN, &profile.DateOfBirth,
		&profile.VerificationStatus, &profile.VerifiedAt, &profile.RejectionReason,
		&profile.CreatedAt, &profile.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("submit tier3: %w", err)
	}

	return &profile, nil
}
