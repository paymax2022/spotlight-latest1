package connectgamification

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
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

// XPEntry is one immutable, idempotent grant of non-cash XP. event_key makes a
// repeated award a no-op (idempotency), so XP is never double-counted.
type XPEntry struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	EventKey  string    `json:"event_key"`
	Source    string    `json:"source"`
	XP        int64     `json:"xp"` // NON-CASH points
	CreatedAt time.Time `json:"created_at"`
}

// Home is the gamification dashboard projection (all non-cash). TotalXP and Coins
// are points, NOT money; Level is derived from TotalXP.
type Home struct {
	UserID     string `json:"user_id"`
	TotalXP    int64  `json:"total_xp"`
	Level      int    `json:"level"`
	Coins      int64  `json:"coins"`
	StreakDays int    `json:"streak_days"`
	SeasonCode string `json:"season_code,omitempty"`
}

// Mission is a backend-owned task definition. Cadence is daily|weekly|season|once.
// RewardXP and RewardCoin are NON-CASH points.
type Mission struct {
	ID         string          `json:"id"`
	Code       string          `json:"code"`
	Title      string          `json:"title"`
	Cadence    string          `json:"cadence"`
	Target     int             `json:"target"`
	RewardXP   int64           `json:"reward_xp"`
	RewardCoin int64           `json:"reward_coins"`
	Meta       json.RawMessage `json:"meta,omitempty"`
	Active     bool            `json:"active"`
}

// MissionProgress is per-user progress against a mission.
type MissionProgress struct {
	MissionID string     `json:"mission_id"`
	Code      string     `json:"code,omitempty"`
	Progress  int        `json:"progress"`
	Target    int        `json:"target"`
	Completed bool       `json:"completed"`
	Claimed   bool       `json:"claimed"`
	ClaimedAt *time.Time `json:"claimed_at,omitempty"`
}

// Streak is the user's consecutive-day engagement counter.
type Streak struct {
	UserID      string     `json:"user_id"`
	CurrentDays int        `json:"current_days"`
	BestDays    int        `json:"best_days"`
	LastTickOn  *time.Time `json:"last_tick_on,omitempty"`
}

// LeaderboardEntry is a single ranked row (XP is non-cash).
type LeaderboardEntry struct {
	Rank   int    `json:"rank"`
	UserID string `json:"user_id"`
	XP     int64  `json:"xp"` // NON-CASH
}

// Season is a time-boxed pass period.
type Season struct {
	ID       string    `json:"id"`
	Code     string    `json:"code"`
	Name     string    `json:"name"`
	StartsAt time.Time `json:"starts_at"`
	EndsAt   time.Time `json:"ends_at"`
	Active   bool      `json:"active"`
}

type AwardInput struct {
	EventKey string `json:"event_key" binding:"required"` // idempotency key
	Source   string `json:"source"`
	XP       int64  `json:"xp" binding:"required"` // NON-CASH points
}

type UpsertMissionInput struct {
	Code       string          `json:"code" binding:"required"`
	Title      string          `json:"title" binding:"required"`
	Cadence    string          `json:"cadence"`
	Target     int             `json:"target"`
	RewardXP   int64           `json:"reward_xp"`
	RewardCoin int64           `json:"reward_coins"`
	Meta       json.RawMessage `json:"meta"`
	Active     *bool           `json:"active"`
}

type UpsertSeasonInput struct {
	Code     string    `json:"code" binding:"required"`
	Name     string    `json:"name" binding:"required"`
	StartsAt time.Time `json:"starts_at"`
	EndsAt   time.Time `json:"ends_at"`
	Active   *bool     `json:"active"`
}

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, ErrInvalidInput):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, ErrNotClaimable):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

// Home — GET /gamification/home.
func (h *Handler) Home(c *gin.Context) {
	out, err := h.svc.Home(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// Missions — GET /gamification/missions.
func (h *Handler) Missions(c *gin.Context) {
	out, err := h.svc.Missions(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ClaimMission — POST /gamification/missions/:id/claim.
func (h *Handler) ClaimMission(c *gin.Context) {
	m, err := h.svc.ClaimMission(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": m})
}

// Streaks — GET /gamification/streaks.
func (h *Handler) Streaks(c *gin.Context) {
	out, err := h.svc.Streaks(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// Leaderboards — GET /gamification/leaderboards?limit=.
func (h *Handler) Leaderboards(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	out, err := h.svc.Leaderboards(c.Request.Context(), limit)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// Seasons — GET /gamification/seasons.
func (h *Handler) Seasons(c *gin.Context) {
	out, err := h.svc.Seasons(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AdminListMissions — GET /gamification/missions (admin).
func (h *Handler) AdminListMissions(c *gin.Context) {
	out, err := h.svc.ListMissionsAdmin(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AdminUpsertMission — POST /gamification/missions (admin).
func (h *Handler) AdminUpsertMission(c *gin.Context) {
	var in UpsertMissionInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	m, err := h.svc.UpsertMission(c.Request.Context(), ginutil.UserID(c), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": m})
}

// AdminListSeasons — GET /gamification/seasons (admin).
func (h *Handler) AdminListSeasons(c *gin.Context) {
	out, err := h.svc.Seasons(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AdminUpsertSeason — POST /gamification/seasons (admin).
func (h *Handler) AdminUpsertSeason(c *gin.Context) {
	var in UpsertSeasonInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	se, err := h.svc.UpsertSeason(c.Request.Context(), ginutil.UserID(c), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": se})
}

// Register wires the gamification module onto the shared Connect member + admin
// groups. Admin routes add per-route RBAC (connect.gamification.*). NON-CASH: no
// money path is registered.
func Register(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, audit Auditor) {
	svc := NewService(NewRepository(pool), audit)
	h := NewHandler(svc)

	g := member.Group("/gamification")
	g.GET("/home", h.Home)
	g.GET("/missions", h.Missions)
	g.POST("/missions/:id/claim", h.ClaimMission)
	g.GET("/streaks", h.Streaks)
	g.GET("/leaderboards", h.Leaderboards)
	g.GET("/seasons", h.Seasons)

	ag := admin.Group("/gamification")
	ag.GET("/missions",
		middleware.RequirePermission(rbac, "connect.gamification.view"), h.AdminListMissions)
	ag.POST("/missions",
		middleware.RequirePermission(rbac, "connect.gamification.manage"), h.AdminUpsertMission)
	ag.GET("/seasons",
		middleware.RequirePermission(rbac, "connect.gamification.view"), h.AdminListSeasons)
	ag.POST("/seasons",
		middleware.RequirePermission(rbac, "connect.gamification.manage"), h.AdminUpsertSeason)
}
