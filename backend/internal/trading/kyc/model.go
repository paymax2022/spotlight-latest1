package kyc

import (
	"errors"
	"time"
)

// RBAC permission slugs — MUST match the seeds in migration 20261029000200.
const (
	PermReview        = "trading.kyc.review"
	PermBypass        = "trading.kyc.bypass"         // maker
	PermBypassApprove = "trading.kyc.bypass.approve" // checker
	PermAuditRead     = "trading.audit.read"
)

// Record mirrors public.trading_kyc — the decoupled Module-KYC state (§16B.1).
// Record mirrors public.trading_kyc.
//
// The json tags are load-bearing: without them Go serialises the Go field names
// (UserID, SubmittedAt…), but the admin client types and fixtures expect
// snake_case (user_id, submitted_at…) — see frontend-admin/src/types/
// tradingAdmin.ts. A PascalCase payload parses without error and yields a table
// of undefined cells: the same silent client/server seam that emptied the
// savings screens.
type Record struct {
	UserID          string     `json:"user_id"`
	Status          Status     `json:"status"`
	SubmittedAt     *time.Time `json:"submitted_at"`
	ReviewedAt      *time.Time `json:"reviewed_at"`
	ReviewerID      *string    `json:"reviewer_id"`
	ReasonCode      *string    `json:"reason_code"`
	BypassExpiresAt *time.Time `json:"bypass_expires_at"`
	ExposureCapKobo *int64     `json:"exposure_cap_kobo"`
	Version         int        `json:"version"`
}

// Bypass mirrors public.trading_kyc_bypass (the compliance register). It is
// serialised to the admin register, so json tags are required — without them
// the client receives Go field names instead of snake_case.
type Bypass struct {
	ID              string     `json:"id"`
	UserID          string     `json:"user_id"`
	MakerID         string     `json:"maker_id"`
	CheckerID       string     `json:"checker_id"`
	Reason          string     `json:"reason"`
	ExposureCapKobo *int64     `json:"exposure_cap_kobo"`
	GrantedAt       time.Time  `json:"granted_at"`
	ExpiresAt       time.Time  `json:"expires_at"`
	RevokedAt       *time.Time `json:"revoked_at"`
}

// Service-level sentinel errors (mapped to HTTP by the handler).
var (
	ErrInvalidTransition = errors.New("trading kyc: illegal status transition")
	ErrReasonRequired    = errors.New("trading kyc: reason is required")
	ErrVersionConflict   = errors.New("trading kyc: record changed concurrently, retry")
	ErrNotFound          = errors.New("trading kyc: record not found")
)
