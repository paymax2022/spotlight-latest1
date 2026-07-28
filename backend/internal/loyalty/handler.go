package loyalty

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler exposes loyalty member endpoints (membership, rewards, redeem). Awards are
// never a public endpoint — they fire only as side effects of live-module actions
// via AwardFor — so a client can never self-promote a tier or mint points.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// GuardFunc returns a permission-checking middleware.
type GuardFunc func(permission string) gin.HandlerFunc

// Register mounts member + admin routes. The caller passes groups already
// scoped to their base paths (finance.Group("/loyalty") and
// adminGroupTop5(r, "/api/loyalty/admin")) — routes registered here must NOT
// re-add the "/loyalty" segment, or Gin will double it
// (e.g. /api/finance/loyalty/loyalty/me instead of /api/finance/loyalty/me).
//
//	member: /api/finance/loyalty/*
//	admin : /api/loyalty/admin/*  (RBAC loyalty.*)
func (h *Handler) Register(member, admin *gin.RouterGroup, guard GuardFunc) {
	member.GET("/me", h.Me)
	member.GET("/tiers", h.Tiers)
	member.GET("/rewards", h.Rewards)
	member.POST("/redeem", h.Redeem)

	// Admin reward/tier config is RBAC-gated; CRUD lands directly on the config
	// tables (loyalty_tiers / loyalty_earn_rules / loyalty_catalog) which are seeded
	// by migration — these endpoints are the guarded management surface.
	admin.GET("/memberships/:userId", guard("loyalty.read"), h.AdminMembership)
}

func (h *Handler) Me(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	m, err := h.svc.GetMembership(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "membership": m})
}

// Tiers GET /loyalty/tiers — active tier config (thresholds + benefits).
func (h *Handler) Tiers(c *gin.Context) {
	tiers, err := h.svc.ListTiers(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "tiers": tiers})
}

func (h *Handler) Rewards(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	items, err := h.svc.ListCatalog(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "rewards": items})
}

type redeemRequest struct {
	SKU string `json:"sku" binding:"required"`
}

func (h *Handler) Redeem(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var req redeemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	red, err := h.svc.Redeem(c.Request.Context(), userID, req.SKU)
	if err != nil {
		status := http.StatusBadRequest
		if err == ErrTierTooLow {
			status = http.StatusForbidden
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "redemption": red})
}

func (h *Handler) AdminMembership(c *gin.Context) {
	m, err := h.svc.GetMembership(c.Request.Context(), c.Param("userId"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "membership": m})
}
