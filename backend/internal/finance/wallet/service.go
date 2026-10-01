package wallet

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
)

// Service exposes wallet operations to handlers.
// It delegates all money mutations to the ledger service.
type Service struct {
	ledger *ledger.Service
	tiers  *tiers.Service
}

func NewService(ledger *ledger.Service, tiers *tiers.Service) *Service {
	return &Service{ledger: ledger, tiers: tiers}
}

// GetBalance returns the current wallet balance.
func (s *Service) GetBalance(ctx context.Context, userID string) (*BalanceResponse, error) {
	balKobo, err := s.ledger.GetBalance(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("wallet: get balance: %w", err)
	}
	return &BalanceResponse{
		UserID:       userID,
		BalanceKobo:  balKobo,
		BalanceNaira: float64(balKobo) / 100,
	}, nil
}

// Credit credits the user's wallet. Called by webhook handlers when a Paystack
// charge succeeds. The standing account for the source is providerClearing.
func (s *Service) Credit(ctx context.Context, userID, reference, idempotencyKey string, amountKobo int64) error {
	acc, err := s.ledger.GetOrCreateUserWallet(ctx, userID)
	if err != nil {
		return err
	}
	// Standing provider clearing account (no user_id) — get its ID.
	clearingAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		return err
	}
	_ = acc
	return s.ledger.Credit(ctx, userID, reference, idempotencyKey, clearingAcc.ID, amountKobo)
}

// Debit debits the user's wallet. Enforces tier limits before posting.
func (s *Service) Debit(ctx context.Context, userID, reference, idempotencyKey, creditAccountID string, amountKobo int64) error {
	if err := s.tiers.EnforceWalletDebitLimit(ctx, userID, amountKobo); err != nil {
		return err
	}
	return s.ledger.Debit(ctx, userID, reference, idempotencyKey, creditAccountID, amountKobo)
}

// VoteDebit debits the user's wallet and credits the platform commission account.
// Used by the vote bridge to charge for paid votes without an external payment provider.
func (s *Service) VoteDebit(ctx context.Context, userID, reference, idempotencyKey string, amountKobo int64) error {
	commissionAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountCommission)
	if err != nil {
		return fmt.Errorf("wallet: resolve commission account: %w", err)
	}
	return s.Debit(ctx, userID, reference, idempotencyKey, commissionAcc.ID, amountKobo)
}

// ListTransactions returns paginated ledger entries as user-facing transactions.
func (s *Service) ListTransactions(ctx context.Context, userID string, limit, offset int) (*TransactionsResponse, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	entries, err := s.ledger.ListTransactions(ctx, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	return buildTransactionsResponse(entries, limit, offset), nil
}

// AdminGetBalance returns a user's balance for back-office reporting, summed
// across every pot they hold. The member-facing GetBalance reads only the Go
// module's 'user_wallet' pot, which omits Paystack top-ups and transfers posted
// by the Next.js wallet into 'wallet' — admins must see the whole picture.
func (s *Service) AdminGetBalance(ctx context.Context, userID string) (*BalanceResponse, error) {
	balKobo, err := s.ledger.GetBalanceAcrossPots(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("wallet: admin get balance: %w", err)
	}
	return &BalanceResponse{
		UserID:       userID,
		BalanceKobo:  balKobo,
		BalanceNaira: float64(balKobo) / 100,
	}, nil
}

// AdminListTransactions returns a user's ledger entries across every pot they
// hold, so back-office reporting shows Paystack top-ups alongside Go-module
// activity. Reporting counterpart to ListTransactions.
func (s *Service) AdminListTransactions(ctx context.Context, userID string, limit, offset int) (*TransactionsResponse, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	entries, err := s.ledger.ListTransactionsAcrossPots(ctx, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	return buildTransactionsResponse(entries, limit, offset), nil
}

func buildTransactionsResponse(entries []ledger.Entry, limit, offset int) *TransactionsResponse {
	txns := make([]Transaction, len(entries))
	for i, e := range entries {
		txType := "debit"
		if e.Type == ledger.EntryCredit || e.Type == ledger.EntryReversalDebit {
			txType = "credit"
		}
		txns[i] = Transaction{
			ID:         e.ID,
			Type:       txType,
			AmountKobo: e.AmountKobo,
			Reference:  e.Reference,
			CreatedAt:  e.CreatedAt,
		}
	}
	return &TransactionsResponse{
		Transactions: txns,
		Limit:        limit,
		Offset:       offset,
	}
}

// BalanceResponse is the API response for GET /finance/wallet/balance.
type BalanceResponse struct {
	UserID      string `json:"user_id"`
	BalanceKobo int64  `json:"balance_kobo"`
	// Convenience field for display; clients should format from balance_kobo.
	BalanceNaira float64 `json:"balance_naira"`
}

// TopupIntent represents an initiated Paystack payment before webhook confirmation.
type TopupIntent struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	AmountKobo     int64     `json:"amount_kobo"`
	Reference      string    `json:"reference"`
	PaystackRef    string    `json:"paystack_ref"`
	Status         string    `json:"status"` // pending | success | failed
	IdempotencyKey string    `json:"idempotency_key"`
	CreatedAt      time.Time `json:"created_at"`
}

// TopupRequest is the request body for POST /finance/wallet/topup.
type TopupRequest struct {
	AmountKobo     int64  `json:"amount_kobo" binding:"required,min=100"`
	IdempotencyKey string `json:"idempotency_key" binding:"required"`
}

// TopupResponse is returned from POST /finance/wallet/topup.
type TopupResponse struct {
	Reference       string `json:"reference"`
	PaystackAuthURL string `json:"paystack_auth_url"`
	AmountKobo      int64  `json:"amount_kobo"`
}

// Transaction is a user-facing view of one ledger entry.
type Transaction struct {
	ID         string    `json:"id"`
	Type       string    `json:"type"` // credit | debit
	AmountKobo int64     `json:"amount_kobo"`
	Reference  string    `json:"reference"`
	CreatedAt  time.Time `json:"created_at"`
}

// TransactionsResponse wraps a page of transactions.
type TransactionsResponse struct {
	Transactions []Transaction `json:"transactions"`
	Total        int           `json:"total"`
	Limit        int           `json:"limit"`
	Offset       int           `json:"offset"`
}

// Handler exposes wallet endpoints.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// GetBalance handles GET /finance/wallet/balance
func (h *Handler) GetBalance(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	resp, err := h.svc.GetBalance(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, resp)
}

// ListTransactions handles GET /finance/wallet/transactions
func (h *Handler) ListTransactions(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))

	resp, err := h.svc.ListTransactions(c.Request.Context(), userID, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, resp)
}

// AdminGetBalance handles GET /finance/admin/wallets/:user_id/balance (admin only)
func (h *Handler) AdminGetBalance(c *gin.Context) {
	targetUserID := c.Param("user_id")
	resp, err := h.svc.AdminGetBalance(c.Request.Context(), targetUserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, resp)
}

// AdminListTransactions handles GET /finance/admin/wallets/:user_id/transactions (admin only)
func (h *Handler) AdminListTransactions(c *gin.Context) {
	targetUserID := c.Param("user_id")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))

	resp, err := h.svc.AdminListTransactions(c.Request.Context(), targetUserID, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, resp)
}
