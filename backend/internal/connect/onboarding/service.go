package connectonboarding

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	connectsafety "spotlight/backend/internal/connect/safety"
)

// Service runs the age gate and routes suspected minors to the underage queue.
type Service struct {
	db     *pgxpool.Pool
	safety *connectsafety.Service
}

func NewService(db *pgxpool.Pool, safety *connectsafety.Service) *Service {
	return &Service{db: db, safety: safety}
}

// AgeGate evaluates a DOB fail-closed. On an unparseable/future date it blocks
// without asserting minority; on age < 18 it flags the user for admin review.
// The decision is the source of truth — audit writes are best-effort and never
// flip a block to a pass.
func (s *Service) AgeGate(ctx context.Context, userID, dobStr, ip string) (AgeGateResult, error) {
	now := time.Now().UTC()
	dob, err := time.Parse(dobLayout, dobStr)
	if err != nil || dob.After(now) {
		_ = s.audit(ctx, userID, "connect.agegate.invalid", ip, map[string]any{"dob": dobStr})
		return AgeGateResult{Allowed: false, Reason: "invalid_dob"}, nil
	}

	age := ComputeAge(dob, now)
	if age < MinAdultAge {
		// Fail-closed critical write: the user MUST land in the review queue.
		const ins = `INSERT INTO connect_underage_flags (user_id, reason, dob, status)
			VALUES ($1, $2, $3, 'queued')
			ON CONFLICT (user_id) DO NOTHING`
		if _, err := s.db.Exec(ctx, ins, userID, "under_18_at_age_gate", dob); err != nil {
			return AgeGateResult{}, fmt.Errorf("connect: enqueue underage flag: %w", err)
		}
		_ = s.audit(ctx, userID, "connect.agegate.blocked_minor", ip, map[string]any{"age": age})
		return AgeGateResult{Allowed: false, Reason: "under_18", Age: age}, nil
	}

	// Persist the passed gate into the onboarding state (best-effort; the gate
	// decision itself is already final and is returned regardless).
	_ = s.markAgeVerified(ctx, userID)
	_ = s.audit(ctx, userID, "connect.agegate.passed", ip, map[string]any{"age": age})
	return AgeGateResult{Allowed: true, Age: age}, nil
}

func (s *Service) audit(ctx context.Context, userID, action, ip string, payload map[string]any) error {
	return s.safety.WriteAudit(ctx, connectsafety.AuditInput{
		ActorID:    userID,
		Action:     action,
		EntityType: "connect_age_gate",
		EntityID:   userID,
		IP:         ip,
		NewValue:   payload,
	})
}
