// Package preconsult implements the Telemedicine Pre-Consultation Health Intake
// (ADR-010). It EXTENDS the shared health platform: it reuses the schema-driven
// intake validator (health/intake), the consult state machine gate
// (health/consult), the deterministic red-flag engine (health/triage), versioned
// consent + access logging, and the R2 presigner. It owns the ConsultIntake link
// row (health_preconsult_intake), submit-time red-flag triage + crisis routing,
// the doctor summary (assigned-doctor-only + access-logged), and prefill.
//
// Iron rules honoured: intake answers are PHI — readable only by the patient + the
// assigned doctor (object-level); every doctor access is audit-logged (IDs only,
// never answer bodies); consent is captured on submit; consult transitions are
// guarded; the surface is feature-flagged at the wiring layer.
package preconsult

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	healthconsult "spotlight/backend/internal/health/consult"
	healthintake "spotlight/backend/internal/health/intake"
)

// ErrUploadsNotConfigured is returned when an attachment presign is requested but
// the R2 presigner is not configured — the endpoint fails closed (503), never a
// fabricated URL.
var ErrUploadsNotConfigured = errors.New("preconsult: uploads are not configured")

// Auditor — minimal immutable-audit slice (HL-12). nil is safe. Bodies are never
// passed; only IDs / status / red-flag codes.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// IntakeValidator is the slice of the shared intake service this package reuses.
// Satisfied by *healthintake.Service.
type IntakeValidator interface {
	GetActiveSchemaBySlug(ctx context.Context, slug string) (*healthintake.Schema, error)
	GetSchema(ctx context.Context, schemaID string) (*healthintake.Schema, error)
	ValidateAnswers(fields []healthintake.Field, answers map[string]any) error
	Submit(ctx context.Context, respondentID, schemaID string, answers map[string]any) (*healthintake.Response, error)
}

// ConsultGate is the slice of the consult service this package drives (the
// SCHEDULED→INTAKE_PENDING→READY_FOR_CONSULT gate). Satisfied by
// *healthconsult.Service.
type ConsultGate interface {
	LoadByAppointment(ctx context.Context, appointmentID string) (*healthconsult.Consult, string, error)
	Transition(ctx context.Context, actorID, consultID string, to healthconsult.State) (*healthconsult.Consult, error)
}

// Presigner is the slice of the R2 presigner this package reuses (satisfied by
// *r2.Presigner). nil/unconfigured → attachment presign fails closed (503).
type Presigner interface {
	Configured() bool
	PresignPut(key, contentType string, expiry time.Duration) (string, error)
	PresignGet(key string, expiry time.Duration) (string, error)
}

// Service orchestrates the pre-consult intake.
type Service struct {
	db        *pgxpool.Pool
	intake    IntakeValidator
	consult   ConsultGate
	redflag   *redFlagEvaluator
	presigner Presigner
	bucket    string
	llm       LLMGenerator
	audit     Auditor
}

// NewService builds the orchestrator. intake + consult are the reused shared
// services; presigner/bucket/llm/audit may be nil (each degrades closed).
func NewService(db *pgxpool.Pool, intake IntakeValidator, consult ConsultGate, audit Auditor) *Service {
	return &Service{
		db:      db,
		intake:  intake,
		consult: consult,
		redflag: newRedFlagEvaluator(db),
		audit:   audit,
	}
}

// WithPresigner wires the R2 presigner used for attachment upload/download.
func (s *Service) WithPresigner(p Presigner, bucket string) *Service {
	s.presigner = p
	s.bucket = bucket
	return s
}

// WithLLM wires the optional symptom-checker pre-fill generator (estate ainotes
// pattern). When unset, the mock generator is used and never blocks.
func (s *Service) WithLLM(g LLMGenerator) *Service { s.llm = g; return s }

const presignTTL = 10 * time.Minute

// ── object-level helpers ──────────────────────────────────────────────────────

// loadAppointment returns (patientID, providerID) for an appointment.
func (s *Service) loadAppointment(ctx context.Context, appointmentID string) (patientID, providerID string, err error) {
	const q = `SELECT patient_id::text, provider_id::text FROM health_appointments WHERE id=$1`
	if e := s.db.QueryRow(ctx, q, appointmentID).Scan(&patientID, &providerID); e != nil {
		if e == pgx.ErrNoRows {
			return "", "", fmt.Errorf("preconsult: appointment not found")
		}
		return "", "", e
	}
	return patientID, providerID, nil
}

// ── EnsureIntake ──────────────────────────────────────────────────────────────

// EnsureIntake creates-or-gets the link row for an appointment (owner = patient).
// On first creation it prompts intake: it flips the linked consult
// SCHEDULED→INTAKE_PENDING (best-effort — a consult may not exist yet).
func (s *Service) EnsureIntake(ctx context.Context, caller, appointmentID string) (*Intake, error) {
	patientID, providerID, err := s.loadAppointment(ctx, appointmentID)
	if err != nil {
		return nil, err
	}
	if caller != patientID {
		return nil, fmt.Errorf("preconsult: forbidden")
	}

	if it, err := s.getIntakeByAppointment(ctx, appointmentID); err == nil {
		return it, nil
	} else if err != pgx.ErrNoRows {
		return nil, err
	}

	sc, err := s.intake.GetActiveSchemaBySlug(ctx, SchemaSlug)
	if err != nil {
		return nil, err
	}
	it := &Intake{
		ID:            uuid.New().String(),
		AppointmentID: appointmentID,
		PatientID:     patientID,
		ProviderID:    providerID,
		SchemaID:      &sc.ID,
		Status:        "DRAFT",
	}
	// Link the consult (if one exists) and prompt intake.
	if c, _, cerr := s.consult.LoadByAppointment(ctx, appointmentID); cerr == nil {
		it.ConsultID = &c.ID
	}
	if err := s.insertIntake(ctx, it); err != nil {
		return nil, fmt.Errorf("preconsult: create intake: %w", err)
	}
	if it.ConsultID != nil {
		// Prompt: SCHEDULED → INTAKE_PENDING (guarded; no-op if already past it).
		_, _ = s.consult.Transition(ctx, caller, *it.ConsultID, healthconsult.StateIntakePending)
	}
	s.audited(caller, patientID, "health.preconsult.ensure", it.ID, nil, map[string]any{"status": "DRAFT"})
	return s.getIntakeByAppointment(ctx, appointmentID)
}

// ── SaveDraft ─────────────────────────────────────────────────────────────────

// SaveDraft persists draft answers (patient-only, idempotent / auto-save friendly).
// Drafts are unvalidated scratch answers, so they are NOT written to the validated
// response store (health_intake_responses) — that row is created only on submit,
// pinned to the schema version. The draft is held on the link row's draft_json
// column (last write wins) so submit later validates + promotes it to a response.
func (s *Service) SaveDraft(ctx context.Context, caller, appointmentID string, answers map[string]any) (*Intake, error) {
	it, err := s.EnsureIntake(ctx, caller, appointmentID)
	if err != nil {
		return nil, err
	}
	if caller != it.PatientID {
		return nil, fmt.Errorf("preconsult: forbidden")
	}
	if it.Status == "SUBMITTED" {
		return nil, fmt.Errorf("preconsult: intake already submitted")
	}
	raw, err := json.Marshal(answers)
	if err != nil {
		return nil, fmt.Errorf("preconsult: marshal draft: %w", err)
	}
	// Draft answers persist in a dedicated jsonb column on the link row (additive;
	// see migration note). Idempotent overwrite — last write wins (auto-save).
	if _, err := s.db.Exec(ctx, `UPDATE health_preconsult_intake SET draft_json=$2, updated_at=now() WHERE id=$1`, it.ID, raw); err != nil {
		return nil, fmt.Errorf("preconsult: save draft: %w", err)
	}
	return s.getIntakeByAppointment(ctx, appointmentID)
}

// ── Submit ────────────────────────────────────────────────────────────────────

// SubmitResult is returned to the client on submit.
type SubmitResult struct {
	Status   string          `json:"status"` // SUBMITTED
	RedFlag  *RedFlagDisplay `json:"red_flag,omitempty"`
	Intake   *Intake         `json:"intake"`
	Response string          `json:"response_id"`
}

// RedFlagDisplay is the client-facing interstitial (M13).
type RedFlagDisplay struct {
	Severity string          `json:"severity"` // emergency | urgent
	Routing  string          `json:"routing"`  // EMERGENCY | URGENT_CARE | CRISIS
	Guidance json.RawMessage `json:"guidance"` // urgent_guidance / crisis_guidance copy
}

// Submit validates answers against the pinned PRE_CONSULT schema, runs red-flag
// triage, persists a health_intake_responses row, flips the intake to SUBMITTED
// with the captured consent + red-flag outcome, and advances the consult
// INTAKE_PENDING→READY_FOR_CONSULT. A red-flag hit still saves the intake but
// surfaces guidance/routing (the client shows the interstitial); an EMERGENCY/
// CRISIS hit is flagged on the intake (red-flag queue) rather than silently queued.
func (s *Service) Submit(ctx context.Context, caller, appointmentID string, answers map[string]any, consentVersion int) (*SubmitResult, error) {
	it, err := s.EnsureIntake(ctx, caller, appointmentID)
	if err != nil {
		return nil, err
	}
	if caller != it.PatientID {
		return nil, fmt.Errorf("preconsult: forbidden")
	}
	if it.Status == "SUBMITTED" {
		return nil, fmt.Errorf("preconsult: intake already submitted")
	}

	sc, err := s.intake.GetActiveSchemaBySlug(ctx, SchemaSlug)
	if err != nil {
		return nil, err
	}
	if err := s.intake.ValidateAnswers(sc.Fields, answers); err != nil {
		return nil, err
	}

	// Consent: the accepted version must match the active version on record.
	ct, err := s.activeConsent(ctx, "en")
	if err != nil {
		return nil, err
	}
	if consentVersion != ct.Version {
		return nil, fmt.Errorf("preconsult: consent version %d is not the active version (%d)", consentVersion, ct.Version)
	}

	// Red-flag evaluation (urgency only raises).
	pregnant := isPregnant(answers)
	outcome, err := s.redflag.Evaluate(ctx, answers, 0, pregnant)
	if err != nil {
		return nil, fmt.Errorf("preconsult: red-flag eval: %w", err)
	}

	// Persist the validated response (pinned to the schema version) via the shared
	// intake submitter — one validation + storage contract.
	resp, err := s.intake.Submit(ctx, it.PatientID, sc.ID, answers)
	if err != nil {
		return nil, err
	}

	hitsJSON, _ := json.Marshal(outcome.Hits)
	now := time.Now()
	const upd = `UPDATE health_preconsult_intake
	             SET status='SUBMITTED', response_id=$2, schema_id=$3, consent_version=$4, consent_at=$5,
	                 red_flag_level=$6, red_flag_severity=$7, red_flag_hits=$8, submitted_at=$9, updated_at=now()
	             WHERE id=$1`
	var lvl any
	if outcome.Level > 0 {
		lvl = outcome.Level
	}
	var sev any
	if outcome.Severity == "emergency" || outcome.Severity == "urgent" {
		sev = outcome.Severity
	}
	if _, err := s.db.Exec(ctx, upd, it.ID, resp.ID, sc.ID, ct.Version, now, lvl, sev, hitsJSON, now); err != nil {
		return nil, fmt.Errorf("preconsult: finalize intake: %w", err)
	}

	// Advance the consult gate: INTAKE_PENDING → READY_FOR_CONSULT (guarded).
	if it.ConsultID != nil {
		_, _ = s.consult.Transition(ctx, caller, *it.ConsultID, healthconsult.StateReadyForConsult)
	}

	// Audit (IDs + codes only; never answer bodies).
	codes := make([]string, 0, len(outcome.Hits))
	for _, h := range outcome.Hits {
		codes = append(codes, h.RuleCode)
	}
	s.audited(caller, it.PatientID, "health.preconsult.submit", it.ID, nil, map[string]any{
		"status": "SUBMITTED", "response_id": resp.ID, "consent_version": ct.Version,
		"red_flag": outcome.Triggered, "red_flag_codes": codes, "routing": outcome.Routing,
	})

	res := &SubmitResult{Status: "SUBMITTED", Response: resp.ID}
	if outcome.Triggered {
		guidanceKey := "urgent_guidance"
		if outcome.Routing == "CRISIS" {
			guidanceKey = "crisis_guidance"
		}
		guidance, _ := s.getConfig(ctx, guidanceKey)
		res.RedFlag = &RedFlagDisplay{Severity: outcome.Severity, Routing: outcome.Routing, Guidance: guidance}
	}
	it2, _ := s.getIntakeByAppointment(ctx, appointmentID)
	res.Intake = it2
	return res, nil
}

// ── GetForPatient ─────────────────────────────────────────────────────────────

// PatientView is the get-or-create payload for the patient wizard (M1–M16): the
// link row, the pinned schema, prefill, and the active consent text.
type PatientView struct {
	Intake  *Intake             `json:"intake"`
	Schema  *healthintake.Schema `json:"schema"`
	Prefill map[string]any      `json:"prefill"`
	Consent *ConsentText        `json:"consent"`
	Draft   map[string]any      `json:"draft,omitempty"`
}

func (s *Service) GetForPatient(ctx context.Context, caller, appointmentID string) (*PatientView, error) {
	it, err := s.EnsureIntake(ctx, caller, appointmentID)
	if err != nil {
		return nil, err
	}
	if caller != it.PatientID {
		return nil, fmt.Errorf("preconsult: forbidden")
	}
	sc, err := s.intake.GetActiveSchemaBySlug(ctx, SchemaSlug)
	if err != nil {
		return nil, err
	}
	prefill, _ := s.Prefill(ctx, caller, appointmentID)
	consent, _ := s.activeConsent(ctx, "en")
	draft := s.loadDraft(ctx, it.ID)
	return &PatientView{Intake: it, Schema: sc, Prefill: prefill, Consent: consent, Draft: draft}, nil
}

func (s *Service) loadDraft(ctx context.Context, intakeID string) map[string]any {
	var raw []byte
	if err := s.db.QueryRow(ctx, `SELECT draft_json FROM health_preconsult_intake WHERE id=$1`, intakeID).Scan(&raw); err != nil || len(raw) == 0 {
		return nil
	}
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil {
		return nil
	}
	return m
}

// ── Prefill ───────────────────────────────────────────────────────────────────

// Prefill merges the patient's profile demographics (don't re-ask) + the most
// recent prior PRE_CONSULT response's meds/allergies/conditions.
func (s *Service) Prefill(ctx context.Context, caller, appointmentID string) (map[string]any, error) {
	patientID, _, err := s.loadAppointment(ctx, appointmentID)
	if err != nil {
		return nil, err
	}
	if caller != patientID {
		return nil, fmt.Errorf("preconsult: forbidden")
	}
	out := map[string]any{}

	// Profile demographics (read-only context; the form does not re-ask these).
	var fullName, gender string
	var dob *time.Time
	_ = s.db.QueryRow(ctx, `SELECT COALESCE(full_name,''), COALESCE(gender,''), date_of_birth FROM user_profiles WHERE id=$1`, patientID).
		Scan(&fullName, &gender, &dob)
	demo := map[string]any{}
	if fullName != "" {
		demo["full_name"] = fullName
	}
	if gender != "" {
		demo["gender"] = gender
	}
	if dob != nil {
		demo["age_years"] = ageYears(*dob)
	}
	if len(demo) > 0 {
		out["demographics"] = demo
	}

	// Carry forward meds/allergies/conditions from the last PRE_CONSULT response.
	if prior, _ := s.latestPriorResponse(ctx, patientID, ""); prior != nil {
		for _, k := range []string{"current_medications", "meds_none", "allergies", "allergies_none", "chronic_conditions", "chronic_other"} {
			if v, ok := prior[k]; ok && v != nil {
				out[k] = v
			}
		}
	}
	return out, nil
}

// ── GetForDoctor (assigned-doctor-only, access-logged) ────────────────────────

// DoctorSummary is the ordered clinician view (PRD §6): allergies + current meds
// HIGHLIGHTED first within the admin-configured section order.
type DoctorSummary struct {
	IntakeID        string              `json:"intake_id"`
	AppointmentID   string              `json:"appointment_id"`
	Status          string              `json:"status"`
	PatientReported bool                `json:"patient_reported"` // always true (decision-support, not diagnosis)
	Highlights      map[string]any      `json:"highlights"`       // allergies + current meds, surfaced first
	Sections        []SummarySection    `json:"sections"`         // ordered per summary_section_order
	RedFlag         *RedFlagDisplay     `json:"red_flag,omitempty"`
	Attachments     []AttachmentView    `json:"attachments"`
}

type SummarySection struct {
	Key    string         `json:"key"`
	Fields map[string]any `json:"fields"`
}

func (s *Service) GetForDoctor(ctx context.Context, caller, appointmentID string) (*DoctorSummary, error) {
	it, err := s.getIntakeByAppointment(ctx, appointmentID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("preconsult: intake not found")
		}
		return nil, err
	}
	// Object-level authZ: only the assigned doctor (provider owner) — reuse the
	// consult provider-owner join.
	_, providerOwner, cerr := s.consult.LoadByAppointment(ctx, appointmentID)
	if cerr != nil || !doctorAuthorized(caller, providerOwner) {
		return nil, fmt.Errorf("preconsult: forbidden")
	}

	// Load the validated answers (only now that authZ passed).
	answers, err := s.responseAnswers(ctx, it)
	if err != nil {
		return nil, err
	}

	// WRITE the access trail BEFORE returning PHI: access log row + audit (IDs only).
	if err := s.logAccess(ctx, it.ID, caller, "doctor", "VIEW"); err != nil {
		return nil, fmt.Errorf("preconsult: access log: %w", err)
	}
	s.audited(caller, it.PatientID, "health.preconsult.doctor_view", it.ID, nil, map[string]any{"appointment_id": appointmentID})

	order := s.summarySectionOrder(ctx)
	sum := &DoctorSummary{
		IntakeID:      it.ID,
		AppointmentID: appointmentID,
		Status:        it.Status,
		PatientReported: true,
		Highlights: map[string]any{
			"allergies":           answers["allergies"],
			"allergies_none":      answers["allergies_none"],
			"current_medications": answers["current_medications"],
			"meds_none":           answers["meds_none"],
		},
		Sections:    buildSections(order, answers),
		Attachments: s.attachmentViews(ctx, it),
	}
	if it.RedFlagSeverity != nil {
		guidanceKey := "urgent_guidance"
		routing := "URGENT_CARE"
		if *it.RedFlagSeverity == "emergency" {
			routing = "EMERGENCY"
		}
		// CRISIS is captured in red_flag_hits routing; surface crisis copy if present.
		if hasRouting(it.RedFlagHits, "CRISIS") {
			guidanceKey, routing = "crisis_guidance", "CRISIS"
		}
		guidance, _ := s.getConfig(ctx, guidanceKey)
		sum.RedFlag = &RedFlagDisplay{Severity: *it.RedFlagSeverity, Routing: routing, Guidance: guidance}
	}
	return sum, nil
}

// responseAnswers loads the validated answers JSON for a submitted intake.
func (s *Service) responseAnswers(ctx context.Context, it *Intake) (map[string]any, error) {
	if it.ResponseID == nil {
		return map[string]any{}, nil
	}
	var raw []byte
	if err := s.db.QueryRow(ctx, `SELECT answers_json FROM health_intake_responses WHERE id=$1`, *it.ResponseID).Scan(&raw); err != nil {
		if err == pgx.ErrNoRows {
			return map[string]any{}, nil
		}
		return nil, err
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, fmt.Errorf("preconsult: decode answers: %w", err)
	}
	return m, nil
}

// summarySectionOrder reads the admin-configured section order (A6), defaulting to
// the PRD ordering with allergies + current meds first.
func (s *Service) summarySectionOrder(ctx context.Context) []string {
	def := []string{"chief_complaint", "symptom_detail", "allergies", "current_medications",
		"chronic_conditions", "pregnancy", "vitals", "attachments"}
	raw, _ := s.getConfig(ctx, "summary_section_order")
	if len(raw) == 0 {
		return def
	}
	var order []string
	if json.Unmarshal(raw, &order) != nil || len(order) == 0 {
		return def
	}
	return order
}

// buildSections maps the ordered section keys → the answer fields they contain.
func buildSections(order []string, a map[string]any) []SummarySection {
	field := func(keys ...string) map[string]any {
		m := map[string]any{}
		for _, k := range keys {
			if v, ok := a[k]; ok {
				m[k] = v
			}
		}
		return m
	}
	sectionFields := map[string]map[string]any{
		"chief_complaint":     field("reason_for_visit", "reason_category"),
		"symptom_detail":      field("symptom_onset", "symptom_severity", "symptom_better_worse"),
		"allergies":           field("allergies", "allergies_none"),
		"current_medications": field("current_medications", "meds_none"),
		"chronic_conditions":  field("chronic_conditions", "chronic_other"),
		"pregnancy":           field("pregnancy_status"),
		"vitals":              field("temp_c", "bp_systolic", "bp_diastolic", "weight_kg", "height_cm", "pulse"),
		"attachments":         map[string]any{},
	}
	out := make([]SummarySection, 0, len(order))
	for _, k := range order {
		out = append(out, SummarySection{Key: k, Fields: sectionFields[k]})
	}
	return out
}

// ── HealthProfile (M17 longitudinal) ──────────────────────────────────────────

// HealthProfile is the patient's persistent record (conditions/meds/allergies)
// aggregated from prior intakes, used to prefill future intakes.
type HealthProfile struct {
	CurrentMedications any `json:"current_medications,omitempty"`
	Allergies         any `json:"allergies,omitempty"`
	ChronicConditions any `json:"chronic_conditions,omitempty"`
	ChronicOther      any `json:"chronic_other,omitempty"`
	LastUpdated       *time.Time `json:"last_updated,omitempty"`
}

func (s *Service) HealthProfile(ctx context.Context, caller string) (*HealthProfile, error) {
	if caller == "" {
		return nil, fmt.Errorf("preconsult: unauthenticated")
	}
	return s.HealthProfileFor(ctx, caller)
}

// HealthProfileFor returns a patient's persistent conditions/meds/allergies keyed
// by patient id (not caller). It backs the clinical-safety context provider so the
// pre-issue drug-allergy/interaction screen (RX-002/003) checks against the correct
// patient's documented allergies and current medications.
func (s *Service) HealthProfileFor(ctx context.Context, patientID string) (*HealthProfile, error) {
	if patientID == "" {
		return nil, fmt.Errorf("preconsult: patient required")
	}
	prior, err := s.latestPriorResponse(ctx, patientID, "")
	if err != nil {
		return nil, err
	}
	hp := &HealthProfile{}
	if prior != nil {
		hp.CurrentMedications = prior["current_medications"]
		hp.Allergies = prior["allergies"]
		hp.ChronicConditions = prior["chronic_conditions"]
		hp.ChronicOther = prior["chronic_other"]
	}
	return hp, nil
}

// ── helpers ───────────────────────────────────────────────────────────────────

func (s *Service) audited(actor, target, action, resourceID string, oldV, newV map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actor, target, action, "health", "health_preconsult_intake", resourceID, oldV, newV, "", "", "info")
}

// doctorAuthorized is the pure object-level access decision for a doctor read: the
// caller must be the appointment's assigned provider owner (a non-empty match).
func doctorAuthorized(caller, providerOwner string) bool {
	return providerOwner != "" && caller == providerOwner
}

func isPregnant(answers map[string]any) bool {
	v, _ := answers["pregnancy_status"].(string)
	return v == "pregnant" || v == "breastfeeding"
}

func ageYears(dob time.Time) int {
	now := time.Now()
	y := now.Year() - dob.Year()
	if now.YearDay() < dob.YearDay() {
		y--
	}
	if y < 0 {
		y = 0
	}
	return y
}

func hasRouting(hits json.RawMessage, routing string) bool {
	if len(hits) == 0 {
		return false
	}
	var hs []RedFlagHit
	if json.Unmarshal(hits, &hs) != nil {
		return strings.Contains(string(hits), routing)
	}
	for _, h := range hs {
		if h.Routing == routing {
			return true
		}
	}
	return false
}
