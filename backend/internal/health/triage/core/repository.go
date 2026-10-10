package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"spotlight/backend/internal/health/triage"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/dbutil"
	"spotlight/backend/go-common/strutil"
)

// repository.go — pgx persistence for the triage core. All writes are
// parameterised. Intake / evidence / assessment / red-flag-event rows are
// APPEND-ONLY (immutable; SC-12). Session state changes go through a GUARDED
// conditional UPDATE (... WHERE state=$from) so a lost race can never drive an
// illegal transition; the guard pairs with triage.CanSession in the service.

type repository struct {
	db *pgxpool.Pool
}

func newRepository(db *pgxpool.Pool) *repository { return &repository{db: db} }

func (r *repository) createProfile(ctx context.Context, p *Profile) error {
	p.ID = uuid.New().String()
	const q = `
		INSERT INTO public.health_triage_profiles (id, user_id, kind, name, dob, sex, is_pregnant)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING created_at`
	return r.db.QueryRow(ctx, q, p.ID, p.UserID, p.Kind, dbutil.NullStr(p.Name), nullTimePtr(p.DOB),
		dbutil.NullStr(p.Sex), p.IsPregnant).Scan(&p.CreatedAt)
}

func (r *repository) listProfiles(ctx context.Context, userID string) ([]Profile, error) {
	const q = `
		SELECT id, user_id, kind, COALESCE(name,''), dob, COALESCE(sex,''), is_pregnant, created_at
		FROM public.health_triage_profiles WHERE user_id=$1 ORDER BY created_at`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("core: list profiles: %w", err)
	}
	defer rows.Close()
	var out []Profile
	for rows.Next() {
		var p Profile
		if err := rows.Scan(&p.ID, &p.UserID, &p.Kind, &p.Name, &p.DOB, &p.Sex, &p.IsPregnant, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *repository) getProfile(ctx context.Context, userID, profileID string) (*Profile, error) {
	const q = `
		SELECT id, user_id, kind, COALESCE(name,''), dob, COALESCE(sex,''), is_pregnant, created_at
		FROM public.health_triage_profiles WHERE id=$1 AND user_id=$2`
	var p Profile
	if err := r.db.QueryRow(ctx, q, profileID, userID).Scan(&p.ID, &p.UserID, &p.Kind, &p.Name,
		&p.DOB, &p.Sex, &p.IsPregnant, &p.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrProfileNotFound
		}
		return nil, err
	}
	return &p, nil
}

func (r *repository) createConsent(ctx context.Context, c *Consent) error {
	c.ID = uuid.New().String()
	scope, err := json.Marshal(c.Scope)
	if err != nil {
		return fmt.Errorf("core: marshal consent scope: %w", err)
	}
	const q = `
		INSERT INTO public.health_triage_consents (id, user_id, profile_id, scope)
		VALUES ($1,$2,$3,$4) RETURNING granted_at`
	return r.db.QueryRow(ctx, q, c.ID, c.UserID, c.ProfileID, scope).Scan(&c.GrantedAt)
}

func (r *repository) createSession(ctx context.Context, s *Session) error {
	s.ID = uuid.New().String()
	const q = `
		INSERT INTO public.health_triage_sessions
		  (id, user_id, profile_id, state, language, channel, consent_id, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING started_at, created_at`
	return r.db.QueryRow(ctx, q, s.ID, s.UserID, s.ProfileID, s.State, s.Language, s.Channel,
		s.ConsentID, s.IdempotencyKey).Scan(&s.StartedAt, &s.CreatedAt)
}

func (r *repository) getSession(ctx context.Context, userID, sessionID string) (*Session, error) {
	const q = `
		SELECT id, user_id, profile_id, state, language, channel, consent_id,
		       disposition_level, disposition_code, engine_ref, red_flag,
		       started_at, assessed_at, closed_at, created_at
		FROM public.health_triage_sessions WHERE id=$1 AND user_id=$2`
	var s Session
	if err := r.db.QueryRow(ctx, q, sessionID, userID).Scan(
		&s.ID, &s.UserID, &s.ProfileID, &s.State, &s.Language, &s.Channel, &s.ConsentID,
		&s.DispositionLevel, &s.DispositionCode, &s.EngineRef, &s.RedFlag,
		&s.StartedAt, &s.AssessedAt, &s.ClosedAt, &s.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrSessionNotFound
		}
		return nil, err
	}
	return &s, nil
}

// updateSessionState performs the GUARDED transition: it only flips the row when
// the current state equals `from` (optimistic lock against concurrent transitions).
// Returns false (no error) when the guard did not match — the caller treats that
// as an illegal/lost transition. SC-12: callers audit every successful flip.
func (r *repository) updateSessionState(ctx context.Context, sessionID string, from, to triage.SessionState) (bool, error) {
	const q = `UPDATE public.health_triage_sessions SET state=$3 WHERE id=$1 AND state=$2`
	ct, err := r.db.Exec(ctx, q, sessionID, string(from), string(to))
	if err != nil {
		return false, fmt.Errorf("core: update session state: %w", err)
	}
	return ct.RowsAffected() == 1, nil
}

// setConsent attaches the consent id to a session (recorded at STARTED→CONSENTED).
func (r *repository) setConsent(ctx context.Context, sessionID, consentID string) error {
	const q = `UPDATE public.health_triage_sessions SET consent_id=$2 WHERE id=$1`
	_, err := r.db.Exec(ctx, q, sessionID, consentID)
	return err
}

// setDisposition writes the projected disposition onto the session row (a
// projection of the immutable assessment + red-flag layer — never a free balance).
func (r *repository) setDisposition(ctx context.Context, sessionID string, level int, code, engineRef string, redFlag bool) error {
	const q = `
		UPDATE public.health_triage_sessions
		SET disposition_level=$2, disposition_code=$3, engine_ref=$4, red_flag=$5, assessed_at=now()
		WHERE id=$1`
	_, err := r.db.Exec(ctx, q, sessionID, level, code, engineRef, redFlag)
	return err
}

func (r *repository) appendIntake(ctx context.Context, in *Intake) error {
	in.ID = uuid.New().String()
	bodyMap, err := json.Marshal(orEmptyMap(in.BodyMap))
	if err != nil {
		return fmt.Errorf("core: marshal body_map: %w", err)
	}
	const q = `
		INSERT INTO public.health_triage_intake (id, session_id, raw_text, language, body_map)
		VALUES ($1,$2,$3,$4,$5) RETURNING created_at`
	return r.db.QueryRow(ctx, q, in.ID, in.SessionID, dbutil.NullStr(in.RawText), dbutil.NullStr(in.Language), bodyMap).
		Scan(&in.CreatedAt)
}

func (r *repository) appendEvidence(ctx context.Context, sessionID string, ev []triage.Evidence) error {
	if len(ev) == 0 {
		return nil
	}
	batch := &pgx.Batch{}
	const q = `
		INSERT INTO public.health_triage_evidence (id, session_id, kind, code, value, source)
		VALUES ($1,$2,$3,$4,$5,$6)`
	for _, e := range ev {
		batch.Queue(q, uuid.New().String(), sessionID, e.Kind, e.Code, dbutil.NullStr(e.Value), strutil.FirstNonEmpty(e.Source, "user"))
	}
	br := r.db.SendBatch(ctx, batch)
	defer func() { _ = br.Close() }()
	for range ev {
		if _, err := br.Exec(); err != nil {
			return fmt.Errorf("core: append evidence: %w", err)
		}
	}
	return nil
}

func (r *repository) listEvidence(ctx context.Context, sessionID string) ([]EvidenceRow, error) {
	const q = `
		SELECT id, session_id, kind, code, COALESCE(value,''), source, created_at
		FROM public.health_triage_evidence WHERE session_id=$1 ORDER BY created_at`
	rows, err := r.db.Query(ctx, q, sessionID)
	if err != nil {
		return nil, fmt.Errorf("core: list evidence: %w", err)
	}
	defer rows.Close()
	var out []EvidenceRow
	for rows.Next() {
		var e EvidenceRow
		if err := rows.Scan(&e.ID, &e.SessionID, &e.Kind, &e.Code, &e.Value, &e.Source, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (r *repository) appendAssessment(ctx context.Context, a *Assessment) error {
	a.ID = uuid.New().String()
	conds, err := json.Marshal(orEmptyCauses(a.Conditions))
	if err != nil {
		return fmt.Errorf("core: marshal conditions: %w", err)
	}
	payload, err := json.Marshal(orEmptyMap(a.EnginePayload))
	if err != nil {
		return fmt.Errorf("core: marshal engine_payload: %w", err)
	}
	const q = `
		INSERT INTO public.health_triage_assessments
		  (id, session_id, conditions, disposition_level, disposition_code, engine_payload,
		   red_flag_triggered, rule_id, source)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		RETURNING created_at`
	return r.db.QueryRow(ctx, q, a.ID, a.SessionID, conds, a.DispositionLevel, a.DispositionCode,
		payload, a.RedFlagTriggered, a.RuleID, strutil.FirstNonEmpty(a.Source, "engine")).Scan(&a.CreatedAt)
}

func (r *repository) latestAssessment(ctx context.Context, sessionID string) (*Assessment, error) {
	const q = `
		SELECT id, session_id, conditions, disposition_level, disposition_code, engine_payload,
		       red_flag_triggered, rule_id, source, created_at
		FROM public.health_triage_assessments WHERE session_id=$1 ORDER BY created_at DESC LIMIT 1`
	var a Assessment
	var conds, payload []byte
	if err := r.db.QueryRow(ctx, q, sessionID).Scan(&a.ID, &a.SessionID, &conds, &a.DispositionLevel,
		&a.DispositionCode, &payload, &a.RedFlagTriggered, &a.RuleID, &a.Source, &a.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil // no assessment yet — not an error
		}
		return nil, err
	}
	_ = json.Unmarshal(conds, &a.Conditions)
	_ = json.Unmarshal(payload, &a.EnginePayload)
	return &a, nil
}

func (r *repository) appendRedFlagEvent(ctx context.Context, sessionID string, hit *triage.RedFlagHit) error {
	matched, err := json.Marshal(orEmptyMap(hit.Matched))
	if err != nil {
		return fmt.Errorf("core: marshal matched: %w", err)
	}
	// rule_id in the migration is a uuid FK to the (clinician-governed) rules table.
	// The deterministic safety-net rules are code-identified, not uuids, so the FK is
	// left NULL here and the rule code is preserved in matched (SC-12 audit trail).
	const q = `
		INSERT INTO public.health_triage_red_flag_events (id, session_id, rule_id, severity, matched)
		VALUES ($1,$2,$3,$4,$5)`
	_, err = r.db.Exec(ctx, q, uuid.New().String(), sessionID, ruleUUID(hit.RuleID), hit.Severity, matched)
	return err
}

func (r *repository) writeSessionReport(ctx context.Context, sessionID, userID string, summary map[string]any, vaultRef string) error {
	body, err := json.Marshal(orEmptyMap(summary))
	if err != nil {
		return fmt.Errorf("core: marshal report: %w", err)
	}
	const q = `
		INSERT INTO public.health_triage_session_reports (id, session_id, user_id, summary, vault_ref)
		VALUES ($1,$2,$3,$4,$5)`
	_, err = r.db.Exec(ctx, q, uuid.New().String(), sessionID, userID, body, dbutil.NullStr(vaultRef))
	return err
}

func nullTimePtr(t *time.Time) any {
	if t == nil {
		return nil
	}
	return *t
}

func orEmptyMap(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}

func orEmptyCauses(c []triage.PossibleCause) []triage.PossibleCause {
	if c == nil {
		return []triage.PossibleCause{}
	}
	return c
}

// ruleUUID returns nil for non-uuid (code-based) rule ids so the FK stays valid;
// a valid uuid string is passed through for DB-governed rules.
func ruleUUID(id string) any {
	if _, err := uuid.Parse(id); err != nil {
		return nil
	}
	return id
}

// Session mirrors public.health_triage_sessions. disposition_level is 1..5
// (1=emergency .. 5=self-care); it is the PROJECTION of the assessment + the
// always-overriding red-flag layer, never a diagnosis (SC-1).
type Session struct {
	ID               string     `json:"id"`
	UserID           string     `json:"user_id"`
	ProfileID        *string    `json:"profile_id,omitempty"`
	State            string     `json:"state"`
	Language         string     `json:"language"`
	Channel          string     `json:"channel"`
	ConsentID        *string    `json:"consent_id,omitempty"`
	DispositionLevel *int       `json:"disposition_level,omitempty"`
	DispositionCode  *string    `json:"disposition_code,omitempty"`
	EngineRef        *string    `json:"engine_ref,omitempty"`
	RedFlag          bool       `json:"red_flag"`
	StartedAt        time.Time  `json:"started_at"`
	AssessedAt       *time.Time `json:"assessed_at,omitempty"`
	ClosedAt         *time.Time `json:"closed_at,omitempty"`
	IdempotencyKey   *string    `json:"-"`
	CreatedAt        time.Time  `json:"created_at"`
}

// Profile mirrors public.health_triage_profiles. The DOB is the only birth
// detail held; the engine is given an age band + sex only (SC-7 minimisation).
type Profile struct {
	ID         string     `json:"id"`
	UserID     string     `json:"user_id"`
	Kind       string     `json:"kind"` // self | child | dependant
	Name       string     `json:"name,omitempty"`
	DOB        *time.Time `json:"dob,omitempty"`
	Sex        string     `json:"sex,omitempty"`
	IsPregnant bool       `json:"is_pregnant"`
	CreatedAt  time.Time  `json:"created_at"`
}

// Consent mirrors public.health_triage_consents (immutable; SC-7 NDPA).
type Consent struct {
	ID        string         `json:"id"`
	UserID    string         `json:"user_id"`
	ProfileID *string        `json:"profile_id,omitempty"`
	Scope     map[string]any `json:"scope"`
	GrantedAt time.Time      `json:"granted_at"`
}

// Intake mirrors public.health_triage_intake — raw symptom text / body-map per
// channel. Raw text is the ONLY place free text is held; it never reaches the
// engine (SC-7/SC-10): the LLM extracts structured evidence from it first.
type Intake struct {
	ID        string         `json:"id"`
	SessionID string         `json:"session_id"`
	RawText   string         `json:"raw_text,omitempty"`
	Language  string         `json:"language,omitempty"`
	BodyMap   map[string]any `json:"body_map,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
}

// EvidenceRow mirrors public.health_triage_evidence — an immutable structured
// fact consumed by the engine. It NEVER carries a clinical conclusion (SC-10).
type EvidenceRow struct {
	ID        string    `json:"id"`
	SessionID string    `json:"session_id"`
	Kind      string    `json:"kind"`   // symptom | risk_factor | answer
	Code      string    `json:"code"`   // engine concept id
	Value     string    `json:"value"`  // present | absent | unknown / answer value
	Source    string    `json:"source"` // user | nlu | engine | region
	CreatedAt time.Time `json:"created_at"`
}

// toEvidence converts a persisted row into the contract Evidence the engine and
// red-flag layer consume.
func (e EvidenceRow) toEvidence() triage.Evidence {
	return triage.Evidence{Kind: e.Kind, Code: e.Code, Value: e.Value, Source: e.Source}
}

// Assessment mirrors public.health_triage_assessments. conditions are POSSIBLE
// CAUSES (label + probability), never a diagnosis (SC-1). disposition_level is
// 1..5 and reflects the red-flag-overridden level.
type Assessment struct {
	ID               string                 `json:"id"`
	SessionID        string                 `json:"session_id"`
	Conditions       []triage.PossibleCause `json:"conditions"`
	DispositionLevel int                    `json:"disposition_level"`
	DispositionCode  string                 `json:"disposition_code"`
	EnginePayload    map[string]any         `json:"engine_payload,omitempty"`
	RedFlagTriggered bool                   `json:"red_flag_triggered"`
	RuleID           *string                `json:"rule_id,omitempty"`
	Source           string                 `json:"source"` // engine | red_flag | fallback
	CreatedAt        time.Time              `json:"created_at"`
}

// SessionView is the read model returned by GetSession. It frames the assessment
// as POSSIBLE CAUSES (never "diagnosis", SC-1) and always carries the mandatory
// medical disclaimer (SC-8) plus the care route for the level (§6).
type SessionView struct {
	Session        Session                `json:"session"`
	PossibleCauses []triage.PossibleCause `json:"possible_causes"`
	Disposition    *Disposition           `json:"disposition,omitempty"`
	NextQuestion   *triage.Question       `json:"next_question,omitempty"`
	Disclaimer     string                 `json:"disclaimer"`
}

// Disposition is the navigation outcome — level + plain-language guidance + the
// care-loop route. It is explicitly NOT a diagnosis (SC-1).
type Disposition struct {
	Level    int    `json:"level"` // 1..5
	Code     string `json:"code"`
	Route    string `json:"route"`    // emergency | telemed | self_care
	RedFlag  bool   `json:"red_flag"` // forced up by the deterministic layer (SC-2)
	Guidance string `json:"guidance"`
}

// Disclaimer is the mandatory medical disclaimer surfaced on every result (SC-8).
// It reinforces SC-1 framing: triage/navigation, possible causes, not a diagnosis.
const Disclaimer = "This is triage and navigation guidance, not a medical diagnosis. " +
	"It suggests possible causes and a next step only. " +
	"If this is an emergency, seek emergency care or call an ambulance immediately. " +
	"Always confirm with a licensed clinician."

// dispositionCodeFor returns the stable disposition code for a level. (The parent
// package's dispositionCode is unexported, so core keeps its own copy in sync.)
func dispositionCodeFor(level int) string {
	switch level {
	case triage.LevelEmergencyAmbulance:
		return "emergency_ambulance"
	case triage.LevelEmergencyUrgent:
		return "emergency_urgent"
	case triage.LevelConsult24h:
		return "consult_24h"
	case triage.LevelConsult:
		return "consult"
	default:
		return "self_care"
	}
}

// guidanceForLevel returns conservative plain-language next-step copy per level.
// Framed as guidance toward care (SC-1), never as a diagnosis or a prescription.
func guidanceForLevel(level int) string {
	switch level {
	case triage.LevelEmergencyAmbulance:
		return "This may be an emergency. Call an ambulance and go to the nearest emergency facility now."
	case triage.LevelEmergencyUrgent:
		return "Go now to the nearest health facility, or start an urgent telemedicine consult."
	case triage.LevelConsult24h:
		return "See a clinician within 24 hours — book a telemedicine or pharmacist consult."
	case triage.LevelConsult:
		return "Book a routine consult with a doctor or pharmacist; a lab test may help."
	default:
		return "Home care and over-the-counter guidance may help. We will check in on you to follow up."
	}
}
