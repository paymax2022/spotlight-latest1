package wallet

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
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

// ErrNoVoteDebit is returned when no committed vote-bridge debit exists for the
// idempotency key — nothing to verify against or reverse.
var ErrNoVoteDebit = errors.New("wallet: no vote debit found for idempotency key")

// VoteDebitAmount returns the amount the vote-bridge debit under idempotencyKey
// actually posted to the commission account. The credit-side leg doubles as a
// provenance check: VoteDebit always pairs a user-wallet DEBIT with a
// commission CREDIT in one tx, so a K:credit row on commission means this key
// was a vote debit — and its amount is the ONLY amount a caller may act on.
func (s *Service) VoteDebitAmount(ctx context.Context, idempotencyKey string) (int64, bool, error) {
	commissionAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountCommission)
	if err != nil {
		return 0, false, fmt.Errorf("wallet: resolve commission account: %w", err)
	}
	return s.ledger.EntryAmount(ctx, commissionAcc.ID, idempotencyKey+":credit")
}

// VoteDebitHeldByUser reports whether this caller's own vote-bridge journal
// already committed under idempotencyKey at exactly amountKobo — BOTH legs
// verified: a DEBIT on THIS user's wallet (the raw key is in the GLOBAL
// namespace, so the commission-side amount check alone could adopt another
// member's debit) and a CREDIT on the commission account. A true replay
// converges on this; anything else is a foreign/tampered claim.
func (s *Service) VoteDebitHeldByUser(ctx context.Context, userID, idempotencyKey string, amountKobo int64) (bool, error) {
	walletAcc, err := s.ledger.GetOrCreateUserWallet(ctx, userID)
	if err != nil {
		return false, err
	}
	debit, found, err := s.ledger.EntryByKey(ctx, idempotencyKey+":debit")
	if err != nil {
		return false, err
	}
	if !found || debit.AccountID != walletAcc.ID || debit.Type != ledger.EntryDebit || debit.AmountKobo != amountKobo {
		return false, nil
	}
	credited, found, err := s.VoteDebitAmount(ctx, idempotencyKey)
	if err != nil {
		return false, err
	}
	return found && credited == amountKobo, nil
}

// VoteDebitReversed reports whether this user's vote-bridge debit under
// idempotencyKey was already refunded. The reversal's restore leg lands on the
// caller's own wallet under the derived key "vote-reversal:<K>:rev_debit", so
// its presence is the durable spent-marker: a debit replay that passes
// VoteDebitAmount but finds this marker must NOT fulfil — the money is already
// back with the user and any credit would be delivered against ₦0 held.
func (s *Service) VoteDebitReversed(ctx context.Context, userID, idempotencyKey string) (bool, error) {
	walletAcc, err := s.ledger.GetOrCreateUserWallet(ctx, userID)
	if err != nil {
		return false, err
	}
	_, found, err := s.ledger.EntryAmount(ctx, walletAcc.ID, "vote-reversal:"+idempotencyKey+":rev_debit")
	return found, err
}

// VoteDebitReverse refunds a vote-bridge debit: restores the user's wallet
// (REVERSAL_DEBIT) and drains the commission account (REVERSAL_CREDIT) by the
// RECORDED debit amount — the request carries no amount, so this endpoint
// cannot mint value. Provenance is double-checked on both legs: the debit must
// have hit THIS user's wallet and the matching credit the commission account,
// which stops a caller reversing somebody else's debit into their own wallet.
// Idempotent: a repeat reversal with the same key is a duplicate no-op.
func (s *Service) VoteDebitReverse(ctx context.Context, userID, reference, idempotencyKey string) error {
	walletAcc, err := s.ledger.GetOrCreateUserWallet(ctx, userID)
	if err != nil {
		return err
	}
	commissionAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountCommission)
	if err != nil {
		return fmt.Errorf("wallet: resolve commission account: %w", err)
	}
	debitAmount, found, err := s.ledger.EntryAmount(ctx, walletAcc.ID, idempotencyKey+":debit")
	if err != nil {
		return err
	}
	if !found {
		return ErrNoVoteDebit
	}
	creditAmount, found, err := s.ledger.EntryAmount(ctx, commissionAcc.ID, idempotencyKey+":credit")
	if err != nil {
		return err
	}
	if !found || creditAmount != debitAmount {
		return ErrNoVoteDebit
	}
	if err := s.ledger.PostReversal(ctx, walletAcc.ID, commissionAcc.ID, debitAmount, reference,
		"vote-reversal:"+idempotencyKey); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
		return err
	}
	return nil
}

// ListTransactions returns paginated ledger entries as user-facing transactions.
func (s *Service) ListTransactions(ctx context.Context, userID string, limit, offset int) (*TransactionsResponse, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	// A negative OFFSET is a Postgres error (500) — clamp like limit instead.
	if offset < 0 {
		offset = 0
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
	if offset < 0 {
		offset = 0
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
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
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
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, resp)
}

// AdminGetBalance handles GET /finance/admin/wallets/:user_id/balance (admin only)
func (h *Handler) AdminGetBalance(c *gin.Context) {
	targetUserID := c.Param("user_id")
	resp, err := h.svc.AdminGetBalance(c.Request.Context(), targetUserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
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
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, resp)
}
