package invest

import (
	"log"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Deps carries the collaborators needed to wire the invest module.
type Deps struct {
	DB         *pgxpool.Pool
	Supabase   *integrations.SupabaseRestClient
	RBAC       services.RBACService
	MainLedger *ledger.Service // main Paymax wallet (funds the invest wallet)
	Broker     BrokerAdapter   // nil → mock
	Market     MarketDataAdapter
	Offers     PublicOfferAdapter
	Notifier   Notifier // nil → LogNotifier (price-alert delivery)
	Enabled    bool     // FEATURE_INVEST_ENABLED
}

// Register mounts all invest routes under /api/v1/invest and /api/v1/stocks.
// Trading stays gated behind the feature flag and the per-user compliance gate.
func Register(r *gin.Engine, d Deps) *Service {
	if !d.Enabled {
		log.Println("[invest] FEATURE_INVEST_ENABLED is false — skipping routes")
		return nil
	}
	if d.DB == nil {
		log.Println("[invest] no database pool — skipping routes")
		return nil
	}
	if d.Broker == nil {
		d.Broker = NewMockBroker()
	}
	if d.Market == nil {
		d.Market = NewMockMarketData()
	}
	if d.Offers == nil {
		d.Offers = NewMockPublicOffer()
	}

	svc := NewService(d.DB, d.MainLedger, d.Broker, d.Market, d.Offers)
	svc.SetNotifier(d.Notifier) // no-op when nil (keeps LogNotifier default)
	h := NewHandler(svc)

	// authn maps the authenticated user's id into the gin context key handlers
	// read (matches the finance/onboarding modules' user_id convention).
	authn := func() gin.HandlerFunc {
		base := middleware.RequireAuthContext(d.Supabase, d.RBAC)
		return func(c *gin.Context) {
			base(c)
			if c.IsAborted() {
				return
			}
			if au, ok := middleware.GetAuthenticatedUser(c); ok {
				c.Set("user_id", au.ID)
			}
			c.Next()
		}
	}

	v1 := r.Group("/api/v1")

	// ── Investment profile / onboarding ──────────────────────────────────────
	inv := v1.Group("/invest")
	inv.Use(authn())
	{
		inv.GET("/profile", h.GetProfile)
		inv.POST("/start", h.Start)
		inv.GET("/eligibility", h.Eligibility)
		inv.GET("/agreements", h.Agreements)
		inv.POST("/agreements/accept", h.AcceptAgreements)

		inv.GET("/suitability/questions", h.SuitabilityQuestions)
		inv.POST("/suitability/submit", h.SubmitSuitability)
		inv.GET("/suitability/result", h.SuitabilityResult)

		// Portfolio
		inv.GET("/portfolio", h.Portfolio)
		inv.GET("/portfolio/positions", h.Positions)
		inv.GET("/portfolio/performance", h.Performance)

		// Wallet
		inv.GET("/wallet", h.Wallet)
		inv.POST("/wallet/deposit", h.Deposit)
		inv.POST("/wallet/withdraw", h.Withdraw)
		inv.GET("/wallet/transactions", h.WalletTransactions)

		// Watchlists
		inv.GET("/watchlists", h.ListWatchlists)
		inv.POST("/watchlists", h.CreateWatchlist)
		inv.PATCH("/watchlists/:id", h.UpdateWatchlist)
		inv.DELETE("/watchlists/:id", h.DeleteWatchlist)
		inv.POST("/watchlists/:id/stocks", h.AddWatchlistStock)
		inv.DELETE("/watchlists/:id/stocks/:assetId", h.RemoveWatchlistStock)

		// Alerts
		inv.GET("/alerts", h.ListAlerts)
		inv.POST("/alerts", h.CreateAlert)
		inv.PATCH("/alerts/:id", h.UpdateAlert)
		inv.DELETE("/alerts/:id", h.DeleteAlert)

		// Public offers
		inv.GET("/public-offers", h.ListPublicOffers)
		inv.GET("/public-offers/applications", h.PublicOfferApplications)
		inv.GET("/public-offers/:id", h.GetPublicOffer)
		inv.POST("/public-offers/:id/apply", h.ApplyPublicOffer)

		// Rights issues
		inv.GET("/rights-issues", h.ListRightsIssues)
		inv.GET("/rights-issues/applications", h.RightsApplications)
		inv.GET("/rights-issues/:id", h.GetRightsIssue)
		inv.POST("/rights-issues/:id/accept", h.AcceptRightsIssue)
	}

	// ── Stocks discovery + orders ────────────────────────────────────────────
	stocks := v1.Group("/stocks")
	stocks.Use(authn())
	{
		stocks.GET("", h.ListStocks)
		stocks.GET("/search", h.SearchStocks)
		stocks.GET("/market-status", h.MarketStatus)

		// Orders (declared before /:symbol so they aren't captured as a symbol).
		stocks.POST("/orders/buy", h.Buy)
		stocks.POST("/orders/sell", h.Sell)
		stocks.GET("/orders", h.ListOrders)
		stocks.GET("/orders/:id", h.GetOrder)
		stocks.POST("/orders/:id/cancel", h.CancelOrder)

		stocks.GET("/:symbol", h.GetStock)
		stocks.GET("/:symbol/chart", h.StockChart)
		stocks.GET("/:symbol/news", h.StockNews)
		stocks.GET("/:symbol/dividends", h.StockDividends)
		stocks.GET("/:symbol/corporate-actions", h.StockCorporateActions)
	}

	// ── Admin control plane ──────────────────────────────────────────────────
	// RBAC-gated: requires the `invest.manage` permission (fail-closed). Every
	// mutation is written to invest_admin_audit_log by the handlers.
	ah := NewAdminHandler(svc)
	admin := r.Group("/api/v1/admin/invest")
	admin.Use(authn())
	admin.Use(middleware.RequirePermission(d.RBAC, InvestManagePermission))
	{
		admin.GET("/overview", ah.Overview)
		admin.GET("/assets", ah.ListAssets)
		admin.POST("/assets", ah.CreateAsset)
		admin.PATCH("/assets/:id", ah.UpdateAsset)
		admin.GET("/orders", ah.ListOrders)
		admin.GET("/orders/failed", ah.FailedOrders)
		admin.GET("/settlement/pending", ah.PendingSettlements)
		admin.POST("/settlement/run", ah.RunSettlement)
		admin.GET("/fees", ah.GetFees)
		admin.PUT("/fees", ah.UpdateFees)
		admin.GET("/reconciliation", ah.Reconciliation)
		admin.GET("/audit", ah.AuditLog)
	}

	log.Println("[invest] routes registered at /api/v1/invest, /api/v1/stocks and /api/v1/admin/invest (broker=" +
		d.Broker.Name() + ", market-data=" + d.Market.Name() + ")")
	return svc
}

// InvestManagePermission is the RBAC slug required to reach the admin control
// plane. Grant it to Product/Trading-Ops/Super-Admin roles via the RBAC UI.
const InvestManagePermission = "invest.manage"
