// Package symptomsearch implements the Pharmacy Symptom-Based Medication Search
// addon (docs/health/Pharmacy_Symptom_Search_Addon_PRD.md).
//
// It is symptom-guided product DISCOVERY with pharmacist-in-the-loop gating —
// NOT diagnosis and NOT prescribing. Resolution pipeline:
//
//	term → concept → condition cluster (triage tier T1–T4) → therapeutic class → live SKUs
//
// Iron rules encoded here:
//   - Only APPROVED taxonomy rows are ever user-visible (AI suggest-approve).
//   - T3/T4 never return products — an escalation card routes to care instead.
//   - POM / BLOCKED_ONLINE SKUs never appear on this surface (fail-closed;
//     classification defaults to BLOCKED_ONLINE in the schema).
//   - Cohort-excluded classes are SUPPRESSED, never shown-but-disabled.
//   - An APPROVED rule that fails to parse forces escalation to T3 (fail-closed).
//   - Tiers only ever go UP during rule evaluation.
//
// Tables (supabase/migrations/20260827000000_pharmacy_symptom_search.sql):
// symptom_concepts, symptom_terms, symptom_clusters, symptom_cluster_concepts,
// therapeutic_classes, symptom_cluster_rules, symptom_cluster_class_map,
// pharmacy_skus, pharmacy_review_cases, symptom_search_events,
// symptom_disclaimer_versions.
package symptomsearch

import "time"

// ─── Triage tiers ────────────────────────────────────────────────────────────

// Tier is the triage tier every resolution lands in (exactly one).
// T1 self-care · T2 pharmacist-guided · T3 consult required · T4 emergency.
type Tier string

const (
	TierT1 Tier = "T1"
	TierT2 Tier = "T2"
	TierT3 Tier = "T3"
	TierT4 Tier = "T4"
)

func tierRank(t Tier) int {
	switch t {
	case TierT1:
		return 1
	case TierT2:
		return 2
	case TierT3:
		return 3
	case TierT4:
		return 4
	}
	return 0
}

// maxTier returns the higher of two tiers — tiers only ever go UP.
func maxTier(a, b Tier) Tier {
	if tierRank(b) > tierRank(a) {
		return b
	}
	return a
}

// ─── Refiners ────────────────────────────────────────────────────────────────

// Cohort refiners. who: rules only fire when the cohort is EXPLICITLY selected.
const (
	CohortAdult        = "ADULT"
	CohortChild6to12   = "CHILD_6_12"
	CohortChildUnder6  = "CHILD_UNDER_6"
	CohortPregnantOrBF = "PREGNANT_OR_BF"
)

// ValidCohorts is the closed who: refiner vocabulary.
var ValidCohorts = map[string]bool{
	CohortAdult:        true,
	CohortChild6to12:   true,
	CohortChildUnder6:  true,
	CohortPregnantOrBF: true,
}

// durationDaysByBucket maps the duration refiner to days for rule comparators
// (TODAY→1, D2_3→3, GT_3D→4 per the migration header).
var durationDaysByBucket = map[string]int{
	"TODAY": 1,
	"D2_3":  3,
	"GT_3D": 4,
}

// ValidDurations is the closed duration refiner vocabulary.
var ValidDurations = map[string]bool{"TODAY": true, "D2_3": true, "GT_3D": true}

// ─── Taxonomy statuses / enums (TEXT+CHECK in the schema) ────────────────────

const (
	StatusAISuggested = "AI_SUGGESTED"
	StatusApproved    = "APPROVED"
	StatusRetired     = "RETIRED"
)

// SKU classification — hard server-side gates. Only OTC and PHARMACY_ONLY are
// ever returned by symptom search; POM/BLOCKED_ONLINE are filtered in SQL AND
// re-filtered in Go (defence in depth).
const (
	ClassificationOTC           = "OTC"
	ClassificationPharmacyOnly  = "PHARMACY_ONLY"
	ClassificationPOM           = "POM"
	ClassificationBlockedOnline = "BLOCKED_ONLINE"
)

// Rule effects.
const (
	EffectEscalate            = "ESCALATE"
	EffectRequireConfirmation = "REQUIRE_CONFIRMATION"
	EffectSuppressClass       = "SUPPRESS_CLASS"
)

// validLanguages mirrors the symptom_terms language CHECK.
var validLanguages = map[string]bool{"en": true, "pcm": true, "ha": true, "yo": true, "ig": true}

// ─── Taxonomy rows (mirror the migration tables) ─────────────────────────────

// Concept is a canonical clinical concept (symptom_concepts).
type Concept struct {
	ID          string `json:"id"`
	Code        string `json:"code"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Status      string `json:"status"`
	Version     int    `json:"version"`
}

// Term is a multilingual surface form mapping raw input to a concept
// (symptom_terms).
type Term struct {
	ID        string `json:"id"`
	Term      string `json:"term"`
	Language  string `json:"language"`
	ConceptID string `json:"concept_id"`
	Status    string `json:"status"`
}

// Cluster is a condition cluster carrying the BASE triage tier
// (symptom_clusters).
type Cluster struct {
	ID         string `json:"id"`
	Code       string `json:"code"`
	Name       string `json:"name"`
	TriageTier Tier   `json:"triage_tier"`
	Status     string `json:"status"`
}

// ClusterConceptMatch is one (approved cluster, matched concept) join row from
// symptom_cluster_concepts — a cluster matches when ANY member concept matched.
type ClusterConceptMatch struct {
	ClusterID   string
	ClusterCode string
	ClusterName string
	TriageTier  Tier
	ConceptID   string
}

// ClusterRule is an expression-driven refinement on a matched cluster
// (symptom_cluster_rules). Exactly one effect shape per row (CHECK-enforced).
type ClusterRule struct {
	ID              string  `json:"id"`
	ClusterID       string  `json:"cluster_id"`
	Expression      string  `json:"expression"`
	Priority        int     `json:"priority"`
	Effect          string  `json:"effect"`
	EscalateToTier  *string `json:"escalate_to_tier,omitempty"`
	SuppressClassID *string `json:"suppress_class_id,omitempty"`
	Reason          string  `json:"reason"`
	Status          string  `json:"status"`
}

// TherapeuticClass is a product class group (therapeutic_classes).
type TherapeuticClass struct {
	ID        string `json:"id"`
	Code      string `json:"code"`
	Name      string `json:"name"`
	UsageNote string `json:"usage_note"` // label-level guidance ONLY, never dosing advice
	Status    string `json:"status"`
}

// ClassMapEntry is one cluster→class surface row (symptom_cluster_class_map)
// joined with its APPROVED therapeutic class.
type ClassMapEntry struct {
	ClusterID string
	ClassID   string
	Rank      int
	ClassName string
	UsageNote string
}

// Sku is a pharmacy_skus row joined with its pharmacy_products parent.
type Sku struct {
	ID                 string
	ProductID          string
	Name               string // pharmacy_products.name
	Brand              string
	PackSize           string
	PriceKobo          int64 // minor units, never floats
	NAFDACRegNo        string
	Classification     string
	TherapeuticClassID string
	Region             string
	InStock            bool
	AgeMinYears        *int
	PregnancySafe      bool
	MaxQtyPerWindow    *int
}

// ─── API DTOs (contracts/openapi.yaml shapes) ────────────────────────────────

// SymptomSearchResult is the POST /pharmacy/symptom-search response body
// (components/schemas/SymptomSearchResult).
type SymptomSearchResult struct {
	Tier           Tier                   `json:"tier"`
	Clusters       []SymptomClusterMatch  `json:"clusters,omitempty"`
	ClassGroups    []SymptomClassGroup    `json:"class_groups,omitempty"`
	EscalationCard *SymptomEscalationCard `json:"escalation_card,omitempty"`
	// true for every T2 result — checkout is blocked until a pharmacist confirms.
	PharmacistConfirmationRequired bool   `json:"pharmacist_confirmation_required"`
	Disclaimer                     string `json:"disclaimer"`
	// SearchEventID is the id of the logged symptom_search_events row. The
	// client attaches it to POST /pharmacy/orders (search_event_id) so the
	// review case carries the search context and the tier is resolved from the
	// ACTUAL search. Empty when event logging failed (best-effort).
	SearchEventID string `json:"search_event_id,omitempty"`
	// Unmatched is true when NO term matched the taxonomy at all — the handler
	// maps this to the contract's 404 (the T3 card is still populated so the
	// flow is never a dead end for internal callers). Not serialised.
	Unmatched bool `json:"-"`
}

// SymptomClusterMatch mirrors components/schemas/SymptomClusterMatch.
type SymptomClusterMatch struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	TriageTier      Tier     `json:"triage_tier"`
	MatchedConcepts []string `json:"matched_concepts"`
}

// SymptomClassGroup mirrors components/schemas/SymptomClassGroup. Suppressed
// classes are simply absent — never shown-but-disabled.
type SymptomClassGroup struct {
	ClassID   string `json:"class_id"`
	Name      string `json:"name"`
	Rank      int    `json:"rank"`
	UsageNote string `json:"usage_note"`
	SkusURL   string `json:"skus_url"`
}

// EscalationAction is one routing action on an escalation card. Types per the
// contract enum: PHARMACIST_CHAT, TELEHEALTH_CONSULT, EMERGENCY_GUIDANCE,
// NEAREST_FACILITY.
type EscalationAction struct {
	Type   string `json:"type"`
	Label  string `json:"label"`
	Target string `json:"target"`
}

// SymptomEscalationCard mirrors components/schemas/SymptomEscalationCard —
// returned for T3/T4, explains what was flagged, routes to care, NO products.
type SymptomEscalationCard struct {
	Severity string             `json:"severity"` // CONSULT | EMERGENCY
	Flagged  []string           `json:"flagged"`
	Actions  []EscalationAction `json:"actions"`
}

// PharmacySkuOption mirrors components/schemas/PharmacySkuOption. POM and
// BLOCKED_ONLINE never appear here.
type PharmacySkuOption struct {
	ID                 string `json:"id"`
	ProductID          string `json:"product_id"`
	Name               string `json:"name"`
	Brand              string `json:"brand"`
	PackSize           string `json:"pack_size"`
	PriceKobo          int64  `json:"price_kobo"`
	NAFDACRegNo        string `json:"nafdac_reg_no"`
	Classification     string `json:"classification"` // OTC | PHARMACY_ONLY only
	TherapeuticClassID string `json:"therapeutic_class_id"`
	InStock            bool   `json:"in_stock"`
	MaxQtyPerWindow    *int   `json:"max_qty_per_window"`
}

// ─── Review-case state machine (pharmacy_review_cases) ───────────────────────

// ReviewState is the gated review state machine (PRD §6):
//
//	SUBMITTED → AUTO_CLEARED (T1) | PHARMACIST_REVIEW (T2/POM)
//	PHARMACIST_REVIEW → APPROVED | REJECTED | NEEDS_INFO
//	NEEDS_INFO → PHARMACIST_REVIEW
//
// Guarded transitions only — anything not in the map is rejected.
type ReviewState string

const (
	ReviewSubmitted        ReviewState = "SUBMITTED"
	ReviewAutoCleared      ReviewState = "AUTO_CLEARED"
	ReviewPharmacistReview ReviewState = "PHARMACIST_REVIEW"
	ReviewNeedsInfo        ReviewState = "NEEDS_INFO"
	ReviewApproved         ReviewState = "APPROVED"
	ReviewRejected         ReviewState = "REJECTED"
)

// allowedReviewTransitions is the explicit legal-edge map. REJECTED triggers
// the order refund path in the pharmacy order flow (ledger reversal entries —
// never a balance edit); that side effect is owned by the order module.
var allowedReviewTransitions = map[ReviewState]map[ReviewState]bool{
	ReviewSubmitted:        {ReviewAutoCleared: true, ReviewPharmacistReview: true},
	ReviewAutoCleared:      {},
	ReviewPharmacistReview: {ReviewApproved: true, ReviewRejected: true, ReviewNeedsInfo: true},
	ReviewNeedsInfo:        {ReviewPharmacistReview: true},
	ReviewApproved:         {},
	ReviewRejected:         {},
}

// CanTransitionReview reports whether from→to is a legal review-case edge.
func CanTransitionReview(from, to ReviewState) bool {
	next, ok := allowedReviewTransitions[from]
	if !ok {
		return false
	}
	return next[to]
}

// PharmacyReviewCase mirrors components/schemas/PharmacyReviewCase (+
// pharmacy_provider_id for object-level authz, additive to the contract).
type PharmacyReviewCase struct {
	ID                 string      `json:"id"`
	OrderID            string      `json:"order_id"`
	PharmacyProviderID string      `json:"pharmacy_provider_id"`
	Tier               Tier        `json:"tier"`
	State              ReviewState `json:"state"`
	PharmacistID       *string     `json:"pharmacist_id"`
	DecisionNote       *string     `json:"decision_note"`
	SLADeadline        time.Time   `json:"sla_deadline"`
	// SearchEventID links the case to the originating symptom_search_events
	// row (nil for orders without search context, e.g. catalogue POM orders).
	SearchEventID *string   `json:"search_event_id,omitempty"`
	Version       int       `json:"-"` // optimistic lock, internal
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// ─── NDPR-sensitive search event (symptom_search_events) ─────────────────────

// SearchEvent is one aggregate-safe query-log row. It carries the normalised
// terms + refiners (sensitive health data — service_role-only table, excluded
// from general analytics) and the unmatched terms for the synonym growth loop.
// No free-text PII beyond the terms themselves.
type SearchEvent struct {
	UserID         *string
	DeviceHash     string // salted hash, never a raw device id
	Terms          []string
	Refiners       map[string]any
	Matched        bool
	ResolvedTier   *string
	UnmatchedTerms []string
	// Resolution snapshot for the pharmacist console (the taxonomy may change
	// after the search, so the event pins what was matched at the time).
	MatchedConcepts []string
	ClusterName     *string // primary (highest-tier) matched cluster
}

// SearchEventContext is the console/order-seam projection of one
// symptom_search_events row, linked via search_event_id.
type SearchEventContext struct {
	ID string
	// UserID is the searcher (nil for rows predating the ownership check).
	// The order seam refuses to link an event owned by a DIFFERENT user onto
	// an order — a client-supplied search_event_id must be the orderer's own.
	UserID          *string
	Terms           []string
	MatchedConcepts []string
	ClusterName     *string
	CohortFlags     []string // explicitly selected cohort refiners (refiners.who)
	ResolvedTier    *string
}
