package nutrition

import (
	"context"
	"strings"
)

// offfeed.go — Tier-0 label/barcode source. An interface (with a deterministic
// mock default) so the engine never hard-depends on the network. The live
// implementation would call Open Food Facts (or read an on-pack label OCR
// result); when no lookup is wired, BarcodeLookup is nil and Tier 0 is skipped.

// LabelLookup resolves a barcode to an EXACT per-serving label profile. The live
// adapter queries Open Food Facts; the mock serves a tiny fixture set. Returns
// (result, true, nil) on a hit, (zero, false, nil) on a clean miss, or an error.
type LabelLookup interface {
	// Lookup returns the on-pack per-serving nutrition for a barcode. The serving
	// size (g) comes from the label, not the caller.
	Lookup(ctx context.Context, barcode string) (LabelResult, bool, error)
}

// LabelResult is a Tier-0 EXACT per-serving label read.
type LabelResult struct {
	Barcode      string     `json:"barcode"`
	ProductName  string     `json:"product_name"`
	PortionSizeG float64    `json:"portion_size_g"`
	PerServing   PerServing `json:"per_serving"` // EXACT (low=high=value)
}

// MockLabelLookup is a deterministic, dependency-free LabelLookup for dev/CI. It
// serves a handful of packaged-product fixtures and treats any barcode beginning
// "000" as a forced miss (so tests can exercise the Tier-0 → Tier-1 fall-through).
type MockLabelLookup struct{}

// NewMockLabelLookup builds the in-memory mock label source.
func NewMockLabelLookup() *MockLabelLookup { return &MockLabelLookup{} }

// mockLabelFixtures — tiny packaged-product set keyed by barcode.
var mockLabelFixtures = map[string]LabelResult{
	"6154000110015": { // illustrative: a packaged drink
		Barcode:      "6154000110015",
		ProductName:  "Packaged Malt Drink 330ml",
		PortionSizeG: 330,
		PerServing: PerServing{
			NutEnergyKcal: exact(198),
			NutProtein:    exact(1.6),
			NutCarb:       exact(46.0),
			NutSugar:      exact(44.0),
			NutFat:        exact(0.0),
			NutSatFat:     exact(0.0),
			NutFiber:      exact(0.0),
			NutSodium:     exact(40),
		},
	},
	"5449000000996": { // illustrative: a packaged snack
		Barcode:      "5449000000996",
		ProductName:  "Packaged Biscuits 50g",
		PortionSizeG: 50,
		PerServing: PerServing{
			NutEnergyKcal: exact(240),
			NutProtein:    exact(3.0),
			NutCarb:       exact(33.0),
			NutSugar:      exact(12.0),
			NutFat:        exact(10.5),
			NutSatFat:     exact(5.0),
			NutFiber:      exact(1.0),
			NutSodium:     exact(150),
		},
	},
}

// Lookup serves a fixture barcode, a forced miss for "000…", else a clean miss.
func (m *MockLabelLookup) Lookup(_ context.Context, barcode string) (LabelResult, bool, error) {
	barcode = strings.TrimSpace(barcode)
	if barcode == "" || strings.HasPrefix(barcode, "000") {
		return LabelResult{}, false, nil
	}
	if r, ok := mockLabelFixtures[barcode]; ok {
		return r, true, nil
	}
	return LabelResult{}, false, nil
}
