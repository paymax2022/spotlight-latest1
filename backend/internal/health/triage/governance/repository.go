package governance

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/health/triage"
)

// ErrNotFound is returned when a governance row does not exist.
var ErrNotFound = errors.New("triage.gov: not found")

// Repository is the pgx data-access layer for triage clinical governance. All
// queries are parameterized. State updates are GUARDED at the DB (WHERE state=$from)
// so a concurrent/duplicate lifecycle transition can never double-apply (SC-12).
type Repository struct{ db *pgxpool.Pool }

// NewRepository builds the governance repository over a pgx pool.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// ── helpers ──

func toJSONB(v any) []byte {
	if v == nil {
		return []byte("{}")
	}
	b, err := json.Marshal(v)
	if err != nil || len(b) == 0 {
		return []byte("{}")
	}
	return b
}

func nullStrPtr(s *string) any {
	if s == nil || *s == "" {
		return nil
	}
	return *s
}

// audit appends an immutable row to public.audit_logs / module 'health.triage.gov'
// (SC-12). actorID may be empty for system actions. Best-effort: an audit failure
// is returned so the caller can decide, matching sibling packages.
func (r *Repository) audit(ctx context.Context, actor, action, resourceType, resourceID string, newValues map[string]any, severity string) error {
	if severity == "" {
		severity = "info"
	}
	var actorArg any
	if actor != "" {
		actorArg = actor
	}
	const q = `
		INSERT INTO public.audit_logs
			(actor_user_id, action, module, resource_type, resource_id, new_values, severity)
		VALUES ($1,$2,'health.triage.gov',$3,$4,$5,$6)`
	_, err := r.db.Exec(ctx, q, actorArg, action, resourceType, resourceID, toJSONB(newValues), severity)
	return err
}

// ─────────────────────────────── Content items ───────────────────────────────

const contentCols = `id, code, kind, language, body, rag_tags, state, version, reviewer_id, published_at, created_at`

func scanContent(row pgx.Row) (*ContentItem, error) {
	var ci ContentItem
	var state string
	if err := row.Scan(&ci.ID, &ci.Code, &ci.Kind, &ci.Language, &ci.Body, &ci.RAGTags,
		&state, &ci.Version, &ci.ReviewerID, &ci.PublishedAt, &ci.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	ci.State = triage.ContentState(state)
	return &ci, nil
}

// CreateContent inserts a new DRAFT content item (SC-6 starts in draft).
func (r *Repository) CreateContent(ctx context.Context, ci *ContentItem) (*ContentItem, error) {
	const q = `
		INSERT INTO public.health_triage_content_items
			(code, kind, language, body, rag_tags, state, version)
		VALUES ($1,$2,$3,$4,$5,'draft',$6)
		RETURNING ` + contentCols
	if ci.Version == 0 {
		ci.Version = 1
	}
	return scanContent(r.db.QueryRow(ctx, q, ci.Code, ci.Kind, ci.Language, ci.Body, ci.RAGTags, ci.Version))
}

// GetContent fetches a content item by id.
func (r *Repository) GetContent(ctx context.Context, id string) (*ContentItem, error) {
	return scanContent(r.db.QueryRow(ctx, `SELECT `+contentCols+` FROM public.health_triage_content_items WHERE id=$1`, id))
}

// UpdateContentBody edits a DRAFT item's body/tags in place (only legal in draft).
func (r *Repository) UpdateContentBody(ctx context.Context, id, body string, ragTags []string) (bool, error) {
	const q = `UPDATE public.health_triage_content_items SET body=$2, rag_tags=$3
	           WHERE id=$1 AND state='draft'`
	ct, err := r.db.Exec(ctx, q, id, body, ragTags)
	if err != nil {
		return false, err
	}
	return ct.RowsAffected() == 1, nil
}

// TransitionContent atomically flips state ONLY from the expected `from` state
// (WHERE state=$from). On publish, reviewerID + published_at are set (SC-6 sign-off).
// Returns true iff exactly one row transitioned.
func (r *Repository) TransitionContent(ctx context.Context, id string, from, to triage.ContentState, reviewerID string, setPublished bool) (bool, error) {
	if setPublished {
		const q = `UPDATE public.health_triage_content_items
		           SET state=$3, reviewer_id=$4, published_at=now()
		           WHERE id=$1 AND state=$2`
		ct, err := r.db.Exec(ctx, q, id, string(from), string(to), reviewerID)
		if err != nil {
			return false, err
		}
		return ct.RowsAffected() == 1, nil
	}
	const q = `UPDATE public.health_triage_content_items
	           SET state=$3, reviewer_id=COALESCE(NULLIF($4,''), reviewer_id)
	           WHERE id=$1 AND state=$2`
	ct, err := r.db.Exec(ctx, q, id, string(from), string(to), reviewerID)
	if err != nil {
		return false, err
	}
	return ct.RowsAffected() == 1, nil
}

// BumpContentVersion creates a fresh DRAFT clone at version+1 of a published item
// so edits never mutate live, signed-off content (immutable versioning, SC-12).
func (r *Repository) BumpContentVersion(ctx context.Context, base *ContentItem, body string, ragTags []string) (*ContentItem, error) {
	const q = `
		INSERT INTO public.health_triage_content_items
			(code, kind, language, body, rag_tags, state, version)
		VALUES ($1,$2,$3,$4,$5,'draft',$6)
		RETURNING ` + contentCols
	return scanContent(r.db.QueryRow(ctx, q, base.Code, base.Kind, base.Language, body, ragTags, base.Version+1))
}

// ListContent lists content items, optionally filtered by state/kind/language.
func (r *Repository) ListContent(ctx context.Context, state, kind, language string) ([]ContentItem, error) {
	const q = `
		SELECT ` + contentCols + ` FROM public.health_triage_content_items
		WHERE ($1='' OR state=$1) AND ($2='' OR kind=$2) AND ($3='' OR language=$3)
		ORDER BY code, language, version DESC LIMIT 500`
	rows, err := r.db.Query(ctx, q, state, kind, language)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ContentItem{}
	for rows.Next() {
		var ci ContentItem
		var st string
		if err := rows.Scan(&ci.ID, &ci.Code, &ci.Kind, &ci.Language, &ci.Body, &ci.RAGTags,
			&st, &ci.Version, &ci.ReviewerID, &ci.PublishedAt, &ci.CreatedAt); err != nil {
			return nil, err
		}
		ci.State = triage.ContentState(st)
		out = append(out, ci)
	}
	return out, rows.Err()
}

// ─────────────────────────────── Red-flag rules ──────────────────────────────

const ruleCols = `id, code, name, condition, urgency_level, severity, state, version, reviewer_id, published_at, created_at`

func scanRule(row pgx.Row) (*RedFlagRule, error) {
	var rr RedFlagRule
	var state string
	var cond []byte
	if err := row.Scan(&rr.ID, &rr.Code, &rr.Name, &cond, &rr.UrgencyLevel, &rr.Severity,
		&state, &rr.Version, &rr.ReviewerID, &rr.PublishedAt, &rr.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	rr.State = triage.ContentState(state)
	_ = json.Unmarshal(cond, &rr.Condition)
	return &rr, nil
}

// CreateRule inserts a new DRAFT red-flag rule.
func (r *Repository) CreateRule(ctx context.Context, rr *RedFlagRule) (*RedFlagRule, error) {
	const q = `
		INSERT INTO public.health_triage_red_flag_rules
			(code, name, condition, urgency_level, severity, state, version)
		VALUES ($1,$2,$3,$4,$5,'draft',$6)
		RETURNING ` + ruleCols
	if rr.Version == 0 {
		rr.Version = 1
	}
	if rr.Severity == "" {
		rr.Severity = "emergency"
	}
	return scanRule(r.db.QueryRow(ctx, q, rr.Code, rr.Name, toJSONB(rr.Condition), rr.UrgencyLevel, rr.Severity, rr.Version))
}

// GetRule fetches a rule by id.
func (r *Repository) GetRule(ctx context.Context, id string) (*RedFlagRule, error) {
	return scanRule(r.db.QueryRow(ctx, `SELECT `+ruleCols+` FROM public.health_triage_red_flag_rules WHERE id=$1`, id))
}

// UpdateRuleBody edits a DRAFT rule's condition/level/name in place.
func (r *Repository) UpdateRuleBody(ctx context.Context, id, name string, cond RuleCondition, urgency int, severity string) (bool, error) {
	const q = `UPDATE public.health_triage_red_flag_rules
	           SET name=$2, condition=$3, urgency_level=$4, severity=$5
	           WHERE id=$1 AND state='draft'`
	ct, err := r.db.Exec(ctx, q, id, name, toJSONB(cond), urgency, severity)
	if err != nil {
		return false, err
	}
	return ct.RowsAffected() == 1, nil
}

// TransitionRule atomically flips rule state from `from`; on publish sets
// reviewer_id + published_at (SC-6 sign-off).
func (r *Repository) TransitionRule(ctx context.Context, id string, from, to triage.ContentState, reviewerID string, setPublished bool) (bool, error) {
	if setPublished {
		const q = `UPDATE public.health_triage_red_flag_rules
		           SET state=$3, reviewer_id=$4, published_at=now()
		           WHERE id=$1 AND state=$2`
		ct, err := r.db.Exec(ctx, q, id, string(from), string(to), reviewerID)
		if err != nil {
			return false, err
		}
		return ct.RowsAffected() == 1, nil
	}
	const q = `UPDATE public.health_triage_red_flag_rules
	           SET state=$3, reviewer_id=COALESCE(NULLIF($4,''), reviewer_id)
	           WHERE id=$1 AND state=$2`
	ct, err := r.db.Exec(ctx, q, id, string(from), string(to), reviewerID)
	if err != nil {
		return false, err
	}
	return ct.RowsAffected() == 1, nil
}

// BumpRuleVersion clones a published rule into a fresh DRAFT at version+1.
func (r *Repository) BumpRuleVersion(ctx context.Context, base *RedFlagRule, name string, cond RuleCondition, urgency int, severity string) (*RedFlagRule, error) {
	const q = `
		INSERT INTO public.health_triage_red_flag_rules
			(code, name, condition, urgency_level, severity, state, version)
		VALUES ($1,$2,$3,$4,$5,'draft',$6)
		RETURNING ` + ruleCols
	return scanRule(r.db.QueryRow(ctx, q, base.Code, name, toJSONB(cond), urgency, severity, base.Version+1))
}

// ListRules lists rules optionally filtered by state.
func (r *Repository) ListRules(ctx context.Context, state string) ([]RedFlagRule, error) {
	const q = `SELECT ` + ruleCols + ` FROM public.health_triage_red_flag_rules
	           WHERE ($1='' OR state=$1) ORDER BY code, version DESC LIMIT 500`
	rows, err := r.db.Query(ctx, q, state)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectRules(rows)
}

// ListPublishedRules returns only PUBLISHED rules — the live set evaluated by
// DBRedFlagEngine (SC-2: only signed-off, published rules can override).
func (r *Repository) ListPublishedRules(ctx context.Context) ([]RedFlagRule, error) {
	const q = `SELECT ` + ruleCols + ` FROM public.health_triage_red_flag_rules
	           WHERE state='published' ORDER BY urgency_level ASC, code`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectRules(rows)
}

func collectRules(rows pgx.Rows) ([]RedFlagRule, error) {
	out := []RedFlagRule{}
	for rows.Next() {
		var rr RedFlagRule
		var st string
		var cond []byte
		if err := rows.Scan(&rr.ID, &rr.Code, &rr.Name, &cond, &rr.UrgencyLevel, &rr.Severity,
			&st, &rr.Version, &rr.ReviewerID, &rr.PublishedAt, &rr.CreatedAt); err != nil {
			return nil, err
		}
		rr.State = triage.ContentState(st)
		_ = json.Unmarshal(cond, &rr.Condition)
		out = append(out, rr)
	}
	return out, rows.Err()
}

// ─────────────────────────────── Vignettes / eval ────────────────────────────

const vignetteCols = `id, code, language, evidence, expected_level, expected_emergency, expected_conditions, created_at`

func scanVignette(row pgx.Row) (*Vignette, error) {
	var v Vignette
	var ev []byte
	if err := row.Scan(&v.ID, &v.Code, &v.Language, &ev, &v.ExpectedLevel,
		&v.ExpectedEmergency, &v.ExpectedConditions, &v.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	_ = json.Unmarshal(ev, &v.Evidence)
	return &v, nil
}

// UpsertVignette inserts or replaces a vignette by its unique code.
func (r *Repository) UpsertVignette(ctx context.Context, v *Vignette) (*Vignette, error) {
	const q = `
		INSERT INTO public.health_triage_vignettes
			(code, language, evidence, expected_level, expected_emergency, expected_conditions)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (code) DO UPDATE SET
			language=EXCLUDED.language, evidence=EXCLUDED.evidence,
			expected_level=EXCLUDED.expected_level, expected_emergency=EXCLUDED.expected_emergency,
			expected_conditions=EXCLUDED.expected_conditions
		RETURNING ` + vignetteCols
	if v.Language == "" {
		v.Language = "en"
	}
	if v.ExpectedConditions == nil {
		v.ExpectedConditions = []string{}
	}
	return scanVignette(r.db.QueryRow(ctx, q, v.Code, v.Language, toJSONB(v.Evidence),
		v.ExpectedLevel, v.ExpectedEmergency, v.ExpectedConditions))
}

// ListVignettes returns all vignettes (the validation corpus).
func (r *Repository) ListVignettes(ctx context.Context) ([]Vignette, error) {
	rows, err := r.db.Query(ctx, `SELECT `+vignetteCols+` FROM public.health_triage_vignettes ORDER BY code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Vignette{}
	for rows.Next() {
		var v Vignette
		var ev []byte
		if err := rows.Scan(&v.ID, &v.Code, &v.Language, &ev, &v.ExpectedLevel,
			&v.ExpectedEmergency, &v.ExpectedConditions, &v.CreatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(ev, &v.Evidence)
		out = append(out, v)
	}
	return out, rows.Err()
}

// InsertEvalRun persists one shadow-eval observation.
func (r *Repository) InsertEvalRun(ctx context.Context, e *EvalRun) error {
	const q = `
		INSERT INTO public.health_triage_eval_runs
			(vignette_id, engine_level, level_match, emergency_correct)
		VALUES ($1,$2,$3,$4)`
	_, err := r.db.Exec(ctx, q, e.VignetteID, e.EngineLevel, e.LevelMatch, e.EmergencyCorrect)
	return err
}

// ─────────────────────────────── Language packs ──────────────────────────────

// UpsertLanguagePack inserts or updates a language pack by its unique code.
func (r *Repository) UpsertLanguagePack(ctx context.Context, lp *LanguagePack) (*LanguagePack, error) {
	const q = `
		INSERT INTO public.health_triage_language_packs (code, name, status)
		VALUES ($1,$2,$3)
		ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, status=EXCLUDED.status
		RETURNING id, code, name, status`
	if lp.Status == "" {
		lp.Status = "active"
	}
	var out LanguagePack
	if err := r.db.QueryRow(ctx, q, lp.Code, lp.Name, lp.Status).
		Scan(&out.ID, &out.Code, &out.Name, &out.Status); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListLanguagePacks returns all configured language packs.
func (r *Repository) ListLanguagePacks(ctx context.Context) ([]LanguagePack, error) {
	rows, err := r.db.Query(ctx, `SELECT id, code, name, status FROM public.health_triage_language_packs ORDER BY code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LanguagePack{}
	for rows.Next() {
		var lp LanguagePack
		if err := rows.Scan(&lp.ID, &lp.Code, &lp.Name, &lp.Status); err != nil {
			return nil, err
		}
		out = append(out, lp)
	}
	return out, rows.Err()
}

// ─────────────────────────────── Channel sessions ────────────────────────────

// UpsertChannelSession idempotently maps an external omnichannel id to an internal
// session. The (channel, external_id) UNIQUE constraint makes inbound webhook
// handling idempotent: a repeated message id resolves to the SAME session row.
// Returns the resolved row and whether it was newly created.
func (r *Repository) UpsertChannelSession(ctx context.Context, channel, externalID string, sessionID *string) (*ChannelSession, bool, error) {
	const q = `
		INSERT INTO public.health_triage_channel_sessions (channel, external_id, session_id)
		VALUES ($1,$2,$3)
		ON CONFLICT (channel, external_id) DO UPDATE
			SET session_id = COALESCE(public.health_triage_channel_sessions.session_id, EXCLUDED.session_id)
		RETURNING id, channel, external_id, session_id, created_at,
			(xmax = 0) AS inserted`
	var cs ChannelSession
	var inserted bool
	if err := r.db.QueryRow(ctx, q, channel, externalID, nullStrPtr(sessionID)).
		Scan(&cs.ID, &cs.Channel, &cs.ExternalID, &cs.SessionID, &cs.CreatedAt, &inserted); err != nil {
		return nil, false, err
	}
	return &cs, inserted, nil
}

// GetChannelSession looks up an existing external→session mapping.
func (r *Repository) GetChannelSession(ctx context.Context, channel, externalID string) (*ChannelSession, error) {
	const q = `SELECT id, channel, external_id, session_id, created_at
	           FROM public.health_triage_channel_sessions WHERE channel=$1 AND external_id=$2`
	var cs ChannelSession
	if err := r.db.QueryRow(ctx, q, channel, externalID).
		Scan(&cs.ID, &cs.Channel, &cs.ExternalID, &cs.SessionID, &cs.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &cs, nil
}

// SetChannelSessionID attaches the resolved internal session id to a channel row.
func (r *Repository) SetChannelSessionID(ctx context.Context, channel, externalID, sessionID string) error {
	const q = `UPDATE public.health_triage_channel_sessions SET session_id=$3
	           WHERE channel=$1 AND external_id=$2`
	_, err := r.db.Exec(ctx, q, channel, externalID, sessionID)
	return err
}
