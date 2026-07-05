package symptomsearch

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

// ─── Errors (handlers map these to HTTP statuses) ────────────────────────────

var (
	ErrNotFound   = errors.New("symptomsearch: not found")
	ErrConflict   = errors.New("symptomsearch: conflict")
	ErrValidation = errors.New("symptomsearch: invalid input")
	ErrForbidden  = errors.New("symptomsearch: forbidden")
)

// Auditor is the standard immutable-audit slice used across health modules
// (identical to healthpharmacy.Auditor). nil is safe — auditing is best-effort
// wiring, never a hard dependency.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// Repo is the persistence port. The production implementation is PgxRepo
// (repo_pgx.go, pgx pool per the health-module convention); tests use an
// in-memory fake so no DB is needed.
//
// Read-path contract (fail-closed): every method that feeds resolution returns
// ONLY status=APPROVED taxonomy rows, and LiveSkusForClass returns ONLY active,
// in-stock SKUs with classification OTC or PHARMACY_ONLY. The service
// re-filters SKU classification anyway (defence in depth).
type Repo interface {
	// resolution
	LookupApprovedTerms(ctx context.Context, normTerms []string) ([]Term, error)
	ConceptsByIDs(ctx context.Context, ids []string) ([]Concept, error)
	ClustersForConcepts(ctx context.Context, conceptIDs []string) ([]ClusterConceptMatch, error)
	ApprovedRulesForClusters(ctx context.Context, clusterIDs []string) ([]ClusterRule, error) // ordered by priority ASC
	ClassMapForClusters(ctx context.Context, clusterIDs []string) ([]ClassMapEntry, error)    // ordered by rank ASC
	ApprovedClassByID(ctx context.Context, classID string) (*TherapeuticClass, error)         // (nil, nil) when absent
	LiveSkusForClass(ctx context.Context, classID, region string, limit, offset int) ([]Sku, error)
	ActiveDisclaimer(ctx context.Context) (string, error)
	// InsertSearchEvent logs the query and returns the new row id — the client
	// carries it onto POST /pharmacy/orders as search_event_id.
	InsertSearchEvent(ctx context.Context, ev SearchEvent) (string, error)
	// SearchEventContext resolves a linked search event for the order seam and
	// the console case drawer. (nil, nil) when absent.
	SearchEventContext(ctx context.Context, id string) (*SearchEventContext, error)

	// review cases
	ReviewCaseByID(ctx context.Context, id string) (*PharmacyReviewCase, error)         // (nil, nil) when absent
	ReviewCaseByOrder(ctx context.Context, orderID string) (*PharmacyReviewCase, error) // (nil, nil) when absent
	// InsertReviewCase writes the case row AND its creation event
	// (from_state NULL → SUBMITTED) in the same transaction.
	InsertReviewCase(ctx context.Context, rc *PharmacyReviewCase, actorID string) error
	// TransitionReviewCase is the optimistic-lock CAS: returns false when the
	// row's version no longer matches (concurrent decision). On success it
	// appends the pharmacy_review_case_events row in the SAME transaction.
	TransitionReviewCase(ctx context.Context, id string, expectedVersion int, from, to ReviewState, actorID string, pharmacistID, note *string) (bool, error)
	// ListReviewCaseEvents reads the evented history, oldest first.
	ListReviewCaseEvents(ctx context.Context, caseID string) ([]ReviewStateEvent, error)
	ListReviewCases(ctx context.Context, state, providerID string, limit int) ([]PharmacyReviewCase, error)
	IsProviderPharmacist(ctx context.Context, userID, providerID string) (bool, error)

	// admin taxonomy (single suggest-approve write surface)
	UpsertTaxonomyRow(ctx context.Context, entity, action, actorID string, payload map[string]any) (map[string]any, error)
}

// Service is the symptom resolution + review-case engine.
type Service struct {
	repo  Repo
	audit Auditor
	now   func() time.Time
}

func NewService(repo Repo, audit Auditor) *Service {
	return &Service{repo: repo, audit: audit, now: time.Now}
}

func (s *Service) audited(actor, target, action, resourceType, resourceID string, oldV, newV map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actor, target, action, "health", resourceType, resourceID, oldV, newV, "", "", "info")
}

// defaultDisclaimer is the fallback when no versioned copy row is active. Copy
// discipline: "options for your symptoms", never "treatment for your condition".
const defaultDisclaimer = "These are options for your symptoms, not a diagnosis or treatment for your condition. A licensed pharmacist reviews orders where required. If symptoms persist or worsen, please see a doctor."

// memberBasePath is the mounted member prefix (mirrors health_pharmacy_routes).
const memberBasePath = "/api/finance/health/pharmacy"

// ─── Resolution pipeline (PRD §4) ────────────────────────────────────────────

// ResolveInput is the validated symptom-search request.
type ResolveInput struct {
	UserID     string
	DeviceHash string   // salted hash — never a raw device id (NDPR)
	Terms      []string // raw user terms; normalised here
	Who        string   // "" or a ValidCohorts value (explicit selection only)
	Duration   string   // "" or a ValidDurations value
}

// Resolve runs term → concept → cluster → rules → tier → class groups.
//
//   - Term normalisation: lower/trim/collapse-whitespace; only APPROVED
//     symptom_terms (all languages) match.
//   - Rules: all APPROVED rules of every matched cluster are evaluated in
//     priority order; every matching rule applies. ESCALATE only ever raises
//     the tier; REQUIRE_CONFIRMATION forces the T2 pharmacist gate;
//     SUPPRESS_CLASS removes a class entirely (suppressed, never disabled).
//     A malformed APPROVED rule escalates to T3 (fail-closed).
//   - Final tier = highest of (base cluster tiers, rule escalations).
//   - T1/T2 → class groups; T3 → consult card; T4 → emergency card, no commerce.
//   - Concepts matched but no cluster (or all classes suppressed) → T3 consult
//     card — never a dead end.
//   - Every search logs an aggregate-safe symptom_search_events row; unmatched
//     terms feed the synonym growth loop.
func (s *Service) Resolve(ctx context.Context, in ResolveInput) (*SymptomSearchResult, error) {
	norm := normalizeTerms(in.Terms)
	if len(norm) == 0 {
		return nil, fmt.Errorf("%w: at least one symptom term is required", ErrValidation)
	}
	if in.Who != "" && !ValidCohorts[in.Who] {
		return nil, fmt.Errorf("%w: unknown who refiner", ErrValidation)
	}
	if in.Duration != "" && !ValidDurations[in.Duration] {
		return nil, fmt.Errorf("%w: unknown duration refiner", ErrValidation)
	}

	disclaimer := s.disclaimer(ctx)

	// 1) terms → concepts (APPROVED terms only, any supported language)
	matchedTerms, err := s.repo.LookupApprovedTerms(ctx, norm)
	if err != nil {
		return nil, err
	}
	termByNorm := make(map[string]Term, len(matchedTerms))
	for _, t := range matchedTerms {
		termByNorm[normalizeTerm(t.Term)] = t
	}
	conceptIDSet := map[string]bool{}
	var unmatched []string
	for _, n := range norm {
		if t, ok := termByNorm[n]; ok {
			conceptIDSet[t.ConceptID] = true
		} else {
			unmatched = append(unmatched, n)
		}
	}

	// Zero taxonomy match → contract 404 upstream, but still a T3 consult card
	// (never a dead end) and an unmatched-terms event for the curation loop.
	if len(conceptIDSet) == 0 {
		res := s.consultResult(nil,
			[]string{"we could not match what you typed — a pharmacist can help you directly"}, disclaimer)
		res.Unmatched = true
		s.logEvent(ctx, in, norm, false, res, unmatched)
		return res, nil
	}

	conceptIDs := sortedKeys(conceptIDSet)
	concepts, err := s.repo.ConceptsByIDs(ctx, conceptIDs)
	if err != nil {
		return nil, err
	}
	conceptCodes := map[string]bool{}
	conceptNameByID := map[string]string{}
	for _, c := range concepts {
		conceptCodes[c.Code] = true
		conceptNameByID[c.ID] = c.Name
	}

	// 2) concepts → candidate clusters (ANY member concept matched)
	matches, err := s.repo.ClustersForConcepts(ctx, conceptIDs)
	if err != nil {
		return nil, err
	}
	type clusterAgg struct {
		cluster  Cluster
		concepts []string
	}
	aggByID := map[string]*clusterAgg{}
	var clusterIDs []string
	for _, m := range matches {
		agg, ok := aggByID[m.ClusterID]
		if !ok {
			agg = &clusterAgg{cluster: Cluster{ID: m.ClusterID, Code: m.ClusterCode, Name: m.ClusterName, TriageTier: m.TriageTier}}
			aggByID[m.ClusterID] = agg
			clusterIDs = append(clusterIDs, m.ClusterID)
		}
		if name := conceptNameByID[m.ConceptID]; name != "" {
			agg.concepts = append(agg.concepts, name)
		}
	}
	sort.Strings(clusterIDs)

	// Concepts matched but no cluster → T3 consult, never a dead end.
	if len(clusterIDs) == 0 {
		res := s.consultResult(nil,
			[]string{"your symptoms need a professional look before we can suggest options"}, disclaimer)
		s.logEvent(ctx, in, norm, true, res, unmatched)
		return res, nil
	}

	clusterMatches := make([]SymptomClusterMatch, 0, len(clusterIDs))
	tier := TierT1
	for _, id := range clusterIDs {
		agg := aggByID[id]
		sort.Strings(agg.concepts)
		clusterMatches = append(clusterMatches, SymptomClusterMatch{
			ID: agg.cluster.ID, Name: agg.cluster.Name,
			TriageTier: agg.cluster.TriageTier, MatchedConcepts: agg.concepts,
		})
		tier = maxTier(tier, agg.cluster.TriageTier) // base tier: highest wins
	}

	// 3) evaluate APPROVED rules in priority order — all matching rules apply
	evalCtx := &EvalContext{
		Concepts:     conceptCodes,
		Who:          in.Who,
		DurationDays: durationDaysByBucket[in.Duration], // 0 when absent
		TermCount:    len(norm),
	}
	rules, err := s.repo.ApprovedRulesForClusters(ctx, clusterIDs)
	if err != nil {
		return nil, err
	}
	var flagged []string
	confirm := false
	suppressed := map[string]bool{}
	for _, r := range rules {
		hit, perr := EvaluateExpression(r.Expression, evalCtx)
		if perr != nil {
			// FAIL-CLOSED: a broken APPROVED safety rule escalates, never skips.
			tier = maxTier(tier, TierT3)
			flagged = append(flagged, "a safety check could not be completed — escalated for professional review")
			continue
		}
		if !hit {
			continue
		}
		switch r.Effect {
		case EffectEscalate:
			to := TierT3 // fail-closed default if the effect row is malformed
			if r.EscalateToTier != nil && tierRank(Tier(*r.EscalateToTier)) > 0 {
				to = Tier(*r.EscalateToTier)
			}
			tier = maxTier(tier, to) // tier only ever goes UP
			if r.Reason != "" {
				flagged = append(flagged, r.Reason)
			}
		case EffectRequireConfirmation:
			confirm = true
			tier = maxTier(tier, TierT2) // the mandatory pharmacist gate is T2
			if r.Reason != "" {
				flagged = append(flagged, r.Reason)
			}
		case EffectSuppressClass:
			if r.SuppressClassID != nil {
				suppressed[*r.SuppressClassID] = true
			}
		}
	}

	result := &SymptomSearchResult{Tier: tier, Clusters: clusterMatches, Disclaimer: disclaimer}

	switch {
	case tier == TierT4:
		// Emergency: guidance + nearest facility. NO commerce on this surface.
		result.EscalationCard = emergencyCard(flagged)
	case tier == TierT3:
		result.EscalationCard = consultCard(flagged)
	default:
		// 4) T1/T2 → therapeutic class groups (suppressed classes are absent)
		entries, err := s.repo.ClassMapForClusters(ctx, clusterIDs)
		if err != nil {
			return nil, err
		}
		groups := buildClassGroups(entries, suppressed)
		if len(groups) == 0 {
			// Everything suppressed / nothing mapped → consult, never a dead end.
			result.Tier = TierT3
			result.EscalationCard = consultCard(append(flagged,
				"no suitable over-the-counter option for your situation — please speak to a pharmacist"))
		} else {
			result.ClassGroups = groups
			result.PharmacistConfirmationRequired = confirm || result.Tier == TierT2
			if result.PharmacistConfirmationRequired {
				result.Tier = maxTier(result.Tier, TierT2)
			}
		}
	}

	s.logEvent(ctx, in, norm, true, result, unmatched)
	return result, nil
}

// buildClassGroups dedupes by class (best rank wins), drops suppressed classes
// entirely, and orders by rank then name. Suppressed = absent, never disabled.
func buildClassGroups(entries []ClassMapEntry, suppressed map[string]bool) []SymptomClassGroup {
	best := map[string]ClassMapEntry{}
	for _, e := range entries {
		if suppressed[e.ClassID] {
			continue
		}
		if cur, ok := best[e.ClassID]; !ok || e.Rank < cur.Rank {
			best[e.ClassID] = e
		}
	}
	groups := make([]SymptomClassGroup, 0, len(best))
	for _, e := range best {
		groups = append(groups, SymptomClassGroup{
			ClassID:   e.ClassID,
			Name:      e.ClassName,
			Rank:      e.Rank,
			UsageNote: e.UsageNote,
			SkusURL:   memberBasePath + "/classes/" + e.ClassID + "/skus",
		})
	}
	sort.Slice(groups, func(i, j int) bool {
		if groups[i].Rank != groups[j].Rank {
			return groups[i].Rank < groups[j].Rank
		}
		return groups[i].Name < groups[j].Name
	})
	return groups
}

// consultCard is the T3 card: no products; route to pharmacist chat (existing
// pre-consult intake) and telehealth. POM demand capture: the prescription
// upload path is the existing e-Rx flow (POST /api/finance/health/pharmacy/
// prescriptions/:id/verify after upload via healthrx) — the contract's action
// enum has no PRESCRIPTION_UPLOAD type, so the telehealth consult action is the
// prescription-originating route (a consult that ends in an e-Rx unlocks the
// POM order from the consult, never from search).
func consultCard(flagged []string) *SymptomEscalationCard {
	if len(flagged) == 0 {
		flagged = []string{"your symptoms need a professional review"}
	}
	return &SymptomEscalationCard{
		Severity: "CONSULT",
		Flagged:  flagged,
		Actions: []EscalationAction{
			{Type: "PHARMACIST_CHAT", Label: "Start free pharmacist chat now", Target: "/health/intake/preconsult"},
			{Type: "TELEHEALTH_CONSULT", Label: "Book a telehealth consult (can issue a prescription)", Target: "/health/consult"},
		},
	}
}

// emergencyCard is the T4 card: emergency guidance + nearest facility via the
// MapService surface. No commerce UI on this screen — ever.
func emergencyCard(flagged []string) *SymptomEscalationCard {
	if len(flagged) == 0 {
		flagged = []string{"this can be an emergency"}
	}
	return &SymptomEscalationCard{
		Severity: "EMERGENCY",
		Flagged:  flagged,
		Actions: []EscalationAction{
			{Type: "EMERGENCY_GUIDANCE", Label: "What to do right now", Target: "/health/emergency"},
			{Type: "NEAREST_FACILITY", Label: "Find the nearest facility", Target: "/maps/facilities?type=emergency"},
		},
	}
}

func (s *Service) consultResult(clusters []SymptomClusterMatch, flagged []string, disclaimer string) *SymptomSearchResult {
	return &SymptomSearchResult{
		Tier:           TierT3,
		Clusters:       clusters,
		EscalationCard: consultCard(flagged),
		Disclaimer:     disclaimer,
	}
}

func (s *Service) disclaimer(ctx context.Context) string {
	body, err := s.repo.ActiveDisclaimer(ctx)
	if err != nil || strings.TrimSpace(body) == "" {
		return defaultDisclaimer
	}
	return body
}

// logEvent writes the NDPR-scoped query log (service-role-only table) and, on
// success, stamps the event id onto the result so the client can link a
// subsequent order (POST /pharmacy/orders search_event_id) back to this
// search. Best effort — a logging failure never breaks the user flow (the
// result then simply carries no search_event_id). No free-text PII beyond the
// normalised terms.
func (s *Service) logEvent(ctx context.Context, in ResolveInput, norm []string, matched bool, res *SymptomSearchResult, unmatched []string) {
	var userID *string
	if in.UserID != "" {
		u := in.UserID
		userID = &u
	}
	refiners := map[string]any{}
	if in.Who != "" {
		refiners["who"] = in.Who
	}
	if in.Duration != "" {
		refiners["duration"] = in.Duration
	}
	t := string(res.Tier)
	if unmatched == nil {
		unmatched = []string{}
	}
	id, err := s.repo.InsertSearchEvent(ctx, SearchEvent{
		UserID:          userID,
		DeviceHash:      in.DeviceHash,
		Terms:           norm,
		Refiners:        refiners,
		Matched:         matched,
		ResolvedTier:    &t,
		UnmatchedTerms:  unmatched,
		MatchedConcepts: conceptUnion(res.Clusters),
		ClusterName:     primaryClusterName(res.Clusters),
	})
	if err == nil && id != "" {
		res.SearchEventID = id
	}
}

// conceptUnion dedupes the matched concept names across clusters (sorted) —
// the console-facing snapshot of what the search resolved to.
func conceptUnion(clusters []SymptomClusterMatch) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, c := range clusters {
		for _, n := range c.MatchedConcepts {
			if n != "" && !seen[n] {
				seen[n] = true
				out = append(out, n)
			}
		}
	}
	sort.Strings(out)
	return out
}

// primaryClusterName picks the highest-tier matched cluster (ties: first).
func primaryClusterName(clusters []SymptomClusterMatch) *string {
	var best *SymptomClusterMatch
	for i := range clusters {
		if best == nil || tierRank(clusters[i].TriageTier) > tierRank(best.TriageTier) {
			best = &clusters[i]
		}
	}
	if best == nil {
		return nil
	}
	n := best.Name
	return &n
}

// ─── Class → live SKUs (query-time stock/region/price) ───────────────────────

// ListClassSkus resolves a therapeutic class to live SKUs. Server-side gates:
// class must be APPROVED; SKUs must be active + in stock; classification must
// be OTC or PHARMACY_ONLY (POM/BLOCKED_ONLINE are excluded in SQL and
// re-filtered here — illegal states unreachable); cohort flags (age_min_years,
// pregnancy_safe) suppress unsuitable SKUs fail-closed.
func (s *Service) ListClassSkus(ctx context.Context, classID, region, who string, limit, offset int) ([]PharmacySkuOption, error) {
	if who != "" && !ValidCohorts[who] {
		return nil, fmt.Errorf("%w: unknown who refiner", ErrValidation)
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	cls, err := s.repo.ApprovedClassByID(ctx, classID)
	if err != nil {
		return nil, err
	}
	if cls == nil {
		return nil, fmt.Errorf("%w: unknown or inactive therapeutic class", ErrNotFound)
	}
	skus, err := s.repo.LiveSkusForClass(ctx, classID, region, limit, offset)
	if err != nil {
		return nil, err
	}
	out := make([]PharmacySkuOption, 0, len(skus))
	for _, sku := range skus {
		if !skuAllowedForCohort(sku, who) {
			continue
		}
		out = append(out, PharmacySkuOption{
			ID:                 sku.ID,
			ProductID:          sku.ProductID,
			Name:               sku.Name,
			Brand:              sku.Brand,
			PackSize:           sku.PackSize,
			PriceKobo:          sku.PriceKobo,
			NAFDACRegNo:        sku.NAFDACRegNo,
			Classification:     sku.Classification,
			TherapeuticClassID: sku.TherapeuticClassID,
			InStock:            sku.InStock,
			MaxQtyPerWindow:    sku.MaxQtyPerWindow,
		})
	}
	return out, nil
}

// skuAllowedForCohort applies the hard SKU gates. Defence in depth: even if a
// repo implementation leaks a POM/BLOCKED_ONLINE row, it never leaves here.
func skuAllowedForCohort(sku Sku, who string) bool {
	if sku.Classification != ClassificationOTC && sku.Classification != ClassificationPharmacyOnly {
		return false // POM / BLOCKED_ONLINE never surface from symptom search
	}
	if !sku.InStock {
		return false
	}
	switch who {
	case CohortPregnantOrBF:
		if !sku.PregnancySafe { // fail-closed default false in the schema
			return false
		}
	case CohortChildUnder6:
		// Conservative: any declared minimum age excludes the under-6 cohort.
		if sku.AgeMinYears != nil && *sku.AgeMinYears > 0 {
			return false
		}
	case CohortChild6to12:
		// Conservative: safe for the youngest of the bracket (6 years).
		if sku.AgeMinYears != nil && *sku.AgeMinYears > 6 {
			return false
		}
	}
	return true
}

// ─── helpers ─────────────────────────────────────────────────────────────────

// normalizeTerm lowercases, trims and collapses internal whitespace — matching
// the DB's lower(btrim(term)) lookup index semantics.
func normalizeTerm(s string) string {
	return strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(s))), " ")
}

// normalizeTerms normalises, drops empties and dedupes preserving order.
func normalizeTerms(terms []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(terms))
	for _, t := range terms {
		n := normalizeTerm(t)
		if n == "" || seen[n] {
			continue
		}
		seen[n] = true
		out = append(out, n)
	}
	return out
}

func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
