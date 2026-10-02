package votebridge

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/wallet"
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
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Reference encodes the vote intent for the ledger audit trail.
	ref := "vote:" + req.ContestID + ":" + req.ContestantID
	if err := h.wallet.VoteDebit(c.Request.Context(), userID, ref, req.IdempotencyKey, req.CostKobo); err != nil {
		if errors.Is(err, ledger.ErrDuplicate) {
			// A replayed key is idempotent ONLY when the recorded amount matches
			// what this request asks for. Verifying against the commission-side
			// entry defeats the cheap pre-claim attack: debit 1 kobo under key K
			// directly, then replay K through the BFF priced for N votes — the
			// recorded amount (1) won't match the BFF's quoted cost.
			orig, found, lerr := h.wallet.VoteDebitAmount(c.Request.Context(), req.IdempotencyKey)
			if lerr == nil && found && orig == req.CostKobo {
				c.JSON(http.StatusOK, DebitForVotesResponse{OK: true, IdempotencyKey: req.IdempotencyKey})
				return
			}
		}
		c.JSON(http.StatusPaymentRequired, gin.H{"error": err.Error()})
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
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ref := "vote-reversal:" + req.ContestID + ":" + req.ContestantID
	if err := h.wallet.VoteDebitReverse(c.Request.Context(), userID, ref, req.IdempotencyKey); err != nil {
		if errors.Is(err, wallet.ErrNoVoteDebit) {
			c.JSON(http.StatusNotFound, gin.H{"error": "no vote debit found for this idempotency key"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
