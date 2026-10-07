package handlers

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"spotlight/backend/go-common/dbutil"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/services"
)

const (
	strAmountkobo = "amountKobo"
	keyProduct    = "product"
	keyRef        = "ref"
	keyStatus     = "status"
	keyMessage    = "message"
	keyCreatedAt  = "createdAt"
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
			"id":          item.ID,
			"name":        item.Name,
			"description": item.Description,
			strAmountkobo: item.AmountKobo,
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

	// A non-UUID :id could never name a catalog row — report not-found rather
	// than letting the "invalid input syntax for type uuid" surface as a 500.
	if _, err := uuid.Parse(id); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "gift not found"})
		return
	}

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
		"id":          item.ID,
		"name":        item.Name,
		"description": item.Description,
		strAmountkobo: item.AmountKobo,
		"imageUrl":    item.ImageURL,
		"available":   item.Available,
	}})
}

// GetRecipients — GET /api/v1/wallet/gifting/recipients
// Search gift recipients.
func (h *GiftingConnectHandler) GetRecipients(c *gin.Context) {
	userID := ginutil.UserID(c)
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
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	productID := c.Query("productId")
	recipientID := c.Query("recipientId")

	// Missing/empty productId is a malformed request; a non-UUID value can
	// never name a row — without these gates both hit the uuid cast and 500.
	if productID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "productId is required"})
		return
	}
	if _, err := uuid.Parse(productID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "gift not found"})
		return
	}

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
		remainingAfter = max(usage.RemainingKobo-product.AmountKobo, 0)
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		keyProduct:           gin.H{"id": product.ID, "name": product.Name, strAmountkobo: product.AmountKobo},
		"recipient":          gin.H{"id": recipientID},
		strAmountkobo:        product.AmountKobo,
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
	userID := ginutil.UserID(c)
	idemKey := ginutil.IdempotencyKey(c)

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
	// A non-UUID recipient can never name a platform user — reject before it
	// reaches a uuid cast.
	if _, err := uuid.Parse(body.RecipientID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid recipient"})
		return
	}

	// The recipient must actually exist: without this check a bogus id fell
	// through to GetOrCreateUserWallet and surfaced as a 500.
	exists, err := h.store.UserExists(c.Request.Context(), body.RecipientID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to verify recipient"})
		return
	}
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "recipient not found"})
		return
	}

	// Scope the client-supplied Idempotency-Key per (rail, caller) before it
	// enters the global ledger keyspace: a raw key is unique per journal, so
	// the same key arriving from another rail (or another sender) would
	// collide on ledger_entries.idempotency_key and the debit would silently
	// no-op — recording a gift with no money behind it. The derived key keeps
	// a genuine retry a conflict rather than a phantom no-op.
	ledgerKey := "connect:wallet-gift:" + userID + ":" + idemKey

	// Deterministic reference derived from the ledger key — see
	// ledgerDerivedRef: a random ref strands every post-debit crash as a
	// permanent 409 (same key, different journal → replay refused) while the
	// money is already moved.
	reference := ledgerDerivedRef("GIFT-", ledgerKey)

	// Resolve the recipient's wallet so the journal has a real credit side.
	recipientWallet, err := h.ledgerSvc.GetOrCreateUserWallet(c.Request.Context(), body.RecipientID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "recipient wallet unavailable"})
		return
	}

	// Balanced journal: DR sender wallet -> CR recipient wallet. wallet.Debit
	// enforces the tier limit fail-closed and the balance check is TOCTOU-safe.
	debitErr := h.walletSvc.Debit(c.Request.Context(), userID, reference, ledgerKey, recipientWallet.ID, product.AmountKobo)
	if errors.Is(debitErr, ledger.ErrDuplicate) {
		// The derived key embeds this sender's user id, so a claim on it can only
		// come from this sender's own earlier attempt — e.g. a debit committed
		// under an older reference shape before a crash. If the durable pair is
		// provably this gift, adopt the RECORDED reference and finish the
		// projection; a foreign or tampered claim still fails closed as 409.
		senderWallet, werr := h.ledgerSvc.GetOrCreateUserWallet(c.Request.Context(), userID)
		if werr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "wallet unavailable"})
			return
		}
		recRef, ok, aerr := adoptLedgerReplay(c.Request.Context(), h.ledgerSvc, ledgerKey, senderWallet.ID, recipientWallet.ID, product.AmountKobo)
		if aerr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "transaction could not be completed"})
			return
		}
		if !ok {
			writeMoneyError(c, debitErr)
			return
		}
		reference = recRef
		debitErr = nil
	}
	if debitErr != nil {
		writeMoneyError(c, debitErr)
		return
	}

	gt, err := h.store.SendGift(c.Request.Context(), userID, body.RecipientID, body.ProductID, body.Message, product.AmountKobo, reference, ledgerKey)
	if err != nil {
		if dbutil.IsUniqueViolation(err) {
			// The gift row was already recorded by a first attempt that crashed
			// AFTER the debit committed — converge on it rather than failing a
			// true retry. The stored row must still be THIS gift (same sender +
			// recipient + amount): anything else under the derived key is a
			// foreign claim.
			existing, lerr := h.store.GetGiftByIdempotencyKey(c.Request.Context(), ledgerKey)
			if lerr != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to send gift"})
				return
			}
			if existing == nil || existing.SenderID != userID ||
				existing.RecipientID != body.RecipientID || existing.AmountKobo != product.AmountKobo {
				c.JSON(http.StatusConflict, gin.H{"error": "idempotency key conflict"})
				return
			}
			gt = existing
			err = nil
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to send gift"})
			return
		}
	}
	if h.auditSvc != nil {
		h.auditSvc.LogAction(userID, body.RecipientID, "send_gift", "wallet", "gift",
			gt.ID, nil, map[string]any{
				keyProduct:  body.ProductID,
				"amount":    product.AmountKobo,
				"reference": reference,
			}, ginutil.ClientIP(c), c.Request.UserAgent(), "warning")
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
			"id":          gt.ID,
			keyRef:        reference,
			keyProduct:    gin.H{"id": product.ID, "name": product.Name, strAmountkobo: product.AmountKobo},
			"recipient":   gin.H{"id": gt.RecipientID, "displayName": gt.RecipientName},
			strAmountkobo: product.AmountKobo,
			keyStatus:     gt.Status,
			keyMessage:    body.Message,
			keyCreatedAt:  gt.CreatedAt,
		},
		"balanceKobo": bal.BalanceKobo,
		"tier":        tierPayload(usage),
	}})
}

// GetSentGifts — GET /api/v1/wallet/gifting/sent
// View sent gifts.
func (h *GiftingConnectHandler) GetSentGifts(c *gin.Context) {
	userID := ginutil.UserID(c)
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
			"id":          g.ID,
			keyRef:        g.Reference,
			keyProduct:    gin.H{"id": g.ItemID, "name": g.ItemName, strAmountkobo: g.AmountKobo},
			"recipient":   gin.H{"id": g.RecipientID, "displayName": g.RecipientName},
			strAmountkobo: g.AmountKobo,
			keyStatus:     g.Status,
			keyMessage:    g.Message,
			keyCreatedAt:  g.CreatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": data, "total": total})
}

// GetReceivedGifts — GET /api/v1/wallet/gifting/received
// View received gifts.
func (h *GiftingConnectHandler) GetReceivedGifts(c *gin.Context) {
	userID := ginutil.UserID(c)
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
			"id":          g.ID,
			keyRef:        g.Reference,
			keyProduct:    gin.H{"id": g.ItemID, "name": g.ItemName, strAmountkobo: g.AmountKobo},
			"sender":      gin.H{"id": g.SenderID, "displayName": g.SenderName},
			strAmountkobo: g.AmountKobo,
			keyStatus:     g.Status,
			keyMessage:    g.Message,
			keyCreatedAt:  g.CreatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": data, "total": total})
}

// GetGiftTransaction — GET /api/v1/wallet/gifting/transactions/:id
// Single gift transaction detail.
func (h *GiftingConnectHandler) GetGiftTransaction(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	id := c.Param("id")

	// Non-UUID ids can never name a gift transaction — 404, not a 500 cast error.
	if _, err := uuid.Parse(id); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "gift not found"})
		return
	}

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
		"id":          gt.ID,
		keyRef:        gt.Reference,
		keyProduct:    gin.H{"id": gt.ItemID, "name": gt.ItemName, strAmountkobo: gt.AmountKobo},
		"sender":      gin.H{"id": gt.SenderID, "displayName": gt.SenderName},
		"recipient":   gin.H{"id": gt.RecipientID, "displayName": gt.RecipientName},
		strAmountkobo: gt.AmountKobo,
		keyStatus:     gt.Status,
		keyMessage:    gt.Message,
		keyCreatedAt:  gt.CreatedAt,
	}})
}
