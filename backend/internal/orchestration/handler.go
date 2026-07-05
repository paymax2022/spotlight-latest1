package orchestration

import (
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler exposes the normalized FX API over Gin.
type Handler struct {
	svc *Service
	sec SecondaryStore // beneficiaries + rate alerts; nil → handlers fall back to stubs
}

// NewHandler builds the orchestration HTTP handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// WithSecondary attaches the persistence store for beneficiaries + rate alerts.
// Returns the handler for chaining. When nil, those handlers stay in stub mode.
func (h *Handler) WithSecondary(s SecondaryStore) *Handler { h.sec = s; return h }

func customerID(c *gin.Context) string { return c.GetString("user_id") }

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
	q, apiErr := h.svc.CreateQuote(c.Request.Context(), customerID(c), tier(c), req)
	if apiErr != nil {
		writeErr(c, apiErr)
		return
	}
	c.JSON(http.StatusOK, q)
}

// LockQuote handles POST /v1/quotes/:id/lock.
func (h *Handler) LockQuote(c *gin.Context) {
	q, apiErr := h.svc.LockQuote(c.Request.Context(), customerID(c), c.Param("id"))
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
	conv, apiErr := h.svc.ExecuteConversion(c.Request.Context(), customerID(c), c.GetHeader("Idempotency-Key"), req)
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
	tr, apiErr := h.svc.ExecuteTransfer(c.Request.Context(), customerID(c), c.GetHeader("Idempotency-Key"), req)
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
	va, apiErr := h.svc.CreateCollection(c.Request.Context(), customerID(c), req)
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

// GetBalances handles GET /v1/balances.
func (h *Handler) GetBalances(c *gin.Context) {
	b, err := h.svc.Balances(c.Request.Context(), customerID(c))
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": b})
}

// ListTransactions handles GET /v1/transactions.
func (h *Handler) ListTransactions(c *gin.Context) {
	tx, err := h.svc.Transactions(c.Request.Context(), customerID(c))
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": tx})
}

// GetTransaction handles GET /v1/transactions/:id.
func (h *Handler) GetTransaction(c *gin.Context) {
	tx, ok, err := h.svc.Transaction(c.Request.Context(), customerID(c), c.Param("id"))
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
