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
	if base = strings.TrimRight(strings.TrimSpace(base), "/"); base == "" {
		return path
	}
	return base + path
}
