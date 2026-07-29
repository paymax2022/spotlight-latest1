package risk

import "fmt"

// Hard limit checks (§8) — the RISK VETO. CheckLimits returns every breach a
// proposed trade would cause against the fund's limits and current state. A
// NON-EMPTY result is an ABSOLUTE block: it is never a soft warning and cannot be
// overridden by consensus (§5). Fails CLOSED: bad equity or an unknown-risk input
// is itself a breach.

// ProposedTrade is a candidate the sizing layer produced, presented to the veto.
type ProposedTrade struct {
	Asset        string
	Side         Side
	NotionalKobo int64
	ConfidenceBps Bps
}

// TradeContext carries the non-position inputs the veto needs: the proposed trade,
// whether the current time is inside the allowed trading window (computed by the
// caller so this package stays clock-free), and the correlated-asset clusters the
// correlated-risk guard evaluates.
type TradeContext struct {
	Trade               ProposedTrade
	WithinTradingWindow bool
	Clusters            [][]string // e.g. [][]string{{"BTC","ETH"},{"EURUSD","GBPUSD"}}
}

// CheckLimits returns all violated hard limits for opening tc.Trade on top of st.
// Empty slice == cleared. The proposed trade's notional is included in the
// forward-looking exposure/leverage/position-count checks.
func CheckLimits(st PortfolioState, lim Limits, tc TradeContext) []Breach {
	var b []Breach
	t := tc.Trade

	// Fail-closed preconditions.
	if st.EquityKobo <= 0 {
		return []Breach{{Code: "NO_EQUITY", Detail: "equity is non-positive — trading blocked"}}
	}
	if t.NotionalKobo < 0 {
		b = append(b, Breach{Code: "BAD_SIZE", Detail: "proposed notional is negative"})
	}

	// Realized loss windows (a loss is negative realized P&L).
	if lim.MaxDailyLossKobo > 0 && -st.RealizedTodayKobo >= lim.MaxDailyLossKobo {
		b = append(b, breach("MAX_DAILY_LOSS", -st.RealizedTodayKobo, lim.MaxDailyLossKobo))
	}
	if lim.MaxWeeklyLossKobo > 0 && -st.RealizedWeekKobo >= lim.MaxWeeklyLossKobo {
		b = append(b, breach("MAX_WEEKLY_LOSS", -st.RealizedWeekKobo, lim.MaxWeeklyLossKobo))
	}
	if lim.MaxMonthlyLossKobo > 0 && -st.RealizedMonthKobo >= lim.MaxMonthlyLossKobo {
		b = append(b, breach("MAX_MONTHLY_LOSS", -st.RealizedMonthKobo, lim.MaxMonthlyLossKobo))
	}

	// Drawdown.
	if lim.MaxDrawdownBps > 0 {
		if dd := CurrentDrawdownBps(st); dd >= lim.MaxDrawdownBps {
			b = append(b, breach("MAX_DRAWDOWN", int64(dd), int64(lim.MaxDrawdownBps)))
		}
	}

	// Position count (the new position adds one).
	if lim.MaxOpenPositions > 0 && st.OpenPositionCount+1 > lim.MaxOpenPositions {
		b = append(b, breach("MAX_OPEN_POSITIONS", int64(st.OpenPositionCount+1), int64(lim.MaxOpenPositions)))
	}

	// Single-position caps.
	if lim.MaxPositionKobo > 0 && t.NotionalKobo > lim.MaxPositionKobo {
		b = append(b, breach("MAX_POSITION_SIZE", t.NotionalKobo, lim.MaxPositionKobo))
	}
	if lim.MaxPositionFracBps > 0 {
		capKobo := floorKobo(float64(st.EquityKobo) * lim.MaxPositionFracBps.Frac())
		if t.NotionalKobo > capKobo {
			b = append(b, breach("MAX_POSITION_FRACTION", t.NotionalKobo, capKobo))
		}
	}

	// Forward gross leverage (existing gross + new notional).
	if lim.MaxGrossLeverageBps > 0 {
		fwdGross := GrossExposureKobo(st) + t.NotionalKobo
		fwdLevBps := Bps(ceilKobo(float64(fwdGross) / float64(st.EquityKobo) * 10_000))
		if fwdLevBps > lim.MaxGrossLeverageBps {
			b = append(b, breach("MAX_GROSS_LEVERAGE", int64(fwdLevBps), int64(lim.MaxGrossLeverageBps)))
		}
	}

	// Correlated-cluster exposure (existing cluster exposure + new notional if the
	// asset is in that cluster) vs the correlated-fraction cap.
	if lim.MaxCorrelatedFracBps > 0 {
		capKobo := floorKobo(float64(st.EquityKobo) * lim.MaxCorrelatedFracBps.Frac())
		for _, cluster := range tc.Clusters {
			if !contains(cluster, t.Asset) {
				continue
			}
			fwd := ClusterExposureKobo(st, cluster) + t.NotionalKobo
			if fwd > capKobo {
				b = append(b, breach("MAX_CORRELATED_EXPOSURE", fwd, capKobo))
				break
			}
		}
	}

	// Minimum confidence.
	if lim.MinConfidenceBps > 0 && t.ConfidenceBps < lim.MinConfidenceBps {
		b = append(b, breach("MIN_CONFIDENCE", int64(t.ConfidenceBps), int64(lim.MinConfidenceBps)))
	}

	// Allowed-asset allowlist (when set).
	if len(lim.AllowedAssets) > 0 && !contains(lim.AllowedAssets, t.Asset) {
		b = append(b, Breach{Code: "ASSET_NOT_ALLOWED", Detail: fmt.Sprintf("asset %q is not in the allowed set", t.Asset)})
	}

	// Trading window.
	if !tc.WithinTradingWindow {
		b = append(b, Breach{Code: "OUTSIDE_TRADING_HOURS", Detail: "current time is outside the allowed trading window"})
	}

	return b
}

func breach(code string, got, limit int64) Breach {
	return Breach{Code: code, Detail: fmt.Sprintf("%s: %d exceeds limit %d", code, got, limit)}
}

func contains(xs []string, v string) bool {
	for _, x := range xs {
		if x == v {
			return true
		}
	}
	return false
}
