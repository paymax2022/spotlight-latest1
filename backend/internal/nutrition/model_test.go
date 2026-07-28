package nutrition

import (
	"encoding/json"
	"math"
	"testing"
)

// These tests are PURE (no DB, no network). They cover the safety-critical and
// math-critical logic of the v2 NRE: the 3-state honesty machine, grounding
// supersede order, recipe math, library fuzzy match, AI mock band, allergen
// safety rules, display labels/precision/traffic-lights, portion rescale factors,
// cart range propagation, and sanity-bound rejection.

func approx(a, b, tol float64) bool { return math.Abs(a-b) <= tol }

// ── Status machine: legal + illegal transitions (v2 3-state + STALE) ──────────

func TestCanTransition_Legal(t *testing.T) {
	legal := [][2]Status{
		{StatusAIEstimate, StatusRestaurantConfirmed}, // approve / edit
		{StatusAIEstimate, StatusAIEstimate},          // re-estimate / no-op self-loop
		{StatusAIEstimate, StatusExact},               // barcode appeared
		{StatusAIEstimate, StatusStale},
		{StatusRestaurantConfirmed, StatusStale},
		{StatusRestaurantConfirmed, StatusExact},
		{StatusExact, StatusStale},
		{StatusStale, StatusAIEstimate},
		{StatusStale, StatusRestaurantConfirmed},
		{StatusStale, StatusExact},
	}
	for _, e := range legal {
		if !CanTransition(e[0], e[1]) {
			t.Errorf("expected %s → %s to be legal", e[0], e[1])
		}
	}
}

func TestCanTransition_Illegal(t *testing.T) {
	illegal := [][2]Status{
		{StatusExact, StatusAIEstimate},               // never auto-downgrade label
		{StatusRestaurantConfirmed, StatusAIEstimate}, // confirmed never silently regresses
		{StatusExact, StatusRestaurantConfirmed},
		{StatusAIEstimate, "BOGUS"},
		{"BOGUS", StatusAIEstimate},
	}
	for _, e := range illegal {
		if CanTransition(e[0], e[1]) {
			t.Errorf("expected %s → %s to be ILLEGAL", e[0], e[1])
		}
	}
}

// ── Grounding supersede order (no auto-downgrade of confirmed/exact) ──────────

func TestSupersedes(t *testing.T) {
	// Higher precedence (lower rank) supersedes a lower one on an estimate.
	if !supersedes(GroundingLibraryMatched, GroundingFreeEstimated, StatusAIEstimate) {
		t.Error("library-matched should supersede a free-estimated AI_ESTIMATE")
	}
	// A worse grounding does NOT replace a better estimate.
	if supersedes(GroundingFreeEstimated, GroundingLibraryMatched, StatusAIEstimate) {
		t.Error("free-estimated must NOT replace a library-matched estimate")
	}
	// RESTAURANT_CONFIRMED is never auto-downgraded by a routine re-estimate.
	if supersedes(GroundingFreeEstimated, GroundingLibraryMatched, StatusRestaurantConfirmed) {
		t.Error("RESTAURANT_CONFIRMED must NOT be downgraded by a free re-estimate")
	}
	// A barcode (LABEL) MAY supersede a RESTAURANT_CONFIRMED recipe.
	if !supersedes(GroundingLabel, GroundingRecipe, StatusRestaurantConfirmed) {
		t.Error("LABEL should be allowed to supersede a confirmed recipe")
	}
	// EXACT (LABEL) never auto-downgraded by a library re-estimate.
	if supersedes(GroundingLibraryMatched, GroundingLabel, StatusExact) {
		t.Error("EXACT must NOT be downgraded by a library re-estimate")
	}
}

func TestStatusForGrounding_AutoPublish(t *testing.T) {
	if statusForGrounding(GroundingLabel) != StatusExact {
		t.Error("LABEL grounding should map to EXACT")
	}
	if statusForGrounding(GroundingRecipe) != StatusRestaurantConfirmed {
		t.Error("RECIPE grounding should map to RESTAURANT_CONFIRMED (explicit confirm)")
	}
	// Library + free both auto-publish as AI_ESTIMATE (no DRAFT).
	for _, g := range []Grounding{GroundingLibraryMatched, GroundingFreeEstimated} {
		if statusForGrounding(g) != StatusAIEstimate {
			t.Errorf("grounding %s should auto-publish as AI_ESTIMATE", g)
		}
	}
}

// ── Portion rescale factors ───────────────────────────────────────────────────

func TestPortionFactors(t *testing.T) {
	cases := []struct {
		label string
		want  float64
		ok    bool
	}{
		{PortionSmall, 0.75, true},
		{PortionRegular, 1.0, true},
		{PortionLarge, 1.4, true},
		{"LARGE", 1.4, true}, // case-insensitive
		{"jumbo", 1.0, false},
	}
	for _, c := range cases {
		f, ok := portionFactor(c.label)
		if ok != c.ok || !approx(f, c.want, 0.0001) {
			t.Errorf("portionFactor(%q) = (%.2f, %v), want (%.2f, %v)", c.label, f, ok, c.want, c.ok)
		}
	}
}

func TestPortionRescale_RatioFromRegularToLarge(t *testing.T) {
	// Editing regular(1.0) → large(1.4) rescales values by 1.4.
	ps := PerServing{NutEnergyKcal: exact(500), NutCarb: exact(80)}
	cur, _ := portionFactor(PortionRegular)
	next, _ := portionFactor(PortionLarge)
	scaled := ps.scale(next / cur)
	if !approx(scaled[NutEnergyKcal].Value, 700, 0.01) {
		t.Errorf("regular→large energy = %.2f, want 700", scaled[NutEnergyKcal].Value)
	}
	if !approx(scaled[NutCarb].Value, 112, 0.01) {
		t.Errorf("regular→large carb = %.2f, want 112", scaled[NutCarb].Value)
	}
}

// ── Recipe sum / scale / yield math (unchanged in v2) ─────────────────────────

func TestSumRecipe_BasicSum(t *testing.T) {
	rice := Composition{FoodCode: "R", EnergyKcal: 130, ProteinG: 2.7, CarbG: 28, FatG: 0.3, Version: 1}
	chicken := Composition{FoodCode: "C", EnergyKcal: 190, ProteinG: 29, CarbG: 0, FatG: 7.5, Version: 2}
	lookup := func(ing Ingredient) (Composition, bool) {
		switch ing.FoodCode {
		case "R":
			return rice, true
		case "C":
			return chicken, true
		}
		return Composition{}, false
	}
	ings := []Ingredient{
		{FoodCode: "R", QuantityG: 200, PrepMethod: "boiled"},
		{FoodCode: "C", QuantityG: 100, PrepMethod: "grilled"},
	}
	ps, compV, complete := SumRecipe(ings, 300, lookup)
	if !complete {
		t.Fatal("recipe should be complete (all ingredients resolved)")
	}
	if !approx(ps[NutEnergyKcal].Value, 450, 0.01) {
		t.Errorf("energy = %.2f, want 450", ps[NutEnergyKcal].Value)
	}
	if !approx(ps[NutProtein].Value, 34.4, 0.01) {
		t.Errorf("protein = %.2f, want 34.4", ps[NutProtein].Value)
	}
	if compV != 2 {
		t.Errorf("compVersion = %d, want max(1,2)=2", compV)
	}
	if ps[NutEnergyKcal].Low != ps[NutEnergyKcal].High {
		t.Error("recipe sum should have low==high (point estimate)")
	}
}

func TestSumRecipe_ScalesToPortion(t *testing.T) {
	rice := Composition{FoodCode: "R", EnergyKcal: 100, CarbG: 25, Version: 1}
	lookup := func(ing Ingredient) (Composition, bool) { return rice, true }
	ings := []Ingredient{{FoodCode: "R", QuantityG: 100, PrepMethod: "raw"}}
	ps, _, _ := SumRecipe(ings, 200, lookup)
	if !approx(ps[NutEnergyKcal].Value, 200, 0.01) {
		t.Errorf("scaled energy = %.2f, want 200", ps[NutEnergyKcal].Value)
	}
}

func TestSumRecipe_RetentionTrimsLabile(t *testing.T) {
	c := Composition{FoodCode: "X", EnergyKcal: 100, SugarG: 10, FiberG: 10, Version: 1}
	lookup := func(ing Ingredient) (Composition, bool) { return c, true }
	ings := []Ingredient{{FoodCode: "X", QuantityG: 100, PrepMethod: "fried"}}
	ps, _, _ := SumRecipe(ings, 100, lookup)
	if !approx(ps[NutEnergyKcal].Value, 100, 0.01) {
		t.Errorf("energy must be conserved by mass: %.2f", ps[NutEnergyKcal].Value)
	}
	if !approx(ps[NutSugar].Value, 7.5, 0.01) {
		t.Errorf("sugar should be trimmed to 0.75*10=7.5, got %.2f", ps[NutSugar].Value)
	}
}

func TestSumRecipe_IncompleteWhenLookupMisses(t *testing.T) {
	lookup := func(ing Ingredient) (Composition, bool) { return Composition{}, false }
	ings := []Ingredient{{FoodCode: "UNKNOWN", QuantityG: 100}}
	_, _, complete := SumRecipe(ings, 100, lookup)
	if complete {
		t.Error("recipe with an unresolved ingredient must be reported incomplete")
	}
}

// ── Library fuzzy match (unchanged in v2) ─────────────────────────────────────

func TestBestLibraryMatch(t *testing.T) {
	entries := []LibraryEntry{
		{Slug: "jollof-rice", Name: "Jollof Rice", Aliases: []string{"party rice", "jollof"}, StandardPortionG: 350},
		{Slug: "egusi-soup", Name: "Egusi Soup", Aliases: []string{"melon soup"}, StandardPortionG: 300},
	}
	m, score := BestLibraryMatch("Special Jollof Rice", entries)
	if m == nil || m.Slug != "jollof-rice" {
		t.Fatalf("expected jollof-rice match, got %v (score %.2f)", m, score)
	}
	m2, _ := BestLibraryMatch("party rice", entries)
	if m2 == nil || m2.Slug != "jollof-rice" {
		t.Errorf("alias 'party rice' should match jollof-rice")
	}
	m3, _ := BestLibraryMatch("egusi", entries)
	if m3 == nil || m3.Slug != "egusi-soup" {
		t.Errorf("'egusi' should match egusi-soup")
	}
	if m4, s := BestLibraryMatch("grilled fish pepper", entries); m4 != nil {
		t.Errorf("unrelated name should not match (got %s, score %.2f)", m4.Slug, s)
	}
}

func TestLibraryMatch_CaseInsensitive(t *testing.T) {
	e := LibraryEntry{Slug: "suya", Name: "Beef Suya", Aliases: []string{"tsire"}}
	if libraryMatch("BEEF SUYA", e) != 1.0 {
		t.Error("case-insensitive exact match should score 1.0")
	}
}

// ── AI mock range ─────────────────────────────────────────────────────────────

func TestMockEstimate_DeterministicAndWideBand(t *testing.T) {
	a := mockEstimate("Jollof Rice", 350)
	b := mockEstimate("Jollof Rice", 350)
	if a[NutEnergyKcal].Value != b[NutEnergyKcal].Value {
		t.Error("mock estimate must be deterministic for the same dish")
	}
	r := a[NutEnergyKcal]
	if !(r.Low < r.Value && r.Value < r.High) {
		t.Errorf("AI mock must produce a wide band low<value<high, got %+v", r)
	}
	c := mockEstimate("Egusi Soup", 350)
	if a[NutEnergyKcal].Value == c[NutEnergyKcal].Value {
		t.Error("different dishes should usually get different estimates")
	}
}

func TestMockEstimate_PassesSanity(t *testing.T) {
	ps := mockEstimate("Fried Rice", 350)
	if err := CheckSanity(ps, 350); err != nil {
		t.Errorf("mock estimate should pass sanity bounds, got: %v", err)
	}
}

func TestParseAIEstimate_NormalizesBand(t *testing.T) {
	raw := json.RawMessage(`{"per_serving":{"energy_kcal":{"value":500,"low":600,"high":400}}}`)
	ps, err := parseAIEstimate(raw)
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	r := ps[NutEnergyKcal]
	if r.Low > r.Value || r.High < r.Value {
		t.Errorf("band must be normalized to low<=value<=high, got %+v", r)
	}
}

func TestParseAIEstimate_RequiresEnergy(t *testing.T) {
	raw := json.RawMessage(`{"per_serving":{"protein_g":{"value":10,"low":8,"high":12}}}`)
	if _, err := parseAIEstimate(raw); err == nil {
		t.Error("expected error when energy_kcal is missing")
	}
}

// ── Allergen rule enforcement (unchanged in v2) ───────────────────────────────

func TestValidateAllergen_AICannotContainsOrFreeFrom(t *testing.T) {
	if err := validateAllergen("peanut", DeclContains, AllergenSourceAI, false, false); err == nil {
		t.Error("AI must NOT be allowed to set CONTAINS")
	}
	if err := validateAllergen("peanut", DeclFreeFrom, AllergenSourceAI, false, true); err == nil {
		t.Error("AI must NOT be allowed to set FREE_FROM")
	}
	if err := validateAllergen("peanut", DeclMayContain, AllergenSourceAI, false, false); err != nil {
		t.Errorf("AI MAY_CONTAIN should be allowed, got: %v", err)
	}
}

func TestValidateAllergen_DefinitiveRequiresAttestation(t *testing.T) {
	if err := validateAllergen("milk", DeclContains, AllergenSourceVendor, false, false); err == nil {
		t.Error("CONTAINS without an attester must be rejected")
	}
	if err := validateAllergen("milk", DeclContains, AllergenSourceVendor, true, false); err != nil {
		t.Errorf("vendor-attested CONTAINS should pass, got: %v", err)
	}
}

func TestValidateAllergen_FreeFromRequiresAck(t *testing.T) {
	if err := validateAllergen("egg", DeclFreeFrom, AllergenSourceVendor, true, false); err == nil {
		t.Error("FREE_FROM without cross_contamination_ack must be rejected")
	}
	if err := validateAllergen("egg", DeclFreeFrom, AllergenSourceVendor, true, true); err != nil {
		t.Errorf("attested FREE_FROM with ack should pass, got: %v", err)
	}
}

func TestValidateAllergen_UnknownVocab(t *testing.T) {
	if err := validateAllergen("dragonfruit", DeclMayContain, AllergenSourceVendor, false, false); err == nil {
		t.Error("unknown allergen must be rejected")
	}
}

// ── Display: band + traffic lights + precision strings + v2 labels ────────────

func TestBandFor(t *testing.T) {
	cases := []struct {
		kcal float64
		want EnergyBand
	}{
		{350, BandLight},
		{400, BandLight},
		{401, BandBalanced},
		{700, BandBalanced},
		{900, BandHeavy},
	}
	for _, c := range cases {
		if got := bandFor(c.kcal); got != c.want {
			t.Errorf("bandFor(%.0f) = %s, want %s", c.kcal, got, c.want)
		}
	}
}

func TestTrafficLightFor(t *testing.T) {
	if trafficLightFor(NutSodium, 500) != LightGreen {
		t.Error("sodium 500 should be green")
	}
	if trafficLightFor(NutSodium, 800) != LightAmber {
		t.Error("sodium 800 should be amber")
	}
	if trafficLightFor(NutSodium, 1300) != LightRed {
		t.Error("sodium 1300 should be red")
	}
	if trafficLightFor(NutProtein, 99) != "" {
		t.Error("protein has no traffic-light config; should be empty")
	}
}

func TestFormatRange_PrecisionByStatus(t *testing.T) {
	// EXACT → plain point value + "from label".
	if got := formatRange(NutEnergyKcal, exact(540), StatusExact); got != "540 kcal · from label" {
		t.Errorf("exact format = %q, want '540 kcal · from label'", got)
	}
	// RESTAURANT_CONFIRMED → point value, STILL an estimate (never "verified"/"exact").
	got := formatRange(NutEnergyKcal, Range{Value: 540, Low: 500, High: 580}, StatusRestaurantConfirmed)
	if got != "≈540 kcal · estimate" {
		t.Errorf("restaurant-confirmed format = %q, want '≈540 kcal · estimate'", got)
	}
	// AI_ESTIMATE → range + "AI estimate".
	got2 := formatRange(NutEnergyKcal, Range{Value: 550, Low: 520, High: 580}, StatusAIEstimate)
	if got2 != "≈520–580 kcal · AI estimate" {
		t.Errorf("ai-estimate format = %q, want '≈520–580 kcal · AI estimate'", got2)
	}
}

func TestStatusLabel(t *testing.T) {
	if statusLabel(StatusExact) != "from label" {
		t.Error("EXACT label wrong")
	}
	if statusLabel(StatusRestaurantConfirmed) != "restaurant-confirmed (estimate)" {
		t.Error("RESTAURANT_CONFIRMED must stay labelled an estimate (approval != exact)")
	}
	if statusLabel(StatusAIEstimate) != "AI estimate" {
		t.Error("AI_ESTIMATE label wrong")
	}
}

func TestBuildDisplay_RestaurantConfirmedStillEstimate(t *testing.T) {
	ps := PerServing{NutEnergyKcal: Range{Value: 550, Low: 500, High: 600}}
	// RESTAURANT_CONFIRMED is still semantically an estimate.
	db := BuildDisplay(ps, GroundingLibraryMatched, ConfidenceMedium, StatusRestaurantConfirmed)
	if !db.Estimated {
		t.Error("RESTAURANT_CONFIRMED must be estimated=true (approval != exact)")
	}
	if db.Label != "restaurant-confirmed (estimate)" {
		t.Errorf("label = %q, want 'restaurant-confirmed (estimate)'", db.Label)
	}
	// EXACT is the only true exactness.
	dbx := BuildDisplay(ps, GroundingLabel, ConfidenceExact, StatusExact)
	if dbx.Estimated {
		t.Error("EXACT must be the only non-estimated status")
	}
}

func TestBuildDisplay_NeverBareNumber(t *testing.T) {
	ps := PerServing{
		NutEnergyKcal: Range{Value: 550, Low: 500, High: 600},
		NutSodium:     Range{Value: 1300, Low: 1100, High: 1500},
	}
	db := BuildDisplay(ps, GroundingFreeEstimated, ConfidenceLow, StatusAIEstimate)
	if db.Band != BandBalanced {
		t.Errorf("band = %s, want Balanced", db.Band)
	}
	if !db.Estimated {
		t.Error("AI_ESTIMATE must be marked estimated")
	}
	if db.Disclaimer == "" {
		t.Error("display must carry the disclaimer")
	}
	for _, n := range db.Nutrients {
		if n.Text == "" {
			t.Errorf("nutrient %s emitted an empty precision string (bare number forbidden)", n.Nutrient)
		}
		if n.Nutrient == NutSodium && n.Light != LightRed {
			t.Errorf("sodium 1300 should be red, got %s", n.Light)
		}
	}
}

// ── Cart range propagation ────────────────────────────────────────────────────

func TestAggregateCart_RangePropagation(t *testing.T) {
	lines := []CartLine{
		{PerServing: PerServing{NutEnergyKcal: Range{Value: 500, Low: 450, High: 560}, NutSodium: Range{Value: 700, Low: 600, High: 800}}},
		{PerServing: PerServing{NutEnergyKcal: Range{Value: 300, Low: 280, High: 330}, NutSodium: Range{Value: 600, Low: 500, High: 700}}},
	}
	s := AggregateCart(lines)
	e := s.Total[NutEnergyKcal]
	if !approx(e.Value, 800, 0.01) || !approx(e.Low, 730, 0.01) || !approx(e.High, 890, 0.01) {
		t.Errorf("energy total = %+v, want value=800 low=730 high=890", e)
	}
	if s.Lights[NutSodium] != LightRed {
		t.Errorf("combined sodium light = %s, want red (worst-case high end)", s.Lights[NutSodium])
	}
	if s.Band != BandHeavy {
		t.Errorf("combined band (800 kcal) = %s, want Heavy", s.Band)
	}
	if s.Disclaimer == "" {
		t.Error("cart summary must carry the disclaimer")
	}
}

func TestWorstConfidence(t *testing.T) {
	if worstConfidence([]Confidence{ConfidenceExact, ConfidenceLow, ConfidenceMedium}) != ConfidenceLow {
		t.Error("worst of {EXACT,LOW,MEDIUM} should be LOW")
	}
	if worstConfidence([]Confidence{ConfidenceExact, ConfidenceMedium}) != ConfidenceMedium {
		t.Error("worst of {EXACT,MEDIUM} should be MEDIUM")
	}
}

// ── Sanity-bound rejection (drives edit + recipe rejection) ───────────────────

func TestCheckSanity_RejectsImplausible(t *testing.T) {
	bad := PerServing{NutEnergyKcal: exact(5000), NutCarb: exact(1)}
	if err := CheckSanity(bad, 100); err == nil {
		t.Error("expected sanity rejection for absurd energy density")
	}
	neg := PerServing{NutEnergyKcal: exact(300), NutProtein: exact(-5)}
	if err := CheckSanity(neg, 300); err == nil {
		t.Error("expected rejection for a negative macro")
	}
	mism := PerServing{
		NutEnergyKcal: exact(200),
		NutProtein:    exact(50),
		NutCarb:       exact(50),
		NutFat:        exact(40),
	}
	if err := CheckSanity(mism, 300); err == nil {
		t.Error("expected rejection for a 4/4/9 reconciliation mismatch")
	}
}

func TestCheckSanity_AcceptsPlausible(t *testing.T) {
	good := PerServing{
		NutEnergyKcal: exact(578),
		NutProtein:    exact(11),
		NutCarb:       exact(84),
		NutFat:        exact(21),
		NutSodium:     exact(1330),
	}
	if err := CheckSanity(good, 350); err != nil {
		t.Errorf("plausible jollof profile should pass sanity, got: %v", err)
	}
}

// An implausible macro-nudge edit (5000 kcal in a 350g portion) must fail sanity
// — Edit relies on this to reject + flag without publishing.
func TestCheckSanity_RejectsImplausibleEdit(t *testing.T) {
	edited := PerServing{NutEnergyKcal: exact(5000), NutCarb: exact(10)}
	if err := CheckSanity(edited, 350); err == nil {
		t.Error("an implausible edit must be rejected by sanity bounds")
	}
}
