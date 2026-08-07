package preconsult

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// admin.go — service methods + handlers for the admin console (A2–A13). All admin
// routes are RBAC-gated (health.admin.intake) and audit-logged at the wiring layer.
// The record viewer additionally writes a health_intake_access_log row (admin role).

// ── Red-flag rules (A2) ───────────────────────────────────────────────────────

type RedFlagRule struct {
	ID          string          `json:"id"`
	Code        string          `json:"code"`
	Label       string          `json:"label"`
	MatchJSON   json.RawMessage `json:"match_json"`
	Level       int             `json:"level"`
	Severity    string          `json:"severity"` // emergency | urgent
	Routing     string          `json:"routing"`  // EMERGENCY | URGENT_CARE | CRISIS
	GuidanceKey string          `json:"guidance_key"`
	Active      bool            `json:"active"`
	Version     int             `json:"version"`
}

func (s *Service) ListRedFlagRules(ctx context.Context) ([]RedFlagRule, error) {
	const q = `SELECT id, code, label, match_json, level, severity, routing, guidance_key, active, version
	           FROM health_redflag_rule ORDER BY level, code`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RedFlagRule
	for rows.Next() {
		var r RedFlagRule
		if err := rows.Scan(&r.ID, &r.Code, &r.Label, &r.MatchJSON, &r.Level, &r.Severity, &r.Routing, &r.GuidanceKey, &r.Active, &r.Version); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// UpsertRedFlagRule creates or updates a rule by unique code (admin A2).
func (s *Service) UpsertRedFlagRule(ctx context.Context, actor string, r RedFlagRule) (*RedFlagRule, error) {
	if r.Code == "" || r.Label == "" {
		return nil, fmt.Errorf("preconsult: code and label required")
	}
	if r.Level < 1 || r.Level > 5 {
		return nil, fmt.Errorf("preconsult: level must be 1..5")
	}
	if r.Severity != "emergency" && r.Severity != "urgent" {
		return nil, fmt.Errorf("preconsult: invalid severity")
	}
	switch r.Routing {
	case "EMERGENCY", "URGENT_CARE", "CRISIS":
	default:
		return nil, fmt.Errorf("preconsult: invalid routing")
	}
	if len(r.MatchJSON) == 0 {
		r.MatchJSON = json.RawMessage(`{}`)
	}
	const up = `INSERT INTO health_redflag_rule (id, code, label, match_json, level, severity, routing, guidance_key, active)
	            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,true))
	            ON CONFLICT (code) DO UPDATE SET
	              label=EXCLUDED.label, match_json=EXCLUDED.match_json, level=EXCLUDED.level,
	              severity=EXCLUDED.severity, routing=EXCLUDED.routing, guidance_key=EXCLUDED.guidance_key,
	              active=EXCLUDED.active, version=health_redflag_rule.version+1, updated_at=now()`
	id := uuid.New().String()
	if _, err := s.db.Exec(ctx, up, id, r.Code, r.Label, r.MatchJSON, r.Level, r.Severity, r.Routing, r.GuidanceKey, r.Active); err != nil {
		return nil, fmt.Errorf("preconsult: upsert rule: %w", err)
	}
	s.audited(actor, "", "health.preconsult.admin.rule.upsert", r.Code, nil, map[string]any{"code": r.Code, "active": r.Active})
	return s.getRule(ctx, r.Code)
}

// ToggleRedFlagRule activates/deactivates a rule by code.
func (s *Service) ToggleRedFlagRule(ctx context.Context, actor, code string, active bool) (*RedFlagRule, error) {
	ct, err := s.db.Exec(ctx, `UPDATE health_redflag_rule SET active=$2, version=version+1, updated_at=now() WHERE code=$1`, code, active)
	if err != nil {
		return nil, err
	}
	if ct.RowsAffected() == 0 {
		return nil, fmt.Errorf("preconsult: rule not found")
	}
	s.audited(actor, "", "health.preconsult.admin.rule.toggle", code, nil, map[string]any{"active": active})
	return s.getRule(ctx, code)
}

func (s *Service) getRule(ctx context.Context, code string) (*RedFlagRule, error) {
	var r RedFlagRule
	const q = `SELECT id, code, label, match_json, level, severity, routing, guidance_key, active, version FROM health_redflag_rule WHERE code=$1`
	if err := s.db.QueryRow(ctx, q, code).Scan(&r.ID, &r.Code, &r.Label, &r.MatchJSON, &r.Level, &r.Severity, &r.Routing, &r.GuidanceKey, &r.Active, &r.Version); err != nil {
		return nil, err
	}
	return &r, nil
}

// ── Consent versions (A4) ─────────────────────────────────────────────────────

type ConsentVersion struct {
	ID         string    `json:"id"`
	ConsentKey string    `json:"consent_key"`
	Version    int       `json:"version"`
	Locale     string    `json:"locale"`
	Body       string    `json:"body"`
	Active     bool      `json:"active"`
	CreatedAt  time.Time `json:"created_at"`
}

func (s *Service) ListConsentVersions(ctx context.Context) ([]ConsentVersion, error) {
	const q = `SELECT id, consent_key, version, locale, body, active, created_at FROM health_consent_version ORDER BY consent_key, version DESC`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ConsentVersion
	for rows.Next() {
		var c ConsentVersion
		if err := rows.Scan(&c.ID, &c.ConsentKey, &c.Version, &c.Locale, &c.Body, &c.Active, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// CreateConsentVersion authors a new consent version (immutable per version+locale).
func (s *Service) CreateConsentVersion(ctx context.Context, actor string, c ConsentVersion) (*ConsentVersion, error) {
	if c.Version < 1 || c.Body == "" {
		return nil, fmt.Errorf("preconsult: version>=1 and body required")
	}
	if c.ConsentKey == "" {
		c.ConsentKey = "PRE_CONSULT_INTAKE"
	}
	if c.Locale == "" {
		c.Locale = "en"
	}
	id := uuid.New().String()
	const ins = `INSERT INTO health_consent_version (id, consent_key, version, locale, body, active) VALUES ($1,$2,$3,$4,$5,$6)`
	if _, err := s.db.Exec(ctx, ins, id, c.ConsentKey, c.Version, c.Locale, c.Body, c.Active); err != nil {
		return nil, fmt.Errorf("preconsult: create consent version: %w", err)
	}
	s.audited(actor, "", "health.preconsult.admin.consent.create", id, nil, map[string]any{"version": c.Version, "locale": c.Locale})
	c.ID = id
	return &c, nil
}

// ── Clinical vocab (A3) ───────────────────────────────────────────────────────

func (s *Service) ListVocab(ctx context.Context, kind string) ([]Vocab, error) {
	return s.listVocab(ctx, kind)
}

func (s *Service) UpsertVocab(ctx context.Context, actor, kind, code, label string, active bool) error {
	switch kind {
	case "condition", "allergen", "medication":
	default:
		return fmt.Errorf("preconsult: invalid vocab kind")
	}
	if code == "" || label == "" {
		return fmt.Errorf("preconsult: code and label required")
	}
	const up = `INSERT INTO health_clinical_vocab (id, kind, code, label, active) VALUES ($1,$2,$3,$4,$5)
	            ON CONFLICT (kind, code) DO UPDATE SET label=EXCLUDED.label, active=EXCLUDED.active, version=health_clinical_vocab.version+1`
	if _, err := s.db.Exec(ctx, up, uuid.New().String(), kind, code, label, active); err != nil {
		return fmt.Errorf("preconsult: upsert vocab: %w", err)
	}
	s.audited(actor, "", "health.preconsult.admin.vocab.upsert", kind+":"+code, nil, map[string]any{"active": active})
	return nil
}

// ── Config get/set (A1/A5/A6/A7) ──────────────────────────────────────────────

func (s *Service) GetConfig(ctx context.Context, key string) (json.RawMessage, error) {
	return s.getConfig(ctx, key)
}

func (s *Service) SetConfig(ctx context.Context, actor, key string, value json.RawMessage) error {
	if key == "" {
		return fmt.Errorf("preconsult: config key required")
	}
	if len(value) == 0 || !json.Valid(value) {
		return fmt.Errorf("preconsult: value must be valid JSON")
	}
	const up = `INSERT INTO health_intake_config (id, config_key, value) VALUES ($1,$2,$3)
	            ON CONFLICT (config_key) DO UPDATE SET value=EXCLUDED.value, version=health_intake_config.version+1, updated_at=now()`
	if _, err := s.db.Exec(ctx, up, uuid.New().String(), key, value); err != nil {
		return fmt.Errorf("preconsult: set config: %w", err)
	}
	s.audited(actor, "", "health.preconsult.admin.config.set", key, nil, map[string]any{"key": key})
	return nil
}

// ── Intake monitoring (A8) ────────────────────────────────────────────────────

type MonitorRow struct {
	IntakeID        string     `json:"intake_id"`
	AppointmentID   string     `json:"appointment_id"`
	PatientID       string     `json:"patient_id"`
	ProviderID      string     `json:"provider_id"`
	Status          string     `json:"status"`
	SlotStart       time.Time  `json:"slot_start"`
	RedFlagSeverity *string    `json:"red_flag_severity,omitempty"`
	SubmittedAt     *time.Time `json:"submitted_at,omitempty"`
	IncompleteNear  bool       `json:"incomplete_near_appointment"`
}

// Monitoring lists appointments with intake status; incompleteOnly restricts to
// DRAFT intakes whose appointment is within the next `nearMinutes` minutes.
func (s *Service) Monitoring(ctx context.Context, incompleteOnly bool, nearMinutes int) ([]MonitorRow, error) {
	if nearMinutes <= 0 {
		nearMinutes = 120
	}
	const q = `SELECT i.id, i.appointment_id, i.patient_id::text, i.provider_id::text, i.status,
	                  a.slot_start, i.red_flag_severity, i.submitted_at
	           FROM health_preconsult_intake i
	           JOIN health_appointments a ON a.id = i.appointment_id
	           ORDER BY a.slot_start ASC LIMIT 500`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	now := time.Now()
	near := now.Add(time.Duration(nearMinutes) * time.Minute)
	var out []MonitorRow
	for rows.Next() {
		var m MonitorRow
		if err := rows.Scan(&m.IntakeID, &m.AppointmentID, &m.PatientID, &m.ProviderID, &m.Status, &m.SlotStart, &m.RedFlagSeverity, &m.SubmittedAt); err != nil {
			return nil, err
		}
		m.IncompleteNear = m.Status == "DRAFT" && m.SlotStart.After(now) && m.SlotStart.Before(near)
		if incompleteOnly && !m.IncompleteNear {
			continue
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ── Intake record viewer (A9; access-logged + audited) ────────────────────────

type AdminIntakeRecord struct {
	Intake  *Intake        `json:"intake"`
	Answers map[string]any `json:"answers"`
	Access  []AccessLogRow `json:"recent_access"`
}

// AdminViewIntake returns one intake for clinical-admin support. It WRITES an
// admin access-log row + audit before returning answers (PHI access trail, A10).
func (s *Service) AdminViewIntake(ctx context.Context, actor, appointmentID string) (*AdminIntakeRecord, error) {
	it, err := s.getIntakeByAppointment(ctx, appointmentID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("preconsult: intake not found")
		}
		return nil, err
	}
	answers, err := s.responseAnswers(ctx, it)
	if err != nil {
		return nil, err
	}
	if err := s.logAccess(ctx, it.ID, actor, "admin", "VIEW"); err != nil {
		return nil, fmt.Errorf("preconsult: access log: %w", err)
	}
	s.audited(actor, it.PatientID, "health.preconsult.admin.view", it.ID, nil, map[string]any{"appointment_id": appointmentID})
	access, _ := s.AccessLog(ctx, it.ID)
	return &AdminIntakeRecord{Intake: it, Answers: answers, Access: access}, nil
}

// ── Access & audit log (A10) ──────────────────────────────────────────────────

type AccessLogRow struct {
	IntakeID     string    `json:"intake_id"`
	AccessorID   string    `json:"accessor_id"`
	AccessorRole string    `json:"accessor_role"`
	Action       string    `json:"action"`
	CreatedAt    time.Time `json:"created_at"`
}

// AccessLog lists access rows; intakeID "" returns the most recent across intakes.
func (s *Service) AccessLog(ctx context.Context, intakeID string) ([]AccessLogRow, error) {
	const q = `SELECT COALESCE(intake_id::text,''), accessor_id::text, accessor_role, action, created_at
	           FROM health_intake_access_log
	           WHERE ($1='' OR intake_id::text=$1)
	           ORDER BY created_at DESC LIMIT 500`
	rows, err := s.db.Query(ctx, q, intakeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AccessLogRow
	for rows.Next() {
		var a AccessLogRow
		if err := rows.Scan(&a.IntakeID, &a.AccessorID, &a.AccessorRole, &a.Action, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ── Red-flag queue (A11) ──────────────────────────────────────────────────────

type RedFlagQueueRow struct {
	IntakeID      string          `json:"intake_id"`
	AppointmentID string          `json:"appointment_id"`
	PatientID     string          `json:"patient_id"`
	Severity      string          `json:"severity"`
	Level         *int            `json:"level,omitempty"`
	Hits          json.RawMessage `json:"hits"`
	SubmittedAt   *time.Time      `json:"submitted_at,omitempty"`
}

func (s *Service) RedFlagQueue(ctx context.Context) ([]RedFlagQueueRow, error) {
	const q = `SELECT id, appointment_id, patient_id::text, COALESCE(red_flag_severity,''), red_flag_level, red_flag_hits, submitted_at
	           FROM health_preconsult_intake
	           WHERE red_flag_severity IS NOT NULL
	           ORDER BY submitted_at DESC NULLS LAST LIMIT 500`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RedFlagQueueRow
	for rows.Next() {
		var r RedFlagQueueRow
		if err := rows.Scan(&r.IntakeID, &r.AppointmentID, &r.PatientID, &r.Severity, &r.Level, &r.Hits, &r.SubmittedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ── Analytics (A12/A13; de-identified, counts only) ───────────────────────────

type Analytics struct {
	Total          int            `json:"total_intakes"`
	Submitted      int            `json:"submitted"`
	Draft          int            `json:"draft"`
	CompletionRate float64        `json:"completion_rate"`
	RedFlagCount   int            `json:"red_flag_count"`
	RedFlagRate    float64        `json:"red_flag_rate"`
	StepDropoff    map[string]int `json:"step_dropoff"`        // unanswered-field counts on DRAFT intakes
	TopCategories  map[string]int `json:"top_reason_category"` // aggregated, de-identified
}

// Analytics aggregates de-identified counts only (no PHI bodies). Per-step dropoff
// approximates the wizard step a DRAFT abandoned at by counting which required
// fields are still empty in the draft.
func (s *Service) Analytics(ctx context.Context) (*Analytics, error) {
	a := &Analytics{StepDropoff: map[string]int{}, TopCategories: map[string]int{}}

	const counts = `SELECT
	    count(*),
	    count(*) FILTER (WHERE status='SUBMITTED'),
	    count(*) FILTER (WHERE status='DRAFT'),
	    count(*) FILTER (WHERE red_flag_severity IS NOT NULL)
	  FROM health_preconsult_intake`
	if err := s.db.QueryRow(ctx, counts).Scan(&a.Total, &a.Submitted, &a.Draft, &a.RedFlagCount); err != nil {
		return nil, err
	}
	if a.Total > 0 {
		a.CompletionRate = float64(a.Submitted) / float64(a.Total)
		a.RedFlagRate = float64(a.RedFlagCount) / float64(a.Total)
	}

	// Per-step dropoff: which required fields are still empty in DRAFT drafts.
	required := []string{"reason_for_visit", "symptom_onset", "symptom_severity"}
	rows, err := s.db.Query(ctx, `SELECT draft_json FROM health_preconsult_intake WHERE status='DRAFT'`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var raw []byte
			if rows.Scan(&raw) != nil {
				continue
			}
			var m map[string]any
			if len(raw) == 0 || json.Unmarshal(raw, &m) != nil {
				m = map[string]any{}
			}
			for _, f := range required {
				if v, ok := m[f]; !ok || v == nil || v == "" {
					a.StepDropoff[f]++
				}
			}
		}
	}

	// Top reason categories from submitted responses (aggregated counts only).
	catRows, err := s.db.Query(ctx, `
	  SELECT COALESCE(r.answers_json->>'reason_category',''), count(*)
	  FROM health_preconsult_intake i
	  JOIN health_intake_responses r ON r.id = i.response_id
	  WHERE i.status='SUBMITTED'
	  GROUP BY 1`)
	if err == nil {
		defer catRows.Close()
		for catRows.Next() {
			var cat string
			var n int
			if catRows.Scan(&cat, &n) != nil {
				continue
			}
			if cat == "" {
				cat = "unspecified"
			}
			a.TopCategories[cat] = n
		}
	}
	return a, nil
}
