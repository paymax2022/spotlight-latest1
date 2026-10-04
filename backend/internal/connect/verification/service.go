package connectverification

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"spotlight/backend/go-common/cryptox"
	"spotlight/backend/go-common/fsm"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	keyError = "error"
)

// This file is an ADDITIVE Phase-1 extension: it adds the persistent verification
// state machine on top of the Phase-0 hashing/redaction/retention primitives. It
// introduces no changes to existing exported symbols.

// Status values mirror the connect_verification.status CHECK constraint and the
// state machine in architecture.md §26.5:
//
//	none → pending → l0_passed → l1_passed | failed | rejected
const (
	StatusNone     = "none"
	StatusPending  = "pending"
	StatusL0Passed = "l0_passed"
	StatusL1Passed = "l1_passed"
	StatusFailed   = "failed"
	StatusRejected = "rejected"
)

// ErrInvalidTransition is returned when a status change is not allowed.
var ErrInvalidTransition = errors.New("connect: invalid verification transition")

// allowedTransitions guards the verification state machine (reject illegal moves).
var allowedTransitions = fsm.Table[string]{
	StatusNone:     fsm.Set(StatusPending),
	StatusPending:  fsm.Set(StatusL0Passed, StatusL1Passed, StatusFailed, StatusRejected),
	StatusL0Passed: fsm.Set(StatusPending, StatusL1Passed, StatusFailed, StatusRejected),
	StatusFailed:   fsm.Set(StatusPending),
	StatusRejected: fsm.Set[string](), // terminal (admin-only re-open out of scope for Phase 1)
	StatusL1Passed: fsm.Set(StatusRejected),
}

func canTransition(from, to string) bool {
	// from == to is an idempotent re-assert of the same state.
	return from == to || allowedTransitions.Can(from, to)
}

// Record is the durable, log-safe view of a connect_verification row. It never
// carries the raw selfie/biometric payload — only the opaque evidence reference.
type Record struct {
	UserID      string     `json:"user_id"`
	Level       string     `json:"level"`
	Status      string     `json:"status"`
	ReasonCode  string     `json:"reason_code,omitempty"`
	Provider    string     `json:"provider,omitempty"`
	Badge       bool       `json:"badge"`
	VerifiedAt  *time.Time `json:"verified_at,omitempty"`
	HasEvidence bool       `json:"has_evidence"` // whether an encrypted ref exists (never the ref itself)
}

// StatusService persists and transitions verification state. Construct it with a
// pgx pool and a configured Provider.
type StatusService struct {
	db       *pgxpool.Pool
	provider Provider
	// badgeMinLevel is the level that earns the verified badge; sourced from
	// connect_config (verification.badge_min_level) by callers, defaulting to l1.
	badgeMinLevel VerificationLevel
}

// NewStatusService builds the Phase-1 verification status service.
func NewStatusService(db *pgxpool.Pool, provider Provider, badgeMinLevel VerificationLevel) *StatusService {
	if !ValidLevel(badgeMinLevel) {
		badgeMinLevel = LevelL1
	}
	return &StatusService{db: db, provider: provider, badgeMinLevel: badgeMinLevel}
}

const verifSelect = `user_id, level, status, COALESCE(reason_code,''), COALESCE(provider,''), verified_at, (evidence_ref IS NOT NULL)`

func (s *StatusService) scan(row pgx.Row) (*Record, error) {
	var r Record
	if err := row.Scan(&r.UserID, &r.Level, &r.Status, &r.ReasonCode, &r.Provider, &r.VerifiedAt, &r.HasEvidence); err != nil {
		return nil, err
	}
	r.Badge = s.badgeFor(r.Status)
	return &r, nil
}

// badgeFor reports whether a status earns the verified badge given the min level.
func (s *StatusService) badgeFor(status string) bool {
	switch s.badgeMinLevel {
	case LevelL0:
		return status == StatusL0Passed || status == StatusL1Passed
	default: // LevelL1
		return status == StatusL1Passed
	}
}

// Get returns the caller's verification record, or a zero-value none record if
// the user has not started verification.
func (s *StatusService) Get(ctx context.Context, userID string) (*Record, error) {
	const q = `SELECT ` + verifSelect + ` FROM connect_verification WHERE user_id = $1`
	rec, err := s.scan(s.db.QueryRow(ctx, q, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return &Record{UserID: userID, Level: string(LevelL0), Status: StatusNone, Badge: false}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("connect: get verification: %w", err)
	}
	return rec, nil
}

// SubmitSelfie runs an L0–L1 liveness check through the provider and persists the
// resulting state transition atomically. The raw payload in req is never stored
// or logged; only the provider's opaque evidence reference is persisted. The
// transition is guarded by the state machine and is idempotent on retry.
func (s *StatusService) SubmitSelfie(ctx context.Context, req LivenessRequest) (*Record, error) {
	if s.provider == nil {
		return nil, errors.New("connect: no verification provider configured")
	}

	res, providerErr := s.provider.Check(ctx, req)

	target := StatusFailed
	if providerErr == nil && res.Passed {
		switch res.Level {
		case LevelL1:
			target = StatusL1Passed
		default:
			target = StatusL0Passed
		}
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("connect: begin verification tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Load (or create as 'none') the current state, locking the row.
	var current string
	const sel = `SELECT status FROM connect_verification WHERE user_id = $1 FOR UPDATE`
	err = tx.QueryRow(ctx, sel, req.UserID).Scan(&current)
	if errors.Is(err, pgx.ErrNoRows) {
		current = StatusNone
		const ins = `INSERT INTO connect_verification (user_id, level, status) VALUES ($1,'l0','none')
			ON CONFLICT (user_id) DO NOTHING`
		if _, err := tx.Exec(ctx, ins, req.UserID); err != nil {
			return nil, fmt.Errorf("connect: init verification: %w", err)
		}
	} else if err != nil {
		return nil, fmt.Errorf("connect: lock verification: %w", err)
	}

	// A submission moves none/failed → pending implicitly, then to the outcome.
	if !canTransition(current, target) {
		// none→pending→outcome is the normal path; allow none→outcome directly,
		// but reject e.g. l1_passed→l0_passed downgrades.
		if !canTransition(current, StatusPending) || !canTransition(StatusPending, target) {
			return nil, fmt.Errorf("%w: %s → %s", ErrInvalidTransition, current, target)
		}
	}

	var verifiedAt any
	if target == StatusL0Passed || target == StatusL1Passed {
		verifiedAt = time.Now().UTC()
	}

	const upd = `UPDATE connect_verification
		SET level = $2, status = $3, evidence_ref = NULLIF($4,''), reason_code = NULLIF($5,''),
		    provider = NULLIF($6,''), verified_at = $7
		WHERE user_id = $1
		RETURNING ` + verifSelect
	rec, err := s.scan(tx.QueryRow(ctx, upd,
		req.UserID, string(res.Level), target, res.EvidenceRef, res.ReasonCode, res.ProviderName, verifiedAt,
	))
	if err != nil {
		return nil, fmt.Errorf("connect: persist verification: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("connect: commit verification: %w", err)
	}
	return rec, nil
}

// HasBadge reports whether the given user currently holds the verified badge.
// Used by other Connect services (search verified-only filter, badge surfacing).
func (s *StatusService) HasBadge(ctx context.Context, userID string) (bool, error) {
	rec, err := s.Get(ctx, userID)
	if err != nil {
		return false, err
	}
	return rec.Badge, nil
}

// RetentionPolicy governs how long verification evidence references are kept
// before purge. Days is sourced from connect_config (verification.retention_days),
// keeping the policy backend-owned rather than hard-coded.
type RetentionPolicy struct{ Days int }

// Cutoff returns the timestamp before which evidence is past retention.
// A non-positive Days means "retain until configured" (no purge), returning the
// zero time.
func (p RetentionPolicy) Cutoff(now time.Time) time.Time {
	if p.Days <= 0 {
		return time.Time{}
	}
	return now.AddDate(0, 0, -p.Days)
}

// Expired reports whether evidence created at createdAt is past retention at now.
func (p RetentionPolicy) Expired(createdAt, now time.Time) bool {
	cutoff := p.Cutoff(now)
	if cutoff.IsZero() {
		return false
	}
	return createdAt.Before(cutoff)
}

// redactedMarker is the only thing that should ever reach logs in place of
// verification PII.
const redactedMarker = "[redacted]"

// Redact returns a constant marker for any non-empty sensitive value, so
// verification identifiers / biometric references can never leak into logs,
// error messages, or audit payloads (invariant 5).
func Redact(s string) string {
	if s == "" {
		return ""
	}
	return redactedMarker
}

// RedactFields returns a copy of m with the given keys replaced by the redact
// marker — convenient for sanitising structured log/audit maps before they are
// written.
func RedactFields(m map[string]any, sensitiveKeys ...string) map[string]any {
	if m == nil {
		return nil
	}
	out := make(map[string]any, len(m))
	maps.Copy(out, m)
	for _, k := range sensitiveKeys {
		if _, ok := out[k]; ok {
			out[k] = redactedMarker
		}
	}
	return out
}

// ErrNoPepper is returned when constructing a Hasher without a server-side pepper.
// Hashing fails closed rather than silently using an empty key.
var ErrNoPepper = errors.New("connect: verification pepper is required")

// Hasher turns sensitive verification identifiers into non-reversible,
// deduplicable references. Mirrors the KYC bvn_hash/nin_hash convention.
type Hasher struct{ pepper []byte }

// NewHasher builds a Hasher from a server-side pepper (config.ConnectVerificationPepper).
func NewHasher(pepper string) (*Hasher, error) {
	if strings.TrimSpace(pepper) == "" {
		return nil, ErrNoPepper
	}
	return &Hasher{pepper: []byte(pepper)}, nil
}

// HashDocument returns HMAC-SHA256(pepper, docType:userID:docNumber) as hex.
// Binding userID means the same document under two accounts yields different
// hashes, preventing cross-account correlation while staying deduplicable per user.
// The raw docNumber is never persisted or logged.
func (h *Hasher) HashDocument(docType, userID, docNumber string) string {
	return cryptox.HMACSHA256Hex(string(h.pepper), docType+":"+userID+":"+docNumber)
}

// Handler exposes the Phase-1 selfie/liveness verification endpoints. Additive:
// it does not touch the Phase-0 primitives.
type Handler struct{ svc *StatusService }

// NewHandler builds the verification HTTP handler.
func NewHandler(svc *StatusService) *Handler { return &Handler{svc: svc} }

// selfieRequest is the member body for POST /verification/selfie. The fields hold
// transient, sensitive references that are NEVER logged — only forwarded to the
// provider and discarded.
type selfieRequest struct {
	Level         string `json:"level"` // "l0" | "l1" (defaults l0)
	SelfieRef     string `json:"selfie_ref" binding:"required"`
	LivenessToken string `json:"liveness_token"` // sensitive, transient; not persisted/logged
}

// Selfie — POST /api/v1/connect/verification/selfie (authenticated member).
// Runs an L0–L1 liveness check; evidence is stored encrypted/opaque, never raw.
func (h *Handler) Selfie(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: "authentication required"})
		return
	}
	var req selfieRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	level := VerificationLevel(req.Level)
	if req.Level != "" && !ValidLevel(level) {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "invalid verification level"})
		return
	}
	rec, err := h.svc.SubmitSelfie(c.Request.Context(), LivenessRequest{
		UserID:         userID,
		RequestedLevel: level,
		SelfieRef:      req.SelfieRef,
		LivenessToken:  req.LivenessToken,
	})
	if err != nil {
		// Reason codes/decisions surface in the record; only generic error text leaves here
		// (never the raw payload).
		c.JSON(http.StatusBadRequest, gin.H{keyError: "verification could not be processed"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rec})
}

// Status — GET /api/v1/connect/verification/status (authenticated member).
// Returns the caller's level + badge.
func (h *Handler) Status(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: "authentication required"})
		return
	}
	rec, err := h.svc.Get(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: "could not read verification status"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rec})
}

// This file is an ADDITIVE Phase-1 extension to the Phase-0 verification package.
// It introduces the L0–L1 selfie/liveness Provider abstraction and a stub
// implementation. It does NOT modify the existing hasher/redact/retention code.
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
