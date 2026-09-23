package connectvoting

import (
	"errors"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/config"
)

func mapPromotionError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound), errors.Is(err, ErrPromotionNotFound), errors.Is(err, ErrPartnerNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, ErrPromotionSelfParent), errors.Is(err, ErrPromotionCycle),
		errors.Is(err, ErrPromotionResultsNotPublished), errors.Is(err, ErrPromotionTopNInvalid),
		errors.Is(err, ErrPartnerNameRequired):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, ErrPromotionNotPending):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	case errors.Is(err, ErrPromotionSelfApproval):
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "contest promotion request failed"})
	}
}

// ─── Partners ────────────────────────────────────────────────────────────────

// CreatePartner — POST /connect/admin/contest-partners.
func (h *Handler) CreatePartner(c *gin.Context) {
	var req CreatePartnerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.CreatePartner(c.Request.Context(), req, userID(c))
	if err != nil {
		mapPromotionError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": p})
}

// ListPartners — GET /connect/admin/contest-partners.
func (h *Handler) ListPartners(c *gin.Context) {
	list, err := h.svc.ListPartners(c.Request.Context())
	if err != nil {
		mapPromotionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": list})
}

// UpdatePartner — PATCH /connect/admin/contest-partners/:id.
func (h *Handler) UpdatePartner(c *gin.Context) {
	var req UpdatePartnerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.UpdatePartner(c.Request.Context(), c.Param("id"), req)
	if err != nil {
		mapPromotionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

// ─── Child contests ───────────────────────────────────────────────────────────

// ListChildContests — GET /connect/admin/contests/:id/children.
func (h *Handler) ListChildContests(c *gin.Context) {
	list, err := h.svc.ListChildContests(c.Request.Context(), c.Param("id"))
	if err != nil {
		mapPromotionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": list})
}

// ─── Promotion request / approve / reject ────────────────────────────────────

// RequestPromotion — POST /connect/admin/contests/:id/request-promotion
// (":id" is the CHILD contest).
func (h *Handler) RequestPromotion(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	var req RequestPromotionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.RequestPromotion(c.Request.Context(), c.Param("id"), req, uid)
	if err != nil {
		mapPromotionError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

// GetPromotion — GET /connect/admin/contest-promotions/:id.
func (h *Handler) GetPromotion(c *gin.Context) {
	p, err := h.svc.GetPromotion(c.Request.Context(), c.Param("id"))
	if err != nil {
		mapPromotionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

// ListPromotions — GET /connect/admin/contest-promotions?status=pending.
func (h *Handler) ListPromotions(c *gin.Context) {
	list, err := h.svc.ListPromotions(c.Request.Context(), c.Query("status"))
	if err != nil {
		mapPromotionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": list})
}

// ApprovePromotion — POST /connect/admin/contest-promotions/:id/approve.
func (h *Handler) ApprovePromotion(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	p, err := h.svc.ApprovePromotion(c.Request.Context(), c.Param("id"), uid)
	if err != nil {
		mapPromotionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

// RejectPromotion — POST /connect/admin/contest-promotions/:id/reject.
func (h *Handler) RejectPromotion(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	var req RejectPromotionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.RejectPromotion(c.Request.Context(), c.Param("id"), uid, req.Reason)
	if err != nil {
		mapPromotionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

// RegisterPromotionAdmin wires the contest-promotion admin routes (partner
// CRUD, child-contest listing, promotion request/approve/reject) onto the
// SAME admin group RegisterAdmin uses. Kept in a separate function (called
// alongside RegisterAdmin by app-wiring) rather than folded into it, so this
// entirely new feature's routes are additive to the file rather than
// interleaved with the pre-existing eviction admin routes.
//
// Gated behind FEATURE_CONTEST_PROMOTION_ENABLED, independent of the eviction
// flag — this feature has nothing to do with stage eviction.
func RegisterPromotionAdmin(admin gin.IRouter, svc *Service, guard PermissionGuard, cfg config.Config) {
	if !cfg.FeatureContestPromotionEnabled {
		log.Println("[connect-voting-admin] FEATURE_CONTEST_PROMOTION_ENABLED is off — skipping contest promotion admin routes")
		return
	}

	h := NewHandler(svc)

	partners := admin.Group("/contest-partners")
	partners.POST("", guard("connect.contests.partners.manage"), h.CreatePartner)
	partners.GET("", guard("connect.contests.partners.manage"), h.ListPartners)
	partners.PATCH("/:id", guard("connect.contests.partners.manage"), h.UpdatePartner)

	contests := admin.Group("/contests")
	contests.GET("/:id/children", guard("connect.contests.view"), h.ListChildContests)
	contests.POST("/:id/request-promotion", guard("connect.contests.promotions.request"), h.RequestPromotion)

	promotions := admin.Group("/contest-promotions")
	promotions.GET("", guard("connect.contests.view"), h.ListPromotions)
	promotions.GET("/:id", guard("connect.contests.view"), h.GetPromotion)
	promotions.POST("/:id/approve", guard("connect.contests.promotions.approve"), h.ApprovePromotion)
	promotions.POST("/:id/reject", guard("connect.contests.promotions.approve"), h.RejectPromotion)
}
