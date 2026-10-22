package cryptosvc

import (
	"context"
	"errors"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"

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
	// Recon is this replica's reconciler, read by the admin status view. Nil leaves that
	// endpoint answering 503.
	Recon *Reconciler
	// FeeAdmin is the editable fee-schedule history behind the admin API; nil answers 503.
	FeeAdmin FeeStore
}

const (
	maxJSONBytes    = 64 << 10
	maxWebhookBytes = 1 << 20
)

// idemKeyRe bounds the Idempotency-Key: it is stored and used as a lookup key.
var idemKeyRe = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,255}$`)

// unitsRe is a plain positive-or-zero decimal: no sign, no exponent, at most 18 places (the
// finest crypto precision we carry). Crypto amounts travel as strings, never JSON numbers.
var unitsRe = regexp.MustCompile(`^[0-9]{1,20}(\.[0-9]{1,18})?$`)

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
	Amount         string  `json:"amount,omitempty"` // sell: crypto units sold
	NGNKobo        int64   `json:"ngn_kobo"`
	FeeKobo        int64   `json:"fee_kobo"`
	FeeBps         int     `json:"fee_bps"`
	TotalKobo      int64   `json:"total_kobo"` // NGN through the wallet: buy debits ngn+fee, sell credits ngn-fee
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
	if r.Side == SideSell {
		v.Asset, v.Amount, v.TotalKobo = r.FromCurrency, r.FromAmount.String(), r.NGNKobo-r.FeeKobo
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
	member.GET("/swaps/config", h.config)
	member.GET("/swaps/balances", h.balances)
	member.GET("/swaps/deposit-address", h.depositAddress)
	member.GET("/swaps/deposits", h.deposits)
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
		Side    string  `json:"side"`
		Asset   string  `json:"asset"`
		NGNKobo int64   `json:"ngn_kobo"`
		Amount  *string `json:"amount"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Asset) == "" {
		fail(c, http.StatusBadRequest, "invalid_request")
		return
	}
	qr := QuoteRequest{UserID: uid, IdempotencyKey: key, Asset: req.Asset}
	switch Side(req.Side) {
	case "", SideBuy: // a buy names the NGN to spend, never a crypto amount
		if req.Amount != nil || req.NGNKobo <= 0 || req.NGNKobo > MaxQuoteKobo {
			fail(c, http.StatusBadRequest, "invalid_request")
			return
		}
		qr.Side, qr.NGNKobo = SideBuy, req.NGNKobo
	case SideSell: // a sell names the crypto to sell; the NGN is the provider's price
		if req.Amount == nil || req.NGNKobo != 0 || !unitsRe.MatchString(*req.Amount) {
			fail(c, http.StatusBadRequest, "invalid_request")
			return
		}
		amt, err := decimal.NewFromString(*req.Amount)
		if err != nil || !amt.IsPositive() {
			fail(c, http.StatusBadRequest, "invalid_request")
			return
		}
		qr.Side, qr.Amount = SideSell, amt
	default:
		fail(c, http.StatusBadRequest, "invalid_request")
		return
	}
	sw, err := h.d.Service.Quote(c.Request.Context(), qr)
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

// config tells the app this pipeline is mounted: trades go to the provider and holdings live
// in the provider sub-account (so the portfolio reads /swaps/balances). The route only exists
// when the pipeline is wired, so its absence is the app's signal to stay on the legacy rail.
func (h *handler) config(c *gin.Context) {
	if ginutil.UserID(c) == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "config": gin.H{
		"rail": "provider", "sides": []string{string(SideBuy), string(SideSell)}, "max_quote_kobo": MaxQuoteKobo,
	}})
}

// BalanceView is one crypto holding. Amounts are decimal strings: available is spendable
// (and sellable); locked is reserved by the provider (open withdrawals).
type BalanceView struct {
	Asset     string `json:"asset"`
	Available string `json:"available"`
	Locked    string `json:"locked"`
	Total     string `json:"total"`
}

func (h *handler) balances(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	ws, err := h.d.Service.Balances(c.Request.Context(), uid)
	if err != nil {
		log.Printf("[crypto] balances for %s: %v", uid, err)
		fail(c, http.StatusBadGateway, "provider_unavailable")
		return
	}
	out := make([]BalanceView, 0, len(ws))
	for _, w := range ws {
		out = append(out, BalanceView{Asset: w.Currency, Available: w.Balance.String(), Locked: w.Locked.String(), Total: w.Balance.Add(w.Locked).String()})
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "balances": out})
}

// DepositAddressView is where the user sends crypto. Tag is the memo some networks need.
type DepositAddressView struct {
	Asset   string `json:"asset"`
	Network string `json:"network"`
	Address string `json:"address"`
	Tag     string `json:"tag,omitempty"`
}

func (h *handler) depositAddress(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	a, err := h.d.Service.DepositAddress(c.Request.Context(), uid, c.Query("asset"), c.Query("network"))
	switch {
	case err == nil:
		c.JSON(http.StatusOK, gin.H{"success": true, "deposit_address": DepositAddressView{Asset: a.Currency, Network: a.Network, Address: a.Address, Tag: a.Tag}})
	case errors.Is(err, cryptoprov.ErrAddressPending):
		// Not a failure: the provider is generating it. The app asks again shortly.
		c.JSON(http.StatusAccepted, gin.H{"success": false, "error": "address_pending"})
	case errors.Is(err, ErrInvalidDepositRequest):
		fail(c, http.StatusBadRequest, "invalid_request")
	case errors.Is(err, ErrDepositsUnavailable):
		fail(c, http.StatusServiceUnavailable, "deposits_unavailable")
	case errors.Is(err, ErrTradeNotAllowed):
		fail(c, http.StatusForbidden, "trading_not_allowed")
	default:
		log.Printf("[crypto] deposit address for %s: %v", uid, err)
		fail(c, http.StatusBadGateway, "provider_unavailable")
	}
}

// DepositView is one recorded deposit. Amounts are decimal strings.
type DepositView struct {
	ID                    string `json:"id"`
	Asset                 string `json:"asset"`
	Network               string `json:"network,omitempty"`
	Amount                string `json:"amount"`
	Status                string `json:"status"`
	TxID                  string `json:"txid,omitempty"`
	Confirmations         int    `json:"confirmations"`
	RequiredConfirmations int    `json:"required_confirmations"`
	CreatedAt             string `json:"created_at,omitempty"`
	UpdatedAt             string `json:"updated_at,omitempty"`
}

func (h *handler) deposits(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	ds, err := h.d.Service.Deposits(c.Request.Context(), uid, 50)
	if err != nil {
		if errors.Is(err, ErrDepositsUnavailable) {
			fail(c, http.StatusServiceUnavailable, "deposits_unavailable")
			return
		}
		log.Printf("[crypto] deposits for %s: %v", uid, err)
		fail(c, http.StatusInternalServerError, "internal")
		return
	}
	out := make([]DepositView, 0, len(ds))
	for _, d := range ds {
		v := DepositView{ID: d.ProviderDepositID, Asset: d.Currency, Network: d.Network, Amount: d.Amount.String(), Status: string(d.Status),
			TxID: d.TxID, Confirmations: d.Confirmations, RequiredConfirmations: d.RequiredConfirmations}
		if !d.CreatedAt.IsZero() {
			v.CreatedAt = d.CreatedAt.UTC().Format(time.RFC3339)
		}
		if !d.UpdatedAt.IsZero() {
			v.UpdatedAt = d.UpdatedAt.UTC().Format(time.RFC3339)
		}
		out = append(out, v)
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "deposits": out})
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
	case errors.Is(err, ErrTradingPaused):
		fail(c, http.StatusServiceUnavailable, "trading_paused")
	case errors.Is(err, ErrMarketDisabled):
		fail(c, http.StatusForbidden, "market_disabled")
	case errors.Is(err, ErrAboveLimit):
		fail(c, http.StatusUnprocessableEntity, "limit_exceeded")
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
