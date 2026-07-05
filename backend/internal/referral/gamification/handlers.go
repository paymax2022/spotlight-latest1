package gamification

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes gamification endpoints (member play + admin builder).
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// Register wires gamification routes.
//   - member: missions list/progress/claim, ranks, badges, leaderboard, contests, my-rank
//   - admin : mission/rank builders under RBAC referral.gam.{view,manage}
func Register(member, admin *gin.RouterGroup, svc *Service, rbac services.RBACService) {
	h := NewHandler(svc)

	mg := member.Group("/gamification")
	mg.GET("/missions", h.MissionList)
	mg.GET("/missions/progress", h.MyProgress)
	mg.POST("/missions/:id/claim", h.Claim)
	mg.GET("/ranks", h.RanksList)
	mg.GET("/my-rank", h.MyRank)
	mg.GET("/badges", h.BadgesList)
	mg.GET("/leaderboard", h.Leaderboard)
	mg.GET("/contests", h.ContestsList)

	guard := func(p string) gin.HandlerFunc { return middleware.RequirePermission(rbac, p) }
	ag := admin.Group("/gamification")
	ag.GET("/missions", guard("referral.gam.view"), h.AdminMissionList)
	ag.POST("/missions", guard("referral.gam.manage"), h.AdminCreateMission)
	ag.GET("/ranks", guard("referral.gam.view"), h.RanksList)
	ag.POST("/ranks", guard("referral.gam.manage"), h.AdminCreateRank)
	ag.GET("/contests", guard("referral.gam.view"), h.AdminContestsList)
}

// --- member ---

func (h *Handler) MissionList(c *gin.Context) {
	uid := c.GetString("user_id")
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	list, err := h.svc.ListMissions(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"missions": list})
}

func (h *Handler) MyProgress(c *gin.Context) {
	uid := c.GetString("user_id")
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	rows, pts, err := h.svc.MyProgress(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"progress": rows, "points": pts})
}

func (h *Handler) Claim(c *gin.Context) {
	uid := c.GetString("user_id")
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	idem := c.GetHeader("Idempotency-Key")
	if idem == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header required"})
		return
	}
	res, err := h.svc.Claim(c.Request.Context(), c.Param("id"), uid, idem)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) RanksList(c *gin.Context) {
	list, err := h.svc.ListRanks(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ranks": list})
}

func (h *Handler) MyRank(c *gin.Context) {
	uid := c.GetString("user_id")
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	rank, pts, err := h.svc.MyRank(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"rank": rank, "points": pts})
}

func (h *Handler) BadgesList(c *gin.Context) {
	list, err := h.svc.ListBadges(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"badges": list})
}

func (h *Handler) Leaderboard(c *gin.Context) {
	list, err := h.svc.Leaderboard(c.Request.Context(), c.Query("period"), c.Query("scope"), 100)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"leaderboard": list})
}

func (h *Handler) ContestsList(c *gin.Context) {
	list, err := h.svc.ListContests(c.Request.Context(), true)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"contests": list})
}

// --- admin ---

func (h *Handler) AdminMissionList(c *gin.Context) {
	list, err := h.svc.repo.ListAllMissions(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"missions": list})
}

func (h *Handler) AdminCreateMission(c *gin.Context) {
	var in MissionInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	m, err := h.svc.CreateMission(c.Request.Context(), in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, m)
}

func (h *Handler) AdminCreateRank(c *gin.Context) {
	var in RankInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	r, err := h.svc.CreateRank(c.Request.Context(), in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, r)
}

func (h *Handler) AdminContestsList(c *gin.Context) {
	list, err := h.svc.ListContests(c.Request.Context(), false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"contests": list})
}
