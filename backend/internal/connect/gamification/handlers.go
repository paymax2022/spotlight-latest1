package connectgamification

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func uid(c *gin.Context) string { return c.GetString("user_id") }

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
	out, err := h.svc.Home(c.Request.Context(), uid(c))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// Missions — GET /gamification/missions.
func (h *Handler) Missions(c *gin.Context) {
	out, err := h.svc.Missions(c.Request.Context(), uid(c))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ClaimMission — POST /gamification/missions/:id/claim.
func (h *Handler) ClaimMission(c *gin.Context) {
	m, err := h.svc.ClaimMission(c.Request.Context(), uid(c), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": m})
}

// Streaks — GET /gamification/streaks.
func (h *Handler) Streaks(c *gin.Context) {
	out, err := h.svc.Streaks(c.Request.Context(), uid(c))
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

// --- Admin ---

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
	m, err := h.svc.UpsertMission(c.Request.Context(), uid(c), in)
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
	se, err := h.svc.UpsertSeason(c.Request.Context(), uid(c), in)
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
