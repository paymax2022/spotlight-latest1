// Package promotion is the audited service over the pure ladder FSM (§12). It
// persists each strategy's stage + readiness, enforces separation of duties
// (maker≠checker for promotions, a dedicated Risk sign-off + legal flag for Live),
// and appends an immutable event for every transition. It NEVER executes a trade.
package promotion

import (
	"errors"
	"time"

	"spotlight/backend/internal/trading/ladder"
)

// RBAC permission slugs — MUST match the seeds in migration 20261029000300.
const (
	PermPropose = "trading.promotion.propose" // maker
	PermApprove = "trading.promotion.approve" // checker
	PermHalt    = "trading.promotion.halt"    // Risk/admin — halt + de-risk
	PermRead    = "trading.promotion.read"
	PermRisk    = "trading.promotion.risk" // Risk sign-off for Canary→Live
)

// Strategy mirrors public.trading_strategy_promotions.
type Strategy struct {
	StrategyID       string
	Stage            ladder.Stage
	ValidationPassed bool
	TrackRecordDays  int
	CircuitTripped   bool
	Version          int
	UpdatedAt        time.Time
}

// Event mirrors public.trading_promotion_events (append-only audit).
type Event struct {
	StrategyID     string
	EventType      string
	OldStage       string
	NewStage       string
	MakerID        *string
	CheckerID      *string
	RiskSignedOff  *bool
	LegalSignedOff *bool
	Reason         string
	CreatedAt      time.Time
}

// Sentinel errors (mapped to HTTP by the handler).
var (
	ErrNotFound        = errors.New("trading promotion: strategy not found")
	ErrVersionConflict = errors.New("trading promotion: strategy changed concurrently, retry")
	ErrReasonRequired  = errors.New("trading promotion: reason is required")
	// ErrDenied wraps a ladder gate rejection (illegal transition / unmet gate).
	ErrDenied = errors.New("trading promotion: transition denied")
)

// DefaultRequirements are the track-record thresholds for promotion, fixed by
// policy. Conservative by design; tuned in the validation phase, never by a client.
func DefaultRequirements() ladder.Requirements {
	return ladder.Requirements{
		ShadowMinTrackRecordDays: 30,
		CanaryMinTrackRecordDays: 60,
		LiveMinTrackRecordDays:   90,
	}
}
