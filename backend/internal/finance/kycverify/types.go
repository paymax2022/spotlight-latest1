// Package kycverify is the multi-provider KYC verification domain (ADR-013).
// It composes CBN-tier check sets, routes each check to a provider by capability
// (with failover), normalizes every result to VerificationCheck, and resolves a
// user's tier only when the full required set passes. Domain logic depends on the
// provider ports only — never on a provider SDK.
package kycverify

import (
	"time"

	"spotlight/backend/internal/provider"
)

// SessionStatus is the verification-session lifecycle (matches DB CHECK).
type SessionStatus string

const (
	SessUnverified   SessionStatus = "UNVERIFIED"
	SessTierPending  SessionStatus = "TIER_PENDING"
	SessTierVerified SessionStatus = "TIER_VERIFIED"
	SessTierFailed   SessionStatus = "TIER_FAILED"
	SessNeedsReview  SessionStatus = "NEEDS_REVIEW"
	SessApproved     SessionStatus = "APPROVED"
	SessRejected     SessionStatus = "REJECTED"
)

// Session is a user's attempt to reach a target CBN tier.
type Session struct {
	ID         string        `json:"id"`
	UserID     string        `json:"user_id"`
	TargetTier int           `json:"target_tier"`
	Status     SessionStatus `json:"status"`
	CreatedAt  time.Time     `json:"created_at"`
	UpdatedAt  time.Time     `json:"updated_at"`
}

// Check is the normalized result of one provider check (persisted).
type Check struct {
	ID              string                  `json:"id"`
	SessionID       string                  `json:"session_id"`
	UserID          string                  `json:"user_id"`
	Type            provider.KycCheckType   `json:"type"`
	Provider        string                  `json:"provider"`
	ProviderRef     string                  `json:"provider_ref"`
	ClientRef       string                  `json:"client_ref"`
	Status          provider.KycCheckStatus `json:"status"`
	Match           bool                    `json:"match"`
	Confidence      float64                 `json:"confidence"`
	ExtractedFields map[string]string       `json:"extracted_fields"`
	Reason          string                  `json:"reason"`
	RawPayloadRef   string                  `json:"raw_payload_ref,omitempty"`
	CreatedAt       time.Time               `json:"created_at"`
	UpdatedAt       time.Time               `json:"updated_at"`
}

// Consent is an NDPA/CBN consent record captured before any check.
type Consent struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Scope     string    `json:"scope"`
	Version   string    `json:"version"`
	GrantedAt time.Time `json:"granted_at"`
	IP        string    `json:"ip,omitempty"`
}
