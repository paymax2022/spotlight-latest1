package healthproviders

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"path"
	"strings"
	"time"
)

// attachments.go — presigned R2 uploads for provider-application credential
// documents (licence/registration proof: doctor.presign.go's five kinds cover
// the doctor module; this is the equivalent for the shared PHARMACY/LAB/VET
// onboarding rail). Mirrors the doctor and preconsult presign patterns
// exactly: a server-controlled object key, content-type bound into the
// signature, short TTL, fails closed (never a fabricated URL) when the
// presigner is not configured.
//
// AddCredential (service.go) has always required a real storage_key — before
// this, nothing in the client could ever produce one, so onboarding's
// licence/registration document was collected as a text field (if at all)
// and never actually reached the credential vault.

// ErrUploadsNotConfigured is returned when a credential presign is requested
// but the R2 presigner is not configured — fails closed (503), never a
// fabricated URL.
var ErrUploadsNotConfigured = errors.New("providers: uploads are not configured")

var allowedCredentialContentTypes = map[string]bool{
	"image/png":       true,
	"image/jpeg":      true,
	"image/webp":      true,
	"application/pdf": true,
}

var allowedCredentialExt = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".webp": true, ".pdf": true,
}

// PresignResult is what the client uses to PUT the binary directly to R2.
type PresignResult struct {
	UploadURL   string `json:"upload_url"`
	StorageKey  string `json:"storage_key"`
	ContentType string `json:"content_type"`
	Bucket      string `json:"bucket"`
	ExpiresIn   int    `json:"expires_in"`
	Method      string `json:"method"`
}

const credentialPresignTTL = 10 * time.Minute

// PresignCredential issues a presigned R2 PUT URL for a credential document,
// scoped to an application the caller owns (object-level authZ — the same
// ownership check AddCredential itself uses). The returned storage_key must
// be echoed back via AddCredential to actually record the document.
func (s *Service) PresignCredential(ctx context.Context, ownerID, applicationID, fileName, contentType string) (*PresignResult, error) {
	app, err := s.getApplication(ctx, applicationID)
	if err != nil {
		return nil, err
	}
	if app.OwnerUserID != ownerID {
		return nil, fmt.Errorf("providers: forbidden")
	}
	if s.presigner == nil || !s.presigner.Configured() {
		return nil, ErrUploadsNotConfigured
	}
	ct := strings.ToLower(strings.TrimSpace(contentType))
	if !allowedCredentialContentTypes[ct] {
		return nil, fmt.Errorf("providers: unsupported content type")
	}
	ext := strings.ToLower(path.Ext(fileName))
	if !allowedCredentialExt[ext] {
		return nil, fmt.Errorf("providers: unsupported file extension")
	}
	key := fmt.Sprintf("providers/%s/%s/%s%s", ownerID, applicationID, randCredentialToken(), ext)
	url, err := s.presigner.PresignPut(key, ct, credentialPresignTTL)
	if err != nil {
		return nil, ErrUploadsNotConfigured
	}
	return &PresignResult{
		UploadURL:   url,
		StorageKey:  key,
		ContentType: ct,
		Bucket:      s.bucket,
		ExpiresIn:   int(credentialPresignTTL.Seconds()),
		Method:      "PUT",
	}, nil
}

func randCredentialToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
