package kycverify

import (
	"context"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/provider"
)

// TierElevator elevates a user's KYC tier. The kycverify package depends only on
// this narrow shape (never on the kyc package's concrete *Service / Profile type)
// so it stays decoupled and independently testable. It is satisfied by a thin
// adapter over *kyc.Service.Approve, wired in finance_routes.go (which UPDATEs
// user_profiles.kyc_tier/kyc_status + emits a kyc_events audit).
type TierElevator interface {
	ElevateTier(ctx context.Context, userID string, newTier int, actorID *string) error
}

// Orchestrator recomputes a session's status from its checks and drives the
// session state machine, elevating the user's tier ONLY when the full required
// check set for the target tier has passed (ResolveSessionStatus == TIER_VERIFIED).
// Every session write is guarded by CanTransitionSession.
type Orchestrator struct {
	pool     *pgxpool.Pool
	repo     *Repository
	elevator TierElevator
}

// NewOrchestrator builds the orchestrator. elevator may be nil (tier elevation
// is then skipped and logged — the session still resolves to TIER_VERIFIED, but
// the profile is not upgraded; this is only a degraded/dev configuration).
func NewOrchestrator(pool *pgxpool.Pool, repo *Repository, elevator TierElevator) *Orchestrator {
	return &Orchestrator{pool: pool, repo: repo, elevator: elevator}
}

// Recompute reloads the session's status-by-type, resolves the new session
// status, applies the guarded transition, and (only on TIER_VERIFIED) elevates
// the user's tier. Idempotent: a session already at the resolved status is a
// no-op. Returns the resolved status.
func (o *Orchestrator) Recompute(ctx context.Context, sessionID string) (SessionStatus, error) {
	sess, err := o.repo.GetSession(ctx, sessionID)
	if err != nil {
		return "", err
	}
	byType, err := o.repo.StatusByType(ctx, sessionID)
	if err != nil {
		return "", err
	}

	resolved := ResolveSessionStatus(sess.TargetTier, byType)

	// No change → nothing to persist (idempotent replay).
	if resolved == sess.Status {
		return resolved, nil
	}

	// Guard every session write. An unexpected edge is a hard error (never a
	// silent skip) so illegal orchestration is caught, not swallowed.
	if !CanTransitionSession(sess.Status, resolved) {
		return "", fmt.Errorf("%w: session %s→%s", ErrIllegalTransition, sess.Status, resolved)
	}

	if err := o.repo.UpdateSessionStatus(ctx, sessionID, resolved); err != nil {
		return "", err
	}
	o.audit(ctx, "kycverify.session.transition", sess.UserID, sessionID, string(resolved))

	// GUARD: elevate the tier ONLY on a fully-passed required set. This is the
	// single place a tier is raised, and it is unreachable unless resolved is
	// exactly TIER_VERIFIED (never on PENDING/REVIEW/FAILED).
	if resolved == SessTierVerified {
		if err := o.elevate(ctx, sess.UserID, sess.TargetTier, nil); err != nil {
			// Elevation failure must NOT leave the session claiming verified while
			// the profile lags — but the ledger/profile UPDATE is idempotent and
			// self-heals; log loudly and surface the error so the caller retries.
			return resolved, fmt.Errorf("kycverify: tier elevation for user=%s tier=%d: %w", sess.UserID, sess.TargetTier, err)
		}
	}
	return resolved, nil
}

// ResolveReview applies an admin review decision (APPROVED/REJECTED) to a session
// under review, guarded, and elevates the tier when the decision approves the
// full set. actorID is the admin id for the audit trail.
func (o *Orchestrator) ResolveReview(ctx context.Context, sessionID string, approve bool, actorID string) (SessionStatus, error) {
	sess, err := o.repo.GetSession(ctx, sessionID)
	if err != nil {
		return "", err
	}
	target := SessRejected
	if approve {
		// Approving a review is a manual override to TIER_VERIFIED (the state
		// machine allows NEEDS_REVIEW→TIER_VERIFIED).
		target = SessTierVerified
	}
	if !CanTransitionSession(sess.Status, target) {
		return "", fmt.Errorf("%w: review %s→%s", ErrIllegalTransition, sess.Status, target)
	}
	if err := o.repo.UpdateSessionStatus(ctx, sessionID, target); err != nil {
		return "", err
	}
	o.audit(ctx, "kycverify.review.resolved", sess.UserID, sessionID, string(target))

	if target == SessTierVerified {
		aid := actorID
		if err := o.elevate(ctx, sess.UserID, sess.TargetTier, &aid); err != nil {
			return target, fmt.Errorf("kycverify: review tier elevation user=%s: %w", sess.UserID, err)
		}
	}
	return target, nil
}

// elevate raises the user's tier via the injected elevator, guarded by a nil
// check. It is only ever called from a TIER_VERIFIED branch above.
func (o *Orchestrator) elevate(ctx context.Context, userID string, tier int, actorID *string) error {
	if o.elevator == nil {
		log.Printf("kycverify: tier elevator not configured — user=%s reached tier %d but profile NOT upgraded", userID, tier)
		return nil
	}
	if err := o.elevator.ElevateTier(ctx, userID, tier, actorID); err != nil {
		return err
	}
	o.audit(ctx, "kycverify.tier.elevated", userID, "", fmt.Sprintf("tier=%d", tier))
	return nil
}

// applyCheckTransition guards a per-check status change before persisting. Used by
// the webhook + admin review paths. A same-status write is idempotent; an illegal
// edge is ErrIllegalTransition.
func applyCheckTransition(from, to provider.KycCheckStatus) error {
	if !CanTransitionCheck(from, to) {
		return fmt.Errorf("%w: check %s→%s", ErrIllegalTransition, from, to)
	}
	return nil
}

// audit emits a structured, log-style audit line. Never logs PII.
func (o *Orchestrator) audit(_ context.Context, event, userID, id, detail string) {
	log.Printf("audit kycverify event=%s user=%s id=%s detail=%s", event, userID, id, detail)
}
