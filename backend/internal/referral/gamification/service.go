package gamification

import (
	"context"
	"fmt"

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
		return nil, fmt.Errorf("gamification: Idempotency-Key required to claim")
	}
	m, err := s.repo.GetMission(ctx, missionID)
	if err != nil {
		return nil, fmt.Errorf("gamification: mission not found")
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
		return nil, fmt.Errorf("gamification: mission not completed yet")
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

// --- admin builders ---

func (s *Service) CreateMission(ctx context.Context, in MissionInput) (*Mission, error) {
	if in.Slug == "" || in.Title == "" {
		return nil, fmt.Errorf("gamification: slug and title required")
	}
	return s.repo.CreateMission(ctx, in)
}

func (s *Service) CreateRank(ctx context.Context, in RankInput) (*Rank, error) {
	if in.Slug == "" || in.Name == "" {
		return nil, fmt.Errorf("gamification: slug and name required")
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
