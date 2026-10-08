package votebridge

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/wallet"
)

const keyError = "error"

const (
	errVerifyLedgerState   = "could not verify ledger state"
	errVerifyReversalState = "could not verify reversal state"
	errPurchaseRefunded    = "this purchase was refunded — submit a new idempotency key"
)

// DebitForVotesRequest is the body for POST /api/finance/vote-bridge/debit.
// The Next.js bridge calls this to debit the user's wallet before crediting votes.
type DebitForVotesRequest struct {
	ContestID      string `json:"contest_id" binding:"required"`
	ContestantID   string `json:"contestant_id" binding:"required"`
	VoteCount      int    `json:"vote_count" binding:"required,min=1"`
	CostKobo       int64  `json:"cost_kobo" binding:"required,min=1"`
	IdempotencyKey string `json:"idempotency_key" binding:"required"`
}

// DebitForVotesResponse is returned on success.
type DebitForVotesResponse struct {
	OK             bool   `json:"ok"`
	BalanceKobo    int64  `json:"balance_kobo"`
	IdempotencyKey string `json:"idempotency_key"`
}

// Handler exposes a single debit endpoint consumed by the Next.js vote bridge.
type Handler struct {
	wallet *wallet.Service
}

func NewHandler(walletSvc *wallet.Service) *Handler {
	return &Handler{wallet: walletSvc}
}

// finishHeldPurchase converges a request whose vote-purchase journal is
// already committed for THIS caller at this amount and reference: it verifies
// the durable reversal marker (a refunded purchase must not re-fulfil) and
// writes the response. Returns true when a response was written — the caller
// must return without touching the request again.
func (h *Handler) finishHeldPurchase(c *gin.Context, userID, idempotencyKey string, costKobo int64, ref string) bool {
	held, herr := h.wallet.VoteDebitHeldByUser(c.Request.Context(), userID, idempotencyKey, costKobo, ref)
	if herr != nil {
		// Fail closed: cannot prove the ledger state either way.
		c.JSON(http.StatusInternalServerError, gin.H{keyError: errVerifyLedgerState})
		return true
	}
	if !held {
		return false
	}
	reversed, rerr := h.wallet.VoteDebitReversed(c.Request.Context(), userID, idempotencyKey)
	if rerr != nil {
		// Fail closed: cannot prove the debit is still held.
		c.JSON(http.StatusInternalServerError, gin.H{keyError: errVerifyReversalState})
		return true
	}
	if reversed {
		c.JSON(http.StatusConflict, gin.H{keyError: errPurchaseRefunded})
		return true
	}
	c.JSON(http.StatusOK, DebitForVotesResponse{OK: true, IdempotencyKey: idempotencyKey})
	return true
}

// DebitForVotes debits the authenticated user's wallet by cost_kobo.
// The caller (Next.js bridge) is responsible for crediting votes afterwards
// via the legacy Spotlight vote service. This endpoint enforces:
//   - Tier-limit check (via wallet.Debit which calls tiers.EnforceWalletDebitLimit)
//   - Idempotency (wallet.Debit uses the supplied idempotency_key)
//   - Double-entry ledger entry
func (h *Handler) DebitForVotes(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req DebitForVotesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}

	// Reference encodes the vote intent for the ledger audit trail.
	ref := "vote:" + req.ContestID + ":" + req.ContestantID

	// Identity-verified replay check BEFORE the tier/balance gates inside
	// VoteDebit: the original committed debit already counted against both, so
	// re-running them wedges a true retry (limit consumed, funds moved on, or
	// the purchase refunded). The FULL journal identity is verified — the raw
	// key lives in the global namespace, so a weaker check could adopt
	// another member's debit or this member's journal from a different module.
	if h.finishHeldPurchase(c, userID, req.IdempotencyKey, req.CostKobo, ref) {
		return
	}

	if err := h.wallet.VoteDebit(c.Request.Context(), userID, ref, req.IdempotencyKey, req.CostKobo); err != nil {
		if errors.Is(err, ledger.ErrDuplicate) {
			// The journal landed between the fast-path probe and the debit
			// (a racing first attempt) or a foreign claim holds the key. The
			// same identity-verified check decides: only THIS caller's own
			// journal at the quoted amount may converge.
			if h.finishHeldPurchase(c, userID, req.IdempotencyKey, req.CostKobo, ref) {
				return
			}
		}
		c.JSON(http.StatusPaymentRequired, gin.H{keyError: httperr.Msg(c, http.StatusPaymentRequired, err)})
		return
	}

	// A nil return is either a fresh debit or a committed journal converging
	// as a replay — and a converged replay must still prove the money is HELD:
	// if this key's saga compensation already posted, the reversal legs mark
	// the purchase spent and fulfilling votes would credit against ₦0 held.
	// For a fresh debit this read is a cheap false.
	reversed, rerr := h.wallet.VoteDebitReversed(c.Request.Context(), userID, req.IdempotencyKey)
	if rerr != nil {
		// Fail closed: cannot prove the debit is still held.
		c.JSON(http.StatusInternalServerError, gin.H{keyError: errVerifyReversalState})
		return
	}
	if reversed {
		c.JSON(http.StatusConflict, gin.H{keyError: errPurchaseRefunded})
		return
	}

	bal, err := h.wallet.GetBalance(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusOK, DebitForVotesResponse{OK: true, IdempotencyKey: req.IdempotencyKey})
		return
	}
	c.JSON(http.StatusOK, DebitForVotesResponse{
		OK:             true,
		BalanceKobo:    bal.BalanceKobo,
		IdempotencyKey: req.IdempotencyKey,
	})
}

// ReverseForVotesRequest is the body for POST /api/finance/vote-bridge/reverse.
// Deliberately carries NO amount — the reversal uses the amount recorded in the
// ledger for the original debit, so a forged request cannot mint value.
type ReverseForVotesRequest struct {
	ContestID      string `json:"contest_id" binding:"required"`
	ContestantID   string `json:"contestant_id" binding:"required"`
	IdempotencyKey string `json:"idempotency_key" binding:"required"`
}

// ReverseForVotes refunds a vote-bridge debit whose vote credit never landed.
// The Next.js bridge calls this as the compensation step of the debit→credit
// saga. Only the caller's own debits are reversible: the handler requires the
// DEBIT leg on this user's wallet and the matching CREDIT leg on the
// commission account for the same idempotency key.
func (h *Handler) ReverseForVotes(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req ReverseForVotesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}

	ref := "vote-reversal:" + req.ContestID + ":" + req.ContestantID
	if err := h.wallet.VoteDebitReverse(c.Request.Context(), userID, ref, req.IdempotencyKey); err != nil {
		if errors.Is(err, wallet.ErrNoVoteDebit) {
			c.JSON(http.StatusNotFound, gin.H{keyError: "no vote debit found for this idempotency key"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
