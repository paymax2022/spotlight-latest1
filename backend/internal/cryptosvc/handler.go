package cryptosvc

import (
	"context"
	"errors"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/internal/cryptoprov"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
)

var (
	// ErrStepUpRejected means the user's transaction PIN was wrong or locked out.
	ErrStepUpRejected = errors.New("cryptosvc: step-up rejected")
	// ErrTradeNotAllowed means the user may not trade (KYC tier too low).
	ErrTradeNotAllowed = errors.New("cryptosvc: trading not allowed for this account")
)

// StepUp is the second factor required to confirm a swap (the user's transaction PIN).
// A nil StepUp fails closed: confirm is refused.
type StepUp interface {
	HasPin(ctx context.Context, userID string) (bool, error)
	// VerifyPin returns ErrStepUpRejected for a wrong or locked PIN. Callers must never call
	// it with an empty PIN: a missing value is a bad request, not a guess against the lockout.
	VerifyPin(ctx context.Context, userID, pin string) error
}

// HandlerDeps are the collaborators of the HTTP layer.
type HandlerDeps struct {
	Service *Service
	Ingest  *Ingest
	StepUp  StepUp
	// QuoteLimit / ConfirmLimit are per-user rate limiters placed in front of the quote and
	// confirm handlers (so a throttled confirm never reaches the PIN check). Optional here so
	// the handler stays testable; the app wiring always sets both. Reads and the webhook are
	// deliberately not throttled by them.
	QuoteLimit   gin.HandlerFunc
	ConfirmLimit gin.HandlerFunc
}

const (
	maxJSONBytes    = 64 << 10
	maxWebhookBytes = 1 << 20
)

// idemKeyRe bounds the Idempotency-Key: it is stored and used as a lookup key.
var idemKeyRe = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,255}$`)

// validSwapID reports whether id can be a swap id; anything else is a plain 404 (no database
// round trip, no cast error, and above all no PIN spent against it).
func validSwapID(id string) bool { _, err := uuid.Parse(id); return err == nil }

// SwapView is the client-facing swap. Provider ids, the provider account and the
// idempotency key are internal and never leave the server. NGN is integer kobo; crypto
// amounts are decimal strings.
type SwapView struct {
	ID             string  `json:"id"`
	Status         string  `json:"status"`
	Side           string  `json:"side"`
	Asset          string  `json:"asset"`
	NGNKobo        int64   `json:"ngn_kobo"`
	FeeKobo        int64   `json:"fee_kobo"`
	FeeBps         int     `json:"fee_bps"`
	TotalKobo      int64   `json:"total_kobo"`
	QuotedAmount   string  `json:"quoted_amount"`
	ReceivedAmount *string `json:"received_amount,omitempty"`
	Price          string  `json:"price"`
	ExpiresAt      string  `json:"expires_at,omitempty"`
}

func viewOf(r SwapRecord) SwapView {
	v := SwapView{
		ID: r.ID, Status: string(r.State), Side: string(r.Side), Asset: r.ToCurrency,
		NGNKobo: r.NGNKobo, FeeKobo: r.FeeKobo, FeeBps: r.FeeBps, TotalKobo: r.NGNKobo + r.FeeKobo,
		QuotedAmount: r.QuotedToAmount.String(), Price: r.QuotedPrice.String(),
	}
	if r.ReceivedAmount.IsPositive() {
		s := r.ReceivedAmount.String()
		v.ReceivedAmount = &s
	}
	if !r.ExpiresAt.IsZero() {
		v.ExpiresAt = r.ExpiresAt.UTC().Format("2006-01-02T15:04:05Z")
	}
	return v
}

func fail(c *gin.Context, status int, code string) {
	c.AbortWithStatusJSON(status, gin.H{"success": false, "error": code})
}

// RegisterRoutes mounts the member routes on member (already authenticated and permission
// guarded by the caller) and the unauthenticated provider webhook on hooks.
func RegisterRoutes(member *gin.RouterGroup, hooks *gin.RouterGroup, d HandlerDeps) {
	h := &handler{d: d}
	member.POST("/swaps/quote", withLimit(d.QuoteLimit, h.quote)...)
	member.POST("/swaps/:id/confirm", withLimit(d.ConfirmLimit, h.confirm)...)
	member.GET("/swaps/:id", h.get)
	if hooks != nil && d.Ingest != nil {
		hooks.POST("/crypto/:provider", h.webhook)
	}
}

// withLimit puts an optional limiter in front of a handler.
func withLimit(limit gin.HandlerFunc, h gin.HandlerFunc) []gin.HandlerFunc {
	if limit == nil {
		return []gin.HandlerFunc{h}
	}
	return []gin.HandlerFunc{limit, h}
}

type handler struct{ d HandlerDeps }

func (h *handler) quote(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	key, ok := ginutil.RequireIdempotencyKeyOK(c)
	if !ok {
		return
	}
	if !idemKeyRe.MatchString(key) {
		fail(c, http.StatusBadRequest, "invalid_idempotency_key")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxJSONBytes)
	var req struct {
		Asset   string `json:"asset"`
		NGNKobo int64  `json:"ngn_kobo"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Asset) == "" || req.NGNKobo <= 0 || req.NGNKobo > MaxQuoteKobo {
		fail(c, http.StatusBadRequest, "invalid_request")
		return
	}
	sw, err := h.d.Service.Quote(c.Request.Context(), QuoteRequest{UserID: uid, IdempotencyKey: key, Asset: req.Asset, NGNKobo: req.NGNKobo})
	if err != nil {
		h.writeErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "swap": viewOf(sw)})
}

func (h *handler) confirm(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	if !validSwapID(c.Param("id")) {
		fail(c, http.StatusNotFound, "not_found")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxJSONBytes)
	var req struct {
		Pin string `json:"pin"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Pin) == "" {
		// Refused BEFORE any verification: an absent PIN must not count as a wrong guess.
		fail(c, http.StatusBadRequest, "pin_required")
		return
	}
	if h.d.StepUp == nil {
		fail(c, http.StatusForbidden, "step_up_unavailable") // fail closed
		return
	}
	ctx := c.Request.Context()
	// The swap must exist and belong to the caller before the PIN is spent on it.
	if _, err := h.d.Service.reload(ctx, uid, c.Param("id")); err != nil {
		h.writeErr(c, err)
		return
	}
	has, err := h.d.StepUp.HasPin(ctx, uid)
	if err != nil {
		log.Printf("[crypto] step-up lookup failed: %v", err)
		fail(c, http.StatusInternalServerError, "internal")
		return
	}
	if !has {
		fail(c, http.StatusForbidden, "pin_not_set")
		return
	}
	if err := h.d.StepUp.VerifyPin(ctx, uid, req.Pin); err != nil {
		if errors.Is(err, ErrStepUpRejected) {
			h.d.Service.audit(ctx, uid, "crypto.swap.pin_rejected", c.Param("id"), "transaction PIN rejected", nil)
			fail(c, http.StatusForbidden, "pin_invalid")
			return
		}
		log.Printf("[crypto] step-up verify failed: %v", err)
		fail(c, http.StatusInternalServerError, "internal")
		return
	}

	sw, err := h.d.Service.Confirm(ctx, uid, c.Param("id"))
	if err != nil {
		// A provider outcome we cannot know is not the caller's error: the swap is parked with the
		// money held and the client is told it is being reviewed.
		if sw.State == cryptoprov.SwapStateNeedsReview && sw.ID != "" {
			c.JSON(http.StatusAccepted, gin.H{"success": true, "swap": viewOf(sw), "message": "your order is being reviewed"})
			return
		}
		h.writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "swap": viewOf(sw)})
}

func (h *handler) get(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	if !validSwapID(c.Param("id")) {
		fail(c, http.StatusNotFound, "not_found")
		return
	}
	sw, err := h.d.Service.reload(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		h.writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "swap": viewOf(sw)})
}

// writeErr maps domain errors to safe client responses. Unknown errors are logged and
// returned as an opaque 500: provider and database text never reaches the client.
func (h *handler) writeErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrSwapNotFound):
		fail(c, http.StatusNotFound, "not_found")
	case errors.Is(err, ErrIdempotencyConflict):
		fail(c, http.StatusConflict, "idempotency_conflict")
	case errors.Is(err, ErrQuoteExpired):
		fail(c, http.StatusGone, "quote_expired")
	case errors.Is(err, ErrTradeNotAllowed):
		fail(c, http.StatusForbidden, "trading_not_allowed")
	case errors.Is(err, ledger.ErrInsufficientFunds):
		fail(c, http.StatusUnprocessableEntity, "insufficient_funds")
	case errors.Is(err, tiers.ErrDailyLimitExceeded), errors.Is(err, tiers.ErrWalletDisabled), errors.Is(err, tiers.ErrCheckoutAllowanceExceeded):
		fail(c, http.StatusUnprocessableEntity, "limit_exceeded")
	case errors.Is(err, ErrSettlementConflict):
		fail(c, http.StatusConflict, "swap_not_confirmable")
	default:
		log.Printf("[crypto] request failed: %v", err)
		fail(c, http.StatusInternalServerError, "internal")
	}
}

// webhook receives provider events. It is authenticated by the provider's signature, not a
// session. 200 for success and duplicates, 401 for a bad signature, and 500 on any
// processing failure so the provider redelivers.
func (h *handler) webhook(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxWebhookBytes)
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			c.AbortWithStatus(http.StatusRequestEntityTooLarge)
			return
		}
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}
	headers := make(map[string]string, len(c.Request.Header))
	for k, v := range c.Request.Header {
		if len(v) > 0 {
			headers[strings.ToLower(k)] = v[0]
		}
	}
	out, err := h.d.Ingest.Handle(c.Request.Context(), c.Param("provider"), headers, body)
	switch {
	case err == nil:
		c.JSON(http.StatusOK, gin.H{"success": true, "outcome": string(out)})
	case errors.Is(err, ErrBadSignature):
		c.AbortWithStatus(http.StatusUnauthorized)
	case errors.Is(err, ErrUnknownProvider):
		c.AbortWithStatus(http.StatusNotFound)
	default:
		log.Printf("[crypto] webhook failed (provider=%s): %v", c.Param("provider"), err)
		if errors.Is(err, ErrDedupeNotReleased) {
			log.Printf("[crypto][ALERT] webhook dedupe row not released: a swap may be stranded until the reconciler runs")
		}
		c.AbortWithStatus(http.StatusInternalServerError)
	}
}
