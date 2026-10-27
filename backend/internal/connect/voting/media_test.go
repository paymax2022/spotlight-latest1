package connectvoting

// DB-free tests for contest image resolution. The bug this pins: a banner
// uploaded on a laptop used to be stored as http://localhost:3000/api/… and was
// served verbatim to every client, so the image existed only on that machine.
// Storage is now a path and the origin is attached per deployment.

import "testing"

const mediaPath = "/api/admin/contests/banner/Y29udGVzdHMvYmFubmVycy9hLnBuZw"

func TestResolveMediaURL(t *testing.T) {
	cases := []struct {
		name   string
		stored string
		base   string
		want   string
	}{
		{"a stored path gets this deployment's origin", mediaPath, "https://www.spotlightng.com", "https://www.spotlightng.com" + mediaPath},
		{"a legacy localhost row is re-based", "http://localhost:3000" + mediaPath, "https://staging.example.app", "https://staging.example.app" + mediaPath},
		{"a legacy production row is re-based for staging", "https://www.spotlightng.com" + mediaPath, "http://localhost:3000", "http://localhost:3000" + mediaPath},
		{"a trailing slash on the base does not double up", mediaPath, "https://web.test/", "https://web.test" + mediaPath},
		{"no base means the path is handed out unchanged", mediaPath, "", mediaPath},
		{"an external image is left alone", "https://cdn.example.com/a.png", "https://web.test", "https://cdn.example.com/a.png"},
		{"an origin with no path is not our media route", "https://web.test", "https://other.test", "https://web.test"},
		{"empty stays empty", "", "https://web.test", ""},
		{"surrounding space is trimmed", "  " + mediaPath + " ", "https://web.test", "https://web.test" + mediaPath},
	}
	for _, tc := range cases {
		if got := resolveMediaURL(tc.stored, tc.base); got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
}

// The service is the read boundary every contest response passes through, so
// both fields must be rewritten there — a card that shows the new banner over
// the old logo is worse than one or the other.
func TestServiceWithMediaRewritesBothFields(t *testing.T) {
	s := &Service{}
	s.SetMediaBaseURL("https://web.test")
	c := s.withMedia(&Contest{ID: "c1", BannerImageURL: "http://localhost:3000" + mediaPath, LogoURL: mediaPath})
	if c.BannerImageURL != "https://web.test"+mediaPath {
		t.Errorf("banner not re-based: %q", c.BannerImageURL)
	}
	if c.LogoURL != "https://web.test"+mediaPath {
		t.Errorf("logo not re-based: %q", c.LogoURL)
	}

	// Unset base (a service built without the wiring) must not invent an origin.
	plain := (&Service{}).withMediaList([]Contest{{ID: "c2", LogoURL: mediaPath}})
	if plain[0].LogoURL != mediaPath {
		t.Errorf("without a base the path should survive as-is, got %q", plain[0].LogoURL)
	}
	if s.withMedia(nil) != nil {
		t.Error("withMedia(nil) must stay nil")
	}
}
