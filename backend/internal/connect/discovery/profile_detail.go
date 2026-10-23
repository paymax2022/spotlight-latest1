package connectdiscovery

import (
	"context"
	"errors"
	"net/http"
	"time"

	"spotlight/backend/go-common/ginutil"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// mediaSigner signs a stored R2 object key back into a short-lived viewable URL.
// It mirrors the subset of *r2.Presigner the profile service uses, kept as an
// interface so the discovery service stays testable with a nil / fake signer.
type mediaSigner interface {
	Configured() bool
	PresignGet(key string, expiry time.Duration) (string, error)
}

// publicPhotoViewTTL matches the owner-side signing window (connectprofile).
const publicPhotoViewTTL = 60 * time.Minute

// WithPresigner wires the R2 signer so profile-detail photos stored as object
// keys resolve to viewable URLs (the bucket is not public). Plain-URL photos and
// a nil/unconfigured signer pass through unchanged. Returns the service for
// chaining at route registration.
func (s *Service) WithPresigner(p mediaSigner) *Service {
	s.presigner = p
	return s
}

// resolveMedia turns a stored photo value into something a client can render: a
// URL passes through; an object key becomes a short-lived signed GET. A signing
// failure returns the stored value unchanged (one photo must never break the
// whole card). Identical policy to connectprofile.Service.resolveMedia.
func (s *Service) resolveMedia(stored string) string {
	if s.presigner == nil || !s.presigner.Configured() {
		return stored
	}
	// A value that is already a URL (has a scheme) is not an object key.
	for i := 0; i+2 < len(stored); i++ {
		if stored[i] == ':' && stored[i+1] == '/' && stored[i+2] == '/' {
			return stored
		}
	}
	u, err := s.presigner.PresignGet(stored, publicPhotoViewTTL)
	if err != nil {
		return stored
	}
	return u
}

// PublicProfile is another member's profile as the viewer sees it on the
// discovery detail screen. camelCase and shaped to the mobile DiscoveryProfile:
// collection fields are ALWAYS present (never null) so the client's `.map` /
// `.length` can never crash. Raw coordinates are never included — only a
// bucketed distance label (privacy invariant 3).
type PublicProfile struct {
	ID            string          `json:"id"`
	DisplayName   string          `json:"displayName"`
	Age           int             `json:"age"`
	Headline      string          `json:"headline,omitempty"`
	Bio           string          `json:"bio,omitempty"`
	City          string          `json:"city,omitempty"`
	Photos        []string        `json:"photos"`
	Interests     []string        `json:"interests"`
	Prompts       []ProfilePrompt `json:"prompts"`
	Verified      []string        `json:"verified"`
	DistanceLabel string          `json:"distanceLabel"`
}

// ProfilePrompt mirrors the mobile prompt shape. Prompts are not stored yet, so
// the list is always empty for now; the field exists so the client contract is
// stable when prompts land.
type ProfilePrompt struct {
	Prompt string `json:"prompt"`
	Answer string `json:"answer"`
}

// publicVerifiedFlags maps the internal verified bool to the mobile's
// VerificationFlag[]. The discovery layer only knows a passed L0/L1 status, not
// which specific badges — a verified profile surfaces as ["identity"] (matching
// the mobile client's own bool→flag normalisation), otherwise an empty list.
func publicVerifiedFlags(verified bool) []string {
	if verified {
		return []string{"identity"}
	}
	return []string{}
}

// rawPublicProfile is the scanned row before photos / distance are layered on.
type rawPublicProfile struct {
	id          string
	displayName *string
	city        *string
	headline    *string
	bio         *string
	interests   []string
	geoLat      *float64
	geoLng      *float64
	age         *int
	verified    bool
}

// assemblePublicProfile builds the wire shape from a scanned row, resolved photo
// URLs and a (possibly empty) distance label. Kept pure so the slice-never-null
// and verified-mapping invariants are unit-testable without a database.
func assemblePublicProfile(rp rawPublicProfile, photos []string, distanceLabel string) PublicProfile {
	pp := PublicProfile{
		ID:            rp.id,
		Photos:        photos,
		Interests:     rp.interests,
		Prompts:       []ProfilePrompt{},
		Verified:      publicVerifiedFlags(rp.verified),
		DistanceLabel: distanceLabel,
	}
	if pp.Photos == nil {
		pp.Photos = []string{}
	}
	if pp.Interests == nil {
		pp.Interests = []string{}
	}
	if rp.displayName != nil {
		pp.DisplayName = *rp.displayName
	}
	if rp.city != nil {
		pp.City = *rp.city
	}
	if rp.headline != nil {
		pp.Headline = *rp.headline
	}
	if rp.bio != nil {
		pp.Bio = *rp.bio
	}
	if rp.age != nil && *rp.age > 0 {
		pp.Age = *rp.age
	}
	return pp
}

// PublicProfile assembles the detail view of one member's profile (`targetID`)
// for a viewing member (`viewerUserID`). It enforces the SAME visibility/safety
// gate as the swipe stack — the profile must have a visible mode, must not be
// the viewer, must not be blocked in either direction, must not be underage or
// account-restricted — but, unlike the stack, it does NOT exclude profiles the
// viewer has already liked or matched (you must still be able to open their
// profile). A profile that fails the gate (or does not exist) is reported as
// ErrTargetNotFound → 404, never leaking whether the id exists.
func (s *Service) PublicProfile(ctx context.Context, viewerUserID, targetID string) (*PublicProfile, error) {
	if _, err := uuid.Parse(targetID); err != nil {
		return nil, ErrTargetNotFound
	}
	// Resolve the viewer's own profile + approximate geo for the distance label.
	// A viewer without a profile may still view (empty profile id, no distance).
	viewerProfile, vlat, vlng, _ := s.resolveViewer(ctx, viewerUserID)

	const q = `
		SELECT p.id, p.display_name, p.city, p.headline, p.bio,
		       p.interests,
		       p.geo_lat, p.geo_lng,
		       CASE WHEN p.dob IS NULL THEN NULL
		            ELSE date_part('year', age(p.dob))::int END AS age,
		       COALESCE(v.status IN ('l0_passed','l1_passed'), false) AS verified
		FROM connect_profiles p
		LEFT JOIN connect_verification v ON v.user_id = p.user_id
		WHERE p.id = $1
		  AND (NULLIF($2,'') IS NULL OR p.id <> NULLIF($2,'')::uuid)
		  AND EXISTS (SELECT 1 FROM connect_profile_modes pm
		              WHERE pm.profile_id = p.id AND pm.visible = true)
		  AND NOT EXISTS (SELECT 1 FROM connect_blocks b
		                  WHERE (b.blocker_id = NULLIF($3,'')::uuid AND b.blocked_id = p.user_id)
		                     OR (b.blocked_id = NULLIF($3,'')::uuid AND b.blocker_id = p.user_id))
		  AND NOT EXISTS (SELECT 1 FROM connect_underage_flags uf
		                  WHERE uf.user_id = p.user_id AND uf.status <> 'cleared')
		  AND (p.dob IS NULL OR p.dob <= (CURRENT_DATE - INTERVAL '18 years'))
		  AND NOT EXISTS (SELECT 1 FROM connect_account_restrictions r
		                  WHERE r.user_id = p.user_id AND r.active
		                    AND (r.expires_at IS NULL OR r.expires_at > now()))`

	var rp rawPublicProfile
	err := s.db.QueryRow(ctx, q, targetID, viewerProfile, viewerUserID).Scan(
		&rp.id, &rp.displayName, &rp.city, &rp.headline, &rp.bio, &rp.interests,
		&rp.geoLat, &rp.geoLng, &rp.age, &rp.verified,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrTargetNotFound
	}
	if err != nil {
		return nil, err
	}

	photos, err := s.publicPhotos(ctx, rp.id)
	if err != nil {
		return nil, err
	}

	// Bucketed distance only — raw coordinates never leave the service.
	var distLabel string
	if vlat != nil && vlng != nil && rp.geoLat != nil && rp.geoLng != nil {
		d := haversineKm(*vlat, *vlng, *rp.geoLat, *rp.geoLng)
		bucket, within := bucketKm(d, s.cfg.distanceBuckets(ctx))
		distLabel = distanceLabel(bucket, within)
	}

	pp := assemblePublicProfile(rp, photos, distLabel)
	return &pp, nil
}

// publicPhotos returns the target's display-ordered photo URLs for a public
// (other-member) view. Rejected photos are withheld; approved + pending are
// shown (the discovery image-moderation pipeline is not yet built, and a
// just-registered profile's photos are still pending). Object keys are signed.
func (s *Service) publicPhotos(ctx context.Context, profileID string) ([]string, error) {
	const q = `SELECT url FROM connect_profile_media
		WHERE profile_id = $1 AND kind = 'photo' AND moderation_status <> 'rejected'
		ORDER BY sort_order, created_at, id`
	rows, err := s.db.Query(ctx, q, profileID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var url string
		if err := rows.Scan(&url); err != nil {
			return nil, err
		}
		out = append(out, s.resolveMedia(url))
	}
	return out, rows.Err()
}

// ProfileDetail — GET /discovery/profiles/:id → { data: PublicProfile }.
// The viewer sees another member's full profile card (photos, bio, interests,
// bucketed distance). A malformed, unknown or not-visible id is a 404.
func (h *MemberHandler) ProfileDetail(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	pp, err := h.svc.PublicProfile(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		mapDiscoveryError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": pp})
}
