package crypto

import (
	"log"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Register wires the crypto module onto a member route group and an admin route
// group. The caller (finance_routes.go, gated by FEATURE_CRYPTO_ENABLED) mounts
// the member group at /api/v1/crypto and the admin group at /api/v1/admin/crypto,
// each with the shared authn middleware that mirrors the authenticated user id
// into the gin "user_id" key. This file is the only wiring point for crypto and
// edits no existing file.
//
//   - member: /api/v1/crypto/*       (member-authenticated; per-route RBAC crypto.view/trade)
//   - admin : /api/v1/admin/crypto/* (member-authenticated; per-route RBAC crypto.admin)
//
// Money path REUSES the finance ledger: BUY debits the main wallet into the
// shared escrow standing account + credits the crypto holding projection; SELL
// reverses. Every fill requires an Idempotency-Key, posts a balanced double-entry
// pair, snapshots the quote and emits an immutable audit event. Holdings are
// integer asset minor units; cash is NGN kobo — no float math.
func Register(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, led *ledger.Service) *Service {
	if pool == nil {
		log.Println("[crypto] nil pool — skipping crypto routes")
		return nil
	}
	if led == nil {
		log.Println("[crypto] nil ledger — skipping crypto routes")
		return nil
	}

	// Price feed is provider-agnostic; default is the deterministic mock (no network).
	svc := NewService(pool, led, NewMockPriceProvider())
	h := NewHandler(svc)

	rp := func(perm string) gin.HandlerFunc { return middleware.RequirePermission(rbac, perm) }

	// ── Member surface ────────────────────────────────────────────────────────
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

		// ── Swap (asset→asset atomic order; write → crypto.trade) ─────────────
		member.POST("/swap/quote", rp(PermTrade), h.SwapQuote) // pre-trade estimate
		member.POST("/swap", rp(PermTrade), h.Swap)            // Idempotency-Key required
		member.GET("/swap/orders", rp(PermView), h.SwapOrders)

		// ── Address allow-list (whitelisted withdrawal destinations) ──────────
		member.GET("/addresses", rp(PermView), h.ListAddresses)
		member.POST("/addresses", rp(PermTrade), h.AddAddress)
		member.POST("/addresses/screen", rp(PermView), h.ScreenAddress) // pre-save check
		member.DELETE("/addresses/:id", rp(PermTrade), h.DeleteAddress)

		// ── Deposit address (per-user, per-asset; persisted) ──────────────────
		member.GET("/deposit-address", rp(PermView), h.DepositAddress)

		// ── Withdrawals (state machine; write → crypto.trade) ─────────────────
		// Static preview routes declared before the /:id param to avoid collision.
		member.GET("/withdrawals/eligibility", rp(PermView), h.WithdrawalEligibility)
		member.POST("/withdrawals/quote", rp(PermView), h.WithdrawalQuote) // fee preview
		member.POST("/withdrawals", rp(PermTrade), h.Withdraw)             // Idempotency-Key required
		member.GET("/withdrawals", rp(PermView), h.Withdrawals)
		member.GET("/withdrawals/:id", rp(PermView), h.Withdrawal)
		member.POST("/withdrawals/:id/confirm", rp(PermTrade), h.ConfirmWithdrawal)
	}

	// ── Admin control plane (RBAC crypto.admin) ───────────────────────────────
	if admin != nil {
		admin.GET("/orders", rp(PermAdmin), h.AdminListOrders)
		admin.GET("/assets", rp(PermAdmin), h.AdminListAssets)
		admin.POST("/assets", rp(PermAdmin), h.AdminConfigAsset)
	}

	log.Println("[crypto] routes registered at /api/v1/crypto and /api/v1/admin/crypto (price=" + svc.price.Name() + ")")
	return svc
}
