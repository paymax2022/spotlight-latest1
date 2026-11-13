package doctor

import (
	"strings"
	"testing"

	"spotlight/backend/internal/platform/r2"
)

// The doctor's own photo is stored in doctor_profiles.avatar_url as an R2 OBJECT
// KEY (see doctor.client.ts on the client: uploads return a key, never a link).
// The bucket is private — R2_PUBLIC_BASE_URL is unset — so a key is not
// renderable, and GET /profile handing it back is why the provider header showed
// no picture. resolveMedia is the connect/profile precedent: sign a stored key
// into a short-lived GET URL, pass anything already absolute straight through,
// and on any failure return the stored value so a photo that cannot be signed
// never breaks the profile read.

func avatarPresigner() *r2.Presigner {
	return r2.New(r2.Config{
		AccountEndpoint: "https://acct123.r2.cloudflarestorage.com",
		Bucket:          "spotlight-dev",
		AccessKeyID:     "AKIAEXAMPLE",
		SecretAccessKey: "secretEXAMPLE",
		Region:          "auto",
	})
}

func TestResolveMedia_SignsStoredKey(t *testing.T) {
	h := (&Handler{}).WithPresigner(avatarPresigner(), "spotlight-dev")
	key := "doctor/ed2c401b-44b4-4074-9a1a-756b3e256225/photo/7a57bc8e250a41e59f12b196aa0151"

	got := h.resolveMedia(key)
	if got == key {
		t.Fatal("stored key passed through unsignable — the client cannot render it")
	}
	if !strings.HasPrefix(got, "https://acct123.r2.cloudflarestorage.com/spotlight-dev/") {
		t.Errorf("signed URL %q is not on the configured bucket endpoint", got)
	}
	if !strings.Contains(got, key) {
		t.Errorf("signed URL %q dropped the object key it signs", got)
	}
	if !strings.Contains(got, "X-Amz-Signature") {
		t.Errorf("signed URL %q carries no signature parameter", got)
	}
}

func TestResolveMedia_LeavesAbsoluteURLsAlone(t *testing.T) {
	h := (&Handler{}).WithPresigner(avatarPresigner(), "spotlight-dev")
	url := "https://pub-abc123.r2.dev/doctor/u1/photo/public.jpg"
	if got := h.resolveMedia(url); got != url {
		t.Errorf("absolute URL was rewritten to %q", got)
	}
}

func TestResolveMedia_FailsOpenWithoutUsableCreds(t *testing.T) {
	// No presigner at all (R2 env absent) and a presigner built from nothing are
	// the same case for the client: hand back what is stored, never an error and
	// never an empty string that would blank out a profile that does have a photo.
	key := "doctor/u1/photo/abc"
	if got := (&Handler{}).resolveMedia(key); got != key {
		t.Errorf("nil presigner: got %q, want the stored key", got)
	}
	unconfigured := (&Handler{}).WithPresigner(r2.New(r2.Config{}), "")
	if got := unconfigured.resolveMedia(key); got != key {
		t.Errorf("unconfigured presigner: got %q, want the stored key", got)
	}
}

func TestResolveMedia_NoPhotoStaysEmpty(t *testing.T) {
	h := (&Handler{}).WithPresigner(avatarPresigner(), "spotlight-dev")
	if got := h.resolveMedia(""); got != "" {
		t.Errorf("empty key signed to %q — an absent photo must not become a URL", got)
	}
}
