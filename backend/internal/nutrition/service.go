package nutrition

import (
	"context"
	"fmt"
	"strings"
)

// Service owns the resolver cascade + the guarded profile status machine + the
// safety-critical allergen attestation path. It performs object-level authz on
// every vendor action (the vendor must own the dish's restaurant) and writes an
// immutable audit row for every AI estimate, vendor confirmation, and allergen
// attestation. There is NO money path.
type Service struct {
	repo  *Repository
	llm   LLMGenerator // Tier-3 estimator; nil/disabled ⇒ deterministic mock
	label LabelLookup  // Tier-0 barcode/label; nil ⇒ Tier 0 skipped
}

// NewService constructs the nutrition service. llm and label are optional and may
// be wired post-construction via WithLLM / WithLabelLookup.
func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

// WithLLM wires the Tier-3 AI estimator. When unset or disabled the resolver
// uses the deterministic mock (so the engine resolves end-to-end without a key).
func (s *Service) WithLLM(g LLMGenerator) *Service {
	s.llm = g
	return s
}

// WithLabelLookup wires the Tier-0 barcode/label source. When unset, Tier 0 is
// skipped (the cascade starts at Tier 1).
func (s *Service) WithLabelLookup(l LabelLookup) *Service {
	s.label = l
	return s
}

// ─────────────────────────────────────────────────────────────────────────────
// Authz — object-level, via the restaurant ownership chain.
// ─────────────────────────────────────────────────────────────────────────────

// assertOwner enforces that userID owns the dish's restaurant. Mirrors the
// restaurant module's assertOwner join (menu_items.restaurant_id →
// restaurants.owner_id). Returns the resolved dish info on success.
func (s *Service) assertOwner(ctx context.Context, menuItemID, userID string) (*DishOwnership, error) {
	d, err := s.repo.DishInfo(ctx, menuItemID)
	if err != nil {
		return nil, err
	}
	if d.OwnerID != userID {
		return nil, ErrForbidden
	}
	return d, nil
}

// assertRestaurantOwner enforces that userID owns the restaurant (for batch
// actions over a whole menu — auto-suggest / approve-all). Uses the restaurant
// ownership chain directly (restaurants.owner_id).
func (s *Service) assertRestaurantOwner(ctx context.Context, restaurantID, userID string) error {
	owner, err := s.repo.RestaurantOwner(ctx, restaurantID)
	if err != nil {
		return err
	}
	if owner != userID {
		return ErrForbidden
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Grounding-based resolver — barcode → library → free estimate (single AI
// suggestion to the vendor). The optional recipe path is a separate, hidden
// power-user method (DeclareRecipe), NOT part of this routine cascade.
//
//   barcode present  → LABEL          / EXACT  / status EXACT
//   library match    → LIBRARY_MATCHED/ MEDIUM / status AI_ESTIMATE (auto-published)
//   no match         → FREE_ESTIMATED / LOW    / status AI_ESTIMATE (auto-published)
// ─────────────────────────────────────────────────────────────────────────────

// ResolveInput drives a resolve. Barcode triggers the LABEL fast-path; the dish
// name feeds the library grounding match and the free AI estimate.
type ResolveInput struct {
	MenuItemID      string
	Barcode         string  // optional — LABEL fast-path
	DefaultPortionG float64 // fallback portion when no library/label size
}

// resolved is the internal output of a single resolve attempt.
type resolved struct {
	grounding   Grounding
	confidence  Confidence
	portionG    float64
	perServing  PerServing
	compVersion *int
}

// resolveDish runs the grounding cascade and returns the best estimate. It does
// NOT persist — callers (Resolve / Reresolve / AutoSuggestMenu) decide whether the
// result supersedes the existing profile and then persist via applyResolved.
func (s *Service) resolveDish(ctx context.Context, in ResolveInput, dishName string) (*resolved, error) {
	portion := in.DefaultPortionG
	if portion <= 0 {
		portion = 350 // sensible default Nigerian main portion (g)
	}

	// ── LABEL: barcode → label/OFF → EXACT per-serving → status EXACT.
	if in.Barcode != "" && s.label != nil {
		res, ok, err := s.label.Lookup(ctx, in.Barcode)
		if err == nil && ok {
			return &resolved{
				grounding:  GroundingLabel,
				confidence: ConfidenceExact,
				portionG:   res.PortionSizeG,
				perServing: res.PerServing,
			}, nil
		}
	}

	// ── LIBRARY_MATCHED: name fuzzy-matches the Nigerian grounding library
	//    (grounding inside the AI, not a vendor-facing tier) → scale to portion.
	entries, err := s.repo.AllLibraryEntries(ctx)
	if err != nil {
		return nil, err
	}
	if match, score := BestLibraryMatch(dishName, entries); match != nil && score >= libraryMatchThreshold {
		target := portion
		if target <= 0 {
			target = match.StandardPortionG
		}
		ps := match.PerServing
		if match.StandardPortionG > 0 && target != match.StandardPortionG {
			ps = match.PerServing.scale(target / match.StandardPortionG)
		}
		cv := match.CompositionVersion
		return &resolved{
			grounding:   GroundingLibraryMatched,
			confidence:  ConfidenceMedium,
			portionG:    target,
			perServing:  ps,
			compVersion: &cv,
		}, nil
	}

	// ── FREE_ESTIMATED: no library match → AI free estimate → LOW band.
	ps, err := s.estimateAI(ctx, in.MenuItemID, dishName, portion)
	if err != nil {
		return nil, err
	}
	return &resolved{
		grounding:  GroundingFreeEstimated,
		confidence: ConfidenceLow,
		portionG:   portion,
		perServing: ps,
	}, nil
}

// estimateAI runs the free AI estimate. Uses the live LLM when wired+enabled, else
// the deterministic mock. Every AI estimate (live or mock) is audited.
func (s *Service) estimateAI(ctx context.Context, menuItemID, dishName string, portionG float64) (PerServing, error) {
	var ps PerServing
	model := "deterministic-mock"
	if s.llm != nil && s.llm.Enabled() {
		userPrompt := fmt.Sprintf("Dish: %s\nServing size: %.0f g\nEstimate the per-serving nutrition.", dishName, portionG)
		raw, err := s.llm.GenerateJSON(ctx, aiSystemPrompt, userPrompt)
		if err != nil {
			// Live estimator failed — fall back to the mock rather than failing the
			// resolve (a marked LOW-confidence estimate is better than none, and the
			// fallback is audited as such).
			ps = mockEstimate(dishName, portionG)
			model = "deterministic-mock(llm-error)"
		} else {
			parsed, perr := parseAIEstimate(raw)
			if perr != nil {
				ps = mockEstimate(dishName, portionG)
				model = "deterministic-mock(llm-parse-error)"
			} else {
				ps = parsed
				model = s.llm.Model()
			}
		}
	} else {
		ps = mockEstimate(dishName, portionG)
	}
	_ = s.repo.Audit(ctx, menuItemID, "", "NUTRITION_ESTIMATE", nil,
		map[string]any{"per_serving": ps},
		map[string]any{"model": model, "grounding": string(GroundingFreeEstimated), "confidence": string(ConfidenceLow)})
	return ps, nil
}

// applyResolved persists a resolved result, honouring the supersede policy and the
// guarded honesty machine. It AUTO-PUBLISHES every AI/library estimate as
// AI_ESTIMATE (no DRAFT). It never auto-downgrades a RESTAURANT_CONFIRMED / EXACT
// profile by a routine re-estimate.
func (s *Service) applyResolved(ctx context.Context, dish *DishOwnership, res *resolved) (*Profile, error) {
	current, err := s.repo.GetProfile(ctx, dish.MenuItemID)
	if err != nil {
		return nil, err
	}
	newStatus := statusForGrounding(res.grounding)
	expectedVersion := 0
	if current != nil {
		// supersedes encodes the no-downgrade rule: a RESTAURANT_CONFIRMED / EXACT
		// profile is never replaced by a routine re-estimate (only a strictly
		// higher-rank grounding, e.g. a barcode appearing, may take over); an
		// AI_ESTIMATE / STALE profile yields to any equal/higher-rank grounding.
		if !supersedes(res.grounding, current.Grounding, current.Status) {
			return current, nil
		}
		expectedVersion = current.Version
		// Guard the status transition (fail-closed).
		if current.Status != newStatus && !CanTransition(current.Status, newStatus) {
			return nil, fmt.Errorf("%w: %s → %s", ErrBadState, current.Status, newStatus)
		}
	}

	portionLabel := PortionRegular
	if current != nil && current.PortionLabel != "" {
		portionLabel = current.PortionLabel
	}
	p := Profile{
		MenuItemID:         dish.MenuItemID,
		RestaurantID:       dish.RestaurantID,
		Grounding:          res.grounding,
		Confidence:         res.confidence,
		Status:             newStatus,
		PortionLabel:       portionLabel,
		PortionSizeG:       res.portionG,
		PerServing:         res.perServing,
		CompositionVersion: res.compVersion,
	}
	out, err := s.repo.UpsertResolved(ctx, p, expectedVersion)
	if err != nil {
		return nil, err
	}
	_ = s.repo.Audit(ctx, dish.MenuItemID, "", "NUTRITION_RESOLVE", profileBefore(current),
		map[string]any{"grounding": string(res.grounding), "confidence": string(res.confidence), "status": string(newStatus)},
		map[string]any{"grounding": string(res.grounding)})
	return out, nil
}

// Resolve runs the full cascade for a dish and AUTO-PUBLISHES the result. Buyer-
// facing (no authz on resolve itself — only the admin force-resolve route +
// internal triggers call it; the member GET is read-only). dishName is loaded
// from the menu item.
func (s *Service) Resolve(ctx context.Context, in ResolveInput) (*Profile, error) {
	dish, err := s.repo.DishInfo(ctx, in.MenuItemID)
	if err != nil {
		return nil, err
	}
	res, err := s.resolveDish(ctx, in, dish.Name)
	if err != nil {
		return nil, err
	}
	return s.applyResolved(ctx, dish, res)
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-suggest — batch-estimate a whole menu at upload (the onboarding-first
// core). A "menu" is a restaurant's set of menu_items (menu_items has no menu_id
// column — see migration 20260616270000_restaurant.sql), so menuID IS the
// restaurantID. Object-level owner check on the restaurant.
// ─────────────────────────────────────────────────────────────────────────────

// AutoSuggestMenu estimates + auto-publishes AI_ESTIMATE for every menu item in a
// restaurant that lacks a profile (or whose profile is STALE). Owner-checked.
// Returns the number of dishes (re-)estimated. Per-dish failures are skipped so
// one bad item never blocks the whole menu going live.
func (s *Service) AutoSuggestMenu(ctx context.Context, restaurantID, callerID string) (int, error) {
	if err := s.assertRestaurantOwner(ctx, restaurantID, callerID); err != nil {
		return 0, err
	}
	items, err := s.repo.MenuItemsNeedingProfile(ctx, restaurantID)
	if err != nil {
		return 0, err
	}
	count := 0
	for _, it := range items {
		dish := &DishOwnership{MenuItemID: it.MenuItemID, RestaurantID: restaurantID, Name: it.Name}
		res, rerr := s.resolveDish(ctx, ResolveInput{MenuItemID: it.MenuItemID}, it.Name)
		if rerr != nil {
			continue
		}
		if _, aerr := s.applyResolved(ctx, dish, res); aerr != nil {
			continue
		}
		count++
	}
	_ = s.repo.Audit(ctx, "", callerID, "NUTRITION_AUTO_SUGGEST", nil,
		map[string]any{"restaurant_id": restaurantID, "estimated": count}, nil)
	return count, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads.
// ─────────────────────────────────────────────────────────────────────────────

// DishView is the buyer-facing read: the resolved profile, its display block,
// and the allergen declarations (with the default "may contain" surfaced for
// unattested allergens implicitly via the display layer).
type DishView struct {
	MenuItemID string                `json:"menu_item_id"`
	Name       string                `json:"name"`
	Profile    *Profile              `json:"profile"`
	Display    *DisplayBlock         `json:"display"`
	Allergens  []AllergenDeclaration `json:"allergens"`
	Disclaimer string                `json:"disclaimer"`
}

// GetDishView returns the current profile + display + allergens for a dish. If no
// profile exists yet it triggers a resolve (so a first read is never empty). This
// is buyer-readable (no ownership check).
func (s *Service) GetDishView(ctx context.Context, menuItemID string) (*DishView, error) {
	dish, err := s.repo.DishInfo(ctx, menuItemID)
	if err != nil {
		return nil, err
	}
	profile, err := s.repo.GetProfile(ctx, menuItemID)
	if err != nil {
		return nil, err
	}
	if profile == nil {
		// Lazy first resolve.
		profile, err = s.Resolve(ctx, ResolveInput{MenuItemID: menuItemID})
		if err != nil {
			return nil, err
		}
	}
	allergens, err := s.repo.ListAllergens(ctx, menuItemID)
	if err != nil {
		return nil, err
	}
	view := &DishView{
		MenuItemID: menuItemID,
		Name:       dish.Name,
		Profile:    profile,
		Allergens:  allergens,
		Disclaimer: Disclaimer,
	}
	if profile != nil {
		db := BuildDisplay(profile.PerServing, profile.Grounding, profile.Confidence, profile.Status)
		view.Display = &db
	}
	return view, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Vendor actions (object-level owner-checked).
// ─────────────────────────────────────────────────────────────────────────────

// DeclareRecipeInput is a vendor recipe declaration.
type DeclareRecipeInput struct {
	Ingredients  []Ingredient
	PortionSizeG float64
	CookMethod   string
}

// DeclareRecipe is the OPTIONAL HIDDEN power-user path (never part of the normal
// approve flow, never shown at onboarding). It persists a vendor recipe, computes
// the per-serving profile from it, and publishes the dish as RESTAURANT_CONFIRMED
// with grounding RECIPE + confidence MEDIUM (declaring + owning a recipe is an
// explicit confirm — but it is still an estimate, so MEDIUM, never EXACT).
// Implausible values are rejected (ErrSanityBounds) and NOT published.
func (s *Service) DeclareRecipe(ctx context.Context, menuItemID, userID string, in DeclareRecipeInput) (*Profile, error) {
	dish, err := s.assertOwner(ctx, menuItemID, userID)
	if err != nil {
		return nil, err
	}
	if in.PortionSizeG <= 0 {
		return nil, fmt.Errorf("nutrition: portion_size_g must be > 0")
	}
	if len(in.Ingredients) == 0 {
		return nil, fmt.Errorf("nutrition: recipe requires at least one ingredient")
	}
	rec, err := s.repo.UpsertRecipe(ctx, Recipe{
		MenuItemID:   menuItemID,
		RestaurantID: dish.RestaurantID,
		Ingredients:  in.Ingredients,
		PortionSizeG: in.PortionSizeG,
		CookMethod:   in.CookMethod,
	})
	if err != nil {
		return nil, err
	}

	// Compute the per-serving profile from the just-declared recipe.
	lookup := func(ing Ingredient) (Composition, bool) {
		c, lerr := s.repo.LookupComposition(ctx, ing.FoodCode, ing.Source, ing.PrepMethod)
		if lerr != nil || c == nil {
			return Composition{}, false
		}
		return *c, true
	}
	ps, compV, complete := SumRecipe(in.Ingredients, in.PortionSizeG, lookup)
	if !complete || len(ps) == 0 {
		return nil, fmt.Errorf("%w: recipe could not be fully resolved against the composition tables", ErrNotFound)
	}
	// SANITY BOUNDS before publishing vendor-derived values.
	if serr := CheckSanity(ps, in.PortionSizeG); serr != nil {
		_ = s.repo.Audit(ctx, menuItemID, userID, "NUTRITION_SANITY_REJECT", nil,
			map[string]any{"reason": serr.Error()}, map[string]any{"recipe_version": rec.Version})
		return nil, serr
	}
	cv := compV
	// An explicit owner recipe declaration always wins — it bypasses the routine
	// supersede guard (which protects against AUTOMATIC re-estimates). Persist
	// directly as grounding RECIPE / confidence MEDIUM / status RESTAURANT_CONFIRMED.
	current, err := s.repo.GetProfile(ctx, menuItemID)
	if err != nil {
		return nil, err
	}
	expectedVersion := 0
	portionLabel := PortionRegular
	if current != nil {
		expectedVersion = current.Version
		if current.PortionLabel != "" {
			portionLabel = current.PortionLabel
		}
	}
	profile, err := s.repo.UpsertResolved(ctx, Profile{
		MenuItemID:         menuItemID,
		RestaurantID:       dish.RestaurantID,
		Grounding:          GroundingRecipe,
		Confidence:         ConfidenceMedium,
		Status:             StatusRestaurantConfirmed,
		PortionLabel:       portionLabel,
		PortionSizeG:       in.PortionSizeG,
		PerServing:         ps,
		CompositionVersion: &cv,
	}, expectedVersion)
	if err != nil {
		return nil, err
	}
	// Stamp confirmed_by (a declared recipe is an explicit confirm).
	if profile != nil {
		_ = s.repo.SetConfirmedBy(ctx, menuItemID, userID)
		cb := userID
		profile.ConfirmedBy = &cb
	}
	_ = s.repo.Audit(ctx, menuItemID, userID, "NUTRITION_RECIPE_DECLARE", nil,
		map[string]any{"portion_size_g": in.PortionSizeG, "ingredients": len(in.Ingredients), "grounding": string(GroundingRecipe)},
		map[string]any{"recipe_version": rec.Version, "badge": "Nutrition-Verified"})
	return profile, nil
}

// Approve marks an AI_ESTIMATE profile RESTAURANT_CONFIRMED — the vendor approves
// the estimate as acceptable, earning the "Nutrition-Verified" badge. The value
// stays an estimate (approval != exact). Object-level owner-checked, guarded by
// the status machine, optimistic-version-locked. If the dish matched a library
// slug, the approved values feed the learn-from-edits loop (best-effort).
func (s *Service) Approve(ctx context.Context, menuItemID, userID string) (*Profile, error) {
	if _, err := s.assertOwner(ctx, menuItemID, userID); err != nil {
		return nil, err
	}
	profile, err := s.repo.GetProfile(ctx, menuItemID)
	if err != nil {
		return nil, err
	}
	if profile == nil {
		return nil, ErrNotFound
	}
	out, err := s.approveProfile(ctx, profile, userID)
	if err != nil {
		return nil, err
	}
	return out, nil
}

// approveProfile is the shared owner-already-checked approval body (used by both
// Approve and ApproveAll). It guards the transition, runs sanity bounds, flips the
// status to RESTAURANT_CONFIRMED, records library feedback, and audits the badge.
func (s *Service) approveProfile(ctx context.Context, profile *Profile, userID string) (*Profile, error) {
	if profile.Status == StatusRestaurantConfirmed {
		return profile, nil // idempotent no-op
	}
	if !CanTransition(profile.Status, StatusRestaurantConfirmed) {
		return nil, fmt.Errorf("%w: cannot approve from %s", ErrBadState, profile.Status)
	}
	// SANITY BOUNDS before publishing a confirmed profile.
	if serr := CheckSanity(profile.PerServing, profile.PortionSizeG); serr != nil {
		return nil, serr
	}
	if err := s.repo.Approve(ctx, profile.MenuItemID, userID, profile.Version); err != nil {
		return nil, err
	}
	// Learn-from-edits: a confirmed library-matched dish refines the library.
	s.recordLibraryFeedback(ctx, profile)
	_ = s.repo.Audit(ctx, profile.MenuItemID, userID, "NUTRITION_APPROVE",
		map[string]any{"status": string(profile.Status)},
		map[string]any{"status": string(StatusRestaurantConfirmed)},
		map[string]any{"grounding": string(profile.Grounding), "badge": "Nutrition-Verified"})
	return s.repo.GetProfile(ctx, profile.MenuItemID)
}

// ApproveAll approves every AI_ESTIMATE dish for a restaurant (the one-tap
// "Approve all" at the end of the post-onboarding review). Owner-checked on the
// restaurant. Per-dish failures are skipped. Returns the number approved.
func (s *Service) ApproveAll(ctx context.Context, restaurantID, userID string) (int, error) {
	if err := s.assertRestaurantOwner(ctx, restaurantID, userID); err != nil {
		return 0, err
	}
	profiles, err := s.repo.ListByRestaurant(ctx, restaurantID)
	if err != nil {
		return 0, err
	}
	count := 0
	for i := range profiles {
		p := profiles[i]
		if p.Status != StatusAIEstimate {
			continue
		}
		if _, aerr := s.approveProfile(ctx, &p, userID); aerr != nil {
			continue
		}
		count++
	}
	_ = s.repo.Audit(ctx, "", userID, "NUTRITION_APPROVE_ALL", nil,
		map[string]any{"restaurant_id": restaurantID, "approved": count, "badge": "Nutrition-Verified"}, nil)
	return count, nil
}

// EditInput is the lightweight vendor edit — portion selector and/or direct macro
// nudges. It NEVER accepts ingredients (the recipe path is separate + hidden).
type EditInput struct {
	PortionLabel      string             // optional — small | regular | large (rescales)
	PortionMacroNudge map[string]float64 // optional — nutrient key → overriding value
}

// Edit applies a lightweight vendor edit and publishes the dish as
// RESTAURANT_CONFIRMED (an edit is an implicit approval). The portion selector
// rescales portion_size_g + all per-serving values by the ratio of the new
// portion factor to the current one; macro nudges directly override the given
// nutrient values. Edit runs CheckSanity — implausible results are rejected
// (ErrSanityBounds), flagged for ops, and NOT published. Edit NEVER accepts
// ingredients. Owner-checked; library-matched dishes feed the learn-from-edits
// loop.
func (s *Service) Edit(ctx context.Context, menuItemID, userID string, in EditInput) (*Profile, error) {
	if _, err := s.assertOwner(ctx, menuItemID, userID); err != nil {
		return nil, err
	}
	profile, err := s.repo.GetProfile(ctx, menuItemID)
	if err != nil {
		return nil, err
	}
	if profile == nil {
		return nil, ErrNotFound
	}

	newPortionLabel := profile.PortionLabel
	if newPortionLabel == "" {
		newPortionLabel = PortionRegular
	}
	newPortionG := profile.PortionSizeG
	ps := profile.PerServing.scale(1.0) // copy

	// Portion selector: rescale by the ratio of the new factor to the current one.
	if in.PortionLabel != "" {
		newFactor, ok := portionFactor(in.PortionLabel)
		if !ok {
			return nil, fmt.Errorf("nutrition: unknown portion_label %q", in.PortionLabel)
		}
		curFactor, _ := portionFactor(newPortionLabel)
		if curFactor <= 0 {
			curFactor = 1.0
		}
		ratio := newFactor / curFactor
		ps = ps.scale(ratio)
		newPortionG = profile.PortionSizeG * ratio
		newPortionLabel = strings.ToLower(strings.TrimSpace(in.PortionLabel))
	}

	// Macro nudge: directly override the given nutrient values (low=high=value).
	for k, v := range in.PortionMacroNudge {
		if _, ok := nutrientUnits[k]; !ok {
			return nil, fmt.Errorf("nutrition: unknown nutrient %q in macro nudge", k)
		}
		ps[k] = exact(v)
	}

	// SANITY BOUNDS — implausible edit is flagged + rejected, NOT published.
	if serr := CheckSanity(ps, newPortionG); serr != nil {
		_ = s.repo.Audit(ctx, menuItemID, userID, "NUTRITION_SANITY_REJECT", nil,
			map[string]any{"reason": serr.Error(), "portion_label": newPortionLabel}, nil)
		return nil, serr
	}

	// An edit is an implicit approval → RESTAURANT_CONFIRMED.
	if profile.Status != StatusRestaurantConfirmed && !CanTransition(profile.Status, StatusRestaurantConfirmed) {
		return nil, fmt.Errorf("%w: cannot edit from %s", ErrBadState, profile.Status)
	}
	out, err := s.repo.UpdateEdited(ctx, menuItemID, userID, newPortionLabel, newPortionG, ps, profile.Version)
	if err != nil {
		return nil, err
	}
	// Learn-from-edits: an edited library-matched dish refines the library.
	s.recordLibraryFeedback(ctx, out)
	_ = s.repo.Audit(ctx, menuItemID, userID, "NUTRITION_EDIT",
		map[string]any{"portion_label": profile.PortionLabel, "status": string(profile.Status)},
		map[string]any{"portion_label": newPortionLabel, "status": string(StatusRestaurantConfirmed)},
		map[string]any{"grounding": string(profile.Grounding), "badge": "Nutrition-Verified"})
	return out, nil
}

// recordLibraryFeedback feeds an approved/edited LIBRARY_MATCHED dish back into
// the learn-from-edits loop (best-effort, fail-open). It maps the dish name to a
// library slug and inserts the current per-serving as feedback. No-op for non-
// library groundings or when no slug matches.
func (s *Service) recordLibraryFeedback(ctx context.Context, p *Profile) {
	if p == nil || p.Grounding != GroundingLibraryMatched {
		return
	}
	dish, err := s.repo.DishInfo(ctx, p.MenuItemID)
	if err != nil {
		return
	}
	entries, err := s.repo.AllLibraryEntries(ctx)
	if err != nil {
		return
	}
	match, score := BestLibraryMatch(dish.Name, entries)
	if match == nil || score < libraryMatchThreshold {
		return
	}
	_ = s.repo.InsertLibraryFeedback(ctx, match.Slug, p.MenuItemID, p.RestaurantID, p.PortionSizeG, p.PerServing)
}

// AttestAllergens records vendor allergen attestations (SEPARATE from nutrition).
// Each declaration is validated in code (validateAllergen) AND by the DB CHECK
// constraints. Object-level owner-checked. Every attestation is audited.
//
// SAFETY: definitive claims (CONTAINS / FREE_FROM) are forced to source=VENDOR
// with the attester set to the calling vendor; FREE_FROM additionally requires
// the cross-contamination ack. An AI-suggested allergen can only ever be
// MAY_CONTAIN (enforced both here and at the DB).
func (s *Service) AttestAllergens(ctx context.Context, menuItemID, userID string, items []AllergenAttestInput) ([]AllergenDeclaration, error) {
	dish, err := s.assertOwner(ctx, menuItemID, userID)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, fmt.Errorf("nutrition: no allergen declarations provided")
	}
	for _, it := range items {
		allergen := strings.ToLower(strings.TrimSpace(it.Allergen))
		declType := strings.ToUpper(strings.TrimSpace(it.DeclarationType))
		// A vendor attestation is always source=VENDOR with the vendor as attester.
		// Code-side enforcement of the three safety rules (defense in depth).
		if verr := validateAllergen(allergen, declType, AllergenSourceVendor, true, it.CrossContamAck); verr != nil {
			return nil, verr
		}
		decl := AllergenDeclaration{
			MenuItemID:      menuItemID,
			RestaurantID:    dish.RestaurantID,
			Allergen:        allergen,
			DeclarationType: declType,
			Source:          AllergenSourceVendor,
			AttestedBy:      &userID,
			CrossContamAck:  it.CrossContamAck,
		}
		if uerr := s.repo.UpsertAllergen(ctx, decl); uerr != nil {
			return nil, uerr // ErrAllergenRuleViolation already cleaned in the repo
		}
		_ = s.repo.Audit(ctx, menuItemID, userID, "ALLERGEN_ATTEST", nil,
			map[string]any{"allergen": allergen, "declaration_type": declType, "cross_contamination_ack": it.CrossContamAck},
			map[string]any{"source": AllergenSourceVendor})
	}
	return s.repo.ListAllergens(ctx, menuItemID)
}

// SuggestAllergenAI records an AI-suggested allergen as MAY_CONTAIN only. Used by
// the resolver/ops tooling; enforced as MAY_CONTAIN both here and at the DB.
func (s *Service) SuggestAllergenAI(ctx context.Context, menuItemID, restaurantID, allergen string) error {
	allergen = strings.ToLower(strings.TrimSpace(allergen))
	if err := validateAllergen(allergen, DeclMayContain, AllergenSourceAI, false, false); err != nil {
		return err
	}
	decl := AllergenDeclaration{
		MenuItemID:      menuItemID,
		RestaurantID:    restaurantID,
		Allergen:        allergen,
		DeclarationType: DeclMayContain,
		Source:          AllergenSourceAI,
	}
	if err := s.repo.UpsertAllergen(ctx, decl); err != nil {
		return err
	}
	_ = s.repo.Audit(ctx, menuItemID, "", "ALLERGEN_AI_SUGGEST", nil,
		map[string]any{"allergen": allergen, "declaration_type": DeclMayContain},
		map[string]any{"source": AllergenSourceAI})
	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Stale + re-resolve.
// ─────────────────────────────────────────────────────────────────────────────

// MarkStale flags a dish's profile STALE (on a menu/recipe/version change). The
// caller is the trigger source (restaurant edit hook / admin version bump). It is
// guarded by the status machine; a freshly STALE profile is then re-resolved.
func (s *Service) MarkStale(ctx context.Context, menuItemID string) error {
	profile, err := s.repo.GetProfile(ctx, menuItemID)
	if err != nil {
		return err
	}
	if profile == nil {
		return nil // nothing to staleify
	}
	if profile.Status == StatusStale {
		return nil
	}
	if !CanTransition(profile.Status, StatusStale) {
		return fmt.Errorf("%w: cannot mark stale from %s", ErrBadState, profile.Status)
	}
	if err := s.repo.SetStatus(ctx, menuItemID, StatusStale, profile.Version); err != nil {
		return err
	}
	_ = s.repo.Audit(ctx, menuItemID, "", "NUTRITION_MARK_STALE",
		map[string]any{"status": string(profile.Status)}, map[string]any{"status": string(StatusStale)}, nil)
	return nil
}

// Reresolve runs a batch re-estimate (admin, on a composition version bump). It
// re-estimates AI_ESTIMATE + STALE profiles ONLY, leaving RESTAURANT_CONFIRMED +
// EXACT profiles intact (until the vendor re-confirms). Returns the count
// re-estimated.
func (s *Service) Reresolve(ctx context.Context, limit int) (int, error) {
	profiles, err := s.repo.ListAllProfiles(ctx, limit)
	if err != nil {
		return 0, err
	}
	count := 0
	for _, p := range profiles {
		// Only re-estimate AI_ESTIMATE + STALE; leave confirmed/exact intact.
		if p.Status != StatusAIEstimate && p.Status != StatusStale {
			continue
		}
		dish, derr := s.repo.DishInfo(ctx, p.MenuItemID)
		if derr != nil {
			continue
		}
		res, rerr := s.resolveDish(ctx, ResolveInput{MenuItemID: p.MenuItemID, DefaultPortionG: p.PortionSizeG}, dish.Name)
		if rerr != nil {
			continue
		}
		before, _ := s.repo.GetProfile(ctx, p.MenuItemID)
		out, aerr := s.applyResolved(ctx, dish, res)
		if aerr != nil {
			continue
		}
		// Count only when the profile actually changed (supersede may have kept it).
		if before == nil || out == nil || out.Version != before.Version {
			count++
		}
	}
	return count, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Cart summary — aggregate estimate with range propagation.
// ─────────────────────────────────────────────────────────────────────────────

// CartSummaryByIDs resolves each dish (lazily resolving a missing profile) and
// returns the aggregate estimate with range propagation + worst-case lights.
func (s *Service) CartSummaryByIDs(ctx context.Context, menuItemIDs []string) (*CartSummary, error) {
	var lines []CartLine
	for _, id := range menuItemIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		view, err := s.GetDishView(ctx, id)
		if err != nil {
			// Skip a missing/forbidden dish rather than failing the whole cart.
			continue
		}
		if view.Profile == nil {
			continue
		}
		lines = append(lines, CartLine{
			MenuItemID: id,
			Name:       view.Name,
			PerServing: view.Profile.PerServing,
			Grounding:  view.Profile.Grounding,
			Confidence: view.Profile.Confidence,
			Status:     view.Profile.Status,
		})
	}
	summary := AggregateCart(lines)
	return &summary, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: composition + library curation.
// ─────────────────────────────────────────────────────────────────────────────

// UpsertComposition appends a new versioned reference row (admin).
func (s *Service) UpsertComposition(ctx context.Context, actorID string, c Composition) (*Composition, error) {
	out, err := s.repo.UpsertComposition(ctx, c)
	if err != nil {
		return nil, err
	}
	_ = s.repo.Audit(ctx, "", actorID, "COMPOSITION_UPSERT", nil,
		map[string]any{"food_code": out.FoodCode, "source": out.Source, "version": out.Version}, nil)
	return out, nil
}

// UpsertLibrary curates a library entry (admin).
func (s *Service) UpsertLibrary(ctx context.Context, actorID string, e LibraryEntry) error {
	if err := s.repo.UpsertLibrary(ctx, e); err != nil {
		return err
	}
	_ = s.repo.Audit(ctx, "", actorID, "LIBRARY_UPSERT", nil, map[string]any{"slug": e.Slug}, nil)
	return nil
}

// profileBefore renders a profile as an audit "before" map (nil-safe).
func profileBefore(p *Profile) map[string]any {
	if p == nil {
		return nil
	}
	return map[string]any{
		"grounding":  string(p.Grounding),
		"confidence": string(p.Confidence), "status": string(p.Status),
	}
}
