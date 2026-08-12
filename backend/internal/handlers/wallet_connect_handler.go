package handlers

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/services"
)

// WalletConnectHandler handles /api/v1/wallet/* endpoints for Paymax Connect module.
// All endpoints are gated behind auth (RequireAuthContext sets user_id in context).
type WalletConnectHandler struct {
	store      *WalletStore
	auditSvc   services.AuditService
}

func NewWalletConnectHandler(store *WalletStore, auditSvc services.AuditService) *WalletConnectHandler {
	return &WalletConnectHandler{
		store:    store,
		auditSvc: auditSvc,
	}
}

// GetSummary — GET /api/v1/wallet/summary
// Returns wallet balance + tier status.
func (h *WalletConnectHandler) GetSummary(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	summary, err := h.store.GetWalletSummary(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load wallet"})
		return
	}

	// Calculate remaining limits
	dailyRemaining := summary.DailyLimit - summary.DailySpent

	tierLabels := map[int]string{
		0: "Tier 0 (No KYC)",
		1: "Tier 1",
		2: "Tier 2",
		3: "Tier 3",
	}

	canWithdraw := summary.Tier >= 2
	canGoLive := summary.Tier >= 2

	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"balanceKobo": summary.BalanceKobo,
		"currency":    summary.Currency,
		"tier": gin.H{
			"tier":            summary.Tier,
			"label":          tierLabels[summary.Tier],
			"dailyLimitKobo": summary.DailyLimit,
			"remainingKobo":  dailyRemaining,
			"canSend":        summary.Tier >= 1,
			"canReceive":     true,
			"canWithdraw":    canWithdraw,
			"canGoLive":      canGoLive,
			"nextTier":       summary.Tier + 1,
			"nextTierUnlocks": fmt.Sprintf("Higher limits and new features at Tier %d", summary.Tier+1),
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

	// Generate reference
	reference := fmt.Sprintf("FUND-%d-%s", len(idemKey), generateShortID())

	// Phase 2: Post ledger entry (Credit from Paymax revenue)
	// ledger.Credit(ctx, userID, reference, idemKey, AccountPaymaxRevenue, body.AmountKobo)
	// For now: Record in wallet_transactions table
	txn, err := h.store.RecordFunding(c.Request.Context(), userID, reference, body.AmountKobo, idemKey)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fund wallet"})
		return
	}

	// Get updated summary
	summary, err := h.store.GetWalletSummary(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load wallet"})
		return
	}

	// Emit audit event
	if h.auditSvc != nil {
		h.auditSvc.LogAction(userID, "", "fund_wallet", "wallet", "wallet",
			userID, nil, map[string]interface{}{
				"amount":    body.AmountKobo,
				"reference": reference,
			}, getIPAddress(c), c.Request.UserAgent(), "warning")
	}

	c.JSON(http.StatusCreated, gin.H{"data": gin.H{
		"ok":             true,
		"newBalanceKobo": summary.BalanceKobo,
		"balanceKobo":    summary.BalanceKobo,
		"tier": gin.H{
			"tier":            summary.Tier,
			"label":          fmt.Sprintf("Tier %d", summary.Tier),
			"dailyLimitKobo": summary.DailyLimit,
			"remainingKobo":  summary.DailyLimit - summary.DailySpent,
		},
		"entry": gin.H{
			"id":           txn.ID,
			"kind":        "fund",
			"direction":   "credit",
			"amountKobo": body.AmountKobo,
			"status":     "completed",
			"reference":  reference,
			"title":      "Wallet top-up",
		},
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

	limit := 50
	offset := 0
	if l := c.Query("limit"); l != "" {
		fmt.Sscanf(l, "%d", &limit)
	}
	if o := c.Query("offset"); o != "" {
		fmt.Sscanf(o, "%d", &offset)
	}

	transactions, total, err := h.store.GetTransactionHistory(c.Request.Context(), userID, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load history"})
		return
	}

	entries := []gin.H{}
	for _, txn := range transactions {
		entries = append(entries, gin.H{
			"id":         txn.ID,
			"ref":        txn.Reference,
			"kind":       "transaction",
			"direction":  txn.Type,
			"amountKobo": txn.AmountKobo,
			"status":     "completed",
			"title":      txn.Description,
			"createdAt":  txn.CreatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"entries": entries,
		"total":   total,
		"limit":   limit,
		"offset":  offset,
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

	txn, err := h.store.GetTransaction(c.Request.Context(), userID, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load transaction"})
		return
	}
	if txn == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "transaction not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"id":           txn.ID,
		"ref":          txn.Reference,
		"kind":         "transaction",
		"direction":    txn.Type,
		"amountKobo":   txn.AmountKobo,
		"status":       "completed",
		"title":        txn.Description,
		"createdAt":    txn.CreatedAt,
	}})
}
