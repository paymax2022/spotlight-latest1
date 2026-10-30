package healthpharmacy

// Patient-uploaded prescription images/documents (presigned R2 PUT, then a
// record call). An upload is evidence for a pharmacist to review; it is not an
// e-Rx and never satisfies the HL-3 dispense gate by itself.

import (
	"context"
	"errors"
	"fmt"
	"path"
	"strings"
	"time"
	"unicode/utf8"

	"spotlight/backend/go-common/cryptox"
)

// Presigner is the slice of *r2.Presigner the upload flow needs.
type Presigner interface {
	Configured() bool
	PresignPut(key, contentType string, expiry time.Duration) (string, error)
}

const rxUploadPresignTTL = 10 * time.Minute

var (
	// ErrUploadsNotConfigured — R2 is unset; the handler answers 503.
	ErrUploadsNotConfigured = errors.New("pharmacy: prescription uploads are not configured")
	// ErrRxUploadInvalid — bad content type, extension, key scope or field length.
	ErrRxUploadInvalid = errors.New("pharmacy: invalid prescription upload")
)

var rxUploadContentTypes = map[string]string{
	"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
	"image/heic": ".heic", "application/pdf": ".pdf",
}

var rxUploadExt = map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".webp": true, ".heic": true, ".pdf": true}

// RxUploadPresign is the presigned PUT the client uploads the file to.
type RxUploadPresign struct {
	UploadURL   string `json:"upload_url"`
	StorageKey  string `json:"storage_key"`
	ContentType string `json:"content_type"`
	Method      string `json:"method"`
	ExpiresIn   int    `json:"expires_in"`
}

// RxUpload is a recorded patient prescription upload awaiting review.
type RxUpload struct {
	ID          string    `json:"id"`
	PatientName string    `json:"patient_name"`
	Note        string    `json:"note"`
	ContentType string    `json:"content_type"`
	State       string    `json:"state"`
	CreatedAt   time.Time `json:"created_at"`
}

// SetUploadPresigner wires the R2 presigner; nil/unconfigured ⇒ uploads 503.
func (s *Service) SetUploadPresigner(p Presigner) { s.uploads = p }

func rxUploadKeyPrefix(patientID string) string { return "pharmacy-rx/" + patientID + "/" }

// PresignRxUpload issues a short-lived PUT URL scoped to the caller.
func (s *Service) PresignRxUpload(ctx context.Context, patientID, fileName, contentType string) (*RxUploadPresign, error) {
	if s.uploads == nil || !s.uploads.Configured() {
		return nil, ErrUploadsNotConfigured
	}
	ct := strings.ToLower(strings.TrimSpace(contentType))
	if _, ok := rxUploadContentTypes[ct]; !ok {
		return nil, fmt.Errorf("%w: unsupported content type", ErrRxUploadInvalid)
	}
	ext := strings.ToLower(path.Ext(fileName))
	if ext == "" {
		ext = rxUploadContentTypes[ct]
	}
	if !rxUploadExt[ext] {
		return nil, fmt.Errorf("%w: unsupported file extension", ErrRxUploadInvalid)
	}
	key := rxUploadKeyPrefix(patientID) + cryptox.Token() + ext
	url, err := s.uploads.PresignPut(key, ct, rxUploadPresignTTL)
	if err != nil {
		return nil, ErrUploadsNotConfigured
	}
	return &RxUploadPresign{UploadURL: url, StorageKey: key, ContentType: ct, Method: "PUT",
		ExpiresIn: int(rxUploadPresignTTL.Seconds())}, nil
}

// RecordRxUpload stores the uploaded object's metadata (state VERIFYING).
func (s *Service) RecordRxUpload(ctx context.Context, patientID, storageKey, contentType, patientName, note string) (*RxUpload, error) {
	name := strings.TrimSpace(patientName)
	note = strings.TrimSpace(note)
	ct := strings.ToLower(strings.TrimSpace(contentType))
	switch {
	case !strings.HasPrefix(storageKey, rxUploadKeyPrefix(patientID)) || strings.Contains(storageKey, ".."):
		return nil, fmt.Errorf("%w: storage key out of scope", ErrRxUploadInvalid)
	case rxUploadContentTypes[ct] == "":
		return nil, fmt.Errorf("%w: unsupported content type", ErrRxUploadInvalid)
	case name == "" || utf8.RuneCountInString(name) > 120:
		return nil, fmt.Errorf("%w: patient name must be 1-120 characters", ErrRxUploadInvalid)
	case utf8.RuneCountInString(note) > 1000:
		return nil, fmt.Errorf("%w: note must be at most 1000 characters", ErrRxUploadInvalid)
	}
	u := RxUpload{PatientName: name, Note: note, ContentType: ct}
	// ON CONFLICT on storage_key keeps a retried record call idempotent.
	const q = `
		INSERT INTO pharmacy_rx_uploads (patient_id, storage_key, content_type, patient_name, note)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (storage_key) DO UPDATE SET patient_name = EXCLUDED.patient_name
		WHERE pharmacy_rx_uploads.patient_id = EXCLUDED.patient_id
		RETURNING id, state, created_at`
	if err := s.db.QueryRow(ctx, q, patientID, storageKey, ct, name, note).Scan(&u.ID, &u.State, &u.CreatedAt); err != nil {
		return nil, fmt.Errorf("pharmacy: record rx upload: %w", err)
	}
	s.audited(patientID, "", "health.pharmacy.rx_upload.create", u.ID, nil, map[string]any{"content_type": ct})
	return &u, nil
}

// MyRxUploads lists the caller's uploads, newest first.
func (s *Service) MyRxUploads(ctx context.Context, patientID string) ([]RxUpload, error) {
	const q = `
		SELECT id, patient_name, note, content_type, state, created_at
		FROM pharmacy_rx_uploads WHERE patient_id = $1
		ORDER BY created_at DESC LIMIT 100`
	rows, err := s.db.Query(ctx, q, patientID)
	if err != nil {
		return nil, fmt.Errorf("pharmacy: rx uploads: %w", err)
	}
	defer rows.Close()
	out := []RxUpload{}
	for rows.Next() {
		var u RxUpload
		if err := rows.Scan(&u.ID, &u.PatientName, &u.Note, &u.ContentType, &u.State, &u.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}
