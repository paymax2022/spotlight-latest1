// Package backtest is a deterministic, EVENT-DRIVEN backtester for the quant core
// (§11). It steps bar-by-bar; a decision made at bar i uses ONLY data up to bar i
// and FILLS at bar i+1 — so there is no look-ahead in either the decision or the
// fill. Costs (fees, slippage/market-impact, funding) are modelled CONSERVATIVELY:
// optimistic cost assumptions are the #1 cause of live underperformance, so the
// simulator errs pessimistic. Pure and reproducible: same inputs → same result.
//
// This is offline research only — it never touches the fund, the ledger, or a
// venue. A strategy earns real capital only by climbing the §12 promotion ladder.
package backtest

// Bps is a rate in basis points (1 bp = 0.01%).
type Bps int64

func (b Bps) Frac() float64 { return float64(b) / 10_000.0 }

// Dir is the desired position direction from a decision.
type Dir string

const (
	Flat Dir = "flat"
	Long Dir = "long"
	Short Dir = "short"
)

// Target is what a decision wants the position to BE at a bar (not an order): a
// direction, a notional in kobo (0 with Flat), and a protective-stop distance.
// The engine diffs this against the current position and executes the change.
type Target struct {
	Dir             Dir
	NotionalKobo    int64
	StopDistanceBps Bps
}

// DecisionFunc is the strategy under test. It receives the bar index and the price
// history UP TO AND INCLUDING that bar (prices[:i+1]) — never the future — and
// returns the desired position. In production this callback wraps
// regime-classify → signals → risk.Screen; here it is injected so the engine is
// testable in isolation.
type DecisionFunc func(i int, pricesSoFar []float64) Target

// Config parameterizes a run. Costs are all conservative/pessimistic.
type Config struct {
	StartEquityKobo int64
	FeeBps          Bps   // per-side taker fee
	SlippageBps     Bps   // base adverse slippage per fill
	ImpactBps       Bps   // extra slippage proportional to participation (size/ADV)
	ADVKobo         int64 // average daily volume proxy for impact (0 ⇒ no impact term)
	FundingBpsPerBar Bps  // perp funding cost charged on notional each bar held
	Warmup          int   // bars to skip before trading (indicator warmup)
	PeriodsPerYear  float64 // annualization factor (e.g. 365 for daily crypto)
}

// Trade is one round-trip (entry→exit) with its realized economics.
type Trade struct {
	Dir          Dir
	EntryPrice   float64
	ExitPrice    float64
	NotionalKobo int64
	PnLKobo      int64 // net of costs
	CostKobo     int64 // fees + slippage + funding attributed to this trade
	ExitReason   string // "signal" | "stop" | "end"
}

// Result is the full backtest output.
type Result struct {
	EquityCurveKobo []int64
	Trades          []Trade
	TotalCostKobo   int64
	Metrics         Metrics
}

// Metrics are the risk-adjusted performance measures (§11). Risk-adjusted and
// drawdown-aware measures outrank raw return.
type Metrics struct {
	FinalEquityKobo int64
	ReturnBps       Bps     // total return over the run
	CAGRBps         Bps     // annualized
	SharpeBps       Bps     // annualized Sharpe * 10000 (so 12000 = 1.2)
	SortinoBps      Bps
	CalmarBps       Bps
	MaxDrawdownBps  Bps
	UlcerIndexBps   Bps
	ProfitFactorBps Bps     // grossProfit/grossLoss * 10000
	WinRateBps      Bps
	ExpectancyKobo  int64   // mean trade P&L
	TailRatioBps    Bps
	TurnoverBps     Bps     // traded notional / avg equity
	CostDragBps     Bps     // total costs / start equity
	NumTrades       int
}
