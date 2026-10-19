package connectvoting

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"time"
)

// Contestant photos come out of the registration upload route, so a
// contestants.photo_url is one of three things: the whole upload response
// ({"fileName","previewUrl","storageKey"}), that previewUrl on its own, or a
// pasted external URL. Neither of the first two renders anywhere: the previewUrl
// is frontend-web's PRIVATE read route, which only the applicant who uploaded the
// file may open (registration/<userId>/ is also where their documents live), so
// every voter who asked for it got a 403 and the screen showed nothing.
//
// The object key inside those values is therefore signed here at read time — the
// same thing connect/profile and association do, because the R2 bucket is not
// public — and clients receive a short-lived absolute URL they can render.

// photoSigner is satisfied by *r2.Presigner; an interface keeps the mapping
// testable without cloud credentials.
type photoSigner interface {
	Configured() bool
	PresignGet(key string, ttl time.Duration) (string, error)
}

// photoViewTTL matches connect/profile's photo view TTL: long enough that a
// roster keeps rendering while it is scrolled, short enough that a leaked URL
// stops working the same day.
const photoViewTTL = 60 * time.Minute

const registrationUploadsPath = "/api/registration/uploads/"
const registrationKeyPrefix = "registration/"

// SetPhotoSigner injects the R2 signer for contestant photos (app-wiring,
// post-construction). Nil leaves stored values untouched, which is correct for
// contestants whose photo is a plain URL.
func (s *Service) SetPhotoSigner(p photoSigner) { s.photo = p }

// contestantPhotoKey digs the R2 object key out of whatever photo_url holds.
// The empty string means "not ours to sign" — an external URL, a value we cannot
// parse, or a key outside the registration prefix — and the caller leaves the
// stored value alone.
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

// resolveContestantPhoto turns a stored photo_url into something a voter's
// screen can load. A value that is not ours to sign is returned unchanged
// (pasted URLs already work); one that IS ours but cannot be signed becomes ""
// rather than a private route, so the screen shows its initials placeholder
// instead of a broken image.
func (s *Service) resolveContestantPhoto(stored string) string {
	key := contestantPhotoKey(stored)
	if key == "" {
		return stored
	}
	if s.photo == nil || !s.photo.Configured() {
		return ""
	}
	url, err := s.photo.PresignGet(key, photoViewTTL)
	if err != nil {
		return ""
	}
	return url
}

// withPhoto resolves one entry's photo in place.
func (s *Service) withPhoto(e *RosterEntry) *RosterEntry {
	if e == nil {
		return nil
	}
	e.PhotoURL = s.resolveContestantPhoto(e.PhotoURL)
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
	v.PhotoURL = s.resolveContestantPhoto(v.PhotoURL)
	return v
}

func (s *Service) withVotePhotos(list []MyVote) []MyVote {
	for i := range list {
		s.withVotePhoto(&list[i])
	}
	return list
}
