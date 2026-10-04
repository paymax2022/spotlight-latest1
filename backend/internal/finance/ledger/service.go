package ledger

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/go-common/ptr"
	"spotlight/backend/go-common/timeutil"
	redisPkg "spotlight/backend/internal/platform/redis"
)

const keySuccess = "success"

const keyError = "error"

// Service is the high-level ledger API consumed by other finance modules.
type Service struct {
	repo      *Repository
	redis     *goredis.Client             // optional; nil means no idempotency cache
	resolvers []TransactionDetailResolver // optional; nil/empty means no per-module admin detail
}

func NewService(repo *Repository, redis *goredis.Client) *Service {
	return &Service{repo: repo, redis: redis}
}

// SetResolvers late-binds the optional per-module admin transaction-detail
// resolvers (see admin_transactions.go) for callers that construct ledgerSvc
// before the resolvers exist. Nil-safe.
func (s *Service) SetResolvers(rs []TransactionDetailResolver) { s.resolvers = rs }

// GetOrCreateUserWallet returns (or creates) the user_wallet ledger account.
func (s *Service) GetOrCreateUserWallet(ctx context.Context, userID string) (*Account, error) {
	return s.repo.GetOrCreateAccount(ctx, &userID, AccountUserWallet)
}

// GetOrCreateStandingAccount returns (or creates) a system-level standing account
// (no user_id). These are singletons keyed by type.
func (s *Service) GetOrCreateStandingAccount(ctx context.Context, accountType AccountType) (*Account, error) {
	return s.repo.GetOrCreateAccount(ctx, nil, accountType)
}

// GetBalance returns the current wallet balance for a user in kobo.
func (s *Service) GetBalance(ctx context.Context, userID string) (int64, error) {
	acc, err := s.GetOrCreateUserWallet(ctx, userID)
	if err != nil {
		return 0, err
	}
	return s.repo.GetBalance(ctx, acc.ID)
}

// GetAccountBalance returns the projected balance (kobo) for an already
// resolved account ID (e.g. a standing account). Read-only and unlocked — it
// MUST NOT gate a debit (use Debit/DebitWithBalanceCheck for that).
func (s *Service) GetAccountBalance(ctx context.Context, accountID string) (int64, error) {
	return s.repo.GetBalance(ctx, accountID)
}

// Posted reports whether the balanced pair for baseIdempotencyKey is durably
// written, checking the ":credit" side every posting writes. Reads the ledger
// of record (not Redis), so callers can decide crash recovery after a process
// death. Pass the SAME base key given to Credit/Debit/PostJournal.
func (s *Service) Posted(ctx context.Context, baseIdempotencyKey string) (bool, error) {
	return s.repo.EntryExists(ctx, baseIdempotencyKey+":credit")
}

// Credit posts a CREDIT journal entry to the user's wallet (money in).
// The counterpart debit is posted to the specified standing account.
// idempotencyKey must be globally unique per event.
func (s *Service) Credit(ctx context.Context, userID, reference, idempotencyKey, debitAccountID string, amountKobo int64) error {
	if amountKobo <= 0 {
		return fmt.Errorf("ledger: credit amount must be positive, got %d", amountKobo)
	}

	// Fast duplicate check via Redis (falls back to DB unique constraint).
	if s.redis != nil {
		ok, _, err := redisPkg.AcquireLock(ctx, s.redis, "idem:"+idempotencyKey, 0)
		if err == nil && !ok {
			return ErrDuplicate
		}
	}

	acc, err := s.GetOrCreateUserWallet(ctx, userID)
	if err != nil {
		return err
	}
	return s.repo.PostJournal(ctx, JournalEntry{
		Reference:       reference,
		IdempotencyKey:  idempotencyKey,
		AmountKobo:      amountKobo,
		DebitAccountID:  debitAccountID,
		CreditAccountID: acc.ID,
	})
}

// Debit posts a DEBIT journal entry from the user's wallet (money out).
// Fails with ErrInsufficientFunds if balance < amountKobo.
// TOCTOU-safe: check + insert run in ONE tx under the wallet's advisory lock
// (Repository.DebitWithBalanceCheck). The Redis fast-path is the cheap dedup;
// the unique idempotency_key is the durable fallback when Redis is down.
func (s *Service) Debit(ctx context.Context, userID, reference, idempotencyKey, creditAccountID string, amountKobo int64) error {
	if amountKobo <= 0 {
		return fmt.Errorf("ledger: debit amount must be positive, got %d", amountKobo)
	}

	if s.redis != nil {
		ok, _, err := redisPkg.AcquireLock(ctx, s.redis, "idem:"+idempotencyKey, 0)
		if err == nil && !ok {
			return ErrDuplicate
		}
	}

	acc, err := s.GetOrCreateUserWallet(ctx, userID)
	if err != nil {
		return err
	}

	// userID is the advisory lock key; acc.ID is the debited account.
	return s.repo.DebitWithBalanceCheck(ctx, userID, JournalEntry{
		Reference:       reference,
		IdempotencyKey:  idempotencyKey,
		AmountKobo:      amountKobo,
		DebitAccountID:  acc.ID,
		CreditAccountID: creditAccountID,
	}, amountKobo)
}

// EntryAmount returns the amount_kobo posted under this idempotency_key on the
// given account — the ledger of record for replay verification and reversal
// lookups, so callers never trust the request's own amount claim.
func (s *Service) EntryAmount(ctx context.Context, accountID, idempotencyKey string) (int64, bool, error) {
	return s.repo.EntryAmount(ctx, accountID, idempotencyKey)
}

// PostJournal posts a balanced entry between two existing account IDs.
// Use for non-wallet postings such as offline-payment approval
// (DR provider_clearing → CR settlement) where no user wallet is involved.
func (s *Service) PostJournal(ctx context.Context, j JournalEntry) error {
	if s.redis != nil {
		ok, _, err := redisPkg.AcquireLock(ctx, s.redis, "idem:"+j.IdempotencyKey, 0)
		if err == nil && !ok {
			return ErrDuplicate
		}
	}
	return s.repo.PostJournal(ctx, j)
}

// PostReversal posts a balanced REVERSAL_DEBIT / REVERSAL_CREDIT correction.
// restoreAccountID is credited back (REVERSAL_DEBIT, +balance); releaseAccountID
// has its hold drained (REVERSAL_CREDIT). Use for failed/reversed payouts where
// funds were parked in a suspense account and must return to the user wallet.
// Idempotency is enforced by the ledger unique constraint (and Redis fast-path),
// so a duplicate webhook is a safe no-op.
func (s *Service) PostReversal(ctx context.Context, restoreAccountID, releaseAccountID string, amountKobo int64, reference, idempotencyKey string) error {
	if amountKobo <= 0 {
		return fmt.Errorf("ledger: reversal amount must be positive, got %d", amountKobo)
	}
	if s.redis != nil {
		ok, _, err := redisPkg.AcquireLock(ctx, s.redis, "idem:"+idempotencyKey, 0)
		if err == nil && !ok {
			return ErrDuplicate
		}
	}
	return s.repo.PostReversalPair(ctx, restoreAccountID, releaseAccountID, amountKobo, reference, idempotencyKey)
}

// GetBalanceAcrossPots returns a user's balance summed over every pot they hold
// ('user_wallet' and the Next.js wallet's 'wallet'). Reporting-only — read-only
// and unlocked, so it must never gate a debit.
func (s *Service) GetBalanceAcrossPots(ctx context.Context, userID string) (int64, error) {
	return s.repo.GetBalanceAcrossUserPots(ctx, userID)
}

// ListTransactionsAcrossPots returns a user's ledger entries from every pot they
// hold, newest first. Reporting-only counterpart to ListTransactions.
func (s *Service) ListTransactionsAcrossPots(ctx context.Context, userID string, limit, offset int) ([]Entry, error) {
	return s.repo.ListEntriesAcrossUserPots(ctx, userID, limit, offset)
}

// ListTransactions returns paginated ledger entries for a user.
func (s *Service) ListTransactions(ctx context.Context, userID string, limit, offset int) ([]Entry, error) {
	acc, err := s.GetOrCreateUserWallet(ctx, userID)
	if err != nil {
		return nil, err
	}
	return s.repo.ListEntries(ctx, acc.ID, limit, offset)
}

// Sentinel errors.
var (
	ErrInsufficientFunds = errors.New("ledger: insufficient funds")
	ErrDuplicate         = errors.New("ledger: duplicate idempotency key")
)

// AdminHandler exposes the centralized, read-only admin transactions console.
// RBAC is applied at the route layer (middleware.RequirePermission
// "finance.admin.transactions.view"). This surface never writes to
// ledger_entries — it is reporting only.
type AdminHandler struct {
	svc *Service
}

// NewAdminHandler builds the ledger admin handler.
func NewAdminHandler(svc *Service) *AdminHandler { return &AdminHandler{svc: svc} }

// ListTransactions handles GET /api/finance/admin/transactions. Query params:
// type, account_type, user_id, search, from, to (date or RFC3339),
// min_amount_kobo, max_amount_kobo, limit, offset.
func (h *AdminHandler) ListTransactions(c *gin.Context) {
	limit, offset := ginutil.PageParams(c, 50, 200)
	minAmt, _ := strconv.ParseInt(c.Query("min_amount_kobo"), 10, 64)
	maxAmt, _ := strconv.ParseInt(c.Query("max_amount_kobo"), 10, 64)

	f := AdminTransactionFilter{
		Type:          c.Query("type"),
		AccountType:   c.Query("account_type"),
		UserID:        c.Query("user_id"),
		Search:        c.Query("search"),
		From:          ptr.DerefZero(timeutil.ParseTimePtr(c.Query("from"))),
		To:            ptr.DerefZero(timeutil.ParseTimePtr(c.Query("to"))),
		MinAmountKobo: minAmt,
		MaxAmountKobo: maxAmt,
		Limit:         limit,
		Offset:        offset,
	}

	page, err := h.svc.AdminListTransactions(c.Request.Context(), f)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keySuccess: false, keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		keySuccess:    true,
		"rows":        page.Rows,
		"total":       page.Total,
		"limit":       f.Limit,
		"offset":      f.Offset,
		"note_source": "source_inferred is a best-effort guess parsed from the reference string (SPLIT_PART on ':'); it is NOT an authoritative module field.",
	})
}

// GetTransaction handles GET /api/finance/admin/transactions/:id — the
// comprehensive single-transaction detail view: every column on the row
// (including idempotency_key, raw metadata, currency) plus every OTHER
// ledger_entries row sharing the same reference (the other leg(s) of the same
// balanced double-entry movement), so an operator sees the whole transaction.
func (h *AdminHandler) GetTransaction(c *gin.Context) {
	detail, err := h.svc.AdminGetTransaction(c.Request.Context(), c.Param("id"))
	if err != nil {
		if errors.Is(err, ErrTransactionNotFound) {
			c.JSON(http.StatusNotFound, gin.H{keySuccess: false, keyError: "transaction not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{keySuccess: false, keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		keySuccess:    true,
		"transaction": detail,
		"note_source": "source_inferred is a best-effort guess parsed from the reference string (SPLIT_PART on ':'); it is NOT an authoritative module field.",
	})
}

// EntryType mirrors the ENUM in the Supabase migration.
type EntryType string

const (
	EntryCredit         EntryType = "CREDIT"
	EntryDebit          EntryType = "DEBIT"
	EntryReversalCredit EntryType = "REVERSAL_CREDIT"
	EntryReversalDebit  EntryType = "REVERSAL_DEBIT"
)

// AccountType identifies the logical wallet / standing account.
type AccountType string

const (
	AccountUserWallet         AccountType = "user_wallet"
	AccountVirtualAccount     AccountType = "virtual_account"
	AccountEscrow             AccountType = "escrow"
	AccountRefund             AccountType = "refund"
	AccountProviderClearing   AccountType = "provider_clearing"
	AccountPaymaxRevenue      AccountType = "paymax_revenue"
	AccountCommission         AccountType = "commission"
	AccountReferralReward     AccountType = "referral_reward_expense"
	AccountFXSpreadIncome     AccountType = "fx_spread_income"
	AccountSettlement         AccountType = "settlement"
	AccountFailedTransferSusp AccountType = "failed_transfer_suspense"
	// AccountPlacementEscrow — Featured Placement standing accounts (paid landing-page promotion).
	// Escrow holds a merchant's pre-paid placement spend; on completion the
	// earned portion is recognized into revenue, with unused remainder reversed
	// back to the merchant wallet. Same standing-account pattern as escrow above
	// (auto-created on first GetOrCreateStandingAccount; no seed row required).
	AccountPlacementEscrow  AccountType = "placement_escrow"
	AccountPlacementRevenue AccountType = "placement_revenue"
	// AccountEdtechFeesVault — EdTech Fees segregated vault (SF-5). All FeesVault (savings-pot) funds route
	// through a standing account of this type so vault balances reconcile separately
	// from general float. Auto-created on first GetOrCreateStandingAccount; no seed
	// row required. Segregation is by dedicated AccountType (the ledger has no
	// free-form purpose column); the reference string carries the human-readable
	// purpose.
	AccountEdtechFeesVault AccountType = "edtech_fees_vault"
	// AccountTradingFundClearing — Custodial AI-trading fund standing accounts (Pillar 2 fund accounting).
	// FundClearing holds the pooled cash the fund carries against issued units
	// (segregated from general float); FeeIncome recognizes the platform's
	// performance fee. Auto-created on first GetOrCreateStandingAccount; no seed
	// row required (the type is admitted by the ledger_accounts CHECK widened in
	// migration 20261029000000).
	AccountTradingFundClearing AccountType = "trading_fund_clearing"
	AccountTradingFeeIncome    AccountType = "trading_fee_income"
)

// Account is a logical wallet / standing account in the ledger.
type Account struct {
	ID        string      `json:"id"`
	UserID    *string     `json:"user_id,omitempty"` // nil for standing accounts
	Type      AccountType `json:"type"`
	CreatedAt time.Time   `json:"created_at"`
}

// Entry is one side of a double-entry journal entry. Immutable once written.
type Entry struct {
	ID             string    `json:"id"`
	AccountID      string    `json:"account_id"`
	Type           EntryType `json:"type"`
	AmountKobo     int64     `json:"amount_kobo"` // always positive; direction from EntryType
	Reference      string    `json:"reference"`   // human-readable ref (e.g. "topup:xxx")
	IdempotencyKey string    `json:"idempotency_key"`
	CreatedAt      time.Time `json:"created_at"`
}

// JournalEntry is a balanced pair (debit account + credit account) representing
// one financial event. Both sides are written atomically.
type JournalEntry struct {
	Reference       string
	IdempotencyKey  string
	AmountKobo      int64
	DebitAccountID  string
	CreditAccountID string
	Description     string
}
