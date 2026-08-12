package handlers

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// WalletConnectHandler handles /api/v1/wallet/* endpoints for Paymax Connect module.
// All endpoints are gated behind auth (RequireAuthContext sets user_id in context).
type WalletConnectHandler struct{}

func NewWalletConnectHandler() *WalletConnectHandler {
	return &WalletConnectHandler{}
}

// GetSummary — GET /api/v1/wallet/summary
// Returns wallet balance + tier status.
func (h *WalletConnectHandler) GetSummary(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	// Mock data (Phase 2: query real ledger + tier)
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"balanceKobo": 4_250_000,
		"currency":    "NGN",
		"tier": gin.H{
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
		},
	}})
}

// FundWallet — POST /api/v1/wallet/fund (Idempotency-Key required)
// Top up wallet from Paymax wallet (only funding rail).
func (h *WalletConnectHandler) FundWallet(c *gin.Context) {
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

	if body.AmountKobo <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "amount must be greater than zero"})
		return
	}

	// Mock data (Phase 2: post ledger entry, increment balance, check tier limits)
	c.JSON(http.StatusCreated, gin.H{"data": gin.H{
		"ok":                 true,
		"newBalanceKobo":     4_250_000 + body.AmountKobo,
		"balanceKobo":        4_250_000 + body.AmountKobo,
		"tier":               gin.H{"tier": 1, "label": "Tier 1", "dailyLimitKobo": 3_000_000, "remainingKobo": 1_850_000},
		"entry":              gin.H{"id": "we_" + strconv.FormatInt(int64(c.Request.RequestURI[0]), 10), "kind": "fund", "direction": "credit", "amountKobo": body.AmountKobo, "status": "completed", "title": "Wallet top-up"},
	}})
}

// GetHistory — GET /api/v1/wallet/history
// Paginated wallet transaction history.
func (h *WalletConnectHandler) GetHistory(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	cursor := c.Query("cursor")
	_ = cursor // Phase 2: use cursor for pagination

	// Mock data (Phase 2: query ledger entries for user)
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"entries": []gin.H{
			{
				"id":                 "we_1",
				"ref":                "PMX-9F2A11",
				"kind":               "gift_received",
				"direction":          "credit",
				"amountKobo":         250_000,
				"balanceAfterKobo":   4_250_000,
				"status":             "completed",
				"title":              "Gift from Tobi",
				"counterpartyName":   "Tobi",
				"note":               "Rose 🌹",
				"createdAt":          "2026-08-10T10:30:00Z",
			},
		},
	}})
}

// GetHistoryEntry — GET /api/v1/wallet/history/:id
// Single transaction detail.
func (h *WalletConnectHandler) GetHistoryEntry(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	id := c.Param("id")

	// Mock data (Phase 2: query specific ledger entry for user)
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"id":               id,
		"ref":              "PMX-9F2A11",
		"kind":             "gift_received",
		"direction":        "credit",
		"amountKobo":       250_000,
		"balanceAfterKobo": 4_250_000,
		"status":           "completed",
		"title":            "Gift from Tobi",
		"counterpartyName": "Tobi",
		"note":             "Rose 🌹",
		"createdAt":        "2026-08-10T10:30:00Z",
	}})
}
