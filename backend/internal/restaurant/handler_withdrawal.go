package restaurant

// Merchant bank-account CAPTURE + WITHDRAWAL money-path HTTP handlers, re-applied
// onto main's restaurant module (see restaurant/bankaccount.go + withdrawal.go).
// Kept in a dedicated file so it does not collide with main's handler_delivery.go.
// NOTE: the read-only GET /restaurant/earnings handler is intentionally omitted here
// (it needs GetMerchantEarnings, a separate merchant-earnings slice not yet on main).

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
)

// ownerErrStatusWithdraw maps a withdrawal/bank-account service error to HTTP status
// (renamed to avoid collision with handler_delivery.go's ownerErrStatus).
func ownerErrStatusWithdraw(err error) int {
	if strings.Contains(err.Error(), "not found") {
		return http.StatusNotFound
	}
	return http.StatusForbidden
}

func (h *Handler) AddBankAccount(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req AddBankAccountRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	b, err := h.svc.AddBankAccount(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusCreated, b)
}

func (h *Handler) ListBankAccounts(c *gin.Context) {
	userID := ginutil.UserID(c)
	list, err := h.svc.ListBankAccounts(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": list})
}

func (h *Handler) SetDefaultBankAccount(c *gin.Context) {
	userID := ginutil.UserID(c)
	if err := h.svc.SetDefaultBankAccount(c.Request.Context(), userID, c.Param("accountId")); err != nil {
		c.JSON(ownerErrStatusWithdraw(err), gin.H{keyError: httperr.Msg(c, ownerErrStatusWithdraw(err), err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"updated": true})
}

func (h *Handler) DeleteBankAccount(c *gin.Context) {
	userID := ginutil.UserID(c)
	if err := h.svc.DeleteBankAccount(c.Request.Context(), userID, c.Param("accountId")); err != nil {
		c.JSON(ownerErrStatusWithdraw(err), gin.H{keyError: httperr.Msg(c, ownerErrStatusWithdraw(err), err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

// VerifyBankAccount performs real-time account verification via the disbursement provider
// (Paystack, etc.). Returns the verified account details.
func (h *Handler) VerifyBankAccount(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req AddBankAccountRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	result, err := h.svc.VerifyBankAccount(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, result)
}

func withdrawalErrStatus(err error) int {
	switch {
	case errors.Is(err, ErrWithdrawMissingIdem), errors.Is(err, ErrWithdrawBadAmount):
		return http.StatusBadRequest
	case errors.Is(err, ErrWithdrawNoBankAccount), errors.Is(err, ErrWithdrawNotFound):
		return http.StatusNotFound
	case errors.Is(err, ErrWithdrawalsDisabled),
		errors.Is(err, tiers.ErrWalletDisabled), errors.Is(err, tiers.ErrDailyLimitExceeded):
		return http.StatusForbidden
	case errors.Is(err, ledger.ErrInsufficientFunds):
		return http.StatusPaymentRequired // 402 — not enough wallet balance
	case errors.Is(err, ErrWithdrawNotReady):
		return http.StatusConflict
	case errors.Is(err, ErrTierGateUnwired):
		return http.StatusServiceUnavailable // misconfigured deployment, not a bad request
	default:
		return http.StatusInternalServerError
	}
}

func (h *Handler) RequestWithdrawal(c *gin.Context) {
	userID := ginutil.UserID(c)
	idem := ginutil.IdempotencyKey(c)
	if idem == "" {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "Idempotency-Key is required"})
		return
	}
	var body struct {
		AmountKobo    int64  `json:"amount_kobo"`
		BankAccountID string `json:"bank_account_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	w, err := h.svc.RequestWithdrawal(c.Request.Context(), userID, RequestWithdrawalInput{
		AmountKobo:     body.AmountKobo,
		BankAccountID:  body.BankAccountID,
		IdempotencyKey: idem,
	})
	if err != nil {
		c.JSON(withdrawalErrStatus(err), gin.H{keyError: httperr.Msg(c, withdrawalErrStatus(err), err)})
		return
	}
	// An idempotent replay returns 200 (already processed); a fresh reserve is 201.
	status := http.StatusCreated
	if w.AlreadyProcessed {
		status = http.StatusOK
	}
	c.JSON(status, gin.H{"data": w})
}

func (h *Handler) ListWithdrawals(c *gin.Context) {
	userID := ginutil.UserID(c)
	list, err := h.svc.ListWithdrawals(c.Request.Context(), userID, 50)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": list})
}

func (h *Handler) GetWithdrawal(c *gin.Context) {
	userID := ginutil.UserID(c)
	w, err := h.svc.GetWithdrawal(c.Request.Context(), userID, c.Param("withdrawalId"))
	if err != nil {
		c.JSON(withdrawalErrStatus(err), gin.H{keyError: httperr.Msg(c, withdrawalErrStatus(err), err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": w})
}

// AdminListWithdrawals lists withdrawal requests across all merchants/riders,
// optionally filtered by ?status=. Backs the ops console withdrawals queue.
func (h *Handler) AdminListWithdrawals(c *gin.Context) {
	status := c.Query("status")
	list, err := h.svc.AdminListWithdrawals(c.Request.Context(), status, 100)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": list})
}

// AdminGetWithdrawal returns one withdrawal by id, unscoped by owner.
func (h *Handler) AdminGetWithdrawal(c *gin.Context) {
	w, err := h.svc.AdminGetWithdrawal(c.Request.Context(), c.Param("withdrawalId"))
	if err != nil {
		c.JSON(withdrawalErrStatus(err), gin.H{keyError: httperr.Msg(c, withdrawalErrStatus(err), err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": w})
}

func (h *Handler) AdminSettleWithdrawal(c *gin.Context) {
	var body struct {
		ProviderReference string `json:"provider_reference"`
	}
	_ = c.ShouldBindJSON(&body)
	w, err := h.svc.MarkWithdrawalPaid(c.Request.Context(), c.Param("withdrawalId"), body.ProviderReference, ginutil.IdempotencyKey(c))
	if err != nil {
		c.JSON(withdrawalErrStatus(err), gin.H{keyError: httperr.Msg(c, withdrawalErrStatus(err), err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": w})
}

func (h *Handler) AdminReverseWithdrawal(c *gin.Context) {
	var body struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&body)
	w, err := h.svc.MarkWithdrawalFailed(c.Request.Context(), c.Param("withdrawalId"), body.Reason, ginutil.IdempotencyKey(c))
	if err != nil {
		c.JSON(withdrawalErrStatus(err), gin.H{keyError: httperr.Msg(c, withdrawalErrStatus(err), err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": w})
}
