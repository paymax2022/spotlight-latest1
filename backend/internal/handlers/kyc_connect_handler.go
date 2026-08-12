package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/services"
)

// KYCConnectHandler handles /api/v1/kyc/* endpoints for tier progression.
type KYCConnectHandler struct {
	store    *KYCStore
	auditSvc services.AuditService
}

func NewKYCConnectHandler(store *KYCStore, auditSvc services.AuditService) *KYCConnectHandler {
	return &KYCConnectHandler{
		store:    store,
		auditSvc: auditSvc,
	}
}

// GetStatus — GET /api/v1/kyc/status
// View KYC verification state.
func (h *KYCConnectHandler) GetStatus(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	profile, err := h.store.GetKYCStatus(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load kyc status"})
		return
	}

	tierLabels := map[int]string{
		0: "Tier 0 (No KYC)",
		1: "Tier 1",
		2: "Tier 2",
		3: "Tier 3",
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"tier":               profile.Tier,
		"label":             tierLabels[profile.Tier],
		"status":            profile.Status,
		"verificationStatus": profile.VerificationStatus,
		"bvn":               profile.BVN,
		"nin":               profile.NIN,
		"verifiedAt":        profile.VerifiedAt,
		"rejectionReason":   profile.RejectionReason,
	}})
}

// GetLimits — GET /api/v1/kyc/limits
// View tier limits ladder (display-only, mirrors backend config).
func (h *KYCConnectHandler) GetLimits(c *gin.Context) {
	limits, err := h.store.GetTierLimits(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load tier limits"})
		return
	}

	data := []gin.H{}
	for _, limit := range limits {
		data = append(data, gin.H{
			"tier":                 limit.Tier,
			"label":                limit.Label,
			"dailyLimitKobo":       limit.DailyLimitKobo,
			"monthlyLimitKobo":     limit.MonthlyLimitKobo,
			"transactionLimitKobo": limit.TransactionLimitKobo,
			"requiredDocuments":    limit.RequiredDocuments,
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": data})
}

// SubmitTier1 — POST /api/v1/kyc/tier1 (Idempotency-Key required)
// Submit BVN/NIN for Tier 1.
func (h *KYCConnectHandler) SubmitTier1(c *gin.Context) {
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

	var body struct {
		Identifier     string `json:"identifier"`
		IdentifierType string `json:"identifierType"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if len(body.Identifier) != 11 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "enter a valid 11-digit identifier"})
		return
	}

	// Phase 2: Call KYC provider to validate BVN/NIN
	// kyc_provider.VerifyBVN(body.Identifier)
	// For now: just record the submission

	profile, err := h.store.SubmitTier1(c.Request.Context(), userID, body.Identifier, idemKey)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to submit tier1"})
		return
	}

	// Emit audit event
	if h.auditSvc != nil {
		h.auditSvc.LogAction(userID, "", "submit_kyc", "kyc", "kyc_profile",
			profile.UserID, nil, map[string]interface{}{
				"tier": 1,
				"status": profile.Status,
			}, getIPAddress(c), c.Request.UserAgent(), "info")
	}

	c.JSON(http.StatusCreated, gin.H{"data": gin.H{
		"ok":         true,
		"tier":       profile.Tier,
		"status":     profile.Status,
		"targetTier": 1,
		"message":    "Tier 1 KYC submitted for verification.",
	}})
}

// SubmitTier2 — POST /api/v1/kyc/tier2 (Idempotency-Key required)
// Submit ID + address for Tier 2.
func (h *KYCConnectHandler) SubmitTier2(c *gin.Context) {
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

	var body struct {
		IdDocumentUri    string `json:"idDocumentUri"`
		ProofOfAddressUri string `json:"proofOfAddressUri"`
		AddressLine      string `json:"addressLine"`
		City             string `json:"city"`
		State            string `json:"state"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if body.IdDocumentUri == "" || body.ProofOfAddressUri == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "upload both a photo ID and proof of address"})
		return
	}
	if body.AddressLine == "" || body.City == "" || body.State == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "complete your residential address"})
		return
	}

	// Phase 2: Store documents in R2, call KYC provider for verification

	// For now: just get existing profile and update tier
	existingProfile, _ := h.store.GetKYCStatus(c.Request.Context(), userID)
	bvn := existingProfile.BVN

	profile, err := h.store.SubmitTier2(c.Request.Context(), userID, bvn, "", idemKey)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to submit tier2"})
		return
	}

	// Emit audit event
	if h.auditSvc != nil {
		h.auditSvc.LogAction(userID, "", "submit_kyc", "kyc", "kyc_profile",
			profile.UserID, nil, map[string]interface{}{
				"tier": 2,
				"status": profile.Status,
			}, getIPAddress(c), c.Request.UserAgent(), "info")
	}

	c.JSON(http.StatusCreated, gin.H{"data": gin.H{
		"ok":         true,
		"tier":       profile.Tier,
		"status":     profile.Status,
		"targetTier": 2,
		"message":    "Documents submitted. Review takes up to 24 hours.",
	}})
}

// SubmitTier3 — POST /api/v1/kyc/tier3 (Idempotency-Key required)
// Submit liveness + EDD (source of funds + occupation) for Tier 3.
func (h *KYCConnectHandler) SubmitTier3(c *gin.Context) {
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

	var body struct {
		LivenessUri   string `json:"livenessUri"`
		SourceOfFunds string `json:"sourceOfFunds"`
		Occupation    string `json:"occupation"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if body.LivenessUri == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "complete the liveness check"})
		return
	}
	if body.SourceOfFunds == "" || body.Occupation == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "complete the enhanced due diligence details"})
		return
	}

	// Phase 2: Store liveness + EDD data, call compliance review

	// For now: just get existing profile and update tier
	existingProfile, _ := h.store.GetKYCStatus(c.Request.Context(), userID)
	bvn := existingProfile.BVN
	nin := existingProfile.NIN

	profile, err := h.store.SubmitTier3(c.Request.Context(), userID, bvn, nin, body.SourceOfFunds, idemKey)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to submit tier3"})
		return
	}

	// Emit audit event
	if h.auditSvc != nil {
		h.auditSvc.LogAction(userID, "", "submit_kyc", "kyc", "kyc_profile",
			profile.UserID, nil, map[string]interface{}{
				"tier": 3,
				"status": profile.Status,
			}, getIPAddress(c), c.Request.UserAgent(), "info")
	}

	c.JSON(http.StatusCreated, gin.H{"data": gin.H{
		"ok":         true,
		"tier":       profile.Tier,
		"status":     profile.Status,
		"targetTier": 3,
		"message":    "EDD submitted. Our compliance team will review shortly.",
	}})
}

// GetTierStatus — GET /api/v1/me/tier
// Get current tier status.
func (h *KYCConnectHandler) GetTierStatus(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	profile, err := h.store.GetKYCStatus(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load tier status"})
		return
	}

	tierLabels := map[int]string{
		0: "Tier 0",
		1: "Tier 1",
		2: "Tier 2",
		3: "Tier 3",
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"tier":               profile.Tier,
		"label":             tierLabels[profile.Tier],
		"status":            profile.Status,
		"verificationStatus": profile.VerificationStatus,
		"canSend":           profile.Tier >= 1,
		"canReceive":        true,
		"canWithdraw":       profile.Tier >= 2,
		"canGoLive":         profile.Tier >= 2,
		"nextTier":          profile.Tier + 1,
	}})
}
