package symptomsearch

// Pharmacist-console taxonomy write surface (POST /admin/pharmacy/mappings):
// one suggest-approve endpoint for terms, concepts, clusters, cluster rules,
// therapeutic classes and cluster→class maps. Invariants:
//
//   - create ⇒ status AI_SUGGESTED (nothing AI-drafted is user-visible until a
//     licensed pharmacist approves it).
//   - approve ⇒ stamps approved_by (from auth context) + approved_at.
//   - update of an APPROVED row RESETS it to AI_SUGGESTED and clears the
//     approval stamps — content changes always need re-approval.
//   - retire, never delete — taxonomy rows are never hard-deleted (the
//     cluster_class_map join rows are the one exception: they carry no status
//     column, so retire removes the mapping row).
//   - cluster_rule expressions are parsed at WRITE time — a malformed rule
//     never enters the table (and the read path still fails closed anyway).
//
// Every successful write emits an audit event with the acting pharmacist.

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

var taxonomyEntities = map[string]bool{
	"term": true, "concept": true, "cluster": true,
	"cluster_rule": true, "therapeutic_class": true, "cluster_class_map": true,
}

var taxonomyActions = map[string]bool{
	"create": true, "update": true, "approve": true, "retire": true,
}

// AdminUpsertMapping is the single taxonomy write path (RBAC
// health.pharmacy.symptom.mappings is enforced at the route).
func (s *Service) AdminUpsertMapping(ctx context.Context, actorID, entity, action string, payload map[string]any) (map[string]any, error) {
	if actorID == "" {
		return nil, fmt.Errorf("%w: unauthenticated", ErrForbidden)
	}
	if !taxonomyEntities[entity] {
		return nil, fmt.Errorf("%w: unknown entity %q", ErrValidation, entity)
	}
	if !taxonomyActions[action] {
		return nil, fmt.Errorf("%w: unknown action %q", ErrValidation, action)
	}
	if payload == nil {
		payload = map[string]any{}
	}
	if entity == "cluster_class_map" && action == "approve" {
		return nil, fmt.Errorf("%w: cluster_class_map has no approval lifecycle — use create/update/retire", ErrValidation)
	}
	if action == "create" || action == "update" {
		if err := validateTaxonomyPayload(entity, payload); err != nil {
			return nil, err
		}
	}
	if action == "approve" || action == "retire" || action == "update" {
		if entity != "cluster_class_map" && !isUUID(getString(payload, "id")) {
			return nil, fmt.Errorf("%w: payload.id (uuid) is required for %s", ErrValidation, action)
		}
	}

	row, err := s.repo.UpsertTaxonomyRow(ctx, entity, action, actorID, payload)
	if err != nil {
		return nil, err
	}
	s.audited(actorID, "", "health.pharmacy.symptom.mapping."+action, "symptom_taxonomy_"+entity,
		getString(row, "id"), nil, map[string]any{"entity": entity, "action": action})
	return row, nil
}

// validateTaxonomyPayload rejects malformed create/update payloads before they
// reach the repo (the schema CHECKs are the backstop, not the front door).
func validateTaxonomyPayload(entity string, p map[string]any) error {
	switch entity {
	case "term":
		term := strings.TrimSpace(getString(p, "term"))
		if len(term) < 2 || len(term) > 80 {
			return fmt.Errorf("%w: term must be 2–80 characters", ErrValidation)
		}
		if !validLanguages[getString(p, "language")] {
			return fmt.Errorf("%w: language must be one of en, pcm, ha, yo, ig", ErrValidation)
		}
		if !isUUID(getString(p, "concept_id")) {
			return fmt.Errorf("%w: concept_id (uuid) is required", ErrValidation)
		}
	case "concept":
		if !isValidConceptCode(getString(p, "code")) {
			return fmt.Errorf("%w: code must match [a-z][a-z0-9_]*", ErrValidation)
		}
		if strings.TrimSpace(getString(p, "name")) == "" {
			return fmt.Errorf("%w: name is required", ErrValidation)
		}
	case "cluster":
		if !isValidConceptCode(getString(p, "code")) {
			return fmt.Errorf("%w: code must match [a-z][a-z0-9_]*", ErrValidation)
		}
		if strings.TrimSpace(getString(p, "name")) == "" {
			return fmt.Errorf("%w: name is required", ErrValidation)
		}
		if tierRank(Tier(getString(p, "triage_tier"))) == 0 {
			return fmt.Errorf("%w: triage_tier must be T1, T2, T3 or T4", ErrValidation)
		}
	case "therapeutic_class":
		if !isValidConceptCode(getString(p, "code")) {
			return fmt.Errorf("%w: code must match [a-z][a-z0-9_]*", ErrValidation)
		}
		if strings.TrimSpace(getString(p, "name")) == "" {
			return fmt.Errorf("%w: name is required", ErrValidation)
		}
	case "cluster_rule":
		if !isUUID(getString(p, "cluster_id")) {
			return fmt.Errorf("%w: cluster_id (uuid) is required", ErrValidation)
		}
		expr := strings.TrimSpace(getString(p, "expression"))
		if expr == "" || len(expr) > 500 {
			return fmt.Errorf("%w: expression must be 1–500 characters", ErrValidation)
		}
		if _, err := ParseRule(expr); err != nil {
			return fmt.Errorf("%w: expression does not parse: %v", ErrValidation, err)
		}
		// Effect shape — illegal states unreachable (mirrors the schema CHECK).
		escalateTo := getString(p, "escalate_to_tier")
		suppressID := getString(p, "suppress_class_id")
		switch getString(p, "effect") {
		case EffectEscalate:
			if escalateTo != "T2" && escalateTo != "T3" && escalateTo != "T4" {
				return fmt.Errorf("%w: ESCALATE requires escalate_to_tier of T2, T3 or T4", ErrValidation)
			}
			if suppressID != "" {
				return fmt.Errorf("%w: ESCALATE must not carry suppress_class_id", ErrValidation)
			}
		case EffectSuppressClass:
			if !isUUID(suppressID) {
				return fmt.Errorf("%w: SUPPRESS_CLASS requires suppress_class_id (uuid)", ErrValidation)
			}
			if escalateTo != "" {
				return fmt.Errorf("%w: SUPPRESS_CLASS must not carry escalate_to_tier", ErrValidation)
			}
		case EffectRequireConfirmation:
			if escalateTo != "" || suppressID != "" {
				return fmt.Errorf("%w: REQUIRE_CONFIRMATION carries no tier or class", ErrValidation)
			}
		default:
			return fmt.Errorf("%w: effect must be ESCALATE, REQUIRE_CONFIRMATION or SUPPRESS_CLASS", ErrValidation)
		}
	case "cluster_class_map":
		if !isUUID(getString(p, "cluster_id")) || !isUUID(getString(p, "class_id")) {
			return fmt.Errorf("%w: cluster_id and class_id (uuids) are required", ErrValidation)
		}
		if r := getInt(p, "rank", 1); r < 1 {
			return fmt.Errorf("%w: rank must be >= 1", ErrValidation)
		}
	}
	return nil
}

// ─── Console read surface (GET /symptom/reviews/:id, GET /symptom/mappings) ──
//
// Read-only views for the pharmacist console. These live behind the same RBAC
// permissions as their write counterparts and are served by the production
// PgxRepo via the optional adminReader port (the in-memory test fake does not
// need to implement it).

// ReviewCartLine is one order line in the review-case drawer (pharmacy_order_lines
// snapshot; money in kobo, never floats).
type ReviewCartLine struct {
	ProductName    string  `json:"product_name"`
	NAFDACRegNo    *string `json:"nafdac_reg_no"`
	Classification string  `json:"classification"` // OTC | PHARMACY_ONLY | POM (rx_required snapshot)
	Qty            int     `json:"qty"`
	UnitPriceKobo  int64   `json:"unit_price_kobo"`
	LineTotalKobo  int64   `json:"line_total_kobo"`
}

// ReviewStateEvent is one step of the case's state history, read from
// pharmacy_review_case_events (one row per transition, written in the same
// transaction as the state change). FromState is nil on the creation event.
// For cases predating the events table the history is derived from the case
// row instead (accurate for the happy path, coarse for NEEDS_INFO loops).
type ReviewStateEvent struct {
	FromState *ReviewState `json:"from_state,omitempty"`
	State     ReviewState  `json:"state"`
	Actor     string       `json:"actor"` // pharmacist id or "system"
	Note      *string      `json:"note"`
	At        time.Time    `json:"at"`
}

// PharmacyReviewCaseDetail is the console case drawer: the case plus cart
// lines, the evented state history and the symptom context of the linked
// search event (search_event_id) — terms, matched concepts, primary cluster
// and cohort flags. Context fields stay empty for cases without search
// context (e.g. catalogue POM orders).
type PharmacyReviewCaseDetail struct {
	PharmacyReviewCase
	SymptomTerms    []string           `json:"symptom_terms"`
	MatchedConcepts []string           `json:"matched_concepts"`
	ClusterName     *string            `json:"cluster_name"`
	CohortFlags     []string           `json:"cohort_flags"`
	CartLines       []ReviewCartLine   `json:"cart_lines"`
	History         []ReviewStateEvent `json:"history"`
}

// SymptomTermMappingRow is one row of the term workbench (all statuses).
type SymptomTermMappingRow struct {
	ID          string     `json:"id"`
	Term        string     `json:"term"`
	Language    string     `json:"language"`
	ConceptID   string     `json:"concept_id"`
	ConceptName string     `json:"concept_name"`
	Status      string     `json:"status"`
	Source      string     `json:"source"` // CURATED (system seed) | AI_SUGGESTED
	ApprovedBy  *string    `json:"approved_by"`
	ApprovedAt  *time.Time `json:"approved_at"`
	CreatedAt   time.Time  `json:"created_at"`
}

// ClusterRuleView is the read-only rule rendering in the cluster workbench.
type ClusterRuleView struct {
	ID         string `json:"id"`
	Expression string `json:"expression"`
	Priority   int    `json:"priority"`
	Effect     string `json:"effect"` // human-readable, e.g. "escalate → T3"
}

// ClusterClassMapView is one cluster→class row. ID is the therapeutic class id
// (the join has no surrogate key); status/stamps come from the class row —
// approve the CLASS entity to make an AI_SUGGESTED mapping live.
type ClusterClassMapView struct {
	ID                 string     `json:"id"`
	TherapeuticClassID string     `json:"therapeutic_class_id"`
	ClassName          string     `json:"class_name"`
	Rank               int        `json:"rank"`
	Status             string     `json:"status"`
	ApprovedBy         *string    `json:"approved_by"`
	ApprovedAt         *time.Time `json:"approved_at"`
}

// ConditionClusterRow is one cluster in the mapping workbench.
type ConditionClusterRow struct {
	ID          string                `json:"id"`
	Name        string                `json:"name"`
	TriageTier  Tier                  `json:"triage_tier"`
	RuleVersion int                   `json:"rule_version"`
	Rules       []ClusterRuleView     `json:"rules"`
	ClassMaps   []ClusterClassMapView `json:"class_maps"`
}

// adminReader is the optional read port for the console views. PgxRepo
// implements it; the in-memory test fake does not have to.
type adminReader interface {
	OrderCartLines(ctx context.Context, orderID string) ([]ReviewCartLine, error)
	ListTermMappings(ctx context.Context) ([]SymptomTermMappingRow, error)
	ListClusterMappings(ctx context.Context) ([]ConditionClusterRow, error)
}

// GetReviewCaseDetail is the console case drawer read (RBAC
// health.pharmacy.symptom.reviews is enforced at the route). Object-level
// authz mirrors DecideReviewCase: unless tenantOverride (superintendent), the
// caller must own the case's premises tenant — the drawer carries the linked
// search terms (sensitive health data, NDPR), so foreign cases read not-found.
func (s *Service) GetReviewCaseDetail(ctx context.Context, callerID, caseID string, tenantOverride bool) (*PharmacyReviewCaseDetail, error) {
	rc, err := s.repo.ReviewCaseByID(ctx, caseID)
	if err != nil {
		return nil, err
	}
	if rc == nil {
		return nil, fmt.Errorf("%w: review case", ErrNotFound)
	}
	if !tenantOverride {
		ok, err := s.repo.IsProviderPharmacist(ctx, callerID, rc.PharmacyProviderID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, fmt.Errorf("%w: review case", ErrNotFound) // outside caller's premises tenant
		}
	}
	detail := &PharmacyReviewCaseDetail{
		PharmacyReviewCase: *rc,
		SymptomTerms:       []string{},
		MatchedConcepts:    []string{},
		CohortFlags:        []string{},
		CartLines:          []ReviewCartLine{},
		History:            deriveReviewHistory(rc),
	}
	// Real evented history (pharmacy_review_case_events); the derived trail
	// above stays only as the fallback for cases predating the events table.
	if evs, err := s.repo.ListReviewCaseEvents(ctx, rc.ID); err != nil {
		return nil, err
	} else if len(evs) > 0 {
		detail.History = evs
	}
	// Symptom context from the linked search event (nil link ⇒ no context,
	// e.g. a catalogue POM order gated without search).
	if rc.SearchEventID != nil {
		evc, err := s.repo.SearchEventContext(ctx, *rc.SearchEventID)
		if err != nil {
			return nil, err
		}
		if evc != nil {
			if evc.Terms != nil {
				detail.SymptomTerms = evc.Terms
			}
			if evc.MatchedConcepts != nil {
				detail.MatchedConcepts = evc.MatchedConcepts
			}
			if evc.CohortFlags != nil {
				detail.CohortFlags = evc.CohortFlags
			}
			detail.ClusterName = evc.ClusterName
		}
	}
	if ar, ok := s.repo.(adminReader); ok {
		lines, err := ar.OrderCartLines(ctx, rc.OrderID)
		if err != nil {
			return nil, err
		}
		if lines != nil {
			detail.CartLines = lines
		}
	}
	return detail, nil
}

// deriveReviewHistory reconstructs the state trail from the case row — the
// fallback for cases created before the pharmacy_review_case_events table.
func deriveReviewHistory(rc *PharmacyReviewCase) []ReviewStateEvent {
	events := []ReviewStateEvent{
		{State: ReviewSubmitted, Actor: "system", At: rc.CreatedAt},
	}
	switch rc.State {
	case ReviewSubmitted:
		// still at the start
	case ReviewAutoCleared:
		events = append(events, ReviewStateEvent{State: ReviewAutoCleared, Actor: "system", At: rc.UpdatedAt})
	default:
		events = append(events, ReviewStateEvent{State: ReviewPharmacistReview, Actor: "system", At: rc.CreatedAt})
		if rc.State != ReviewPharmacistReview {
			actor := "pharmacist"
			if rc.PharmacistID != nil && *rc.PharmacistID != "" {
				actor = *rc.PharmacistID
			}
			events = append(events, ReviewStateEvent{State: rc.State, Actor: actor, Note: rc.DecisionNote, At: rc.UpdatedAt})
		}
	}
	return events
}

// ListTaxonomy serves GET /symptom/mappings?entity=term|cluster (RBAC
// health.pharmacy.symptom.mappings). Returns ALL statuses (APPROVED,
// AI_SUGGESTED, RETIRED) — this is the curation surface, not the member read
// path, which stays APPROVED-only.
func (s *Service) ListTaxonomy(ctx context.Context, entity string) (any, error) {
	ar, ok := s.repo.(adminReader)
	if !ok {
		return nil, fmt.Errorf("%w: taxonomy listing unavailable", ErrNotFound)
	}
	switch entity {
	case "term":
		rows, err := ar.ListTermMappings(ctx)
		if err != nil {
			return nil, err
		}
		if rows == nil {
			rows = []SymptomTermMappingRow{}
		}
		return rows, nil
	case "cluster":
		rows, err := ar.ListClusterMappings(ctx)
		if err != nil {
			return nil, err
		}
		if rows == nil {
			rows = []ConditionClusterRow{}
		}
		return rows, nil
	}
	return nil, fmt.Errorf("%w: entity must be term or cluster", ErrValidation)
}

// ─── payload helpers (JSON decodes numbers as float64) ───────────────────────

func getString(p map[string]any, key string) string {
	if p == nil {
		return ""
	}
	if v, ok := p[key].(string); ok {
		return v
	}
	return ""
}

func getInt(p map[string]any, key string, def int) int {
	if p == nil {
		return def
	}
	switch v := p[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	}
	return def
}

func isUUID(s string) bool {
	if s == "" {
		return false
	}
	_, err := uuid.Parse(s)
	return err == nil
}
