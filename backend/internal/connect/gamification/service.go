package connectgamification

import (
	"context"
	"errors"
)

var (
	ErrNotFound     = errors.New("connect: gamification record not found")
	ErrInvalidInput = errors.New("connect: invalid input")
	ErrNotClaimable = errors.New("connect: mission is not completed or already claimed")
)

// Auditor mirrors the per-package Connect interface; admin mutations flow through it.
type Auditor interface {
	WriteAudit(ctx context.Context, action, actorID, entityType, entityID string, newValue map[string]any) error
}

// Service owns the non-cash XP / missions / streaks / leaderboards / seasons logic.
//
// NON-CASH: XP and coins are points only. This service NEVER calls the finance
// ledger/wallet and exposes NO money-conversion API.
type Service struct {
	repo  *Repository
	audit Auditor
}

func NewService(repo *Repository, audit Auditor) *Service {
	return &Service{repo: repo, audit: audit}
}

// xpPerLevel is the flat XP cost of each level for the derived display level.
const xpPerLevel = 1000

func levelFor(totalXP int64) int {
	if totalXP <= 0 {
		return 1
	}
	return int(totalXP/xpPerLevel) + 1
}

// AwardXP grants non-cash XP idempotently keyed on event_key. A repeated event_key
// is a no-op (no double-counting). Returns whether the grant was newly applied.
func (s *Service) AwardXP(ctx context.Context, userID string, in AwardInput) (awarded bool, err error) {
	if in.EventKey == "" || in.XP <= 0 {
		return false, ErrInvalidInput
	}
	inserted, err := s.repo.InsertXPIfNew(ctx, userID, in.EventKey, in.Source, in.XP)
	if err != nil {
		return false, err
	}
	return inserted, nil
}

// Home returns the gamification dashboard (all non-cash).
func (s *Service) Home(ctx context.Context, userID string) (*Home, error) {
	totalXP, err := s.repo.TotalXP(ctx, userID)
	if err != nil {
		return nil, err
	}
	coins, err := s.repo.Coins(ctx, userID)
	if err != nil {
		return nil, err
	}
	streak, err := s.repo.GetStreak(ctx, userID)
	if err != nil {
		return nil, err
	}
	season, err := s.repo.ActiveSeasonCode(ctx)
	if err != nil {
		return nil, err
	}
	return &Home{
		UserID:     userID,
		TotalXP:    totalXP,
		Level:      levelFor(totalXP),
		Coins:      coins,
		StreakDays: streak.CurrentDays,
		SeasonCode: season,
	}, nil
}

// Missions returns the user's progress against active missions.
func (s *Service) Missions(ctx context.Context, userID string) ([]MissionProgress, error) {
	return s.repo.MissionProgressFor(ctx, userID)
}

// ClaimMission claims a completed mission's non-cash reward exactly once.
func (s *Service) ClaimMission(ctx context.Context, userID, missionID string) (*Mission, error) {
	m, err := s.repo.GetMission(ctx, missionID)
	if err != nil {
		return nil, err
	}
	ok, err := s.repo.ClaimMission(ctx, userID, missionID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNotClaimable
	}
	// Grant non-cash rewards: XP via idempotent ledger key, coins to the balance.
	if m.RewardXP > 0 {
		_, _ = s.repo.InsertXPIfNew(ctx, userID, "mission:"+missionID, "mission", m.RewardXP)
	}
	if m.RewardCoin > 0 {
		_ = s.repo.AddCoins(ctx, userID, m.RewardCoin)
	}
	return m, nil
}

// TickStreak advances the daily streak (idempotent per day).
func (s *Service) TickStreak(ctx context.Context, userID string) (*Streak, error) {
	return s.repo.TickStreak(ctx, userID)
}

// Streaks returns the user's current streak.
func (s *Service) Streaks(ctx context.Context, userID string) (*Streak, error) {
	return s.repo.GetStreak(ctx, userID)
}

// Leaderboards ranks users by non-cash XP.
func (s *Service) Leaderboards(ctx context.Context, limit int) ([]LeaderboardEntry, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	return s.repo.Leaderboard(ctx, limit)
}

// Seasons lists season-pass periods.
func (s *Service) Seasons(ctx context.Context) ([]Season, error) {
	return s.repo.ListSeasons(ctx)
}

// --- Admin ---

func (s *Service) ListMissionsAdmin(ctx context.Context) ([]Mission, error) {
	return s.repo.ListMissions(ctx, true)
}

func (s *Service) UpsertMission(ctx context.Context, actorID string, in UpsertMissionInput) (*Mission, error) {
	if in.Code == "" || in.Title == "" {
		return nil, ErrInvalidInput
	}
	m, err := s.repo.UpsertMission(ctx, in)
	if err != nil {
		return nil, err
	}
	_ = s.audit.WriteAudit(ctx, "connect.gamification.mission.upsert", actorID, "connect_mission", m.ID,
		map[string]any{"code": m.Code, "active": m.Active})
	return m, nil
}

func (s *Service) UpsertSeason(ctx context.Context, actorID string, in UpsertSeasonInput) (*Season, error) {
	if in.Code == "" || in.Name == "" {
		return nil, ErrInvalidInput
	}
	se, err := s.repo.UpsertSeason(ctx, in)
	if err != nil {
		return nil, err
	}
	_ = s.audit.WriteAudit(ctx, "connect.gamification.season.upsert", actorID, "connect_season", se.ID,
		map[string]any{"code": se.Code, "active": se.Active})
	return se, nil
}
