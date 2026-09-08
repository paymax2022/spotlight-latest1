package wallet

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler binds the wallet Service to gin routes.
type Handler struct{ svc *Service }

// NewHandler constructs a wallet Handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func statusFor(err error) int {
	switch {
	case errors.Is(err, ErrCampaignNotFound):
		return http.StatusNotFound
	default:
		return http.StatusInternalServerError
	}
}

// GetWallet — GET /campaigns/:id/wallet. Returns the derived wallet object.
func (h *Handler) GetWallet(c *gin.Context) {
	w, err := h.svc.GetWallet(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	// Object returned directly so the client `res.data?.data ?? res.data` unwraps it.
	c.JSON(http.StatusOK, w)
}

// GetLedger — GET /campaigns/:id/ledger. Returns the projected ledger feed.
func (h *Handler) GetLedger(c *gin.Context) {
	entries, err := h.svc.GetLedger(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": entries})
}

// GetLedgerEntry — GET /ledger/:id. Returns a single projected ledger entry.
func (h *Handler) GetLedgerEntry(c *gin.Context) {
	entry, err := h.svc.GetLedgerEntry(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ledger entry not found"})
		return
	}
	c.JSON(http.StatusOK, entry)
}

// GetBankAccounts — GET /bank-accounts. Returns the caller's saved accounts.
func (h *Handler) GetBankAccounts(c *gin.Context) {
	userID := c.GetString("user_id")
	accounts, err := h.svc.GetBankAccounts(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": accounts})
}

// SubmitWithdrawal — POST /campaigns/:id/withdrawal-request.
// MONEY-PATH: requires an Idempotency-Key and pays out immediately (no
// separate admin-approval step — see Service.SubmitWithdrawal).
func (h *Handler) SubmitWithdrawal(c *gin.Context) {
	userID := c.GetString("user_id")
	campaignID := c.Param("id")

	idempotencyKey := c.GetHeader("Idempotency-Key")
	if idempotencyKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header is required"})
		return
	}

	var in WithdrawalRequestInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	res, err := h.svc.SubmitWithdrawal(c.Request.Context(), userID, campaignID, idempotencyKey, in)
	if err != nil {
		switch {
		case errors.Is(err, ErrCampaignNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		case errors.Is(err, ErrLedgerUnavailable):
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		}
		return
	}
	// Object returned directly to match the client unwrap.
	c.JSON(http.StatusCreated, res)
}
