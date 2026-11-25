package connectvoting

import (
	"encoding/base64"
	"encoding/json"
	"strings"
)

// Contestant photos come out of the registration upload route, so a
// contestants.photo_url is one of three things: the whole upload response
// ({"fileName","previewUrl","storageKey"}), that previewUrl on its own, or a
// pasted external URL. Neither of the first two renders anywhere: the previewUrl
// is frontend-web's PRIVATE read route, which only the applicant who uploaded the
// file may open (registration/<userId>/ is also where their documents live), so
// every voter who asked for it got a 403 and the screen showed nothing.
//
// Signing the key here used to look like the answer, and it is not one. The
// upload route writes to R2 only when THAT app has bucket credentials; without
// them it falls back to its own disk (frontend-web/src/lib/storage/
// local-uploads.ts). So the bytes' location is a property of the deployment's
// web app, which this service cannot see: it signed a perfectly valid URL for an
// object the bucket had never received, and the voter got 404 NoSuchKey — the
// exact failure a dev box hits, because that is where uploads land on disk. See
// the reader this hands out: frontend-web/app/api/v1/contestants/[id]/photo.
//
// A photo is therefore addressed the same way contest banners
// (/api/admin/contests/banner/) and Open Mic songs (/api/open-mic/songs/)
// already are: this API names frontend-web's reader, that plane resolves the key
// against the bucket or its own disk, confirms the object exists, and answers —
// redirect, bytes, or a 404 the caller renders as its placeholder.

// contestantPhotoReaderPath is frontend-web's public contestant-photo reader; the
// id is appended, then "/photo". Root-relative until the deployment's web origin
// is configured, which resolveWebRoute handles.
const contestantPhotoReaderPath = "/api/v1/contestants/"

const registrationUploadsPath = "/api/registration/uploads/"
const registrationKeyPrefix = "registration/"

// contestantPhotoKey digs the R2 object key out of whatever photo_url holds.
// The empty string means "not ours to sign" — an external URL, a value we cannot
// parse, or a key outside the registration prefix — and the caller decides what
// that is worth.
func contestantPhotoKey(stored string) string {
	stored = strings.TrimSpace(stored)
	if strings.HasPrefix(stored, "{") {
		var upload struct {
			PreviewURL string `json:"previewUrl"`
			StorageKey string `json:"storageKey"`
		}
		if err := json.Unmarshal([]byte(stored), &upload); err != nil {
			return ""
		}
		if key := registrationKey(upload.StorageKey); key != "" {
			return key
		}
		return registrationKey(upload.PreviewURL)
	}
	return registrationKey(stored)
}

// registrationKey normalises one stored form into a bucket key: a bare
// registration/... key passes through, the private preview route's base64url
// path segment is decoded, anything with another scheme or prefix is refused.
func registrationKey(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return ""
	}
	if i := strings.Index(v, registrationUploadsPath); i >= 0 {
		tail := v[i+len(registrationUploadsPath):]
		if j := strings.IndexAny(tail, "?#"); j >= 0 {
			tail = tail[:j]
		}
		decoded, err := decodeFileKeySegment(tail)
		if err != nil {
			return ""
		}
		v = decoded
	} else if strings.Contains(v, "://") {
		return ""
	}
	v = strings.TrimPrefix(strings.TrimSpace(v), "/")
	if !strings.HasPrefix(v, registrationKeyPrefix) || strings.Contains(v, "..") {
		return ""
	}
	return v
}

// decodeFileKeySegment accepts the base64url the upload route mints (unpadded)
// and the padded form a hand-written row might carry.
func decodeFileKeySegment(seg string) (string, error) {
	if out, err := base64.RawURLEncoding.DecodeString(seg); err == nil {
		return string(out), nil
	}
	out, err := base64.URLEncoding.DecodeString(seg)
	return string(out), err
}

// storedUploadValue recognises a photo value the registration upload flow wrote,
// including the forms whose key could not be read out of it — a half-written blob
// or a route segment that does not decode. Those are ours, and ours-to-nobody:
// handing one back points the screen at a 403 or at raw JSON.
func storedUploadValue(stored string) bool {
	s := strings.TrimSpace(stored)
	if strings.HasPrefix(s, "{") || strings.Contains(s, registrationUploadsPath) {
		return true
	}
	return strings.HasPrefix(strings.TrimPrefix(s, "/"), registrationKeyPrefix)
}

// resolveContestantPhoto turns a stored photo_url into something a voter's screen
// can load: frontend-web's reader URL for a photo the upload flow stored, the
// value itself for an address we do not own (a pasted URL already works), and the
// empty string when there is nothing loadable to hand out — an unreadable upload
// value, or a photo row whose id is missing so no reader URL can address it. The
// caller's initials placeholder is the honest answer in that last case, not a
// broken image.
func (s *Service) resolveContestantPhoto(stored, contestantID string) string {
	stored = strings.TrimSpace(stored)
	if stored == "" {
		return ""
	}
	if contestantPhotoKey(stored) != "" {
		if strings.TrimSpace(contestantID) == "" {
			return ""
		}
		return resolveWebRoute(contestantPhotoReaderPath+contestantID+"/photo", s.mediaBase)
	}
	if storedUploadValue(stored) {
		return ""
	}
	return stored
}

// withPhoto resolves one entry's photo in place.
func (s *Service) withPhoto(e *RosterEntry) *RosterEntry {
	if e == nil {
		return nil
	}
	e.PhotoURL = s.resolveContestantPhoto(e.PhotoURL, e.ContestantID)
	return e
}

func (s *Service) withPhotoList(list []RosterEntry) []RosterEntry {
	for i := range list {
		s.withPhoto(&list[i])
	}
	return list
}

// withVotePhoto resolves the contestant photo on a voter's own receipt, and
// withVotePhotos the whole history list. Same rule as the roster: these rows join
// contestants.photo_url, so without this the receipt shows a broken image where
// the vote-success card next to it shows the picture.
func (s *Service) withVotePhoto(v *MyVote) *MyVote {
	if v == nil {
		return nil
	}
	v.PhotoURL = s.resolveContestantPhoto(v.PhotoURL, v.ContestantID)
	return v
}

func (s *Service) withVotePhotos(list []MyVote) []MyVote {
	for i := range list {
		s.withVotePhoto(&list[i])
	}
	return list
}
