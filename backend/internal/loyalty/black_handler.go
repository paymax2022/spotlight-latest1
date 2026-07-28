package loyalty

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// BlackHandler exposes Paymax Black member + admin endpoints. Member endpoints let
// a Black member view standing + perks and redeem a perk; enrolment, partner and
// settlement management are RBAC-gated admin actions (loyalty.black.manage).
type BlackHandler struct {
	svc *BlackService
}

func NewBlackHandler(svc *BlackService) *BlackHandler { return &BlackHandler{svc: svc} }

// Register mounts Black routes. The caller passes member = finance.Group("/loyalty")
// (base already "/loyalty" — only "/black" must be added here) and
// admin = adminGroupTop5(r, "/api/loyalty/admin/black") (base already includes
// "/black" — neither "/loyalty" nor "/black" may be re-added here, or Gin will
// double the segment, e.g. /api/finance/loyalty/loyalty/black/me).
//
//	member: /api/finance/loyalty/black/*
//	admin : /api/loyalty/admin/black/*  (RBAC loyalty.black.*)
func (h *BlackHandler) Register(member, admin *gin.RouterGroup, guard GuardFunc) {
	member.GET("/black/me", h.Me)
	member.GET("/black/perks", h.Perks)
	member.POST("/black/redeem", h.Redeem)

	admin.POST("/enroll", guard("loyalty.black.manage"), h.AdminEnroll)
	admin.POST("/cancel", guard("loyalty.black.manage"), h.AdminCancel)
	admin.POST("/partner-settlement", guard("loyalty.black.manage"), h.AdminPartnerSettlement)
}

func (h *BlackHandler) Me(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	m, err := h.svc.GetMember(c.Request.Context(), userID)
	if err != nil {
		if err == ErrNotBlack {
			c.JSON(http.StatusOK, gin.H{"success": true, "is_black": false})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "is_black": true, "member": m})
}

func (h *BlackHandler) Perks(c *gin.Context) {
	perks, err := h.svc.ListPerks(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "perks": perks})
}

type redeemPerkRequest struct {
	PerkCode   string `json:"perk_code" binding:"required"`
	ContextRef string `json:"context_ref" binding:"required"`
}

func (h *BlackHandler) Redeem(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var req redeemPerkRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	red, err := h.svc.RedeemPerk(c.Request.Context(), userID, req.PerkCode, req.ContextRef)
	if err != nil {
		status := http.StatusBadRequest
		switch err {
		case ErrNotBlack:
			status = http.StatusForbidden
		case ErrPerkCapReached:
			status = http.StatusTooManyRequests
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "redemption": red})
}

type enrollRequest struct {
	UserID    string  `json:"user_id" binding:"required"`
	ExpiresAt *string `json:"expires_at,omitempty"` // RFC3339
}

func (h *BlackHandler) AdminEnroll(c *gin.Context) {
	var req enrollRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var exp *time.Time
	if req.ExpiresAt != nil {
		t, err := time.Parse(time.RFC3339, *req.ExpiresAt)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "expires_at must be RFC3339"})
			return
		}
		exp = &t
	}
	m, err := h.svc.Enroll(c.Request.Context(), req.UserID, exp)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "member": m})
}

type cancelRequest struct {
	UserID string `json:"user_id" binding:"required"`
}

func (h *BlackHandler) AdminCancel(c *gin.Context) {
	var req cancelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.Cancel(c.Request.Context(), req.UserID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

type partnerSettlementRequest struct {
	PartnerID  string `json:"partner_id" binding:"required"`
	OfferID    string `json:"offer_id" binding:"required"`
	AmountKobo int64  `json:"amount_kobo"`
}

func (h *BlackHandler) AdminPartnerSettlement(c *gin.Context) {
	var req partnerSettlementRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ps, err := h.svc.RecordPartnerSettlement(c.Request.Context(), req.PartnerID, req.OfferID, req.AmountKobo)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "settlement": ps})
}
