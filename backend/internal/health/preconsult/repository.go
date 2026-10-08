package preconsult

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"spotlight/backend/go-common/cryptox"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// repository.go — all pgx access for the pre-consult intake (service_role; RLS on
// every table). Answer bodies live only in health_intake_responses; the link row
// (health_preconsult_intake) and the access/audit logs carry IDs + flags only.

// Intake is the health_preconsult_intake link row.
type Intake struct {
	ID              string          `json:"id"`
	AppointmentID   string          `json:"appointment_id"`
	ConsultID       *string         `json:"consult_id,omitempty"`
	PatientID       string          `json:"patient_id"`
	ProviderID      string          `json:"provider_id"`
	ResponseID      *string         `json:"response_id,omitempty"`
	SchemaID        *string         `json:"schema_id,omitempty"`
	Status          string          `json:"status"` // DRAFT | SUBMITTED
	ConsentVersion  *int            `json:"consent_version,omitempty"`
	ConsentAt       *time.Time      `json:"consent_at,omitempty"`
	RedFlagLevel    *int            `json:"red_flag_level,omitempty"`
	RedFlagSeverity *string         `json:"red_flag_severity,omitempty"`
	RedFlagHits     json.RawMessage `json:"red_flag_hits"`
	Attachments     json.RawMessage `json:"attachments"`
	SubmittedAt     *time.Time      `json:"submitted_at,omitempty"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
}

const intakeCols = `id, appointment_id, consult_id, patient_id, provider_id, response_id, schema_id,
	status, consent_version, consent_at, red_flag_level, red_flag_severity, red_flag_hits,
	attachments, submitted_at, created_at, updated_at`

func scanIntake(row interface{ Scan(...any) error }) (*Intake, error) {
	var it Intake
	if err := row.Scan(&it.ID, &it.AppointmentID, &it.ConsultID, &it.PatientID, &it.ProviderID,
		&it.ResponseID, &it.SchemaID, &it.Status, &it.ConsentVersion, &it.ConsentAt,
		&it.RedFlagLevel, &it.RedFlagSeverity, &it.RedFlagHits, &it.Attachments, &it.SubmittedAt,
		&it.CreatedAt, &it.UpdatedAt); err != nil {
		return nil, err
	}
	return &it, nil
}

// getIntakeByAppointment returns the link row (or pgx.ErrNoRows).
func (s *Service) getIntakeByAppointment(ctx context.Context, appointmentID string) (*Intake, error) {
	row := s.db.QueryRow(ctx, `SELECT `+intakeCols+` FROM health_preconsult_intake WHERE appointment_id=$1`, appointmentID)
	return scanIntake(row)
}

// insertIntake creates the DRAFT link row for an appointment.
func (s *Service) insertIntake(ctx context.Context, it *Intake) error {
	const ins = `INSERT INTO health_preconsult_intake (id, appointment_id, consult_id, patient_id, provider_id, schema_id, status)
	             VALUES ($1,$2,$3,$4,$5,$6,'DRAFT')`
	_, err := s.db.Exec(ctx, ins, it.ID, it.AppointmentID, it.ConsultID, it.PatientID, it.ProviderID, it.SchemaID)
	return err
}

// loadActiveRules reads the active configurable red-flag rules + parses match_json.
func (e *redFlagEvaluator) loadActiveRules(ctx context.Context) ([]dbRule, error) {
	const q = `SELECT code, level, severity, routing, match_json FROM health_redflag_rule WHERE active=true`
	rows, err := e.db.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("preconsult: load redflag rules: %w", err)
	}
	defer rows.Close()
	var out []dbRule
	for rows.Next() {
		var r dbRule
		var raw []byte
		if err := rows.Scan(&r.code, &r.level, &r.severity, &r.routing, &raw); err != nil {
			return nil, err
		}
		if len(raw) > 0 {
			_ = json.Unmarshal(raw, &r.match) // a malformed rule simply never matches
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// activeConsent returns the active PRE_CONSULT_INTAKE consent (highest version) for
// a locale, falling back to 'en'.
type ConsentText struct {
	Version int    `json:"version"`
	Locale  string `json:"locale"`
	Body    string `json:"body"`
}

func (s *Service) activeConsent(ctx context.Context, locale string) (*ConsentText, error) {
	if locale == "" {
		locale = "en"
	}
	const q = `SELECT version, locale, body FROM health_consent_version
	           WHERE consent_key='PRE_CONSULT_INTAKE' AND active=true AND locale IN ($1,'en')
	           ORDER BY (locale=$1) DESC, version DESC LIMIT 1`
	var ct ConsentText
	if err := s.db.QueryRow(ctx, q, locale).Scan(&ct.Version, &ct.Locale, &ct.Body); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("preconsult: no active consent version")
		}
		return nil, err
	}
	return &ct, nil
}

// getConfig reads one health_intake_config value (returns nil raw when absent).
func (s *Service) getConfig(ctx context.Context, key string) (json.RawMessage, error) {
	var raw []byte
	err := s.db.QueryRow(ctx, `SELECT value FROM health_intake_config WHERE config_key=$1`, key).Scan(&raw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return json.RawMessage(raw), nil
}

// logAccess appends a health_intake_access_log row (IDs only).
func (s *Service) logAccess(ctx context.Context, intakeID, accessorID, role, action string) error {
	const ins = `INSERT INTO health_intake_access_log (intake_id, accessor_id, accessor_role, action) VALUES ($1,$2,$3,$4)`
	_, err := s.db.Exec(ctx, ins, intakeID, accessorID, role, action)
	return err
}

// listVocab returns active clinical vocab of a kind (condition|allergen|medication).
type Vocab struct {
	Code  string `json:"code"`
	Label string `json:"label"`
	Kind  string `json:"kind"`
}

func (s *Service) listVocab(ctx context.Context, kind string) ([]Vocab, error) {
	rows, err := s.db.Query(ctx, `SELECT kind, code, label FROM health_clinical_vocab WHERE active=true AND ($1='' OR kind=$1) ORDER BY kind, label`, kind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Vocab
	for rows.Next() {
		var v Vocab
		if err := rows.Scan(&v.Kind, &v.Code, &v.Label); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// latestPriorResponse returns the most recent prior PRE_CONSULT response answers
// for a patient (for prefill), excluding the current appointment's response.
func (s *Service) latestPriorResponse(ctx context.Context, patientID, excludeResponseID string) (map[string]any, error) {
	const q = `SELECT r.answers_json
	           FROM health_intake_responses r
	           JOIN health_intake_schemas sc ON sc.id = r.schema_id AND sc.kind='PRE_CONSULT'
	           WHERE r.respondent_id=$1 AND ($2='' OR r.id::text <> $2)
	           ORDER BY r.created_at DESC LIMIT 1`
	var raw []byte
	if err := s.db.QueryRow(ctx, q, patientID, excludeResponseID).Scan(&raw); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	var ans map[string]any
	if err := json.Unmarshal(raw, &ans); err != nil {
		return nil, nil
	}
	return ans, nil
}

// patient intake attachments (photos / lab results / prior
// prescriptions, PRD M12). Mirrors the doctor/estate presign pattern:
//   - server-controlled key intake/<uid>/<appointmentId>/<rand><ext>
//   - content-type bound into the signature (no type smuggling)
//   - short TTL; fails closed (503) when the presigner is not configured
// Stored as {kind, storage_key, content_type} on health_preconsult_intake.attachments.
// The read side returns short-lived signed GET URLs; raw keys are NEVER serialized.

var allowedAttachmentContentTypes = map[string]bool{
	"image/png":       true,
	"image/jpeg":      true,
	"image/webp":      true,
	"application/pdf": true,
}

var allowedAttachmentExt = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".webp": true, ".pdf": true,
}

// attachmentKinds restricts the metadata "kind" a client may record.
var attachmentKinds = map[string]bool{
	"photo": true, "lab_result": true, "prescription": true, "other": true,
}

// Attachment is the stored metadata (keys only — never returned raw to a client).
type Attachment struct {
	Kind        string `json:"kind"`
	StorageKey  string `json:"storage_key"`
	ContentType string `json:"content_type"`
}

// AttachmentView is the read-side projection: a short-lived signed GET URL and the
// metadata, with the raw storage key withheld.
type AttachmentView struct {
	Kind        string `json:"kind"`
	ContentType string `json:"content_type"`
	URL         string `json:"url,omitempty"` // short-lived signed GET; empty if presigner unconfigured
	ExpiresIn   int    `json:"expires_in,omitempty"`
}

// PresignResult is returned to the patient for a direct R2 PUT.
type PresignResult struct {
	UploadURL   string `json:"upload_url"`
	StorageKey  string `json:"storage_key"`
	ContentType string `json:"content_type"`
	Bucket      string `json:"bucket"`
	ExpiresIn   int    `json:"expires_in"`
	Method      string `json:"method"`
}

// PresignAttachment issues a presigned PUT for the patient (object-level: caller
// must be the appointment's patient). Fails closed when the presigner is not
// configured. The returned key must be echoed back via RecordAttachment.
func (s *Service) PresignAttachment(ctx context.Context, caller, appointmentID, kind, fileName, contentType string) (*PresignResult, error) {
	patientID, _, err := s.loadAppointment(ctx, appointmentID)
	if err != nil {
		return nil, err
	}
	if caller != patientID {
		return nil, errors.New("preconsult: forbidden")
	}
	if s.presigner == nil || !s.presigner.Configured() {
		return nil, ErrUploadsNotConfigured
	}
	if !attachmentKinds[kind] {
		return nil, errors.New("preconsult: unsupported attachment kind")
	}
	ct := strings.ToLower(strings.TrimSpace(contentType))
	if !allowedAttachmentContentTypes[ct] {
		return nil, errors.New("preconsult: unsupported content type")
	}
	ext := strings.ToLower(path.Ext(fileName))
	if !allowedAttachmentExt[ext] {
		return nil, errors.New("preconsult: unsupported file extension")
	}
	key := fmt.Sprintf("intake/%s/%s/%s%s", caller, appointmentID, cryptox.Token(), ext)
	url, err := s.presigner.PresignPut(key, ct, presignTTL)
	if err != nil {
		return nil, ErrUploadsNotConfigured
	}
	return &PresignResult{
		UploadURL:   url,
		StorageKey:  key,
		ContentType: ct,
		Bucket:      s.bucket,
		ExpiresIn:   int(presignTTL.Seconds()),
		Method:      "PUT",
	}, nil
}

// RecordAttachment appends an uploaded object's metadata to the intake (patient-only).
func (s *Service) RecordAttachment(ctx context.Context, caller, appointmentID, kind, storageKey, contentType string) (*Intake, error) {
	it, err := s.EnsureIntake(ctx, caller, appointmentID)
	if err != nil {
		return nil, err
	}
	if caller != it.PatientID {
		return nil, errors.New("preconsult: forbidden")
	}
	if !attachmentKinds[kind] {
		return nil, errors.New("preconsult: unsupported attachment kind")
	}
	// The key must be inside this patient+appointment scope (defence in depth).
	if !strings.HasPrefix(storageKey, fmt.Sprintf("intake/%s/%s/", caller, appointmentID)) {
		return nil, errors.New("preconsult: storage key out of scope")
	}
	att := Attachment{Kind: kind, StorageKey: storageKey, ContentType: contentType}
	var existing []Attachment
	if len(it.Attachments) > 0 {
		_ = json.Unmarshal(it.Attachments, &existing)
	}
	existing = append(existing, att)
	raw, _ := json.Marshal(existing)
	if _, err := s.db.Exec(ctx, `UPDATE health_preconsult_intake SET attachments=$2, updated_at=now() WHERE id=$1`, it.ID, raw); err != nil {
		return nil, fmt.Errorf("preconsult: record attachment: %w", err)
	}
	return s.getIntakeByAppointment(ctx, appointmentID)
}

// attachmentViews builds short-lived signed GET URLs for the doctor summary.
func (s *Service) attachmentViews(ctx context.Context, it *Intake) []AttachmentView {
	var atts []Attachment
	if len(it.Attachments) > 0 {
		_ = json.Unmarshal(it.Attachments, &atts)
	}
	out := make([]AttachmentView, 0, len(atts))
	for _, a := range atts {
		v := AttachmentView{Kind: a.Kind, ContentType: a.ContentType}
		if s.presigner != nil && s.presigner.Configured() {
			if url, err := s.presigner.PresignGet(a.StorageKey, presignTTL); err == nil {
				v.URL = url
				v.ExpiresIn = int(presignTTL.Seconds())
			}
		}
		out = append(out, v)
	}
	return out
}
