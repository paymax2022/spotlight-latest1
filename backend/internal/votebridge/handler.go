package votebridge

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/finance/wallet"
)

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
	userID := c.GetString("user_id")
	var req DebitForVotesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Reference encodes the vote intent for the ledger audit trail.
	ref := "vote:" + req.ContestID + ":" + req.ContestantID
	if err := h.wallet.VoteDebit(c.Request.Context(), userID, ref, req.IdempotencyKey, req.CostKobo); err != nil {
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
