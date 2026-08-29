package transfers

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler exposes wallet-to-wallet (P2P) and wallet-to-bank transfer endpoints.
// Flag gating is applied per-feature: WalletEnabled gates the P2P routes,
// BankEnabled gates the payout routes. When a flag is off the handler returns
// 503 (service unavailable) — the go-live gate FEATURE_*_ENABLED=false → 503.
type Handler struct {
	svc           *Service
	walletEnabled bool
	bankEnabled   bool
}

// NewHandler builds a transfers HTTP handler. Pass the resolved feature-flag
// values so each route family can fail closed with 503 when disabled.
func NewHandler(svc *Service, walletTransfersEnabled, bankTransfersEnabled bool) *Handler {
	return &Handler{svc: svc, walletEnabled: walletTransfersEnabled, bankEnabled: bankTransfersEnabled}
}

func writeError(c *gin.Context, err error) {
	body := gin.H{
		"error": err.Error(),
		"code":  ErrorCode(err),
	}
	// A wrong PIN says how many tries are left, so the customer is warned before
	// the lockout rather than after it.
	var attempt *PinAttemptError
	if errors.As(err, &attempt) {
		body["attempts_remaining"] = attempt.Remaining
	}
	c.JSON(HTTPStatusForError(err), body)
}

func unavailable(c *gin.Context, feature string) {
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"error": feature + " is not enabled",
		"code":  "feature_disabled",
	})
}

// ResolvePaymax handles GET /finance/transfers/paymax/resolve?phone=...
// Returns the recipient's masked phone + display name (never the full number).
func (h *Handler) ResolvePaymax(c *gin.Context) {
	if !h.walletEnabled {
		unavailable(c, "wallet transfers")
		return
	}
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	phone := c.Query("phone")
	resp, err := h.svc.ResolvePaymaxUser(c.Request.Context(), phone)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

// InitiatePaymax handles POST /finance/transfers/paymax (wallet-to-wallet).
func (h *Handler) InitiatePaymax(c *gin.Context) {
	if !h.walletEnabled {
		unavailable(c, "wallet transfers")
		return
	}
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var req WalletTransferRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error(), "code": "invalid_request"})
		return
	}
	// Header Idempotency-Key wins over a body field if present.
	if k := c.GetHeader("Idempotency-Key"); k != "" {
		req.IdempotencyKey = k
	}
	wt, err := h.svc.InitiateWalletToWallet(c.Request.Context(), userID, req)
	if err != nil {
		writeError(c, err)
		return
	}
	status := http.StatusCreated
	if wt.AlreadyProcessed {
		status = http.StatusOK // replay — already processed
	}
	c.JSON(status, wt)
}

// InitiateBank handles POST /finance/transfers/bank (wallet-to-bank payout).
func (h *Handler) InitiateBank(c *gin.Context) {
	if !h.bankEnabled {
		unavailable(c, "bank transfers")
		return
	}
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var req BankTransferRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error(), "code": "invalid_request"})
		return
	}
	if k := c.GetHeader("Idempotency-Key"); k != "" {
		req.IdempotencyKey = k
	}
	bt, err := h.svc.InitiateBankTransfer(c.Request.Context(), userID, req)
	if err != nil {
		writeError(c, err)
		return
	}
	status := http.StatusCreated
	if bt.AlreadyProcessed {
		status = http.StatusOK
	}
	c.JSON(status, bt)
}

// InitiateBankToBank handles POST /finance/transfers/bank-to-bank.
func (h *Handler) InitiateBankToBank(c *gin.Context) {
	if !h.bankEnabled {
		unavailable(c, "bank transfers")
		return
	}
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var req BankToBankRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error(), "code": "invalid_request"})
		return
	}
	if k := c.GetHeader("Idempotency-Key"); k != "" {
		req.IdempotencyKey = k
	}
	bt, err := h.svc.InitiateBankToBank(c.Request.Context(), userID, req)
	if err != nil {
		writeError(c, err)
		return
	}
	status := http.StatusCreated
	if bt.AlreadyProcessed {
		status = http.StatusOK
	}
	c.JSON(status, bt)
}

// ListBanks handles GET /finance/transfers/banks.
func (h *Handler) ListBanks(c *gin.Context) {
	if !h.bankEnabled {
		unavailable(c, "bank transfers")
		return
	}
	banks, err := h.svc.ListBanks(c.Request.Context(), c.Query("provider"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"banks": banks})
}

// ResolveAccount handles POST /finance/transfers/resolve-account.
func (h *Handler) ResolveAccount(c *gin.Context) {
	if !h.bankEnabled {
		unavailable(c, "bank transfers")
		return
	}
	if c.GetString("user_id") == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var req ResolveAccountRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error(), "code": "invalid_request"})
		return
	}
	res, err := h.svc.ResolveAccount(c.Request.Context(), req)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ListBeneficiaries handles GET /finance/transfers/beneficiaries.
func (h *Handler) ListBeneficiaries(c *gin.Context) {
	if !h.bankEnabled {
		unavailable(c, "bank transfers")
		return
	}
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	bens, err := h.svc.ListBeneficiaries(c.Request.Context(), userID)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"beneficiaries": bens})
}

// SaveBeneficiary handles POST /finance/transfers/beneficiaries.
func (h *Handler) SaveBeneficiary(c *gin.Context) {
	if !h.bankEnabled {
		unavailable(c, "bank transfers")
		return
	}
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var req SaveBeneficiaryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error(), "code": "invalid_request"})
		return
	}
	b, err := h.svc.SaveBeneficiary(c.Request.Context(), userID, req)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusCreated, b)
}

// DeleteBeneficiary handles DELETE /finance/transfers/beneficiaries/:id.
func (h *Handler) DeleteBeneficiary(c *gin.Context) {
	if !h.bankEnabled {
		unavailable(c, "bank transfers")
		return
	}
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	if err := h.svc.DeleteBeneficiary(c.Request.Context(), userID, c.Param("id")); err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

// PinStatus handles GET /finance/transfers/pin/status.
func (h *Handler) PinStatus(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	has, err := h.svc.HasPin(c.Request.Context(), userID)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"pin_set": has})
}

// SetPin handles POST /finance/transfers/pin.
func (h *Handler) SetPin(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var req SetPinRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error(), "code": "invalid_request"})
		return
	}
	if err := h.svc.SetPin(c.Request.Context(), userID, req.PIN, req.CurrentPIN); err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"pin_set": true})
}

// VerifyPin handles POST /finance/transfers/pin/verify.
func (h *Handler) VerifyPin(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var req VerifyPinRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error(), "code": "invalid_request"})
		return
	}
	if err := h.svc.VerifyPin(c.Request.Context(), userID, req.PIN); err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"verified": true})
}
