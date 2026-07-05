package network

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes ambassador/agent override endpoints.
type Handler struct {
	svc  *Service
	rbac services.RBACService
}

func NewHandler(svc *Service, rbac services.RBACService) *Handler {
	return &Handler{svc: svc, rbac: rbac}
}

// Register wires network routes.
//   - member: ambassador dashboard + apply, team dashboard, override ledger
//   - admin : directory, approve, override-policy config under RBAC referral.amb.*
func Register(member, admin *gin.RouterGroup, svc *Service, rbac services.RBACService) {
	h := NewHandler(svc, rbac)

	mg := member.Group("/network")
	mg.GET("/ambassador", h.MyAmbassador)        // ambassador dashboard
	mg.POST("/ambassador/apply", h.Apply)        // ambassador application + disclosure
	mg.GET("/teams", h.MyNetworks)               // team dashboard (networks I lead)
	mg.GET("/teams/:id/members", h.NetworkMembers)
	mg.GET("/overrides", h.MyOverrides)          // override ledger

	guard := func(p string) gin.HandlerFunc { return middleware.RequirePermission(rbac, p) }
	ag := admin.Group("/network")
	ag.GET("/ambassadors", guard("referral.amb.view"), h.Directory)
	ag.POST("/ambassadors/:id/status", guard("referral.amb.manage"), h.SetStatus)
	ag.GET("/override-policies", guard("referral.amb.view"), h.ListPolicies)
	ag.PUT("/override-policies", guard("referral.amb.manage"), h.SetPolicy)
	ag.POST("/overrides/accrue", guard("referral.amb.manage"), h.AccrueOverride)
}

// --- member ---

func (h *Handler) MyAmbassador(c *gin.Context) {
	uid := c.GetString("user_id")
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	a, err := h.svc.MyAmbassador(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ambassador": a})
}

func (h *Handler) Apply(c *gin.Context) {
	uid := c.GetString("user_id")
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var in ApplyInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	a, err := h.svc.Apply(c.Request.Context(), uid, in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, a)
}

func (h *Handler) MyNetworks(c *gin.Context) {
	uid := c.GetString("user_id")
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	nets, err := h.svc.MyNetworks(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"networks": nets})
}

func (h *Handler) NetworkMembers(c *gin.Context) {
	uid := c.GetString("user_id")
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	members, err := h.svc.NetworkMembers(c.Request.Context(), c.Param("id"), uid, false)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"members": members})
}

func (h *Handler) MyOverrides(c *gin.Context) {
	uid := c.GetString("user_id")
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	rows, err := h.svc.MyOverrides(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"overrides": rows})
}

// --- admin ---

func (h *Handler) Directory(c *gin.Context) {
	list, err := h.svc.Directory(c.Request.Context(), c.Query("status"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ambassadors": list})
}

func (h *Handler) SetStatus(c *gin.Context) {
	var body struct {
		Status string `json:"status"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if err := h.svc.SetStatus(c.Request.Context(), c.Param("id"), body.Status, c.GetString("user_id")); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) ListPolicies(c *gin.Context) {
	list, err := h.svc.ListPolicies(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"policies": list})
}

func (h *Handler) SetPolicy(c *gin.Context) {
	var in PolicyInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	p, err := h.svc.SetPolicy(c.Request.Context(), in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, p)
}

// AccrueOverride lets an admin/governor trigger an activity-based override
// accrual for one network member. The service enforces house-exclusion + caps.
func (h *Handler) AccrueOverride(c *gin.Context) {
	var in AccrueOverrideInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if in.IdempotencyKey == "" {
		in.IdempotencyKey = c.GetHeader("Idempotency-Key")
	}
	o, err := h.svc.AccrueOverride(c.Request.Context(), in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if o == nil {
		c.JSON(http.StatusOK, gin.H{"accrued": false, "reason": "excluded_or_zero_base"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"accrued": true, "override": o})
}
