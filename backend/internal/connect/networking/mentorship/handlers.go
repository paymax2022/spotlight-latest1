package connectmentor

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
	case errors.Is(err, ErrSelfMatch):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, ErrNotMentor), errors.Is(err, ErrNotParticipant):
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
	case errors.Is(err, ErrBadTransition):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

// OptIn — POST /mentorship/opt-in (MN-01). Upsert is naturally idempotent.
func (h *Handler) OptIn(c *gin.Context) {
	var in OptInInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.OptIn(c.Request.Context(), uid(c), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// Discover — GET /mentorship/discovery?domain=&limit= (MN-02, PN-7 safe projection).
func (h *Handler) Discover(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	out, err := h.svc.Discover(c.Request.Context(), uid(c), c.Query("domain"), limit)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// RequestMatch — POST /mentorship/matches (MN-03). Idempotent per (mentor,mentee).
func (h *Handler) RequestMatch(c *gin.Context) {
	var in MatchRequestInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.RequestMatch(c.Request.Context(), uid(c), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// RespondMatch — POST /mentorship/matches/:id/respond (MN-03). Mentor accept/decline.
func (h *Handler) RespondMatch(c *gin.Context) {
	var in MatchRespondInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.RespondMatch(c.Request.Context(), uid(c), c.Param("id"), in.Accept)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// TransitionMatch — PATCH /mentorship/matches/:id/state. Drives active/paused/
// completed/ended_early. On COMPLETED (MN-06) the response carries testimonialHint.
func (h *Handler) TransitionMatch(c *gin.Context) {
	var in StateTransitionInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.Transition(c.Request.Context(), uid(c), c.Param("id"), MatchState(in.State))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ListMyMatches — GET /mentorship/matches.
func (h *Handler) ListMyMatches(c *gin.Context) {
	out, err := h.svc.ListMyMatches(c.Request.Context(), uid(c))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// --- Admin ---

// AdminReports — GET /mentorship/reports?state=&limit= (ADM-MN-01).
func (h *Handler) AdminReports(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	out, err := h.svc.MentorshipReports(c.Request.Context(), c.Query("state"), limit)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AdminLoyaltyAudit — GET /mentorship/loyalty-audit?userId=&limit= (ADM-GM-01).
func (h *Handler) AdminLoyaltyAudit(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	out, err := h.svc.LoyaltyAudit(c.Request.Context(), c.Query("userId"), limit)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// Register wires the mentorship module onto the shared Connect member + admin
// groups. Member mentorship is self-opt-in (PN-9), so no member permission gate is
// applied. Admin routes add per-route RBAC (connect.moderation.manage). The single
// Paymax Black emit seam is the injected LoyaltyAwarder (PN-8) — no direct points
// dependency here.
func Register(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, loyalty LoyaltyAwarder, audit Auditor) {
	svc := NewService(NewRepository(pool), loyalty, audit)
	h := NewHandler(svc)

	g := member.Group("/networking/mentorship")
	g.POST("/opt-in", h.OptIn)
	g.GET("/discovery", h.Discover)
	g.GET("/matches", h.ListMyMatches)
	g.POST("/matches", h.RequestMatch)
	g.POST("/matches/:id/respond", h.RespondMatch)
	g.PATCH("/matches/:id/state", h.TransitionMatch)

	ag := admin.Group("/networking/mentorship")
	ag.GET("/reports",
		middleware.RequirePermission(rbac, "connect.moderation.manage"), h.AdminReports)
	ag.GET("/loyalty-audit",
		middleware.RequirePermission(rbac, "connect.moderation.manage"), h.AdminLoyaltyAudit)
}
