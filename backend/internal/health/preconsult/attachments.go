package preconsult

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"path"
	"strings"
)

// attachments.go — patient intake attachments (photos / lab results / prior
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
	"application/pdf":  true,
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
		return nil, fmt.Errorf("preconsult: forbidden")
	}
	if s.presigner == nil || !s.presigner.Configured() {
		return nil, ErrUploadsNotConfigured
	}
	if !attachmentKinds[kind] {
		return nil, fmt.Errorf("preconsult: unsupported attachment kind")
	}
	ct := strings.ToLower(strings.TrimSpace(contentType))
	if !allowedAttachmentContentTypes[ct] {
		return nil, fmt.Errorf("preconsult: unsupported content type")
	}
	ext := strings.ToLower(path.Ext(fileName))
	if !allowedAttachmentExt[ext] {
		return nil, fmt.Errorf("preconsult: unsupported file extension")
	}
	key := fmt.Sprintf("intake/%s/%s/%s%s", caller, appointmentID, randToken(), ext)
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
		return nil, fmt.Errorf("preconsult: forbidden")
	}
	if !attachmentKinds[kind] {
		return nil, fmt.Errorf("preconsult: unsupported attachment kind")
	}
	// The key must be inside this patient+appointment scope (defence in depth).
	if !strings.HasPrefix(storageKey, fmt.Sprintf("intake/%s/%s/", caller, appointmentID)) {
		return nil, fmt.Errorf("preconsult: storage key out of scope")
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

func randToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
