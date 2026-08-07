// Package events is the append-only recorder for the referral engine event
// stream (referral_engine_events). Every attribution/ledger transition records
// an immutable, idempotent event (idempotency_key UNIQUE) used for audit and
// analytics (§11, §12). A duplicate key is a safe no-op.
package events

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Event type constants (subset of §12 analytics events relevant to §7A).
const (
	TypeSignupAttributed      = "signup_attributed"
	TypeAttributionToHouse    = "attribution_defaulted_to_house"
	TypeLateClaimed           = "referral_code_late_claimed"
	TypeReassigned            = "attribution_reassigned"
	TypeInvalidCodeAttempt    = "invalid_code_attempt"
	TypeSelfReferralBlocked   = "self_referral_blocked"
	TypeRewardAccrued         = "reward_accrued"
	TypeRewardStateTransition = "reward_state_transition"
	TypeRewardClawedBack      = "reward_clawed_back"
)

// Input describes one engine event to record.
type Input struct {
	EventType      string
	UserID         string // optional ("" → NULL)
	ReferrerID     string // optional ("" → NULL)
	CampaignID     string // optional ("" → NULL)
	Payload        map[string]any
	IdempotencyKey string
}

// Service records engine events.
type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

// Record appends one event. Idempotent: a duplicate idempotency_key is ignored.
func (s *Service) Record(ctx context.Context, in Input) error {
	payload := in.Payload
	if payload == nil {
		payload = map[string]any{}
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("referral/events: marshal payload: %w", err)
	}
	const q = `
		INSERT INTO referral_engine_events
			(event_type, user_id, referrer_id, campaign_id, payload, idempotency_key)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (idempotency_key) DO NOTHING`
	if _, err := s.db.Exec(ctx, q,
		in.EventType,
		nullable(in.UserID),
		nullable(in.ReferrerID),
		nullable(in.CampaignID),
		raw,
		in.IdempotencyKey,
	); err != nil {
		return fmt.Errorf("referral/events: record %q: %w", in.EventType, err)
	}
	return nil
}

// nullable maps an empty string to a nil interface so pgx writes SQL NULL.
func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}
