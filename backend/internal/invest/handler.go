package invest

import (
	"context"
	"errors"
	"log"
	"net/http"
	"spotlight/backend/go-common/cryptox"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/middleware"
	platformRedis "spotlight/backend/internal/platform/redis"
	"spotlight/backend/internal/services"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler exposes the invest module over HTTP (Gin). User identity is read from
// the gin context key "user_id" (set by the shared auth middleware).
type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// errMap maps domain errors to HTTP status codes.
var errMap = httperr.New(http.StatusInternalServerError,
	httperr.R(http.StatusNotFound, ErrNotFound),
	httperr.R(http.StatusForbidden, ErrInvalidPIN, ErrPINNotSet, ErrPINLocked,
		ErrTradingDisabled, ErrNotEligible, ErrKYCInsufficient,
		ErrSuitabilityRequired, ErrTermsRequired, ErrAssetUnavailable),
	httperr.R(http.StatusUnprocessableEntity, ErrInsufficientCash, ErrInsufficientShares),
	httperr.R(http.StatusConflict, ErrMarketClosed),
	httperr.R(http.StatusBadRequest, ErrBelowMinimum, ErrAboveMaximum, ErrInvalidOrder),
)

// httpErr writes the mapped status; the PIN errors keep their bespoke bodies
// (client-facing message + machine code) that errMap cannot express.
func httpErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrInvalidPIN):
		c.JSON(http.StatusForbidden, gin.H{"error": "invalid PIN"})
	case errors.Is(err, ErrPINNotSet):
		c.JSON(http.StatusForbidden, gin.H{"error": "set a transaction PIN before trading", "code": "pin_not_set"})
	case errors.Is(err, ErrPINLocked):
		c.JSON(http.StatusForbidden, gin.H{"error": "transaction PIN locked — try again later", "code": "pin_locked"})
	default:
		errMap.Write(c, err)
	}
}

func (h *Handler) GetProfile(c *gin.Context) {
	p, err := h.svc.GetProfile(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

func (h *Handler) Start(c *gin.Context) {
	var body struct {
		Country   string `json:"country"`
		Residency string `json:"residency_country"`
	}
	_ = c.ShouldBindJSON(&body)
	p, err := h.svc.Start(c.Request.Context(), ginutil.UserID(c), body.Country, body.Residency)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

func (h *Handler) Eligibility(c *gin.Context) {
	e, err := h.svc.Eligibility(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, e)
}

func (h *Handler) Agreements(c *gin.Context) {
	a, err := h.svc.Agreements(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": a})
}

func (h *Handler) AcceptAgreements(c *gin.Context) {
	if err := h.svc.AcceptAgreements(c.Request.Context(), ginutil.UserID(c)); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"accepted": true})
}

func (h *Handler) SuitabilityQuestions(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"data": h.svc.SuitabilityQuestions()})
}

func (h *Handler) SubmitSuitability(c *gin.Context) {
	var req SuitabilitySubmitRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.SubmitSuitability(c.Request.Context(), ginutil.UserID(c), req.Answers)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) SuitabilityResult(c *gin.Context) {
	res, err := h.svc.SuitabilityResult(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListStocks(c *gin.Context) {
	limit, offset := ginutil.PageParams(c, 50, 100)
	stocks, err := h.svc.ListStocks(c.Request.Context(), c.Query("q"), c.Query("sector"), limit, offset)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": stocks})
}

func (h *Handler) SearchStocks(c *gin.Context) {
	limit, offset := ginutil.PageParams(c, 25, 100)
	stocks, err := h.svc.ListStocks(c.Request.Context(), c.Query("q"), "", limit, offset)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": stocks})
}

func (h *Handler) GetStock(c *gin.Context) {
	st, err := h.svc.GetStock(c.Request.Context(), c.Param("symbol"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, st)
}

func (h *Handler) StockChart(c *gin.Context) {
	candles, err := h.svc.StockChart(c.Request.Context(), c.Param("symbol"), c.DefaultQuery("range", "1m"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": candles})
}

func (h *Handler) StockNews(c *gin.Context) {
	// Mock market-data provides no news yet; return an empty, clearly-labelled set.
	c.JSON(http.StatusOK, gin.H{"data": []any{}, "source": "mock-market-data"})
}

func (h *Handler) StockDividends(c *gin.Context) {
	d, err := h.svc.Dividends(c.Request.Context(), c.Param("symbol"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": d})
}

func (h *Handler) StockCorporateActions(c *gin.Context) {
	a, err := h.svc.CorporateActions(c.Request.Context(), c.Param("symbol"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": a})
}

func (h *Handler) MarketStatus(c *gin.Context) {
	st, _ := h.svc.MarketStatus(c.Request.Context())
	c.JSON(http.StatusOK, gin.H{"market_status": st})
}

func (h *Handler) Buy(c *gin.Context) {
	var req BuyOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rec, err := h.svc.Buy(c.Request.Context(), ginutil.UserID(c), ginutil.IdempotencyKey(c), req)
	if err != nil {
		// Failed orders still return the receipt where available (status visible).
		if rec != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error(), "receipt": rec})
			return
		}
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, rec)
}

func (h *Handler) Sell(c *gin.Context) {
	var req SellOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rec, err := h.svc.Sell(c.Request.Context(), ginutil.UserID(c), ginutil.IdempotencyKey(c), req)
	if err != nil {
		if rec != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error(), "receipt": rec})
			return
		}
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, rec)
}

func (h *Handler) ListOrders(c *gin.Context) {
	limit, offset := ginutil.PageParams(c, 25, 100)
	orders, err := h.svc.ListOrders(c.Request.Context(), ginutil.UserID(c), c.Query("status"), limit, offset)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": orders})
}

func (h *Handler) GetOrder(c *gin.Context) {
	o, err := h.svc.GetOrder(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, o)
}

func (h *Handler) CancelOrder(c *gin.Context) {
	o, err := h.svc.CancelOrder(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, o)
}

func (h *Handler) Portfolio(c *gin.Context) {
	p, err := h.svc.Portfolio(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

func (h *Handler) Positions(c *gin.Context) {
	p, err := h.svc.Positions(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

func (h *Handler) Performance(c *gin.Context) {
	p, err := h.svc.Portfolio(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"total_value_kobo": p.TotalValueKobo, "total_gain_kobo": p.TotalGainKobo,
		"invested_value_kobo": p.InvestedValueKobo, "cash_balance_kobo": p.CashBalanceKobo,
	})
}

func (h *Handler) Wallet(c *gin.Context) {
	w, err := h.svc.Wallet(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, w)
}

func (h *Handler) Deposit(c *gin.Context) {
	var req DepositRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	w, err := h.svc.Deposit(c.Request.Context(), ginutil.UserID(c), ginutil.IdempotencyKey(c), req.AmountKobo, req.Source)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, w)
}

func (h *Handler) Withdraw(c *gin.Context) {
	var req WithdrawRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	w, err := h.svc.Withdraw(c.Request.Context(), ginutil.UserID(c), ginutil.IdempotencyKey(c), req.AmountKobo, req.Destination)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, w)
}

func (h *Handler) WalletTransactions(c *gin.Context) {
	limit, offset := ginutil.PageParams(c, 50, 100)
	txns, err := h.svc.WalletTransactions(c.Request.Context(), ginutil.UserID(c), limit, offset)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": txns})
}

func (h *Handler) ListWatchlists(c *gin.Context) {
	w, err := h.svc.Watchlists(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": w})
}

func (h *Handler) CreateWatchlist(c *gin.Context) {
	var body struct {
		Name string `json:"name"`
	}
	_ = c.ShouldBindJSON(&body)
	w, err := h.svc.CreateWatchlist(c.Request.Context(), ginutil.UserID(c), body.Name)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, w)
}

func (h *Handler) UpdateWatchlist(c *gin.Context) {
	var body struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.RenameWatchlist(c.Request.Context(), ginutil.UserID(c), c.Param("id"), body.Name); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"updated": true})
}

func (h *Handler) DeleteWatchlist(c *gin.Context) {
	if err := h.svc.DeleteWatchlist(c.Request.Context(), ginutil.UserID(c), c.Param("id")); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

func (h *Handler) AddWatchlistStock(c *gin.Context) {
	var body struct {
		Symbol string `json:"symbol" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.AddToWatchlist(c.Request.Context(), ginutil.UserID(c), c.Param("id"), body.Symbol); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"added": true})
}

func (h *Handler) RemoveWatchlistStock(c *gin.Context) {
	if err := h.svc.RemoveFromWatchlist(c.Request.Context(), ginutil.UserID(c), c.Param("id"), c.Param("assetId")); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"removed": true})
}

func (h *Handler) ListAlerts(c *gin.Context) {
	a, err := h.svc.Alerts(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": a})
}

func (h *Handler) CreateAlert(c *gin.Context) {
	var body struct {
		Symbol    string `json:"symbol" binding:"required"`
		Condition string `json:"condition" binding:"required"`
		Target    int64  `json:"target_price_kobo"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	a, err := h.svc.CreateAlert(c.Request.Context(), ginutil.UserID(c), body.Symbol, body.Condition, body.Target)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, a)
}

func (h *Handler) UpdateAlert(c *gin.Context) {
	var body struct {
		Status string `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.UpdateAlert(c.Request.Context(), ginutil.UserID(c), c.Param("id"), body.Status); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"updated": true})
}

func (h *Handler) DeleteAlert(c *gin.Context) {
	if err := h.svc.DeleteAlert(c.Request.Context(), ginutil.UserID(c), c.Param("id")); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

func (h *Handler) ListPublicOffers(c *gin.Context) {
	o, err := h.svc.PublicOffers(c.Request.Context())
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": o})
}

func (h *Handler) GetPublicOffer(c *gin.Context) {
	o, err := h.svc.PublicOffer(c.Request.Context(), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, o)
}

func (h *Handler) ApplyPublicOffer(c *gin.Context) {
	var body struct {
		AmountKobo int64 `json:"amount_kobo" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	app, err := h.svc.ApplyPublicOffer(c.Request.Context(), ginutil.UserID(c), ginutil.IdempotencyKey(c), c.Param("id"), body.AmountKobo)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, app)
}

func (h *Handler) PublicOfferApplications(c *gin.Context) {
	a, err := h.svc.PublicOfferApplications(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": a})
}

func (h *Handler) ListRightsIssues(c *gin.Context) {
	ri, err := h.svc.RightsIssues(c.Request.Context())
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": ri})
}

func (h *Handler) GetRightsIssue(c *gin.Context) {
	ri, err := h.svc.RightsIssue(c.Request.Context(), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, ri)
}

func (h *Handler) AcceptRightsIssue(c *gin.Context) {
	var body struct {
		Units float64 `json:"units" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	app, err := h.svc.AcceptRightsIssue(c.Request.Context(), ginutil.UserID(c), ginutil.IdempotencyKey(c), c.Param("id"), body.Units)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, app)
}

func (h *Handler) RightsApplications(c *gin.Context) {
	a, err := h.svc.RightsApplications(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": a})
}

// Deps carries the collaborators needed to wire the invest module.
type Deps struct {
	DB           *pgxpool.Pool
	Supabase     *integrations.SupabaseRestClient
	RBAC         services.RBACService
	MainLedger   *ledger.Service // main Paymax wallet (funds the invest wallet)
	Broker       BrokerAdapter   // nil → mock
	Market       MarketDataAdapter
	Offers       PublicOfferAdapter
	Notifier     Notifier              // nil → LogNotifier (price-alert delivery)
	Redis        *platformRedis.Client // optional; enables Redlock-guarded workers
	PINDevBypass bool                  // dev only: accept any well-formed PIN (no DB PIN)
	Enabled      bool                  // FEATURE_INVEST_ENABLED
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
	// Production: DB-backed PIN verifier with lockout. Dev bypass keeps the
	// format-only MockPINVerifier so local/mock flows don't require an enrolled PIN.
	if !d.PINDevBypass {
		svc.SetPINVerifier(NewDBPINVerifier(svc.repo))
	}
	h := NewHandler(svc)

	// authn maps the authenticated user's id into the gin context key handlers
	// read (matches the finance/onboarding modules' user_id convention).
	authn := func() gin.HandlerFunc {
		// RequireAuthContext validates the token and sets user_id/user_email before
		// it calls c.Next(); handlers read those directly, so no post-base mirror.
		return middleware.RequireAuthContext(d.Supabase, d.RBAC)
	}

	v1 := r.Group("/api/v1")

	inv := v1.Group("/invest")
	inv.Use(authn())
	{
		inv.GET("/profile", h.GetProfile)
		inv.POST("/start", h.Start)
		// Alias: the mobile client calls /invest/activate for the same onboarding
		// start action. Kept as a thin alias so both paths resolve identically.
		inv.POST("/activate", h.Start)
		inv.GET("/eligibility", h.Eligibility)
		inv.GET("/agreements", h.Agreements)
		inv.POST("/agreements/accept", h.AcceptAgreements)

		inv.GET("/suitability/questions", h.SuitabilityQuestions)
		inv.POST("/suitability/submit", h.SubmitSuitability)
		inv.GET("/suitability/result", h.SuitabilityResult)

		// Transaction PIN (gates order confirmation)
		inv.GET("/security/pin", h.PINStatus)
		inv.POST("/security/pin", h.SetPIN)

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

		inv.GET("/public-offers", h.ListPublicOffers)
		inv.GET("/public-offers/applications", h.PublicOfferApplications)
		inv.GET("/public-offers/:id", h.GetPublicOffer)
		inv.POST("/public-offers/:id/apply", h.ApplyPublicOffer)

		inv.GET("/rights-issues", h.ListRightsIssues)
		inv.GET("/rights-issues/applications", h.RightsApplications)
		inv.GET("/rights-issues/:id", h.GetRightsIssue)
		inv.POST("/rights-issues/:id/accept", h.AcceptRightsIssue)
	}

	stocks := v1.Group("/stocks")
	stocks.Use(authn())
	{
		stocks.GET("", h.ListStocks)
		stocks.GET("/search", h.SearchStocks)
		stocks.GET("/market-status", h.MarketStatus)

		// Orders (declared before /:symbol so they aren't captured as a symbol).
		stocks.POST("/orders/estimate", h.Estimate) // read-only pre-trade preview (no money move)
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
		admin.GET("/dividends", ah.ListDividends)
		admin.POST("/dividends", ah.CreateDividend)
		admin.GET("/corporate-actions", ah.ListCorporateActions)
		admin.POST("/corporate-actions", ah.CreateCorporateAction)
		admin.GET("/providers/health", ah.ProviderHealth)
		admin.GET("/audit", ah.AuditLog)
	}

	// Unauthenticated but provider-signed (HMAC). Only mounted when the broker
	// adapter exposes a webhook secret (the mock broker does not).
	if wp, ok := d.Broker.(webhookSecretProvider); ok && wp.WebhookSecret() != "" {
		wh := NewWebhookHandler(svc, wp.WebhookSecret())
		r.POST("/api/v1/invest/webhooks/broker", wh.Handle)
		log.Println("[invest] broker webhook registered at /api/v1/invest/webhooks/broker")
	}

	log.Println("[invest] routes registered at /api/v1/invest, /api/v1/stocks and /api/v1/admin/invest (broker=" +
		d.Broker.Name() + ", market-data=" + d.Market.Name() + ")")
	return svc
}

// InvestManagePermission is the RBAC slug required to reach the admin control
// plane. Grant it to Product/Trading-Ops/Super-Admin roles via the RBAC UI.
const InvestManagePermission = "invest.manage"

// Transaction PIN — DB-backed, salted SHA-256 with failed-attempt lockout.
// The raw PIN is never stored. Low-entropy PINs (4–6 digits) are protected by
// the lockout: after maxPINFailures wrong attempts the account is locked for
// pinLockWindow. This replaces MockPINVerifier in production.

const (
	maxPINFailures = 5
	pinLockWindow  = 15 * time.Minute
)

var (
	ErrPINNotSet = errors.New("invest: transaction PIN not set")
	ErrPINLocked = errors.New("invest: transaction PIN locked — try again later")
)

func hashPIN(salt, pin string) string {
	return cryptox.SHA256Hex(salt + pin)
}

func validPINFormat(pin string) bool {
	if len(pin) < 4 || len(pin) > 6 {
		return false
	}
	for _, c := range pin {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

type pinRow struct {
	Hash           string
	Salt           string
	FailedAttempts int
	LockedUntil    *time.Time
}

func (r *Repository) getPIN(ctx context.Context, userID string) (*pinRow, error) {
	var p pinRow
	err := r.db.QueryRow(ctx,
		`SELECT pin_hash, salt, failed_attempts, locked_until FROM invest_user_pins WHERE user_id=$1`, userID).
		Scan(&p.Hash, &p.Salt, &p.FailedAttempts, &p.LockedUntil)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPINNotSet
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// SetPIN creates or replaces a user's PIN (resets lockout state).
func (r *Repository) SetPIN(ctx context.Context, userID, pin string) error {
	salt := cryptox.RandHex(16)
	h := hashPIN(salt, pin)
	const q = `INSERT INTO invest_user_pins (user_id, pin_hash, salt, failed_attempts, locked_until)
		VALUES ($1,$2,$3,0,NULL)
		ON CONFLICT (user_id) DO UPDATE SET pin_hash=$2, salt=$3, failed_attempts=0, locked_until=NULL, updated_at=now()`
	_, err := r.db.Exec(ctx, q, userID, h, salt)
	return err
}

func (r *Repository) recordPINFailure(ctx context.Context, userID string, attempts int) error {
	if attempts+1 >= maxPINFailures {
		_, err := r.db.Exec(ctx,
			`UPDATE invest_user_pins SET failed_attempts=$2, locked_until=$3, updated_at=now() WHERE user_id=$1`,
			userID, attempts+1, time.Now().Add(pinLockWindow))
		return err
	}
	_, err := r.db.Exec(ctx,
		`UPDATE invest_user_pins SET failed_attempts=$2, updated_at=now() WHERE user_id=$1`, userID, attempts+1)
	return err
}

func (r *Repository) resetPINFailures(ctx context.Context, userID string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE invest_user_pins SET failed_attempts=0, locked_until=NULL, updated_at=now() WHERE user_id=$1`, userID)
	return err
}

// DBPINVerifier implements PINVerifier against invest_user_pins.
type DBPINVerifier struct{ repo *Repository }

func NewDBPINVerifier(repo *Repository) *DBPINVerifier { return &DBPINVerifier{repo: repo} }

func (v *DBPINVerifier) Verify(ctx context.Context, userID, pin string) error {
	if !validPINFormat(pin) {
		return ErrInvalidPIN
	}
	row, err := v.repo.getPIN(ctx, userID)
	if err != nil {
		return err // ErrPINNotSet or DB error
	}
	if row.LockedUntil != nil && row.LockedUntil.After(time.Now()) {
		return ErrPINLocked
	}
	expected := hashPIN(row.Salt, pin)
	if cryptox.ConstantTimeEqual(expected, row.Hash) {
		_ = v.repo.resetPINFailures(ctx, userID)
		return nil
	}
	_ = v.repo.recordPINFailure(ctx, userID, row.FailedAttempts)
	return ErrInvalidPIN
}

// SetPIN sets/changes a user's transaction PIN. When a PIN already exists the
// caller must supply the correct current PIN.
func (s *Service) SetPIN(ctx context.Context, userID, newPIN, currentPIN string) error {
	if !validPINFormat(newPIN) {
		return ErrInvalidPIN
	}
	if _, err := s.repo.getPIN(ctx, userID); err == nil {
		// Existing PIN — verify current before replacing.
		if err := s.pin.Verify(ctx, userID, currentPIN); err != nil {
			return err
		}
	} else if !errors.Is(err, ErrPINNotSet) {
		return err
	}
	return s.repo.SetPIN(ctx, userID, newPIN)
}

// HasPIN reports whether the user has set a transaction PIN.
func (s *Service) HasPIN(ctx context.Context, userID string) (bool, error) {
	_, err := s.repo.getPIN(ctx, userID)
	if errors.Is(err, ErrPINNotSet) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

func (h *Handler) PINStatus(c *gin.Context) {
	has, err := h.svc.HasPIN(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"pin_set": has})
}

func (h *Handler) SetPIN(c *gin.Context) {
	var body struct {
		PIN        string `json:"pin" binding:"required"`
		CurrentPIN string `json:"current_pin"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.SetPIN(c.Request.Context(), ginutil.UserID(c), body.PIN, body.CurrentPIN); err != nil {
		switch {
		case errors.Is(err, ErrInvalidPIN):
			c.JSON(http.StatusBadRequest, gin.H{"error": "PIN must be 4–6 digits, and the current PIN must be correct"})
		case errors.Is(err, ErrPINLocked):
			c.JSON(http.StatusForbidden, gin.H{"error": "PIN is locked, try again later"})
		default:
			httpErr(c, err)
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"pin_set": true})
}
