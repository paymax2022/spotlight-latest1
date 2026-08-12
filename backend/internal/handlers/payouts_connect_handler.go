package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// PayoutsConnectHandler handles /api/v1/wallet/payouts/* endpoints for creator earnings.
type PayoutsConnectHandler struct{}

func NewPayoutsConnectHandler() *PayoutsConnectHandler {
	return &PayoutsConnectHandler{}
}

// GetEligibility — GET /api/v1/wallet/payouts/eligibility
// Check payout eligibility (Tier2+ gated).
func (h *PayoutsConnectHandler) GetEligibility(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	// Mock data (Phase 2: query user tier + kyc status, check if tier >= 2)
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"eligible":           false,
		"tier":               gin.H{"tier": 1, "label": "Tier 1"},
		"availableKobo":      1_240_000,
		"pendingKobo":        320_000,
		"minPayoutKobo":      100_000,
		"reason":             "Reach Tier 2 (ID + proof of address) to withdraw gift revenue.",
		"payoutMethodMasked": nil,
	}})
}

// RequestPayout — POST /api/v1/wallet/payouts/request (Idempotency-Key required)
// Request creator payout (money mutation, Tier2+ gated).
func (h *PayoutsConnectHandler) RequestPayout(c *gin.Context) {
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
		AmountKobo int64 `json:"amountKobo"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if body.AmountKobo < 100_000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "minimum payout is ₦1,000"})
		return
	}
	if body.AmountKobo > 1_240_000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "amount exceeds your available balance"})
		return
	}

	// Mock data (Phase 2: check tier, post double-entry ledger, create payout_request, emit audit)
	feeKobo := int64(5_000) // flat ₦50 fee
	c.JSON(http.StatusCreated, gin.H{"data": gin.H{
		"ok": true,
		"request": gin.H{
			"id":                   "po_1",
			"ref":                  "PMX-PAY001",
			"amountKobo":           body.AmountKobo,
			"feeKobo":              feeKobo,
			"netKobo":              body.AmountKobo - feeKobo,
			"status":               "requested",
			"payoutMethodMasked":   "GTBank ••• 4421",
			"createdAt":            "2026-08-12T10:30:00Z",
		},
		"availableKobo": 1_240_000 - body.AmountKobo,
	}})
}

// GetHistory — GET /api/v1/wallet/payouts/history
// View payout history.
func (h *PayoutsConnectHandler) GetHistory(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	// Mock data (Phase 2: query payout_requests for user)
	c.JSON(http.StatusOK, gin.H{"data": []gin.H{
		{
			"id":                 "po_1",
			"ref":                "PMX-PAY771",
			"amountKobo":         500_000,
			"feeKobo":            5_000,
			"netKobo":            495_000,
			"status":             "paid",
			"payoutMethodMasked": "GTBank ••• 4421",
			"createdAt":          "2026-08-07T14:00:00Z",
		},
		{
			"id":                 "po_2",
			"ref":                "PMX-PAY802",
			"amountKobo":         300_000,
			"feeKobo":            5_000,
			"netKobo":            295_000,
			"status":             "processing",
			"payoutMethodMasked": "GTBank ••• 4421",
			"createdAt":          "2026-08-12T06:00:00Z",
		},
	}})
}
