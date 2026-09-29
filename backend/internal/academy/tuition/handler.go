package tuition

// Thin Gin handlers: bind, delegate, map errors. No business logic lives here.
// The Idempotency-Key requirement is enforced in the SERVICE, not middleware,
// so it cannot be bypassed by alternate callers (admin routes, jobs, tests).

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler exposes the member-facing and admin tuition payment endpoints.
type Handler struct {
	svc *Service
}

// NewHandler builds the tuition handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// idemKey reads the Idempotency-Key header (canonical or lowercase).
func idemKey(c *gin.Context) string {
	if v := c.GetHeader("Idempotency-Key"); v != "" {
		return v
	}
	return c.GetHeader("idempotency-key")
}

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

// writeErr maps domain errors onto HTTP status codes.
// Ordering matters: most specific sentinels first, catch-all 500 last.
func writeErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrZeroPayment),
		errors.Is(err, ErrInvalidPlanType),
		errors.Is(err, ErrInvalidPaymentAmount):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})

	case errors.Is(err, ErrForbidden):
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})

	case errors.Is(err, ErrPaymentNotConfirmed):
		c.JSON(http.StatusPaymentRequired, gin.H{"error": err.Error(), "code": "payment_not_confirmed"})

	case errors.Is(err, ErrReferenceReused):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "code": "reference_reused"})

	case errors.Is(err, ErrApplicationNotFound),
		errors.Is(err, ErrBatchNotFound),
		errors.Is(err, ErrPlanNotFound),
		errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})

	case errors.Is(err, ErrDuplicate):
		// On idempotency collision, return 409 Conflict
		c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "code": "idempotency_collision"})

	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
	}
}

// ConfirmPayment handles POST /api/finance/academy/tuition/confirm.
// Verifies a Paystack reference and records the installment as paid. Requires
// Idempotency-Key header; returns 409 on replay with same key.
func (h *Handler) ConfirmPayment(c *gin.Context) {
	userID, err := requireUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	idempKey := idemKey(c)
	if idempKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Idempotency-Key header is required",
			"code":  "idempotency_key_required",
		})
		return
	}

	var req ConfirmPaymentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
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

// ValidatePayment handles POST /api/finance/academy/tuition/validate (quote endpoint).
func (h *Handler) ValidatePayment(c *gin.Context) {
	userID, err := requireUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req ValidatePaymentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
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
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	appID := c.Param("application_id")
	if appID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "application_id is required"})
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
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	paymentID := c.Param("id")
	if paymentID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "payment id is required"})
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
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	planID := c.Param("id")
	if planID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "plan id is required"})
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
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req struct {
		ApplicationID string `json:"applicationId" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
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
	userID, exists := c.Get("user_id")
	if !exists {
		return "", errors.New("user_id not found in context")
	}
	uid, ok := userID.(string)
	if !ok {
		return "", errors.New("user_id is not a string")
	}
	return uid, nil
}
