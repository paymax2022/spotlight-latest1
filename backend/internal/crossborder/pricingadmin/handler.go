package pricingadmin

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/internal/crossborder/pricing"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// PermPricing gates every endpoint in this package.
const PermPricing = "finance.admin.pricing"

// Handler serves the pricing admin endpoints.
type Handler struct {
	store  Store
	spread SpreadSupplier
	verto  VertoMarkupReader // optional
	now    func() time.Time
}

// NewHandler builds the handler. spread may be nil only in tests that do not
// call the simulator/spread endpoints; verto may be nil.
func NewHandler(store Store, spread SpreadSupplier, verto VertoMarkupReader) *Handler {
	return &Handler{store: store, spread: spread, verto: verto, now: func() time.Time { return time.Now().UTC() }}
}

// WithClock overrides the clock (tests).
func (h *Handler) WithClock(f func() time.Time) *Handler { h.now = f; return h }

// Register mounts the routes on g (already authenticated). Every route is
// individually gated by RequirePermission(finance.admin.pricing).
func (h *Handler) Register(g gin.IRoutes, rbac services.RBACService) {
	p := middleware.RequirePermission(rbac, PermPricing)

	g.GET("/rate-card", p, h.ListRateCard)
	g.POST("/rate-card", p, h.CreateRateCard)
	g.PUT("/rate-card/:id", p, h.UpdateRateCard)
	g.POST("/rate-card/:id/expire", p, h.ExpireRateCard)

	g.GET("/fee-schedule", p, h.ListFeeRules)
	g.POST("/fee-schedule", p, h.CreateFeeChange)
	g.GET("/fee-schedule/:id", p, h.GetFeeRule)
	g.POST("/fee-schedule/:id/approve", p, h.ApproveFeeChange)
	g.POST("/fee-schedule/:id/reject", p, h.RejectFeeChange)
	g.POST("/fee-schedule/:id/rollback", p, h.RollbackFeeRule) // :id = rule_key

	g.GET("/spread", p, h.GetSpread)
	g.GET("/spread/sync", p, h.GetSpreadSync)

	g.GET("/guardrails", p, h.GetGuardrails)
	g.PUT("/guardrails", p, h.PutGuardrails)
	g.GET("/collection-settings", p, h.GetCollection)
	g.PUT("/collection-settings", p, h.PutCollection)
	g.GET("/refund-policy", p, h.GetRefundPolicy)
	g.PUT("/refund-policy", p, h.PutRefundPolicy)

	g.POST("/simulate", p, h.Simulate)
}

func (h *Handler) actor(c *gin.Context) (string, bool) {
	id := strings.TrimSpace(ginutil.UserID(c))
	if id == "" {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return "", false
	}
	return id, true
}

func fail(c *gin.Context, status int, code, msg string) {
	c.AbortWithStatusJSON(status, gin.H{"error": msg, "code": code})
}

// writeErr maps domain/pricing errors to HTTP. Guardrail and pricing-config
// violations are 4xx (never 500): they are caller/config problems, fail closed.
func writeErr(c *gin.Context, err error) {
	var ge *pricing.GuardrailError
	switch {
	case errors.As(err, &ge):
		code := "below_cost_floor"
		if errors.Is(err, pricing.ErrAboveHardCap) {
			code = "above_hard_cap"
		}
		c.AbortWithStatusJSON(http.StatusUnprocessableEntity, gin.H{
			"error": err.Error(), "code": code, "rule_id": ge.RuleID,
			"amount_minor": ge.AmountMinor, "fee_plus_spread_minor": ge.RevenueMinor, "limit_minor": ge.LimitMinor,
		})
	case errors.Is(err, ErrSelfApproval):
		fail(c, http.StatusForbidden, "self_approval_forbidden", "the maker of a change cannot approve or reject it")
	case errors.Is(err, ErrNotFound), errors.Is(err, ErrVersionNotFound):
		fail(c, http.StatusNotFound, "not_found", "not found")
	case errors.Is(err, ErrNotPending):
		fail(c, http.StatusConflict, "not_pending", "change is not pending")
	case errors.Is(err, ErrNotConfigured), errors.Is(err, pricing.ErrNoHardCap):
		fail(c, http.StatusConflict, "guardrails_not_configured", "pricing guardrails are not configured")
	case errors.Is(err, pricing.ErrNoRule):
		fail(c, http.StatusUnprocessableEntity, "no_fee_rule", err.Error())
	case errors.Is(err, pricing.ErrNoCost):
		fail(c, http.StatusUnprocessableEntity, "no_l0_cost", err.Error())
	case errors.Is(err, pricing.ErrAmbiguousRule), errors.Is(err, pricing.ErrAmbiguousCost):
		fail(c, http.StatusUnprocessableEntity, "ambiguous_config", err.Error())
	case errors.Is(err, pricing.ErrInvalidInput), errors.Is(err, pricing.ErrInvalidSchedule), errors.Is(err, pricing.ErrOverflow), errors.Is(err, ErrInvalid):
		fail(c, http.StatusBadRequest, "invalid_request", err.Error())
	default:
		fail(c, http.StatusInternalServerError, "internal", "internal error")
	}
}

func bad(c *gin.Context, msg string) {
	fail(c, http.StatusBadRequest, "invalid_request", msg)
}

// ---- rate card ----------------------------------------------------------

type rateCardReq struct {
	Service     string     `json:"service"`
	Corridor    string     `json:"corridor"`
	Rail        string     `json:"rail"`
	Currency    string     `json:"currency"`
	FlatMinor   int64      `json:"flat_minor"`
	PctBPS      int64      `json:"pct_bps"`
	CostUnknown bool       `json:"cost_unknown"`
	ValidFrom   *time.Time `json:"valid_from"`
	ValidTo     *time.Time `json:"valid_to"`
	SourceRef   string     `json:"source_ref"`
}

func (r rateCardReq) row() (RateCardRow, error) {
	if r.FlatMinor < 0 || r.PctBPS < 0 {
		return RateCardRow{}, fmt.Errorf("%w: cost parameters must be non-negative", ErrInvalid)
	}
	if r.ValidFrom != nil && r.ValidTo != nil && !r.ValidTo.After(*r.ValidFrom) {
		return RateCardRow{}, fmt.Errorf("%w: valid_to must be after valid_from", ErrInvalid)
	}
	return RateCardRow{
		Service: strings.TrimSpace(r.Service), Corridor: strings.ToUpper(strings.TrimSpace(r.Corridor)),
		Rail: strings.TrimSpace(r.Rail), Currency: strings.ToUpper(strings.TrimSpace(r.Currency)),
		FlatMinor: r.FlatMinor, PctBPS: r.PctBPS, CostUnknown: r.CostUnknown,
		ValidFrom: r.ValidFrom, ValidTo: r.ValidTo, SourceRef: strings.TrimSpace(r.SourceRef),
	}, nil
}

func (h *Handler) ListRateCard(c *gin.Context) {
	rows, err := h.store.ListRateCard(c.Request.Context())
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rows})
}

func (h *Handler) CreateRateCard(c *gin.Context) {
	by, ok := h.actor(c)
	if !ok {
		return
	}
	var req rateCardReq
	if err := c.ShouldBindJSON(&req); err != nil {
		bad(c, err.Error())
		return
	}
	row, err := req.row()
	if err != nil {
		writeErr(c, err)
		return
	}
	row.CreatedBy, row.UpdatedBy = by, by
	out, err := h.store.CreateRateCard(c.Request.Context(), row)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) UpdateRateCard(c *gin.Context) {
	by, ok := h.actor(c)
	if !ok {
		return
	}
	var req rateCardReq
	if err := c.ShouldBindJSON(&req); err != nil {
		bad(c, err.Error())
		return
	}
	row, err := req.row()
	if err != nil {
		writeErr(c, err)
		return
	}
	row.ID, row.UpdatedBy = c.Param("id"), by
	out, err := h.store.UpdateRateCard(c.Request.Context(), row)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) ExpireRateCard(c *gin.Context) {
	by, ok := h.actor(c)
	if !ok {
		return
	}
	out, err := h.store.ExpireRateCard(c.Request.Context(), c.Param("id"), by, h.now())
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ---- fee schedule (maker-checker) --------------------------------------

type feeChangeReq struct {
	RuleKey       string     `json:"rule_key"` // set to version an existing rule
	Level         int        `json:"level"`
	SubjectID     string     `json:"subject_id"`
	Service       string     `json:"service"`
	Direction     string     `json:"direction"`
	Corridor      string     `json:"corridor"`
	Rail          string     `json:"rail"`
	Currency      string     `json:"currency"`
	Plan          string     `json:"plan"`
	Tier          string     `json:"tier"`
	AmountMin     int64      `json:"amount_min"`
	AmountMax     int64      `json:"amount_max"`
	FlatMinor     int64      `json:"flat_minor"`
	PctBPS        int64      `json:"pct_bps"`
	MinMinor      int64      `json:"min_minor"`
	MaxMinor      int64      `json:"max_minor"`
	PayerMode     string     `json:"payer_mode"`
	EffectiveFrom *time.Time `json:"effective_from"`
	EffectiveTo   *time.Time `json:"effective_to"`
	Reason        string     `json:"reason"`
}

func (h *Handler) CreateFeeChange(c *gin.Context) {
	maker, ok := h.actor(c)
	if !ok {
		return
	}
	var req feeChangeReq
	if err := c.ShouldBindJSON(&req); err != nil {
		bad(c, err.Error())
		return
	}
	if strings.TrimSpace(req.Reason) == "" {
		bad(c, "reason is required")
		return
	}
	if req.EffectiveFrom == nil {
		bad(c, "effective_from is required")
		return
	}
	if req.EffectiveTo != nil && !req.EffectiveTo.After(*req.EffectiveFrom) {
		bad(c, "effective_to must be after effective_from")
		return
	}
	rec := FeeRuleRecord{
		RuleKey: req.RuleKey, ID: "candidate", Level: req.Level, SubjectID: req.SubjectID,
		Service: strings.TrimSpace(req.Service), Direction: strings.TrimSpace(req.Direction),
		Corridor: strings.ToUpper(strings.TrimSpace(req.Corridor)), Rail: strings.TrimSpace(req.Rail),
		Currency: strings.ToUpper(strings.TrimSpace(req.Currency)), Plan: strings.TrimSpace(req.Plan), Tier: strings.TrimSpace(req.Tier),
		AmountMin: req.AmountMin, AmountMax: req.AmountMax,
		FlatMinor: req.FlatMinor, PctBPS: req.PctBPS, MinMinor: req.MinMinor, MaxMinor: req.MaxMinor,
		PayerMode: strings.TrimSpace(req.PayerMode), EffectiveFrom: req.EffectiveFrom, EffectiveTo: req.EffectiveTo,
		Status: StatusPending, Maker: maker, Reason: strings.TrimSpace(req.Reason),
	}
	// Structural validation through the resolver's own schedule validator.
	if err := (pricing.FeeSchedule{Rules: []pricing.FeeRule{rec.ToFeeRule()}}).Validate(); err != nil {
		writeErr(c, err)
		return
	}
	out, err := h.store.CreateFeeRuleChange(c.Request.Context(), rec)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) ListFeeRules(c *gin.Context) {
	rows, err := h.store.ListFeeRules(c.Request.Context(), c.Query("status"))
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rows})
}

func (h *Handler) GetFeeRule(c *gin.Context) {
	rec, err := h.store.GetFeeRule(c.Request.Context(), c.Param("id"))
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rec})
}

// decide implements approve/reject with the maker-checker rule enforced
// BEFORE the store call (and again inside the store).
func (h *Handler) decide(c *gin.Context, approve bool) {
	checker, ok := h.actor(c)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	rec, err := h.store.GetFeeRule(ctx, c.Param("id"))
	if err != nil {
		writeErr(c, err)
		return
	}
	if strings.EqualFold(strings.TrimSpace(rec.Maker), checker) {
		writeErr(c, ErrSelfApproval)
		return
	}
	if rec.Status != StatusPending {
		writeErr(c, ErrNotPending)
		return
	}
	var out FeeRuleRecord
	if approve {
		cand := rec
		cand.Status, cand.Checker = StatusActive, checker
		if err := (pricing.FeeSchedule{Rules: []pricing.FeeRule{cand.ToFeeRule()}}).Validate(); err != nil {
			writeErr(c, err)
			return
		}
		out, err = h.store.ApproveFeeRule(ctx, rec.ID, checker, h.now())
	} else {
		out, err = h.store.RejectFeeRule(ctx, rec.ID, checker, h.now())
	}
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) ApproveFeeChange(c *gin.Context) { h.decide(c, true) }
func (h *Handler) RejectFeeChange(c *gin.Context)  { h.decide(c, false) }

type rollbackReq struct {
	ToVersion     int        `json:"to_version"`
	Reason        string     `json:"reason"`
	EffectiveFrom *time.Time `json:"effective_from"`
}

// RollbackFeeRule creates a NEW pending version copying a prior version. It is
// itself maker-checker gated (a different admin must approve), so a rollback can
// never be used to bypass the four-eyes rule.
func (h *Handler) RollbackFeeRule(c *gin.Context) {
	maker, ok := h.actor(c)
	if !ok {
		return
	}
	var req rollbackReq
	if err := c.ShouldBindJSON(&req); err != nil || req.ToVersion < 1 || strings.TrimSpace(req.Reason) == "" {
		bad(c, "to_version >= 1 and reason are required")
		return
	}
	eff := h.now()
	if req.EffectiveFrom != nil {
		eff = *req.EffectiveFrom
	}
	out, err := h.store.RollbackFeeRule(c.Request.Context(), c.Param("id"), req.ToVersion, maker, strings.TrimSpace(req.Reason), eff)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

// ---- spread -------------------------------------------------------------

func (h *Handler) GetSpread(c *gin.Context) {
	if h.spread == nil {
		fail(c, http.StatusServiceUnavailable, "unavailable", "spread source unavailable")
		return
	}
	rules, err := h.spread.Rules(c.Request.Context())
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rules})
}

// SpreadDiff is one disagreement between local rules and Verto's config.
type SpreadDiff struct {
	Corridor  string `json:"corridor"`
	Tier      string `json:"tier"`
	LocalBPS  *int   `json:"local_bps"`
	VertoBPS  *int   `json:"verto_bps"`
	Direction string `json:"kind"` // mismatch | only_local | only_verto
}

// DiffSpread compares active local rules against Verto's config.
func DiffSpread(local, verto []SpreadRow) []SpreadDiff {
	l := map[string]SpreadRow{}
	for _, r := range local {
		if r.Active {
			l[spreadKey(r)] = r
		}
	}
	v := map[string]SpreadRow{}
	for _, r := range verto {
		v[spreadKey(r)] = r
	}
	var out []SpreadDiff
	for k, lr := range l {
		lb := lr.BPS
		if vr, ok := v[k]; ok {
			if vr.BPS != lr.BPS {
				vb := vr.BPS
				out = append(out, SpreadDiff{Corridor: lr.Corridor, Tier: lr.Tier, LocalBPS: &lb, VertoBPS: &vb, Direction: "mismatch"})
			}
		} else {
			out = append(out, SpreadDiff{Corridor: lr.Corridor, Tier: lr.Tier, LocalBPS: &lb, Direction: "only_local"})
		}
	}
	for k, vr := range v {
		if _, ok := l[k]; !ok {
			vb := vr.BPS
			out = append(out, SpreadDiff{Corridor: vr.Corridor, Tier: vr.Tier, VertoBPS: &vb, Direction: "only_verto"})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Corridor != out[j].Corridor {
			return out[i].Corridor < out[j].Corridor
		}
		return out[i].Tier < out[j].Tier
	})
	return out
}

func (h *Handler) GetSpreadSync(c *gin.Context) {
	if h.spread == nil {
		fail(c, http.StatusServiceUnavailable, "unavailable", "spread source unavailable")
		return
	}
	ctx := c.Request.Context()
	local, err := h.spread.Rules(ctx)
	if err != nil {
		writeErr(c, err)
		return
	}
	if h.verto == nil {
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"status": "unavailable", "local": local, "diff": []SpreadDiff{}}})
		return
	}
	remote, err := h.verto.MarkupConfig(ctx)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "verto markup config unavailable", "code": "verto_unavailable"})
		return
	}
	diff := DiffSpread(local, remote)
	status := "in_sync"
	if len(diff) > 0 {
		status = "drift"
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"status": status, "local": local, "verto": remote, "diff": diff}})
}

// ---- singleton settings -------------------------------------------------

func (h *Handler) GetGuardrails(c *gin.Context) {
	g, found, err := h.store.GetGuardrails(c.Request.Context())
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": g, "configured": found})
}

func (h *Handler) PutGuardrails(c *gin.Context) {
	by, ok := h.actor(c)
	if !ok {
		return
	}
	var g Guardrails
	if err := c.ShouldBindJSON(&g); err != nil {
		bad(c, err.Error())
		return
	}
	if g.FloorMarginMinor < 0 || g.FloorMarginBPS < 0 || g.HardCapBPS < 0 || g.HardCapMinor < 0 || g.TaxBPS < 0 {
		bad(c, "guardrail values must be non-negative")
		return
	}
	if g.HardCapBPS == 0 && g.HardCapMinor == 0 {
		bad(c, "at least one hard cap (hard_cap_bps or hard_cap_minor) is required")
		return
	}
	out, err := h.store.PutGuardrails(c.Request.Context(), g, by)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

var validStrategies = map[string]bool{"ledger_charge": true, "ngn_wallet": true, "spread_baked": true}

func (h *Handler) GetCollection(c *gin.Context) {
	s, err := h.store.GetCollection(c.Request.Context())
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": s})
}

func (h *Handler) PutCollection(c *gin.Context) {
	by, ok := h.actor(c)
	if !ok {
		return
	}
	var s CollectionSettings
	if err := c.ShouldBindJSON(&s); err != nil {
		bad(c, err.Error())
		return
	}
	if !validStrategies[s.Strategy] {
		bad(c, "strategy must be one of ledger_charge, ngn_wallet, spread_baked")
		return
	}
	if s.SweepIntervalMinutes < 1 || s.SweepThresholdMinor < 0 {
		bad(c, "sweep_interval_minutes must be >= 1 and sweep_threshold_minor >= 0")
		return
	}
	out, err := h.store.PutCollection(c.Request.Context(), s, by)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) GetRefundPolicy(c *gin.Context) {
	p, err := h.store.GetRefundPolicy(c.Request.Context())
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

func (h *Handler) PutRefundPolicy(c *gin.Context) {
	by, ok := h.actor(c)
	if !ok {
		return
	}
	var p RefundPolicy
	if err := c.ShouldBindJSON(&p); err != nil {
		bad(c, err.Error())
		return
	}
	for _, v := range []string{p.OnFailed, p.OnCancelled, p.OnCustomerRefund} {
		if v != "refund" && v != "retain" {
			bad(c, "policy values must be 'refund' or 'retain'")
			return
		}
	}
	out, err := h.store.PutRefundPolicy(c.Request.Context(), p, by)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ---- simulator ----------------------------------------------------------

type simulateReq struct {
	Service          string     `json:"service"`
	Direction        string     `json:"direction"`
	Corridor         string     `json:"corridor"`
	Rail             string     `json:"rail"`
	Plan             string     `json:"plan"`
	Tier             string     `json:"tier"`
	SubjectID        string     `json:"subject_id"`
	AmountMinor      int64      `json:"amount_minor"`
	Currency         string     `json:"currency"`
	FXApplies        bool       `json:"fx_applies"`
	PassthroughMinor int64      `json:"passthrough_minor"`
	At               *time.Time `json:"at"`
}

// SimLine is a serialised quote line.
type SimLine struct {
	Kind        string `json:"kind"`
	Service     string `json:"service"`
	AmountMinor int64  `json:"amount_minor"`
	Currency    string `json:"currency"`
	Payer       string `json:"payer"`
	RuleID      string `json:"rule_id"`
	Visible     bool   `json:"visible"`
}

// SimResult is the simulator output; every figure comes straight from the
// pricing.Quote returned by pricing.Resolve.
type SimResult struct {
	RuleID            string    `json:"rule_id"`
	Currency          string    `json:"currency"`
	Lines             []SimLine `json:"lines"`
	RevenueMinor      int64     `json:"revenue_minor"`
	CostMinor         int64     `json:"cost_minor"`
	EstProfitMinor    int64     `json:"est_profit_minor"`
	MarginBPS         int64     `json:"margin_bps"` // est_profit / revenue, integer bps (0 when revenue is 0)
	SenderPaysMinor   int64     `json:"sender_pays_minor"`
	ReceiverGetsMinor int64     `json:"receiver_gets_minor"`
	PricedAt          time.Time `json:"priced_at"`
}

// SimulateCore builds the resolver from persisted config and calls the SAME
// pricing.Resolve the live quote path uses. Exposed for the 9c wiring and tests.
func (h *Handler) SimulateCore(ctx context.Context, in pricing.PricingInput) (pricing.Decision, error) {
	sched, err := h.store.ActiveFeeSchedule(ctx)
	if err != nil {
		return pricing.Decision{}, err
	}
	rows, err := h.store.ListRateCard(ctx)
	if err != nil {
		return pricing.Decision{}, err
	}
	g, found, err := h.store.GetGuardrails(ctx)
	if err != nil {
		return pricing.Decision{}, err
	}
	if !found {
		return pricing.Decision{}, ErrNotConfigured
	}
	if h.spread == nil {
		return pricing.Decision{}, fmt.Errorf("%w: spread source required", pricing.ErrInvalidInput)
	}
	src, err := h.spread.Source(ctx)
	if err != nil {
		return pricing.Decision{}, err
	}
	rs, err := pricing.NewResolver(sched, src, BuildRateCard(rows, in.At),
		pricing.Guardrails{FloorMarginMinor: g.FloorMarginMinor, FloorMarginBPS: g.FloorMarginBPS, HardCapBPS: g.HardCapBPS, HardCapMinor: g.HardCapMinor},
		g.TaxBPS)
	if err != nil {
		return pricing.Decision{}, err
	}
	return rs.Resolve(ctx, in)
}

func (h *Handler) Simulate(c *gin.Context) {
	var req simulateReq
	if err := c.ShouldBindJSON(&req); err != nil {
		bad(c, err.Error())
		return
	}
	at := h.now()
	if req.At != nil {
		at = *req.At
	}
	in := pricing.PricingInput{
		Service: req.Service, Direction: req.Direction, Corridor: strings.ToUpper(req.Corridor), Rail: req.Rail,
		Plan: req.Plan, Tier: req.Tier, SubjectID: req.SubjectID,
		Amount:    pricing.NewMoney(req.AmountMinor, req.Currency),
		FXApplies: req.FXApplies, PassthroughMinor: req.PassthroughMinor, At: at,
	}
	dec, err := h.SimulateCore(c.Request.Context(), in)
	if err != nil {
		writeErr(c, err)
		return
	}
	q := dec.Quote
	res := SimResult{
		RuleID: q.RuleID(), Currency: q.Revenue().Currency,
		RevenueMinor: q.Revenue().AmountMinor, CostMinor: q.Cost().AmountMinor,
		EstProfitMinor: q.EstProfit().AmountMinor, MarginBPS: marginBPS(q.EstProfit().AmountMinor, q.Revenue().AmountMinor),
		SenderPaysMinor: q.SenderPays().AmountMinor, ReceiverGetsMinor: q.ReceiverGets().AmountMinor,
		PricedAt: q.PricedAt(),
	}
	for _, l := range q.Lines() {
		res.Lines = append(res.Lines, SimLine{
			Kind: string(l.Kind), Service: l.Service, AmountMinor: l.Amount.AmountMinor, Currency: l.Amount.Currency,
			Payer: string(l.Payer), RuleID: l.RuleID, Visible: l.Visible,
		})
	}
	c.JSON(http.StatusOK, gin.H{"data": res})
}

// marginBPS = profit*10000/revenue in exact integer arithmetic (floor toward
// zero), computed with big.Int so a large amount cannot overflow int64.
func marginBPS(profit, revenue int64) int64 {
	if revenue <= 0 {
		return 0
	}
	n := new(big.Int).Mul(big.NewInt(profit), big.NewInt(10000))
	n.Quo(n, big.NewInt(revenue))
	if !n.IsInt64() {
		return 0
	}
	return n.Int64()
}
