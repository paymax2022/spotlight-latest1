package orchestration

import (
	"errors"
	"github.com/gin-gonic/gin"
	"io"
	"net/http"
	"spotlight/backend/go-common/ginutil"
)

// Handler exposes the normalized FX API over Gin.
type Handler struct {
	svc   *Service
	sec   SecondaryStore    // beneficiaries + rate alerts; nil → handlers fall back to stubs
	biz   BusinessStore     // FX business-admin console; nil → handlers fall back to honest defaults
	cards CardStore         // FX virtual cards; nil → handlers fall back to stubs
	coll  CollectionStore   // FX collections / virtual accounts; nil → handlers fall back to stubs
	verif VerificationStore // FX customer KYC verification; nil → handlers fall back to stubs
}

// NewHandler builds the orchestration HTTP handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// WithSecondary attaches the persistence store for beneficiaries + rate alerts.
// Returns the handler for chaining. When nil, those handlers stay in stub mode.
func (h *Handler) WithSecondary(s SecondaryStore) *Handler { h.sec = s; return h }

// WithBusiness attaches the persistence store for the FX business-admin console
// (team, approvals, activity, api-keys, webhooks, settings, notifications).
// Returns the handler for chaining. When nil, those handlers fall back to honest
// contract-shaped defaults so the app still renders in a DB-less dev setup.
func (h *Handler) WithBusiness(s BusinessStore) *Handler { h.biz = s; return h }

// WithCards attaches the persistence store for FX virtual cards. Returns the
// handler for chaining. When nil, the card handlers stay in stub mode.
func (h *Handler) WithCards(s CardStore) *Handler { h.cards = s; return h }

// WithCollections attaches the persistence store for FX collections / virtual
// accounts. Returns the handler for chaining. When nil, those list handlers fall
// back to empty-slice stubs.
func (h *Handler) WithCollections(s CollectionStore) *Handler { h.coll = s; return h }

// WithVerification attaches the persistence store for FX customer KYC verification.
// Returns the handler for chaining. When nil, the verification handlers fall back to
// the contract-shaped stub (submissions are echoed but not persisted).
func (h *Handler) WithVerification(s VerificationStore) *Handler { h.verif = s; return h }

func tier(c *gin.Context) string {
	if t := c.GetString("customer_tier"); t != "" {
		return t
	}
	return "retail"
}

func writeErr(c *gin.Context, e *APIError) {
	if e.RequestID == "" {
		e.RequestID = c.GetString("request_id")
	}
	c.JSON(e.HTTPStatus(), gin.H{"error": e})
}

func bindErr(c *gin.Context, err error) {
	writeErr(c, NewError(ErrInvalidRequest, "invalid_request", err.Error()))
}

// CreateQuote handles POST /v1/quotes.
func (h *Handler) CreateQuote(c *gin.Context) {
	var req QuoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		bindErr(c, err)
		return
	}
	q, apiErr := h.svc.CreateQuote(c.Request.Context(), ginutil.UserID(c), tier(c), req)
	if apiErr != nil {
		writeErr(c, apiErr)
		return
	}
	c.JSON(http.StatusOK, q)
}

// LockQuote handles POST /v1/quotes/:id/lock.
func (h *Handler) LockQuote(c *gin.Context) {
	q, apiErr := h.svc.LockQuote(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if apiErr != nil {
		writeErr(c, apiErr)
		return
	}
	c.JSON(http.StatusOK, q)
}

// CreateConversion handles POST /v1/conversions.
func (h *Handler) CreateConversion(c *gin.Context) {
	var req ConversionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		bindErr(c, err)
		return
	}
	conv, apiErr := h.svc.ExecuteConversion(c.Request.Context(), ginutil.UserID(c), ginutil.IdempotencyKey(c), req)
	if apiErr != nil {
		writeErr(c, apiErr)
		return
	}
	c.JSON(http.StatusCreated, conv)
}

// CreateTransfer handles POST /v1/transfers.
func (h *Handler) CreateTransfer(c *gin.Context) {
	var req TransferRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		bindErr(c, err)
		return
	}
	tr, apiErr := h.svc.ExecuteTransfer(c.Request.Context(), ginutil.UserID(c), ginutil.IdempotencyKey(c), req)
	if apiErr != nil {
		writeErr(c, apiErr)
		return
	}
	c.JSON(http.StatusCreated, tr)
}

// CreateCollection handles POST /v1/collections/virtual-accounts.
func (h *Handler) CreateCollection(c *gin.Context) {
	var req CollectionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		bindErr(c, err)
		return
	}
	va, apiErr := h.svc.CreateCollection(c.Request.Context(), ginutil.UserID(c), req)
	if apiErr != nil {
		writeErr(c, apiErr)
		return
	}
	c.JSON(http.StatusCreated, va)
}

// InboundWebhook handles POST /v1/fx/webhooks/:provider (no auth; signed by the
// provider). Verifies the signature, then normalizes into the ledger (spec §8).
func (h *Handler) InboundWebhook(c *gin.Context) {
	prov := c.Param("provider")
	payload, _ := io.ReadAll(c.Request.Body)
	sig := c.GetHeader("Webhook-Signature")
	if sig == "" {
		sig = c.GetHeader("X-Maplerad-Signature")
	}
	if !h.svc.VerifyProviderWebhook(prov, payload, sig) {
		writeErr(c, NewError(ErrAuthentication, "invalid_signature", "Webhook signature verification failed."))
		return
	}
	// Normalize into the unified ledger (idempotent), then acknowledge.
	_ = h.svc.HandleProviderEvent(c.Request.Context(), prov, payload)
	c.JSON(http.StatusOK, gin.H{"received": true})
}

// GetRates handles GET /v1/rates.
func (h *Handler) GetRates(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"data": h.svc.Rates(c.Request.Context(), tier(c))})
}

// GetBalances handles GET /v1/balances. Emits the WalletBalance shape the
// mobile app codes against ({currency, available, ledger} — same as AddWallet);
// a bare Money array leaked the internal ledger shape and rendered blank
// wallet cards. available == ledger until holds are modelled.
func (h *Handler) GetBalances(c *gin.Context) {
	b, err := h.svc.Balances(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	out := make([]gin.H, 0, len(b))
	for _, m := range b {
		out = append(out, gin.H{"currency": m.Currency, "available": m.AmountMinor, "ledger": m.AmountMinor})
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ListTransactions handles GET /v1/transactions.
func (h *Handler) ListTransactions(c *gin.Context) {
	tx, err := h.svc.Transactions(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": tx})
}

// GetTransaction handles GET /v1/transactions/:id.
func (h *Handler) GetTransaction(c *gin.Context) {
	tx, ok, err := h.svc.Transaction(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	if !ok {
		writeErr(c, NewError(ErrInvalidRequest, "not_found", "Transaction not found.").WithParam("id"))
		return
	}
	c.JSON(http.StatusOK, tx)
}

// ErrorType is the normalized error taxonomy from the spec (§5.1, Appendix C).
type ErrorType string

const (
	ErrInvalidRequest      ErrorType = "invalid_request"
	ErrAuthentication      ErrorType = "authentication"
	ErrRateExpired         ErrorType = "rate_expired"
	ErrInsufficientFloat   ErrorType = "insufficient_float"
	ErrInsufficientBalance ErrorType = "insufficient_balance"
	ErrRoutingUnavailable  ErrorType = "routing_unavailable"
	ErrProviderError       ErrorType = "provider_error"
	ErrComplianceBlock     ErrorType = "compliance_block"
	ErrConflict            ErrorType = "conflict"
	ErrRateLimited         ErrorType = "rate_limited"
	ErrLimitExceeded       ErrorType = "limit_exceeded"
	ErrInternal            ErrorType = "internal"
)

// APIError is the normalized error envelope returned on all 4xx/5xx (§5.1).
type APIError struct {
	Type        ErrorType `json:"type"`
	Code        string    `json:"code"`
	Message     string    `json:"message"`
	Param       *string   `json:"param,omitempty"`
	ProviderRef *string   `json:"providerRef,omitempty"`
	RequestID   string    `json:"requestId,omitempty"`
}

func (e *APIError) Error() string { return e.Message }

// NewError builds an APIError.
func NewError(t ErrorType, code, message string) *APIError {
	return &APIError{Type: t, Code: code, Message: message}
}

// WithParam attaches the offending field name.
func (e *APIError) WithParam(p string) *APIError { e.Param = &p; return e }

// WithProviderRef attaches the upstream provider reference.
func (e *APIError) WithProviderRef(r string) *APIError { e.ProviderRef = &r; return e }

// HTTPStatus maps the normalized error type to an HTTP status code.
func (e *APIError) HTTPStatus() int {
	switch e.Type {
	case ErrInvalidRequest:
		return http.StatusBadRequest
	case ErrAuthentication:
		return http.StatusUnauthorized
	case ErrRateExpired, ErrConflict:
		return http.StatusConflict
	case ErrInsufficientFloat, ErrInsufficientBalance, ErrComplianceBlock, ErrRoutingUnavailable, ErrLimitExceeded:
		return http.StatusUnprocessableEntity
	case ErrRateLimited:
		return http.StatusTooManyRequests
	case ErrProviderError:
		return http.StatusBadGateway
	default:
		return http.StatusInternalServerError
	}
}

// asAPIError coerces any error into an APIError (internal by default).
func asAPIError(err error) *APIError {
	if err == nil {
		return nil
	}
	ae := &APIError{}
	if errors.As(err, &ae) {
		return ae
	}
	return NewError(ErrInternal, "internal_error", err.Error())
}
