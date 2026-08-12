package handlers

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/services"
)

// GiftingConnectHandler handles /api/v1/wallet/gifting/* endpoints.
type GiftingConnectHandler struct {
	store    *GiftingStore
	auditSvc services.AuditService
}

func NewGiftingConnectHandler(store *GiftingStore, auditSvc services.AuditService) *GiftingConnectHandler {
	return &GiftingConnectHandler{
		store:    store,
		auditSvc: auditSvc,
	}
}

// GetCatalog — GET /api/v1/wallet/gifting/catalog
// List all available gift products.
func (h *GiftingConnectHandler) GetCatalog(c *gin.Context) {
	items, err := h.store.GetCatalog(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load catalog"})
		return
	}

	data := []gin.H{}
	for _, item := range items {
		data = append(data, gin.H{
			"id":           item.ID,
			"name":         item.Name,
			"description": item.Description,
			"amountKobo":   item.AmountKobo,
			"imageUrl":    item.ImageURL,
			"available":   item.Available,
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": data})
}

// GetProduct — GET /api/v1/wallet/gifting/catalog/:id
// Single gift product detail.
func (h *GiftingConnectHandler) GetProduct(c *gin.Context) {
	id := c.Param("id")

	item, err := h.store.GetCatalogItem(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load product"})
		return
	}
	if item == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "gift not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"id":           item.ID,
		"name":         item.Name,
		"description": item.Description,
		"amountKobo":   item.AmountKobo,
		"imageUrl":    item.ImageURL,
		"available":   item.Available,
	}})
}

// GetRecipients — GET /api/v1/wallet/gifting/recipients
// Search gift recipients.
func (h *GiftingConnectHandler) GetRecipients(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	recipients, err := h.store.GetRecipients(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load recipients"})
		return
	}

	data := []gin.H{}
	for _, r := range recipients {
		data = append(data, gin.H{
			"id":          r.UserID,
			"displayName": r.Name,
			"email":       r.Email,
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": data})
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
		ProductID   string `json:"productId"`
		RecipientID string `json:"recipientId"`
		Message     string `json:"message"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	// Get product details
	product, err := h.store.GetCatalogItem(c.Request.Context(), body.ProductID)
	if err != nil || product == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "product not found"})
		return
	}

	// Generate reference
	reference := fmt.Sprintf("GIFT-%d-%s", len(idemKey), generateShortID())

	// Phase 2: Check tier limit, post double-entry ledger
	// ledger.Debit(ctx, senderID, ref, idemKey, walletAcct, amount)
	// ledger.Credit(ctx, recipientID, ref, idemKey, senderAcct, amount)

	// Record gift transaction
	gt, err := h.store.SendGift(c.Request.Context(), userID, body.RecipientID, body.ProductID, body.Message, product.AmountKobo, reference, idemKey)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to send gift"})
		return
	}

	// Emit audit event
	if h.auditSvc != nil {
		h.auditSvc.LogAction(userID, body.RecipientID, "send_gift", "wallet", "gift",
			gt.ID, nil, map[string]interface{}{
				"product":   body.ProductID,
				"amount":    product.AmountKobo,
				"reference": reference,
			}, getIPAddress(c), c.Request.UserAgent(), "warning")
	}

	c.JSON(http.StatusCreated, gin.H{"data": gin.H{
		"ok": true,
		"transaction": gin.H{
			"id":         gt.ID,
			"ref":        reference,
			"product":    gin.H{"id": product.ID, "name": product.Name, "amountKobo": product.AmountKobo},
			"recipient":  gin.H{"id": gt.RecipientID, "displayName": gt.RecipientName},
			"amountKobo": product.AmountKobo,
			"status":     gt.Status,
			"message":    body.Message,
			"createdAt":  gt.CreatedAt,
		},
		"balanceKobo": 0, // Phase 2: query updated balance
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

	limit := 50
	offset := 0

	gifts, total, err := h.store.GetSentGifts(c.Request.Context(), userID, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load sent gifts"})
		return
	}

	data := []gin.H{}
	for _, g := range gifts {
		data = append(data, gin.H{
			"id":         g.ID,
			"ref":        g.Reference,
			"product":    gin.H{"id": g.ItemID, "name": g.ItemName, "amountKobo": g.AmountKobo},
			"recipient":  gin.H{"id": g.RecipientID, "displayName": g.RecipientName},
			"amountKobo": g.AmountKobo,
			"status":     g.Status,
			"message":    g.Message,
			"createdAt":  g.CreatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": data, "total": total})
}

// GetReceivedGifts — GET /api/v1/wallet/gifting/received
// View received gifts.
func (h *GiftingConnectHandler) GetReceivedGifts(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	limit := 50
	offset := 0

	gifts, total, err := h.store.GetReceivedGifts(c.Request.Context(), userID, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load received gifts"})
		return
	}

	data := []gin.H{}
	for _, g := range gifts {
		data = append(data, gin.H{
			"id":         g.ID,
			"ref":        g.Reference,
			"product":    gin.H{"id": g.ItemID, "name": g.ItemName, "amountKobo": g.AmountKobo},
			"sender":     gin.H{"id": g.SenderID, "displayName": g.SenderName},
			"amountKobo": g.AmountKobo,
			"status":     g.Status,
			"message":    g.Message,
			"createdAt":  g.CreatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": data, "total": total})
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

	gt, err := h.store.GetGiftTransaction(c.Request.Context(), userID, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load gift"})
		return
	}
	if gt == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "gift not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"id":         gt.ID,
		"ref":        gt.Reference,
		"product":    gin.H{"id": gt.ItemID, "name": gt.ItemName, "amountKobo": gt.AmountKobo},
		"sender":     gin.H{"id": gt.SenderID, "displayName": gt.SenderName},
		"recipient":  gin.H{"id": gt.RecipientID, "displayName": gt.RecipientName},
		"amountKobo": gt.AmountKobo,
		"status":     gt.Status,
		"message":    gt.Message,
		"createdAt":  gt.CreatedAt,
	}})
}
