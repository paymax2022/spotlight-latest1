package handlers

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/services"
)

// WalletConnectHandler handles /api/v1/wallet/* endpoints for Paymax Connect module.
// All endpoints are gated behind auth (RequireAuthContext sets user_id in context).
//
// Reads project the ledger through WalletStore; every money mutation goes through
// wallet.Service so it posts a balanced journal and passes tier limits fail-closed.
type WalletConnectHandler struct {
	store     *WalletStore
	walletSvc *wallet.Service
	tiersSvc  *tiers.Service
	auditSvc  services.AuditService
}

func NewWalletConnectHandler(store *WalletStore, walletSvc *wallet.Service, tiersSvc *tiers.Service, auditSvc services.AuditService) *WalletConnectHandler {
	return &WalletConnectHandler{
		store:     store,
		walletSvc: walletSvc,
		tiersSvc:  tiersSvc,
		auditSvc:  auditSvc,
	}
}

var tierLabels = map[int]string{
	0: "Tier 0 (No KYC)",
	1: "Tier 1",
	2: "Tier 2",
	3: "Tier 3",
}

// tierPayload renders the shared tier/limits block used by several responses.
func tierPayload(u tiers.Usage) gin.H {
	t := int(u.Tier)
	return gin.H{
		"tier":            t,
		"label":           tierLabels[t],
		"dailyLimitKobo":  u.DailyLimitKobo,
		"remainingKobo":   u.RemainingKobo,
		"canSend":         t >= 1,
		"canReceive":      true,
		"canWithdraw":     t >= 2,
		"canGoLive":       t >= 2,
		"nextTier":        t + 1,
		"nextTierUnlocks": fmt.Sprintf("Higher limits and new features at Tier %d", t+1),
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

	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"balanceKobo": bal.BalanceKobo,
		"currency":    "NGN",
		"tier":        tierPayload(usage),
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

	reference := fmt.Sprintf("FUND-%s", generateShortID())

	// Balanced journal: DR provider_clearing -> CR user wallet.
	if err := h.walletSvc.Credit(c.Request.Context(), userID, reference, idemKey, body.AmountKobo); err != nil {
		writeMoneyError(c, err)
		return
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

	if h.auditSvc != nil {
		h.auditSvc.LogAction(userID, "", "fund_wallet", "wallet", "wallet",
			userID, nil, map[string]interface{}{
				"amount":    body.AmountKobo,
				"reference": reference,
			}, getIPAddress(c), c.Request.UserAgent(), "warning")
	}

	c.JSON(http.StatusCreated, gin.H{"data": gin.H{
		"ok":             true,
		"newBalanceKobo": bal.BalanceKobo,
		"balanceKobo":    bal.BalanceKobo,
		"tier":           tierPayload(usage),
		"entry": gin.H{
			"kind":       "fund",
			"direction":  "credit",
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

	txns, err := h.walletSvc.ListTransactions(c.Request.Context(), userID, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load history"})
		return
	}

	total, err := h.store.CountTransactions(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load history"})
		return
	}

	entries := []gin.H{}
	for _, txn := range txns.Transactions {
		entries = append(entries, gin.H{
			"id":         txn.ID,
			"ref":        txn.Reference,
			"kind":       "transaction",
			"direction":  txn.Type,
			"amountKobo": txn.AmountKobo,
			"status":     "completed",
			"title":      txn.Reference,
			"createdAt":  txn.CreatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"entries": entries,
		"total":   total,
		"limit":   txns.Limit,
		"offset":  txns.Offset,
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

	title := txn.Description
	if title == "" {
		title = txn.Reference
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"id":         txn.ID,
		"ref":        txn.Reference,
		"kind":       "transaction",
		"direction":  txn.Type,
		"amountKobo": txn.AmountKobo,
		"status":     "completed",
		"title":      title,
		"createdAt":  txn.CreatedAt,
	}})
}

// writeMoneyError maps money-path failures to HTTP responses. Tier and balance
// rejections are client errors with actionable messages; everything else is
// opaque so ledger internals never leak to the client.
func writeMoneyError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ledger.ErrDuplicate):
		c.JSON(http.StatusConflict, gin.H{"error": "this request was already processed"})
	case errors.Is(err, ledger.ErrInsufficientFunds):
		c.JSON(http.StatusBadRequest, gin.H{"error": "insufficient wallet balance"})
	case errors.Is(err, tiers.ErrWalletDisabled):
		c.JSON(http.StatusForbidden, gin.H{"error": "complete KYC to activate your wallet"})
	case errors.Is(err, tiers.ErrDailyLimitExceeded):
		c.JSON(http.StatusForbidden, gin.H{"error": "daily limit exceeded for your tier"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "transaction could not be completed"})
	}
}
