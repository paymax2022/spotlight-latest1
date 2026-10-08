package handlers

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/services"
)

// WalletConnectHandler handles /api/v1/wallet/* endpoints for Paymax Connect module.
// All endpoints are gated behind auth (RequireAuthContext sets user_id in context).
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
	userID := ginutil.UserID(c)
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

	reference := "FUND-" + generateShortID()

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
			userID, nil, map[string]any{
				"amount":    body.AmountKobo,
				"reference": reference,
			}, ginutil.ClientIP(c), c.Request.UserAgent(), "warning")
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
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	limit := 50
	offset := 0
	if l := c.Query("limit"); l != "" {
		_, _ = fmt.Sscanf(l, "%d", &limit)
	}
	if o := c.Query("offset"); o != "" {
		_, _ = fmt.Sscanf(o, "%d", &offset)
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
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	id := c.Param("id")

	// A non-UUID :id could never identify a ledger entry — report not-found
	// rather than letting the "invalid input syntax for type uuid" surface as
	// a 500 (same convention as the other :id routes).
	if _, err := uuid.Parse(id); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "transaction not found"})
		return
	}

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
		c.JSON(http.StatusInternalServerError, gin.H{"error": errTxnCouldNotComplete})
	}
}

// WalletStore provides read-only projections over the ledger for the Connect
// wallet endpoints. All money MUTATIONS go through finance/wallet.Service so
// they post balanced double-entry journals — never write ledger_entries here.
type WalletStore struct {
	db *pgxpool.Pool
}

// NewWalletStore creates a new wallet store.
func NewWalletStore(db *pgxpool.Pool) *WalletStore {
	return &WalletStore{db: db}
}

// Transaction is one ledger entry against the user's wallet account.
type Transaction struct {
	ID          string `json:"id"`
	Type        string `json:"type"` // "credit" or "debit" (user-facing direction)
	AmountKobo  int64  `json:"amountKobo"`
	Currency    string `json:"currency"`
	Reference   string `json:"reference"`
	Description string `json:"description"`
	CreatedAt   string `json:"createdAt"`
}

// direction maps a ledger entry type to the user-facing credit/debit direction.
// A REVERSAL_DEBIT restores funds, so it reads as a credit to the user.
func direction(entryType string) string {
	switch entryType {
	case "CREDIT", "REVERSAL_DEBIT":
		return "credit"
	default:
		return "debit"
	}
}

// CountTransactions returns the number of ledger entries against the user's wallet.
func (s *WalletStore) CountTransactions(ctx context.Context, userID string) (int64, error) {
	var total int64
	err := s.db.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM ledger_entries le
		JOIN ledger_accounts la ON la.id = le.account_id
		WHERE la.user_id = $1 AND la.type = 'user_wallet'
	`, userID).Scan(&total)
	if err != nil {
		return 0, fmt.Errorf("count transactions: %w", err)
	}
	return total, nil
}

// GetTransaction retrieves a single wallet ledger entry, scoped to the owner.
func (s *WalletStore) GetTransaction(ctx context.Context, userID string, txnID string) (*Transaction, error) {
	row := s.db.QueryRow(ctx, `
		SELECT le.id::text, le.type, le.amount_kobo, le.reference,
		       COALESCE(le.description, ''), le.created_at::text
		FROM ledger_entries le
		JOIN ledger_accounts la ON la.id = le.account_id
		WHERE le.id = $1 AND la.user_id = $2 AND la.type = 'user_wallet'
	`, txnID, userID)

	var t Transaction
	var entryType string
	err := row.Scan(&t.ID, &entryType, &t.AmountKobo, &t.Reference,
		&t.Description, &t.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil // Not found
	}
	if err != nil {
		return nil, fmt.Errorf("query transaction: %w", err)
	}

	t.Type = direction(entryType)
	t.Currency = "NGN"
	return &t, nil
}
