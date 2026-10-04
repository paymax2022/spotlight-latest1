package connectmonetization

import (
	"errors"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// mapMoneyError converts service errors to HTTP status codes.
func mapMoneyError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrMissingIdem):
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header required"})
	case errors.Is(err, ErrPlanNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "plan not found or inactive"})
	case errors.Is(err, ErrKindMismatch):
		c.JSON(http.StatusBadRequest, gin.H{"error": "plan not valid for this endpoint"})
	case errors.Is(err, ErrInvalidAmount):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid amount"})
	default:
		// Insufficient funds / duplicate / tier limit / DB — surface as 402/409/500.
		msg := err.Error()
		switch {
		case strings.Contains(msg, "insufficient funds"):
			c.JSON(http.StatusPaymentRequired, gin.H{"error": "insufficient wallet balance"})
		case strings.Contains(msg, "duplicate"):
			c.JSON(http.StatusConflict, gin.H{"error": "duplicate request"})
		case strings.Contains(msg, "limit"):
			c.JSON(http.StatusForbidden, gin.H{"error": "transaction limit exceeded"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "purchase failed"})
		}
	}
}

// ListPlans — GET /api/v1/connect/plans?kind=  (member). Backend-owned catalogue.
func (h *Handler) ListPlans(c *gin.Context) {
	plans, err := h.svc.ListPlans(c.Request.Context(), PlanKind(c.Query("kind")))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": plans})
}

// purchase is shared by /subscriptions, /boosts, /passes; expectedKind guards each.
func (h *Handler) purchase(c *gin.Context, kind PlanKind) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	var req PurchaseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	order, ent, err := h.svc.Purchase(c.Request.Context(), uid, ginutil.IdempotencyKey(c), kind, req)
	if err != nil {
		mapMoneyError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": gin.H{"order": order, "entitlement": ent}})
}

// Subscribe — POST /api/v1/connect/subscriptions (member, Idempotency-Key).
func (h *Handler) Subscribe(c *gin.Context) { h.purchase(c, KindSubscription) }

// BuyBoost — POST /api/v1/connect/boosts (member, Idempotency-Key).
func (h *Handler) BuyBoost(c *gin.Context) { h.purchase(c, KindBoost) }

// BuyPass — POST /api/v1/connect/passes (member, Idempotency-Key).
func (h *Handler) BuyPass(c *gin.Context) { h.purchase(c, KindPass) }

// Entitlements — GET /api/v1/connect/entitlements (member). Server-side truth.
func (h *Handler) Entitlements(c *gin.Context) {
	ents, err := h.svc.ActiveEntitlements(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": ents})
}

// BookRide — POST /api/v1/connect/date-plans/:id/ride (member, Idempotency-Key).
func (h *Handler) BookRide(c *gin.Context) { h.book(c, "ride") }

// BookTickets — POST /api/v1/connect/date-plans/:id/tickets (member, Idempotency-Key).
func (h *Handler) BookTickets(c *gin.Context) { h.book(c, "ticket") }

func (h *Handler) book(c *gin.Context, kind string) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	var req BookingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	req.Kind = kind // endpoint dictates kind; client cannot override.
	b, err := h.svc.Book(c.Request.Context(), uid, ginutil.IdempotencyKey(c), req)
	if err != nil {
		mapMoneyError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": b})
}

// CancelSubscription — POST /api/v1/connect/subscriptions/cancel (member).
// Body: {"immediate": bool}. Default end-of-period; immediate refunds unused time.
func (h *Handler) CancelSubscription(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	var body struct {
		Immediate bool `json:"immediate"`
	}
	_ = c.ShouldBindJSON(&body)
	res, err := h.svc.CancelSubscription(c.Request.Context(), uid, body.Immediate)
	if err != nil {
		if errors.Is(err, ErrNoActiveSubscription) {
			c.JSON(http.StatusNotFound, gin.H{"error": "no active subscription"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "cancel failed"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": res})
}

// AdminRunRenewals — POST /api/connect/admin/subscriptions/run-renewals
// (connect.payments.reconcile). Drives the auto-renew batch; a scheduler calls this.
func (h *Handler) AdminRunRenewals(c *gin.Context) {
	rep, err := h.svc.ProcessRenewals(c.Request.Context(), time.Now().UTC())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err), "partial": rep})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rep})
}

// AdminUpsertPlan — POST /api/connect/admin/plans (connect.plans.manage).
func (h *Handler) AdminUpsertPlan(c *gin.Context) {
	var p Plan
	if err := c.ShouldBindJSON(&p); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	out, err := h.svc.UpsertPlan(c.Request.Context(), ginutil.UserID(c), p)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AdminRefund — POST /api/connect/admin/orders/:id/refund (connect.payments.refund).
// Reverses a paid order safely and single (PAY-007). Idempotent.
func (h *Handler) AdminRefund(c *gin.Context) {
	var body struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&body) // reason optional
	o, err := h.svc.Refund(c.Request.Context(), c.Param("id"), ginutil.UserID(c), body.Reason)
	if err != nil {
		switch {
		case errors.Is(err, ErrOrderNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "order not found"})
		case errors.Is(err, ErrNotRefundable):
			c.JSON(http.StatusConflict, gin.H{"error": "order is not refundable"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "refund failed"})
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": o})
}

// AdminListOrders — GET /api/connect/admin/orders?user_id=&limit= (connect.payments.reconcile).
func (h *Handler) AdminListOrders(c *gin.Context) {
	limit := 0
	if v := c.Query("limit"); v != "" {
		limit, _ = strconv.Atoi(v)
	}
	orders, err := h.svc.ListOrders(c.Request.Context(), c.Query("user_id"), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": orders})
}
