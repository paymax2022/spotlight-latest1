package handlers

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/services"
)

// PayoutsConnectHandler handles /api/v1/wallet/payouts/* endpoints for creator earnings.
type PayoutsConnectHandler struct {
	store     *PayoutsStore
	walletSvc *wallet.Service
	ledgerSvc *ledger.Service
	auditSvc  services.AuditService
}

func NewPayoutsConnectHandler(store *PayoutsStore, walletSvc *wallet.Service, ledgerSvc *ledger.Service, auditSvc services.AuditService) *PayoutsConnectHandler {
	return &PayoutsConnectHandler{
		store:     store,
		walletSvc: walletSvc,
		ledgerSvc: ledgerSvc,
		auditSvc:  auditSvc,
	}
}

// GetEligibility — GET /api/v1/wallet/payouts/eligibility
// Check payout eligibility (Tier2+ gated).
func (h *PayoutsConnectHandler) GetEligibility(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	elig, err := h.store.GetPayoutEligibility(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load eligibility"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"eligible":           elig.Eligible,
		"tier":               gin.H{"tier": elig.Tier},
		"currentBalanceKobo": elig.CurrentBalanceKobo,
		"minimumBalanceKobo": elig.MinimumBalanceKobo,
		"message":            elig.Message,
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

	// Check eligibility first
	elig, err := h.store.GetPayoutEligibility(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to check payout eligibility"})
		return
	}
	if !elig.Eligible {
		c.JSON(http.StatusForbidden, gin.H{"error": "not eligible for payouts: " + elig.Message})
		return
	}

	if body.AmountKobo > elig.CurrentBalanceKobo {
		c.JSON(http.StatusBadRequest, gin.H{"error": "amount exceeds your available balance"})
		return
	}

	reference := fmt.Sprintf("PAYOUT-%s", generateShortID())

	// Payout funds leave the user wallet into the settlement account, which the
	// disbursement job draws against. Balanced journal, tier-gated, TOCTOU-safe.
	settlement, err := h.ledgerSvc.GetOrCreateStandingAccount(c.Request.Context(), ledger.AccountSettlement)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "settlement account unavailable"})
		return
	}
	if err := h.walletSvc.Debit(c.Request.Context(), userID, reference, idemKey, settlement.ID, body.AmountKobo); err != nil {
		writeMoneyError(c, err)
		return
	}

	payout, err := h.store.RequestPayout(c.Request.Context(), userID, body.AmountKobo, "", "", "", reference, idemKey)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to request payout"})
		return
	}

	// Emit audit event
	if h.auditSvc != nil {
		h.auditSvc.LogAction(userID, "", "request_payout", "wallet", "payout",
			payout.ID, nil, map[string]interface{}{
				"amount":    body.AmountKobo,
				"reference": reference,
			}, getIPAddress(c), c.Request.UserAgent(), "warning")
	}

	// Read the post-debit balance back from the ledger rather than deriving it
	// from the pre-check figure, which is stale by the time the journal posts.
	availableKobo := elig.CurrentBalanceKobo - body.AmountKobo
	if bal, balErr := h.walletSvc.GetBalance(c.Request.Context(), userID); balErr == nil {
		availableKobo = bal.BalanceKobo
	}

	c.JSON(http.StatusCreated, gin.H{"data": gin.H{
		"ok": true,
		"request": gin.H{
			"id":        payout.ID,
			"ref":        reference,
			"amountKobo": body.AmountKobo,
			"status":     payout.Status,
			"createdAt":  payout.CreatedAt,
		},
		"availableKobo": availableKobo,
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

	payouts, total, err := h.store.GetPayoutHistory(c.Request.Context(), userID, 50, 0)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load payout history"})
		return
	}

	data := []gin.H{}
	for _, p := range payouts {
		data = append(data, gin.H{
			"id":         p.ID,
			"ref":        p.Reference,
			"amountKobo": p.AmountKobo,
			"status":     p.Status,
			"bankName":   p.BankName,
			"createdAt":  p.CreatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": data, "total": total})
}
