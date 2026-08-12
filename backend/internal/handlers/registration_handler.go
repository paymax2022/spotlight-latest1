package handlers

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/services"
)

// RegistrationHandler handles /api/registration/* endpoints for contest registration.
// All endpoints persist to Supabase and sync with admin dashboard.
type RegistrationHandler struct {
	store      *RegistrationStore
	auditSvc   services.AuditService
}

func NewRegistrationHandler(store *RegistrationStore, auditSvc services.AuditService) *RegistrationHandler {
	return &RegistrationHandler{
		store:    store,
		auditSvc: auditSvc,
	}
}

// ListContests — GET /api/registration/contests
// List all available contests for registration.
func (h *RegistrationHandler) ListContests(c *gin.Context) {
	contests, err := h.store.ListContests(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load contests"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"contests": contests})
}

// ListApplications — GET /api/registration/applications
// List user's own registration applications (paginated).
func (h *RegistrationHandler) ListApplications(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	cursor := c.Query("cursor")
	limit := 50

	applications, err := h.store.ListApplications(c.Request.Context(), userID, cursor, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load applications"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"applications": applications})
}

// CreateApplication — POST /api/registration/applications
// Start a new registration draft (creates empty application).
func (h *RegistrationHandler) CreateApplication(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	var body struct {
		ContestSlug string `json:"contestSlug"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	// Generate unique reference
	reference := fmt.Sprintf("SPOT-%d-%s", time.Now().Unix(), generateShortID())

	app, err := h.store.CreateApplication(c.Request.Context(), userID, body.ContestSlug, reference)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create application"})
		return
	}

	// Emit audit event
	if h.auditSvc != nil {
		h.auditSvc.LogAction(userID, "", "create_application", "registration", "application",
			app.ID, nil, map[string]interface{}{
				"reference": app.Reference,
				"contest":   app.ContestSlug,
				"status":    "draft",
			}, getIPAddress(c), c.Request.UserAgent(), "info")
	}

	c.JSON(http.StatusCreated, gin.H{"data": gin.H{
		"draft": app,
		"steps": []gin.H{},
	}})
}

// GetApplication — GET /api/registration/applications/:id
// Retrieve application draft and schema.
func (h *RegistrationHandler) GetApplication(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	appID := c.Param("id")

	app, err := h.store.GetApplication(c.Request.Context(), userID, appID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load application"})
		return
	}
	if app == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "application not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"draft": app,
		"steps": []gin.H{},
	}})
}

// SaveStep — PATCH /api/registration/applications/:id
// Save one step's answers (client-side validation returned).
func (h *RegistrationHandler) SaveStep(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	id := c.Param("id")

	var body struct {
		StepKey string                 `json:"stepKey"`
		Values  map[string]interface{} `json:"values"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	// Calculate completion percent (rough estimate: steps * 20%)
	stepOrder := []string{"contest_selection", "personal_info", "qualifications", "portfolio", "review_summary"}
	newPercent := 0
	for i, step := range stepOrder {
		if step == body.StepKey {
			newPercent = ((i + 1) * 100) / len(stepOrder)
			break
		}
	}

	app, err := h.store.SaveStep(c.Request.Context(), userID, id, body.StepKey, body.Values, newPercent)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save step"})
		return
	}

	// Emit audit event
	if h.auditSvc != nil {
		h.auditSvc.LogAction(userID, "", "save_step", "registration", "application",
			id, nil, map[string]interface{}{
				"step": body.StepKey,
				"progress": newPercent,
			}, getIPAddress(c), c.Request.UserAgent(), "info")
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"success": true,
		"draft":   app,
		"steps":   []gin.H{},
		"validation": gin.H{
			"isValid": true,
			"errors":  gin.H{},
		},
	}})
}

// SubmitApplication — POST /api/registration/applications/:id/submit
// Submit application for review (no more edits).
func (h *RegistrationHandler) SubmitApplication(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	id := c.Param("id")

	app, err := h.store.SubmitApplication(c.Request.Context(), userID, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to submit application"})
		return
	}

	// Record status change in timeline
	if err := h.store.RecordStatusChange(c.Request.Context(), id, "draft", "submitted",
		"Application submitted for review", "public_user"); err != nil {
		// Log but don't fail the request
		fmt.Printf("failed to record status change: %v\n", err)
	}

	// Emit audit event
	if h.auditSvc != nil {
		h.auditSvc.LogAction(userID, "", "submit_application", "registration", "application",
			id, map[string]interface{}{"status": "draft"},
			map[string]interface{}{"status": "submitted"}, getIPAddress(c), c.Request.UserAgent(), "info")
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"success": true,
		"draft":   app,
		"message": fmt.Sprintf("Your Spotlight application has been submitted. Reference %s.", app.Reference),
	}})
}

// GetStatus — GET /api/registration/applications/:id/status
// Get application status and timeline of state changes.
func (h *RegistrationHandler) GetStatus(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	id := c.Param("id")

	app, err := h.store.GetApplication(c.Request.Context(), userID, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load application"})
		return
	}
	if app == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "application not found"})
		return
	}

	timeline, err := h.store.GetStatusTimeline(c.Request.Context(), userID, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load timeline"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"draft": gin.H{
			"id":        app.ID,
			"reference": app.Reference,
			"status":    app.Status,
		},
		"timeline": timeline,
	}})
}

// WithdrawApplication — POST /api/registration/applications/:id/withdraw
// Withdraw application (cannot be re-submitted).
func (h *RegistrationHandler) WithdrawApplication(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	id := c.Param("id")

	var body struct {
		Note string `json:"note"`
	}
	_ = c.ShouldBindJSON(&body)

	app, err := h.store.WithdrawApplication(c.Request.Context(), userID, id, body.Note)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to withdraw application"})
		return
	}

	// Record status change in timeline
	if err := h.store.RecordStatusChange(c.Request.Context(), id, "submitted", "withdrawn",
		body.Note, "public_user"); err != nil {
		fmt.Printf("failed to record status change: %v\n", err)
	}

	// Emit audit event
	if h.auditSvc != nil {
		h.auditSvc.LogAction(userID, "", "withdraw_application", "registration", "application",
			id, map[string]interface{}{"status": "submitted"},
			map[string]interface{}{"status": "withdrawn", "note": body.Note},
			getIPAddress(c), c.Request.UserAgent(), "info")
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"id":        app.ID,
		"reference": app.Reference,
		"status":    app.Status,
		"updatedAt": app.UpdatedAt,
	}})
}

// InitiatePayment — POST /api/registration/applications/:id/payment/initiate
// Start payment (Idempotency-Key required).
func (h *RegistrationHandler) InitiatePayment(c *gin.Context) {
	userID := c.GetString("user_id")
	idemKey := c.GetHeader("Idempotency-Key")

	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	if idemKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header required"})
		return
	}

	appID := c.Param("id")

	var body struct {
		AmountKobo int64  `json:"amountKobo"`
		Method     string `json:"method"`
		Email      string `json:"email"`
		Name       string `json:"name"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	// Generate payment reference
	reference := fmt.Sprintf("SPT-REG-%d-%s", time.Now().Unix(), generateShortID())

	if body.Method == "WALLET" {
		// WALLET: Charge from wallet (requires ledger entry)
		// Phase 2: Post double-entry ledger entry
		// ledger.Debit(ctx, userID, ref, idemKey, registrationFeesAcct, amountKobo)

		pt, err := h.store.CreatePaymentTransaction(c.Request.Context(), appID, reference, body.AmountKobo, "WALLET", idemKey)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create payment"})
			return
		}

		// Update payment status to completed
		if err := h.store.UpdatePaymentStatus(c.Request.Context(), appID, reference, "completed", ""); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update payment"})
			return
		}

		// Emit audit event
		if h.auditSvc != nil {
			h.auditSvc.LogAction(userID, "", "initiate_payment", "registration", "payment",
				pt.ID, nil, map[string]interface{}{
					"method":    "WALLET",
					"amount":    body.AmountKobo,
					"reference": reference,
				}, getIPAddress(c), c.Request.UserAgent(), "warning")
		}

		c.JSON(http.StatusCreated, gin.H{"data": gin.H{
			"success":       true,
			"transactionId": pt.ID,
			"reference":     reference,
			"status":        "completed",
		}})

	} else if body.Method == "PAYSTACK" {
		// PAYSTACK: Return checkout URL (no ledger entry yet)
		// Phase 2: Call Paystack provider and get authorization URL
		pt, err := h.store.CreatePaymentTransaction(c.Request.Context(), appID, reference, body.AmountKobo, "PAYSTACK", idemKey)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create payment"})
			return
		}

		// Emit audit event
		if h.auditSvc != nil {
			h.auditSvc.LogAction(userID, "", "initiate_payment", "registration", "payment",
				pt.ID, nil, map[string]interface{}{
					"method":    "PAYSTACK",
					"amount":    body.AmountKobo,
					"reference": reference,
				}, getIPAddress(c), c.Request.UserAgent(), "warning")
		}

		c.JSON(http.StatusCreated, gin.H{"data": gin.H{
			"success":          true,
			"transactionId":    pt.ID,
			"reference":        reference,
			"status":           "initiated",
			"authorizationUrl": "https://checkout.paystack.com/" + reference, // Phase 2: real Paystack URL
		}})
	} else {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payment method"})
	}
}

// VerifyPayment — POST /api/registration/applications/:id/payment/verify
// Verify payment after redirect from Paystack.
func (h *RegistrationHandler) VerifyPayment(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	appID := c.Param("id")

	var body struct {
		Reference string `json:"reference"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	// Phase 2: Call Paystack to verify payment status
	// paystack.VerifyTransaction(body.Reference)
	// For now: assume verified if reference provided
	if body.Reference == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "reference required"})
		return
	}

	// Update payment status to completed
	if err := h.store.UpdatePaymentStatus(c.Request.Context(), appID, body.Reference, "verified", body.Reference); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to verify payment"})
		return
	}

	app, err := h.store.GetApplication(c.Request.Context(), userID, appID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load application"})
		return
	}

	// Emit audit event
	if h.auditSvc != nil {
		h.auditSvc.LogAction(userID, "", "verify_payment", "registration", "payment",
			appID, nil, map[string]interface{}{
				"reference": body.Reference,
				"status":    "verified",
			}, getIPAddress(c), c.Request.UserAgent(), "warning")
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"success":   true,
		"reference": body.Reference,
		"status":    "successful",
		"draft": gin.H{
			"id":     app.ID,
			"status": app.Status,
			"formData": gin.H{
				"payment.paymentStatus":      "paid",
				"payment.transactionReference": body.Reference,
			},
		},
	}})
}

// Helper functions

// generateShortID creates a short random ID for references (e.g., "ABC1")
func generateShortID() string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	id := ""
	seed := time.Now().UnixNano()
	for i := 0; i < 4; i++ {
		id += string(chars[(seed/int64(i+1))%int64(len(chars))])
	}
	return id
}

// getIPAddress extracts client IP from request
func getIPAddress(c *gin.Context) string {
	if ip := c.Request.Header.Get("X-Forwarded-For"); ip != "" {
		// Take the first IP if there are multiple
		if idx := strings.Index(ip, ","); idx != -1 {
			return strings.TrimSpace(ip[:idx])
		}
		return strings.TrimSpace(ip)
	}
	if ip := c.Request.Header.Get("X-Real-IP"); ip != "" {
		return strings.TrimSpace(ip)
	}
	return c.Request.RemoteAddr
}
