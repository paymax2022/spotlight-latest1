package fractionalre

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/finance/ledger"
)

// Handler is the investor-facing HTTP surface for the fractionalre module.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// uid reads the authenticated user id (set by the shared auth middleware).
func uid(c *gin.Context) string { return c.GetString("user_id") }

// idemKey reads the Idempotency-Key header (required on money paths).
func idemKey(c *gin.Context) string {
	if k := strings.TrimSpace(c.GetHeader("Idempotency-Key")); k != "" {
		return k
	}
	return strings.TrimSpace(c.GetHeader("X-Idempotency-Key"))
}

func pageParams(c *gin.Context, def int) (int, int) {
	limit := def
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 && v <= 200 {
		limit = v
	}
	offset := 0
	if v, err := strconv.Atoi(c.Query("offset")); err == nil && v >= 0 {
		offset = v
	}
	return limit, offset
}

// httpErr maps service errors to status codes.
func httpErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, ErrIdempotencyKey):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, ErrLimitExceeded), errors.Is(err, ErrTicketRange),
		errors.Is(err, ErrBeneficiaryShare), errors.Is(err, ErrBeneficiaryLimit):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
	case errors.Is(err, ErrBeneficiaryInput), errors.Is(err, ErrValidation):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, ErrKYCRequired), errors.Is(err, ErrRiskAckRequired),
		errors.Is(err, ErrMasterRiskRequired), errors.Is(err, ErrProfileInactive):
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
	case errors.Is(err, ErrOfferingNotOpen), errors.Is(err, ErrMarketHalted),
		errors.Is(err, ErrInsufficientUnits), errors.Is(err, ErrInvalidTransition),
		errors.Is(err, ErrMakerChecker), errors.Is(err, ErrTitleSoD), errors.Is(err, ErrThresholdNotMet):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	case errors.Is(err, ledger.ErrInsufficientFunds):
		c.JSON(http.StatusPaymentRequired, gin.H{"error": "insufficient wallet balance"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

// ── Onboarding / profile ──────────────────────────────────────────────────────

func (h *Handler) Activate(c *gin.Context) {
	p, err := h.svc.Activate(c.Request.Context(), uid(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

func (h *Handler) Me(c *gin.Context) {
	p, err := h.svc.Me(c.Request.Context(), uid(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

func (h *Handler) Suitability(c *gin.Context) {
	var body struct {
		Score   int             `json:"score"`
		Answers json.RawMessage `json:"answers"`
	}
	_ = c.ShouldBindJSON(&body)
	answers := []byte("{}")
	if len(body.Answers) > 0 {
		answers = body.Answers
	}
	if err := h.svc.SubmitSuitability(c.Request.Context(), uid(c), body.Score, answers); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) RiskAck(c *gin.Context) {
	var body struct {
		OfferingID      *string `json:"offering_id"`
		DisclosureRef   string  `json:"disclosure_ref"`
		ScrollCompleted bool    `json:"scroll_completed"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !body.ScrollCompleted {
		c.JSON(http.StatusBadRequest, gin.H{"error": "risk disclosure must be fully scrolled before acknowledgement"})
		return
	}
	ack, err := h.svc.AckRisk(c.Request.Context(), uid(c), body.OfferingID, body.DisclosureRef, body.ScrollCompleted)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, ack)
}

// ── Offerings (discovery) ─────────────────────────────────────────────────────

func (h *Handler) ListOfferings(c *gin.Context) {
	limit, offset := pageParams(c, 25)
	out, err := h.svc.ListOfferings(c.Request.Context(), c.Query("status"), limit, offset)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"offerings": out})
}

func (h *Handler) GetOffering(c *gin.Context) {
	o, err := h.svc.GetOffering(c.Request.Context(), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, o)
}

func (h *Handler) Watch(c *gin.Context) {
	if err := h.svc.AddWatch(c.Request.Context(), uid(c), c.Param("id")); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) Unwatch(c *gin.Context) {
	if err := h.svc.RemoveWatch(c.Request.Context(), uid(c), c.Param("id")); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) Watchlist(c *gin.Context) {
	out, err := h.svc.ListWatch(c.Request.Context(), uid(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"watchlist": out})
}

// LimitCheck exposes the compliance engine (also reused server-side in subscribe).
func (h *Handler) LimitCheck(c *gin.Context) {
	var body struct {
		AmountKobo int64 `json:"amount_kobo"`
	}
	_ = c.ShouldBindJSON(&body)
	chk, err := h.svc.LimitCheck(c.Request.Context(), uid(c), body.AmountKobo)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, chk)
}

func (h *Handler) Subscribe(c *gin.Context) {
	if idemKey(c) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": ErrIdempotencyKey.Error()})
		return
	}
	var req SubscribeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	sub, err := h.svc.Subscribe(c.Request.Context(), uid(c), idemKey(c), c.Param("id"), req)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, sub)
}

// ── Portfolio ─────────────────────────────────────────────────────────────────

func (h *Handler) Portfolio(c *gin.Context) {
	holdings, err := h.svc.ListHoldings(c.Request.Context(), uid(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	var totalCost int64
	for _, hd := range holdings {
		totalCost += hd.CostKobo
	}
	c.JSON(http.StatusOK, gin.H{"holdings": holdings, "total_cost_kobo": totalCost, "count": len(holdings)})
}

func (h *Handler) Holdings(c *gin.Context) {
	out, err := h.svc.ListHoldings(c.Request.Context(), uid(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"holdings": out})
}

func (h *Handler) Holding(c *gin.Context) {
	// :id is a cap-table holding id → resolve via the user's holdings.
	out, err := h.svc.ListHoldings(c.Request.Context(), uid(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	id := c.Param("id")
	for _, hd := range out {
		if hd.ID == id {
			c.JSON(http.StatusOK, hd)
			return
		}
	}
	c.JSON(http.StatusNotFound, gin.H{"error": "holding not found"})
}

func (h *Handler) Payouts(c *gin.Context) {
	limit, offset := pageParams(c, 25)
	out, err := h.svc.ListPayouts(c.Request.Context(), uid(c), limit, offset)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"payouts": out})
}

func (h *Handler) Statements(c *gin.Context) {
	// Statements are derived from payouts + holdings (read-only aggregate).
	payouts, _ := h.svc.ListPayouts(c.Request.Context(), uid(c), 200, 0)
	holdings, _ := h.svc.ListHoldings(c.Request.Context(), uid(c))
	c.JSON(http.StatusOK, gin.H{"holdings": holdings, "payouts": payouts})
}

// ── Auto-invest ───────────────────────────────────────────────────────────────

func (h *Handler) ListAutoInvest(c *gin.Context) {
	out, err := h.svc.ListAutoInvest(c.Request.Context(), uid(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"auto_invest": out})
}

func (h *Handler) CreateAutoInvest(c *gin.Context) {
	var body struct {
		AmountKobo int64   `json:"amount_kobo" binding:"required"`
		Cadence    string  `json:"cadence"`
		AssetType  *string `json:"asset_type"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if body.Cadence == "" {
		body.Cadence = "monthly"
	}
	a, err := h.svc.CreateAutoInvest(c.Request.Context(), uid(c), body.AmountKobo, body.Cadence, body.AssetType)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, a)
}

func (h *Handler) PauseAutoInvest(c *gin.Context) {
	if err := h.svc.PauseAutoInvest(c.Request.Context(), uid(c), c.Param("id")); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── Secondary market (investor) ───────────────────────────────────────────────

func (h *Handler) Market(c *gin.Context) {
	limit, offset := pageParams(c, 25)
	out, err := h.svc.ListActiveListings(c.Request.Context(), limit, offset)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"listings": out})
}

func (h *Handler) MarketList(c *gin.Context) {
	if idemKey(c) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": ErrIdempotencyKey.Error()})
		return
	}
	var req ListFractionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	l, err := h.svc.ListFraction(c.Request.Context(), uid(c), idemKey(c), req)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, l)
}

func (h *Handler) MarketBuy(c *gin.Context) {
	if idemKey(c) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": ErrIdempotencyKey.Error()})
		return
	}
	var req BuyFractionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	o, err := h.svc.BuyFraction(c.Request.Context(), uid(c), idemKey(c), c.Param("id"), req)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, o)
}

func (h *Handler) MarketOrders(c *gin.Context) {
	limit, offset := pageParams(c, 25)
	out, err := h.svc.ListOrdersForUser(c.Request.Context(), uid(c), limit, offset)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"orders": out})
}

// ── Documents / certificates ──────────────────────────────────────────────────

func (h *Handler) Documents(c *gin.Context) {
	out, err := h.svc.ListDocuments(c.Request.Context(), uid(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"documents": out})
}

func (h *Handler) Certificate(c *gin.Context) {
	d, err := h.svc.GetCertificate(c.Request.Context(), uid(c), c.Param("investmentId"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, d)
}

// ── Goals ─────────────────────────────────────────────────────────────────────

func (h *Handler) ListGoals(c *gin.Context) {
	out, err := h.svc.ListGoals(c.Request.Context(), uid(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"goals": out})
}

func (h *Handler) CreateGoal(c *gin.Context) {
	var body struct {
		Name       string `json:"name" binding:"required"`
		TargetKobo int64  `json:"target_kobo"`
		TargetDate string `json:"target_date"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var td *time.Time
	if body.TargetDate != "" {
		if t, err := time.Parse("2006-01-02", body.TargetDate); err == nil {
			td = &t
		}
	}
	g, err := h.svc.CreateGoal(c.Request.Context(), uid(c), body.Name, body.TargetKobo, td)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, g)
}
