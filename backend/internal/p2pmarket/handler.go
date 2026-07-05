package p2pmarket

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/escrow"
)

// Handler exposes P2P marketplace member + admin endpoints. The authenticated caller
// is the actor; object-level authZ (seller owns listing; buyer/seller scoping on
// orders; arbiter separation-of-duties in escrow) is enforced in the service/core.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// GuardFunc returns a permission-checking middleware.
type GuardFunc func(permission string) gin.HandlerFunc

// Register mounts member + admin routes.
//
//	member: /api/finance/p2p/*
//	admin : /api/p2p/admin/*  (RBAC p2p.*)
func (h *Handler) Register(member, admin *gin.RouterGroup, guard GuardFunc) {
	member.POST("/p2p/listings", h.CreateListing)
	member.GET("/p2p/listings", h.Browse)
	member.GET("/p2p/listings/:listingId", h.GetListing)
	member.POST("/p2p/listings/:listingId/close", h.CloseListing)

	member.POST("/p2p/listings/:listingId/checkout", h.Checkout)
	member.POST("/p2p/orders/:orderId/confirm", h.Confirm)
	member.POST("/p2p/orders/:orderId/dispute", h.Dispute)
	member.POST("/p2p/orders/:orderId/rate", h.Rate)
	member.GET("/p2p/sellers/:sellerId/rating", h.SellerRating)

	// Admin dispute arbitration console (separation-of-duties enforced in escrow).
	admin.POST("/p2p/orders/:orderId/arbitrate", guard("p2p.dispute.arbitrate"), h.Arbitrate)
}

func actor(c *gin.Context) (string, bool) {
	uid := c.GetString("user_id")
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return "", false
	}
	return uid, true
}

func idem(c *gin.Context) (string, bool) {
	k := c.GetHeader("Idempotency-Key")
	if k == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header required"})
		return "", false
	}
	return k, true
}

type createListingRequest struct {
	Title       string `json:"title" binding:"required"`
	Description string `json:"description"`
	PriceKobo   int64  `json:"price_kobo" binding:"required"`
}

func (h *Handler) CreateListing(c *gin.Context) {
	uid, ok := actor(c)
	if !ok {
		return
	}
	var req createListingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	l, err := h.svc.CreateListing(c.Request.Context(), uid, req.Title, req.Description, req.PriceKobo)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "listing": l})
}

func (h *Handler) Browse(c *gin.Context) {
	ls, err := h.svc.Browse(c.Request.Context(), 50)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "listings": ls})
}

func (h *Handler) GetListing(c *gin.Context) {
	l, err := h.svc.GetListing(c.Request.Context(), c.Param("listingId"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "listing": l})
}

func (h *Handler) CloseListing(c *gin.Context) {
	uid, ok := actor(c)
	if !ok {
		return
	}
	if err := h.svc.CloseListing(c.Request.Context(), c.Param("listingId"), uid); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *Handler) Checkout(c *gin.Context) {
	uid, ok := actor(c)
	if !ok {
		return
	}
	key, ok := idem(c)
	if !ok {
		return
	}
	o, err := h.svc.Checkout(c.Request.Context(), c.Param("listingId"), uid, key)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "order": o})
}

func (h *Handler) Confirm(c *gin.Context) {
	uid, ok := actor(c)
	if !ok {
		return
	}
	if err := h.svc.ConfirmReceipt(c.Request.Context(), c.Param("orderId"), uid); err != nil {
		status := http.StatusBadRequest
		if err == ErrNotParty {
			status = http.StatusForbidden
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

type disputeRequest struct {
	Evidence string `json:"evidence"`
}

func (h *Handler) Dispute(c *gin.Context) {
	uid, ok := actor(c)
	if !ok {
		return
	}
	var req disputeRequest
	_ = c.ShouldBindJSON(&req)
	if err := h.svc.RaiseDispute(c.Request.Context(), c.Param("orderId"), uid, req.Evidence); err != nil {
		status := http.StatusBadRequest
		if err == escrow.ErrDisputeNotParty {
			status = http.StatusForbidden
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

type arbitrateRequest struct {
	Decision string `json:"decision" binding:"required"` // RELEASE | REFUND
}

func (h *Handler) Arbitrate(c *gin.Context) {
	arbiterID := c.GetString("user_id")
	var req arbitrateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.Arbitrate(c.Request.Context(), c.Param("orderId"), escrow.DisputeDecision(req.Decision), arbiterID); err != nil {
		status := http.StatusBadRequest
		if err == escrow.ErrArbiterConflict {
			status = http.StatusForbidden
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

type rateRequest struct {
	Stars   int    `json:"stars" binding:"required"`
	Comment string `json:"comment"`
}

func (h *Handler) Rate(c *gin.Context) {
	uid, ok := actor(c)
	if !ok {
		return
	}
	var req rateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	r, err := h.svc.RateSeller(c.Request.Context(), c.Param("orderId"), uid, req.Stars, req.Comment)
	if err != nil {
		status := http.StatusBadRequest
		if err == ErrNotParty {
			status = http.StatusForbidden
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "rating": r})
}

func (h *Handler) SellerRating(c *gin.Context) {
	avg, count, err := h.svc.SellerRating(c.Request.Context(), c.Param("sellerId"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "average_stars": avg, "count": count})
}
