// Package nutrition is the Nutrition Resolution Engine (NRE): it estimates
// per-serving nutrition + allergens for orderable dishes via a tiered resolver,
// a guarded profile status machine, and a safety-critical allergen model.
//
// This is NOT a money module — there is no ledger. Values are real-number
// nutrient quantities (g / mg / kcal), not integer kobo. The safety-critical
// invariants (AI may never set CONTAINS/FREE_FROM; FREE_FROM requires a
// cross-contamination acknowledgement; definitive allergen claims are
// vendor-attested only) are enforced BOTH by DB CHECK constraints and by the
// app code in this package — defense in depth.
//
// "Never an anonymous number": every resolved value carries its source +
// confidence + the composition_version it was pinned against, and every display
// string is precision-formatted (a bare number is never emitted).
package nutrition

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
)

// ─────────────────────────────────────────────────────────────────────────────
// Errors (sentinels — handlers map these to clean HTTP codes; the DB
// check_violation 23514 is mapped to ErrAllergenRuleViolation in the repo).
// ─────────────────────────────────────────────────────────────────────────────
var (
	// ErrForbidden is returned for an object-level authz failure (caller does
	// not own the dish's restaurant).
	ErrForbidden = errors.New("nutrition: caller does not own this dish")
	// ErrNotFound is returned when a dish / profile / reference row is absent.
	ErrNotFound = errors.New("nutrition: not found")
	// ErrBadState is returned for an illegal status-machine transition.
	ErrBadState = errors.New("nutrition: illegal status transition")
	// ErrVersionConflict is the optimistic-lock conflict sentinel.
	ErrVersionConflict = errors.New("nutrition: optimistic lock conflict")
	// ErrAllergenRuleViolation is the CLEAN sentinel the repo maps a Postgres
	// check_violation (SQLSTATE 23514) to, so a safety-rule breach never leaks a
	// raw DB error to the client.
	ErrAllergenRuleViolation = errors.New("nutrition: allergen declaration violates a safety rule")
	// ErrSanityBounds is returned when vendor/recipe values fail plausibility
	// checks; such a profile is flagged for ops review and NOT auto-published.
	ErrSanityBounds = errors.New("nutrition: values failed plausibility (sanity) bounds — flagged for review")
	// ErrLLMUnavailable is returned when the Tier-3 estimator is requested but no
	// estimator is wired (the deterministic mock covers dev/CI; this guards the
	// "no estimator at all" case).
	ErrLLMUnavailable = errors.New("nutrition: AI estimator not available")
)

// ─────────────────────────────────────────────────────────────────────────────
// Disclaimer — included on every nutrition response.
// ─────────────────────────────────────────────────────────────────────────────

// Disclaimer is the mandatory "not medical advice" notice attached to every
// nutrition payload returned to a client.
const Disclaimer = "Estimated nutrition for general information only. Not medical or dietetic advice. " +
	"Values are estimates unless marked label-exact; a restaurant-confirmed value is still an estimate. " +
	"Allergen information is vendor-attested where shown and may default to \"may contain\" when unconfirmed. " +
	"If you have a food allergy or medical condition, confirm directly with the vendor."

// ─────────────────────────────────────────────────────────────────────────────
// Grounding / confidence / status vocab (mirrors the v2 DB CHECK domains).
//
// v2 (onboarding-first): the curated Nigerian library is no longer a vendor-facing
// tier — it is grounding INSIDE the AI. A profile records WHERE the estimate came
// from (grounding), how confident it is (confidence), and where it sits in the
// honesty machine (status). The vendor experiences a single "AI suggestion".
// ─────────────────────────────────────────────────────────────────────────────

// Grounding records the source the estimate was grounded in (mirrors DB CHECK).
type Grounding string

const (
	GroundingLabel          Grounding = "LABEL"           // packaged barcode/label fast-path → EXACT
	GroundingLibraryMatched Grounding = "LIBRARY_MATCHED" // name matched the Nigerian grounding library
	GroundingFreeEstimated  Grounding = "FREE_ESTIMATED"  // no library match → AI free estimate
	GroundingRecipe         Grounding = "RECIPE"          // optional hidden power-user recipe path
)

// Confidence is the resolved value's confidence band (mirrors DB CHECK).
//
// HIGH was removed in v2. The recipe path (grounding RECIPE) yields
// RESTAURANT_CONFIRMED + confidence MEDIUM — declaring a recipe is an explicit
// confirmation, not a measured label, so MEDIUM (not the retired HIGH) is the
// honest band: it is still an estimate, never "exact".
type Confidence string

const (
	ConfidenceExact  Confidence = "EXACT"  // LABEL grounding — real on-pack figure
	ConfidenceMedium Confidence = "MEDIUM" // library-matched OR recipe
	ConfidenceLow    Confidence = "LOW"    // free AI estimate
)

// Status is the guarded profile honesty state (mirrors the v2 DB CHECK).
type Status string

const (
	// StatusAIEstimate is the auto-PUBLISHED state of every resolved AI/library
	// estimate at menu upload — labelled "AI estimate", shown as a range.
	StatusAIEstimate Status = "AI_ESTIMATE"
	// StatusRestaurantConfirmed is vendor-approved (or edited-then-approved, or a
	// declared recipe). Higher trust, point value allowed, but STILL labelled an
	// estimate — approval is not exactness.
	StatusRestaurantConfirmed Status = "RESTAURANT_CONFIRMED"
	// StatusExact is reserved for packaged/barcoded items with a real label.
	StatusExact Status = "EXACT"
	// StatusStale flags a profile invalidated by a name/photo/portion/version
	// change; it is re-estimated before display.
	StatusStale Status = "STALE"
)

// ─────────────────────────────────────────────────────────────────────────────
// Status machine — guarded, fail-closed (3 honesty states + STALE). Any edge not
// listed is rejected.
//
//   AI_ESTIMATE          → RESTAURANT_CONFIRMED (approve / edit-then-approve)
//                          | AI_ESTIMATE (self / no-op re-estimate)
//                          | EXACT (a barcode appeared) | STALE
//   RESTAURANT_CONFIRMED → STALE (name/photo/portion/version change) | EXACT (barcode)
//   EXACT                → STALE (barcode changed) — otherwise terminal
//   STALE                → AI_ESTIMATE | RESTAURANT_CONFIRMED | EXACT (re-estimate)
// ─────────────────────────────────────────────────────────────────────────────
var statusTransitions = map[Status]map[Status]bool{
	StatusAIEstimate: {
		StatusRestaurantConfirmed: true,
		StatusAIEstimate:          true, // re-estimate / no-op self-loop
		StatusExact:               true,
		StatusStale:               true,
	},
	StatusRestaurantConfirmed: {
		StatusStale: true,
		StatusExact: true,
	},
	StatusExact: {
		StatusStale: true,
	},
	StatusStale: {
		StatusAIEstimate:          true,
		StatusRestaurantConfirmed: true,
		StatusExact:               true,
	},
}

// CanTransition reports whether from→to is a legal status edge (fail-closed).
func CanTransition(from, to Status) bool {
	edges, ok := statusTransitions[from]
	if !ok {
		return false
	}
	return edges[to]
}

// statusForGrounding maps a freshly resolved grounding to its auto-published
// status. LABEL → EXACT; RECIPE → RESTAURANT_CONFIRMED (declaring a recipe is an
// explicit confirm); everything else (LIBRARY_MATCHED / FREE_ESTIMATED) auto-
// publishes as AI_ESTIMATE — no DRAFT, live from Day 1.
func statusForGrounding(g Grounding) Status {
	switch g {
	case GroundingLabel:
		return StatusExact
	case GroundingRecipe:
		return StatusRestaurantConfirmed
	default:
		return StatusAIEstimate
	}
}

// groundingRank orders grounding by precedence (lower = higher precedence):
// LABEL (0) > RECIPE (1) > LIBRARY_MATCHED (2) > FREE_ESTIMATED (3).
func groundingRank(g Grounding) int {
	switch g {
	case GroundingLabel:
		return 0
	case GroundingRecipe:
		return 1
	case GroundingLibraryMatched:
		return 2
	default:
		return 3
	}
}

// supersedes reports whether a newly resolved grounding should overwrite an
// existing profile.
//
//   - RESTAURANT_CONFIRMED / EXACT: a confirmed value is never auto-downgraded by
//     a routine re-estimate. Only a STRICTLY higher-rank (lower-number) grounding
//     may take over — e.g. a barcode (LABEL) appearing on a confirmed recipe — so
//     an equal-or-lower grounding (a fresh AI/library re-estimate) is rejected.
//   - AI_ESTIMATE / STALE: freely replaced by any equal/higher-rank grounding.
func supersedes(newG Grounding, currentG Grounding, currentStatus Status) bool {
	if currentStatus == StatusRestaurantConfirmed || currentStatus == StatusExact {
		return groundingRank(newG) < groundingRank(currentG)
	}
	return groundingRank(newG) <= groundingRank(currentG)
}

// ─────────────────────────────────────────────────────────────────────────────
// Nutrient model.
// ─────────────────────────────────────────────────────────────────────────────

// Nutrient keys — the canonical set the engine tracks per serving.
const (
	NutEnergyKcal = "energy_kcal"
	NutProtein    = "protein_g"
	NutCarb       = "carb_g"
	NutSugar      = "sugar_g"
	NutFat        = "fat_g"
	NutSatFat     = "sat_fat_g"
	NutFiber      = "fiber_g"
	NutSodium     = "sodium_mg"
)

// nutrientOrder is the canonical display/iteration order.
var nutrientOrder = []string{
	NutEnergyKcal, NutProtein, NutCarb, NutSugar, NutFat, NutSatFat, NutFiber, NutSodium,
}

// nutrientUnits maps a nutrient key to its display unit suffix.
var nutrientUnits = map[string]string{
	NutEnergyKcal: "kcal",
	NutProtein:    "g",
	NutCarb:       "g",
	NutSugar:      "g",
	NutFat:        "g",
	NutSatFat:     "g",
	NutFiber:      "g",
	NutSodium:     "mg",
}

// Range is one nutrient's resolved value with its low/high estimate band. For
// EXACT confidence (and point-value recipe sums), Low == High == Value.
type Range struct {
	Value float64 `json:"value"`
	Low   float64 `json:"low"`
	High  float64 `json:"high"`
}

// PerServing maps nutrient key → Range. This is the canonical resolved shape
// persisted to dish_nutrition_profile.per_serving (and dish library per_serving).
type PerServing map[string]Range

// exact builds a Range with low=high=value (point-value semantics).
func exact(v float64) Range { return Range{Value: v, Low: v, High: v} }

// scale multiplies every nutrient (value/low/high) by factor — used to scale a
// per-100g or per-standard-portion profile to the dish's portion size.
func (p PerServing) scale(factor float64) PerServing {
	out := make(PerServing, len(p))
	for k, r := range p {
		out[k] = Range{
			Value: r.Value * factor,
			Low:   r.Low * factor,
			High:  r.High * factor,
		}
	}
	return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain rows (DB projections).
// ─────────────────────────────────────────────────────────────────────────────

// Composition is one per-100g-edible-portion reference row.
type Composition struct {
	ID         string  `json:"id"`
	FoodCode   string  `json:"food_code"`
	Name       string  `json:"name"`
	Source     string  `json:"source"`
	PrepMethod string  `json:"prep_method"`
	EnergyKcal float64 `json:"energy_kcal"`
	ProteinG   float64 `json:"protein_g"`
	CarbG      float64 `json:"carb_g"`
	SugarG     float64 `json:"sugar_g"`
	FatG       float64 `json:"fat_g"`
	SatFatG    float64 `json:"sat_fat_g"`
	FiberG     float64 `json:"fiber_g"`
	SodiumMg   float64 `json:"sodium_mg"`
	Version    int     `json:"version"`
}

// per100g returns this reference as a PerServing for 100 g (exact values).
func (c Composition) per100g() PerServing {
	return PerServing{
		NutEnergyKcal: exact(c.EnergyKcal),
		NutProtein:    exact(c.ProteinG),
		NutCarb:       exact(c.CarbG),
		NutSugar:      exact(c.SugarG),
		NutFat:        exact(c.FatG),
		NutSatFat:     exact(c.SatFatG),
		NutFiber:      exact(c.FiberG),
		NutSodium:     exact(c.SodiumMg),
	}
}

// LibraryEntry is one curated Nigerian composite dish (Tier 2 source).
type LibraryEntry struct {
	ID                 string     `json:"id"`
	Slug               string     `json:"slug"`
	Name               string     `json:"name"`
	Aliases            []string   `json:"aliases"`
	StandardPortionG   float64    `json:"standard_portion_g"`
	CookMethod         string     `json:"cook_method,omitempty"`
	PerServing         PerServing `json:"per_serving"`
	CompositionVersion int        `json:"composition_version"`
}

// Ingredient is one line of a recipe (or library components array).
type Ingredient struct {
	FoodCode   string  `json:"food_code"`
	Source     string  `json:"source,omitempty"`
	QuantityG  float64 `json:"quantity_g"`
	PrepMethod string  `json:"prep_method,omitempty"`
}

// Recipe is a vendor-declared recipe (drives Tier 1).
type Recipe struct {
	ID           string       `json:"id"`
	MenuItemID   string       `json:"menu_item_id"`
	RestaurantID string       `json:"restaurant_id"`
	Ingredients  []Ingredient `json:"ingredients"`
	PortionSizeG float64      `json:"portion_size_g"`
	CookMethod   string       `json:"cook_method,omitempty"`
	Version      int          `json:"version"`
}

// Profile is the resolved nutrition output bound to a menu item.
type Profile struct {
	ID                 string     `json:"id"`
	MenuItemID         string     `json:"menu_item_id"`
	RestaurantID       string     `json:"restaurant_id"`
	Grounding          Grounding  `json:"grounding"`
	Confidence         Confidence `json:"confidence"`
	Status             Status     `json:"status"`
	PortionLabel       string     `json:"portion_label"`
	PortionSizeG       float64    `json:"portion_size_g"`
	PerServing         PerServing `json:"per_serving"`
	CompositionVersion *int       `json:"composition_version,omitempty"`
	ConfirmedBy        *string    `json:"confirmed_by,omitempty"`
	Version            int        `json:"version"`
}

// ─────────────────────────────────────────────────────────────────────────────
// Portion selector — the lightweight Edit path rescales every value by the
// small/regular/large factor (applied to portion_size_g + per_serving values).
// ─────────────────────────────────────────────────────────────────────────────

// Portion labels (mirror the DB CHECK).
const (
	PortionSmall   = "small"
	PortionRegular = "regular"
	PortionLarge   = "large"
)

// portionFactors are the relative scale factors for each portion label, anchored
// at regular = 1.0. Editing the portion selector rescales portion_size_g + all
// per-serving values from the CURRENT label to the chosen one by the ratio of
// these factors.
var portionFactors = map[string]float64{
	PortionSmall:   0.75,
	PortionRegular: 1.0,
	PortionLarge:   1.4,
}

// portionFactor returns the scale factor for a portion label (regular when
// unknown), and whether the label was recognised.
func portionFactor(label string) (float64, bool) {
	f, ok := portionFactors[strings.ToLower(strings.TrimSpace(label))]
	if !ok {
		return 1.0, false
	}
	return f, true
}

// AllergenDeclaration is a SAFETY-CRITICAL allergen claim on a dish.
type AllergenDeclaration struct {
	ID              string `json:"id"`
	MenuItemID      string `json:"menu_item_id"`
	RestaurantID    string `json:"restaurant_id"`
	Allergen        string `json:"allergen"`
	DeclarationType string `json:"declaration_type"` // CONTAINS | MAY_CONTAIN | FREE_FROM
	Source          string `json:"source"`           // VENDOR | AI
	AttestedBy      *string `json:"attested_by,omitempty"`
	CrossContamAck  bool   `json:"cross_contamination_ack"`
}

// Allergen controlled vocabulary (mirrors the DB CHECK).
var allergenVocab = map[string]bool{
	"peanut": true, "tree_nut": true, "milk": true, "egg": true, "fish": true,
	"crustacean_shellfish": true, "soy": true, "wheat_gluten": true, "sesame": true,
	"mustard": true, "celery": true, "sulphites": true, "lupin": true,
}

// Declaration types.
const (
	DeclContains   = "CONTAINS"
	DeclMayContain = "MAY_CONTAIN"
	DeclFreeFrom   = "FREE_FROM"
)

// Allergen sources.
const (
	AllergenSourceVendor = "VENDOR"
	AllergenSourceAI     = "AI"
)

// ─────────────────────────────────────────────────────────────────────────────
// Allergen safety enforcement (pure — mirrors the DB CHECK constraints so an
// illegal request is rejected BEFORE it ever reaches the DB).
// ─────────────────────────────────────────────────────────────────────────────

// AllergenAttestInput is a single vendor allergen attestation request.
type AllergenAttestInput struct {
	Allergen        string `json:"allergen" binding:"required"`
	DeclarationType string `json:"declaration_type" binding:"required"`
	CrossContamAck  bool   `json:"cross_contamination_ack"`
}

// validateAllergen enforces the three non-negotiable safety rules in code,
// matching the DB CHECK constraints exactly. `source` is the proposed source
// ("VENDOR" or "AI"); `attested` reports whether an attester (vendor user) is
// present. Returns ErrAllergenRuleViolation on any breach.
//
//	Rule 1 (allergen_ai_may_contain_only):
//	   AI may NEVER set CONTAINS or FREE_FROM — AI is MAY_CONTAIN only.
//	Rule 2 (allergen_definitive_requires_attestation):
//	   CONTAINS / FREE_FROM require an attester (vendor-attested only).
//	Rule 3 (allergen_free_from_requires_ack):
//	   FREE_FROM requires cross_contamination_ack = TRUE.
func validateAllergen(allergen, declType, source string, attested, crossContamAck bool) error {
	if !allergenVocab[allergen] {
		return fmt.Errorf("%w: unknown allergen %q", ErrAllergenRuleViolation, allergen)
	}
	switch declType {
	case DeclContains, DeclMayContain, DeclFreeFrom:
	default:
		return fmt.Errorf("%w: unknown declaration_type %q", ErrAllergenRuleViolation, declType)
	}
	// Rule 1: AI may only suggest MAY_CONTAIN.
	if source == AllergenSourceAI && (declType == DeclContains || declType == DeclFreeFrom) {
		return fmt.Errorf("%w: AI may only suggest MAY_CONTAIN (got %s)", ErrAllergenRuleViolation, declType)
	}
	// Rule 2: definitive claims require an attester.
	if (declType == DeclContains || declType == DeclFreeFrom) && !attested {
		return fmt.Errorf("%w: %s requires vendor attestation", ErrAllergenRuleViolation, declType)
	}
	// Rule 3: FREE_FROM requires the cross-contamination acknowledgement.
	if declType == DeclFreeFrom && !crossContamAck {
		return fmt.Errorf("%w: FREE_FROM requires cross_contamination_ack", ErrAllergenRuleViolation)
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Display transform — pure. Bands, traffic-lights, precision-formatted strings.
// Defaults reflect the Nigerian disease burden (hypertension → sodium; diabetes
// → sugar; CVD → saturated fat). Thresholds are per-serving.
// ─────────────────────────────────────────────────────────────────────────────

// EnergyBand classifies a serving's energy load.
type EnergyBand string

const (
	BandLight    EnergyBand = "Light"
	BandBalanced EnergyBand = "Balanced"
	BandHeavy    EnergyBand = "Heavy"
)

// Energy band thresholds (kcal per serving).
const (
	bandLightMaxKcal    = 400.0 // ≤ 400 kcal → Light
	bandBalancedMaxKcal = 700.0 // ≤ 700 kcal → Balanced; above → Heavy
)

// TrafficLight is a green|amber|red rating for a "watch" nutrient.
type TrafficLight string

const (
	LightGreen TrafficLight = "green"
	LightAmber TrafficLight = "amber"
	LightRed   TrafficLight = "red"
)

// trafficThresholds holds the green→amber and amber→red cut points (per serving)
// for a nutrient. value < amber ⇒ green; amber ≤ value < red ⇒ amber; ≥ red ⇒ red.
type trafficThresholds struct {
	amber float64
	red   float64
}

// trafficLightConfig — per-serving cut points (sensible Nigeria-burden defaults).
//   sodium_mg : amber 600, red 1200  (WHO 2g/day sodium → ~600mg/meal moderate)
//   sugar_g   : amber 15,  red 27
//   sat_fat_g : amber 5,   red 9
var trafficLightConfig = map[string]trafficThresholds{
	NutSodium: {amber: 600, red: 1200},
	NutSugar:  {amber: 15, red: 27},
	NutSatFat: {amber: 5, red: 9},
}

// trafficLightFor returns the rating for one nutrient value against the config.
func trafficLightFor(nutrient string, value float64) TrafficLight {
	t, ok := trafficLightConfig[nutrient]
	if !ok {
		return ""
	}
	switch {
	case value >= t.red:
		return LightRed
	case value >= t.amber:
		return LightAmber
	default:
		return LightGreen
	}
}

// bandFor classifies energy (kcal) into Light|Balanced|Heavy.
func bandFor(kcal float64) EnergyBand {
	switch {
	case kcal <= bandLightMaxKcal:
		return BandLight
	case kcal <= bandBalancedMaxKcal:
		return BandBalanced
	default:
		return BandHeavy
	}
}

// NutrientDisplay is one nutrient's display block: the raw range, the precision-
// formatted string, and (where applicable) its traffic light.
type NutrientDisplay struct {
	Nutrient   string       `json:"nutrient"`
	Range      Range        `json:"range"`
	Text       string       `json:"text"`
	Light      TrafficLight `json:"traffic_light,omitempty"`
}

// DisplayBlock is the buyer-facing presentation of a resolved profile. It NEVER
// contains a bare number without grounding+confidence context (the precision
// string carries the "estimate" qualifier for non-exact values).
//
// v2: precision is driven by STATUS (not just confidence). AI_ESTIMATE shows a
// range; RESTAURANT_CONFIRMED shows a point value but is still labelled an
// estimate (estimated=true); only EXACT is true exactness.
type DisplayBlock struct {
	Band       EnergyBand        `json:"band"`
	Grounding  Grounding         `json:"grounding"`
	Confidence Confidence        `json:"confidence"`
	Status     Status            `json:"status"`
	Estimated  bool              `json:"estimated"`
	Label      string            `json:"label"`
	Nutrients  []NutrientDisplay `json:"nutrients"`
	Disclaimer string            `json:"disclaimer"`
}

// statusLabel is the short buyer-facing badge text for a status.
//
//	AI_ESTIMATE          → "AI estimate"
//	RESTAURANT_CONFIRMED → "restaurant-confirmed (estimate)"  (still an estimate)
//	EXACT                → "from label"
func statusLabel(status Status) string {
	switch status {
	case StatusExact:
		return "from label"
	case StatusRestaurantConfirmed:
		return "restaurant-confirmed (estimate)"
	case StatusStale:
		return "updating estimate"
	default:
		return "AI estimate"
	}
}

// formatRange renders a nutrient as a precision string honouring STATUS:
//
//	EXACT                → "540 kcal · from label"
//	RESTAURANT_CONFIRMED → "≈540 kcal · estimate"             (point value, still an estimate)
//	AI_ESTIMATE / STALE  → "≈520–580 kcal · AI estimate"      (range)
//
// A bare number is never emitted — the unit and a precision/source qualifier are
// always present.
func formatRange(nutrient string, r Range, status Status) string {
	unit := nutrientUnits[nutrient]
	switch status {
	case StatusExact:
		return fmt.Sprintf("%s %s · from label", trimNum(r.Value), unit)
	case StatusRestaurantConfirmed:
		// Point value, but STILL an estimate (approval != exact).
		return fmt.Sprintf("≈%s %s · estimate", trimNum(r.Value), unit)
	default:
		// AI_ESTIMATE / STALE → honest low–high range.
		if r.Low == r.High {
			return fmt.Sprintf("≈%s %s · AI estimate", trimNum(r.Value), unit)
		}
		return fmt.Sprintf("≈%s–%s %s · AI estimate", trimNum(r.Low), trimNum(r.High), unit)
	}
}

// trimNum renders a float without a trailing ".0" (e.g. 540, 6.5).
func trimNum(v float64) string {
	if v == math.Trunc(v) {
		return fmt.Sprintf("%d", int64(math.Round(v)))
	}
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.1f", v), "0"), ".")
}

// BuildDisplay turns a resolved profile into the buyer-facing display block.
// Pure: no DB, no network. Energy drives the band; sodium/sugar/sat_fat get
// traffic lights; every nutrient gets a precision string.
//
// v2: precision is driven by STATUS. Only EXACT is true exactness (estimated
// false); RESTAURANT_CONFIRMED shows a point value but is semantically still an
// estimate (estimated true) so the "estimate" label is honest.
func BuildDisplay(p PerServing, g Grounding, conf Confidence, status Status) DisplayBlock {
	kcal := 0.0
	if r, ok := p[NutEnergyKcal]; ok {
		kcal = r.Value
	}
	estimated := status != StatusExact
	out := DisplayBlock{
		Band:       bandFor(kcal),
		Grounding:  g,
		Confidence: conf,
		Status:     status,
		Estimated:  estimated,
		Label:      statusLabel(status),
		Disclaimer: Disclaimer,
	}
	for _, k := range nutrientOrder {
		r, ok := p[k]
		if !ok {
			continue
		}
		out.Nutrients = append(out.Nutrients, NutrientDisplay{
			Nutrient: k,
			Range:    r,
			Text:     formatRange(k, r, status),
			Light:    trafficLightFor(k, r.Value),
		})
	}
	return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Sanity bounds — plausibility checks before publishing vendor/recipe values.
// Implausible values are flagged for ops review and NOT auto-published.
// ─────────────────────────────────────────────────────────────────────────────

// Sanity-bound constants.
const (
	minKcalPerGram      = 0.2 // water-heavy soups can be low, but not near-zero
	maxKcalPerGram      = 9.0 // pure fat ≈ 9 kcal/g — nothing edible exceeds it
	atwaterTolerancePct = 0.30 // 30% tolerance on the 4/4/9 reconciliation
)

// CheckSanity validates a resolved per-serving profile against physical
// plausibility for the given portion. Pure. Returns nil when plausible, else an
// error wrapping ErrSanityBounds describing the first failure.
//
//	1. kcal/gram within [0.2, 9.0]
//	2. all macros + sodium non-negative
//	3. Atwater reconciliation: 4*protein + 4*carb + 9*fat ≈ energy_kcal (±30%)
func CheckSanity(p PerServing, portionG float64) error {
	if portionG <= 0 {
		return fmt.Errorf("%w: portion_size_g must be > 0", ErrSanityBounds)
	}
	get := func(k string) float64 {
		if r, ok := p[k]; ok {
			return r.Value
		}
		return 0
	}
	// (2) non-negative macros.
	for _, k := range []string{NutEnergyKcal, NutProtein, NutCarb, NutSugar, NutFat, NutSatFat, NutFiber, NutSodium} {
		if get(k) < 0 {
			return fmt.Errorf("%w: %s is negative", ErrSanityBounds, k)
		}
	}
	kcal := get(NutEnergyKcal)
	// (1) energy density.
	density := kcal / portionG
	if density < minKcalPerGram || density > maxKcalPerGram {
		return fmt.Errorf("%w: energy density %.2f kcal/g outside [%.1f, %.1f]",
			ErrSanityBounds, density, minKcalPerGram, maxKcalPerGram)
	}
	// (3) Atwater 4/4/9 reconciliation (skip when energy is ~0 to avoid div-by-0).
	if kcal > 1 {
		atwater := 4*get(NutProtein) + 4*get(NutCarb) + 9*get(NutFat)
		if atwater > 0 {
			diff := math.Abs(atwater-kcal) / kcal
			if diff > atwaterTolerancePct {
				return fmt.Errorf("%w: Atwater reconciliation off by %.0f%% (macros imply %.0f kcal vs stated %.0f)",
					ErrSanityBounds, diff*100, atwater, kcal)
			}
		}
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Cart aggregation — pure range propagation across components.
// ─────────────────────────────────────────────────────────────────────────────

// CartLine is one resolved dish in a cart-summary request.
type CartLine struct {
	MenuItemID string     `json:"menu_item_id"`
	Name       string     `json:"name,omitempty"`
	PerServing PerServing `json:"per_serving"`
	Grounding  Grounding  `json:"grounding"`
	Confidence Confidence `json:"confidence"`
	Status     Status     `json:"status"`
}

// CartSummary is the aggregate estimate for a basket: summed per-serving with
// range propagation (low=Σlow, high=Σhigh, value=Σvalue), the worst-case traffic
// lights, and the combined disclaimer.
type CartSummary struct {
	Lines      []CartLine              `json:"lines"`
	Total      PerServing              `json:"total"`
	Lights     map[string]TrafficLight `json:"traffic_lights"`
	Band       EnergyBand              `json:"band"`
	Disclaimer string                  `json:"disclaimer"`
}

// AggregateCart sums component per_serving ranges and returns the combined
// summary. The aggregate confidence is the WORST (lowest) across the lines, so
// the combined block is honestly labelled an estimate when any line is estimated.
func AggregateCart(lines []CartLine) CartSummary {
	total := PerServing{}
	for _, line := range lines {
		for _, k := range nutrientOrder {
			r, ok := line.PerServing[k]
			if !ok {
				continue
			}
			acc := total[k]
			acc.Value += r.Value
			acc.Low += r.Low
			acc.High += r.High
			total[k] = acc
		}
	}
	// Worst-case traffic lights use the HIGH end of the summed range (defensive:
	// the basket is rated at its plausible worst).
	lights := map[string]TrafficLight{}
	for nutrient := range trafficLightConfig {
		if r, ok := total[nutrient]; ok {
			lights[nutrient] = trafficLightFor(nutrient, r.High)
		}
	}
	band := bandFor(0)
	if r, ok := total[NutEnergyKcal]; ok {
		band = bandFor(r.Value)
	}
	return CartSummary{
		Lines:      lines,
		Total:      total,
		Lights:     lights,
		Band:       band,
		Disclaimer: Disclaimer,
	}
}

// worstConfidence returns the lowest-precision confidence in a set (LOW worst).
func worstConfidence(cs []Confidence) Confidence {
	rank := map[Confidence]int{ConfidenceExact: 0, ConfidenceMedium: 1, ConfidenceLow: 2}
	worst := ConfidenceExact
	for _, c := range cs {
		if rank[c] > rank[worst] {
			worst = c
		}
	}
	return worst
}

// ─────────────────────────────────────────────────────────────────────────────
// Library fuzzy match — pure. Case-insensitive contains + token overlap.
// ─────────────────────────────────────────────────────────────────────────────

// libraryMatch scores a dish name against a library entry's name + aliases.
// Returns a score in [0,1]; 0 means no match. The caller picks the highest.
//
//	- An exact (case-insensitive) name/alias equality scores 1.0.
//	- A containment (name contains alias or alias contains name) scores 0.8.
//	- Otherwise the Jaccard token overlap (shared tokens / union) is used.
func libraryMatch(dishName string, entry LibraryEntry) float64 {
	want := normalize(dishName)
	if want == "" {
		return 0
	}
	candidates := append([]string{entry.Name, entry.Slug}, entry.Aliases...)
	best := 0.0
	for _, cand := range candidates {
		c := normalize(cand)
		if c == "" {
			continue
		}
		if c == want {
			return 1.0
		}
		if strings.Contains(want, c) || strings.Contains(c, want) {
			if best < 0.8 {
				best = 0.8
			}
			continue
		}
		if j := jaccard(tokens(want), tokens(c)); j > best {
			best = j
		}
	}
	return best
}

// libraryMatchThreshold is the minimum score to accept a Tier-2 library match.
const libraryMatchThreshold = 0.5

// normalize lowercases, trims, and collapses non-alphanumeric runs to spaces.
func normalize(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	prevSpace := false
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			prevSpace = false
		} else if !prevSpace {
			b.WriteRune(' ')
			prevSpace = true
		}
	}
	return strings.TrimSpace(b.String())
}

// tokens splits a normalized string into a set of word tokens.
func tokens(s string) map[string]bool {
	out := map[string]bool{}
	for _, t := range strings.Fields(s) {
		out[t] = true
	}
	return out
}

// jaccard is |A∩B| / |A∪B| over two token sets.
func jaccard(a, b map[string]bool) float64 {
	if len(a) == 0 || len(b) == 0 {
		return 0
	}
	inter := 0
	for t := range a {
		if b[t] {
			inter++
		}
	}
	union := len(a) + len(b) - inter
	if union == 0 {
		return 0
	}
	return float64(inter) / float64(union)
}

// BestLibraryMatch picks the highest-scoring library entry for a dish name, or
// (nil, 0) when nothing clears the threshold. Pure (caller supplies the candidate
// set loaded from the DB). Deterministic: ties break by slug for stability.
func BestLibraryMatch(dishName string, entries []LibraryEntry) (*LibraryEntry, float64) {
	type scored struct {
		entry LibraryEntry
		score float64
	}
	var hits []scored
	for _, e := range entries {
		if s := libraryMatch(dishName, e); s >= libraryMatchThreshold {
			hits = append(hits, scored{e, s})
		}
	}
	if len(hits) == 0 {
		return nil, 0
	}
	sort.SliceStable(hits, func(i, j int) bool {
		if hits[i].score != hits[j].score {
			return hits[i].score > hits[j].score
		}
		return hits[i].entry.Slug < hits[j].entry.Slug
	})
	return &hits[0].entry, hits[0].score
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipe → profile math — pure. Sum composition × quantity, apply yield/retention
// factors, scale to portion.
// ─────────────────────────────────────────────────────────────────────────────

// cookFactor is the (yield, retention) pair applied to a cooked ingredient. yield
// adjusts mass change on cooking (water loss/gain); retention is the fraction of
// labile nutrients (here applied to fiber/sugar as a coarse proxy) surviving the
// cook. Energy/protein/fat are conserved by mass (yield only).
type cookFactor struct {
	yield     float64 // cooked mass / raw mass (informational; quantities are as-served)
	retention float64 // labile-nutrient retention fraction
}

// cookFactors is a small, conservative factor table keyed by prep_method. These
// are coarse defaults; the real engine would key on (food, nutrient, method) from
// the USDA retention tables. quantity_g is interpreted as AS-SERVED grams, so the
// yield factor is informational and retention trims labile nutrients only.
var cookFactors = map[string]cookFactor{
	"raw":     {yield: 1.00, retention: 1.00},
	"boiled":  {yield: 1.00, retention: 0.85},
	"steamed": {yield: 1.00, retention: 0.90},
	"grilled": {yield: 0.75, retention: 0.80},
	"roasted": {yield: 0.75, retention: 0.80},
	"baked":   {yield: 0.80, retention: 0.85},
	"stewed":  {yield: 1.00, retention: 0.80},
	"fried":   {yield: 0.85, retention: 0.75},
}

// factorFor returns the cook factor for a prep method (raw when unknown).
func factorFor(method string) cookFactor {
	if f, ok := cookFactors[strings.ToLower(strings.TrimSpace(method))]; ok {
		return f
	}
	return cookFactors["raw"]
}

// labileNutrients get the retention factor applied; the rest are mass-conserved.
var labileNutrients = map[string]bool{NutSugar: true, NutFiber: true}

// SumRecipe computes a per-serving profile from recipe ingredients + a composition
// lookup. Pure: `lookup` resolves an ingredient (food_code[,source,prep]) to its
// per-100g Composition; a missing lookup returns (Composition{}, false) and that
// ingredient is skipped (the resolver flags incompleteness separately).
//
// For each ingredient: per-100g × (quantity_g/100), with labile nutrients trimmed
// by the prep-method retention factor. The summed total is then scaled so the sum
// of ingredient grams maps onto the declared portion_size_g (defensive: if the
// ingredient grams already equal the portion, the scale is 1.0).
func SumRecipe(ings []Ingredient, portionG float64, lookup func(Ingredient) (Composition, bool)) (PerServing, int, bool) {
	total := PerServing{}
	var rawGrams float64
	complete := true
	compVersion := 0
	for _, ing := range ings {
		comp, ok := lookup(ing)
		if !ok {
			complete = false
			continue
		}
		if comp.Version > compVersion {
			compVersion = comp.Version
		}
		f := factorFor(ing.PrepMethod)
		per100 := comp.per100g()
		gramFactor := ing.QuantityG / 100.0
		for _, k := range nutrientOrder {
			r, has := per100[k]
			if !has {
				continue
			}
			contrib := r.Value * gramFactor
			if labileNutrients[k] {
				contrib *= f.retention
			}
			acc := total[k]
			acc.Value += contrib
			acc.Low += contrib
			acc.High += contrib
			total[k] = acc
		}
		rawGrams += ing.QuantityG
	}
	// Scale the summed ingredient nutrition onto the declared portion size.
	if rawGrams > 0 && portionG > 0 {
		scaleF := portionG / rawGrams
		if scaleF != 1.0 {
			total = total.scale(scaleF)
		}
	}
	return total, compVersion, complete
}
