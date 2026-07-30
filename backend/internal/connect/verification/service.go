package connectverification

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
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
var allowedTransitions = map[string]map[string]bool{
	StatusNone:     {StatusPending: true},
	StatusPending:  {StatusL0Passed: true, StatusL1Passed: true, StatusFailed: true, StatusRejected: true},
	StatusL0Passed: {StatusPending: true, StatusL1Passed: true, StatusFailed: true, StatusRejected: true},
	StatusFailed:   {StatusPending: true},
	StatusRejected: {}, // terminal (admin-only re-open out of scope for Phase 1)
	StatusL1Passed: {StatusRejected: true},
}

func canTransition(from, to string) bool {
	if from == to {
		return true // idempotent re-assert of the same state
	}
	next, ok := allowedTransitions[from]
	return ok && next[to]
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
	defer tx.Rollback(ctx)

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
	// Validate the final transition against the guard.
	if !canTransition(current, target) {
		// none→pending→outcome is the normal path; allow none→outcome directly,
		// but reject e.g. l1_passed→l0_passed downgrades.
		if !(canTransition(current, StatusPending) && canTransition(StatusPending, target)) {
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
