package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// RegistrationHandler handles /api/registration/* endpoints for contest registration.
// All endpoints persist to Supabase and sync with admin dashboard.
type RegistrationHandler struct{}

func NewRegistrationHandler() *RegistrationHandler {
	return &RegistrationHandler{}
}

// ListContests — GET /api/registration/contests
// List all available contests for registration.
func (h *RegistrationHandler) ListContests(c *gin.Context) {
	// Mock data (Phase 2: query contests table)
	c.JSON(http.StatusOK, gin.H{"contests": []gin.H{
		{
			"id":                    "cont_1",
			"title":                 "Spotlight African Voices 2024",
			"slug":                  "african-voices-2024",
			"description":           "Platform for emerging African talent",
			"category":              "arts",
			"registrationFeeNgn":    5000,
			"isPaid":                true,
			"startDate":             "2026-08-01T00:00:00Z",
			"endDate":               "2026-12-31T23:59:59Z",
			"maxParticipants":       1000,
			"registeredCount":       450,
		},
	}})
}

// ListApplications — GET /api/registration/applications
// List user's own registration applications (paginated).
func (h *RegistrationHandler) ListApplications(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	_ = c.Query("cursor") // Phase 2: use cursor for pagination

	// Mock data (Phase 2: query applications for user_id)
	c.JSON(http.StatusOK, gin.H{"applications": []gin.H{
		{
			"id":                 "app_1",
			"reference":          "SPOT-123456-ABC1",
			"contestSlug":        "african-voices-2024",
			"status":             "submitted",
			"role":               "public_user",
			"createdAt":          "2026-08-10T10:30:00Z",
			"updatedAt":          "2026-08-11T14:00:00Z",
			"submittedAt":        "2026-08-11T14:00:00Z",
			"completionPercent":  100,
			"currentStep":        "review_summary",
			"fraudFlags":         []string{},
			"formData": gin.H{
				"personal.name":              "John Doe",
				"personal.email":             "john@example.com",
				"contest.title":              "Spotlight African Voices 2024",
				"payment.feeAmount":          5000,
				"payment.paymentStatus":      "paid",
				"payment.paymentMethod":      "WALLET",
				"payment.transactionReference": "SPT-REG-1234-ABC1",
			},
		},
	}})
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

	now := time.Now().UTC().Format(time.RFC3339)

	// Mock data (Phase 2: insert into applications table)
	c.JSON(http.StatusCreated, gin.H{"data": gin.H{
		"draft": gin.H{
			"id":                "app_1",
			"reference":         "SPOT-123456-ABC1",
			"contestSlug":       body.ContestSlug,
			"status":            "draft",
			"role":              "public_user",
			"createdAt":         now,
			"updatedAt":         now,
			"completionPercent": 0,
			"currentStep":       "contest_selection",
			"fraudFlags":        []string{},
			"formData": gin.H{
				"contest.title":      "Spotlight African Voices 2024",
				"payment.feeAmount":  5000,
				"payment.paymentStatus": "pending",
			},
		},
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

	_ = c.Param("id") // Phase 2: query applications by id for user_id

	// Mock data
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"draft": gin.H{
			"id":                 "app_1",
			"reference":          "SPOT-123456-ABC1",
			"contestSlug":        "african-voices-2024",
			"status":             "draft",
			"role":               "public_user",
			"createdAt":          "2026-08-10T10:30:00Z",
			"updatedAt":          "2026-08-10T10:30:00Z",
			"completionPercent":  0,
			"currentStep":        "contest_selection",
			"fraudFlags":         []string{},
			"formData":           gin.H{},
		},
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

	// Mock data (Phase 2: update applications.form_data, run validation)
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"success": true,
		"draft": gin.H{
			"id":                 id,
			"reference":          "SPOT-123456-ABC1",
			"status":             "draft",
			"currentStep":        body.StepKey,
			"completionPercent":  20,
			"updatedAt":          time.Now().UTC().Format(time.RFC3339),
			"formData":           body.Values,
		},
		"steps": []gin.H{},
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

	// Mock data (Phase 2: update status to 'submitted', record submission_time, emit event)
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"success": true,
		"draft": gin.H{
			"id":                id,
			"reference":         "SPOT-123456-ABC1",
			"status":            "submitted",
			"completionPercent": 100,
			"submittedAt":       time.Now().UTC().Format(time.RFC3339),
			"updatedAt":         time.Now().UTC().Format(time.RFC3339),
		},
		"message": "Your Spotlight application has been submitted. Reference SPOT-123456-ABC1.",
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

	// Mock data (Phase 2: query applications + status_timeline for id)
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"draft": gin.H{
			"id":        id,
			"reference": "SPOT-123456-ABC1",
			"status":    "submitted",
		},
		"timeline": []gin.H{
			{
				"id":            "ev_1",
				"applicationId": id,
				"newStatus":     "draft",
				"note":          "Application draft created",
				"createdAt":     "2026-08-10T10:30:00Z",
				"actorRole":     "public_user",
			},
			{
				"id":            "ev_2",
				"applicationId": id,
				"oldStatus":     "draft",
				"newStatus":     "submitted",
				"note":          "Application submitted successfully",
				"createdAt":     "2026-08-11T14:00:00Z",
				"actorRole":     "public_user",
			},
		},
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

	// Mock data (Phase 2: update status to 'withdrawn', record note, emit event)
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"id":        id,
		"reference": "SPOT-123456-ABC1",
		"status":    "withdrawn",
		"updatedAt": time.Now().UTC().Format(time.RFC3339),
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

	_ = c.Param("id") // Phase 2: use to record payment in applications

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

	if body.Method == "WALLET" {
		// Wallet: charge immediately, mark paid
		c.JSON(http.StatusCreated, gin.H{"data": gin.H{
			"success":        true,
			"transactionId":  "tid_" + time.Now().Format("20060102150405"),
			"reference":      "SPT-REG-" + time.Now().Format("150405") + "-ABC1",
			"status":         "completed",
		}})
	} else if body.Method == "PAYSTACK" {
		// Paystack: return hosted checkout URL (phase 2: call provider)
		c.JSON(http.StatusCreated, gin.H{"data": gin.H{
			"success":            true,
			"transactionId":      "tid_" + time.Now().Format("20060102150405"),
			"reference":          "SPT-REG-" + time.Now().Format("150405") + "-ABC1",
			"status":             "initiated",
			"authorizationUrl":   "https://checkout.paystack.com/XXXXX", // Phase 2: real Paystack URL
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

	id := c.Param("id")

	var body struct {
		Reference string `json:"reference"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	// Mock data (Phase 2: verify with Paystack, update payment status)
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"success":   true,
		"reference": body.Reference,
		"status":    "successful",
		"draft": gin.H{
			"id":     id,
			"status": "submitted",
			"formData": gin.H{
				"payment.paymentStatus": "paid",
				"payment.transactionReference": body.Reference,
			},
		},
	}})
}
