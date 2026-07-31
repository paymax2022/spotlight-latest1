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
type Record struct {
	UserID          string
	Status          Status
	SubmittedAt     *time.Time
	ReviewedAt      *time.Time
	ReviewerID      *string
	ReasonCode      *string
	BypassExpiresAt *time.Time
	ExposureCapKobo *int64
	Version         int
}

// Bypass mirrors public.trading_kyc_bypass (the compliance register).
type Bypass struct {
	ID              string
	UserID          string
	MakerID         string
	CheckerID       string
	Reason          string
	ExposureCapKobo *int64
	GrantedAt       time.Time
	ExpiresAt       time.Time
	RevokedAt       *time.Time
}

// Service-level sentinel errors (mapped to HTTP by the handler).
var (
	ErrInvalidTransition = errors.New("trading kyc: illegal status transition")
	ErrReasonRequired    = errors.New("trading kyc: reason is required")
	ErrVersionConflict   = errors.New("trading kyc: record changed concurrently, retry")
	ErrNotFound          = errors.New("trading kyc: record not found")
)
