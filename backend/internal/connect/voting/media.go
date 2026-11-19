package connectvoting

import "strings"

// Contest banners and logos are uploaded through frontend-web, which serves
// them at this path (the base64url segment is the storage key). Rows used to
// store the FULL URL including the uploading environment's origin, so a contest
// created on a laptop kept pointing at http://localhost:3000 after it was
// published, and no phone or staging page could load the image.
const contestMediaPath = "/api/admin/contests/banner/"

// contestMediaPathOf returns the path when a stored value addresses OUR media
// route — as the bare path new uploads write, or as an absolute URL left by the
// old ones on any environment — and "" for anything else.
func contestMediaPathOf(stored string) string {
	s := strings.TrimSpace(stored)
	if strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://") {
		afterScheme := s[strings.Index(s, "://")+3:]
		slash := strings.IndexByte(afterScheme, '/')
		if slash < 0 {
			return "" // an origin with no path is not our media route
		}
		s = afterScheme[slash:]
	}
	if strings.HasPrefix(s, contestMediaPath) {
		return s
	}
	return ""
}

// The root-relative reader frontend-web serves every Open Mic song through —
// web voting cards, the admin review panel, the artist's own profile and this
// API. It is the ONLY way a song's bytes reach a client: it re-checks the
// status and the object key on every request, so a contestant disqualified
// after the roster was cached stops playing instead of streaming forever.
const songReaderPath = "/api/open-mic/songs/"

// resolveWebRoute hangs a root-relative frontend-web route under this
// deployment's web origin. With no origin configured the path comes back as
// stored: a path the web app can render truthfully beats a URL guessed wrong.
func resolveWebRoute(path, base string) string {
	if path = strings.TrimSpace(path); path == "" {
		return ""
	}
	if base = strings.TrimRight(strings.TrimSpace(base), "/"); base == "" {
		return path
	}
	return base + path
}

// resolveMediaURL turns a stored contest image value into one the calling
// client can load. base is the web app origin for THIS deployment: a path
// becomes an absolute URL under it, and a legacy path written under another
// environment's origin is moved under this one. A value that is not our media
// route — an external image an admin pasted — is returned untouched, and with
// no base configured the path is returned as-is, because a path the web can
// render truthfully beats a URL guessed wrong.
func resolveMediaURL(stored, base string) string {
	stored = strings.TrimSpace(stored)
	if stored == "" {
		return ""
	}
	path := contestMediaPathOf(stored)
	if path == "" {
		return stored
	}
	return resolveWebRoute(path, base)
}

// withSong turns the submission id the roster query found into the absolute
// reader URL a phone can hand to its audio player. The scan leaves the stored
// id alone, so this is the read boundary that decides the origin — the same
// shape as withMedia for contest images and withPhoto for contestant photos.
// An entry with no song gets no URL, never a URL to a 404.
func (s *Service) withSong(e *RosterEntry) *RosterEntry {
	if e == nil {
		return nil
	}
	if e.SongSubmissionID == "" {
		e.SongURL = ""
		return e
	}
	e.SongURL = resolveWebRoute(songReaderPath+e.SongSubmissionID, s.mediaBase)
	return e
}

func (s *Service) withSongList(list []RosterEntry) []RosterEntry {
	for i := range list {
		s.withSong(&list[i])
	}
	return list
}
