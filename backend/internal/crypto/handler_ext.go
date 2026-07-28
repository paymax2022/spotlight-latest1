package crypto

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// This file adds the HTTP handlers for the extended crypto money paths: swap
// (quote + execute), the address allow-list, deposit address, and the withdrawal
// state machine. Every money mutation requires an Idempotency-Key and enforces
// object-level authZ (the session id is always the acting identity).

func httpErrExt(c *gin.Context, err error) {
	switch err {
	case ErrForbidden:
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": err.Error()})
	case ErrNotFound, ErrAddressNotFound:
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": err.Error()})
	case ErrInsufficient, ErrAssetInactive, ErrAmountTooSmall, ErrSameAsset,
		ErrInvalidTransition, ErrWithdrawTooSmall, ErrAddressExists:
		c.JSON(http.StatusConflict, gin.H{"success": false, "error": err.Error()})
	case ErrInvalidAddress:
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
	default:
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
	}
}

// ── Swap ────────────────────────────────────────────────────────────────────

// SwapQuote POST /swap/quote (pre-trade estimate; no money moved).
func (h *Handler) SwapQuote(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthenticated"})
		return
	}
	var req struct {
		FromAssetID string `json:"from_asset_id"`
		ToAssetID   string `json:"to_asset_id"`
		FromUnits   int64  `json:"from_units"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	q, err := h.svc.SwapQuote(c.Request.Context(), uid, req.FromAssetID, req.ToAssetID, req.FromUnits)
	if err != nil {
		httpErrExt(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "quote": q})
}

// Swap POST /swap (execute the two-leg atomic order; Idempotency-Key required).
func (h *Handler) Swap(c *gin.Context) {
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
		FromAssetID string `json:"from_asset_id"`
		ToAssetID   string `json:"to_asset_id"`
		FromUnits   int64  `json:"from_units"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	o, err := h.svc.Swap(c.Request.Context(), uid, req.FromAssetID, req.ToAssetID, req.FromUnits, key)
	if err != nil {
		httpErrExt(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "swap": o})
}

// SwapOrders GET /swap/orders (own swap history).
func (h *Handler) SwapOrders(c *gin.Context) {
	limit, offset := pageParams(c)
	os, err := h.svc.SwapOrders(c.Request.Context(), userID(c), limit, offset)
	if err != nil {
		httpErrExt(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "orders": os})
}

// ── Address allow-list ──────────────────────────────────────────────────────

// ListAddresses GET /addresses (optional ?asset=<id|symbol>).
func (h *Handler) ListAddresses(c *gin.Context) {
	asset := strings.TrimSpace(c.Query("asset"))
	if asset == "" {
		asset = strings.TrimSpace(c.Query("symbol"))
	}
	list, err := h.svc.ListAddresses(c.Request.Context(), userID(c), asset)
	if err != nil {
		httpErrExt(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "addresses": list})
}

// AddAddress POST /addresses (whitelist a destination).
func (h *Handler) AddAddress(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthenticated"})
		return
	}
	var req struct {
		AssetID string `json:"asset_id"`
		Symbol  string `json:"symbol"`
		Label   string `json:"label"`
		Network string `json:"network"`
		Address string `json:"address"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	assetRef := req.AssetID
	if assetRef == "" {
		assetRef = req.Symbol
	}
	a, err := h.svc.AddAddress(c.Request.Context(), uid, resolveAsset(h, c, assetRef), req.Label, req.Network, req.Address)
	if err != nil {
		httpErrExt(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "address": a})
}

// DeleteAddress DELETE /addresses/:id.
func (h *Handler) DeleteAddress(c *gin.Context) {
	if err := h.svc.DeleteAddress(c.Request.Context(), userID(c), c.Param("id")); err != nil {
		httpErrExt(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ── Deposit address ─────────────────────────────────────────────────────────

// DepositAddress GET /deposit-address?asset=<id|symbol>&network=<net>.
func (h *Handler) DepositAddress(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthenticated"})
		return
	}
	assetRef := strings.TrimSpace(c.Query("asset"))
	if assetRef == "" {
		assetRef = strings.TrimSpace(c.Query("symbol"))
	}
	network := strings.TrimSpace(c.Query("network"))
	d, err := h.svc.DepositAddress(c.Request.Context(), uid, resolveAsset(h, c, assetRef), network)
	if err != nil {
		httpErrExt(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "deposit_address": d})
}

// ScreenAddress POST /addresses/screen (pre-save validation; no persistence).
func (h *Handler) ScreenAddress(c *gin.Context) {
	if userID(c) == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthenticated"})
		return
	}
	var req struct {
		Address string `json:"address"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	risk, reason := h.svc.ScreenAddress(c.Request.Context(), req.Address)
	c.JSON(http.StatusOK, gin.H{"success": true, "screening": gin.H{"risk": risk, "reason": reason}})
}

// ── Withdrawal state machine ────────────────────────────────────────────────

// WithdrawalEligibility GET /withdrawals/eligibility (read-only gate summary).
func (h *Handler) WithdrawalEligibility(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthenticated"})
		return
	}
	e, err := h.svc.WithdrawalEligibilityFor(c.Request.Context(), uid)
	if err != nil {
		httpErrExt(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "eligibility": e})
}

// WithdrawalQuote POST /withdrawals/quote (fee/receive preview; no money moved).
func (h *Handler) WithdrawalQuote(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthenticated"})
		return
	}
	var req struct {
		AssetID string `json:"asset_id"`
		Symbol  string `json:"symbol"`
		Network string `json:"network"`
		Units   int64  `json:"units"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	assetRef := req.AssetID
	if assetRef == "" {
		assetRef = req.Symbol
	}
	q, err := h.svc.QuoteWithdrawal(c.Request.Context(), uid, resolveAsset(h, c, assetRef), req.Network, req.Units)
	if err != nil {
		httpErrExt(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "quote": q})
}

// Withdraw POST /withdrawals (open + drive to broadcast; Idempotency-Key required).
func (h *Handler) Withdraw(c *gin.Context) {
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
		AssetID   string `json:"asset_id"`
		Symbol    string `json:"symbol"`
		AddressID string `json:"address_id"`
		Units     int64  `json:"units"`
		FeeKobo   int64  `json:"fee_kobo"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	assetRef := req.AssetID
	if assetRef == "" {
		assetRef = req.Symbol
	}
	w, err := h.svc.Withdraw(c.Request.Context(), uid, resolveAsset(h, c, assetRef), req.AddressID, req.Units, req.FeeKobo, key)
	if err != nil {
		httpErrExt(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "withdrawal": w})
}

// Withdrawals GET /withdrawals (own history).
func (h *Handler) Withdrawals(c *gin.Context) {
	limit, offset := pageParams(c)
	ws, err := h.svc.Withdrawals(c.Request.Context(), userID(c), limit, offset)
	if err != nil {
		httpErrExt(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "withdrawals": ws})
}

// Withdrawal GET /withdrawals/:id (single owned withdrawal detail).
func (h *Handler) Withdrawal(c *gin.Context) {
	w, err := h.svc.GetWithdrawal(c.Request.Context(), userID(c), c.Param("id"))
	if err != nil {
		httpErrExt(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "withdrawal": w})
}

// ConfirmWithdrawal POST /withdrawals/:id/confirm (broadcast → confirmed).
// This is the reconciliation/provider-webhook seam, exposed as an owner action for
// the mock provider so the terminal state is reachable end-to-end.
func (h *Handler) ConfirmWithdrawal(c *gin.Context) {
	var req struct {
		TxHash string `json:"tx_hash"`
	}
	_ = c.ShouldBindJSON(&req)
	w, err := h.svc.ConfirmWithdrawal(c.Request.Context(), userID(c), c.Param("id"), req.TxHash)
	if err != nil {
		httpErrExt(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "withdrawal": w})
}

// resolveAsset accepts an asset id OR a symbol and returns the asset id. It keeps
// handlers tolerant of the mobile client, which sends symbols in some flows. A
// bad reference is passed through unchanged so the service returns ErrNotFound.
func resolveAsset(h *Handler, c *gin.Context, ref string) string {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return ref
	}
	// Try as an id first (GetAsset by id); fall back to symbol lookup.
	if a, err := h.svc.repo.GetAsset(c.Request.Context(), ref); err == nil {
		return a.ID
	}
	assets, err := h.svc.ListAssets(c.Request.Context(), false)
	if err != nil {
		return ref
	}
	up := strings.ToUpper(ref)
	for _, a := range assets {
		if strings.ToUpper(a.Symbol) == up {
			return a.ID
		}
	}
	return ref
}
