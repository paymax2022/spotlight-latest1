package tuition

// Thin Gin handlers: bind, delegate, map errors. No business logic lives here.
// The Idempotency-Key requirement is enforced in the SERVICE, not middleware,
// so it cannot be bypassed by alternate callers (admin routes, jobs, tests).

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

const keyUnauthorized = "unauthorized"

const keyError = "error"

// Handler exposes the member-facing and admin tuition payment endpoints.
type Handler struct {
	svc *Service
}

// NewHandler builds the tuition handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// ConfirmPaymentRequest is the request body for POST /api/finance/academy/tuition/confirm.
type ConfirmPaymentRequest struct {
	PlanID    string `json:"planId" binding:"required"`
	PaymentID string `json:"paymentId" binding:"required"`
	Reference string `json:"reference" binding:"required"`
}

// ValidatePaymentRequest is the request body for POST /api/finance/academy/tuition/validate.
type ValidatePaymentRequest struct {
	ApplicationID string `json:"applicationId" binding:"required"`
	AmountNGN     int64  `json:"amountNgn" binding:"required,gt=0"`
}

// WaiveTuitionRequest is the request body for PATCH .../payments/:id/waive.
type WaiveTuitionRequest struct {
	Reason string `json:"reason"` // Optional reason for audit trail
}

// errMap holds the sentinel→status table; writeErr layers the three sentinels'
// machine-readable "code" field on top so the response envelope is unchanged.
var errMap = httperr.New(http.StatusInternalServerError,
	httperr.R(http.StatusBadRequest, ErrZeroPayment, ErrInvalidPlanType, ErrInvalidPaymentAmount),
	httperr.R(http.StatusForbidden, ErrForbidden),
	httperr.R(http.StatusPaymentRequired, ErrPaymentNotConfirmed),
	httperr.R(http.StatusConflict, ErrReferenceReused, ErrDuplicate, ErrNoPendingInstallments),
	httperr.R(http.StatusNotFound, ErrApplicationNotFound, ErrBatchNotFound, ErrPlanNotFound, ErrNotFound),
)

// writeErr maps domain errors onto HTTP status codes.
func writeErr(c *gin.Context, err error) {
	var code string
	switch {
	case errors.Is(err, ErrPaymentNotConfirmed):
		code = "payment_not_confirmed"
	case errors.Is(err, ErrReferenceReused):
		code = "reference_reused"
	case errors.Is(err, ErrDuplicate):
		code = "idempotency_collision"
	}
	status := errMap.Code(err)
	body := gin.H{keyError: httperr.Msg(c, status, err)}
	if status == http.StatusInternalServerError {
		body[keyError] = "internal server error"
	}
	if code != "" {
		body["code"] = code
	}
	c.JSON(status, body)
}

// ConfirmPayment handles POST /api/finance/academy/tuition/confirm.
// Verifies a Paystack reference and records the installment as paid. Requires
// Idempotency-Key header; returns 409 on replay with same key.
func (h *Handler) ConfirmPayment(c *gin.Context) {
	userID, err := requireUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthorized})
		return
	}

	idempKey := ginutil.IdempotencyKey(c)
	if idempKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			keyError: "Idempotency-Key header is required",
			"code":   "idempotency_key_required",
		})
		return
	}

	var req ConfirmPaymentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}

	result, err := h.svc.ConfirmPayment(c.Request.Context(), idempKey, req.PlanID, req.PaymentID, req.Reference, userID)
	if err != nil {
		writeErr(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    result,
	})
}

// ConfirmPaymentInternal handles POST /internal/finance/academy/tuition/confirm.
// The route is service-token authenticated upstream (middleware.RequireServiceToken),
// so no user JWT exists — the payer is resolved from the payment row by the
// service. The Idempotency-Key header is optional here: when absent the key is
// derived as `academy-tuition-confirm:{paymentId}:{reference}`, identical to the
// derivation the Next.js confirm route applies, so a webhook/recover fulfilment
// and a late client retry collapse onto ONE logical operation (redis claim →
// 409 idempotency_collision → the caller treats it as already-in-flight).
func (h *Handler) ConfirmPaymentInternal(c *gin.Context) {
	var req ConfirmPaymentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}

	idempKey := ginutil.IdempotencyKey(c)
	if idempKey == "" {
		idempKey = "academy-tuition-confirm:" + req.PaymentID + ":" + req.Reference
	}

	result, err := h.svc.ConfirmPaymentInternal(c.Request.Context(), idempKey, req.PlanID, req.PaymentID, req.Reference)
	if err != nil {
		writeErr(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    result,
	})
}

// ValidatePayment handles POST /api/finance/academy/tuition/validate (quote endpoint).
func (h *Handler) ValidatePayment(c *gin.Context) {
	userID, err := requireUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthorized})
		return
	}

	var req ValidatePaymentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}

	if err := h.svc.ValidatePayment(c.Request.Context(), req.ApplicationID, userID, req.AmountNGN); err != nil {
		writeErr(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "payment amount is valid",
	})
}

// GetTuitionStatus handles GET /api/finance/academy/tuition/status/:application_id.
func (h *Handler) GetTuitionStatus(c *gin.Context) {
	userID, err := requireUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthorized})
		return
	}

	appID := c.Param("application_id")
	if appID == "" {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "application_id is required"})
		return
	}

	status, err := h.svc.GetTuitionStatus(c.Request.Context(), appID, userID)
	if err != nil {
		writeErr(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    status,
	})
}

// WaiveTuition handles PATCH .../admin/payments/:id/waive (admin, RBAC-gated at the route).
func (h *Handler) WaiveTuition(c *gin.Context) {
	userID, err := requireUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthorized})
		return
	}

	paymentID := c.Param("id")
	if paymentID == "" {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "payment id is required"})
		return
	}

	var req WaiveTuitionRequest
	_ = c.ShouldBindJSON(&req) // Optional body

	if err := h.svc.WaiveTuition(c.Request.Context(), paymentID, userID); err != nil {
		writeErr(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "payment waived",
	})
}

// MarkPlanCompleted handles PATCH .../admin/plans/:id/mark-complete (admin, RBAC-gated).
func (h *Handler) MarkPlanCompleted(c *gin.Context) {
	userID, err := requireUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthorized})
		return
	}

	planID := c.Param("id")
	if planID == "" {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "plan id is required"})
		return
	}

	if err := h.svc.MarkPlanCompleted(c.Request.Context(), planID, userID); err != nil {
		writeErr(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "plan marked as completed",
	})
}

// CreatePlan handles POST .../admin/plans (admin, RBAC-gated). Creates the installment
// plan (and its full schedule) for an approved application — the same operation that
// otherwise happens lazily on first payment confirmation.
func (h *Handler) CreatePlan(c *gin.Context) {
	actorID, err := requireUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthorized})
		return
	}

	var req struct {
		ApplicationID string `json:"applicationId" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}

	plan, err := h.svc.CreateTuitionPlan(c.Request.Context(), req.ApplicationID, actorID)
	if err != nil {
		writeErr(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    plan,
	})
}

// requireUserID extracts the user ID from the auth context.
// Returns empty string and error if not authenticated.
func requireUserID(c *gin.Context) (string, error) {
	if u := ginutil.UserID(c); u != "" {
		return u, nil
	}
	return "", errors.New("user_id not found in context")
}
