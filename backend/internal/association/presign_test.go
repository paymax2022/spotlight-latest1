package association

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/platform/r2"
)

func init() { gin.SetMode(gin.TestMode) }

// configuredPresigner returns a presigner with fake-but-complete credentials, so
// signing succeeds without touching the network.
func configuredPresigner() *r2.Presigner {
	return r2.New(r2.Config{
		AccountEndpoint: "https://acct.r2.cloudflarestorage.com",
		Bucket:          "spotlight-open-mic",
		AccessKeyID:     "AKIATEST",
		SecretAccessKey: "secrettest",
		Region:          "auto",
	})
}

// postPresign drives the handler and returns the recorder.
func postPresign(t *testing.T, h *Handler, userID, body string) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/uploads/logo/presign", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	if userID != "" {
		c.Set("user_id", userID)
	}
	h.PresignLogoUpload(c)
	return w
}

// TestPresignLogoRejectsUnauthenticated: no caller identity, no upload URL.
func TestPresignLogoRejectsUnauthenticated(t *testing.T) {
	h := (&Handler{}).WithPresigner(configuredPresigner(), "spotlight-open-mic")
	w := postPresign(t, h, "", `{"fileName":"logo.png","contentType":"image/png"}`)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", w.Code)
	}
}

// TestPresignLogoFailsClosedWhenUnconfigured is the important one: with no R2
// credentials the endpoint must refuse rather than mint a URL that would 404 on
// upload and leave the founder with a logo that never existed.
func TestPresignLogoFailsClosedWhenUnconfigured(t *testing.T) {
	// A presigner with no credentials reports itself unconfigured.
	h := (&Handler{}).WithPresigner(r2.New(r2.Config{}), "")
	w := postPresign(t, h, "user-1", `{"fileName":"logo.png","contentType":"image/png"}`)
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503 when R2 is unconfigured", w.Code)
	}

	// And with no presigner attached at all.
	w = postPresign(t, &Handler{}, "user-1", `{"fileName":"logo.png","contentType":"image/png"}`)
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503 when no presigner is wired", w.Code)
	}
}

// TestPresignLogoRejectsDisallowedTypes pins the allowlists. The content type is
// bound into the signature, so accepting an arbitrary one would let a caller
// store an executable behind an image-shaped key.
func TestPresignLogoRejectsDisallowedTypes(t *testing.T) {
	h := (&Handler{}).WithPresigner(configuredPresigner(), "spotlight-open-mic")

	cases := []struct{ name, body string }{
		{"executable content type", `{"fileName":"logo.png","contentType":"application/octet-stream"}`},
		{"html content type", `{"fileName":"logo.png","contentType":"text/html"}`},
		{"pdf is not a logo", `{"fileName":"logo.pdf","contentType":"application/pdf"}`},
		{"disallowed extension", `{"fileName":"logo.exe","contentType":"image/png"}`},
		{"no extension", `{"fileName":"logo","contentType":"image/png"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := postPresign(t, h, "user-1", tc.body)
			if w.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400", w.Code)
			}
		})
	}
}

// TestPresignLogoKeyIsScopedToTheCaller pins the access-control property: the
// endpoint takes no organisation and no path from the client, so the only place
// a caller can write is inside their own user-id prefix.
func TestPresignLogoKeyIsScopedToTheCaller(t *testing.T) {
	h := (&Handler{}).WithPresigner(configuredPresigner(), "spotlight-open-mic")
	w := postPresign(t, h, "user-abc", `{"fileName":"Logo.PNG","contentType":"image/png"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}

	var res struct {
		Data PresignLogoUploadResponse `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if !strings.HasPrefix(res.Data.ObjectKey, "association/logo/user-abc/") {
		t.Errorf("objectKey = %q; must be namespaced under the caller's own user id", res.Data.ObjectKey)
	}
	if !strings.HasSuffix(res.Data.ObjectKey, ".png") {
		t.Errorf("objectKey = %q; extension must be normalised to lowercase .png", res.Data.ObjectKey)
	}
	if res.Data.Method != http.MethodPut || res.Data.UploadURL == "" {
		t.Errorf("got method=%q url=%q; want a PUT url", res.Data.Method, res.Data.UploadURL)
	}
	if res.Data.ContentType != "image/png" {
		t.Errorf("contentType = %q; the client must be told the exact header to send", res.Data.ContentType)
	}

	// Two calls must not collide, or one founder's logo would overwrite another's.
	w2 := postPresign(t, h, "user-abc", `{"fileName":"logo.png","contentType":"image/png"}`)
	var res2 struct {
		Data PresignLogoUploadResponse `json:"data"`
	}
	_ = json.Unmarshal(w2.Body.Bytes(), &res2)
	if res.Data.ObjectKey == res2.Data.ObjectKey {
		t.Error("two presign calls produced the same object key — keys must be unguessable and unique")
	}
}

// TestIsStoredObjectKey pins the discriminator that decides whether a stored
// logo_url value gets signed on read. Getting this wrong in either direction is
// visible to users: signing a URL corrupts it, and not signing a key renders
// nothing.
func TestIsStoredObjectKey(t *testing.T) {
	keys := []string{
		"association/logo/user-1/abc123.png",
		"association/logo/user-1/deadbeef.webp",
	}
	for _, k := range keys {
		if !IsStoredObjectKey(k) {
			t.Errorf("%q must be treated as an object key", k)
		}
	}

	notKeys := []string{
		"",
		"   ",
		"https://cdn.example.org/logo.png",
		"http://cdn.example.org/logo.png",
		// A legacy device URI from before uploads existed: it is not a key, and
		// signing it would produce a URL for an object that does not exist.
		"file:///var/mobile/Containers/Data/image.jpg",
		// A stored value that is neither a URL nor one of our keys is passed
		// through rather than guessed at.
		"logo.png",
		"estate/doc/user-1/abc.png",
	}
	for _, v := range notKeys {
		if IsStoredObjectKey(v) {
			t.Errorf("%q must NOT be treated as an object key", v)
		}
	}
}

// TestResolveLogoPassesThroughWithoutPresigner proves reads degrade safely: an
// organisation must still list when R2 is unavailable, logo or no logo.
func TestResolveLogoPassesThroughWithoutPresigner(t *testing.T) {
	s := &Service{}

	if got := s.resolveLogo(nil); got != nil {
		t.Errorf("nil logo = %v, want nil", got)
	}

	key := "association/logo/user-1/abc.png"
	if got := s.resolveLogo(&key); got == nil || *got != key {
		t.Errorf("with no presigner the stored key must pass through unchanged, got %v", got)
	}

	url := "https://cdn.example.org/logo.png"
	s2 := (&Service{}).WithPresigner(configuredPresigner())
	if got := s2.resolveLogo(&url); got == nil || *got != url {
		t.Errorf("a pasted URL must never be rewritten, got %v", got)
	}
}

// TestResolveLogoSignsStoredKeys is the other half: a key becomes a fetchable
// URL, because the bucket is not public and a key alone renders nothing.
func TestResolveLogoSignsStoredKeys(t *testing.T) {
	s := (&Service{}).WithPresigner(configuredPresigner())
	key := "association/logo/user-1/abc.png"

	got := s.resolveLogo(&key)
	if got == nil {
		t.Fatal("resolveLogo returned nil for a stored key")
	}
	if *got == key {
		t.Fatal("stored key was passed through unsigned — clients cannot fetch a bare key")
	}
	if !strings.HasPrefix(*got, "https://") || !strings.Contains(*got, "X-Amz-Signature=") {
		t.Errorf("resolved logo = %q; want a signed https URL", *got)
	}
	if !strings.Contains(*got, "abc.png") {
		t.Errorf("resolved logo = %q; must point at the stored object", *got)
	}
}

// TestPresignLogoFailsClosedWhenTheBucketCannotBeWritten is the failure behind
// "Image couldn't be uploaded": the variables are all present (so Configured()
// is true and a URL can be signed) but R2 rejects the write — wrong bucket, bad
// token, read-only token. Minting a URL then sends the founder into a retry loop
// that cannot succeed, so the endpoint must answer 503, which the app already
// maps to "uploads aren't available — paste a logo URL".
func TestPresignLogoFailsClosedWhenTheBucketCannotBeWritten(t *testing.T) {
	r2srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte("<Error><Code>NoSuchBucket</Code></Error>"))
	}))
	defer r2srv.Close()

	p := r2.New(r2.Config{AccountEndpoint: r2srv.URL, Bucket: "no-such-bucket", AccessKeyID: "AK", SecretAccessKey: "SK"})
	p.EnableHealthCheck(r2srv.Client())
	h := (&Handler{}).WithPresigner(p, "no-such-bucket")

	w := postPresign(t, h, "user-1", `{"fileName":"logo.png","contentType":"image/png"}`)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 when R2 rejects the write; body %s", w.Code, w.Body)
	}
	if strings.Contains(w.Body.String(), "no-such-bucket") || strings.Contains(w.Body.String(), "NoSuchBucket") {
		t.Errorf("the response must not leak the bucket or R2 error code: %s", w.Body)
	}
}

// A healthy bucket still mints the URL — the probe must not get in the way.
func TestPresignLogoStillIssuesWhenTheBucketIsWritable(t *testing.T) {
	r2srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer r2srv.Close()

	p := r2.New(r2.Config{AccountEndpoint: r2srv.URL, Bucket: "ok-bucket", AccessKeyID: "AK", SecretAccessKey: "SK"})
	p.EnableHealthCheck(r2srv.Client())
	h := (&Handler{}).WithPresigner(p, "ok-bucket")

	w := postPresign(t, h, "user-1", `{"fileName":"logo.png","contentType":"image/png"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body %s", w.Code, w.Body)
	}
}
