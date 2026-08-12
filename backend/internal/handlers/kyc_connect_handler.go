package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// KYCConnectHandler handles /api/v1/kyc/* endpoints for tier progression.
type KYCConnectHandler struct{}

func NewKYCConnectHandler() *KYCConnectHandler {
	return &KYCConnectHandler{}
}

// GetStatus — GET /api/v1/kyc/status
// View KYC verification state.
func (h *KYCConnectHandler) GetStatus(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	// Mock data (Phase 2: query kyc_profiles for user)
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"tier":         1,
		"label":        "Tier 1",
		"bvn":          "passed",
		"nin":          "not_started",
		"photoId":      "not_started",
		"address":      "not_started",
		"liveness":     "not_started",
		"edd":          "not_started",
		"reviewState":  "none",
	}})
}

// GetLimits — GET /api/v1/kyc/limits
// View tier limits ladder (display-only, mirrors backend config).
func (h *KYCConnectHandler) GetLimits(c *gin.Context) {
	// Mock data (Phase 2: return tier configuration from TIER_BENEFITS config)
	c.JSON(http.StatusOK, gin.H{"data": []gin.H{
		{
			"tier":                0,
			"label":               "Unverified",
			"requirement":         "No verification required",
			"dailyLimitKobo":      0,
			"singleGiftMaxKobo":   0,
			"withdrawDailyKobo":   0,
			"privileges":          []string{"view", "learn"},
		},
		{
			"tier":                1,
			"label":               "Tier 1",
			"requirement":         "BVN or NIN",
			"dailyLimitKobo":      3_000_000,
			"singleGiftMaxKobo":   1_000_000,
			"withdrawDailyKobo":   0,
			"privileges":          []string{"send", "receive", "gift"},
		},
		{
			"tier":                2,
			"label":               "Tier 2",
			"requirement":         "Photo ID + proof of address",
			"dailyLimitKobo":      15_000_000,
			"singleGiftMaxKobo":   10_000_000,
			"withdrawDailyKobo":   50_000_000,
			"privileges":          []string{"send", "receive", "gift", "withdraw", "earn"},
		},
		{
			"tier":                3,
			"label":               "Tier 3",
			"requirement":         "Liveness + EDD (source of funds + occupation)",
			"dailyLimitKobo":      -1, // unlimited
			"singleGiftMaxKobo":   -1, // unlimited
			"withdrawDailyKobo":   -1, // unlimited
			"privileges":          []string{"send", "receive", "gift", "withdraw", "earn", "unlimited"},
		},
	}})
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

	// Mock data (Phase 2: call provider API, validate, create kyc_profile, emit audit)
	c.JSON(http.StatusCreated, gin.H{"data": gin.H{
		"ok":         true,
		"reviewState": "passed",
		"targetTier": 1,
		"message":    "BVN linked. Tier 1 active.",
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

	// Mock data (Phase 2: store documents, mark for review, update kyc_profile, emit audit)
	c.JSON(http.StatusCreated, gin.H{"data": gin.H{
		"ok":         true,
		"reviewState": "pending",
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

	// Mock data (Phase 2: store liveness + EDD, mark for review, update kyc_profile, emit audit)
	c.JSON(http.StatusCreated, gin.H{"data": gin.H{
		"ok":         true,
		"reviewState": "pending",
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

	// Mock data (Phase 2: query kyc_profiles + tiers for user)
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"tier":               1,
		"label":              "Tier 1",
		"dailyLimitKobo":     3_000_000,
		"remainingKobo":      1_850_000,
		"canSend":            true,
		"canReceive":         true,
		"canWithdraw":        false,
		"canGoLive":          false,
		"nextTier":           2,
		"nextTierUnlocks":    "Go live, earn & withdraw up to ₦500,000/day",
	}})
}
