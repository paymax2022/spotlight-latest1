package feesinvoice

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes Invoice + Payment routes over Gin. Router registration into
// RegisterAcademy is owned by the QA/integration task — see RegisterFeesInvoice for the
// groups this package expects.
type Handler struct {
	svc *Service
}

// NewHandler builds the invoice handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func uid(c *gin.Context) string {
	if v := c.GetString("user_id"); v != "" {
		return v
	}
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		return u.ID
	}
	return ""
}

func (h *Handler) requireUser(c *gin.Context) (string, bool) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return "", false
	}
	return u, true
}

// idemKey reads the Idempotency-Key header (required for the money-path payment mutation).
func idemKey(c *gin.Context) string { return c.GetHeader("Idempotency-Key") }

func (h *Handler) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": err.Error()})
	case errors.Is(err, ErrUnauthenticated):
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated", "message": err.Error()})
	case errors.Is(err, ErrMissingStudent):
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_student", "message": err.Error()})
	case errors.Is(err, ErrMissingFeeSchedule):
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_fee_schedule", "message": err.Error()})
	case errors.Is(err, ErrInvalidAmount):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_amount", "message": err.Error()})
	case errors.Is(err, ErrInvalidDate):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_date", "message": err.Error()})
	case errors.Is(err, ErrIdempotencyRequired):
		c.JSON(http.StatusBadRequest, gin.H{"error": "idempotency_key_required", "message": err.Error()})
	case errors.Is(err, ErrOverpayment):
		c.JSON(http.StatusConflict, gin.H{"error": "overpayment", "message": err.Error()})
	case errors.Is(err, ErrInvoiceNotPayable):
		c.JSON(http.StatusConflict, gin.H{"error": "invoice_not_payable", "message": err.Error()})
	case errors.Is(err, ErrAlreadyIssued):
		c.JSON(http.StatusConflict, gin.H{"error": "already_issued", "message": err.Error()})
	case errors.Is(err, ErrIllegalTransition):
		c.JSON(http.StatusConflict, gin.H{"error": "illegal_transition", "message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
	}
}

// RegisterFeesInvoice wires invoice + payment routes onto the passed member group. nil
// pool/groups are skipped.
//
//	member: POST /invoices                         issue invoice (draft→issued; locks fee schedule SF-1)
//	        GET  /invoices/:id                      get invoice (with derived balance SF-2)
//	        GET  /invoices/:id/payments             list payments (append-only)
//	        POST /invoices/:id/payments             record payment (Idempotency-Key required)
//	        GET  /students/:studentId/invoices      list a student's invoices
func RegisterFeesInvoice(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) *Handler {
	if pool == nil {
		return nil
	}
	h := NewHandler(NewService(pool))
	if member != nil {
		ig := member.Group("/invoices")
		ig.POST("", h.Issue)
		ig.GET("/:id", h.GetInvoice)
		ig.GET("/:id/payments", h.ListPayments)
		ig.POST("/:id/payments", h.RecordPayment)

		member.GET("/students/:studentId/invoices", h.ListByStudent)
	}
	// admin group reserved for platform-scoped listing / waive-write-off endpoints; rbac
	// kept in signature so the integration task can gate admin variants without a change.
	_ = admin
	_ = rbac
	return h
}

// ── Handlers ────────────────────────────────────────────────────────────────────

func (h *Handler) Issue(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req IssueInvoiceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.Issue(c.Request.Context(), u, req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) GetInvoice(c *gin.Context) {
	out, err := h.svc.GetInvoice(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) ListPayments(c *gin.Context) {
	out, err := h.svc.ListPayments(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) RecordPayment(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req RecordPaymentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	// The guardian recording the payment is the authenticated user (member route).
	out, err := h.svc.RecordPayment(c.Request.Context(), u, c.Param("id"), u,
		req.AmountMinor, req.GatewayRef, req.LedgerReference, idemKey(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) ListByStudent(c *gin.Context) {
	out, err := h.svc.ListInvoicesByStudent(c.Request.Context(), c.Param("studentId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}
