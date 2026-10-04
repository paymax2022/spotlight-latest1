package handlers

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
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
	userID := ginutil.UserID(c)
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

	if body.AmountKobo < 100_000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "minimum payout is ₦1,000"})
		return
	}

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
	if h.auditSvc != nil {
		h.auditSvc.LogAction(userID, "", "request_payout", "wallet", "payout",
			payout.ID, nil, map[string]interface{}{
				"amount":    body.AmountKobo,
				"reference": reference,
			}, ginutil.ClientIP(c), c.Request.UserAgent(), "warning")
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
			"id":         payout.ID,
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
	userID := ginutil.UserID(c)
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

// PayoutsStore provides data access for payout operations.
type PayoutsStore struct {
	db *pgxpool.Pool
}

// NewPayoutsStore creates a new payouts store.
func NewPayoutsStore(db *pgxpool.Pool) *PayoutsStore {
	return &PayoutsStore{db: db}
}

// PayoutEligibility represents user's payout eligibility.
type PayoutEligibility struct {
	UserID             string   `json:"userId"`
	Tier               int      `json:"tier"`
	Eligible           bool     `json:"eligible"`
	MinimumBalanceKobo int64    `json:"minimumBalanceKobo"`
	CurrentBalanceKobo int64    `json:"currentBalanceKobo"`
	RequiredDocuments  []string `json:"requiredDocuments"`
	Message            string   `json:"message"`
}

// GetPayoutEligibility checks if user can request a payout.
func (s *PayoutsStore) GetPayoutEligibility(ctx context.Context, userID string) (*PayoutEligibility, error) {
	// Tier comes from user_profiles.kyc_tier — the same source finance/tiers
	// enforces against — so the eligibility preview cannot disagree with the
	// fail-closed gate that actually blocks the debit.
	row := s.db.QueryRow(ctx, `
		SELECT
			p.id::text,
			COALESCE(p.kyc_tier, 0) AS tier,
			COALESCE(p.kyc_tier, 0) >= 2 AS eligible,
			CASE COALESCE(p.kyc_tier, 0)
				WHEN 2 THEN 100000
				WHEN 3 THEN 50000
				ELSE 1000000
			END AS minimum_balance_kobo,
			(
				SELECT COALESCE(SUM(
					CASE WHEN le.type IN ('CREDIT', 'REVERSAL_DEBIT')
					     THEN le.amount_kobo ELSE -le.amount_kobo END
				), 0)
				FROM ledger_entries le
				JOIN ledger_accounts la ON la.id = le.account_id
				WHERE la.user_id = p.id AND la.type = 'user_wallet'
			) AS current_balance_kobo
		FROM user_profiles p
		WHERE p.id = $1
	`, userID)

	var elig PayoutEligibility
	err := row.Scan(&elig.UserID, &elig.Tier, &elig.Eligible,
		&elig.MinimumBalanceKobo, &elig.CurrentBalanceKobo)
	if errors.Is(err, pgx.ErrNoRows) {
		return &PayoutEligibility{
			UserID:   userID,
			Tier:     0,
			Eligible: false,
			Message:  "KYC Tier 2 or higher required for payouts",
		}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query payout eligibility: %w", err)
	}

	if elig.Eligible && elig.CurrentBalanceKobo < elig.MinimumBalanceKobo {
		elig.Eligible = false
		elig.Message = fmt.Sprintf("Minimum balance %d kobo required", elig.MinimumBalanceKobo)
	} else if elig.Tier < 2 {
		elig.Message = "KYC Tier 2 or higher required for payouts"
	} else {
		elig.Message = "Eligible for payout"
	}

	return &elig, nil
}

// PayoutRequest represents a payout request.
type PayoutRequest struct {
	ID            string         `json:"id"`
	Reference     string         `json:"reference"`
	UserID        string         `json:"userId"`
	AmountKobo    int64          `json:"amountKobo"`
	Status        string         `json:"status"` // pending, processing, completed, failed
	BankName      string         `json:"bankName"`
	AccountNumber string         `json:"accountNumber"`
	AccountName   string         `json:"accountName"`
	CreatedAt     string         `json:"createdAt"`
	CompletedAt   sql.NullString `json:"completedAt"`
}

// RequestPayout creates a new payout request.
func (s *PayoutsStore) RequestPayout(ctx context.Context, userID string, amountKobo int64, bankName string, accountNumber string, accountName string, reference string, idemKey string) (*PayoutRequest, error) {
	row := s.db.QueryRow(ctx, `
		INSERT INTO payouts (
			id, user_id, reference, amount_kobo, status,
			bank_name, account_number, account_name,
			idempotency_key, created_at
		) VALUES (
			gen_random_uuid(), $1, $2, $3, 'pending',
			$4, $5, $6, $7, NOW()
		)
		RETURNING id, reference, user_id, amount_kobo, status,
		          bank_name, account_number, account_name,
		          created_at::text, completed_at::text
	`, userID, reference, amountKobo, bankName, accountNumber, accountName, idemKey)

	var payout PayoutRequest
	err := row.Scan(&payout.ID, &payout.Reference, &payout.UserID, &payout.AmountKobo,
		&payout.Status, &payout.BankName, &payout.AccountNumber, &payout.AccountName,
		&payout.CreatedAt, &payout.CompletedAt)
	if err != nil {
		return nil, fmt.Errorf("request payout: %w", err)
	}

	return &payout, nil
}

// GetPayoutHistory retrieves user's payout history (paginated).
func (s *PayoutsStore) GetPayoutHistory(ctx context.Context, userID string, limit int, offset int) ([]PayoutRequest, int64, error) {
	var total int64
	err := s.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM payouts WHERE user_id = $1
	`, userID).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("count payouts: %w", err)
	}
	rows, err := s.db.Query(ctx, `
		SELECT
			id, reference, user_id, amount_kobo, status,
			COALESCE(bank_name, '') as bank_name,
			COALESCE(account_number, '') as account_number,
			COALESCE(account_name, '') as account_name,
			created_at::text, completed_at::text
		FROM payouts
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`, userID, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("query payouts: %w", err)
	}
	defer rows.Close()

	var payouts []PayoutRequest
	for rows.Next() {
		var p PayoutRequest
		if err := rows.Scan(&p.ID, &p.Reference, &p.UserID, &p.AmountKobo,
			&p.Status, &p.BankName, &p.AccountNumber, &p.AccountName,
			&p.CreatedAt, &p.CompletedAt); err != nil {
			return nil, 0, fmt.Errorf("scan payout: %w", err)
		}
		payouts = append(payouts, p)
	}

	return payouts, total, rows.Err()
}
