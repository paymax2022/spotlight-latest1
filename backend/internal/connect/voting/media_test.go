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

// A contestant's song reaches a phone through frontend-web's reader, so the
// roster must hand out that reader's ABSOLUTE url — the app has no same-origin
// relative fetch to hang it on. Two things this pins: an entry with no song
// never gets a url (a player that 404s is worse than no player), and the origin
// comes from this deployment's wiring, never from whatever host was used when
// the file was uploaded.
func TestServiceWithSongBuildsTheReaderURL(t *testing.T) {
	s := &Service{}
	s.SetMediaBaseURL("https://web.test")

	got := s.withSong(&RosterEntry{ContestantID: "ct1", SongSubmissionID: "11111111-2222-3333-4444-555555555555"})
	if want := "https://web.test/api/open-mic/songs/11111111-2222-3333-4444-555555555555"; got.SongURL != want {
		t.Errorf("song url: got %q, want %q", got.SongURL, want)
	}

	silent := s.withSong(&RosterEntry{ContestantID: "ct2"})
	if silent.SongURL != "" {
		t.Errorf("an entry with no submission must have no url, got %q", silent.SongURL)
	}

	// No base means the path survives as-is, exactly like the image routes: a
	// relative reader path is still resolvable inside the web app, and guessing
	// an origin is how the localhost-banner bug started.
	rel := (&Service{}).withSong(&RosterEntry{SongSubmissionID: "abc"})
	if rel.SongURL != "/api/open-mic/songs/abc" {
		t.Errorf("without a base the reader path should survive as-is, got %q", rel.SongURL)
	}

	list := s.withSongList([]RosterEntry{{SongSubmissionID: "a"}, {}})
	if list[0].SongURL != "https://web.test/api/open-mic/songs/a" || list[1].SongURL != "" {
		t.Errorf("withSongList: %+v", list)
	}
	if s.withSong(nil) != nil {
		t.Error("withSong(nil) must stay nil")
	}
}
