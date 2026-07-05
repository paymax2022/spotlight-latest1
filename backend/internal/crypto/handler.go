package crypto

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// Handler exposes the crypto member + admin API. user_id is mirrored onto the gin
// context by the caller's authn middleware (c.Set("user_id", ...)), matching the
// finance/invest convention. Every money mutation requires an Idempotency-Key and
// enforces object-level authZ (the session id is always the acting identity).
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func userID(c *gin.Context) string { return c.GetString("user_id") }

func requireIdem(c *gin.Context) (string, bool) {
	k := strings.TrimSpace(c.GetHeader("Idempotency-Key"))
	if k == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Idempotency-Key required"})
		return "", false
	}
	return k, true
}

func httpErr(c *gin.Context, err error) {
	switch err {
	case ErrForbidden:
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": err.Error()})
	case ErrNotFound:
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": err.Error()})
	case ErrInsufficient, ErrAssetInactive, ErrAmountTooSmall:
		c.JSON(http.StatusConflict, gin.H{"success": false, "error": err.Error()})
	default:
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
	}
}

func pageParams(c *gin.Context) (int, int) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))
	return limit, offset
}

// ── Member: catalogue / quotes ────────────────────────────────────────────────

// ListAssets GET /assets and /markets (members see active only).
func (h *Handler) ListAssets(c *gin.Context) {
	assets, err := h.svc.ListAssets(c.Request.Context(), true)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "assets": assets})
}

// Quote GET /assets/:id/quote.
func (h *Handler) Quote(c *gin.Context) {
	q, err := h.svc.Quote(c.Request.Context(), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "quote": q})
}

// Chart GET /assets/:id/quote-history (price history series).
func (h *Handler) Chart(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	points, err := h.svc.PriceHistory(c.Request.Context(), c.Param("id"), limit)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "points": points})
}

// Transaction GET /transactions/:id (single owned order detail).
func (h *Handler) Transaction(c *gin.Context) {
	o, err := h.svc.GetOrder(c.Request.Context(), userID(c), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "transaction": o})
}

// ── Member: money paths ───────────────────────────────────────────────────────

// Buy POST /orders/buy.
func (h *Handler) Buy(c *gin.Context) {
	key, ok := requireIdem(c)
	if !ok {
		return
	}
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthenticated"})
		return
	}
	var req struct {
		AssetID  string `json:"asset_id"`
		CashKobo int64  `json:"cash_kobo"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	o, err := h.svc.Buy(c.Request.Context(), uid, req.AssetID, req.CashKobo, key)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "order": o})
}

// Sell POST /orders/sell.
func (h *Handler) Sell(c *gin.Context) {
	key, ok := requireIdem(c)
	if !ok {
		return
	}
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthenticated"})
		return
	}
	var req struct {
		AssetID string `json:"asset_id"`
		Units   int64  `json:"units"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	o, err := h.svc.Sell(c.Request.Context(), uid, req.AssetID, req.Units, key)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "order": o})
}

// ── Member: portfolio / history ───────────────────────────────────────────────

// Portfolio GET /portfolio.
func (h *Handler) Portfolio(c *gin.Context) {
	p, err := h.svc.Portfolio(c.Request.Context(), userID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "portfolio": p})
}

// Holdings GET /portfolio/holdings.
func (h *Handler) Holdings(c *gin.Context) {
	hs, err := h.svc.Holdings(c.Request.Context(), userID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "holdings": hs})
}

// Orders GET /orders (own history).
func (h *Handler) Orders(c *gin.Context) {
	limit, offset := pageParams(c)
	os, err := h.svc.Orders(c.Request.Context(), userID(c), limit, offset)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "orders": os})
}

// ── Admin ─────────────────────────────────────────────────────────────────────

// AdminListOrders GET /admin/orders.
func (h *Handler) AdminListOrders(c *gin.Context) {
	limit, offset := pageParams(c)
	os, err := h.svc.AdminListOrders(c.Request.Context(), limit, offset)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "orders": os})
}

// AdminListAssets GET /admin/assets (all, incl. inactive).
func (h *Handler) AdminListAssets(c *gin.Context) {
	assets, err := h.svc.ListAssets(c.Request.Context(), false)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "assets": assets})
}

// AdminConfigAsset POST /admin/assets (create/update catalogue asset).
func (h *Handler) AdminConfigAsset(c *gin.Context) {
	var req struct {
		Symbol         string `json:"symbol"`
		Name           string `json:"name"`
		MinorUnitScale int64  `json:"minor_unit_scale"`
		IsActive       bool   `json:"is_active"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	a, err := h.svc.AdminConfigAsset(c.Request.Context(), userID(c),
		strings.ToUpper(strings.TrimSpace(req.Symbol)), req.Name, req.MinorUnitScale, req.IsActive)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "asset": a})
}
