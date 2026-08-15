package connectvoting

import (
	"context"
	"fmt"
	"time"
)

// TriggerEvictions marks the bottom 20% of contestants for eviction.
func (s *Service) TriggerEvictions(ctx context.Context, contestID string, req EvictionRequest, actorID string) ([]EvictionResponse, error) {
	// Call Supabase RPC to trigger evictions atomically
	results, err := s.repo.TriggerEvictions(ctx, contestID, req.StageNumber, req.EvictionPercentage, req.GracePeriodHours, actorID)
	if err != nil {
		return nil, fmt.Errorf("failed to trigger evictions: %w", err)
	}

	// Audit log
	if s.audit != nil {
		s.audit.WriteAudit(ctx, "evict_contestants", actorID, "contest", contestID, map[string]any{
			"stage_number":        req.StageNumber,
			"eviction_percentage": req.EvictionPercentage,
			"grace_period_hours":  req.GracePeriodHours,
			"count":               len(results),
		})
	}

	return results, nil
}

// SaveContestant saves a contestant from eviction.
// Judges can save only one per stage; admins can save unlimited.
func (s *Service) SaveContestant(ctx context.Context, evictionID, actorID, saveType, reason string) (*SaveResponse, error) {
	result, err := s.repo.SaveContestant(ctx, evictionID, actorID, saveType, reason)
	if err != nil {
		return nil, fmt.Errorf("failed to save contestant: %w", err)
	}

	// Audit log
	if s.audit != nil {
		s.audit.WriteAudit(ctx, "save_contestant", actorID, "eviction", evictionID, map[string]any{
			"save_type": saveType,
			"reason":    reason,
		})
	}

	return result, nil
}

// ExtendGracePeriod extends the grace period for evictions.
func (s *Service) ExtendGracePeriod(ctx context.Context, evictionID string, additionalHours int, actorID string) (*SaveResponse, error) {
	result, err := s.repo.ExtendGracePeriod(ctx, evictionID, additionalHours, actorID)
	if err != nil {
		return nil, fmt.Errorf("failed to extend grace period: %w", err)
	}

	// Audit log
	if s.audit != nil {
		s.audit.WriteAudit(ctx, "extend_grace_period", actorID, "eviction", evictionID, map[string]any{
			"additional_hours": additionalHours,
		})
	}

	return result, nil
}

// FinalizeEvictions finalizes evictions after grace period ends.
func (s *Service) FinalizeEvictions(ctx context.Context, contestID string, stageNumber int) (*SaveResponse, error) {
	result, err := s.repo.FinalizeEvictions(ctx, contestID, stageNumber)
	if err != nil {
		return nil, fmt.Errorf("failed to finalize evictions: %w", err)
	}

	// Audit log
	if s.audit != nil {
		s.audit.WriteAudit(ctx, "finalize_evictions", "system", "contest", contestID, map[string]any{
			"stage_number": stageNumber,
		})
	}

	return result, nil
}

// GetContestantsByStage retrieves all contestants in a stage with eviction status.
type StageContestant struct {
	ID               string     `json:"id"`
	Name             string     `json:"name"`
	PhotoURL         string     `json:"photo_url"`
	VoteCount        int        `json:"vote_count"`
	EvictionStatus   string     `json:"eviction_status"`
	EvictionTemplate string     `json:"eviction_template"`
	EvictionID       *string    `json:"eviction_id,omitempty"`
	GracePeriodEnd   *time.Time `json:"grace_period_end,omitempty"`
}

func (s *Service) GetContestantsByStage(ctx context.Context, contestID string, stageNumber int) ([]StageContestant, error) {
	contestants, err := s.repo.GetContestantsByStage(ctx, contestID, stageNumber)
	if err != nil {
		return nil, fmt.Errorf("failed to get contestants: %w", err)
	}

	return contestants, nil
}

// EvictionInfo represents a single pending eviction
type EvictionInfo struct {
	ID                string    `json:"id"`
	ContestantID      string    `json:"contestant_id"`
	ContestantName    string    `json:"contestant_name"`
	StageNumber       int       `json:"stage_number"`
	VoteCount         int       `json:"vote_count"`
	EvictionRank      int       `json:"eviction_rank"`
	GracePeriodEndsAt time.Time `json:"grace_period_ends_at"`
	Status            string    `json:"status"`
	SaveCount         int       `json:"save_count"`
	CanBeSaved        bool      `json:"can_be_saved"`
}

// GetEvictions retrieves all pending evictions for a contest.
func (s *Service) GetEvictions(ctx context.Context, contestID string, stageNum string) ([]EvictionInfo, error) {
	evictions, err := s.repo.GetEvictions(ctx, contestID, stageNum)
	if err != nil {
		return nil, fmt.Errorf("failed to get evictions: %w", err)
	}

	return evictions, nil
}

// AdminVote allows admin to vote unlimited without payment.
func (s *Service) AdminVote(ctx context.Context, contestID, contestantID, actorID string, voteQuantity int) (*Vote, error) {
	// Verify contest exists
	_, err := s.repo.GetContest(ctx, contestID)
	if err != nil {
		return nil, ErrNotFound
	}

	// Record the admin vote directly (no ledger debit, no idempotency key needed)
	vote, err := s.repo.AdminVote(ctx, contestID, contestantID, actorID, voteQuantity)
	if err != nil {
		return nil, fmt.Errorf("failed to record admin vote: %w", err)
	}

	// Audit log
	if s.audit != nil {
		s.audit.WriteAudit(ctx, "admin_vote", actorID, "contest", contestID, map[string]any{
			"contestant_id": contestantID,
			"vote_quantity": voteQuantity,
		})
	}

	return vote, nil
}
