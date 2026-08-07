package orchestration

// verification_store.go — Postgres persistence for FX customer KYC verification.
// Replaces the stub in handler_stubs.go: submissions are now durably recorded and
// status transitions persist. Customer-scoped (the row key is the authenticated
// customer id). A nil store makes the handlers fall back to the stub so a DB-less
// dev setup still renders.
//
// Requires migration 20261008000000_fx_customer_verification.sql.

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// VerificationRecord mirrors the mobile Verification type (fx.types.ts) — camelCase.
type VerificationRecord struct {
	Status          string  `json:"status"`      // unstarted|pending|review|approved|rejected
	AccountType     string  `json:"accountType"` // individual|business
	Tier            int     `json:"tier"`
	SubmittedAt     *string `json:"submittedAt,omitempty"`
	ReviewedAt      *string `json:"reviewedAt,omitempty"`
	RejectionReason *string `json:"rejectionReason,omitempty"`
}

// defaultVerificationRecord is the "never started" state for a customer with no row.
func defaultVerificationRecord() VerificationRecord {
	return VerificationRecord{Status: "unstarted", AccountType: "individual", Tier: 0}
}

// VerificationStore persists FX customer KYC verification.
type VerificationStore interface {
	Get(ctx context.Context, customerID string) (VerificationRecord, error)
	Submit(ctx context.Context, customerID, accountType string, submission []byte) (VerificationRecord, error)
	Restart(ctx context.Context, customerID string) (VerificationRecord, error)
	// SetStatus is the admin/back-office review decision (approve/reject). Approving
	// lifts the tier; rejecting records a reason. Returns the updated record.
	SetStatus(ctx context.Context, customerID, status, reason string) (VerificationRecord, error)
}

type sqlVerificationStore struct{ db *pgxpool.Pool }

// NewVerificationStore returns a Postgres-backed verification store.
func NewVerificationStore(db *pgxpool.Pool) VerificationStore { return &sqlVerificationStore{db: db} }

const verificationCols = `status, account_type, tier, submitted_at, reviewed_at, rejection_reason`

func scanVerification(row pgx.Row) (VerificationRecord, error) {
	var r VerificationRecord
	var submitted, reviewed *time.Time
	var reason *string
	if err := row.Scan(&r.Status, &r.AccountType, &r.Tier, &submitted, &reviewed, &reason); err != nil {
		return VerificationRecord{}, err
	}
	r.SubmittedAt = tsPtr(submitted)
	r.ReviewedAt = tsPtr(reviewed)
	r.RejectionReason = reason
	return r, nil
}

func (s *sqlVerificationStore) Get(ctx context.Context, customerID string) (VerificationRecord, error) {
	rec, err := scanVerification(s.db.QueryRow(ctx,
		`SELECT `+verificationCols+` FROM orch_fx_customer_verifications WHERE customer_id=$1`, customerID))
	if errors.Is(err, pgx.ErrNoRows) {
		return defaultVerificationRecord(), nil
	}
	if err != nil {
		return VerificationRecord{}, err
	}
	return rec, nil
}

// Submit records a KYC submission: individuals route to 'pending', businesses to
// manual 'review'. Idempotent upsert on customer_id; a re-submit refreshes the
// payload + submitted_at and clears any prior rejection.
func (s *sqlVerificationStore) Submit(ctx context.Context, customerID, accountType string, submission []byte) (VerificationRecord, error) {
	if accountType != "business" {
		accountType = "individual"
	}
	status := "pending"
	if accountType == "business" {
		status = "review"
	}
	if len(submission) == 0 {
		submission = []byte("{}")
	}
	rec, err := scanVerification(s.db.QueryRow(ctx, `
		INSERT INTO orch_fx_customer_verifications
			(customer_id, status, account_type, tier, submission, submitted_at, rejection_reason, reviewed_at)
		VALUES ($1,$2,$3,1,$4,now(),NULL,NULL)
		ON CONFLICT (customer_id) DO UPDATE SET
			status=EXCLUDED.status, account_type=EXCLUDED.account_type, tier=1,
			submission=EXCLUDED.submission, submitted_at=now(),
			rejection_reason=NULL, reviewed_at=NULL, updated_at=now()
		RETURNING `+verificationCols,
		customerID, status, accountType, submission))
	if err != nil {
		return VerificationRecord{}, err
	}
	return rec, nil
}

// Restart resets a customer to 'unstarted' so they can resubmit after a rejection.
func (s *sqlVerificationStore) Restart(ctx context.Context, customerID string) (VerificationRecord, error) {
	rec, err := scanVerification(s.db.QueryRow(ctx, `
		INSERT INTO orch_fx_customer_verifications (customer_id, status, account_type, tier)
		VALUES ($1,'unstarted','individual',0)
		ON CONFLICT (customer_id) DO UPDATE SET
			status='unstarted', tier=0, submission=NULL, rejection_reason=NULL,
			submitted_at=NULL, reviewed_at=NULL, updated_at=now()
		RETURNING `+verificationCols, customerID))
	if err != nil {
		return VerificationRecord{}, err
	}
	return rec, nil
}

// SetStatus applies a review decision. 'approved' lifts the tier to 2; 'rejected'
// records the reason. reviewed_at is stamped. Returns ErrNoVerification if the
// customer has no submission on file.
func (s *sqlVerificationStore) SetStatus(ctx context.Context, customerID, status, reason string) (VerificationRecord, error) {
	tier := 1
	if status == "approved" {
		tier = 2
	}
	var reasonArg *string
	if status == "rejected" && reason != "" {
		reasonArg = &reason
	}
	rec, err := scanVerification(s.db.QueryRow(ctx, `
		UPDATE orch_fx_customer_verifications
		SET status=$2, tier=$3, rejection_reason=$4, reviewed_at=now(), updated_at=now()
		WHERE customer_id=$1
		RETURNING `+verificationCols, customerID, status, tier, reasonArg))
	if errors.Is(err, pgx.ErrNoRows) {
		return VerificationRecord{}, ErrNoVerification
	}
	if err != nil {
		return VerificationRecord{}, err
	}
	return rec, nil
}

// ErrNoVerification is returned when a status change targets a customer with no row.
var ErrNoVerification = errors.New("no verification on file for customer")
