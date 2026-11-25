package connectvoting

import (
	"encoding/base64"
	"fmt"
	"strings"
	"testing"
)

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

// The photo's bytes live in whatever store frontend-web wrote them to — the
// bucket when this deployment has credentials, this app's own disk when it does
// not (`src/lib/storage/local-uploads.ts`) — and only that plane can tell which.
// So the API stops guessing and hands out that plane's reader URL instead, the
// same arrangement contest banners (`/api/admin/contests/banner/`) and Open Mic
// songs (`/api/open-mic/songs/`) already use.
func TestResolveContestantPhotoHandsOutTheReaderURL(t *testing.T) {
	seg := base64.RawURLEncoding.EncodeToString([]byte(photoObjectKey))
	const contestantID = "5af2241f-ddf0-44be-b9f9-39f7a48b15a7"
	want := "/api/v1/contestants/" + contestantID + "/photo"

	stored := []struct {
		name string
		url  string
	}{
		{"upload json", fmt.Sprintf(`{"previewUrl":"/api/registration/uploads/%s","storageKey":"%s"}`, seg, photoObjectKey)},
		{"preview route alone", "/api/registration/uploads/" + seg},
		{"object key alone", photoObjectKey},
	}

	t.Run("with no web origin configured the reader path stays root-relative", func(t *testing.T) {
		s := &Service{}
		for _, tc := range stored {
			if got := s.resolveContestantPhoto(tc.url, contestantID); got != want {
				t.Errorf("%s: got %q, want %q", tc.name, got, want)
			}
		}
	})

	// What the mobile app and every web page actually receive: the reader under
	// THIS deployment's origin (WEB_APP_BASE_URL), so nothing on another host,
	// and nothing that only the uploader could open.
	t.Run("absolutised under the web origin", func(t *testing.T) {
		s := &Service{mediaBase: "https://www.spotlightng.com/"}
		for _, tc := range stored {
			if got := s.resolveContestantPhoto(tc.url, contestantID); got != "https://www.spotlightng.com"+want {
				t.Errorf("%s: got %q", tc.name, got)
			}
		}
	})

	t.Run("the reader never carries a trailing id of the wrong shape", func(t *testing.T) {
		s := &Service{}
		if got := s.resolveContestantPhoto(photoObjectKey, ""); got != "" {
			t.Errorf("without a contestant id the answer must be empty, got %q", got)
		}
	})
}

// A value we cannot address is worse than no value: the upload blob and the
// private preview route both render as a broken image (the route 403s for
// everyone but the uploader), while an empty photo is what makes the screen show
// its initials placeholder.
func TestResolveContestantPhotoRefusesOurUnusableValues(t *testing.T) {
	s := &Service{}

	cases := []struct {
		name   string
		stored string
	}{
		{"unparseable json", `{"fileName":`},
		{"uploads route whose key is not ours", "/api/registration/uploads/" + base64.RawURLEncoding.EncodeToString([]byte("contests/banners/x.png"))},
		{"uploads route with an undecodable segment", "/api/registration/uploads/not-base64-%%"},
		{"uploads route with traversal", "/api/registration/uploads/" + base64.RawURLEncoding.EncodeToString([]byte("registration/../../etc/passwd"))},
		{"bare key with traversal", "registration/../../etc/passwd"},
		{"empty", ""},
	}
	for _, tc := range cases {
		if got := s.resolveContestantPhoto(tc.stored, "c1"); got != "" {
			t.Errorf("%s: got %q, want empty", tc.name, got)
		}
	}
}

// Anything we do not store is the admin's or the applicant's own address, and it
// already works — it must come back exactly as stored.
func TestResolveContestantPhotoPassesThroughForeignValues(t *testing.T) {
	s := &Service{mediaBase: "https://www.spotlightng.com"}

	for _, stored := range []string{
		"https://cdn.example/photo.jpg",
		"http://cdn.example/photo.jpg",
		"/assets/img/shape/banner-home.png",
	} {
		if got := s.resolveContestantPhoto(stored, "c1"); got != stored {
			t.Errorf("%q changed to %q", stored, got)
		}
	}
}

func TestWithPhotoListResolvesEveryRow(t *testing.T) {
	seg := base64.RawURLEncoding.EncodeToString([]byte(photoObjectKey))
	s := &Service{}
	list := []RosterEntry{
		{ContestantID: "one", Name: "blob", PhotoURL: fmt.Sprintf(`{"storageKey":"%s"}`, photoObjectKey)},
		{ContestantID: "two", Name: "pasted", PhotoURL: "https://cdn.example/x.png"},
		{ContestantID: "three", Name: "none", PhotoURL: ""},
		{ContestantID: "four", Name: "private route", PhotoURL: "/api/registration/uploads/" + seg},
	}
	s.withPhotoList(list)

	if list[0].PhotoURL != "/api/v1/contestants/one/photo" {
		t.Errorf("blob row = %q, want the reader URL", list[0].PhotoURL)
	}
	if list[1].PhotoURL != "https://cdn.example/x.png" {
		t.Errorf("pasted row changed: %q", list[1].PhotoURL)
	}
	if list[2].PhotoURL != "" {
		t.Errorf("empty row changed: %q", list[2].PhotoURL)
	}
	if list[3].PhotoURL != "/api/v1/contestants/four/photo" {
		t.Errorf("route row = %q, want the reader URL", list[3].PhotoURL)
	}
	if s.withPhoto(nil) != nil {
		t.Error("nil entry must stay nil")
	}
}

// A receipt is the same join against contestants.photo_url as the roster row it
// sits next to, so it must be addressed the same way — otherwise the vote-success
// card shows the picture and the receipt below it shows nothing.
func TestWithVotePhotosResolveReceipts(t *testing.T) {
	seg := base64.RawURLEncoding.EncodeToString([]byte(photoObjectKey))
	s := &Service{}

	list := []MyVote{
		{ContestantID: "one", ContestantName: "blob", PhotoURL: fmt.Sprintf(`{"storageKey":"%s"}`, photoObjectKey)},
		{ContestantID: "two", ContestantName: "pasted", PhotoURL: "https://cdn.example/x.png"},
	}
	s.withVotePhotos(list)
	if list[0].PhotoURL != "/api/v1/contestants/one/photo" {
		t.Errorf("receipt row = %q, want the reader URL", list[0].PhotoURL)
	}
	if list[1].PhotoURL != "https://cdn.example/x.png" {
		t.Errorf("pasted receipt row changed: %q", list[1].PhotoURL)
	}

	single := s.withVotePhoto(&MyVote{ContestantID: "three", PhotoURL: "/api/registration/uploads/" + seg})
	if single.PhotoURL != "/api/v1/contestants/three/photo" {
		t.Errorf("single receipt = %q", single.PhotoURL)
	}
	if s.withVotePhoto(nil) != nil {
		t.Error("nil receipt must stay nil")
	}
}

// The reader URL is built by the same rule that built the R2 URL it replaced, so
// the strings the app already renders for banners and songs stay the shape it
// expects: this deployment's origin, then our path.
func TestContestantPhotoReaderPathIsAWebRoute(t *testing.T) {
	if !strings.HasPrefix(contestantPhotoReaderPath, "/api/") {
		t.Errorf("reader path %q must be a frontend-web route", contestantPhotoReaderPath)
	}
}
