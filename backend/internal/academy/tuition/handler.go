package tuition

// Thin Gin handlers: bind, delegate, map errors. No business logic lives here.
// The Idempotency-Key requirement is enforced in the SERVICE, not middleware,
// so it cannot be bypassed by alternate callers (admin routes, jobs, tests).

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
)

// Handler exposes the member-facing tuition payment endpoints.
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

// PayTuitionRequest is the request body for POST /api/finance/academy/pay.
type PayTuitionRequest struct {
	ApplicationID string `json:"applicationId" binding:"required"`
	AmountNGN     int64  `json:"amountNgn" binding:"required,gt=0"`
}

// ValidatePaymentRequest is the request body for POST /api/finance/academy/validate.
type ValidatePaymentRequest struct {
	ApplicationID string `json:"applicationId" binding:"required"`
	AmountNGN     int64  `json:"amountNgn" binding:"required,gt=0"`
}

// WaiveTuitionRequest is the request body for PATCH /api/finance/academy/payments/:id/waive.
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

	case errors.Is(err, ErrInsufficientTier):
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error(), "code": "insufficient_tier"})

	case errors.Is(err, tiers.ErrWalletDisabled):
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error(), "code": "wallet_disabled"})

	case errors.Is(err, ledger.ErrInsufficientFunds):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error(), "code": "insufficient_funds"})

	case errors.Is(err, tiers.ErrDailyLimitExceeded):
		c.JSON(http.StatusTooManyRequests, gin.H{"error": err.Error(), "code": "wallet_daily_limit"})

	case errors.Is(err, ErrApplicationNotFound),
		errors.Is(err, ErrBatchNotFound),
		errors.Is(err, ErrPlanNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})

	case errors.Is(err, ErrDuplicate):
		// On idempotency collision, return 409 Conflict
		c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "code": "idempotency_collision"})

	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
	}
}

// PayTuition handles POST /api/finance/academy/pay.
// Requires Idempotency-Key header; returns 409 on replay with same key.
func (h *Handler) PayTuition(c *gin.Context) {
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

	var req PayTuitionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result, err := h.svc.PayTuition(c.Request.Context(), idempKey, req.ApplicationID,
		req.AmountNGN, userID)
	if err != nil {
		writeErr(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    result,
	})
}

// ValidatePayment handles POST /api/finance/academy/validate (quote endpoint).
// Returns 400 if amount is invalid; 200 with OK if valid.
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

	err = h.svc.ValidatePayment(c.Request.Context(), req.ApplicationID, userID, req.AmountNGN)
	if err != nil {
		writeErr(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "payment amount is valid",
	})
}

// GetTuitionStatus handles GET /api/finance/academy/status/:application_id.
// Returns the full payment status for enrollment gating.
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

// WaiveTuition handles PATCH /api/finance/academy/payments/:id/waive (admin).
// Admin-only action to waive a payment.
func (h *Handler) WaiveTuition(c *gin.Context) {
	userID, err := requireUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	// TODO: Add admin authorization check here (e.g., RequireAdminRole)

	paymentID := c.Param("id")
	if paymentID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "payment id is required"})
		return
	}

	var req WaiveTuitionRequest
	_ = c.ShouldBindJSON(&req) // Optional body

	err = h.svc.WaiveTuition(c.Request.Context(), paymentID, userID)
	if err != nil {
		writeErr(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "payment waived",
	})
}

// MarkPlanCompleted handles PATCH /api/finance/academy/plans/:id/mark-complete (admin).
// Admin-only action to mark a plan as completed (usually after all payments are done).
func (h *Handler) MarkPlanCompleted(c *gin.Context) {
	userID, err := requireUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	// TODO: Add admin authorization check here

	planID := c.Param("id")
	if planID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "plan id is required"})
		return
	}

	// Fetch the plan to ensure it exists
	plan, err := h.svc.repo.GetInstallmentPlan(c.Request.Context(), planID)
	if err != nil {
		writeErr(c, err)
		return
	}

	err = h.svc.repo.MarkPlanCompleted(c.Request.Context(), planID)
	if err != nil {
		writeErr(c, err)
		return
	}

	// Audit
	if h.svc.auditor != nil {
		h.svc.auditor.LogAction(userID, plan.UserID, actionPlanCompleted, auditModule,
			"academy_tuition_plan", planID, map[string]any{"status": plan.Status},
			map[string]any{"status": PlanStatusCompleted}, "", "", "info")
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "plan marked as completed",
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
