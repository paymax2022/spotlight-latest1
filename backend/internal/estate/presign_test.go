package estate

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func init() { gin.SetMode(gin.TestMode) }

// TestEstateUploadKindsCoverBlocks pins that the presign endpoint serves the
// media-upload acceptance gaps it was built to close.
func TestEstateUploadKindsCoverBlocks(t *testing.T) {
	required := []string{"profile_photo", "incident_evidence", "document"}
	for _, k := range required {
		if _, ok := estateUploadKinds[k]; !ok {
			t.Errorf("upload kind %q must be supported (acceptance gap)", k)
		}
	}
}

// TestEstateUploadAllowlistsRestrictive verifies the content-type and extension
// allowlists are non-empty (an empty allowlist would accept anything).
func TestEstateUploadAllowlistsRestrictive(t *testing.T) {
	if len(estateAllowedUploadContentTypes) == 0 {
		t.Fatal("content-type allowlist must not be empty")
	}
	if len(estateAllowedUploadExt) == 0 {
		t.Fatal("extension allowlist must not be empty")
	}
	// Executables / arbitrary types must not be accepted.
	for _, bad := range []string{"application/octet-stream", "text/html", "application/x-sh"} {
		if estateAllowedUploadContentTypes[bad] {
			t.Errorf("dangerous content type %q must not be allowed", bad)
		}
	}
}

// TestEstateRandTokenUnguessable verifies keys get a 32-char hex random suffix
// that differs across calls (prevents object-key guessing / overwrite).
func TestEstateRandTokenUnguessable(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 100; i++ {
		tok := estateRandToken()
		if len(tok) != 32 {
			t.Fatalf("token len = %d, want 32 hex chars", len(tok))
		}
		if seen[tok] {
			t.Fatal("estateRandToken produced a duplicate — not random")
		}
		seen[tok] = true
	}
}

// TestPresignUploadFailsClosedWhenUnconfigured verifies that with no R2
// presigner wired the endpoint returns 503 (never a fabricated URL) — and that
// this check runs before any DB/membership work, so a nil-Service is safe here.
func TestPresignUploadFailsClosedWhenUnconfigured(t *testing.T) {
	h := NewHandler(nil) // no presigner, no service needed: the guard runs first
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost,
		"/api/finance/estate/e1/uploads/presign",
		strings.NewReader(`{"kind":"document","fileName":"a.pdf","contentType":"application/pdf"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Params = gin.Params{{Key: "id", Value: "e1"}}
	c.Set("user_id", "u1")

	h.PresignUpload(c)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 when R2 unconfigured, got %d (%s)", rec.Code, rec.Body.String())
	}
}

// TestDocDownloadAllowed pins the document download authorisation matrix:
// restricted documents are admin-only; unrestricted ones are visible to any
// estate member.
func TestDocDownloadAllowed(t *testing.T) {
	cases := []struct {
		role       string
		restricted bool
		allowed    bool
	}{
		{"estate_admin", true, true},
		{"estate_admin", false, true},
		{"resident", true, false},
		{"resident", false, true},
		{"estate_security", true, false},
		{"estate_security", false, true},
		{"", true, false},
		{"", false, true},
	}
	for _, c := range cases {
		if got := docDownloadAllowed(c.role, c.restricted); got != c.allowed {
			t.Errorf("docDownloadAllowed(%q, restricted=%v) = %v, want %v", c.role, c.restricted, got, c.allowed)
		}
	}
}

// TestDocumentDownloadTTL pins the Block 39 acceptance: 60-minute presigned GET.
func TestDocumentDownloadTTL(t *testing.T) {
	if documentDownloadTTL != 60*time.Minute {
		t.Fatalf("documentDownloadTTL = %v, want 60m (Block 39 acceptance)", documentDownloadTTL)
	}
}
