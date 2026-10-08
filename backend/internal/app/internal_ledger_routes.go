package app

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/middleware"
)

// RegisterInternalLedgerAPI wires the internal, SERVICE-authenticated ledger API
// (Stage 1.5c) onto the ROOT engine at the PINNED contract paths:
//
//	POST /internal/finance/ledger/journal   — post a balanced cash leg
//	GET  /internal/finance/ledger/balance   — read a projected balance
//
// This lets the SEPARATE trading service (mobile-app/reactnative/backend, its own
// Postgres) post the CASH legs of a trade through THIS money-core's authoritative
// double-entry ledger — the trading service never runs its own money ledger.
// Additive brownfield: this only EXPOSES the existing ledger.Service (it does not
// reimplement any posting/idempotency/balance logic — every mutation stays balanced,
// idempotent and audited by the ledger of record). Gated upstream by
// FeatureInternalLedgerAPIEnabled + a non-nil ledger service; each request is
// additionally guarded by middleware.RequireServiceToken (constant-time Bearer check
// against cfg.LedgerServiceToken; empty ⇒ every call 503 fail-closed). NEVER a user JWT.
func RegisterInternalLedgerAPI(r *gin.Engine, cfg config.Config, ledgerSvc *ledger.Service) {
	if !cfg.FeatureInternalLedgerAPIEnabled {
		return // flag off → routes never mounted (404) — no flag, no internal money surface
	}
	if ledgerSvc == nil {
		log.Println("[internal-ledger] nil ledger service — skipping internal ledger API")
		return
	}

	h := &internalLedgerHandler{ledger: ledgerSvc}

	grp := r.Group("/internal/finance/ledger")
	grp.Use(middleware.RequireServiceToken(cfg.LedgerServiceToken))
	grp.POST("/journal", h.PostJournal)
	grp.GET("/balance", h.GetBalance)

	log.Println("[internal-ledger] service-authenticated ledger API registered at /internal/finance/ledger (journal, balance)")
}

// internalLedgerHandler exposes the finance ledger to the trading service.
type internalLedgerHandler struct {
	ledger *ledger.Service
}

// journalRequest is the PINNED wire contract (camelCase) the trading module's
// httpLedger posts. Do not rename fields.
type journalRequest struct {
	UserID         string `json:"userId"`
	DebitAccount   string `json:"debitAccount"`
	CreditAccount  string `json:"creditAccount"`
	AmountKobo     int64  `json:"amountKobo"`
	Reference      string `json:"reference"`
	IdempotencyKey string `json:"idempotencyKey"`
	BalanceChecked bool   `json:"balanceChecked"`
}

// userScopedLedgerAccounts is the set of account NAMES the internal API resolves
// PER USER (via GetOrCreateUserWallet). Only the user wallet is resolvable per-user
// through the ledger.Service public API, and it is the only per-user leg the trading
// cash-leg contract needs. Every other known account name is a system-level STANDING
// account (singleton by type, resolved via GetOrCreateStandingAccount). Unknown
// names are rejected 400 (fail-closed) rather than silently creating a divergent
// account.
var userScopedLedgerAccounts = map[string]ledger.AccountType{
	"user_wallet": ledger.AccountUserWallet,
}

// standingLedgerAccounts maps the remaining account NAMES to their standing
// AccountType. Mirrors the AccountType constants declared in ledger/model.go.
var standingLedgerAccounts = map[string]ledger.AccountType{
	"virtual_account":          ledger.AccountVirtualAccount,
	"escrow":                   ledger.AccountEscrow,
	"refund":                   ledger.AccountRefund,
	"provider_clearing":        ledger.AccountProviderClearing,
	"paymax_revenue":           ledger.AccountPaymaxRevenue,
	"commission":               ledger.AccountCommission,
	"referral_reward_expense":  ledger.AccountReferralReward,
	"fx_spread_income":         ledger.AccountFXSpreadIncome,
	"settlement":               ledger.AccountSettlement,
	"failed_transfer_suspense": ledger.AccountFailedTransferSusp,
	"placement_escrow":         ledger.AccountPlacementEscrow,
	"placement_revenue":        ledger.AccountPlacementRevenue,
	"edtech_fees_vault":        ledger.AccountEdtechFeesVault,
}

var errUnknownAccount = errors.New("unknown ledger account")

// resolveAccount maps an account NAME (as sent on the wire) to the ledger's account
// identifier for userID. user_wallet resolves per-user; every other known name
// resolves to a system standing account.
func (h *internalLedgerHandler) resolveAccount(c *gin.Context, name, userID string) (string, error) {
	name = strings.TrimSpace(name)
	if _, ok := userScopedLedgerAccounts[name]; ok {
		acc, err := h.ledger.GetOrCreateUserWallet(c.Request.Context(), userID)
		if err != nil {
			return "", err
		}
		return acc.ID, nil
	}
	if at, ok := standingLedgerAccounts[name]; ok {
		acc, err := h.ledger.GetOrCreateStandingAccount(c.Request.Context(), at)
		if err != nil {
			return "", err
		}
		return acc.ID, nil
	}
	return "", errUnknownAccount
}

// PostJournal posts a balanced cash leg through the finance ledger.
//
//	balanceChecked=true  → the TOCTOU-safe wallet-debit path (ledger.Service.Debit,
//	                       advisory-locked check+insert). The debit MUST be the user
//	                       wallet — the only balance-checked primitive the ledger
//	                       exposes debits the caller's wallet.
//	balanceChecked=false → ledger.Service.PostJournal (balanced pair, no gate).
//
// Idempotency is the ledger's (UNIQUE idempotency_key). A replay is reported as
// {posted:true, replay:true}; insufficient funds as 409 {error:"insufficient_funds"}.
func (h *internalLedgerHandler) PostJournal(c *gin.Context) {
	var req journalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request_body"})
		return
	}
	req.UserID = strings.TrimSpace(req.UserID)
	req.IdempotencyKey = strings.TrimSpace(req.IdempotencyKey)
	req.Reference = strings.TrimSpace(req.Reference)

	if req.UserID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "userId required"})
		return
	}
	if req.IdempotencyKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "idempotencyKey required"})
		return
	}
	if req.AmountKobo <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "amountKobo must be a positive integer (minor units)"})
		return
	}
	if req.DebitAccount == "" || req.CreditAccount == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "debitAccount and creditAccount required"})
		return
	}
	if req.DebitAccount == req.CreditAccount {
		c.JSON(http.StatusBadRequest, gin.H{"error": "debitAccount and creditAccount must differ"})
		return
	}

	ctx := c.Request.Context()

	debitID, err := h.resolveAccount(c, req.DebitAccount, req.UserID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unknown debitAccount"})
		return
	}
	creditID, err := h.resolveAccount(c, req.CreditAccount, req.UserID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unknown creditAccount"})
		return
	}

	// Robust, redis-independent replay detection: if the balanced pair for this
	// base key already landed in the ledger of record AND carries this exact
	// journal's identity (account, entry type, reference, amount on BOTH legs),
	// report a replay WITHOUT re-posting. Key EXISTENCE alone is never proof —
	// a foreign claim holding the same key for a different journal must answer
	// 409, or internal consumers would fulfil on phantom money.
	replay, conflict, err := h.journalReplay(ctx, req.IdempotencyKey, debitID, creditID, req.Reference, req.AmountKobo)
	if err != nil {
		log.Printf("[internal-ledger] replay check error (idem=%s): %v", req.IdempotencyKey, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ledger_post_failed"})
		return
	}
	if replay {
		c.JSON(http.StatusOK, gin.H{"posted": true, "replay": true})
		return
	}
	if conflict {
		c.JSON(http.StatusConflict, gin.H{"error": "idempotency_key_conflict"})
		return
	}

	if req.BalanceChecked {
		// The only balance-checked primitive the ledger exposes (Service.Debit) debits
		// the caller's OWN wallet under an advisory lock. Enforce that the debit leg is
		// the user wallet so the sufficiency check guards the right account fail-closed.
		if _, ok := userScopedLedgerAccounts[strings.TrimSpace(req.DebitAccount)]; !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "balanceChecked requires debitAccount=user_wallet"})
			return
		}
		// Debit resolves + locks the user wallet itself and credits creditID.
		err = h.ledger.Debit(ctx, req.UserID, req.Reference, req.IdempotencyKey, creditID, req.AmountKobo)
	} else {
		err = h.ledger.PostJournal(ctx, ledger.JournalEntry{
			Reference:       req.Reference,
			IdempotencyKey:  req.IdempotencyKey,
			AmountKobo:      req.AmountKobo,
			DebitAccountID:  debitID,
			CreditAccountID: creditID,
		})
	}

	switch {
	case err == nil:
		c.JSON(http.StatusOK, gin.H{"posted": true})
	case errors.Is(err, ledger.ErrDuplicate):
		// ErrDuplicate is a REJECTION, not proof of a replay: the ledger refuses
		// a key already held by a DIFFERENT journal (verifyReplay), and a bare
		// unique-violation/Redis-lock duplicate carries no identity at all.
		// Re-read both legs — only an identity match is a true replay; anything
		// else is a foreign claim on the key and must not fulfil.
		replay, conflict, rerr := h.journalReplay(ctx, req.IdempotencyKey, debitID, creditID, req.Reference, req.AmountKobo)
		if rerr != nil {
			log.Printf("[internal-ledger] replay re-check error (idem=%s): %v", req.IdempotencyKey, rerr)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "ledger_post_failed"})
			return
		}
		if replay {
			c.JSON(http.StatusOK, gin.H{"posted": true, "replay": true})
			return
		}
		log.Printf("[internal-ledger] idempotency key %s held by a foreign journal (conflict=%v)", req.IdempotencyKey, conflict)
		c.JSON(http.StatusConflict, gin.H{"error": "idempotency_key_conflict"})
	case errors.Is(err, ledger.ErrInsufficientFunds):
		c.JSON(http.StatusConflict, gin.H{"error": "insufficient_funds"})
	default:
		log.Printf("[internal-ledger] post journal error (idem=%s): %v", req.IdempotencyKey, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ledger_post_failed"})
	}
}

// journalReplay reads the :debit/:credit legs recorded under baseKey from the
// ledger of record and reports the replay state:
//   - replay=true:   both legs exist AND carry this journal's identity (same
//     account, entry type, reference and amount on each leg) — a true
//     duplicate, safe to report as already-posted.
//   - conflict=true: any leg exists for a DIFFERENT journal, or only one leg
//     exists (a partial/foreign claim that can never verify) — fail closed.
//   - neither:       the key is unclaimed; the caller may post.
func (h *internalLedgerHandler) journalReplay(ctx context.Context, baseKey, debitAccountID, creditAccountID, reference string, amountKobo int64) (replay, conflict bool, err error) {
	matchLeg := func(suffix, accountID string, wantType ledger.EntryType) (found, match bool, err error) {
		e, found, err := h.ledger.EntryByKey(ctx, baseKey+suffix)
		if err != nil || !found {
			return found, false, err
		}
		return true, e.AccountID == accountID && e.Type == wantType &&
			e.Reference == reference && e.AmountKobo == amountKobo, nil
	}
	dFound, dMatch, err := matchLeg(":debit", debitAccountID, ledger.EntryDebit)
	if err != nil {
		return false, false, err
	}
	cFound, cMatch, err := matchLeg(":credit", creditAccountID, ledger.EntryCredit)
	if err != nil {
		return false, false, err
	}
	switch {
	case dFound && cFound && dMatch && cMatch:
		return true, false, nil
	case !dFound && !cFound:
		return false, false, nil
	default:
		return false, true, nil
	}
}

// GetBalance returns the projected balance (kobo) of the account named by ?account
// (default user_wallet) for ?userId. Read-only projection of the ledger.
func (h *internalLedgerHandler) GetBalance(c *gin.Context) {
	userID := strings.TrimSpace(c.Query("userId"))
	if userID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "userId required"})
		return
	}
	account := strings.TrimSpace(c.Query("account"))
	if account == "" {
		account = "user_wallet"
	}

	accountID, err := h.resolveAccount(c, account, userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unknown account"})
		return
	}
	bal, err := h.ledger.GetAccountBalance(c.Request.Context(), accountID)
	if err != nil {
		log.Printf("[internal-ledger] get balance error (user=%s account=%s): %v", userID, account, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ledger_balance_failed"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"balanceKobo": bal})
}
