package gamification

import (
	"context"
	"errors"
	"fmt"
	"time"

	referralledger "spotlight/backend/internal/referral/ledger"
)

// Service drives gamification reads and the mission-claim flow. Cash rewards on
// claim are granted via RB0's ledger.Accrue (idempotent); NON-CASH points stay in
// the gamification tables only.
type Service struct {
	repo   *Repository
	reward *referralledger.Service // RB0 reward ledger (Accrue)
}

func NewService(repo *Repository, reward *referralledger.Service) *Service {
	return &Service{repo: repo, reward: reward}
}

// ListMissions returns active missions (member) merged with the caller's progress.
type MissionView struct {
	Mission  Mission `json:"mission"`
	Progress int     `json:"progress"`
	Status   string  `json:"status"`
}

func (s *Service) ListMissions(ctx context.Context, userID string) ([]MissionView, error) {
	missions, err := s.repo.ListActiveMissions(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]MissionView, 0, len(missions))
	for _, m := range missions {
		p, err := s.repo.GetProgress(ctx, m.ID, userID)
		if err != nil {
			return nil, err
		}
		out = append(out, MissionView{Mission: m, Progress: p.Progress, Status: p.Status})
	}
	return out, nil
}

// MyProgress returns all of a user's mission progress rows + total points.
func (s *Service) MyProgress(ctx context.Context, userID string) ([]MissionProgress, int, error) {
	rows, err := s.repo.ListUserProgress(ctx, userID)
	if err != nil {
		return nil, 0, err
	}
	pts, err := s.repo.UserPoints(ctx, userID)
	if err != nil {
		return nil, 0, err
	}
	return rows, pts, nil
}

// Claim claims a completed mission for a user exactly once. It flips the progress
// row to 'claimed' (idempotent via the claim key) and, when the mission carries a
// cash reward, accrues it through the RB0 reward ledger using the SAME key so the
// money grant is also idempotent. Points are non-cash and require no ledger entry.
func (s *Service) Claim(ctx context.Context, missionID, userID, idemKey string) (*ClaimResult, error) {
	if idemKey == "" {
		return nil, errors.New("gamification: Idempotency-Key required to claim")
	}
	m, err := s.repo.GetMission(ctx, missionID)
	if err != nil {
		return nil, errors.New("gamification: mission not found")
	}
	claimed, err := s.repo.MarkClaimed(ctx, missionID, userID, idemKey)
	if err != nil {
		return nil, err
	}
	if !claimed {
		// Either not yet completed, or already claimed — report current state.
		p, _ := s.repo.GetProgress(ctx, missionID, userID)
		if p != nil && p.Status == ProgressClaimed {
			return &ClaimResult{MissionID: missionID, Status: ProgressClaimed}, nil
		}
		return nil, errors.New("gamification: mission not completed yet")
	}

	res := &ClaimResult{
		MissionID:     missionID,
		PointsAwarded: m.PointsReward,
		Status:        ProgressClaimed,
	}

	// Optional cash reward → RB0 ledger.Accrue (idempotent on the claim key).
	if m.CashRewardKobo > 0 && s.reward != nil {
		rewardID, err := s.reward.Accrue(ctx, referralledger.AccrueInput{
			BeneficiaryID:  userID,
			CampaignID:     m.CampaignID,
			Kind:           referralledger.KindMission,
			AmountKobo:     m.CashRewardKobo,
			Currency:       "NGN",
			IdempotencyKey: "mission_claim:" + missionID + ":" + userID,
		})
		if err != nil {
			return nil, fmt.Errorf("gamification: accrue cash reward: %w", err)
		}
		res.CashRewardKobo = m.CashRewardKobo
		res.RewardLedgerID = rewardID
	}
	return res, nil
}

// ListRanks / ListBadges / Leaderboard / Contests are read-throughs.
func (s *Service) ListRanks(ctx context.Context) ([]Rank, error)   { return s.repo.ListRanks(ctx) }
func (s *Service) ListBadges(ctx context.Context) ([]Badge, error) { return s.repo.ListBadges(ctx) }

func (s *Service) Leaderboard(ctx context.Context, period, scope string, limit int) ([]LeaderboardEntry, error) {
	if period == "" {
		period = "all-time"
	}
	if scope == "" {
		scope = "global"
	}
	return s.repo.Leaderboard(ctx, period, scope, limit)
}

func (s *Service) ListContests(ctx context.Context, onlyActive bool) ([]Contest, error) {
	return s.repo.ListContests(ctx, onlyActive)
}

func (s *Service) CreateMission(ctx context.Context, in MissionInput) (*Mission, error) {
	if in.Slug == "" || in.Title == "" {
		return nil, errors.New("gamification: slug and title required")
	}
	return s.repo.CreateMission(ctx, in)
}

func (s *Service) CreateRank(ctx context.Context, in RankInput) (*Rank, error) {
	if in.Slug == "" || in.Name == "" {
		return nil, errors.New("gamification: slug and name required")
	}
	return s.repo.CreateRank(ctx, in)
}

// MyRank resolves a user's current rank from their non-cash point total.
func (s *Service) MyRank(ctx context.Context, userID string) (*Rank, int, error) {
	pts, err := s.repo.UserPoints(ctx, userID)
	if err != nil {
		return nil, 0, err
	}
	ranks, err := s.repo.ListRanks(ctx)
	if err != nil {
		return nil, 0, err
	}
	var cur *Rank
	for i := range ranks {
		if pts >= ranks[i].MinPoints {
			r := ranks[i]
			cur = &r
		}
	}
	return cur, pts, nil
}

// Mission progress statuses.
const (
	ProgressInProgress = "in_progress"
	ProgressCompleted  = "completed"
	ProgressClaimed    = "claimed"
)

// Mission is a quest/mission/streak/challenge definition.
type Mission struct {
	ID             string     `json:"id"`
	Slug           string     `json:"slug"`
	Title          string     `json:"title"`
	Description    string     `json:"description,omitempty"`
	MissionType    string     `json:"mission_type"`
	TargetCount    int        `json:"target_count"`
	PointsReward   int        `json:"points_reward"`    // NON-CASH
	CashRewardKobo int64      `json:"cash_reward_kobo"` // OPTIONAL; granted via RB0 ledger
	CampaignID     string     `json:"campaign_id,omitempty"`
	IsActive       bool       `json:"is_active"`
	StartsAt       *time.Time `json:"starts_at,omitempty"`
	EndsAt         *time.Time `json:"ends_at,omitempty"`
}

// MissionProgress is a user's progress against a mission.
type MissionProgress struct {
	ID        string     `json:"id"`
	MissionID string     `json:"mission_id"`
	UserID    string     `json:"user_id"`
	Progress  int        `json:"progress"`
	Status    string     `json:"status"`
	ClaimedAt *time.Time `json:"claimed_at,omitempty"`
}

// Rank is a non-cash tier with a points threshold.
type Rank struct {
	ID        string         `json:"id"`
	Slug      string         `json:"slug"`
	Name      string         `json:"name"`
	TierOrder int            `json:"tier_order"`
	MinPoints int            `json:"min_points"`
	Perks     map[string]any `json:"perks"`
}

// Badge is a non-cash award.
type Badge struct {
	ID          string         `json:"id"`
	Slug        string         `json:"slug"`
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	Icon        string         `json:"icon,omitempty"`
	Criteria    map[string]any `json:"criteria"`
}

// LeaderboardEntry is one materialised standing (non-cash).
type LeaderboardEntry struct {
	Period       string         `json:"period"`
	Scope        string         `json:"scope"`
	UserID       string         `json:"user_id"`
	RankPosition int            `json:"rank_position"`
	Points       int            `json:"points"`
	Metric       map[string]any `json:"metric"`
}

// Contest is a time-boxed competition.
type Contest struct {
	ID          string         `json:"id"`
	Slug        string         `json:"slug"`
	Title       string         `json:"title"`
	Description string         `json:"description,omitempty"`
	Status      string         `json:"status"`
	StartsAt    *time.Time     `json:"starts_at,omitempty"`
	EndsAt      *time.Time     `json:"ends_at,omitempty"`
	PrizeConfig map[string]any `json:"prize_config"`
	CampaignID  string         `json:"campaign_id,omitempty"`
}

// MissionInput is the admin mission-builder payload.
type MissionInput struct {
	Slug           string     `json:"slug"`
	Title          string     `json:"title"`
	Description    string     `json:"description"`
	MissionType    string     `json:"mission_type"`
	TargetCount    int        `json:"target_count"`
	PointsReward   int        `json:"points_reward"`
	CashRewardKobo int64      `json:"cash_reward_kobo"`
	CampaignID     string     `json:"campaign_id"`
	StartsAt       *time.Time `json:"starts_at"`
	EndsAt         *time.Time `json:"ends_at"`
	IsActive       bool       `json:"is_active"`
}

// RankInput is the admin rank-builder payload.
type RankInput struct {
	Slug      string         `json:"slug"`
	Name      string         `json:"name"`
	TierOrder int            `json:"tier_order"`
	MinPoints int            `json:"min_points"`
	Perks     map[string]any `json:"perks"`
}

// ClaimResult is returned when a mission reward is claimed.
type ClaimResult struct {
	MissionID      string `json:"mission_id"`
	PointsAwarded  int    `json:"points_awarded"`
	CashRewardKobo int64  `json:"cash_reward_kobo"`
	RewardLedgerID string `json:"reward_ledger_id,omitempty"`
	Status         string `json:"status"`
}
