package healthintake

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Auditor — minimal immutable-audit slice (HL-12). nil is safe.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// Field is one questionnaire field definition.
type Field struct {
	Name     string   `json:"name"`
	Type     string   `json:"type"` // text | number | bool | select
	Required bool     `json:"required"`
	Options  []string `json:"options,omitempty"` // for select
}

// Schema is a versioned questionnaire. version is immutable per row; a new version
// is a new row (UNIQUE(slug,version)). Responses validate against the EXACT version
// they were submitted against.
type Schema struct {
	ID        string    `json:"id"`
	Slug      string    `json:"slug"`
	Version   int       `json:"version"`
	Kind      string    `json:"kind"` // TRIAGE | SYMPTOM | TEST_PREP | PRE_CONSULT
	Fields    []Field   `json:"fields"`
	Active    bool      `json:"active"`
	CreatedAt time.Time `json:"created_at"`
}

type Response struct {
	ID            string         `json:"id"`
	SchemaID      string         `json:"schema_id"`
	SchemaVersion int            `json:"schema_version"`
	RespondentID  string         `json:"respondent_id"`
	Answers       map[string]any `json:"answers"`
	CreatedAt     time.Time      `json:"created_at"`
}

type Service struct {
	db    *pgxpool.Pool
	audit Auditor
}

func NewService(db *pgxpool.Pool, audit Auditor) *Service {
	return &Service{db: db, audit: audit}
}

// PublishSchema creates a new schema version (admin). Re-publishing the same
// (slug,version) is rejected by the UNIQUE constraint — versions are immutable.
func (s *Service) PublishSchema(ctx context.Context, slug string, version int, kind string, fields []Field) (*Schema, error) {
	if slug == "" || version < 1 {
		return nil, fmt.Errorf("intake: slug and version>=1 required")
	}
	if !validKind(kind) {
		return nil, fmt.Errorf("intake: invalid kind")
	}
	raw, err := json.Marshal(fields)
	if err != nil {
		return nil, fmt.Errorf("intake: marshal schema: %w", err)
	}
	sc := &Schema{ID: uuid.New().String(), Slug: slug, Version: version, Kind: kind, Fields: fields, Active: true, CreatedAt: time.Now()}
	const ins = `INSERT INTO health_intake_schemas (id, slug, version, kind, schema_json, active) VALUES ($1,$2,$3,$4,$5,true)`
	if _, err := s.db.Exec(ctx, ins, sc.ID, slug, version, kind, raw); err != nil {
		return nil, fmt.Errorf("intake: insert schema: %w", err)
	}
	s.audited("", "", "health.intake.schema.publish", sc.ID, nil, map[string]any{"slug": slug, "version": version})
	return sc, nil
}

func (s *Service) GetSchema(ctx context.Context, schemaID string) (*Schema, error) {
	return s.loadSchema(ctx, schemaID)
}

// GetActiveSchemaBySlug returns the highest active version for a slug. The
// pre-consult intake orchestrator (ADR-010) uses this to resolve the pinned
// PRE_CONSULT schema without hard-coding a schema id (the row is seeded by
// migration 20260818000000_preconsult_intake.sql, slug 'pre-consult').
func (s *Service) GetActiveSchemaBySlug(ctx context.Context, slug string) (*Schema, error) {
	var sc Schema
	var raw []byte
	const q = `SELECT id, slug, version, kind, schema_json, active, created_at
	           FROM health_intake_schemas WHERE slug=$1 AND active=true
	           ORDER BY version DESC LIMIT 1`
	if err := s.db.QueryRow(ctx, q, slug).Scan(&sc.ID, &sc.Slug, &sc.Version, &sc.Kind, &raw, &sc.Active, &sc.CreatedAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("intake: no active schema for slug %q", slug)
		}
		return nil, err
	}
	if err := json.Unmarshal(raw, &sc.Fields); err != nil {
		return nil, fmt.Errorf("intake: decode schema: %w", err)
	}
	return &sc, nil
}

// ValidateAnswers is the exported, pure required-vs-optional + type check used by
// the pre-consult orchestrator on submit (reuses the same validator as Submit so
// there is one validation contract). Unknown fields are rejected.
func (s *Service) ValidateAnswers(fields []Field, answers map[string]any) error {
	return validate(fields, answers)
}

// Submit validates answers against the EXACT submitted schema version and stores
// the response pinned to that version (HEALTH-BUILD §5/§6).
func (s *Service) Submit(ctx context.Context, respondentID, schemaID string, answers map[string]any) (*Response, error) {
	if respondentID == "" {
		return nil, fmt.Errorf("intake: respondent required")
	}
	sc, err := s.loadSchema(ctx, schemaID)
	if err != nil {
		return nil, err
	}
	if err := validate(sc.Fields, answers); err != nil {
		return nil, err
	}
	raw, err := json.Marshal(answers)
	if err != nil {
		return nil, fmt.Errorf("intake: marshal answers: %w", err)
	}
	r := &Response{ID: uuid.New().String(), SchemaID: schemaID, SchemaVersion: sc.Version, RespondentID: respondentID, Answers: answers, CreatedAt: time.Now()}
	const ins = `INSERT INTO health_intake_responses (id, schema_id, schema_version, respondent_id, answers_json) VALUES ($1,$2,$3,$4,$5)`
	if _, err := s.db.Exec(ctx, ins, r.ID, schemaID, sc.Version, respondentID, raw); err != nil {
		return nil, fmt.Errorf("intake: insert response: %w", err)
	}
	s.audited(respondentID, respondentID, "health.intake.submit", r.ID, nil, map[string]any{"schema_id": schemaID, "version": sc.Version})
	return r, nil
}

// validate checks answers against the field set of the SUBMITTED schema version:
// required fields present + basic type conformance. Unknown fields are rejected so
// a stale client cannot smuggle data past a newer schema.
func validate(fields []Field, answers map[string]any) error {
	allowed := make(map[string]Field, len(fields))
	for _, f := range fields {
		allowed[f.Name] = f
	}
	for k := range answers {
		if _, ok := allowed[k]; !ok {
			return fmt.Errorf("intake: unknown field %q for this schema version", k)
		}
	}
	for _, f := range fields {
		v, present := answers[f.Name]
		if !present || v == nil {
			if f.Required {
				return fmt.Errorf("intake: required field %q missing", f.Name)
			}
			continue
		}
		switch f.Type {
		case "number":
			if _, ok := v.(float64); !ok { // JSON numbers decode as float64
				return fmt.Errorf("intake: field %q must be a number", f.Name)
			}
		case "bool":
			if _, ok := v.(bool); !ok {
				return fmt.Errorf("intake: field %q must be a boolean", f.Name)
			}
		case "select":
			sv, ok := v.(string)
			if !ok || !contains(f.Options, sv) {
				return fmt.Errorf("intake: field %q must be one of the allowed options", f.Name)
			}
		default: // text
			if _, ok := v.(string); !ok {
				return fmt.Errorf("intake: field %q must be text", f.Name)
			}
		}
	}
	return nil
}

func (s *Service) loadSchema(ctx context.Context, schemaID string) (*Schema, error) {
	var sc Schema
	var raw []byte
	const q = `SELECT id, slug, version, kind, schema_json, active, created_at FROM health_intake_schemas WHERE id=$1`
	if err := s.db.QueryRow(ctx, q, schemaID).Scan(&sc.ID, &sc.Slug, &sc.Version, &sc.Kind, &raw, &sc.Active, &sc.CreatedAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("intake: schema not found")
		}
		return nil, err
	}
	if err := json.Unmarshal(raw, &sc.Fields); err != nil {
		return nil, fmt.Errorf("intake: decode schema: %w", err)
	}
	return &sc, nil
}

func (s *Service) audited(actor, target, action, resourceID string, oldV, newV map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actor, target, action, "health", "health_intake", resourceID, oldV, newV, "", "", "info")
}

func validKind(k string) bool {
	switch k {
	case "TRIAGE", "SYMPTOM", "TEST_PREP", "PRE_CONSULT":
		return true
	}
	return false
}

func contains(xs []string, v string) bool {
	for _, x := range xs {
		if x == v {
			return true
		}
	}
	return false
}
