package symptomsearch

// PgxRepo is the production Repo over the pgx pool — the same money-path DB
// access convention as the sibling pharmacy module (backend/internal/health/
// pharmacy uses the pool directly; Supabase REST is not used on this path).
// Every query is parameterised; every read-path query filters status='APPROVED'
// (fail-closed: AI_SUGGESTED and RETIRED rows are invisible to members).

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PgxRepo struct{ db *pgxpool.Pool }

func NewPgxRepo(db *pgxpool.Pool) *PgxRepo { return &PgxRepo{db: db} }

// ─── Resolution reads ────────────────────────────────────────────────────────

func (r *PgxRepo) LookupApprovedTerms(ctx context.Context, normTerms []string) ([]Term, error) {
	const q = `
		SELECT id, term, language, concept_id, status
		FROM symptom_terms
		WHERE status = 'APPROVED' AND lower(btrim(term)) = ANY($1)`
	rows, err := r.db.Query(ctx, q, normTerms)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Term
	for rows.Next() {
		var t Term
		if err := rows.Scan(&t.ID, &t.Term, &t.Language, &t.ConceptID, &t.Status); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (r *PgxRepo) ConceptsByIDs(ctx context.Context, ids []string) ([]Concept, error) {
	const q = `
		SELECT id, code, name, description, status, version
		FROM symptom_concepts
		WHERE status = 'APPROVED' AND id = ANY($1::uuid[])`
	rows, err := r.db.Query(ctx, q, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Concept
	for rows.Next() {
		var c Concept
		if err := rows.Scan(&c.ID, &c.Code, &c.Name, &c.Description, &c.Status, &c.Version); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (r *PgxRepo) ClustersForConcepts(ctx context.Context, conceptIDs []string) ([]ClusterConceptMatch, error) {
	const q = `
		SELECT c.id, c.code, c.name, c.triage_tier, cc.concept_id
		FROM symptom_clusters c
		JOIN symptom_cluster_concepts cc ON cc.cluster_id = c.id
		WHERE c.status = 'APPROVED' AND cc.concept_id = ANY($1::uuid[])`
	rows, err := r.db.Query(ctx, q, conceptIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ClusterConceptMatch
	for rows.Next() {
		var m ClusterConceptMatch
		var tier string
		if err := rows.Scan(&m.ClusterID, &m.ClusterCode, &m.ClusterName, &tier, &m.ConceptID); err != nil {
			return nil, err
		}
		m.TriageTier = Tier(tier)
		out = append(out, m)
	}
	return out, rows.Err()
}

func (r *PgxRepo) ApprovedRulesForClusters(ctx context.Context, clusterIDs []string) ([]ClusterRule, error) {
	const q = `
		SELECT id, cluster_id, expression, priority, effect, escalate_to_tier, suppress_class_id, reason, status
		FROM symptom_cluster_rules
		WHERE status = 'APPROVED' AND cluster_id = ANY($1::uuid[])
		ORDER BY priority ASC, created_at ASC`
	rows, err := r.db.Query(ctx, q, clusterIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ClusterRule
	for rows.Next() {
		var cr ClusterRule
		if err := rows.Scan(&cr.ID, &cr.ClusterID, &cr.Expression, &cr.Priority, &cr.Effect,
			&cr.EscalateToTier, &cr.SuppressClassID, &cr.Reason, &cr.Status); err != nil {
			return nil, err
		}
		out = append(out, cr)
	}
	return out, rows.Err()
}

func (r *PgxRepo) ClassMapForClusters(ctx context.Context, clusterIDs []string) ([]ClassMapEntry, error) {
	const q = `
		SELECT m.cluster_id, m.class_id, m.rank, t.name, t.usage_note
		FROM symptom_cluster_class_map m
		JOIN therapeutic_classes t ON t.id = m.class_id
		WHERE t.status = 'APPROVED' AND m.cluster_id = ANY($1::uuid[])
		ORDER BY m.rank ASC, t.name ASC`
	rows, err := r.db.Query(ctx, q, clusterIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ClassMapEntry
	for rows.Next() {
		var e ClassMapEntry
		if err := rows.Scan(&e.ClusterID, &e.ClassID, &e.Rank, &e.ClassName, &e.UsageNote); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (r *PgxRepo) ApprovedClassByID(ctx context.Context, classID string) (*TherapeuticClass, error) {
	const q = `
		SELECT id, code, name, usage_note, status
		FROM therapeutic_classes
		WHERE id = $1 AND status = 'APPROVED'`
	var t TherapeuticClass
	err := r.db.QueryRow(ctx, q, classID).Scan(&t.ID, &t.Code, &t.Name, &t.UsageNote, &t.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// LiveSkusForClass resolves live SKUs at query time. POM/BLOCKED_ONLINE are
// excluded in SQL (and again in the service); the pharmacy_products join
// re-asserts HL-5 (NAFDAC REGISTERED, active) as defence in depth.
func (r *PgxRepo) LiveSkusForClass(ctx context.Context, classID, region string, limit, offset int) ([]Sku, error) {
	const q = `
		SELECT s.id, s.product_id, p.name, s.brand, s.pack_size, s.price_kobo,
		       COALESCE(NULLIF(s.nafdac_reg_no, ''), p.nafdac_ref, '') AS nafdac_reg_no,
		       s.classification, s.therapeutic_class_id, s.region, s.in_stock,
		       s.age_min_years, s.pregnancy_safe, s.max_qty_per_window
		FROM pharmacy_skus s
		JOIN pharmacy_products p ON p.id = s.product_id
		WHERE s.therapeutic_class_id = $1
		  AND s.active = true AND s.in_stock = true
		  AND s.classification IN ('OTC','PHARMACY_ONLY')
		  AND ($2 = '' OR s.region = '' OR s.region = $2)
		  AND p.active = true AND p.nafdac_status = 'REGISTERED'
		ORDER BY s.price_kobo ASC, s.id ASC
		LIMIT $3 OFFSET $4`
	rows, err := r.db.Query(ctx, q, classID, region, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Sku
	for rows.Next() {
		var s Sku
		if err := rows.Scan(&s.ID, &s.ProductID, &s.Name, &s.Brand, &s.PackSize, &s.PriceKobo,
			&s.NAFDACRegNo, &s.Classification, &s.TherapeuticClassID, &s.Region, &s.InStock,
			&s.AgeMinYears, &s.PregnancySafe, &s.MaxQtyPerWindow); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (r *PgxRepo) ActiveDisclaimer(ctx context.Context) (string, error) {
	const q = `SELECT body FROM symptom_disclaimer_versions WHERE active = true ORDER BY version DESC LIMIT 1`
	var body string
	err := r.db.QueryRow(ctx, q).Scan(&body)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return body, nil
}

func (r *PgxRepo) InsertSearchEvent(ctx context.Context, ev SearchEvent) (string, error) {
	refJSON, err := json.Marshal(ev.Refiners)
	if err != nil {
		refJSON = []byte("{}")
	}
	if ev.Terms == nil {
		ev.Terms = []string{}
	}
	if ev.UnmatchedTerms == nil {
		ev.UnmatchedTerms = []string{}
	}
	if ev.MatchedConcepts == nil {
		ev.MatchedConcepts = []string{}
	}
	const q = `
		INSERT INTO symptom_search_events
			(user_id, device_hash, terms, refiners, matched, resolved_tier, unmatched_terms,
			 matched_concepts, cluster_name)
		VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)
		RETURNING id`
	var id string
	if err := r.db.QueryRow(ctx, q, ev.UserID, ev.DeviceHash, ev.Terms, string(refJSON),
		ev.Matched, ev.ResolvedTier, ev.UnmatchedTerms, ev.MatchedConcepts, ev.ClusterName).Scan(&id); err != nil {
		return "", err
	}
	return id, nil
}

// SearchEventContext projects one symptom_search_events row for the order seam
// (tier resolution) and the console case drawer (search context).
func (r *PgxRepo) SearchEventContext(ctx context.Context, id string) (*SearchEventContext, error) {
	const q = `
		SELECT id, user_id, terms, matched_concepts, cluster_name, refiners, resolved_tier
		FROM symptom_search_events
		WHERE id = $1`
	var (
		evc      SearchEventContext
		refiners map[string]any
	)
	err := r.db.QueryRow(ctx, q, id).Scan(&evc.ID, &evc.UserID, &evc.Terms, &evc.MatchedConcepts,
		&evc.ClusterName, &refiners, &evc.ResolvedTier)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	evc.CohortFlags = []string{}
	if who, ok := refiners["who"].(string); ok && who != "" {
		evc.CohortFlags = append(evc.CohortFlags, who)
	}
	return &evc, nil
}

// ─── Review cases ────────────────────────────────────────────────────────────

const reviewCaseColumns = `id, order_id, pharmacy_provider_id, tier, state, pharmacist_id, decision_note, sla_deadline, search_event_id, version, created_at, updated_at`

func scanReviewCase(row pgx.Row) (*PharmacyReviewCase, error) {
	var rc PharmacyReviewCase
	var tier, state string
	if err := row.Scan(&rc.ID, &rc.OrderID, &rc.PharmacyProviderID, &tier, &state,
		&rc.PharmacistID, &rc.DecisionNote, &rc.SLADeadline, &rc.SearchEventID,
		&rc.Version, &rc.CreatedAt, &rc.UpdatedAt); err != nil {
		return nil, err
	}
	rc.Tier = Tier(tier)
	rc.State = ReviewState(state)
	return &rc, nil
}

func (r *PgxRepo) ReviewCaseByID(ctx context.Context, id string) (*PharmacyReviewCase, error) {
	q := `SELECT ` + reviewCaseColumns + ` FROM pharmacy_review_cases WHERE id = $1`
	rc, err := scanReviewCase(r.db.QueryRow(ctx, q, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return rc, err
}

func (r *PgxRepo) ReviewCaseByOrder(ctx context.Context, orderID string) (*PharmacyReviewCase, error) {
	q := `SELECT ` + reviewCaseColumns + ` FROM pharmacy_review_cases WHERE order_id = $1`
	rc, err := scanReviewCase(r.db.QueryRow(ctx, q, orderID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return rc, err
}

// InsertReviewCase writes the case row AND its creation event (from_state
// NULL → SUBMITTED) in one transaction — the evented history starts with the
// case and can never drift from it.
func (r *PgxRepo) InsertReviewCase(ctx context.Context, rc *PharmacyReviewCase, actorID string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	const q = `
		INSERT INTO pharmacy_review_cases
			(id, order_id, pharmacy_provider_id, tier, state, sla_deadline, search_event_id, version)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`
	if _, err := tx.Exec(ctx, q, rc.ID, rc.OrderID, rc.PharmacyProviderID,
		string(rc.Tier), string(rc.State), rc.SLADeadline, rc.SearchEventID, rc.Version); err != nil {
		return err
	}
	if err := insertReviewCaseEvent(ctx, tx, rc.ID, nil, string(rc.State), actorID, nil); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// TransitionReviewCase is the optimistic-lock CAS on (id, version). On success
// it appends the pharmacy_review_case_events row in the SAME transaction.
func (r *PgxRepo) TransitionReviewCase(ctx context.Context, id string, expectedVersion int, from, to ReviewState, actorID string, pharmacistID, note *string) (bool, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	const q = `
		UPDATE pharmacy_review_cases
		SET state = $3,
		    pharmacist_id = COALESCE($4, pharmacist_id),
		    decision_note = COALESCE($5, decision_note),
		    version = version + 1,
		    updated_at = now()
		WHERE id = $1 AND version = $2`
	tag, err := tx.Exec(ctx, q, id, expectedVersion, string(to), pharmacistID, note)
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() != 1 {
		return false, nil // version raced — no state change, no event row
	}
	f := string(from)
	if err := insertReviewCaseEvent(ctx, tx, id, &f, string(to), actorID, note); err != nil {
		return false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}

// insertReviewCaseEvent appends one history row inside the caller's
// transaction. actorID "" ⇒ NULL actor (system transition).
func insertReviewCaseEvent(ctx context.Context, tx pgx.Tx, caseID string, fromState *string, toState, actorID string, note *string) error {
	var actor *string
	if actorID != "" {
		a := actorID
		actor = &a
	}
	const q = `
		INSERT INTO pharmacy_review_case_events (case_id, from_state, to_state, actor, note)
		VALUES ($1, $2, $3, $4, $5)`
	_, err := tx.Exec(ctx, q, caseID, fromState, toState, actor, note)
	return err
}

// ListReviewCaseEvents reads the evented history, oldest first (seq breaks
// same-timestamp ties deterministically).
func (r *PgxRepo) ListReviewCaseEvents(ctx context.Context, caseID string) ([]ReviewStateEvent, error) {
	const q = `
		SELECT from_state, to_state, actor, note, created_at
		FROM pharmacy_review_case_events
		WHERE case_id = $1
		ORDER BY created_at ASC, seq ASC`
	rows, err := r.db.Query(ctx, q, caseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ReviewStateEvent
	for rows.Next() {
		var (
			ev          ReviewStateEvent
			from, actor *string
			to          string
		)
		if err := rows.Scan(&from, &to, &actor, &ev.Note, &ev.At); err != nil {
			return nil, err
		}
		if from != nil {
			f := ReviewState(*from)
			ev.FromState = &f
		}
		ev.State = ReviewState(to)
		ev.Actor = "system"
		if actor != nil && *actor != "" {
			ev.Actor = *actor
		}
		out = append(out, ev)
	}
	return out, rows.Err()
}

func (r *PgxRepo) ListReviewCases(ctx context.Context, state, providerID string, limit int) ([]PharmacyReviewCase, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	q := `
		SELECT ` + reviewCaseColumns + `
		FROM pharmacy_review_cases
		WHERE ($1 = '' OR state = $1)
		  AND ($2 = '' OR pharmacy_provider_id::text = $2)
		ORDER BY sla_deadline ASC
		LIMIT $3`
	rows, err := r.db.Query(ctx, q, state, providerID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PharmacyReviewCase
	for rows.Next() {
		rc, err := scanReviewCase(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *rc)
	}
	return out, rows.Err()
}

// IsProviderPharmacist enforces object-level authz: the caller must own the
// case's premises tenant (mirrors the pharmacy module's VerifiedPharmacyOwner).
func (r *PgxRepo) IsProviderPharmacist(ctx context.Context, userID, providerID string) (bool, error) {
	const q = `
		SELECT EXISTS (
			SELECT 1 FROM health_providers
			WHERE id = $1 AND owner_user_id = $2 AND domain = 'PHARMACY' AND status = 'APPROVED')`
	var ok bool
	if err := r.db.QueryRow(ctx, q, providerID, userID).Scan(&ok); err != nil {
		return false, err
	}
	return ok, nil
}

// ─── Admin taxonomy writes (suggest-approve) ─────────────────────────────────

// taxonomyTables whitelists the entity→table mapping. Table names never come
// from user input.
var taxonomyTables = map[string]string{
	"term":              "symptom_terms",
	"concept":           "symptom_concepts",
	"cluster":           "symptom_clusters",
	"cluster_rule":      "symptom_cluster_rules",
	"therapeutic_class": "therapeutic_classes",
}

func (r *PgxRepo) UpsertTaxonomyRow(ctx context.Context, entity, action, actorID string, p map[string]any) (map[string]any, error) {
	if entity == "cluster_class_map" {
		switch action {
		case "create", "update":
			return r.upsertClusterClassMap(ctx, p)
		case "retire":
			return r.deleteClusterClassMap(ctx, p)
		}
		return nil, fmt.Errorf("%w: unsupported action %q for cluster_class_map", ErrValidation, action)
	}
	switch action {
	case "create":
		return r.createTaxonomyRow(ctx, entity, actorID, p)
	case "update":
		return r.updateTaxonomyRow(ctx, entity, p)
	case "approve", "retire":
		return r.setTaxonomyStatus(ctx, entity, action, actorID, p)
	}
	return nil, fmt.Errorf("%w: unsupported action %q", ErrValidation, action)
}

func nullableStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func (r *PgxRepo) createTaxonomyRow(ctx context.Context, entity, actorID string, p map[string]any) (map[string]any, error) {
	var (
		id      string
		version int
	)
	switch entity {
	case "term":
		const q = `
			INSERT INTO symptom_terms (term, language, concept_id, status, suggested_by)
			VALUES ($1, $2, $3, 'AI_SUGGESTED', $4)
			RETURNING id, version`
		if err := r.db.QueryRow(ctx, q, getString(p, "term"), getString(p, "language"),
			getString(p, "concept_id"), actorID).Scan(&id, &version); err != nil {
			return nil, err
		}
	case "concept":
		const q = `
			INSERT INTO symptom_concepts (code, name, description, status, suggested_by)
			VALUES ($1, $2, $3, 'AI_SUGGESTED', $4)
			RETURNING id, version`
		if err := r.db.QueryRow(ctx, q, getString(p, "code"), getString(p, "name"),
			getString(p, "description"), actorID).Scan(&id, &version); err != nil {
			return nil, err
		}
	case "cluster":
		const q = `
			INSERT INTO symptom_clusters (code, name, triage_tier, status, suggested_by)
			VALUES ($1, $2, $3, 'AI_SUGGESTED', $4)
			RETURNING id, version`
		if err := r.db.QueryRow(ctx, q, getString(p, "code"), getString(p, "name"),
			getString(p, "triage_tier"), actorID).Scan(&id, &version); err != nil {
			return nil, err
		}
	case "therapeutic_class":
		const q = `
			INSERT INTO therapeutic_classes (code, name, usage_note, status, suggested_by)
			VALUES ($1, $2, $3, 'AI_SUGGESTED', $4)
			RETURNING id, version`
		if err := r.db.QueryRow(ctx, q, getString(p, "code"), getString(p, "name"),
			getString(p, "usage_note"), actorID).Scan(&id, &version); err != nil {
			return nil, err
		}
	case "cluster_rule":
		const q = `
			INSERT INTO symptom_cluster_rules
				(cluster_id, expression, priority, effect, escalate_to_tier, suppress_class_id, reason, status, suggested_by)
			VALUES ($1, $2, $3, $4, $5, $6, $7, 'AI_SUGGESTED', $8)
			RETURNING id, version`
		if err := r.db.QueryRow(ctx, q, getString(p, "cluster_id"), getString(p, "expression"),
			getInt(p, "priority", 100), getString(p, "effect"),
			nullableStr(getString(p, "escalate_to_tier")), nullableStr(getString(p, "suppress_class_id")),
			getString(p, "reason"), actorID).Scan(&id, &version); err != nil {
			return nil, err
		}
	default:
		return nil, fmt.Errorf("%w: unknown entity %q", ErrValidation, entity)
	}
	return map[string]any{"id": id, "status": StatusAISuggested, "version": version}, nil
}

// updateTaxonomyRow rewrites content and RESETS the row to AI_SUGGESTED with
// cleared approval stamps — content changes always require re-approval.
func (r *PgxRepo) updateTaxonomyRow(ctx context.Context, entity string, p map[string]any) (map[string]any, error) {
	id := getString(p, "id")
	var q string
	var args []any
	switch entity {
	case "term":
		q = `UPDATE symptom_terms
		     SET term=$2, language=$3, concept_id=$4,
		         status='AI_SUGGESTED', approved_by=NULL, approved_at=NULL,
		         version=version+1, updated_at=now()
		     WHERE id=$1 AND status <> 'RETIRED'
		     RETURNING id, status, version`
		args = []any{id, getString(p, "term"), getString(p, "language"), getString(p, "concept_id")}
	case "concept":
		q = `UPDATE symptom_concepts
		     SET code=$2, name=$3, description=$4,
		         status='AI_SUGGESTED', approved_by=NULL, approved_at=NULL,
		         version=version+1, updated_at=now()
		     WHERE id=$1 AND status <> 'RETIRED'
		     RETURNING id, status, version`
		args = []any{id, getString(p, "code"), getString(p, "name"), getString(p, "description")}
	case "cluster":
		q = `UPDATE symptom_clusters
		     SET code=$2, name=$3, triage_tier=$4,
		         status='AI_SUGGESTED', approved_by=NULL, approved_at=NULL,
		         version=version+1, updated_at=now()
		     WHERE id=$1 AND status <> 'RETIRED'
		     RETURNING id, status, version`
		args = []any{id, getString(p, "code"), getString(p, "name"), getString(p, "triage_tier")}
	case "therapeutic_class":
		q = `UPDATE therapeutic_classes
		     SET code=$2, name=$3, usage_note=$4,
		         status='AI_SUGGESTED', approved_by=NULL, approved_at=NULL,
		         version=version+1, updated_at=now()
		     WHERE id=$1 AND status <> 'RETIRED'
		     RETURNING id, status, version`
		args = []any{id, getString(p, "code"), getString(p, "name"), getString(p, "usage_note")}
	case "cluster_rule":
		q = `UPDATE symptom_cluster_rules
		     SET expression=$2, priority=$3, effect=$4, escalate_to_tier=$5, suppress_class_id=$6, reason=$7,
		         status='AI_SUGGESTED', approved_by=NULL, approved_at=NULL,
		         version=version+1, updated_at=now()
		     WHERE id=$1 AND status <> 'RETIRED'
		     RETURNING id, status, version`
		args = []any{id, getString(p, "expression"), getInt(p, "priority", 100), getString(p, "effect"),
			nullableStr(getString(p, "escalate_to_tier")), nullableStr(getString(p, "suppress_class_id")),
			getString(p, "reason")}
	default:
		return nil, fmt.Errorf("%w: unknown entity %q", ErrValidation, entity)
	}
	var outID, status string
	var version int
	err := r.db.QueryRow(ctx, q, args...).Scan(&outID, &status, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: row not found or already retired", ErrConflict)
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"id": outID, "status": status, "version": version}, nil
}

// setTaxonomyStatus applies the approve/retire lifecycle. Approving stamps
// approved_by + approved_at (nothing AI-drafted is user-visible until then);
// retiring never deletes.
func (r *PgxRepo) setTaxonomyStatus(ctx context.Context, entity, action, actorID string, p map[string]any) (map[string]any, error) {
	table, ok := taxonomyTables[entity]
	if !ok {
		return nil, fmt.Errorf("%w: unknown entity %q", ErrValidation, entity)
	}
	id := getString(p, "id")
	var q string
	if action == "approve" {
		q = fmt.Sprintf(`
			UPDATE %s
			SET status='APPROVED', approved_by=$2, approved_at=now(), version=version+1, updated_at=now()
			WHERE id=$1 AND status <> 'RETIRED'
			RETURNING id, status, version, approved_at`, table)
		var outID, status string
		var version int
		var approvedAt time.Time
		err := r.db.QueryRow(ctx, q, id, actorID).Scan(&outID, &status, &version, &approvedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: row not found or already retired — cannot approve", ErrConflict)
		}
		if err != nil {
			return nil, err
		}
		return map[string]any{"id": outID, "status": status, "version": version,
			"approved_by": actorID, "approved_at": approvedAt}, nil
	}
	// retire
	q = fmt.Sprintf(`
		UPDATE %s
		SET status='RETIRED', version=version+1, updated_at=now()
		WHERE id=$1
		RETURNING id, status, version`, table)
	var outID, status string
	var version int
	err := r.db.QueryRow(ctx, q, id).Scan(&outID, &status, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: row not found", ErrNotFound)
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"id": outID, "status": status, "version": version}, nil
}

func (r *PgxRepo) upsertClusterClassMap(ctx context.Context, p map[string]any) (map[string]any, error) {
	const q = `
		INSERT INTO symptom_cluster_class_map (cluster_id, class_id, rank)
		VALUES ($1, $2, $3)
		ON CONFLICT (cluster_id, class_id) DO UPDATE SET rank = EXCLUDED.rank
		RETURNING cluster_id, class_id, rank`
	var clusterID, classID string
	var rank int
	if err := r.db.QueryRow(ctx, q, getString(p, "cluster_id"), getString(p, "class_id"),
		getInt(p, "rank", 1)).Scan(&clusterID, &classID, &rank); err != nil {
		return nil, err
	}
	return map[string]any{"id": clusterID + ":" + classID, "cluster_id": clusterID, "class_id": classID, "rank": rank}, nil
}

func (r *PgxRepo) deleteClusterClassMap(ctx context.Context, p map[string]any) (map[string]any, error) {
	clusterID, classID := getString(p, "cluster_id"), getString(p, "class_id")
	if classID == "" {
		// Console convention: the class-map row id IS the therapeutic class id
		// (the join table has no surrogate key) — accept it as payload.id.
		classID = getString(p, "id")
	}
	if !isUUID(clusterID) || !isUUID(classID) {
		return nil, fmt.Errorf("%w: cluster_id and class_id (uuids) are required", ErrValidation)
	}
	tag, err := r.db.Exec(ctx,
		`DELETE FROM symptom_cluster_class_map WHERE cluster_id=$1 AND class_id=$2`, clusterID, classID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, fmt.Errorf("%w: mapping not found", ErrNotFound)
	}
	return map[string]any{"id": clusterID + ":" + classID, "cluster_id": clusterID, "class_id": classID, "retired": true}, nil
}

// ─── Console read surface (adminReader) ──────────────────────────────────────

// OrderCartLines snapshots the order's lines for the review-case drawer.
// Classification is derived from the rx_required snapshot (POM vs OTC) — the
// SKU-level classification lives on pharmacy_skus, which order lines predate.
func (r *PgxRepo) OrderCartLines(ctx context.Context, orderID string) ([]ReviewCartLine, error) {
	const q = `
		SELECT l.product_name, NULLIF(p.nafdac_ref, ''), l.rx_required,
		       l.quantity, l.unit_price_kobo, l.line_total_kobo
		FROM pharmacy_order_lines l
		JOIN pharmacy_products p ON p.id = l.product_id
		WHERE l.order_id = $1
		ORDER BY l.created_at ASC`
	rows, err := r.db.Query(ctx, q, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ReviewCartLine
	for rows.Next() {
		var cl ReviewCartLine
		var rxRequired bool
		if err := rows.Scan(&cl.ProductName, &cl.NAFDACRegNo, &rxRequired,
			&cl.Qty, &cl.UnitPriceKobo, &cl.LineTotalKobo); err != nil {
			return nil, err
		}
		cl.Classification = "OTC"
		if rxRequired {
			cl.Classification = "POM"
		}
		out = append(out, cl)
	}
	return out, rows.Err()
}

// ListTermMappings is the term workbench read: ALL statuses, AI_SUGGESTED
// first (needs review), then newest.
func (r *PgxRepo) ListTermMappings(ctx context.Context) ([]SymptomTermMappingRow, error) {
	const q = `
		SELECT t.id, t.term, t.language, t.concept_id, c.name,
		       t.status, (t.suggested_by IS NOT NULL) AS ai_suggested,
		       t.approved_by, t.approved_at, t.created_at
		FROM symptom_terms t
		JOIN symptom_concepts c ON c.id = t.concept_id
		ORDER BY (t.status = 'AI_SUGGESTED') DESC, t.created_at DESC
		LIMIT 500`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SymptomTermMappingRow
	for rows.Next() {
		var m SymptomTermMappingRow
		var aiSuggested bool
		if err := rows.Scan(&m.ID, &m.Term, &m.Language, &m.ConceptID, &m.ConceptName,
			&m.Status, &aiSuggested, &m.ApprovedBy, &m.ApprovedAt, &m.CreatedAt); err != nil {
			return nil, err
		}
		m.Source = "CURATED" // system seeds carry no suggested_by
		if aiSuggested {
			m.Source = "AI_SUGGESTED"
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ListClusterMappings is the cluster workbench read: every non-retired cluster
// with its rules (read-only rendering) and cluster→class maps. Class-map
// status/stamps come from the therapeutic class row.
func (r *PgxRepo) ListClusterMappings(ctx context.Context) ([]ConditionClusterRow, error) {
	const qClusters = `
		SELECT id, name, triage_tier, version
		FROM symptom_clusters
		WHERE status <> 'RETIRED'
		ORDER BY name ASC
		LIMIT 200`
	rows, err := r.db.Query(ctx, qClusters)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ConditionClusterRow
	byID := map[string]*ConditionClusterRow{}
	var ids []string
	for rows.Next() {
		var c ConditionClusterRow
		var tier string
		if err := rows.Scan(&c.ID, &c.Name, &tier, &c.RuleVersion); err != nil {
			return nil, err
		}
		c.TriageTier = Tier(tier)
		c.Rules = []ClusterRuleView{}
		c.ClassMaps = []ClusterClassMapView{}
		out = append(out, c)
		ids = append(ids, c.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		byID[out[i].ID] = &out[i]
	}
	if len(ids) == 0 {
		return []ConditionClusterRow{}, nil
	}

	const qRules = `
		SELECT id, cluster_id, expression, priority, effect, escalate_to_tier, suppress_class_id
		FROM symptom_cluster_rules
		WHERE status <> 'RETIRED' AND cluster_id = ANY($1::uuid[])
		ORDER BY priority ASC, created_at ASC`
	rrows, err := r.db.Query(ctx, qRules, ids)
	if err != nil {
		return nil, err
	}
	defer rrows.Close()
	for rrows.Next() {
		var (
			id, clusterID, expression, effect string
			priority                          int
			escalateTo, suppressClassID       *string
		)
		if err := rrows.Scan(&id, &clusterID, &expression, &priority, &effect, &escalateTo, &suppressClassID); err != nil {
			return nil, err
		}
		if c := byID[clusterID]; c != nil {
			c.Rules = append(c.Rules, ClusterRuleView{
				ID: id, Expression: expression, Priority: priority,
				Effect: renderRuleEffect(effect, escalateTo, suppressClassID),
			})
		}
	}
	if err := rrows.Err(); err != nil {
		return nil, err
	}

	const qMaps = `
		SELECT m.cluster_id, m.class_id, m.rank, t.name, t.status, t.approved_by, t.approved_at
		FROM symptom_cluster_class_map m
		JOIN therapeutic_classes t ON t.id = m.class_id
		WHERE m.cluster_id = ANY($1::uuid[])
		ORDER BY m.rank ASC, t.name ASC`
	mrows, err := r.db.Query(ctx, qMaps, ids)
	if err != nil {
		return nil, err
	}
	defer mrows.Close()
	for mrows.Next() {
		var (
			clusterID, classID, className, status string
			rank                                  int
			approvedBy                            *string
			approvedAt                            *time.Time
		)
		if err := mrows.Scan(&clusterID, &classID, &rank, &className, &status, &approvedBy, &approvedAt); err != nil {
			return nil, err
		}
		if c := byID[clusterID]; c != nil {
			c.ClassMaps = append(c.ClassMaps, ClusterClassMapView{
				ID: classID, TherapeuticClassID: classID, ClassName: className,
				Rank: rank, Status: status, ApprovedBy: approvedBy, ApprovedAt: approvedAt,
			})
		}
	}
	return out, mrows.Err()
}

// renderRuleEffect renders the effect row for the read-only console view.
func renderRuleEffect(effect string, escalateTo, suppressClassID *string) string {
	switch effect {
	case EffectEscalate:
		if escalateTo != nil {
			return "escalate → " + *escalateTo
		}
		return "escalate → T3 (fail-closed)"
	case EffectRequireConfirmation:
		return "require pharmacist confirmation (T2 gate)"
	case EffectSuppressClass:
		if suppressClassID != nil {
			return "suppress class " + *suppressClassID
		}
		return "suppress class"
	}
	return effect
}
