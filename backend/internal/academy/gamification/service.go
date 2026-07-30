package gamification

import (
	"context"
	"time"
)

// Service orchestrates engagement mechanics. It NEVER moves money or touches the
// wallet ledger — that boundary belongs exclusively to the rewards package.
type Service struct {
	repo *Repository
	cfg  Config
	now  func() time.Time // injectable clock for deterministic streak tests
}

func NewService(repo *Repository, cfg Config) *Service {
	if cfg.LevelBaseXP == 0 && cfg.MaxLevel == 0 {
		cfg = DefaultConfig()
	}
	return &Service{repo: repo, cfg: cfg, now: time.Now}
}

// WithClock overrides the clock (tests).
func (s *Service) WithClock(now func() time.Time) *Service { s.now = now; return s }

func (s *Service) loadOrInit(ctx context.Context, userID string) (*Profile, error) {
	p, err := s.repo.GetProfile(ctx, userID)
	if err == nil {
		return p, nil
	}
	if !IsNoRows(err) {
		return nil, err
	}
	return &Profile{UserID: userID, XP: 0, Level: 1, StreakDays: 0, Freezes: 0}, nil
}

// AwardXP adds XP for an engagement action and recomputes the level from the
// configured curve. Returns the updated profile. No money is involved.
func (s *Service) AwardXP(ctx context.Context, userID, action string, amount int64) (*Profile, error) {
	if amount < 0 {
		amount = 0
	}
	p, err := s.loadOrInit(ctx, userID)
	if err != nil {
		return nil, err
	}
	p.XP += amount
	p.Level = levelForXP(p.XP, s.cfg)
	if err := s.repo.UpsertProfile(ctx, p); err != nil {
		return nil, err
	}
	return p, nil
}

// ExtendStreak records that today's daily goal was met, applying freeze-token
// logic. Idempotent within a calendar day.
func (s *Service) ExtendStreak(ctx context.Context, userID string) (*Profile, error) {
	p, err := s.loadOrInit(ctx, userID)
	if err != nil {
		return nil, err
	}
	last := ""
	if p.LastActive != nil {
		last = *p.LastActive
	}
	out := applyStreak(p.StreakDays, p.Freezes, last, s.now().UTC(), s.cfg)
	p.StreakDays = out.StreakDays
	p.Freezes = out.Freezes
	la := out.NewLastActive
	p.LastActive = &la
	if err := s.repo.UpsertProfile(ctx, p); err != nil {
		return nil, err
	}
	return p, nil
}

// GrantFreeze awards one freeze token up to the configured cap.
func (s *Service) GrantFreeze(ctx context.Context, userID string) (*Profile, error) {
	p, err := s.loadOrInit(ctx, userID)
	if err != nil {
		return nil, err
	}
	p.Freezes = grantFreeze(p.Freezes, s.cfg)
	if err := s.repo.UpsertProfile(ctx, p); err != nil {
		return nil, err
	}
	return p, nil
}

// EvaluateBadges grants any badge whose criteria the user now satisfies. Grants
// are idempotent (PK user_id, badge_id); returns the codes newly granted.
func (s *Service) EvaluateBadges(ctx context.Context, userID string, counters map[string]int64) ([]string, error) {
	p, err := s.loadOrInit(ctx, userID)
	if err != nil {
		return nil, err
	}
	badges, err := s.repo.ListBadges(ctx)
	if err != nil {
		return nil, err
	}
	already, err := s.repo.ListUserBadges(ctx, userID)
	if err != nil {
		return nil, err
	}
	owned := make(map[string]bool, len(already))
	for _, ub := range already {
		owned[ub.BadgeID] = true
	}
	stats := BadgeStats{XP: p.XP, Level: p.Level, StreakDays: p.StreakDays, Counters: counters}
	var granted []string
	for _, b := range badges {
		if owned[b.ID] {
			continue
		}
		if badgeEarned(b.Criteria, stats) {
			ok, err := s.repo.GrantBadge(ctx, userID, b.ID)
			if err != nil {
				return granted, err
			}
			if ok {
				granted = append(granted, b.Code)
			}
		}
	}
	return granted, nil
}

// ── Read helpers for handlers ───────────────────────────────────────────────────

func (s *Service) GetProfile(ctx context.Context, userID string) (*Profile, error) {
	return s.loadOrInit(ctx, userID)
}

func (s *Service) GetBadges(ctx context.Context, userID string) ([]UserBadge, error) {
	return s.repo.ListUserBadges(ctx, userID)
}

func (s *Service) GetChallenges(ctx context.Context) ([]Challenge, error) {
	return s.repo.ListChallenges(ctx)
}

func (s *Service) GetLeaderboard(ctx context.Context, id, periodKey string, limit int) (*Leaderboard, []LeaderboardEntry, error) {
	lb, err := s.repo.GetLeaderboard(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	entries, err := s.repo.RankedEntries(ctx, id, periodKey, limit)
	if err != nil {
		return nil, nil, err
	}
	return lb, entries, nil
}

// RecordLeaderboardScore is the engagement write path for ladders.
func (s *Service) RecordLeaderboardScore(ctx context.Context, leaderboardID, userID, periodKey string, delta int64) error {
	return s.repo.AddLeaderboardScore(ctx, leaderboardID, userID, periodKey, delta)
}

// ── Admin CRUD passthroughs ─────────────────────────────────────────────────────

func (s *Service) AdminUpsertBadge(ctx context.Context, in UpsertBadgeRequest) (*Badge, error) {
	return s.repo.UpsertBadge(ctx, in)
}
func (s *Service) AdminUpsertChallenge(ctx context.Context, in UpsertChallengeRequest) (*Challenge, error) {
	return s.repo.UpsertChallenge(ctx, in)
}
func (s *Service) AdminUpsertLeaderboard(ctx context.Context, in UpsertLeaderboardRequest) (*Leaderboard, error) {
	return s.repo.UpsertLeaderboard(ctx, in)
}
func (s *Service) AdminListBadges(ctx context.Context) ([]Badge, error) {
	return s.repo.ListBadges(ctx)
}

// AdminConfig is the aggregate gamification-config view: the configured badges,
// challenges and leaderboards. Composed from the existing list queries (read-only).
type AdminConfig struct {
	Badges       []Badge       `json:"badges"`
	Challenges   []Challenge   `json:"challenges"`
	Leaderboards []Leaderboard `json:"leaderboards"`
}

// AdminGetConfig composes the badges + challenges + leaderboards config surface.
func (s *Service) AdminGetConfig(ctx context.Context) (*AdminConfig, error) {
	badges, err := s.repo.ListBadges(ctx)
	if err != nil {
		return nil, err
	}
	challenges, err := s.repo.ListChallenges(ctx)
	if err != nil {
		return nil, err
	}
	leaderboards, err := s.repo.ListLeaderboards(ctx)
	if err != nil {
		return nil, err
	}
	return &AdminConfig{Badges: badges, Challenges: challenges, Leaderboards: leaderboards}, nil
}
