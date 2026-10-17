package top5events

// Organiser profile and banner upload (events-social). No money moves here: no
// ledger posting, no Idempotency-Key.
//
// The banner flow mirrors restaurant/store_images.go step for step, because the
// constraints are the same (the bucket is private, there is no public domain):
//
//  1. POST /events/organisers/me/banner/presign: the backend CHOOSES the object key
//     (organiser/<callerID>/banner/<rand><ext>) and binds the Content-Type into the
//     signature, so the client cannot pick where an image lands or smuggle a type.
//  2. The client PUTs straight to R2, then sends the returned key as banner_url in
//     PUT /events/organisers/me. That write accepts an http(s) link or a key under
//     the CALLER's own prefix and nothing else, and the check runs before any
//     database access.
//  3. GetOrganiser signs a stored key into a short-lived GET URL (viewBanner). The
//     column keeps holding both shapes: a link is returned as stored, a key we
//     minted is resolved.
//
// SVG is not allowed: it can carry script and the banner is rendered to other users.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/url"
	"path"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/go-common/cryptox"
	"spotlight/backend/internal/platform/r2"
)

const (
	// bannerPresignTTL is the restaurant store-image upload window.
	bannerPresignTTL = 10 * time.Minute
	// bannerViewTTL bounds a signed view URL (restaurant storeImageViewTTL).
	bannerViewTTL = 60 * time.Minute

	// organiserDisplayNameMax and organiserBioMax cap profile text in runes (a
	// product choice, not in the spec); longer input is ErrValidation. An empty
	// display_name is stored as NULL so reads fall back to user_profiles.full_name.
	organiserDisplayNameMax = 120
	organiserBioMax         = 2000
	// organiserUpcomingMax bounds the upcoming-events list on a profile (a product
	// choice, not in the spec).
	organiserUpcomingMax = 50
)

// ErrBannerUploadsUnavailable means R2 is unset or failed its write probe. The
// handler maps it to 503 so the app can say uploads are unavailable.
var ErrBannerUploadsUnavailable = errors.New("events: banner uploads are not configured")

// bannerContentTypeByExt is both the extension allowlist and the extension to type
// binding: the declared Content-Type must match the file's extension exactly.
var bannerContentTypeByExt = map[string]string{
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
}

// WithStorage attaches the R2 presigner used to mint banner uploads and to sign
// stored banner keys for reads. Nil (the default) means uploads answer
// ErrBannerUploadsUnavailable and stored keys are hidden rather than leaked.
func (s *Service) WithStorage(p *r2.Presigner) *Service {
	s.presigner = p
	return s
}

// OrganiserProfile is the public organiser page: identity, follower count, the
// caller's follow state, and the organiser's upcoming public events.
type OrganiserProfile struct {
	OrganiserID   string  `json:"organiser_id"`
	DisplayName   string  `json:"display_name"`
	Bio           string  `json:"bio"`
	BannerURL     *string `json:"banner_url"`
	FollowerCount int     `json:"follower_count"`
	Following     bool    `json:"following"`
	Events        []Event `json:"events"`
}

// OrganiserPatch is a partial edit of the caller's own profile. A nil DisplayName
// or Bio means no change. BannerURL needs three states, so BannerSet records
// whether the field was present: absent means no change; present with null or an
// empty string clears the banner (NULL); present with a value sets it.
type OrganiserPatch struct {
	DisplayName *string
	Bio         *string
	BannerURL   *string
	BannerSet   bool
}

// UnmarshalJSON reads display_name, bio and banner_url, distinguishing an absent
// banner_url from an explicit null.
func (p *OrganiserPatch) UnmarshalJSON(b []byte) error {
	var aux struct {
		DisplayName *string         `json:"display_name"`
		Bio         *string         `json:"bio"`
		BannerURL   json.RawMessage `json:"banner_url"`
	}
	if err := json.Unmarshal(b, &aux); err != nil {
		return err
	}
	*p = OrganiserPatch{DisplayName: aux.DisplayName, Bio: aux.Bio}
	if aux.BannerURL != nil { // key present (null arrives as the literal "null")
		p.BannerSet = true
		if string(aux.BannerURL) != "null" {
			var s string
			if err := json.Unmarshal(aux.BannerURL, &s); err != nil {
				return fmt.Errorf("banner_url must be a string or null: %w", err)
			}
			p.BannerURL = &s
		}
	}
	return nil
}

// BannerPresign is what the client needs to PUT a banner image to R2.
type BannerPresign struct {
	UploadURL   string `json:"upload_url"`   // presigned PUT URL (short-lived)
	ObjectKey   string `json:"object_key"`   // send back as banner_url
	ContentType string `json:"content_type"` // the client MUST send this exact header on the PUT
	ExpiresIn   int    `json:"expires_in"`   // seconds
	Method      string `json:"method"`       // always "PUT"
}

// bannerKeyPrefix is the object-key prefix every banner of one organiser starts with.
func bannerKeyPrefix(organiserID string) string {
	return "organiser/" + organiserID + "/banner/"
}

// canonicalUserID returns the lower-case canonical form of a user id, so the key
// prefix minted at presign time and the prefix checked at save time always agree.
func canonicalUserID(userID string) (string, error) {
	u, err := uuid.Parse(userID)
	if err != nil {
		return "", fmt.Errorf("%w: events: user required", ErrValidation)
	}
	return u.String(), nil
}

// classifyBannerRef validates a submitted banner reference for organiserID. It
// must be an http(s) link, or a key under organiserID's own banner prefix with an
// allowed image extension. The empty string is the caller's concern (it clears).
func classifyBannerRef(organiserID, ref string) error {
	bad := fmt.Errorf("%w: events: banner_url must be an http(s) link or a banner uploaded by you", ErrValidation)
	ref = strings.TrimSpace(ref)
	if u, err := url.Parse(ref); err == nil && u.Scheme != "" {
		// A scheme means a link. Only web links: the value is rendered by the apps,
		// so javascript:, data:, file: and r2:// never get in.
		if (u.Scheme == "http" || u.Scheme == "https") && u.Host != "" {
			return nil
		}
		return bad
	}
	if !strings.HasPrefix(ref, bannerKeyPrefix(organiserID)) || strings.Contains(ref, "..") {
		return bad
	}
	if _, ok := bannerContentTypeByExt[strings.ToLower(path.Ext(ref))]; !ok {
		return bad
	}
	return nil
}

// isOwnBannerKey reports whether a stored value is a key this feature mints. Only
// these are signed on read; a link is returned exactly as stored.
func isOwnBannerKey(v string) bool {
	if u, err := url.Parse(v); err == nil && u.Scheme != "" {
		return false
	}
	return strings.HasPrefix(v, "organiser/") && strings.Contains(v, "/banner/")
}

// viewBanner turns a stored banner value into something a client can render.
func (s *Service) viewBanner(ref *string) *string {
	if ref == nil {
		return nil
	}
	v := strings.TrimSpace(*ref)
	if v == "" {
		return nil
	}
	if !isOwnBannerKey(v) {
		return ref
	}
	// A key we cannot sign is hidden rather than returned: the client would show a
	// broken image and the raw key is an internal storage path.
	if s.presigner == nil || !s.presigner.Configured() {
		return nil
	}
	signed, err := s.presigner.PresignGet(v, bannerViewTTL)
	if err != nil {
		return nil
	}
	return &signed
}

// PresignOrganiserBanner mints a presigned upload URL for the caller's banner. The
// file type is validated first; no URL is issued for a rejected type.
func (s *Service) PresignOrganiserBanner(ctx context.Context, userID, fileName, contentType string) (*BannerPresign, error) {
	oid, err := canonicalUserID(userID)
	if err != nil {
		return nil, err
	}
	ext := strings.ToLower(path.Ext(strings.TrimSpace(fileName)))
	want, ok := bannerContentTypeByExt[ext]
	if !ok {
		return nil, fmt.Errorf("%w: events: unsupported image type (use PNG, JPG or WEBP)", ErrValidation)
	}
	if ct := strings.ToLower(strings.TrimSpace(contentType)); ct != want {
		return nil, fmt.Errorf("%w: events: content type does not match the file extension", ErrValidation)
	}

	if s.presigner == nil || !s.presigner.Configured() {
		return nil, ErrBannerUploadsUnavailable
	}
	// Configured() only proves the variables are non-empty; a wrong bucket or a
	// read-only token still signs and then fails at the client's PUT. The probe is
	// cached; the precise cause stays in the server log, never in the response.
	if err := s.presigner.Healthy(ctx); err != nil {
		log.Printf("[top5events] R2 write probe failed, banner uploads disabled until R2_* config is fixed: %v", err)
		return nil, ErrBannerUploadsUnavailable
	}
	key := bannerKeyPrefix(oid) + cryptox.RandHex(16) + ext
	u, err := s.presigner.PresignPut(key, want, bannerPresignTTL)
	if err != nil {
		return nil, ErrBannerUploadsUnavailable
	}
	return &BannerPresign{
		UploadURL:   u,
		ObjectKey:   key,
		ContentType: want,
		ExpiresIn:   int(bannerPresignTTL.Seconds()),
		Method:      "PUT",
	}, nil
}

// GetOrganiser returns the organiser page as seen by viewerID. The display name
// falls back to the account's full name when no profile row (or no display name)
// exists. An unknown organiser, or one that is not a uuid, is ErrNotFound.
func (s *Service) GetOrganiser(ctx context.Context, viewerID, organiserID string) (*OrganiserProfile, error) {
	if _, err := uuid.Parse(organiserID); err != nil {
		return nil, ErrNotFound
	}
	const q = `
		SELECT COALESCE(NULLIF(op.display_name, ''), up.full_name, ''),
		       COALESCE(op.bio, ''),
		       op.banner_url,
		       COALESCE(op.follower_count, 0),
		       EXISTS (SELECT 1 FROM organiser_follows f WHERE f.organiser_id = u.id AND f.follower_id = $2::uuid)
		  FROM auth.users u
		  LEFT JOIN organiser_profiles op ON op.organiser_id = u.id
		  LEFT JOIN user_profiles up ON up.id = u.id
		 WHERE u.id = $1`
	p := OrganiserProfile{OrganiserID: organiserID, Events: []Event{}}
	var banner *string
	if err := s.db.QueryRow(ctx, q, organiserID, likeCaller(viewerID)).
		Scan(&p.DisplayName, &p.Bio, &banner, &p.FollowerCount, &p.Following); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("events: organiser: %w", err)
	}
	p.BannerURL = s.viewBanner(banner)

	evs, err := s.listOrganiserUpcoming(ctx, viewerID, organiserID)
	if err != nil {
		return nil, err
	}
	p.Events = evs
	return &p, nil
}

// listOrganiserUpcoming returns the organiser's upcoming public (LIVE or APPROVED)
// events, soonest first, with Liked set for the viewer.
func (s *Service) listOrganiserUpcoming(ctx context.Context, viewerID, organiserID string) ([]Event, error) {
	q := `SELECT ` + eventSelectCols + `
		  FROM events e
		  ` + eventLikedJoin + `
		 WHERE e.organiser_id = $1
		   AND e.state IN ('LIVE','APPROVED')
		   AND e.starts_at >= now()
		 ORDER BY e.starts_at ASC, e.id ASC
		 LIMIT $3`
	rows, err := s.db.Query(ctx, q, organiserID, likeCaller(viewerID), organiserUpcomingMax)
	if err != nil {
		return nil, fmt.Errorf("events: organiser events: %w", err)
	}
	defer rows.Close()
	out := []Event{}
	for rows.Next() {
		e, err := scanEvent(rows)
		if err != nil {
			return nil, fmt.Errorf("events: organiser events scan: %w", err)
		}
		out = append(out, *e)
	}
	return out, rows.Err()
}

// UpdateMyOrganiser upserts the caller's own profile row from a partial patch and
// returns the profile as the caller sees it. Every input check (text lengths and
// the banner key ownership) runs before any database access.
func (s *Service) UpdateMyOrganiser(ctx context.Context, userID string, in OrganiserPatch) (*OrganiserProfile, error) {
	oid, err := canonicalUserID(userID)
	if err != nil {
		return nil, err
	}

	var (
		nameSet, bioSet bool
		name            *string // nil with nameSet => NULL (falls back to full_name on read)
		bio             string
		banner          *string // nil with BannerSet => NULL
	)
	if in.DisplayName != nil {
		nameSet = true
		v := strings.TrimSpace(*in.DisplayName)
		if utf8.RuneCountInString(v) > organiserDisplayNameMax {
			return nil, fmt.Errorf("%w: events: display_name must be at most %d characters", ErrValidation, organiserDisplayNameMax)
		}
		if v != "" {
			name = &v
		}
	}
	if in.Bio != nil {
		bioSet = true
		bio = strings.TrimSpace(*in.Bio)
		if utf8.RuneCountInString(bio) > organiserBioMax {
			return nil, fmt.Errorf("%w: events: bio must be at most %d characters", ErrValidation, organiserBioMax)
		}
	}
	if in.BannerSet && in.BannerURL != nil {
		if v := strings.TrimSpace(*in.BannerURL); v != "" {
			if err := classifyBannerRef(oid, v); err != nil {
				return nil, err
			}
			banner = &v
		}
		// null or an empty string: leave banner nil, which with BannerSet clears it.
	}

	const upsert = `
		INSERT INTO organiser_profiles (organiser_id, display_name, bio, banner_url)
		VALUES ($1, $2::text, $3::text, $4::text)
		ON CONFLICT (organiser_id) DO UPDATE SET
		  display_name = CASE WHEN $5::boolean THEN EXCLUDED.display_name ELSE organiser_profiles.display_name END,
		  bio          = CASE WHEN $6::boolean THEN EXCLUDED.bio          ELSE organiser_profiles.bio          END,
		  banner_url   = CASE WHEN $7::boolean THEN EXCLUDED.banner_url   ELSE organiser_profiles.banner_url   END,
		  updated_at   = now()`
	if _, err := s.db.Exec(ctx, upsert, oid, name, bio, banner, nameSet, bioSet, in.BannerSet); err != nil {
		return nil, mapSocialErr("organiser update", err)
	}
	s.log(oid, "events.organiser_update", oid, map[string]any{
		"display_name": nameSet, "bio": bioSet, "banner": in.BannerSet,
	})
	return s.GetOrganiser(ctx, oid, oid)
}
