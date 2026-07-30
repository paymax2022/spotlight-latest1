package core

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/health/triage"
)

// service.go — SessionService orchestrates the AI Symptom Checker session
// lifecycle. It enforces the SC-safety invariants at the seams:
//
//   SC-1  output is framed as POSSIBLE CAUSES + guidance, never a diagnosis.
//   SC-2/3 the deterministic RED-FLAG layer (via triage.ApplyRedFlag) ALWAYS wins
//          toward higher urgency; emergencies are rules-based, not probabilistic.
//   SC-4  the engine triages only — no prescribing/dosing/dx is ever produced.
//   SC-7  explicit consent is recorded BEFORE interviewing; the engine is fed a
//          DE-IDENTIFIED EngineInput (age band + sex + region + evidence only).
//   SC-10 the LLM extracts STRUCTURED evidence only (LLMExtractor) — no conclusions.
//   SC-12 every state transition + the final disposition is immutably audited.

const auditModule = "health.triage"

// Auditor is the minimal immutable-audit slice (SC-12). nil is safe.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// VaultWriter is the optional records-vault sink (PRD §6: every outcome writes to
// the records vault). Satisfied by health/records.Service.Create via a thin
// adapter in the wiring layer. nil → the service stores a session-report row only.
type VaultWriter interface {
	Create(ctx context.Context, ownerID, createdBy, subjectType, recordType, title, body string, petRef *string) (vaultRef string, err error)
}

// SessionService is the triage orchestrator. Its three engines are injected and
// each has a safe default (mock-first) so the package runs network-free in CI.
type SessionService struct {
	repo      *repository
	engine    triage.EngineProvider
	extractor triage.EvidenceExtractor
	redflag   triage.RedFlagEngine
	vault     VaultWriter
	audit     Auditor
}

// NewSessionService wires the orchestrator. nil deps fall back to the
// deterministic mocks / DefaultRedFlagEngine (mock-first, SC-2 safety net).
func NewSessionService(db *pgxpool.Pool, engine triage.EngineProvider, extractor triage.EvidenceExtractor, redflag triage.RedFlagEngine, vault VaultWriter, audit Auditor) *SessionService {
	if engine == nil {
		engine = triage.MockEngine{}
	}
	if extractor == nil {
		extractor = triage.MockExtractor{}
	}
	if redflag == nil {
		redflag = NewLayeredRedFlag(triage.DefaultRedFlagEngine{}, nil)
	}
	return &SessionService{
		repo:      newRepository(db),
		engine:    engine,
		extractor: extractor,
		redflag:   redflag,
		vault:     vault,
		audit:     audit,
	}
}

// --- profiles ---

// CreateProfile creates a triage profile (self/child/dependant) for the user.
func (s *SessionService) CreateProfile(ctx context.Context, userID, kind, name, sex string, dob *time.Time, pregnant bool) (*Profile, error) {
	if userID == "" {
		return nil, fmt.Errorf("core: user required")
	}
	if kind == "" {
		kind = "self"
	}
	p := &Profile{UserID: userID, Kind: kind, Name: name, Sex: sex, DOB: dob, IsPregnant: pregnant}
	if err := s.repo.createProfile(ctx, p); err != nil {
		return nil, err
	}
	s.auditTo(userID, userID, "health.triage.profile.create", p.ID, nil,
		map[string]any{"kind": kind}) // SC-7: no name/DOB in audit values.
	return p, nil
}

// ListProfiles returns the user's triage profiles.
func (s *SessionService) ListProfiles(ctx context.Context, userID string) ([]Profile, error) {
	return s.repo.listProfiles(ctx, userID)
}

// --- StartSession (SC-7 consent before interviewing) ---

// StartParams is the StartSession input.
type StartParams struct {
	ProfileID    *string        `json:"profile_id"`
	Language     string         `json:"language"`
	Channel      string         `json:"channel"`
	ConsentScope map[string]any `json:"consent_scope"`
}

// StartSession records EXPLICIT consent (SC-7) then advances STARTED→CONSENTED.
// No interviewing or engine call happens before consent is on record.
func (s *SessionService) StartSession(ctx context.Context, userID string, p StartParams) (*Session, error) {
	if userID == "" {
		return nil, fmt.Errorf("core: user required")
	}
	lang := defStr(p.Language, "en")
	ch := defStr(p.Channel, "app")

	sess := &Session{
		UserID:    userID,
		ProfileID: p.ProfileID,
		State:     string(triage.SessStarted),
		Language:  lang,
		Channel:   ch,
	}
	if err := s.repo.createSession(ctx, sess); err != nil {
		return nil, err
	}
	s.auditTo(userID, userID, "health.triage.session.start", sess.ID, nil,
		map[string]any{"state": string(triage.SessStarted), "channel": ch, "language": lang})

	// SC-7: record explicit consent BEFORE interviewing can begin.
	consent := &Consent{UserID: userID, ProfileID: p.ProfileID, Scope: p.ConsentScope}
	if err := s.repo.createConsent(ctx, consent); err != nil {
		return nil, err
	}
	if err := s.repo.setConsent(ctx, sess.ID, consent.ID); err != nil {
		return nil, err
	}
	sess.ConsentID = &consent.ID

	if err := s.transition(ctx, userID, sess, triage.SessStarted, triage.SessConsented,
		"health.triage.session.consent", map[string]any{"consent_id": consent.ID}); err != nil {
		return nil, err
	}
	return sess, nil
}

// --- SubmitIntake (CONSENTED→INTERVIEWING; extract → red-flag → engine) ---

// IntakeParams is the SubmitIntake input.
type IntakeParams struct {
	RawText string         `json:"raw_text"`
	BodyMap map[string]any `json:"body_map"`
}

// SubmitIntake moves a consented session into interviewing, extracts structured
// evidence from the raw text (LLM/mock — SC-10), persists it, then runs the
// safety + engine loop. If the engine needs more answers it returns the next
// question and stays interviewing; otherwise it finalises a disposition.
func (s *SessionService) SubmitIntake(ctx context.Context, userID, sessionID string, p IntakeParams) (*SessionView, error) {
	sess, err := s.repo.getSession(ctx, userID, sessionID)
	if err != nil {
		return nil, err
	}
	if sess.State != string(triage.SessConsented) {
		return nil, fmt.Errorf("core: intake requires consented session (state=%s)", sess.State)
	}

	// CONSENTED → INTERVIEWING (guarded + audited).
	if err := s.transition(ctx, userID, sess, triage.SessConsented, triage.SessInterviewing,
		"health.triage.session.interview", nil); err != nil {
		return nil, err
	}

	// Persist raw intake (the ONLY place free text lives; never sent to the engine).
	intake := &Intake{SessionID: sessionID, RawText: p.RawText, Language: sess.Language, BodyMap: p.BodyMap}
	if err := s.repo.appendIntake(ctx, intake); err != nil {
		return nil, err
	}

	// SC-10: LLM extracts STRUCTURED evidence only (mock fallback). Persist immutably.
	ev, err := s.extractor.Extract(ctx, p.RawText, sess.Language)
	if err != nil {
		return nil, fmt.Errorf("core: evidence extraction: %w", err)
	}
	if err := s.repo.appendEvidence(ctx, sessionID, ev); err != nil {
		return nil, err
	}

	return s.runEngineLoop(ctx, userID, sess)
}

// --- Answer (append evidence, re-run engine; interview loop) ---

// Answer appends one structured answer to the interview and re-runs the engine.
// It loops the interview (stays INTERVIEWING) until the engine is done, then
// finalises the disposition.
func (s *SessionService) Answer(ctx context.Context, userID, sessionID, code, value string) (*SessionView, error) {
	sess, err := s.repo.getSession(ctx, userID, sessionID)
	if err != nil {
		return nil, err
	}
	if sess.State != string(triage.SessInterviewing) {
		return nil, fmt.Errorf("core: answer requires interviewing session (state=%s)", sess.State)
	}
	if code == "" {
		return nil, fmt.Errorf("core: answer code required")
	}
	answer := []triage.Evidence{{Kind: "answer", Code: code, Value: defStr(value, "present"), Source: "user"}}
	if err := s.repo.appendEvidence(ctx, sessionID, answer); err != nil {
		return nil, err
	}
	return s.runEngineLoop(ctx, userID, sess)
}

// runEngineLoop is the shared interview/finalise step. It (1) loads all evidence,
// (2) runs the deterministic RED-FLAG safety layer, (3) runs the engine triage,
// (4) if the engine wants more answers AND no red flag → returns the next question
// (stays interviewing), else (5) finalises the disposition with red-flag override.
func (s *SessionService) runEngineLoop(ctx context.Context, userID string, sess *Session) (*SessionView, error) {
	rows, err := s.repo.listEvidence(ctx, sess.ID)
	if err != nil {
		return nil, err
	}
	evidence := make([]triage.Evidence, 0, len(rows))
	for _, r := range rows {
		evidence = append(evidence, r.toEvidence())
	}

	ageYears, sex, region, pregnant := s.deidentify(ctx, userID, sess)

	// SC-2/SC-3: deterministic red-flag layer runs FIRST as the safety net.
	hit, err := s.redflag.Evaluate(ctx, evidence, ageYears, pregnant)
	if err != nil {
		return nil, fmt.Errorf("core: red-flag eval: %w", err)
	}

	// SC-7: engine input is DE-IDENTIFIED — age band + sex + region + evidence only.
	in := triage.EngineInput{AgeYears: ageYears, Sex: sex, Region: region, Evidence: evidence}
	res, err := s.engine.Triage(ctx, in)
	if err != nil {
		return nil, fmt.Errorf("core: engine triage: %w", err)
	}

	// Keep interviewing only if the engine wants more answers AND there is no red
	// flag (a red flag short-circuits the interview straight to emergency — SC-3).
	if hit == nil && !res.Done && len(res.Questions) > 0 {
		view, err := s.view(ctx, userID, sess.ID)
		if err != nil {
			return nil, err
		}
		q := res.Questions[0]
		view.NextQuestion = &q
		return view, nil
	}

	return s.finalize(ctx, userID, sess, res, hit)
}

// finalize applies the red-flag override (SC-2 via triage.ApplyRedFlag), persists
// an immutable assessment (possible causes — SC-1), advances the session to its
// terminal disposition state (with a red_flag_detected hop + event when a flag
// fired — SC-12), writes the session report to the vault, and audits everything.
func (s *SessionService) finalize(ctx context.Context, userID string, sess *Session, res triage.EngineResult, hit *triage.RedFlagHit) (*SessionView, error) {
	// SC-2/SC-3: the red-flag layer ALWAYS wins toward the more urgent level.
	level, redFlag := triage.ApplyRedFlag(res.Level, hit)
	// Fail SAFE (SC-3/TR-007): normalize any out-of-range disposition (0/unset,
	// negative, or above self-care) to a conservative clinician consult — never
	// let garbage/uncertain output route to self-care.
	level = triage.SafeLevel(level)
	code := dispositionCodeFor(level)
	engineRef := res.EngineRef
	if engineRef == "" {
		engineRef = s.engine.Name()
	}

	source := "engine"
	var ruleID *string
	if redFlag {
		source = "red_flag"
		if hit != nil {
			rid := hit.RuleID
			ruleID = &rid
		}
	}

	// State path: red flag → red_flag_detected → disposition_given (with event);
	// otherwise interviewing → assessed → disposition_given.
	if redFlag && hit != nil {
		if err := s.transition(ctx, userID, sess, triage.SessInterviewing, triage.SessRedFlag,
			"health.triage.session.red_flag", map[string]any{"rule_id": hit.RuleID, "severity": hit.Severity, "level": level}); err != nil {
			return nil, err
		}
		if err := s.repo.appendRedFlagEvent(ctx, sess.ID, hit); err != nil {
			return nil, err
		}
		if err := s.transition(ctx, userID, sess, triage.SessRedFlag, triage.SessDisposition,
			"health.triage.session.disposition", map[string]any{"level": level, "code": code, "red_flag": true}); err != nil {
			return nil, err
		}
	} else {
		if err := s.transition(ctx, userID, sess, triage.SessInterviewing, triage.SessAssessed,
			"health.triage.session.assessed", map[string]any{"level": level}); err != nil {
			return nil, err
		}
		if err := s.transition(ctx, userID, sess, triage.SessAssessed, triage.SessDisposition,
			"health.triage.session.disposition", map[string]any{"level": level, "code": code, "red_flag": false}); err != nil {
			return nil, err
		}
	}

	// Immutable assessment — conditions are POSSIBLE CAUSES, level 1..5 (SC-1).
	assessment := &Assessment{
		SessionID:        sess.ID,
		Conditions:       res.Conditions,
		DispositionLevel: level,
		DispositionCode:  code,
		EnginePayload:    map[string]any{"engine_ref": engineRef, "engine_level": res.Level},
		RedFlagTriggered: redFlag,
		RuleID:           ruleID,
		Source:           source,
	}
	if err := s.repo.appendAssessment(ctx, assessment); err != nil {
		return nil, err
	}

	// Projection onto the session row (never a free-balance update).
	if err := s.repo.setDisposition(ctx, sess.ID, level, code, engineRef, redFlag); err != nil {
		return nil, err
	}

	// PRD §6: every outcome writes to the records vault (or a session-report row).
	s.persistReport(ctx, userID, sess.ID, assessment)

	s.auditTo(userID, userID, "health.triage.disposition", sess.ID, nil, map[string]any{
		"level": level, "code": code, "route": triage.RouteForLevel(level), "red_flag": redFlag, "source": source,
	})

	return s.view(ctx, userID, sess.ID)
}

// persistReport writes the session report to the records vault when wired, else a
// session-report row. The summary frames the outcome as possible causes + a route,
// NEVER a diagnosis (SC-1). It carries no raw free text / PII beyond the user's own
// owner id (SC-7).
func (s *SessionService) persistReport(ctx context.Context, userID, sessionID string, a *Assessment) {
	summary := map[string]any{
		"disposition_level": a.DispositionLevel,
		"disposition_code":  a.DispositionCode,
		"route":             triage.RouteForLevel(a.DispositionLevel),
		"possible_causes":   orEmptyCauses(a.Conditions),
		"red_flag":          a.RedFlagTriggered,
		"disclaimer":        Disclaimer,
	}
	vaultRef := ""
	if s.vault != nil {
		body := fmt.Sprintf("AI triage session %s — disposition %s (level %d). Possible causes only; not a diagnosis.",
			sessionID, a.DispositionCode, a.DispositionLevel)
		if ref, err := s.vault.Create(ctx, userID, userID, "PATIENT", "triage_report",
			"AI Symptom Checker result", body, nil); err == nil {
			vaultRef = ref
		}
	}
	_ = s.repo.writeSessionReport(ctx, sessionID, userID, summary, vaultRef)
}

// --- GetSession (SC-1 framing + SC-8 disclaimer) ---

// GetSession returns the session + latest assessment framed as POSSIBLE CAUSES
// (never "diagnosis", SC-1) plus the mandatory disclaimer (SC-8).
func (s *SessionService) GetSession(ctx context.Context, userID, sessionID string) (*SessionView, error) {
	return s.view(ctx, userID, sessionID)
}

func (s *SessionService) view(ctx context.Context, userID, sessionID string) (*SessionView, error) {
	sess, err := s.repo.getSession(ctx, userID, sessionID)
	if err != nil {
		return nil, err
	}
	v := &SessionView{Session: *sess, Disclaimer: Disclaimer, PossibleCauses: []triage.PossibleCause{}}

	a, err := s.repo.latestAssessment(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if a != nil {
		v.PossibleCauses = orEmptyCauses(a.Conditions)
		v.Disposition = &Disposition{
			Level:    a.DispositionLevel,
			Code:     a.DispositionCode,
			Route:    triage.RouteForLevel(a.DispositionLevel),
			RedFlag:  a.RedFlagTriggered,
			Guidance: guidanceForLevel(a.DispositionLevel),
		}
	}
	return v, nil
}

// --- helpers ---

// deidentify derives the DE-IDENTIFIED engine inputs from the session's profile
// (SC-7): age in years (band), sex, region, pregnancy flag. NO name/DOB/PII leaves
// this function — only the coarse values the engine and red-flag layer need.
func (s *SessionService) deidentify(ctx context.Context, userID string, sess *Session) (ageYears int, sex, region string, pregnant bool) {
	if sess.ProfileID == nil {
		return 0, "", "", false
	}
	p, err := s.repo.getProfile(ctx, userID, *sess.ProfileID)
	if err != nil || p == nil {
		return 0, "", "", false
	}
	if p.DOB != nil {
		ageYears = ageInYears(*p.DOB, time.Now())
	}
	return ageYears, p.Sex, region, p.IsPregnant
}

func ageInYears(dob, now time.Time) int {
	years := now.Year() - dob.Year()
	if now.YearDay() < dob.YearDay() {
		years--
	}
	if years < 0 {
		years = 0
	}
	return years
}

// transition runs a GUARDED, audited state change (SC-12). It checks
// triage.CanSession (the legal-edge map) then the DB conditional UPDATE
// (WHERE state=$from) so a concurrent transition can never produce an illegal
// state. On success it audits and updates the in-memory session.
func (s *SessionService) transition(ctx context.Context, userID string, sess *Session, from, to triage.SessionState, action string, extra map[string]any) error {
	if !triage.CanSession(from, to) {
		return fmt.Errorf("core: illegal transition %s -> %s", from, to)
	}
	ok, err := s.repo.updateSessionState(ctx, sess.ID, from, to)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("core: transition guard failed %s -> %s (state changed concurrently)", from, to)
	}
	newV := map[string]any{"state": string(to)}
	for k, v := range extra {
		newV[k] = v
	}
	s.auditTo(userID, userID, action, sess.ID, map[string]any{"state": string(from)}, newV)
	sess.State = string(to)
	return nil
}

func (s *SessionService) auditTo(actor, target, action, resourceID string, oldV, newV map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actor, target, action, auditModule, "health_triage_session", resourceID, oldV, newV, "", "", "info")
}
