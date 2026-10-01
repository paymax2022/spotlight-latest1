package nutrition

import (
	"context"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"strings"
)

// ai.go — Tier-3 AI estimator. Mirrors the estate ainotes injection pattern: a
// narrow LLMGenerator interface (satisfied by *llm.Client) wired via WithLLM,
// with a deterministic mock used when the client is nil/disabled so the engine
// stays runnable (and unit-testable) without a live API key.
// SAFETY: the AI estimator produces NUTRITION estimates only (with a wide
// low/high band, confidence LOW). It NEVER produces a definitive allergen claim
// — any allergen output is treated as a MAY_CONTAIN suggestion (source=AI), and
// the allergen safety rules (validateAllergen) reject anything stronger.

// LLMGenerator is the narrow slice of the LLM client this package needs.
// Satisfied by *llm.Client (integrations/llm). Kept as an interface so the
// package stays decoupled and the JSON path is unit-testable with a stub.
type LLMGenerator interface {
	Enabled() bool
	Model() string
	GenerateJSON(ctx context.Context, systemPrompt, userPrompt string) (json.RawMessage, error)
}

// aiSystemPrompt constrains the model to emit ONLY strict JSON in the per-serving
// shape, with an explicit low/high band and a forbidden-from-allergens note.
const aiSystemPrompt = `You are a food nutrition estimator for Nigerian restaurant dishes. ` +
	`Given a dish name, description and serving size in grams, estimate the per-serving nutrition. ` +
	`Respond with ONLY valid JSON, no markdown, in EXACTLY this shape:
{
  "per_serving": {
    "energy_kcal": {"value": 0, "low": 0, "high": 0},
    "protein_g":   {"value": 0, "low": 0, "high": 0},
    "carb_g":      {"value": 0, "low": 0, "high": 0},
    "sugar_g":     {"value": 0, "low": 0, "high": 0},
    "fat_g":       {"value": 0, "low": 0, "high": 0},
    "sat_fat_g":   {"value": 0, "low": 0, "high": 0},
    "fiber_g":     {"value": 0, "low": 0, "high": 0},
    "sodium_mg":   {"value": 0, "low": 0, "high": 0}
  }
}
Rules: every nutrient MUST have value, low and high (low <= value <= high), reflecting genuine ` +
	`estimation uncertainty (a wide band is expected). Use realistic Nigerian-cuisine values for the ` +
	`stated portion. Do NOT output allergen claims, prose, or any field outside per_serving.`

// aiEstimateParsed is the strict shape expected back from the model.
type aiEstimateParsed struct {
	PerServing map[string]Range `json:"per_serving"`
}

// parseAIEstimate validates the model output and returns a normalized PerServing.
// Pure (no DB / no network) so the contract is unit-testable. It enforces
// low<=value<=high (clamping a malformed band rather than trusting it blindly)
// and drops any non-canonical nutrient keys.
func parseAIEstimate(raw json.RawMessage) (PerServing, error) {
	var p aiEstimateParsed
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, fmt.Errorf("nutrition: AI output not in expected shape: %w", err)
	}
	if len(p.PerServing) == 0 {
		return nil, fmt.Errorf("nutrition: AI output missing per_serving")
	}
	out := PerServing{}
	for _, k := range nutrientOrder {
		r, ok := p.PerServing[k]
		if !ok {
			continue
		}
		// Normalize the band: low <= value <= high.
		if r.Low > r.Value {
			r.Low = r.Value
		}
		if r.High < r.Value {
			r.High = r.Value
		}
		if r.Value < 0 {
			r.Value, r.Low, r.High = 0, 0, 0
		}
		out[k] = r
	}
	if _, ok := out[NutEnergyKcal]; !ok {
		return nil, fmt.Errorf("nutrition: AI output missing energy_kcal")
	}
	return out, nil
}

// mockEstimate produces a DETERMINISTIC, plausible AI estimate with a wide band.
// Used when no LLM is wired or it is disabled, so the engine resolves end-to-end
// in dev/CI. Determinism comes from hashing the dish name (same dish → same
// numbers), and the values scale with the portion so the band is realistic.
// The bands are intentionally WIDE (±~18%) to honestly reflect Tier-3 LOW
// confidence. The macro split is tuned so the result passes CheckSanity (4/4/9
// reconciliation + energy density), making the mock safe to publish-test.
func mockEstimate(dishName string, portionG float64) PerServing {
	if portionG <= 0 {
		portionG = 350
	}
	// Deterministic per-dish energy density in [1.2, 2.4] kcal/g.
	h := fnv.New32a()
	_, _ = h.Write([]byte(normalize(dishName)))
	seed := h.Sum32()
	density := 1.2 + float64(seed%120)/100.0 // 1.20 .. 2.39 kcal/g
	kcal := density * portionG

	// Macro energy split (protein/carb/fat) that reconciles to kcal via 4/4/9.
	// Choose proportions, then back out grams so 4p+4c+9f == kcal exactly.
	pPct, cPct, fPct := 0.18, 0.52, 0.30 // % of energy from protein/carb/fat
	protein := (kcal * pPct) / 4.0
	carb := (kcal * cPct) / 4.0
	fat := (kcal * fPct) / 9.0
	sugar := carb * 0.12
	satFat := fat * 0.30
	fiber := carb * 0.06
	sodium := 2.6 * portionG // ~mg; restaurant dishes are sodium-heavy

	band := func(v float64) Range {
		return Range{Value: round1(v), Low: round1(v * 0.82), High: round1(v * 1.18)}
	}
	return PerServing{
		NutEnergyKcal: band(kcal),
		NutProtein:    band(protein),
		NutCarb:       band(carb),
		NutSugar:      band(sugar),
		NutFat:        band(fat),
		NutSatFat:     band(satFat),
		NutFiber:      band(fiber),
		NutSodium:     band(sodium),
	}
}

// round1 rounds to one decimal place.
func round1(v float64) float64 {
	return float64(int64(v*10+0.5)) / 10.0
}

// Tier-0 label/barcode source. An interface (with a deterministic
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
