package feesinvoice

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

const keyMessage = "message"

// Handler exposes Invoice + Payment routes over Gin. Router registration into
// RegisterAcademy is owned by the QA/integration task — see RegisterFeesInvoice for the
// groups this package expects.
type Handler struct {
	svc *Service
}

// NewHandler builds the invoice handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// authUserID adapts middleware.GetAuthenticatedUser to ginutil.UserID’s
// fallback signature for contexts missing the "user_id" key.
func authUserID(c *gin.Context) string {
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		return u.ID
	}
	return ""
}

func (h *Handler) requireUser(c *gin.Context) (string, bool) {
	u := ginutil.UserID(c, authUserID)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return "", false
	}
	return u, true
}

func (h *Handler) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", keyMessage: httperr.Msg(c, http.StatusNotFound, err)})
	case errors.Is(err, ErrUnauthenticated):
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated", keyMessage: httperr.Msg(c, http.StatusUnauthorized, err)})
	case errors.Is(err, ErrMissingStudent):
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_student", keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
	case errors.Is(err, ErrMissingFeeSchedule):
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_fee_schedule", keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
	case errors.Is(err, ErrInvalidAmount):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_amount", keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
	case errors.Is(err, ErrInvalidDate):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_date", keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
	case errors.Is(err, ErrIdempotencyRequired):
		c.JSON(http.StatusBadRequest, gin.H{"error": "idempotency_key_required", keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
	case errors.Is(err, ErrOverpayment):
		c.JSON(http.StatusConflict, gin.H{"error": "overpayment", keyMessage: httperr.Msg(c, http.StatusConflict, err)})
	case errors.Is(err, ErrIdempotencyKeyConflict):
		c.JSON(http.StatusConflict, gin.H{"error": "idempotency_key_conflict", keyMessage: httperr.Msg(c, http.StatusConflict, err)})
	case errors.Is(err, ErrInvoiceNotPayable):
		c.JSON(http.StatusConflict, gin.H{"error": "invoice_not_payable", keyMessage: httperr.Msg(c, http.StatusConflict, err)})
	case errors.Is(err, ErrAlreadyIssued):
		c.JSON(http.StatusConflict, gin.H{"error": "already_issued", keyMessage: httperr.Msg(c, http.StatusConflict, err)})
	case errors.Is(err, ErrIllegalTransition):
		c.JSON(http.StatusConflict, gin.H{"error": "illegal_transition", keyMessage: httperr.Msg(c, http.StatusConflict, err)})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", keyMessage: httperr.Msg(c, http.StatusInternalServerError, err)})
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

func (h *Handler) Issue(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req IssueInvoiceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
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
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	// The guardian recording the payment is the authenticated user (member route).
	out, err := h.svc.RecordPayment(c.Request.Context(), u, c.Param("id"), u,
		req.AmountMinor, req.GatewayRef, req.LedgerReference, ginutil.IdempotencyKey(c))
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
