package invest

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// Handler exposes the invest module over HTTP (Gin). User identity is read from
// the gin context key "user_id" (set by the shared auth middleware).
type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func uid(c *gin.Context) string { return c.GetString("user_id") }

// idemKey resolves the idempotency key from the standard header, falling back
// to a body field. Financial POSTs must carry one.
func idemKey(c *gin.Context) string {
	if k := strings.TrimSpace(c.GetHeader("Idempotency-Key")); k != "" {
		return k
	}
	return strings.TrimSpace(c.GetHeader("X-Idempotency-Key"))
}

// httpErr maps domain errors to HTTP status codes.
func httpErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, ErrInvalidPIN):
		c.JSON(http.StatusForbidden, gin.H{"error": "invalid PIN"})
	case errors.Is(err, ErrInsufficientCash), errors.Is(err, ErrInsufficientShares):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
	case errors.Is(err, ErrTradingDisabled), errors.Is(err, ErrNotEligible),
		errors.Is(err, ErrKYCInsufficient), errors.Is(err, ErrSuitabilityRequired),
		errors.Is(err, ErrTermsRequired), errors.Is(err, ErrAssetUnavailable):
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
	case errors.Is(err, ErrMarketClosed):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	case errors.Is(err, ErrBelowMinimum), errors.Is(err, ErrAboveMaximum), errors.Is(err, ErrInvalidOrder):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

func pageParams(c *gin.Context, defLimit int) (int, int) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", strconv.Itoa(defLimit)))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	if limit <= 0 || limit > 100 {
		limit = defLimit
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

// ── Profile / onboarding ─────────────────────────────────────────────────────

func (h *Handler) GetProfile(c *gin.Context) {
	p, err := h.svc.GetProfile(c.Request.Context(), uid(c))
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
	p, err := h.svc.Start(c.Request.Context(), uid(c), body.Country, body.Residency)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

func (h *Handler) Eligibility(c *gin.Context) {
	e, err := h.svc.Eligibility(c.Request.Context(), uid(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, e)
}

func (h *Handler) Agreements(c *gin.Context) {
	a, err := h.svc.Agreements(c.Request.Context(), uid(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": a})
}

func (h *Handler) AcceptAgreements(c *gin.Context) {
	if err := h.svc.AcceptAgreements(c.Request.Context(), uid(c)); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"accepted": true})
}

// ── Suitability ──────────────────────────────────────────────────────────────

func (h *Handler) SuitabilityQuestions(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"data": h.svc.SuitabilityQuestions()})
}

func (h *Handler) SubmitSuitability(c *gin.Context) {
	var req SuitabilitySubmitRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.SubmitSuitability(c.Request.Context(), uid(c), req.Answers)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) SuitabilityResult(c *gin.Context) {
	res, err := h.svc.SuitabilityResult(c.Request.Context(), uid(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ── Stocks ───────────────────────────────────────────────────────────────────

func (h *Handler) ListStocks(c *gin.Context) {
	limit, offset := pageParams(c, 50)
	stocks, err := h.svc.ListStocks(c.Request.Context(), c.Query("q"), c.Query("sector"), limit, offset)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": stocks})
}

func (h *Handler) SearchStocks(c *gin.Context) {
	limit, offset := pageParams(c, 25)
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

// ── Orders ───────────────────────────────────────────────────────────────────

func (h *Handler) Buy(c *gin.Context) {
	var req BuyOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rec, err := h.svc.Buy(c.Request.Context(), uid(c), idemKey(c), req)
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
	rec, err := h.svc.Sell(c.Request.Context(), uid(c), idemKey(c), req)
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
	limit, offset := pageParams(c, 25)
	orders, err := h.svc.ListOrders(c.Request.Context(), uid(c), c.Query("status"), limit, offset)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": orders})
}

func (h *Handler) GetOrder(c *gin.Context) {
	o, err := h.svc.GetOrder(c.Request.Context(), uid(c), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, o)
}

func (h *Handler) CancelOrder(c *gin.Context) {
	o, err := h.svc.CancelOrder(c.Request.Context(), uid(c), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, o)
}

// ── Portfolio ────────────────────────────────────────────────────────────────

func (h *Handler) Portfolio(c *gin.Context) {
	p, err := h.svc.Portfolio(c.Request.Context(), uid(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

func (h *Handler) Positions(c *gin.Context) {
	p, err := h.svc.Positions(c.Request.Context(), uid(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

func (h *Handler) Performance(c *gin.Context) {
	p, err := h.svc.Portfolio(c.Request.Context(), uid(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"total_value_kobo": p.TotalValueKobo, "total_gain_kobo": p.TotalGainKobo,
		"invested_value_kobo": p.InvestedValueKobo, "cash_balance_kobo": p.CashBalanceKobo,
	})
}

// ── Wallet ───────────────────────────────────────────────────────────────────

func (h *Handler) Wallet(c *gin.Context) {
	w, err := h.svc.Wallet(c.Request.Context(), uid(c))
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
	w, err := h.svc.Deposit(c.Request.Context(), uid(c), idemKey(c), req.AmountKobo, req.Source)
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
	w, err := h.svc.Withdraw(c.Request.Context(), uid(c), idemKey(c), req.AmountKobo, req.Destination)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, w)
}

func (h *Handler) WalletTransactions(c *gin.Context) {
	limit, offset := pageParams(c, 50)
	txns, err := h.svc.WalletTransactions(c.Request.Context(), uid(c), limit, offset)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": txns})
}

// ── Watchlists ───────────────────────────────────────────────────────────────

func (h *Handler) ListWatchlists(c *gin.Context) {
	w, err := h.svc.Watchlists(c.Request.Context(), uid(c))
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
	w, err := h.svc.CreateWatchlist(c.Request.Context(), uid(c), body.Name)
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
	if err := h.svc.RenameWatchlist(c.Request.Context(), uid(c), c.Param("id"), body.Name); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"updated": true})
}

func (h *Handler) DeleteWatchlist(c *gin.Context) {
	if err := h.svc.DeleteWatchlist(c.Request.Context(), uid(c), c.Param("id")); err != nil {
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
	if err := h.svc.AddToWatchlist(c.Request.Context(), uid(c), c.Param("id"), body.Symbol); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"added": true})
}

func (h *Handler) RemoveWatchlistStock(c *gin.Context) {
	if err := h.svc.RemoveFromWatchlist(c.Request.Context(), uid(c), c.Param("id"), c.Param("assetId")); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"removed": true})
}

// ── Alerts ───────────────────────────────────────────────────────────────────

func (h *Handler) ListAlerts(c *gin.Context) {
	a, err := h.svc.Alerts(c.Request.Context(), uid(c))
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
	a, err := h.svc.CreateAlert(c.Request.Context(), uid(c), body.Symbol, body.Condition, body.Target)
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
	if err := h.svc.UpdateAlert(c.Request.Context(), uid(c), c.Param("id"), body.Status); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"updated": true})
}

func (h *Handler) DeleteAlert(c *gin.Context) {
	if err := h.svc.DeleteAlert(c.Request.Context(), uid(c), c.Param("id")); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

// ── Public offers / rights issues ────────────────────────────────────────────

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
	app, err := h.svc.ApplyPublicOffer(c.Request.Context(), uid(c), idemKey(c), c.Param("id"), body.AmountKobo)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, app)
}

func (h *Handler) PublicOfferApplications(c *gin.Context) {
	a, err := h.svc.PublicOfferApplications(c.Request.Context(), uid(c))
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
	app, err := h.svc.AcceptRightsIssue(c.Request.Context(), uid(c), idemKey(c), c.Param("id"), body.Units)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, app)
}

func (h *Handler) RightsApplications(c *gin.Context) {
	a, err := h.svc.RightsApplications(c.Request.Context(), uid(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": a})
}
