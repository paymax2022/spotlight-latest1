package crypto

import (
	"log"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler exposes the crypto member + admin API. user_id is mirrored onto the gin
// context by the caller's authn middleware (c.Set("user_id", ...)), matching the
// finance/invest convention. Every money mutation requires an Idempotency-Key and
// enforces object-level authZ (the session id is always the acting identity).
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

var errMap = httperr.New(http.StatusBadRequest,
	httperr.R(http.StatusForbidden, ErrForbidden),
	// Tier-limit refusals: 403 — the same mapping the canonical transfer rail
	// uses (E2E-FIN-046). An unwired/degraded gate is a dependency failure: 503.
	httperr.R(http.StatusForbidden, tiers.ErrWalletDisabled, tiers.ErrDailyLimitExceeded),
	httperr.R(http.StatusServiceUnavailable, ErrTierGateUnwired),
	httperr.R(http.StatusNotFound, ErrNotFound, ErrAddressNotFound),
	httperr.R(http.StatusConflict, ErrInsufficient, ErrAssetInactive, ErrAmountTooSmall,
		ErrSameAsset, ErrInvalidTransition, ErrWithdrawTooSmall, ErrAddressExists),
	httperr.R(http.StatusBadRequest, ErrInvalidAddress),
)

// ListAssets GET /assets and /markets (members see active only).
func (h *Handler) ListAssets(c *gin.Context) {
	assets, err := h.svc.ListAssets(c.Request.Context(), true)
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "assets": assets})
}

// Quote GET /assets/:id/quote.
func (h *Handler) Quote(c *gin.Context) {
	q, err := h.svc.Quote(c.Request.Context(), c.Param("id"))
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "quote": q})
}

// Chart GET /assets/:id/quote-history (price history series).
func (h *Handler) Chart(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	points, err := h.svc.PriceHistory(c.Request.Context(), c.Param("id"), limit)
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "points": points})
}

// Transaction GET /transactions/:id (single owned order detail).
func (h *Handler) Transaction(c *gin.Context) {
	o, err := h.svc.GetOrder(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "transaction": o})
}

// Buy POST /orders/buy.
func (h *Handler) Buy(c *gin.Context) {
	key, ok := ginutil.RequireIdempotencyKeyOK(c)
	if !ok {
		return
	}
	uid := ginutil.UserID(c)
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
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "order": o})
}

// Sell POST /orders/sell.
func (h *Handler) Sell(c *gin.Context) {
	key, ok := ginutil.RequireIdempotencyKeyOK(c)
	if !ok {
		return
	}
	uid := ginutil.UserID(c)
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
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "order": o})
}

// Portfolio GET /portfolio.
func (h *Handler) Portfolio(c *gin.Context) {
	p, err := h.svc.Portfolio(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "portfolio": p})
}

// Holdings GET /portfolio/holdings.
func (h *Handler) Holdings(c *gin.Context) {
	hs, err := h.svc.Holdings(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "holdings": hs})
}

// Orders GET /orders (own history).
func (h *Handler) Orders(c *gin.Context) {
	limit, offset := ginutil.LimitOffset(c)
	os, err := h.svc.Orders(c.Request.Context(), ginutil.UserID(c), limit, offset)
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "orders": os})
}

// AdminListOrders GET /admin/orders.
func (h *Handler) AdminListOrders(c *gin.Context) {
	limit, offset := ginutil.LimitOffset(c)
	os, err := h.svc.AdminListOrders(c.Request.Context(), limit, offset)
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "orders": os})
}

// AdminListAssets GET /admin/assets (all, incl. inactive).
func (h *Handler) AdminListAssets(c *gin.Context) {
	assets, err := h.svc.ListAssets(c.Request.Context(), false)
	if err != nil {
		errMap.WriteOK(c, err)
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
	a, err := h.svc.AdminConfigAsset(c.Request.Context(), ginutil.UserID(c),
		strings.ToUpper(strings.TrimSpace(req.Symbol)), req.Name, req.MinorUnitScale, req.IsActive)
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "asset": a})
}

// Register wires the crypto module onto a member route group and an admin route
// group. The caller (finance_routes.go, gated by FEATURE_CRYPTO_ENABLED) mounts
// the member group at /api/v1/crypto and the admin group at /api/v1/admin/crypto,
// each with the shared authn middleware that mirrors the authenticated user id
// into the gin "user_id" key. This file is the only wiring point for crypto and
// edits no existing file.
//   - member: /api/v1/crypto/*       (member-authenticated; per-route RBAC crypto.view/trade)
//   - admin : /api/v1/admin/crypto/* (member-authenticated; per-route RBAC crypto.admin)
//
// Money path REUSES the finance ledger: BUY debits the main wallet into the
// shared escrow standing account + credits the crypto holding projection; SELL
// reverses. Every fill requires an Idempotency-Key, posts a balanced double-entry
// pair, snapshots the quote and emits an immutable audit event. Holdings are
// integer asset minor units; cash is NGN kobo — no float math.
func Register(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, led *ledger.Service, price PriceProvider, withdraw WithdrawalProvider) *Service {
	if pool == nil {
		log.Println("[crypto] nil pool — skipping crypto routes")
		return nil
	}
	if led == nil {
		log.Println("[crypto] nil ledger — skipping crypto routes")
		return nil
	}

	// Price + withdrawal providers are injected by the caller from config (mock-first,
	// real last). Nil is safe: NewService defaults the price to the deterministic mock,
	// and WithWithdrawalProvider ignores a nil withdrawal adapter (keeps the mock).
	svc := NewService(pool, led, price).WithWithdrawalProvider(withdraw)
	h := NewHandler(svc)

	rp := func(perm string) gin.HandlerFunc { return middleware.RequirePermission(rbac, perm) }

	{
		// Catalogue / markets / quotes (read → crypto.view).
		member.GET("/assets", rp(PermView), h.ListAssets)
		member.GET("/markets", rp(PermView), h.ListAssets)
		member.GET("/assets/:id/quote", rp(PermView), h.Quote)
		member.GET("/assets/:id/chart", rp(PermView), h.Chart)

		// Single owned transaction detail (object-level authZ in the service).
		member.GET("/transactions/:id", rp(PermView), h.Transaction)

		// Orders (write → crypto.trade). Declared before /:id-style routes.
		member.POST("/orders/buy", rp(PermTrade), h.Buy)
		member.POST("/orders/sell", rp(PermTrade), h.Sell)
		member.GET("/orders", rp(PermView), h.Orders)

		// Portfolio / holdings (read → crypto.view).
		member.GET("/portfolio", rp(PermView), h.Portfolio)
		member.GET("/portfolio/holdings", rp(PermView), h.Holdings)

		member.POST("/swap/quote", rp(PermTrade), h.SwapQuote) // pre-trade estimate
		member.POST("/swap", rp(PermTrade), h.Swap)            // Idempotency-Key required
		member.GET("/swap/orders", rp(PermView), h.SwapOrders)

		member.GET("/addresses", rp(PermView), h.ListAddresses)
		member.POST("/addresses", rp(PermTrade), h.AddAddress)
		member.POST("/addresses/screen", rp(PermView), h.ScreenAddress) // pre-save check
		member.DELETE("/addresses/:id", rp(PermTrade), h.DeleteAddress)

		member.GET("/deposit-address", rp(PermView), h.DepositAddress)

		// Static preview routes declared before the /:id param to avoid collision.
		member.GET("/withdrawals/eligibility", rp(PermView), h.WithdrawalEligibility)
		member.POST("/withdrawals/quote", rp(PermView), h.WithdrawalQuote) // fee preview
		member.POST("/withdrawals", rp(PermTrade), h.Withdraw)             // Idempotency-Key required
		member.GET("/withdrawals", rp(PermView), h.Withdrawals)
		member.GET("/withdrawals/:id", rp(PermView), h.Withdrawal)
		member.POST("/withdrawals/:id/confirm", rp(PermTrade), h.ConfirmWithdrawal)

		// Integration seam a custody provider (Fireblocks/BitGo/Anchorage) calls to
		// report on-chain balances, feeding reconciliation. Guarded ONLY by the
		// shared-secret header (fail-closed when CRYPTO_CUSTODY_WEBHOOK_SECRET is
		// unset). Mounted under the member group as
		// /api/v1/crypto/internal/onchain-balance. See onchain.go.
		registerCustodyWebhook(member, h)
	}

	if admin != nil {
		admin.GET("/orders", rp(PermAdmin), h.AdminListOrders)
		admin.GET("/assets", rp(PermAdmin), h.AdminListAssets)
		admin.POST("/assets", rp(PermAdmin), h.AdminConfigAsset)

		// Backs frontend-admin/app/admin/crypto/*. Read + AML/allow-list decision
		// paths; decisions drive the EXISTING state machines (no new money movement).
		admin.GET("/withdrawals", rp(PermAdmin), h.AdminListWithdrawals)
		admin.POST("/withdrawals/:id/decision", rp(PermAdmin), h.AdminDecideWithdrawal)
		admin.POST("/withdrawals/:id/retry-broadcast", rp(PermAdmin), h.AdminRetryBroadcast)
		admin.GET("/swaps", rp(PermAdmin), h.AdminListSwaps)
		admin.GET("/addresses", rp(PermAdmin), h.AdminListAddresses)
		admin.POST("/addresses/:id/decision", rp(PermAdmin), h.AdminDecideAddress)
		admin.GET("/reconciliation", rp(PermAdmin), h.AdminReconciliation)
	}

	log.Println("[crypto] routes registered at /api/v1/crypto and /api/v1/admin/crypto (price=" + svc.price.Name() + ")")
	return svc
}
