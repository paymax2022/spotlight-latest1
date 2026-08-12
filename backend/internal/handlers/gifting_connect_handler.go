package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// GiftingConnectHandler handles /api/v1/wallet/gifting/* endpoints.
type GiftingConnectHandler struct{}

func NewGiftingConnectHandler() *GiftingConnectHandler {
	return &GiftingConnectHandler{}
}

// GetCatalog — GET /api/v1/wallet/gifting/catalog
// List all available gift products.
func (h *GiftingConnectHandler) GetCatalog(c *gin.Context) {
	// Mock data (Phase 2: query gift_products table)
	c.JSON(http.StatusOK, gin.H{"data": []gin.H{
		{"id": "g_rose", "name": "Rose", "emoji": "🌹", "priceKobo": 50_000, "description": "A classic hello", "tierMin": 1},
		{"id": "g_coffee", "name": "Coffee", "emoji": "☕", "priceKobo": 99_000, "description": "Break the ice", "tierMin": 1},
		{"id": "g_heart", "name": "Heart", "emoji": "❤️", "priceKobo": 150_000, "description": "Show you care", "tierMin": 1},
		{"id": "g_bouquet", "name": "Bouquet", "emoji": "💐", "priceKobo": 300_000, "description": "Make it special", "tierMin": 1},
		{"id": "g_crown", "name": "Crown", "emoji": "👑", "priceKobo": 750_000, "description": "Treat royalty", "tierMin": 2},
		{"id": "g_diamond", "name": "Diamond", "emoji": "💎", "priceKobo": 2_000_000, "description": "Go all out", "tierMin": 2},
	}})
}

// GetProduct — GET /api/v1/wallet/gifting/catalog/:id
// Single gift product detail.
func (h *GiftingConnectHandler) GetProduct(c *gin.Context) {
	id := c.Param("id")

	// Mock data (Phase 2: query gift_products by id)
	products := map[string]gin.H{
		"g_rose":    {"id": "g_rose", "name": "Rose", "emoji": "🌹", "priceKobo": 50_000, "description": "A classic hello", "tierMin": 1},
		"g_coffee":  {"id": "g_coffee", "name": "Coffee", "emoji": "☕", "priceKobo": 99_000, "description": "Break the ice", "tierMin": 1},
		"g_heart":   {"id": "g_heart", "name": "Heart", "emoji": "❤️", "priceKobo": 150_000, "description": "Show you care", "tierMin": 1},
		"g_bouquet": {"id": "g_bouquet", "name": "Bouquet", "emoji": "💐", "priceKobo": 300_000, "description": "Make it special", "tierMin": 1},
		"g_crown":   {"id": "g_crown", "name": "Crown", "emoji": "👑", "priceKobo": 750_000, "description": "Treat royalty", "tierMin": 2},
		"g_diamond": {"id": "g_diamond", "name": "Diamond", "emoji": "💎", "priceKobo": 2_000_000, "description": "Go all out", "tierMin": 2},
	}

	if prod, ok := products[id]; ok {
		c.JSON(http.StatusOK, gin.H{"data": prod})
	} else {
		c.JSON(http.StatusNotFound, gin.H{"error": "gift not found"})
	}
}

// GetRecipients — GET /api/v1/wallet/gifting/recipients
// Search gift recipients.
func (h *GiftingConnectHandler) GetRecipients(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	q := c.Query("q")
	_ = q // Phase 2: filter by query

	// Mock data (Phase 2: query users for gifting, filter by name/handle)
	c.JSON(http.StatusOK, gin.H{"data": []gin.H{
		{"id": "p1", "displayName": "Zainab", "handle": "@zainab"},
		{"id": "p2", "displayName": "Tobi", "handle": "@tobi"},
		{"id": "p3", "displayName": "Amaka", "handle": "@amaka"},
		{"id": "p4", "displayName": "Kelechi", "handle": "@kelechi"},
	}})
}

// QuoteGift — GET /api/v1/wallet/gifting/quote
// Get gift price + fee (server validates tier limit fail-closed).
func (h *GiftingConnectHandler) QuoteGift(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	productID := c.Query("productId")
	recipientID := c.Query("recipientId")

	// Mock data (Phase 2: validate productID exists, get user tier, check limit)
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"product":              gin.H{"id": productID, "name": "Rose", "emoji": "🌹", "priceKobo": 50_000, "tierMin": 1},
		"recipient":            gin.H{"id": recipientID, "displayName": "Zainab", "handle": "@zainab"},
		"amountKobo":           50_000,
		"feeKobo":              0,
		"totalKobo":            50_000,
		"tier":                 gin.H{"tier": 1, "label": "Tier 1", "dailyLimitKobo": 3_000_000, "remainingKobo": 1_850_000},
		"remainingAfterKobo":   1_800_000,
		"withinLimit":          true,
	}})
}

// SendGift — POST /api/v1/wallet/gifting/send (Idempotency-Key required)
// Send gift (wallet-to-wallet money mutation).
func (h *GiftingConnectHandler) SendGift(c *gin.Context) {
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
		ProductID  string `json:"productId"`
		RecipientID string `json:"recipientId"`
		Message    string `json:"message"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	// Mock data (Phase 2: check tier limit, post double-entry ledger, emit audit)
	c.JSON(http.StatusCreated, gin.H{"data": gin.H{
		"ok": true,
		"transaction": gin.H{
			"id":         "gt_1",
			"ref":        "PMX-ABC123",
			"product":    gin.H{"id": body.ProductID, "name": "Rose", "emoji": "🌹", "priceKobo": 50_000},
			"recipient":  gin.H{"id": body.RecipientID, "displayName": "Zainab", "handle": "@zainab"},
			"amountKobo": 50_000,
			"status":     "completed",
			"message":    body.Message,
			"createdAt":  "2026-08-12T10:30:00Z",
		},
		"balanceKobo": 4_200_000,
		"tier":        gin.H{"tier": 1, "dailyLimitKobo": 3_000_000, "remainingKobo": 1_800_000},
	}})
}

// GetSentGifts — GET /api/v1/wallet/gifting/sent
// View sent gifts.
func (h *GiftingConnectHandler) GetSentGifts(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	// Mock data (Phase 2: query gift_transactions for user, filter by direction=sent)
	c.JSON(http.StatusOK, gin.H{"data": []gin.H{
		{
			"id":         "gt_s1",
			"ref":        "PMX-7C8B40",
			"product":    gin.H{"id": "g_coffee", "name": "Coffee", "emoji": "☕", "priceKobo": 99_000},
			"recipient":  gin.H{"id": "p3", "displayName": "Amaka", "handle": "@amaka"},
			"amountKobo": 99_000,
			"status":     "completed",
			"message":    "Loved your profile!",
			"createdAt":  "2026-08-10T12:00:00Z",
		},
	}})
}

// GetReceivedGifts — GET /api/v1/wallet/gifting/received
// View received gifts.
func (h *GiftingConnectHandler) GetReceivedGifts(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	// Mock data (Phase 2: query gift_transactions for user, filter by direction=received)
	c.JSON(http.StatusOK, gin.H{"data": []gin.H{
		{
			"id":        "gt_r1",
			"ref":       "PMX-9F2A11",
			"product":   gin.H{"id": "g_rose", "name": "Rose", "emoji": "🌹", "priceKobo": 50_000},
			"sender":    gin.H{"id": "p2", "displayName": "Tobi", "handle": "@tobi"},
			"amountKobo": 50_000,
			"status":    "completed",
			"message":   "Hi 🌹",
			"createdAt": "2026-08-10T14:00:00Z",
		},
	}})
}

// GetGiftTransaction — GET /api/v1/wallet/gifting/transactions/:id
// Single gift transaction detail.
func (h *GiftingConnectHandler) GetGiftTransaction(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	id := c.Param("id")

	// Mock data (Phase 2: query gift_transactions by id)
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"id":         id,
		"ref":        "PMX-9F2A11",
		"product":    gin.H{"id": "g_rose", "name": "Rose", "emoji": "🌹", "priceKobo": 50_000},
		"sender":     gin.H{"id": "p2", "displayName": "Tobi", "handle": "@tobi"},
		"amountKobo": 50_000,
		"status":     "completed",
		"message":    "Hi 🌹",
		"createdAt":  "2026-08-10T14:00:00Z",
	}})
}
