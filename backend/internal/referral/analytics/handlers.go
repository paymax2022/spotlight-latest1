package analytics

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes admin analytics + user-360 endpoints (read-only).
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Register wires analytics routes onto the referral admin group.
//   - admin: /api/referral/admin/analytics/*  (RBAC referral.analytics.view)
//   - admin: /api/referral/admin/users/:id     (RBAC referral.users.view, A-USR-01)
func Register(admin *gin.RouterGroup, svc *Service, rbac services.RBACService) {
	h := NewHandler(svc)
	guard := func(p string) gin.HandlerFunc { return middleware.RequirePermission(rbac, p) }

	ag := admin.Group("/analytics")
	ag.GET("/k-factor", guard("referral.analytics.view"), h.KFactor)
	ag.GET("/funnel", guard("referral.analytics.view"), h.Funnel)
	ag.GET("/cac", guard("referral.analytics.view"), h.CAC)
	ag.GET("/cohorts", guard("referral.analytics.view"), h.Cohorts)
	ag.GET("/channels", guard("referral.analytics.view"), h.Channels)
	ag.GET("/segmentation", guard("referral.analytics.view"), h.Segmentation)

	// user-360 (A-USR-01) under a separate permission.
	ug := admin.Group("/users")
	ug.GET("/:id/referral-360", guard("referral.users.view"), h.User360)
}

func (h *Handler) KFactor(c *gin.Context) {
	k, err := h.svc.KFactor(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"k_factor": k})
}

func (h *Handler) Funnel(c *gin.Context) {
	f, err := h.svc.Funnel(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"funnel": f})
}

func (h *Handler) CAC(c *gin.Context) {
	var paid int64
	if v := c.Query("paid_cac_kobo"); v != "" {
		paid, _ = strconv.ParseInt(v, 10, 64)
	}
	cac, err := h.svc.CAC(c.Request.Context(), paid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"cac": cac})
}

func (h *Handler) Cohorts(c *gin.Context) {
	rows, err := h.svc.Cohorts(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"cohorts": rows})
}

func (h *Handler) Channels(c *gin.Context) {
	rows, err := h.svc.Channels(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"channels": rows})
}

func (h *Handler) Segmentation(c *gin.Context) {
	s, err := h.svc.Segmentation(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"segmentation": s})
}

func (h *Handler) User360(c *gin.Context) {
	u, err := h.svc.User360(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": u})
}
