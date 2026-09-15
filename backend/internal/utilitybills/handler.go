package utilitybills

// Thin Gin handlers: bind, delegate, map errors. No business logic lives here —
// in particular the Idempotency-Key requirement is enforced in the SERVICE, not
// in a middleware and not in a handler guard. That is this repo's convention (see
// insurance/policy/service.go's BindFromQuote) and it is the right place for it:
// the rule belongs next to the money, where it cannot be bypassed by a caller
// that reaches the service another way (an admin route, a job, a test).

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
)

// Handler exposes the member- and admin-facing Utility Bills endpoints. Every
// user-scoped op derives the caller's id from the auth context (set by
// RequireAuthContext / requireUserID) — never from the request body.
type Handler struct {
	svc *Service
}

// NewHandler builds the utility bills handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// idemKey reads the Idempotency-Key header. It does NOT reject a missing value —
// that is the service's job (see the file comment). Accepts the canonical header
// and the lowercase spelling some HTTP clients emit.
func idemKey(c *gin.Context) string {
	if v := c.GetHeader("Idempotency-Key"); v != "" {
		return v
	}
	return c.GetHeader("idempotency-key")
}

// writeErr maps domain errors onto HTTP status codes.
//
// Ordering matters: the most specific sentinels come first, and the catch-all
// 500 is last. A money-path error that falls through to 500 is a bug in this
// mapping, not a valid outcome — every sentinel this package defines is listed.
func writeErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrIdempotencyKeyRequired):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error(), "code": "idempotency_key_required"})
	case errors.Is(err, ErrInvalidCategory),
		errors.Is(err, ErrFieldRequired),
		errors.Is(err, ErrCategoryMismatch),
		errors.Is(err, ErrAmountRequired),
		errors.Is(err, ErrInvalidAmount),
		errors.Is(err, ErrAmountBelowMinimum),
		errors.Is(err, ErrAmountAboveMaximum),
		errors.Is(err, ErrCategoryAmountOutOfRange),
		// Phase 4 admin-surface validation. All 400s: every one of these is a
		// malformed admin request, not a server fault.
		errors.Is(err, ErrInvalidStatus),
		errors.Is(err, ErrInvalidAmountType),
		errors.Is(err, ErrInvalidHealthStatus),
		errors.Is(err, ErrCredentialsRequired),
		errors.Is(err, ErrCredentialsNotPatchable),
		errors.Is(err, ErrEmptyImport),
		errors.Is(err, ErrInvalidDisputeStatus),
		errors.Is(err, ErrInvalidReportType):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, ErrHealthCheckUnsupported):
		// 501: the request was valid and the provider exists — this deployment
		// simply has no adapter capable of answering it. Not the caller's fault
		// (400) and not a failure of something that should have worked (500).
		c.JSON(http.StatusNotImplemented, gin.H{"error": err.Error(), "code": "health_check_unsupported"})
	case errors.Is(err, ErrCredentialsKeyMissing):
		// A deployment misconfiguration: UTILITY_PROVIDER_CREDENTIALS_KEY is unset.
		// Fails CLOSED — the alternative would be storing a secret in the clear.
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error(), "code": "credentials_key_missing"})
	case errors.Is(err, ErrCustomerValidationFailed):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error(), "code": "customer_validation_failed"})
	case errors.Is(err, ErrNotEligibleForReversal):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, ErrCategoryDailyLimit):
		c.JSON(http.StatusTooManyRequests, gin.H{"error": err.Error(), "code": "category_daily_limit"})
	case errors.Is(err, tiers.ErrDailyLimitExceeded):
		// The WALLET tier limit, distinct from the category limit above.
		c.JSON(http.StatusTooManyRequests, gin.H{"error": err.Error(), "code": "wallet_daily_limit"})
	case errors.Is(err, tiers.ErrWalletDisabled):
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error(), "code": "wallet_disabled"})
	case errors.Is(err, ledger.ErrInsufficientFunds):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error(), "code": "insufficient_funds"})
	case errors.Is(err, ErrNoViableRoute),
		errors.Is(err, ErrCategoryUnavailable),
		errors.Is(err, ErrProviderUnavailable):
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
	case errors.Is(err, ErrBindInFlight):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "code": "purchase_in_flight"})
	case errors.Is(err, ErrBindOutcomeUnknown):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "code": "outcome_unknown"})
	case errors.Is(err, ErrProviderCostNotPositive):
		// A misconfigured catalogue, not a caller error.
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error(), "code": "pricing_misconfigured"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

// requireUser resolves the authenticated caller, writing a 401 and returning ""
// when the auth context is missing.
func requireUser(c *gin.Context) string {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return ""
	}
	return userID
}

func intQuery(c *gin.Context, name string, def int) int {
	raw := c.Query(name)
	if raw == "" {
		return def
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return def
	}
	return v
}

// ── Catalogue ────────────────────────────────────────────────────────────────

// ListCategories handles GET /api/finance/utilitybills/categories
func (h *Handler) ListCategories(c *gin.Context) {
	cats, err := h.svc.ListCategories(c.Request.Context())
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"categories": cats})
}

// ListBillers handles GET /api/finance/utilitybills/billers?category=
func (h *Handler) ListBillers(c *gin.Context) {
	billers, err := h.svc.ListBillers(c.Request.Context(), c.Query("category"))
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"billers": billers})
}

// ListProducts handles GET /api/finance/utilitybills/products?category=&biller_id=
func (h *Handler) ListProducts(c *gin.Context) {
	products, err := h.svc.ListProducts(c.Request.Context(), c.Query("category"), c.Query("biller_id"))
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"products": products})
}

// ── Validate / quote ─────────────────────────────────────────────────────────

type validateBody struct {
	Category          string            `json:"category"`
	BillerID          string            `json:"biller_id"`
	ProductID         string            `json:"product_id"`
	CustomerReference string            `json:"customer_reference"`
	Metadata          map[string]string `json:"metadata"`
}

// Validate handles POST /api/finance/utilitybills/validate
func (h *Handler) Validate(c *gin.Context) {
	if requireUser(c) == "" {
		return
	}
	var body validateBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	res, err := h.svc.ValidateCustomer(c.Request.Context(), ValidateInput{
		Category:          body.Category,
		BillerID:          body.BillerID,
		ProductID:         body.ProductID,
		CustomerReference: body.CustomerReference,
		Metadata:          body.Metadata,
	})
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

type quoteBody struct {
	Category   string `json:"category"`
	BillerID   string `json:"biller_id"`
	ProductID  string `json:"product_id"`
	AmountKobo *int64 `json:"amount_kobo"`
}

// Quote handles POST /api/finance/utilitybills/quote.
//
// The response deliberately omits provider_cost_kobo / gross_profit_kobo /
// gross_margin_bps. Those are Paymax's margin on the transaction; a member-facing
// quote has no business disclosing what we pay the provider, and the QuoteResult
// struct tags them `json:"-"` for the same reason.
func (h *Handler) Quote(c *gin.Context) {
	if requireUser(c) == "" {
		return
	}
	var body quoteBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	quote, err := h.svc.QuotePayment(c.Request.Context(), QuoteInput{
		Category:   body.Category,
		BillerID:   body.BillerID,
		ProductID:  body.ProductID,
		AmountKobo: body.AmountKobo,
	})
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"quote": quote})
}

// ── Pay ──────────────────────────────────────────────────────────────────────

type payBody struct {
	Category          string         `json:"category"`
	BillerID          string         `json:"biller_id"`
	ProductID         string         `json:"product_id"`
	CustomerReference string         `json:"customer_reference"`
	AmountKobo        *int64         `json:"amount_kobo"`
	PaymentSource     string         `json:"payment_source"`
	Metadata          map[string]any `json:"metadata"`
}

// Pay handles POST /api/finance/utilitybills/pay.
//
// REQUIRES an Idempotency-Key header (rejected by the service). A replay of the
// same key returns the ORIGINAL transaction with already_processed=true and 200 —
// never a second debit and never a second provider call.
func (h *Handler) Pay(c *gin.Context) {
	userID := requireUser(c)
	if userID == "" {
		return
	}
	var body payBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	res, err := h.svc.PayUtility(c.Request.Context(), userID, PayInput{
		Category:          body.Category,
		BillerID:          body.BillerID,
		ProductID:         body.ProductID,
		CustomerReference: body.CustomerReference,
		AmountKobo:        body.AmountKobo,
		PaymentSource:     body.PaymentSource,
		Metadata:          body.Metadata,
	}, idemKey(c))
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"already_processed": res.AlreadyProcessed,
		"transaction":       res.Transaction,
	})
}

// ── Member reads ─────────────────────────────────────────────────────────────

// ListTransactions handles GET /api/finance/utilitybills/transactions
func (h *Handler) ListTransactions(c *gin.Context) {
	userID := requireUser(c)
	if userID == "" {
		return
	}
	limit := intQuery(c, "limit", 20)
	offset := intQuery(c, "offset", 0)
	txns, err := h.svc.ListUserTransactions(c.Request.Context(), userID, limit, offset)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"transactions": txns, "limit": limit, "offset": offset})
}

// GetTransaction handles GET /api/finance/utilitybills/transactions/:id
func (h *Handler) GetTransaction(c *gin.Context) {
	userID := requireUser(c)
	if userID == "" {
		return
	}
	t, err := h.svc.GetUserTransaction(c.Request.Context(), userID, c.Param("id"))
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"transaction": t})
}

// ListTransactionAttempts handles GET /api/finance/utilitybills/transactions/:id/attempts
func (h *Handler) ListTransactionAttempts(c *gin.Context) {
	userID := requireUser(c)
	if userID == "" {
		return
	}
	// Ownership first: resolving through the user-scoped read means a member
	// cannot enumerate another member's provider attempts by guessing an id.
	if _, err := h.svc.GetUserTransaction(c.Request.Context(), userID, c.Param("id")); err != nil {
		writeErr(c, err)
		return
	}
	attempts, err := h.svc.ListAttempts(c.Request.Context(), c.Param("id"))
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"attempts": attempts})
}

// Requery handles POST /api/finance/utilitybills/transactions/:id/requery —
// the MEMBER-facing "check again" for a pending purchase. Ownership is resolved
// first; the service method itself is shared with the admin route.
func (h *Handler) Requery(c *gin.Context) {
	userID := requireUser(c)
	if userID == "" {
		return
	}
	if _, err := h.svc.GetUserTransaction(c.Request.Context(), userID, c.Param("id")); err != nil {
		writeErr(c, err)
		return
	}
	t, err := h.svc.RequeryTransaction(c.Request.Context(), c.Param("id"))
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"transaction": t})
}

type disputeBody struct {
	Reason string `json:"reason"`
}

// CreateDispute handles POST /api/finance/utilitybills/transactions/:id/dispute
func (h *Handler) CreateDispute(c *gin.Context) {
	userID := requireUser(c)
	if userID == "" {
		return
	}
	var body disputeBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	dispute, err := h.svc.CreateDispute(c.Request.Context(), userID, c.Param("id"), body.Reason)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"dispute": dispute})
}

// ── Beneficiaries ────────────────────────────────────────────────────────────

// ListBeneficiaries handles GET /api/finance/utilitybills/beneficiaries?category=
func (h *Handler) ListBeneficiaries(c *gin.Context) {
	userID := requireUser(c)
	if userID == "" {
		return
	}
	list, err := h.svc.ListBeneficiaries(c.Request.Context(), userID, c.Query("category"))
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"beneficiaries": list})
}

type beneficiaryBody struct {
	Category          string `json:"category"`
	BillerID          string `json:"biller_id"`
	Label             string `json:"label"`
	CustomerReference string `json:"customer_reference"`
	CustomerName      string `json:"customer_name"`
}

// SaveBeneficiary handles POST /api/finance/utilitybills/beneficiaries
func (h *Handler) SaveBeneficiary(c *gin.Context) {
	userID := requireUser(c)
	if userID == "" {
		return
	}
	var body beneficiaryBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	b, err := h.svc.SaveBeneficiary(c.Request.Context(), userID,
		body.Category, body.BillerID, body.Label, body.CustomerReference, body.CustomerName)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"beneficiary": b})
}

// DeleteBeneficiary handles DELETE /api/finance/utilitybills/beneficiaries/:id
func (h *Handler) DeleteBeneficiary(c *gin.Context) {
	userID := requireUser(c)
	if userID == "" {
		return
	}
	if err := h.svc.DeleteBeneficiary(c.Request.Context(), userID, c.Param("id")); err != nil {
		writeErr(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// ── Admin (RBAC-gated at the route: finance.admin.utilitybills) ──────────────
//
// Phase 1 mounts ONLY the money-affecting admin actions. The full 24-route admin
// surface is Phase 4. These exist now so the Next.js admin routes have something
// to proxy to in Phase 2, rather than running a second, independent writer
// against the same rows.

// AdminGetTransaction handles GET /api/finance/admin/utilitybills/transactions/:id
func (h *Handler) AdminGetTransaction(c *gin.Context) {
	t, err := h.svc.GetTransaction(c.Request.Context(), c.Param("id"))
	if err != nil {
		writeErr(c, err)
		return
	}
	attempts, aerr := h.svc.ListAttempts(c.Request.Context(), c.Param("id"))
	if aerr != nil {
		writeErr(c, aerr)
		return
	}
	c.JSON(http.StatusOK, gin.H{"transaction": t, "attempts": attempts})
}

// AdminRequery handles POST /api/finance/admin/utilitybills/transactions/:id/requery
func (h *Handler) AdminRequery(c *gin.Context) {
	t, err := h.svc.RequeryTransaction(c.Request.Context(), c.Param("id"))
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"transaction": t})
}

type reverseBody struct {
	Reason string `json:"reason"`
}

// AdminReverse handles POST /api/finance/admin/utilitybills/transactions/:id/reverse
func (h *Handler) AdminReverse(c *gin.Context) {
	var body reverseBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	reason := body.Reason
	if reason == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "reason is required"})
		return
	}
	t, err := h.svc.ReverseTransaction(c.Request.Context(), adminActor(c), c.Param("id"), reason)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"transaction": t})
}

// AdminUnresolvedBinds handles GET /api/finance/admin/utilitybills/unresolved —
// the reconciliation backlog: outbound purchases whose outcome was never learned.
// Each one is a member who may have been debited for a bill nobody can confirm.
func (h *Handler) AdminUnresolvedBinds(c *gin.Context) {
	n, err := h.svc.UnresolvedBindCount(c.Request.Context())
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"unresolved": n})
}
