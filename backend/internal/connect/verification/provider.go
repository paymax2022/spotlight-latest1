package connectverification

import (
	"context"
	"errors"
	"strings"
)

// This file is an ADDITIVE Phase-1 extension to the Phase-0 verification package.
// It introduces the L0–L1 selfie/liveness Provider abstraction and a stub
// implementation. It does NOT modify the existing hasher/redact/retention code.
//
// Invariant 5 (compliance.md): verification data is encrypted at rest, retention
// defined, and NEVER logged. Providers return only an opaque/encrypted evidence
// reference plus a decision — never the raw selfie/biometric payload.

// VerificationLevel is the badge tier earned by a verification check.
type VerificationLevel string

const (
	LevelL0 VerificationLevel = "l0" // selfie present / basic presence
	LevelL1 VerificationLevel = "l1" // liveness-confirmed selfie
)

// ValidLevel reports whether l is a known verification level.
func ValidLevel(l VerificationLevel) bool { return l == LevelL0 || l == LevelL1 }

// ErrEmptyEvidence is returned by providers when no selfie/liveness payload was supplied.
var ErrEmptyEvidence = errors.New("connect: verification evidence is required")

// LivenessRequest is the input to a verification check. The payload fields hold
// transient, sensitive biometric data and MUST NOT be persisted or logged by
// callers — only the returned CheckResult.EvidenceRef is durable.
type LivenessRequest struct {
	UserID         string            // the user being verified
	RequestedLevel VerificationLevel // l0 or l1
	SelfieRef      string            // opaque client-uploaded selfie handle (e.g. R2 key)
	LivenessToken  string            // provider liveness session token (sensitive, transient)
	Metadata       map[string]string // non-PII context (device class, attempt #...)
}

// CheckResult is the durable, log-safe outcome of a verification check.
type CheckResult struct {
	Passed       bool              // whether the requested level was satisfied
	Level        VerificationLevel // the level actually attained
	EvidenceRef  string            // encrypted/opaque reference; safe to persist, NOT raw PII
	ReasonCode   string            // machine reason (e.g. "ok", "liveness_failed", "no_face")
	ProviderName string
}

// Provider performs an L0–L1 selfie/liveness check. Implementations integrate a
// real SDK behind this interface; call sites never change when the model changes.
type Provider interface {
	// Name identifies the provider for audit/reason-code attribution.
	Name() string
	// Check evaluates a liveness/selfie request and returns a log-safe result.
	Check(ctx context.Context, req LivenessRequest) (CheckResult, error)
}

// StubProvider is a deterministic, dependency-free Provider for development and
// tests (no real SDK, no network, no `go get`). It approves any request that
// carries a non-empty selfie reference, attaining the requested level (defaulting
// to L0), and emits an opaque evidence reference derived from the hasher so no raw
// payload is ever surfaced.
type StubProvider struct {
	hasher *Hasher
}

// NewStubProvider builds the stub. A hasher (server pepper) is required so the
// evidence reference is non-reversible — fails closed without one.
func NewStubProvider(h *Hasher) (*StubProvider, error) {
	if h == nil {
		return nil, ErrNoPepper
	}
	return &StubProvider{hasher: h}, nil
}

// Name implements Provider.
func (p *StubProvider) Name() string { return "stub" }

// Check implements Provider. It never logs or returns the raw selfie/liveness
// payload; only an HMAC-derived opaque reference is exposed.
func (p *StubProvider) Check(_ context.Context, req LivenessRequest) (CheckResult, error) {
	if strings.TrimSpace(req.SelfieRef) == "" {
		return CheckResult{
			Passed:       false,
			Level:        LevelL0,
			ReasonCode:   "no_evidence",
			ProviderName: p.Name(),
		}, ErrEmptyEvidence
	}

	level := req.RequestedLevel
	if !ValidLevel(level) {
		level = LevelL0
	}

	// Opaque, non-reversible evidence reference. Binds user + level so the same
	// selfie under two accounts yields distinct refs; raw refs are never stored.
	evidence := p.hasher.HashDocument("connect_liveness:"+string(level), req.UserID, req.SelfieRef)

	return CheckResult{
		Passed:       true,
		Level:        level,
		EvidenceRef:  evidence,
		ReasonCode:   "ok",
		ProviderName: p.Name(),
	}, nil
}
