package gamification

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes member + admin gamification endpoints.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func userID(c *gin.Context) string { return c.GetString("user_id") }

// ── Member ──────────────────────────────────────────────────────────────────────

// GetProfile handles GET /gamification/profile.
func (h *Handler) GetProfile(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	p, err := h.svc.GetProfile(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, p)
}

// GetBadges handles GET /gamification/badges.
func (h *Handler) GetBadges(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	b, err := h.svc.GetBadges(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"badges": b})
}

// GetLeaderboard handles GET /gamification/leaderboards/:id?period_key=...
func (h *Handler) GetLeaderboard(c *gin.Context) {
	id := c.Param("id")
	periodKey := c.Query("period_key")
	lb, entries, err := h.svc.GetLeaderboard(c.Request.Context(), id, periodKey, 100)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "leaderboard not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"leaderboard": lb, "entries": entries})
}

// GetClassLeaderboard handles GET /gamification/leaderboard/class — the caller's
// class XP ranking (classmates only, first-name).
func (h *Handler) GetClassLeaderboard(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	out, err := h.svc.GetClassLeaderboard(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, out)
}

// GetChallenges handles GET /gamification/challenges.
func (h *Handler) GetChallenges(c *gin.Context) {
	ch, err := h.svc.GetChallenges(c.Request.Context(), userID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"challenges": ch})
}

// ── Admin ───────────────────────────────────────────────────────────────────────

func (h *Handler) AdminListBadges(c *gin.Context) {
	b, err := h.svc.AdminListBadges(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"badges": b})
}

func (h *Handler) AdminUpsertBadge(c *gin.Context) {
	var in UpsertBadgeRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	b, err := h.svc.AdminUpsertBadge(c.Request.Context(), in)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, b)
}

func (h *Handler) AdminUpsertChallenge(c *gin.Context) {
	var in UpsertChallengeRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ch, err := h.svc.AdminUpsertChallenge(c.Request.Context(), in)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, ch)
}

func (h *Handler) AdminUpsertLeaderboard(c *gin.Context) {
	var in UpsertLeaderboardRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	lb, err := h.svc.AdminUpsertLeaderboard(c.Request.Context(), in)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, lb)
}

// Register wires member (engagement read) + admin (academy.* CRUD) routes.
//
//	member:
//	  GET /gamification/profile
//	  GET /gamification/badges
//	  GET /gamification/leaderboards/:id
//	  GET /gamification/challenges
//	admin (per-route RBAC academy.*):
//	  GET  /gamification/badges               (academy.content)
//	  POST /gamification/badges               (academy.content)
//	  POST /gamification/challenges           (academy.sponsor)
//	  POST /gamification/leaderboards         (academy.content)
func (h *Handler) Register(member, admin *gin.RouterGroup, guard func(permission string) gin.HandlerFunc) {
	mg := member.Group("/gamification")
	mg.GET("/profile", h.GetProfile)
	mg.GET("/badges", h.GetBadges)
	mg.GET("/leaderboards/:id", h.GetLeaderboard)
	mg.GET("/leaderboard/class", h.GetClassLeaderboard)
	mg.GET("/challenges", h.GetChallenges)

	ag := admin.Group("/gamification")
	ag.GET("/badges", guard("academy.content"), h.AdminListBadges)
	ag.POST("/badges", guard("academy.content"), h.AdminUpsertBadge)
	ag.POST("/challenges", guard("academy.sponsor"), h.AdminUpsertChallenge)
	ag.POST("/leaderboards", guard("academy.content"), h.AdminUpsertLeaderboard)
}

// RegisterAcademyGamification wires the gamification routes. Mirrors the
// RegisterAcademyAssessment pattern: it builds its own service from the pool with
// the default engagement config and gates admin routes with
// middleware.RequirePermission(rbac, perm). Gamification is ENGAGEMENT ONLY — no
// money path is wired here (that is exclusively the rewards package).
//
//	member:
//	  GET /academy/gamification/profile
//	  GET /academy/gamification/badges
//	  GET /academy/gamification/leaderboards/:id
//	  GET /academy/gamification/challenges
//	admin (per-route RBAC academy.*):
//	  GET  /academy/gamification/badges       (academy.content)
//	  POST /academy/gamification/badges       (academy.content)
//	  POST /academy/gamification/challenges   (academy.sponsor)
//	  POST /academy/gamification/leaderboards (academy.content)
func RegisterAcademyGamification(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	svc := NewService(NewRepository(pool), DefaultConfig())
	h := NewHandler(svc)
	guard := func(p string) gin.HandlerFunc { return middleware.RequirePermission(rbac, p) }
	h.Register(member, admin, guard)
}
