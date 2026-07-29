package risk

import "fmt"

// Circuit breakers (§8): trip on abnormal loss rate, abnormal fills/slippage, data
// anomalies, or a volatility spike. A tripped breaker forces defensive mode / halt
// upstream — it is a HARD signal, evaluated deterministically. Breakers exist at
// strategy/asset/venue/global scope; this evaluates one scope's inputs against its
// config and returns every tripped breaker.

// CircuitInputs are the observed conditions for one scope over the recent window.
type CircuitInputs struct {
	ConsecutiveLosses  int   // consecutive losing trades
	RecentLossRateBps  Bps   // fraction of recent trades that lost (bps)
	ObservedSlippageBps Bps  // realized slippage on recent fills
	VolSpikeRatioBps   Bps   // current vol / baseline vol (10000 = 1.0x)
	DataStale          bool  // price/feature feed is stale or failed validation
	PriceAnomaly       bool  // a bad-print / sanity-check failure was seen
}

// CircuitConfig are the trip thresholds. A zero threshold disables that breaker
// (except the boolean data/price breakers, which always trip when true).
type CircuitConfig struct {
	MaxConsecutiveLosses int
	MaxLossRateBps       Bps
	MaxSlippageBps       Bps
	MaxVolSpikeBps       Bps
}

// EvalCircuitBreakers returns every tripped breaker for the given inputs. A
// non-empty result means new trading in this scope must stop and defensive mode
// engages. Data/price anomalies ALWAYS trip (fail-closed: never trade on suspect
// data, §9).
func EvalCircuitBreakers(in CircuitInputs, cfg CircuitConfig) []Breach {
	var b []Breach
	if in.DataStale {
		b = append(b, Breach{Code: "DATA_STALE", Detail: "market data stale or failed validation"})
	}
	if in.PriceAnomaly {
		b = append(b, Breach{Code: "PRICE_ANOMALY", Detail: "price sanity check failed (bad print / outlier)"})
	}
	if cfg.MaxConsecutiveLosses > 0 && in.ConsecutiveLosses >= cfg.MaxConsecutiveLosses {
		b = append(b, breach("CONSECUTIVE_LOSSES", int64(in.ConsecutiveLosses), int64(cfg.MaxConsecutiveLosses)))
	}
	if cfg.MaxLossRateBps > 0 && in.RecentLossRateBps >= cfg.MaxLossRateBps {
		b = append(b, breach("LOSS_RATE", int64(in.RecentLossRateBps), int64(cfg.MaxLossRateBps)))
	}
	if cfg.MaxSlippageBps > 0 && in.ObservedSlippageBps >= cfg.MaxSlippageBps {
		b = append(b, breach("ABNORMAL_SLIPPAGE", int64(in.ObservedSlippageBps), int64(cfg.MaxSlippageBps)))
	}
	if cfg.MaxVolSpikeBps > 0 && in.VolSpikeRatioBps >= cfg.MaxVolSpikeBps {
		b = append(b, breach("VOL_SPIKE", int64(in.VolSpikeRatioBps), int64(cfg.MaxVolSpikeBps)))
	}
	return b
}

// Tripped reports whether any breaker fired.
func Tripped(breaches []Breach) bool { return len(breaches) > 0 }

// String renders a breach for logs / explanations.
func (b Breach) String() string { return fmt.Sprintf("%s(%s)", b.Code, b.Detail) }
