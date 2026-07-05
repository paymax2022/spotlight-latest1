package creators

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// Handler exposes creator member + admin endpoints. The authenticated caller is the
// actor; object-level authZ (a creator owns their storefront/content/tiers) is
// enforced in the service. Admin moderation/verification/payout is RBAC-gated.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// GuardFunc returns a permission-checking middleware.
type GuardFunc func(permission string) gin.HandlerFunc

// Register mounts member + admin routes.
//
//	member: /api/finance/creators/*
//	admin : /api/creators/admin/*  (RBAC creators.*)
func (h *Handler) Register(member, admin *gin.RouterGroup, guard GuardFunc) {
	// Creator capability + storefront.
	member.POST("/creators/apply", h.Apply)
	// Discovery + "my" reads. Mounted on distinct static prefixes so they do not
	// collide with the /creators/:creatorId wildcard (gin routing constraint).
	member.GET("/creators-directory", h.Discover)
	member.GET("/my-creator/content", h.MyContent)
	member.GET("/my-creator/subscriptions", h.MySubscriptions)
	member.GET("/creators/:creatorId", h.Storefront)

	// Tip jar.
	member.POST("/creators/:creatorId/tip", h.Tip)

	// Paid content + entitlements.
	member.POST("/creators/content", h.CreateContent)
	member.POST("/creators/content/:contentId/purchase", h.Purchase)
	member.GET("/creators/content/:contentId", h.View)

	// Subscriptions.
	member.POST("/creators/tiers", h.CreateTier)
	member.POST("/creators/tiers/:tierId/subscribe", h.Subscribe)
	member.POST("/creators/subscriptions/:subId/cancel", h.CancelSub)

	// Earnings + payout (KYC-gated).
	member.GET("/creators/earnings/balance", h.Balance)
	member.POST("/creators/payouts", h.RequestPayout)

	// Admin: verification, NL-11 moderation, payout settlement.
	admin.POST("/creators/:creatorId/approve", guard("creators.verify"), h.AdminApprove)
	admin.POST("/creators/:creatorId/suspend", guard("creators.verify"), h.AdminSuspend)
	admin.POST("/creators/content/:contentId/moderate", guard("creators.moderate"), h.AdminModerate)
	admin.POST("/creators/payouts/:payoutId/paid", guard("creators.payout"), h.AdminPayoutPaid)
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

type applyRequest struct {
	DisplayName string `json:"display_name" binding:"required"`
	Bio         string `json:"bio"`
	Handle      string `json:"handle"`
}

func (h *Handler) Apply(c *gin.Context) {
	uid, ok := actor(c)
	if !ok {
		return
	}
	var req applyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.Apply(c.Request.Context(), uid, req.DisplayName, req.Bio, req.Handle)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "profile": p})
}

// Discover GET /creators?search= — public approved-creator directory.
func (h *Handler) Discover(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	profiles, err := h.svc.Discover(c.Request.Context(), c.Query("search"), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "creators": profiles})
}

// MyContent GET /creators/my/content — the calling creator's own items.
func (h *Handler) MyContent(c *gin.Context) {
	uid, ok := actor(c)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(c.Query("limit"))
	items, err := h.svc.MyContent(c.Request.Context(), uid, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "content": items})
}

// MySubscriptions GET /creators/my/subscriptions — subscriptions the caller holds.
func (h *Handler) MySubscriptions(c *gin.Context) {
	uid, ok := actor(c)
	if !ok {
		return
	}
	subs, err := h.svc.MySubscriptions(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "subscriptions": subs})
}

func (h *Handler) Storefront(c *gin.Context) {
	p, err := h.svc.GetProfile(c.Request.Context(), c.Param("creatorId"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "profile": p})
}

type tipRequest struct {
	AmountKobo int64 `json:"amount_kobo" binding:"required"`
}

func (h *Handler) Tip(c *gin.Context) {
	uid, ok := actor(c)
	if !ok {
		return
	}
	key, ok := idem(c)
	if !ok {
		return
	}
	var req tipRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	t, err := h.svc.Tip(c.Request.Context(), uid, c.Param("creatorId"), key, req.AmountKobo)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "tip": t})
}

type createContentRequest struct {
	Title     string `json:"title" binding:"required"`
	Body      string `json:"body"`
	PriceKobo int64  `json:"price_kobo"`
	AgeRating string `json:"age_rating" binding:"required"`
}

func (h *Handler) CreateContent(c *gin.Context) {
	uid, ok := actor(c)
	if !ok {
		return
	}
	var req createContentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	cnt, err := h.svc.CreateContent(c.Request.Context(), uid, req.Title, req.Body, req.PriceKobo, AgeRating(req.AgeRating))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "content": cnt})
}

func (h *Handler) Purchase(c *gin.Context) {
	uid, ok := actor(c)
	if !ok {
		return
	}
	key, ok := idem(c)
	if !ok {
		return
	}
	ent, err := h.svc.PurchaseContent(c.Request.Context(), uid, c.Param("contentId"), key)
	if err != nil {
		status := http.StatusBadRequest
		switch err {
		case ErrAgeRestricted, ErrContentNotAvailable:
			status = http.StatusForbidden
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "entitlement": ent})
}

func (h *Handler) View(c *gin.Context) {
	uid, ok := actor(c)
	if !ok {
		return
	}
	cnt, err := h.svc.ViewContent(c.Request.Context(), uid, c.Param("contentId"))
	if err != nil {
		status := http.StatusForbidden
		if err == ErrContentNotAvailable {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "content": cnt})
}

type createTierRequest struct {
	Name         string `json:"name" binding:"required"`
	PriceKobo    int64  `json:"price_kobo" binding:"required"`
	IntervalSecs int64  `json:"interval_secs" binding:"required"`
}

func (h *Handler) CreateTier(c *gin.Context) {
	uid, ok := actor(c)
	if !ok {
		return
	}
	var req createTierRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	t, err := h.svc.CreateTier(c.Request.Context(), uid, req.Name, req.PriceKobo, req.IntervalSecs)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "tier": t})
}

func (h *Handler) Subscribe(c *gin.Context) {
	uid, ok := actor(c)
	if !ok {
		return
	}
	key, ok := idem(c)
	if !ok {
		return
	}
	sub, err := h.svc.Subscribe(c.Request.Context(), uid, c.Param("tierId"), key)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "subscription": sub})
}

func (h *Handler) CancelSub(c *gin.Context) {
	uid, ok := actor(c)
	if !ok {
		return
	}
	if err := h.svc.Cancel(c.Request.Context(), c.Param("subId"), uid); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *Handler) Balance(c *gin.Context) {
	uid, ok := actor(c)
	if !ok {
		return
	}
	bal, err := h.svc.Balance(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "balance_kobo": bal})
}

type payoutRequest struct {
	AmountKobo int64 `json:"amount_kobo" binding:"required"`
}

func (h *Handler) RequestPayout(c *gin.Context) {
	uid, ok := actor(c)
	if !ok {
		return
	}
	var req payoutRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.RequestPayout(c.Request.Context(), uid, req.AmountKobo)
	if err != nil {
		status := http.StatusBadRequest
		if err == ErrPayoutKYC {
			status = http.StatusForbidden
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "payout": p})
}

// --- admin ---

func (h *Handler) AdminApprove(c *gin.Context) {
	uid := c.GetString("user_id")
	if err := h.svc.Approve(c.Request.Context(), c.Param("creatorId"), uid); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *Handler) AdminSuspend(c *gin.Context) {
	uid := c.GetString("user_id")
	if err := h.svc.Suspend(c.Request.Context(), c.Param("creatorId"), uid); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

type moderateRequest struct {
	Decision string `json:"decision" binding:"required"` // APPROVED | REJECTED
	Reason   string `json:"reason"`
}

func (h *Handler) AdminModerate(c *gin.Context) {
	uid := c.GetString("user_id")
	var req moderateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.Moderate(c.Request.Context(), c.Param("contentId"), ModerationState(req.Decision), uid, req.Reason); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *Handler) AdminPayoutPaid(c *gin.Context) {
	uid := c.GetString("user_id")
	if err := h.svc.MarkPayoutPaid(c.Request.Context(), c.Param("payoutId"), uid); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
