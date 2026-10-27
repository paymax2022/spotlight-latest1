package connectvoting

import (
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

type fakePhotoSigner struct {
	configured bool
	fail       bool
	signed     []string
}

func (f *fakePhotoSigner) Configured() bool { return f.configured }

func (f *fakePhotoSigner) PresignGet(key string, _ time.Duration) (string, error) {
	f.signed = append(f.signed, key)
	if f.fail {
		return "", errors.New("signing failed")
	}
	return "https://r2.example/" + key + "?X-Amz-Signature=abc", nil
}

const photoObjectKey = "registration/4762acdb-e3c6-4d03-92e7-b5d9411b82e3/40b36f1d.png"

func TestContestantPhotoKey(t *testing.T) {
	seg := base64.RawURLEncoding.EncodeToString([]byte(photoObjectKey))
	padded := base64.URLEncoding.EncodeToString([]byte(photoObjectKey))

	cases := []struct {
		name   string
		stored string
		want   string
	}{
		{"upload json as the mobile app receives it",
			fmt.Sprintf(`{"fileName":"a.png","previewUrl":"/api/registration/uploads/%s","storageKey":"%s"}`, seg, photoObjectKey),
			photoObjectKey},
		{"json with only the preview route",
			fmt.Sprintf(`{"previewUrl":"/api/registration/uploads/%s"}`, seg), photoObjectKey},
		{"bare preview route", "/api/registration/uploads/" + seg, photoObjectKey},
		{"bare object key", photoObjectKey, photoObjectKey},
		{"padded base64url", "/api/registration/uploads/" + padded, photoObjectKey},
		{"preview route with a query", "/api/registration/uploads/" + seg + "?x=1", photoObjectKey},
		{"external url is not ours", "https://images.unsplash.com/a.jpg", ""},
		{"empty", "", ""},
		{"unparseable json", `{"fileName":`, ""},
		{"key outside the registration prefix", "contests/banners/" + seg, ""},
		{"traversal in the decoded key",
			"/api/registration/uploads/" + base64.RawURLEncoding.EncodeToString([]byte("registration/../../etc/passwd")), ""},
		{"garbage segment is not a key", "/api/registration/uploads/not-base64-%%%", ""},
	}

	for _, tc := range cases {
		if got := contestantPhotoKey(tc.stored); got != tc.want {
			t.Errorf("%s: contestantPhotoKey = %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestResolveContestantPhoto(t *testing.T) {
	seg := base64.RawURLEncoding.EncodeToString([]byte(photoObjectKey))
	blob := fmt.Sprintf(`{"previewUrl":"/api/registration/uploads/%s","storageKey":"%s"}`, seg, photoObjectKey)

	t.Run("signed when R2 is configured", func(t *testing.T) {
		signer := &fakePhotoSigner{configured: true}
		s := &Service{photo: signer}
		got := s.resolveContestantPhoto(blob)
		if !strings.HasPrefix(got, "https://r2.example/"+photoObjectKey) {
			t.Fatalf("got %q", got)
		}
		if len(signer.signed) != 1 || signer.signed[0] != photoObjectKey {
			t.Fatalf("signed keys = %v", signer.signed)
		}
	})

	// A private route is worse than no photo: it 403s for every voter and the
	// screen shows a broken image where an initials placeholder belongs.
	t.Run("blank without a signer", func(t *testing.T) {
		s := &Service{}
		if got := s.resolveContestantPhoto(blob); got != "" {
			t.Fatalf("got %q, want empty", got)
		}
	})

	t.Run("blank when signing fails", func(t *testing.T) {
		s := &Service{photo: &fakePhotoSigner{configured: true, fail: true}}
		if got := s.resolveContestantPhoto(blob); got != "" {
			t.Fatalf("got %q, want empty", got)
		}
	})

	t.Run("pasted url passes through untouched", func(t *testing.T) {
		s := &Service{photo: &fakePhotoSigner{configured: true}}
		const pasted = "https://cdn.example/photo.jpg"
		if got := s.resolveContestantPhoto(pasted); got != pasted {
			t.Fatalf("got %q", got)
		}
	})
}

func TestWithPhotoListResolvesEveryRow(t *testing.T) {
	seg := base64.RawURLEncoding.EncodeToString([]byte(photoObjectKey))
	s := &Service{photo: &fakePhotoSigner{configured: true}}
	list := []RosterEntry{
		{Name: "blob", PhotoURL: fmt.Sprintf(`{"storageKey":"%s"}`, photoObjectKey)},
		{Name: "pasted", PhotoURL: "https://cdn.example/x.png"},
		{Name: "none", PhotoURL: ""},
		{Name: "private route", PhotoURL: "/api/registration/uploads/" + seg},
	}
	s.withPhotoList(list)

	if !strings.HasPrefix(list[0].PhotoURL, "https://r2.example/") {
		t.Errorf("blob row not signed: %q", list[0].PhotoURL)
	}
	if list[1].PhotoURL != "https://cdn.example/x.png" {
		t.Errorf("pasted row changed: %q", list[1].PhotoURL)
	}
	if list[2].PhotoURL != "" {
		t.Errorf("empty row changed: %q", list[2].PhotoURL)
	}
	if !strings.HasPrefix(list[3].PhotoURL, "https://r2.example/") {
		t.Errorf("route row not signed: %q", list[3].PhotoURL)
	}
}

// A receipt is the same join against contestants.photo_url as the roster row it
// sits next to, so it must be signed by the same rule — otherwise the vote-success
// card shows the picture and the receipt below it shows nothing.
func TestWithVotePhotosResolveReceipts(t *testing.T) {
	seg := base64.RawURLEncoding.EncodeToString([]byte(photoObjectKey))
	s := &Service{photo: &fakePhotoSigner{configured: true}}

	list := []MyVote{
		{ContestantName: "blob", PhotoURL: fmt.Sprintf(`{"storageKey":"%s"}`, photoObjectKey)},
		{ContestantName: "pasted", PhotoURL: "https://cdn.example/x.png"},
	}
	s.withVotePhotos(list)
	if !strings.HasPrefix(list[0].PhotoURL, "https://r2.example/"+photoObjectKey) {
		t.Errorf("receipt row not signed: %q", list[0].PhotoURL)
	}
	if list[1].PhotoURL != "https://cdn.example/x.png" {
		t.Errorf("pasted receipt row changed: %q", list[1].PhotoURL)
	}

	single := s.withVotePhoto(&MyVote{PhotoURL: "/api/registration/uploads/" + seg})
	if !strings.HasPrefix(single.PhotoURL, "https://r2.example/") {
		t.Errorf("single receipt not signed: %q", single.PhotoURL)
	}
	if s.withVotePhoto(nil) != nil {
		t.Error("nil receipt must stay nil")
	}
}
