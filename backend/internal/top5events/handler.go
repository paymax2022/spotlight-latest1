package top5events

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/credential"
)

// Handler exposes the Top-5 events + cashless-wallet HTTP API. Member routes read
// the acting identity from c.GetString("user_id") (mirrored by requireUserID). Admin
// routes are RBAC-gated via the guard injected at Register time.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// GuardFunc returns a permission-checking middleware (wraps RequirePermission).
type GuardFunc func(permission string) gin.HandlerFunc

// Register mounts member + admin routes. The caller passes member/admin groups
// already scoped to their base paths (finance.Group("/events") and
// adminGroupTop5(r, "/api/events/admin")) — routes registered here must NOT
// re-add the "/events" segment, or Gin will double it
// (e.g. /api/finance/events/events instead of /api/finance/events).
//
//	member: /api/finance/events/*
//	admin : /api/events/admin/*  (RBAC events.*)
func (h *Handler) Register(member, admin *gin.RouterGroup, guard GuardFunc) {
	// Organiser CMS (organiser capability; object-level authZ in the service).
	member.GET("", h.ListEvents)
	member.POST("", h.CreateEvent)
	member.GET("/:id", h.GetEvent)
	member.POST("/:id/submit", h.Submit)
	member.POST("/:id/golive", h.GoLive)
	member.POST("/:id/close", h.Close)
	member.POST("/:id/tiers", h.AddTier)
	member.POST("/:id/promos", h.AddPromo)
	member.POST("/:id/vendors", h.AddVendor)

	// Ticketing.
	member.POST("/:id/purchase", h.Purchase)
	member.POST("/tickets/:ticketId/gift", h.GiftTicket)
	member.GET("/my/tickets", h.MyTickets)

	// Steward scan (validates a rotating-QR / NFC token at a gate).
	member.POST("/scan", h.Scan)

	// Cashless event wallet.
	member.POST("/:id/wallet", h.OpenWallet)
	member.POST("/wallet/:walletId/topup", h.TopUp)
	member.GET("/wallet/:walletId", h.GetWallet)
	member.POST("/wallet/:walletId/close", h.CloseWallet)

	// Vendor POS-lite tap-charge.
	member.POST("/vendors/:vendorId/charge", h.TapCharge)

	// Admin: approval workflow + settlement (RBAC events.*).
	admin.POST("/:id/approve", guard("events.approve"), h.Approve)
	admin.POST("/:id/suspend", guard("events.suspend"), h.Suspend)
	admin.POST("/:id/vendors/:vendorId/settle", guard("events.settle"), h.SettleVendor)
}

func uid(c *gin.Context) (string, bool) {
	u := c.GetString("user_id")
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return "", false
	}
	return u, true
}

func idemKey(c *gin.Context) string {
	return c.GetHeader("Idempotency-Key")
}

// --- CMS ---

func (h *Handler) CreateEvent(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	var e Event
	if err := c.ShouldBindJSON(&e); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.CreateEvent(c.Request.Context(), u, e)
	respond(c, out, err)
}

func (h *Handler) GetEvent(c *gin.Context) {
	out, err := h.svc.GetEvent(c.Request.Context(), c.Param("id"))
	respond(c, out, err)
}

// ListEvents is the discovery/list feed (mobile discovery screen: category chips
// + live/on-sale/ended). Caller identity is optional (public discovery); when
// present, organisers/admins additionally see their own non-public-state events.
func (h *Handler) ListEvents(c *gin.Context) {
	userID := c.GetString("user_id") // optional; discovery is publicly readable
	filter := EventListFilter{
		Category: c.Query("category"),
		State:    c.Query("state"),
		Limit:    20,
		Offset:   0,
	}
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			filter.Limit = n
		}
	}
	if v := c.Query("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			filter.Offset = n
		}
	}
	out, err := h.svc.ListEvents(c.Request.Context(), userID, filter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "events": out})
}

func (h *Handler) Submit(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	respondOK(c, h.svc.Submit(c.Request.Context(), u, c.Param("id")))
}

func (h *Handler) GoLive(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	respondOK(c, h.svc.GoLive(c.Request.Context(), u, c.Param("id")))
}

func (h *Handler) Close(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	respondOK(c, h.svc.Close(c.Request.Context(), u, c.Param("id")))
}

func (h *Handler) Approve(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	respondOK(c, h.svc.Approve(c.Request.Context(), u, c.Param("id")))
}

func (h *Handler) Suspend(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	respondOK(c, h.svc.Suspend(c.Request.Context(), u, c.Param("id")))
}

func (h *Handler) AddTier(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	var t TicketTier
	if err := c.ShouldBindJSON(&t); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.AddTier(c.Request.Context(), u, c.Param("id"), t)
	respond(c, out, err)
}

func (h *Handler) AddPromo(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	var p PromoCode
	if err := c.ShouldBindJSON(&p); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.AddPromo(c.Request.Context(), u, c.Param("id"), p)
	respond(c, out, err)
}

func (h *Handler) AddVendor(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	var v Vendor
	if err := c.ShouldBindJSON(&v); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.AddVendor(c.Request.Context(), u, c.Param("id"), v)
	respond(c, out, err)
}

// --- Ticketing ---

type purchaseRequest struct {
	TierID string `json:"tier_id" binding:"required"`
	Promo  string `json:"promo,omitempty"`
}

func (h *Handler) Purchase(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	key := idemKey(c)
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header required"})
		return
	}
	var req purchaseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.Purchase(c.Request.Context(), u, c.Param("id"), req.TierID, req.Promo, key)
	respond(c, out, err)
}

type giftRequest struct {
	Recipient string `json:"recipient" binding:"required"` // cashtag handle
}

func (h *Handler) GiftTicket(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	var req giftRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.GiftTicket(c.Request.Context(), u, c.Param("ticketId"), req.Recipient)
	respond(c, out, err)
}

func (h *Handler) MyTickets(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	out, err := h.svc.MyTickets(c.Request.Context(), u)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "tickets": out})
}

type scanRequest struct {
	Token credential.Token `json:"token" binding:"required"`
	Gate  credential.Gate  `json:"gate"`
}

func (h *Handler) Scan(c *gin.Context) {
	if _, ok := uid(c); !ok {
		return
	}
	var req scanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.ScanTicket(c.Request.Context(), req.Token, req.Gate)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": res.OK, "result": res})
}

// --- Cashless wallet ---

func (h *Handler) OpenWallet(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	out, err := h.svc.OpenWallet(c.Request.Context(), u, c.Param("id"))
	respond(c, out, err)
}

type topUpRequest struct {
	AmountKobo int64  `json:"amount_kobo" binding:"required"`
	Source     string `json:"source"` // wallet | agent | card
}

func (h *Handler) TopUp(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	key := idemKey(c)
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header required"})
		return
	}
	var req topUpRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	src := TopUpSource(req.Source)
	if src == "" {
		src = TopUpWallet
	}
	out, err := h.svc.TopUp(c.Request.Context(), u, c.Param("walletId"), req.AmountKobo, src, key)
	respond(c, out, err)
}

func (h *Handler) GetWallet(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	out, err := h.svc.GetWallet(c.Request.Context(), u, c.Param("walletId"))
	respond(c, out, err)
}

func (h *Handler) CloseWallet(c *gin.Context) {
	if _, ok := uid(c); !ok {
		return
	}
	respondOK(c, h.svc.CloseWallet(c.Request.Context(), c.Param("walletId")))
}

type tapChargeRequest struct {
	WalletID   string `json:"wallet_id" binding:"required"`
	AmountKobo int64  `json:"amount_kobo" binding:"required"`
}

func (h *Handler) TapCharge(c *gin.Context) {
	if _, ok := uid(c); !ok {
		return
	}
	key := idemKey(c)
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header required"})
		return
	}
	var req tapChargeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.TapCharge(c.Request.Context(), c.Param("vendorId"), req.WalletID, req.AmountKobo, key)
	respond(c, out, err)
}

func (h *Handler) SettleVendor(c *gin.Context) {
	if _, ok := uid(c); !ok {
		return
	}
	key := idemKey(c)
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header required"})
		return
	}
	net, err := h.svc.SettleVendor(c.Request.Context(), c.Param("id"), c.Param("vendorId"), key)
	if err != nil {
		status := http.StatusBadRequest
		if err == ErrKYCRequired {
			status = http.StatusForbidden
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "net_kobo": net})
}

// --- response helpers ---

func respond(c *gin.Context, data any, err error) {
	if err != nil {
		status := http.StatusBadRequest
		switch err {
		case ErrForbidden:
			status = http.StatusForbidden
		case ErrNotFound:
			status = http.StatusNotFound
		case ErrSoldOut, ErrInsufficientFloat:
			status = http.StatusConflict
		case ErrKYCRequired:
			status = http.StatusForbidden
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

func respondOK(c *gin.Context, err error) {
	if err != nil {
		status := http.StatusBadRequest
		switch err {
		case ErrForbidden:
			status = http.StatusForbidden
		case ErrNotFound:
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
