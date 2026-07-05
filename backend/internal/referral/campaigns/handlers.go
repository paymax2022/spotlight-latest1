package campaigns

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes campaign endpoints (member read + admin CRUD/governor).
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// Register wires campaign routes onto the referral member + admin groups.
//   - member: GET /campaigns, GET /campaigns/:id
//   - admin : /campaigns/* under RBAC referral.campaign.{view,manage}
func Register(member, admin *gin.RouterGroup, svc *Service, rbac services.RBACService) {
	h := NewHandler(svc)

	mg := member.Group("/campaigns")
	mg.GET("", h.MemberList)
	mg.GET("/:id", h.MemberGet)

	guard := func(p string) gin.HandlerFunc { return middleware.RequirePermission(rbac, p) }
	ag := admin.Group("/campaigns")
	ag.GET("", guard("referral.campaign.view"), h.AdminList)
	ag.POST("", guard("referral.campaign.manage"), h.AdminCreate)
	ag.GET("/:id", guard("referral.campaign.view"), h.AdminGet)
	ag.PUT("/:id", guard("referral.campaign.manage"), h.AdminUpdate)
	ag.POST("/:id/activate", guard("referral.campaign.manage"), h.AdminActivate)
	ag.POST("/:id/pause", guard("referral.campaign.manage"), h.AdminPause)
	ag.POST("/:id/end", guard("referral.campaign.manage"), h.AdminEnd)
	ag.POST("/:id/throttle", guard("referral.campaign.manage"), h.AdminThrottle)
	ag.PUT("/:id/budget", guard("referral.campaign.manage"), h.AdminSetBudget)
	ag.GET("/:id/analytics", guard("referral.campaign.view"), h.AdminAnalytics)
	ag.POST("/:id/evaluate", guard("referral.campaign.manage"), h.AdminEvaluate)
}

// --- member ---

func (h *Handler) MemberList(c *gin.Context) {
	list, err := h.svc.ListActive(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"campaigns": list})
}

func (h *Handler) MemberGet(c *gin.Context) {
	camp, err := h.svc.Get(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "campaign not found"})
		return
	}
	if camp.Status != StatusActive {
		c.JSON(http.StatusNotFound, gin.H{"error": "campaign not found"})
		return
	}
	c.JSON(http.StatusOK, camp)
}

// --- admin ---

func (h *Handler) AdminList(c *gin.Context) {
	list, err := h.svc.ListAll(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"campaigns": list})
}

func (h *Handler) AdminGet(c *gin.Context) {
	camp, err := h.svc.Get(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "campaign not found"})
		return
	}
	c.JSON(http.StatusOK, camp)
}

func (h *Handler) AdminCreate(c *gin.Context) {
	var in CreateInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	camp, err := h.svc.Create(c.Request.Context(), in, c.GetString("user_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, camp)
}

func (h *Handler) AdminUpdate(c *gin.Context) {
	var in UpdateInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	camp, err := h.svc.Update(c.Request.Context(), c.Param("id"), in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, camp)
}

func (h *Handler) AdminActivate(c *gin.Context) { h.lifecycle(c, h.svc.Activate) }
func (h *Handler) AdminPause(c *gin.Context)    { h.lifecycle(c, h.svc.Pause) }
func (h *Handler) AdminEnd(c *gin.Context)      { h.lifecycle(c, h.svc.End) }

func (h *Handler) lifecycle(c *gin.Context, fn func(ctx context.Context, id string) error) {
	if err := fn(c.Request.Context(), c.Param("id")); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) AdminThrottle(c *gin.Context) {
	var body struct {
		Pct int `json:"pct"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if err := h.svc.Throttle(c.Request.Context(), c.Param("id"), body.Pct); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "throttle_pct": body.Pct})
}

func (h *Handler) AdminSetBudget(c *gin.Context) {
	var in BudgetInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	b, err := h.svc.SetBudget(c.Request.Context(), c.Param("id"), in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, b)
}

func (h *Handler) AdminAnalytics(c *gin.Context) {
	a, err := h.svc.Analytics(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, a)
}

func (h *Handler) AdminEvaluate(c *gin.Context) {
	var body struct {
		FraudBps int `json:"fraud_bps"`
	}
	_ = c.ShouldBindJSON(&body)
	a, err := h.svc.EvaluateGuardrails(c.Request.Context(), c.Param("id"), body.FraudBps)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, a)
}
