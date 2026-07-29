package signals

import "math"

// Side is a candidate's direction.
type Side string

const (
	Long  Side = "long"
	Short Side = "short"
)

// Candidate is a PROPOSED setup — never an order. It carries a deterministic
// confidence and a suggested protective-stop distance, plus a structured rationale
// for explainability (§15). The risk package turns confidence + stop into a size
// (or a veto); the committee selects among candidates. This type deliberately has
// NO size, price, or quantity field.
type Candidate struct {
	Strategy        string
	Asset           string
	Side            Side
	ConfidenceBps   int64    // deterministic signal strength, 0..10000
	StopDistanceBps int64    // suggested stop distance in bps of price
	Rationale       []string // human-readable evidence, for the explanation record
}

// confFromMagnitude maps a non-negative signal magnitude to a confidence in bps,
// linearly saturating at `scale` (magnitude >= scale → 10000). Deterministic and
// clamped; a non-finite or non-positive magnitude → 0.
func confFromMagnitude(magnitude, scale float64) int64 {
	if !finite(magnitude) || magnitude <= 0 || scale <= 0 {
		return 0
	}
	c := magnitude / scale
	if c > 1 {
		c = 1
	}
	return int64(math.Round(c * 10_000))
}
