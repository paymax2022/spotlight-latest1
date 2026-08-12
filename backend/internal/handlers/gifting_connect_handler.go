package handlers

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/services"
)

// GiftingConnectHandler handles /api/v1/wallet/gifting/* endpoints.
type GiftingConnectHandler struct {
	store     *GiftingStore
	walletSvc *wallet.Service
	ledgerSvc *ledger.Service
	tiersSvc  *tiers.Service
	auditSvc  services.AuditService
}

func NewGiftingConnectHandler(store *GiftingStore, walletSvc *wallet.Service, ledgerSvc *ledger.Service, tiersSvc *tiers.Service, auditSvc services.AuditService) *GiftingConnectHandler {
	return &GiftingConnectHandler{
		store:     store,
		walletSvc: walletSvc,
		ledgerSvc: ledgerSvc,
		tiersSvc:  tiersSvc,
		auditSvc:  auditSvc,
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

	product, err := h.store.GetCatalogItem(c.Request.Context(), productID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load product"})
		return
	}
	if product == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "gift not found"})
		return
	}

	usage, err := h.tiersSvc.GetUsage(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load tier limits"})
		return
	}

	// Gifting carries no fee today; total tracks amount so the client can render
	// a fee line without a contract change when one is introduced.
	withinLimit := usage.RemainingKobo < 0 || product.AmountKobo <= usage.RemainingKobo
	remainingAfter := usage.RemainingKobo
	if usage.RemainingKobo >= 0 {
		remainingAfter = usage.RemainingKobo - product.AmountKobo
		if remainingAfter < 0 {
			remainingAfter = 0
		}
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"product":            gin.H{"id": product.ID, "name": product.Name, "amountKobo": product.AmountKobo},
		"recipient":          gin.H{"id": recipientID},
		"amountKobo":         product.AmountKobo,
		"feeKobo":            0,
		"totalKobo":          product.AmountKobo,
		"tier":               tierPayload(usage),
		"remainingAfterKobo": remainingAfter,
		"withinLimit":        withinLimit,
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

	if body.RecipientID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "recipient is required"})
		return
	}
	if body.RecipientID == userID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "you cannot gift yourself"})
		return
	}

	reference := fmt.Sprintf("GIFT-%s", generateShortID())

	// Resolve the recipient's wallet so the journal has a real credit side.
	recipientWallet, err := h.ledgerSvc.GetOrCreateUserWallet(c.Request.Context(), body.RecipientID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "recipient wallet unavailable"})
		return
	}

	// Balanced journal: DR sender wallet -> CR recipient wallet. wallet.Debit
	// enforces the tier limit fail-closed and the balance check is TOCTOU-safe.
	if err := h.walletSvc.Debit(c.Request.Context(), userID, reference, idemKey, recipientWallet.ID, product.AmountKobo); err != nil {
		writeMoneyError(c, err)
		return
	}

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

	bal, err := h.walletSvc.GetBalance(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load wallet"})
		return
	}
	usage, err := h.tiersSvc.GetUsage(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load tier limits"})
		return
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
		"balanceKobo": bal.BalanceKobo,
		"tier":        tierPayload(usage),
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
