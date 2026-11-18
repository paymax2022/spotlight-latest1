package telemedicine

import (
	"strings"
	"testing"
	"time"

	"spotlight/backend/internal/platform/r2"
)

// The patient-facing doctor photo has the same shape as the provider's own:
// doctors.avatar_url stores an R2 OBJECT KEY, not a link. The bucket is private
// — R2_PUBLIC_BASE_URL is unset — so GET /api/v1/telemedicine/doctors/:id handed
// back "doctor/<uid>/photo/<hex>.png", which no client can render, and the
// patient's doctor profile showed initials where a face should be.
//
// resolveMedia is the precedent already shipped twice over:
// internal/doctor/handler.go GetProfile and internal/association/presign.go.

func avatarPresigner() *r2.Presigner {
	return r2.New(r2.Config{
		AccountEndpoint: "https://acct123.r2.cloudflarestorage.com",
		Bucket:          "spotlight-dev",
		AccessKeyID:     "AKIAEXAMPLE",
		SecretAccessKey: "secretEXAMPLE",
		Region:          "auto",
	})
}

func newAvatarHandler() *Handler {
	return NewHandler(nil).WithPresigner(avatarPresigner(), "spotlight-dev")
}

func TestResolveMedia_SignsStoredKey(t *testing.T) {
	h := newAvatarHandler()
	key := "doctor/ed2c401b-44b4-4074-9a1a-756b3e256225/photo/7a57bc8e250a41e59f12b196aa0151ff.png"

	got := h.resolveMedia(key)
	if got == key {
		t.Fatal("stored key passed through unsigned — the client cannot render it")
	}
	for _, want := range []string{"https://acct123.r2.cloudflarestorage.com/spotlight-dev/", key, "X-Amz-Signature="} {
		if !strings.Contains(got, want) {
			t.Errorf("signed URL missing %q in %q", want, got)
		}
	}
}

func TestResolveMedia_LeavesAbsoluteURLsAlone(t *testing.T) {
	h := newAvatarHandler()
	url := "https://pub-abc123.r2.dev/doctor/u1/photo/public.jpg"
	if got := h.resolveMedia(url); got != url {
		t.Errorf("absolute URL was rewritten to %q", got)
	}
}

func TestResolveMedia_FailsOpenWithoutUsableCreds(t *testing.T) {
	// No presigner (R2 env absent) and an unconfigured presigner must behave the
	// same way: hand back what is stored. A photo that cannot be signed must
	// never turn into an error or an empty string on a profile that has a photo.
	key := "doctor/u1/photo/abc.png"
	if got := NewHandler(nil).resolveMedia(key); got != key {
		t.Errorf("nil presigner: got %q, want the stored key", got)
	}
	unconfigured := NewHandler(nil).WithPresigner(r2.New(r2.Config{}), "")
	if got := unconfigured.resolveMedia(key); got != key {
		t.Errorf("unconfigured presigner: got %q, want the stored key", got)
	}
}

func TestResolveMedia_NoPhotoStaysEmpty(t *testing.T) {
	h := newAvatarHandler()
	if got := h.resolveMedia(""); got != "" {
		t.Errorf("empty key signed to %q — an absent photo must not become a URL", got)
	}
}

func TestViewableAvatar_SignsTheDTOField(t *testing.T) {
	h := newAvatarHandler()
	key := "doctor/u1/photo/abc.png"
	d := Doctor{AvatarURL: &key}
	h.viewableAvatar(&d)

	if d.AvatarURL == nil {
		t.Fatal("avatar_url dropped entirely")
	}
	if !strings.HasPrefix(*d.AvatarURL, "https://") || !strings.Contains(*d.AvatarURL, "X-Amz-Signature=") {
		t.Errorf("DTO still carries the stored key: %q", *d.AvatarURL)
	}
}

func TestViewableAvatar_LeavesAbsentPhotoAbsent(t *testing.T) {
	h := newAvatarHandler()
	d := Doctor{}
	h.viewableAvatar(&d)
	if d.AvatarURL != nil {
		t.Errorf("a doctor with no photo gained one: %q", *d.AvatarURL)
	}
}

func TestAvatarViewTTLIsBounded(t *testing.T) {
	// The signed link is handed to any authenticated patient reading the
	// directory, so it must expire: swapping the photo should not leave the old
	// bytes reachable for hours. The provider's own header uses 10 minutes.
	if got := avatarViewTTL; got <= 0 || got > 15*time.Minute {
		t.Errorf("avatarViewTTL = %s, want a short view window", got)
	}
}
