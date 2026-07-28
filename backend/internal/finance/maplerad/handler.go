package maplerad

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/provider"
)

// Handler exposes the member-facing Maplerad money-path endpoints. Every op
// derives the caller's user id from the auth context (set by RequireAuthContext /
// requireUserID) — never from the request body — enforcing object-level authz.
type Handler struct {
	svc *Service
}

// NewHandler builds the Maplerad member handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// writeErr maps domain errors to HTTP status codes (model.go documents each).
func writeErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrTierTooLow):
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error(), "code": "tier_required"})
	case errors.Is(err, ErrForbidden):
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
	case errors.Is(err, ErrProviderUnavailable):
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
	case errors.Is(err, ErrMissingRef):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, ErrInvalidAmount):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, ledger.ErrInsufficientFunds):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error(), "code": "insufficient_funds"})
	case errors.Is(err, ErrInvalidAccount):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, ErrIllegalTransition):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

// CreateCustomer handles POST /api/finance/maplerad/customer
func (h *Handler) CreateCustomer(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	cust, err := h.svc.EnsureCustomer(c.Request.Context(), userID)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"customer_id": cust.CustomerID, "status": cust.Status})
}

// OpenVirtualAccount handles POST /api/finance/maplerad/virtual-account
func (h *Handler) OpenVirtualAccount(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	acct, err := h.svc.OpenVirtualAccount(c.Request.Context(), userID)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, acct)
}

// transferRequestBody is the JSON shape for POST /transfers.
type transferRequestBody struct {
	BankCode      string `json:"bank_code"`
	AccountNumber string `json:"account_number"`
	AmountKobo    int64  `json:"amount_kobo"`
	Narration     string `json:"narration"`
	Ref           string `json:"ref"`
}

// InitiateTransfer handles POST /api/finance/maplerad/transfers. The
// Idempotency-Key header is the client reference (ref); a body ref is a
// fallback. The ref is the ledger posting key + provider_reference id.
func (h *Handler) InitiateTransfer(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var body transferRequestBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	ref := body.Ref
	if k := c.GetHeader("Idempotency-Key"); k != "" {
		ref = k // header Idempotency-Key wins (it IS the ref).
	}
	rec, err := h.svc.InitiateTransfer(c.Request.Context(), userID, TransferRequest{
		BankCode:      body.BankCode,
		AccountNumber: body.AccountNumber,
		AmountKobo:    body.AmountKobo,
		Narration:     body.Narration,
		Ref:           ref,
	})
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusAccepted, rec) // 202: PENDING, terminal via webhook
}

// GetTransfer handles GET /api/finance/maplerad/transfers/:ref
func (h *Handler) GetTransfer(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	rec, err := h.svc.GetTransfer(c.Request.Context(), userID, c.Param("ref"))
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, rec)
}

// billRequestBody is the JSON shape for POST /bills.
type billRequestBody struct {
	Ref        string            `json:"ref"`
	Type       string            `json:"type"`
	AmountKobo int64             `json:"amount_kobo"`
	Params     map[string]string `json:"params"`
}

// PurchaseBill handles POST /api/finance/maplerad/bills
func (h *Handler) PurchaseBill(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var body billRequestBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	ref := body.Ref
	if k := c.GetHeader("Idempotency-Key"); k != "" {
		ref = k
	}
	res, err := h.svc.PurchaseBill(c.Request.Context(), userID, provider.BillRequest{
		Ref:        ref,
		Type:       body.Type,
		AmountKobo: body.AmountKobo,
		Params:     body.Params,
	})
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusAccepted, res)
}
