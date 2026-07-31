package trading

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/trading/ladder"
	"spotlight/backend/internal/trading/quant/committee"
	"spotlight/backend/internal/trading/quant/pipeline"
	"spotlight/backend/internal/trading/quant/regime"
	"spotlight/backend/internal/trading/quant/risk"
)

// paperEquityKobo is the notional equity a paper evaluation is sized against
// (₦1,000,000). It is a display/sizing basis only — no real cash is involved.
const paperEquityKobo = 100_000_000

// serverPolicy returns the risk, ladder, circuit, and committee configuration for
// an evaluation. CRITICAL: this comes ENTIRELY from the server, never the request
// body — a caller must never be able to weaken its own risk limits, quorum, or
// drawdown ladder. The client supplies only market data.
func serverPolicy() (risk.Limits, risk.DrawdownLadderConfig, risk.CircuitConfig, committee.Config, risk.Bps) {
	limits := risk.Limits{
		MaxDailyLossKobo: 5_000_000, MaxWeeklyLossKobo: 12_000_000, MaxMonthlyLossKobo: 25_000_000,
		MaxDrawdownBps: 2000, MaxOpenPositions: 5, MaxPositionKobo: 30_000_000,
		MaxPositionFracBps: 2500, MaxGrossLeverageBps: 15_000, MaxCorrelatedFracBps: 6000,
		MinConfidenceBps: 6000, AllowedAssets: []string{"BTC", "ETH", "EURUSD", "GBPUSD"},
	}
	ldr := risk.DrawdownLadderConfig{ReduceAtBps: 500, HedgeAtBps: 1000, FlatAtBps: 1500, HaltAtBps: 2000}
	circuit := risk.CircuitConfig{MaxConsecutiveLosses: 5, MaxLossRateBps: 6000, MaxSlippageBps: 50, MaxVolSpikeBps: 30_000}
	comm := committee.Config{QuorumBps: 6000, MinConfidenceBps: 6000, RequireSupervisor: true}
	return limits, ldr, circuit, comm, 1000 // target vol 10%
}

func returnsFrom(prices []float64) []float64 {
	if len(prices) < 2 {
		return nil
	}
	r := make([]float64, 0, len(prices)-1)
	for i := 1; i < len(prices); i++ {
		if prices[i-1] == 0 {
			r = append(r, 0)
			continue
		}
		r = append(r, (prices[i]-prices[i-1])/prices[i-1])
	}
	return r
}

// ── Member: decision pipeline (read-only; records nothing, executes nothing) ────

// Evaluate runs the deterministic pipeline for a strategy on client-supplied market
// data and returns the decision + reasoning trace. It is gated by Module-KYC access
// AND the strategy's ladder stage (must be Paper or above). Risk/committee config is
// SERVER-fixed. It never places an order — the response is explicitly labelled
// executed:false because this build has no venue adapter.
func (h *Handler) Evaluate(c *gin.Context) {
	var body struct {
		StrategyID       string    `json:"strategy_id"`
		Asset            string    `json:"asset"`
		Prices           []float64 `json:"prices"`
		LiquidityScoreBps int64    `json:"liquidity_score_bps"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	if strings.TrimSpace(body.StrategyID) == "" || strings.TrimSpace(body.Asset) == "" || len(body.Prices) < 30 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "strategy_id, asset, and >=30 prices required"})
		return
	}
	ctx := c.Request.Context()

	// Gate 1: the caller must hold Module-KYC trading access.
	access, err := h.kyc.HasTradingAccess(ctx, uid(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	if !access {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "Module-KYC approval required", "code": "MODULE_KYC_REQUIRED"})
		return
	}
	// Gate 2: the strategy must be on the ladder at Paper or above.
	stage, ok, err := h.promo.Evaluable(ctx, body.StrategyID)
	if err != nil {
		httpErr(c, err)
		return
	}
	if !ok {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "strategy not eligible for evaluation (stage " + string(stage) + ")", "code": "STRATEGY_NOT_ELIGIBLE"})
		return
	}

	limits, ldr, circuit, comm, targetVol := serverPolicy()
	rets := returnsFrom(body.Prices)
	res := pipeline.Evaluate(pipeline.Inputs{
		Asset: body.Asset, Prices: body.Prices, Returns: rets,
		BaselineVolBps: regime.RealizedVolBps(rets), LiquidityScoreBps: regime.Bps(body.LiquidityScoreBps),
		RegimeConfig: regime.DefaultConfig(),
		State:        risk.PortfolioState{EquityKobo: paperEquityKobo, PeakEquityKobo: paperEquityKobo},
		Limits:       limits, Ladder: ldr, CircuitConfig: circuit,
		WithinWindow: true, TargetVolBps: targetVol, Committee: comm,
	})

	c.JSON(http.StatusOK, gin.H{
		"success":  true,
		"stage":    string(stage),
		"executed": false, // no venue adapter in this build — eligibility/paper only
		"note":     "decision only; no order was placed",
		"regime":   res.Regime.Regime,
		"approved": res.Approved,
		"reason":   res.Reason,
		"order":    res.Final,
	})
}

// ── Member: strategy-maturity transparency (read-only, sanitized) ────────────────

// Strategies returns the sanitized promotion ladder for member transparency (§12):
// which strategies run the fund and at what validated maturity. No governance
// internals (verdict/track-record/circuit/maker-checker/audit) are exposed.
func (h *Handler) Strategies(c *gin.Context) {
	rows, err := h.promo.PublicList(c.Request.Context())
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": rows})
}

// ── Admin: promotion ladder (§12) ───────────────────────────────────────────────

func (h *Handler) AdminPromoteRegister(c *gin.Context) {
	if err := h.promo.Register(c.Request.Context(), c.Param("id")); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "stage": ladder.StageNotPromoted})
}

func (h *Handler) AdminPromoteList(c *gin.Context) {
	rows, err := h.promo.List(c.Request.Context())
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": rows})
}

func (h *Handler) AdminPromoteGet(c *gin.Context) {
	st, err := h.promo.Get(c.Request.Context(), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	evs, err := h.promo.Events(c.Request.Context(), c.Param("id"), 50)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "strategy": st, "events": evs})
}

// AdminPromote — the authenticated admin is the CHECKER; maker_id (body) must
// differ (two-person). Risk/legal sign-off flags are required for Canary→Live and
// enforced by the ladder gate. The validation verdict + track record come from the
// strategy record, not the request.
func (h *Handler) AdminPromote(c *gin.Context) {
	var body struct {
		ToStage      string `json:"to_stage"`
		MakerID      string `json:"maker_id"`
		RiskSignedOff  bool `json:"risk_signed_off"`
		LegalSignedOff bool `json:"legal_signed_off"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	st, err := h.promo.Promote(c.Request.Context(), uid(c), c.Param("id"), ladder.Stage(body.ToStage), body.MakerID, body.RiskSignedOff, body.LegalSignedOff)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "stage": st.Stage})
}

func (h *Handler) AdminDemote(c *gin.Context) {
	var body struct {
		ToStage string `json:"to_stage"`
		Reason  string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	st, err := h.promo.Demote(c.Request.Context(), uid(c), c.Param("id"), ladder.Stage(body.ToStage), body.Reason)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "stage": st.Stage})
}

func (h *Handler) AdminHalt(c *gin.Context) {
	var body struct{ Reason string `json:"reason"` }
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	st, err := h.promo.Halt(c.Request.Context(), uid(c), c.Param("id"), body.Reason)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "stage": st.Stage})
}

// AdminReadiness records the latest validation verdict + track-record days (and
// circuit state) — the inputs a promotion is judged on. Never changes the stage.
func (h *Handler) AdminReadiness(c *gin.Context) {
	var body struct {
		ValidationPassed bool `json:"validation_passed"`
		TrackRecordDays  int  `json:"track_record_days"`
		CircuitTripped   bool `json:"circuit_tripped"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	st, err := h.promo.SetReadiness(c.Request.Context(), uid(c), c.Param("id"), body.ValidationPassed, body.TrackRecordDays, body.CircuitTripped)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "strategy": st})
}
